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
  // PostgreSQL truncates identifiers to 63 bytes. A bounded, prefixed name
  // with a digest suffix avoids invalid numeric prefixes, SQL injection and
  // accidental collisions between long caller-provided savepoint names.
  const raw = savepointName || uuidv7();
  const safePrefix = raw.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 35);
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const safeName = `sp_${safePrefix}_${digest}`;
  await client.query(`SAVEPOINT ${safeName}`);
  try {
    const res = await work();
    await client.query(`RELEASE SAVEPOINT ${safeName}`);
    return res;
  } catch (err) {
    // Preserve the command failure. The owning outer transaction must handle
    // an unsuccessful rollback and discard the connection if state is unknown.
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${safeName}`);
      await client.query(`RELEASE SAVEPOINT ${safeName}`);
    } catch {
      // Do not replace the original command error with a cleanup error.
    }
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
  let began = false;
  let commitAttempted = false;
  let discardConnection = false;

  try {
    await client.query('BEGIN');
    began = true;
    // Bound every scoped transaction, including lock waits and idle client gaps.
    // These are transaction-local: pooled connections cannot retain these settings.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");

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
            // Untrusted metadata is intentionally placed first: it must never
            // override the immutable event identity or trusted actor envelope.
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

    // A failed COMMIT can leave the outcome unknown. Never offer that connection
    // to another tenant or automatically replay this possibly committed command.
    commitAttempted = true;
    await client.query('COMMIT');
    return result;
  } catch (err) {
    discardConnection = !began || commitAttempted;
    if (began) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original command/commit failure, not the cleanup error.
        // node-postgres must physically destroy connections with unknown state.
        discardConnection = true;
      }
    }
    throw err;
  } finally {
    client.release(discardConnection);
  }
}

/**
 * Locks the org's usage_counters row FOR UPDATE and enforces plan ceilings
 * inside the active transaction (AUD-A-08).
 */
const POSTGRES_BIGINT_MAX = 9223372036854775807n;

export async function consumePlanQuota(
  client: PoolClient,
  orgId: string,
  metric: 'ACTIVE_PROJECTS' | 'SEATS' | 'STORAGE_BYTES' | 'PACKAGES_MONTH',
  period: string, // 'ALL_TIME' or 'YYYY-MM'
  delta: bigint,
  limitCeiling: bigint,
): Promise<void> {
  // Match the actual usage_counters metric CHECK and BIGINT range. A negative
  // delta may release quota, but must never underflow or wrap the counter.
  if (typeof delta !== 'bigint' || typeof limitCeiling !== 'bigint' ||
      delta < -POSTGRES_BIGINT_MAX || delta > POSTGRES_BIGINT_MAX ||
      limitCeiling < 0n || limitCeiling > POSTGRES_BIGINT_MAX) {
    throw new Error('INVALID_PLAN_QUOTA_ARGUMENT');
  }
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

  if (rows.length !== 1) throw new Error('PLAN_COUNTER_NOT_FOUND');
  const currentVal = BigInt(rows[0].value);
  const newVal = currentVal + delta;
  if (currentVal < 0n || currentVal > POSTGRES_BIGINT_MAX ||
      newVal < 0n || newVal > POSTGRES_BIGINT_MAX) {
    throw new Error('PLAN_COUNTER_OUT_OF_RANGE');
  }
  if (newVal > limitCeiling) {
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
  if (typeof sizeBytes !== 'bigint' || sizeBytes <= 0n || sizeBytes > POSTGRES_BIGINT_MAX) {
    throw new Error('INVALID_STORAGE_QUOTA_SIZE');
  }
  await client.query(
    `INSERT INTO usage_counters (id, org_id, metric, period, value)
     VALUES ($1, $2, 'STORAGE_BYTES', 'ALL_TIME', 0)
     ON CONFLICT (org_id, metric, period) DO NOTHING`,
    [uuidv7(), orgId],
  );

  // Never mask lifecycle double-debits with GREATEST(..., 0), nor allow a
  // successful file state change to silently overflow the persisted counter.
  // The conditional UPDATE is atomic under PostgreSQL's row-level locking.
  const condition = transition === 'MARKED_READY'
    ? 'value <= 9223372036854775807::bigint - $2::bigint'
    : 'value >= $2::bigint';
  const arithmetic = transition === 'MARKED_READY'
    ? 'value + $2::bigint'
    : 'value - $2::bigint';
  const updated = await client.query(
    `UPDATE usage_counters
        SET value = ${arithmetic}, updated_at = now()
      WHERE org_id = $1 AND metric = 'STORAGE_BYTES' AND period = 'ALL_TIME'
        AND ${condition}`,
    [orgId, sizeBytes.toString()],
  );
  if (updated.rowCount !== 1) {
    throw new Error('STORAGE_QUOTA_RECONCILIATION_REQUIRED');
  }
}

/**
 * Sanitise nested audit metadata before it reaches durable audit/outbox storage.
 * The key check is case-insensitive and supports camelCase, snake_case and header
 * spellings. Never mutate the caller's object: it may still be needed by the command.
 */
export function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKey = (key: string): boolean => {
    const normalised = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return /(?:password|secret|token|credential|privatekey|apikey|authorization|cookie|recoverycode|signedurl|presignedurl|connectionstring|databaseurl|manualsetupkey|qrpayload|qrcode|otp|clientassertion)/.test(normalised);
  };

  const sensitiveString = (value: string): boolean =>
    /(?:[?&](?:x-amz-signature|x-goog-signature|signature|access_token|token|x-amz-credential)=|otpauth:\/\/|bearer\s+[a-z0-9._~-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(value);

  const seen = new WeakSet<object>();
  const scrub = (value: unknown, depth: number): unknown => {
    // Signed URLs and credential payloads may sit under innocent field names
    // such as 'url' or 'value'. Do not write them into durable event metadata.
    if (typeof value === 'string') return sensitiveString(value) ? '[REDACTED]' : value;
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
