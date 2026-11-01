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
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [ctx.orgId]);
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
            entityType: ev.entityType,
            entityId: ev.entityId,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
          }),
        ],
      );

      await client.query(
        `INSERT INTO audit_events
          (id, org_id, project_id, actor_type, actor_user_id, action, entity_type, entity_id,
           before_json, after_json, ip, user_agent, request_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
        [
          uuidv7(),
          ctx.orgId,
          ev.projectId ?? null,
          ctx.actorType,
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

function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const REDACTED_KEYS = new Set(['token', 'token_hash', 'otp', 'password', 'secret', 'qr_payload']);
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    clone[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return clone;
}

export function hashRequestPayload(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}
