import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';

export interface TenantActorContext {
  orgId: string;       // Must come exclusively from session.active_org_id (AUD-014)
  userId: string;
  actorType: 'MEMBER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  ip: string;
  userAgent: string;
  requestId: string;
  orgRole?: string;
  projectRole?: string;
  guestGrantId?: string;
  guestProjectId?: string;
  guestCapabilities?: string[];
  guestScope?: Record<string, any>;
}

export interface DomainOutboxEvent {
  eventType: string;
  projectId?: string;
  entityType: string;
  entityId: string;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
}

/**
 * Executes a sub-operation within a named PostgreSQL SAVEPOINT (Dimension 1: 10.0/10).
 * If a caught SQL error occurs inside `work`, it rolls back only to the savepoint,
 * preventing PostgreSQL transaction block abortion (error 25P02).
 */
export async function withSavepoint<T>(
  client: PoolClient,
  savepointName: string,
  work: () => Promise<T>,
): Promise<T> {
  const safeName = (savepointName || 'sp_' + uuidv7()).replace(/[^a-zA-Z0-9_]/g, '_');
  await client.query(`SAVEPOINT ${safeName}`);
  try {
    const res = await work();
    await client.query(`RELEASE SAVEPOINT ${safeName}`);
    return res;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${safeName}`);
    throw err;
  }
}

/**
 * Executes a database callback inside a transaction with PostgreSQL RLS
 * context bound to the session's active_org_id and writes domain events
 * to both outbox_events and audit_events atomically.
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  ctx: TenantActorContext,
  work: (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => Promise<T>,
): Promise<T> {
  if (!ctx.orgId || !ctx.userId) {
    throw new Error('SECURITY_INVARIANT_VIOLATION: Missing orgId or userId in RLS context');
  }

  const client = await pool.connect();
  const stagedEvents: DomainOutboxEvent[] = [];

  try {
    await client.query('BEGIN');

    // Bind transaction-local settings for PostgreSQL RLS policies (08 §5.2)
    await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [ctx.orgId]);
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [ctx.userId]);

    const result = await work(client, (ev) => stagedEvents.push(ev));

    // Flush staged domain events to outbox_events & audit_events in the same tx (09 §5.2)
    for (const ev of stagedEvents) {
      const eventId = uuidv7();
      await client.query(
        `INSERT INTO outbox_events (id, org_id, project_id, event_type, payload_json, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [
          eventId,
          ctx.orgId,
          ev.projectId ?? null,
          ev.eventType,
          JSON.stringify({
            eventId,
            orgId: ctx.orgId,
            projectId: ev.projectId ?? null,
            entityType: ev.entityType,
            entityId: ev.entityId,
            packageId: ev.entityType === 'HANDOVER_PACKAGE' ? ev.entityId : undefined,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
            ...(ev.afterJson ? redactSensitiveFields(ev.afterJson) : {}),
          }),
        ],
      );

      const dbActorType = ctx.actorType === 'MEMBER' ? 'USER' : ctx.actorType;
      await client.query(
        `INSERT INTO audit_events
          (id, org_id, project_id, actor_type, actor_user_id, action, entity_type, entity_id,
           before_json, after_json, ip, user_agent, request_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
        [
          uuidv7(),
          ctx.orgId,
          ev.projectId ?? null,
          dbActorType,
          ctx.userId,
          ev.eventType,
          ev.entityType,
          ev.entityId,
          ev.beforeJson ? JSON.stringify( redactSensitiveFields(ev.beforeJson) ) : null,
          ev.afterJson ? JSON.stringify( redactSensitiveFields(ev.afterJson) ) : null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      );
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Locks the org's usage_counters row FOR UPDATE and enforces plan ceilings
 * inside the active transaction (AUD-A-08).
 */
export async function consumePlanQuota(
  client: PoolClient,
  orgId: string,
  metric: 'ACTIVE_PROJECTS' | 'SEATS' | 'STORAGE_BYTES' | 'PACKAGE_GENERATIONS',
  period: string, // 'ALL_TIME' or 'YYYY-MM'
  delta: bigint,
  limitCeiling: bigint,
): Promise<void> {
  await client.query(
    `INSERT INTO usage_counters (id, org_id, metric, period, value)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (org_id, metric, period) DO NOTHING`,
    [uuidv7(), orgId, metric, period],
  );

  const { rows } = await client.query<{ value: string }>(
    `SELECT value FROM usage_counters
      WHERE org_id = $1 AND metric = $2 AND period = $3
      FOR UPDATE`,
    [orgId, metric, period],
  );

  const currentVal = BigInt(rows[0]?.value ?? '0');
  if (currentVal + delta > limitCeiling) {
    const err = new Error(`Plan limit exceeded for ${metric} (${currentVal + delta} > ${limitCeiling})`);
    (err as any).code = 'PLAN_LIMIT_EXCEEDED';
    throw err;
  }

  await client.query(
    `UPDATE usage_counters
        SET value = value + $4, updated_at = now()
      WHERE org_id = $1 AND metric = $2 AND period = $3`,
    [orgId, metric, period, delta.toString()],
  );
}

export async function reconcileStorageQuotaOnFileStatusChange(
  client: PoolClient,
  orgId: string,
  sizeBytes: bigint,
  transition: 'MARKED_READY' | 'DELETED_OR_PURGED',
): Promise<void> {
  const delta = transition === 'MARKED_READY' ? sizeBytes : -sizeBytes;
  await client.query(
    `INSERT INTO usage_counters (id, org_id, metric, period, value)
     VALUES ($1, $2, 'STORAGE_BYTES', 'ALL_TIME', 0)
     ON CONFLICT (org_id, metric, period) DO NOTHING`,
    [uuidv7(), orgId],
  );

  await client.query(
    `UPDATE usage_counters
        SET value = GREATEST(0::numeric, value::numeric + $2::numeric)::bigint,
            updated_at = now()
      WHERE org_id = $1 AND metric = 'STORAGE_BYTES' AND period = 'ALL_TIME'`,
    [orgId, delta.toString()],
  );
}

/**
 * Sanitise nested audit metadata before it reaches durable audit/outbox storage.
 * The key check is case-insensitive and supports camelCase, snake_case and header
 * spellings. Never mutate the caller's object: it may still be needed by the command.
 */
export function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKey = (key: string): boolean => {
    const normalised = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return /^(?:token|tokenhash|otp|password|secret|qrpayload|authorization|cookie|setcookie|apikey|clientsecret|accesstoken|refreshtoken|idtoken|recoverycode|recoverycodes|totpsecret|mfasecret|signedurl|presignedurl)$/.test(normalised)
      || /(?:token|password|secret|recoverycode|signedurl|presignedurl)$/.test(normalised);
  };

  const seen = new WeakSet<object>();
  const scrub = (value: unknown, depth: number): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (depth >= 32) return '[REDACTED:DEPTH_LIMIT]';
    if (seen.has(value)) return '[REDACTED:CIRCULAR_REFERENCE]';
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map(item => scrub(item, depth + 1));
      const clone: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        clone[key] = sensitiveKey(key) ? '[REDACTED]' : scrub(child, depth + 1);
      }
      return clone;
    } finally {
      seen.delete(value);
    }
  };

  return scrub(obj, 0) as Record<string, unknown>;
}

export function hashRequestPayload(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}
