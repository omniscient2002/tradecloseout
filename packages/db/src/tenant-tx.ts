import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { assertCurrentProjectAuthority } from './project-authority';

export interface TenantActorContext {
  orgId: string;       // Must come exclusively from session.active_org_id (AUD-014)
  userId: string;
  actorType: 'MEMBER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  ip: string;
  userAgent: string;
  requestId: string;
  orgRole?: string;
  projectRole?: string;
  projectId?: string;
  projectScope?: Record<string, unknown>;
  permission?: string;
  docControllerOrgWideDownload?: boolean;
  guestGrantId?: string;
  guestProjectId?: string;
  guestCapabilities?: string[];
  guestScope?: Record<string, any>;
  // Populated exclusively by SessionCsrfGuard for authenticated HTTP work.
  // Optional for controlled migrations, background jobs and offline fixtures.
  sessionId?: string;
  authGeneration?: string;
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

    if (ctx.sessionId || ctx.authGeneration) {
      // Lock the actual authenticated session for the full mutation.
      // A concurrent role change / org switch / logout must serialize with
      // this operation, rather than revoking the browser after a stale guard
      // allowed a privileged write to proceed.
      if (!ctx.sessionId || !ctx.authGeneration) {
        throw new Error('AUTH_SESSION_CONTEXT_INCOMPLETE');
      }
      const { rows: validSession } = await client.query(
        `SELECT id FROM sessions
           WHERE id=$1 AND user_id=$2 AND active_org_id=$3
             AND auth_generation=$4 AND revoked_at IS NULL
             AND expires_at>now() AND absolute_expires_at>now()
           FOR SHARE`,
        [ctx.sessionId,ctx.userId,ctx.orgId,ctx.authGeneration],
      );
      if (!validSession.length) {
        throw new Error('AUTH_SESSION_CONTEXT_CHANGED');
      }
    }

    await assertCurrentProjectAuthority(client, ctx);

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
            // Preserve legacy payload contracts, but reserved identity fields
            // may only come from the trusted transaction context.
            ...(ev.afterJson ? redactSensitiveFields(ev.afterJson) : {}),
            eventId,
            orgId: ctx.orgId,
            projectId: ev.projectId ?? null,
            entityType: ev.entityType,
            entityId: ev.entityId,
            packageId: ev.entityType === 'HANDOVER_PACKAGE' ? ev.entityId : undefined,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
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
 * Defense in depth for structured event data before it reaches either the
 * immutable audit ledger or the worker outbox. This is not a substitute for
 * schema-level event allowlists or secret-free producer contracts.
 */
export function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const secretKey = /(?:^|_)(?:tokens?|secrets?|passwords?|otps?|pins?|api_keys?|access_keys?|private_keys?|recovery_codes?|backup_codes?|authorization|cookies?|qr_payload|client_secrets?)(?:_|$)/i;
  const isSecretKey = (key: string) => secretKey.test(
    key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[.\-]/g, '_').toLowerCase(),
  );
  const signedUrl = /(?:[?&](?:X-Amz-(?:Signature|Credential|Security-Token)|Signature|token|access_token|sig)=)/i;
  const sanitize = (value: unknown, depth: number): unknown => {
    if (depth > 32) return '[REDACTED]';
    if (typeof value === 'string') {
      return signedUrl.test(value) ? '[REDACTED]' : value;
    }
    if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
        [key, isSecretKey(key) ? '[REDACTED]' : sanitize(entry, depth + 1)]));
    }
    return value;
  };
  return sanitize(obj, 0) as Record<string, unknown>;
}

export function hashRequestPayload(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

export { assertCurrentProjectAuthority, assertMemberResourceScope } from './project-authority';
