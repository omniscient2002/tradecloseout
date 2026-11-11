import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { OUTBOX_EVENT_REGISTRY } from './event-registry';

export interface ClaimedOutboxEvent {
  id: string;
  org_id: string;
  project_id: string | null;
  event_type: string;
  payload_json: unknown;
  claim_token: string;
  attempts: number;
}

export type EnqueueOutboxEvent = (
  type: string, payload: Record<string, unknown>, idempotencyKey: string,
) => Promise<void>;

/** All database mutations are tenant-scoped; no network work occurs inside a transaction. */
async function tenantTransaction<T>(
  pool: Pool, orgId: string, action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let releaseWithError = false;
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)`,
      [orgId],
    );
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); }
    catch { releaseWithError = true; }
    throw err;
  } finally {
    // Destroy a connection if the rollback outcome is uncertain.
    client.release(releaseWithError);
  }
}

/** Claim a small batch in one short DB transaction; no Redis call holds row locks. */
export async function claimOutboxBatch(
  pool: Pool, orgId: string, limit = 20,
): Promise<ClaimedOutboxEvent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('OUTBOX_BATCH_LIMIT_INVALID');
  return tenantTransaction(pool, orgId, async client => {
    // A crashed worker at its final attempt must not leave a permanent,
    // silently undispatched claim. Mark exhausted leases for operator replay.
    await client.query(
      `WITH exhausted AS (
         SELECT id FROM outbox_events WHERE org_id=$1 AND dispatched_at IS NULL
           AND dead_lettered_at IS NULL AND attempts>=5
           AND (claim_until IS NULL OR claim_until<=now())
         ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_events e
          SET dead_lettered_at=now(),claim_token=NULL,
              claim_until=NULL,failure_code='OUTBOX_CLAIM_EXHAUSTED'
         FROM exhausted WHERE e.org_id=$1 AND e.id=exhausted.id`,
      [orgId],
    );
    const { rows } = await client.query<ClaimedOutboxEvent>(
      `WITH due AS (
         SELECT id FROM outbox_events
          WHERE org_id=$1 AND dispatched_at IS NULL AND dead_lettered_at IS NULL
            AND attempts < 5 AND next_attempt_at <= now()
            AND (claim_until IS NULL OR claim_until <= now())
          ORDER BY next_attempt_at ASC, created_at ASC, id ASC
          LIMIT $2 FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_events e
          SET claim_token=$3,claim_until=now()+interval '90 seconds',
              attempts=e.attempts+1
         FROM due WHERE e.org_id=$1 AND e.id=due.id
       RETURNING e.id,e.org_id,e.project_id,e.event_type,e.payload_json,
                 e.claim_token,e.attempts`,
      [orgId, limit, uuidv7()],
    );
    return rows;
  });
}

/** The claim token fences late ack/fail requests after a newer owner reclaims. */
export async function acknowledgeOutboxClaim(
  pool: Pool, item: ClaimedOutboxEvent,
): Promise<boolean> {
  return tenantTransaction(pool, item.org_id, async client => {
    const { rowCount } = await client.query(
      `UPDATE outbox_events
          SET dispatched_at=now(),claim_token=NULL,claim_until=NULL,failure_code=NULL
        WHERE org_id=$1 AND id=$2 AND claim_token=$3
          AND claim_until>now() AND dispatched_at IS NULL
          AND dead_lettered_at IS NULL`,
      [item.org_id, item.id, item.claim_token],
    );
    return rowCount === 1;
  });
}

export async function failOutboxClaim(
  pool: Pool, item: ClaimedOutboxEvent, failure: 'QUEUE_DISPATCH_FAILED' | 'OUTBOX_EVENT_INVALID',
): Promise<boolean> {
  return tenantTransaction(pool, item.org_id, async client => {
    const { rowCount } = await client.query(
      `UPDATE outbox_events
          SET claim_token=NULL,claim_until=NULL,
              failure_code=$4,
              dead_lettered_at=CASE WHEN attempts>=5 THEN now() ELSE NULL END,
              next_attempt_at=now()+make_interval(secs=>LEAST(1800,5*(1<<LEAST(attempts,8))))
        WHERE org_id=$1 AND id=$2 AND claim_token=$3
          AND claim_until>now() AND dispatched_at IS NULL
          AND dead_lettered_at IS NULL`,
      [item.org_id, item.id, item.claim_token, failure],
    );
    return rowCount === 1;
  });
}

/**
 * Unknown events cannot execute. Envelope identities derive only from the
 * trusted DB row; never authorize from caller/domain payload fields.
 */
export async function dispatchClaimedOutboxEvent(
  item: ClaimedOutboxEvent, enqueue: EnqueueOutboxEvent,
): Promise<void> {
  const registry = OUTBOX_EVENT_REGISTRY[item.event_type];
  if (!registry) throw new Error('OUTBOX_EVENT_INVALID');
  const body = item.payload_json;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('OUTBOX_EVENT_INVALID');
  }
  const payload: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
    eventId: item.id,
    orgId: item.org_id,
    projectId: item.project_id,
  };
  if (registry.category === 'EXECUTABLE') {
    // PH1-G24-009: validate the typed immutable identity *before* queue
    // admission. Reject future versions rather than interpreting them as v1.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isUuid = (v: unknown): v is string => typeof v === 'string' && uuid.test(v);
    const isBounded = (v: unknown, max = 1024): v is string =>
      typeof v === 'string' && v.length > 0 && v.length <= max;
    if (!isUuid(item.id) || !isUuid(item.org_id) || !isUuid(item.project_id) ||
        (payload.eventSchemaVersion !== undefined && payload.eventSchemaVersion !== registry.version)) {
      throw new Error('OUTBOX_EVENT_INVALID');
    }
    if (item.event_type === 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN') {
      if (!isUuid(payload.versionId) || !isUuid(payload.storageObjectId) ||
          !isBounded(payload.bucket, 255) || !isBounded(payload.objectKey, 1024) ||
          !isBounded(payload.providerVersionId, 255)) throw new Error('OUTBOX_EVENT_INVALID');
    } else if (item.event_type === 'HANDOVER_PACKAGE_QUEUED') {
      if (!isUuid(payload.packageId)) throw new Error('OUTBOX_EVENT_INVALID');
    } else if (item.event_type === 'PROJECT_ARCHIVE_EXPORT_QUEUED') {
      if (!isUuid(payload.exportId)) throw new Error('OUTBOX_EVENT_INVALID');
    } else {
      throw new Error('OUTBOX_EVENT_INVALID');
    }
    await enqueue(item.event_type, payload, item.id);
  }
}

/** Runs claims per tenant without holding any database lock during enqueue. */
export async function dispatchDueOutbox(
  pool: Pool, enqueue: EnqueueOutboxEvent,
): Promise<{ claimed: number; acknowledged: number; failed: number }> {
  const result = { claimed: 0, acknowledged: 0, failed: 0 };
  // Organisations is the approved global discovery surface, NOT an RLS bypass.
  const { rows: orgs } = await pool.query<{ id: string }>(
    `SELECT id FROM organisations WHERE status<>'DELETED' ORDER BY id`,
  );
  for (const { id: orgId } of orgs) {
    let batch: ClaimedOutboxEvent[];
    try {
      // Four bounded claims per tenant reduce queue head-of-line blocking
      // and ensure the last lease is not long-expired before its enqueue.
      batch = await claimOutboxBatch(pool, orgId, 4);
    } catch {
      result.failed++;
      continue; // One tenant's RLS/DB error must not starve other tenants.
    }
    result.claimed += batch.length;
    for (const item of batch) {
      try {
        await dispatchClaimedOutboxEvent(item, enqueue);
        if (await acknowledgeOutboxClaim(pool, item)) result.acknowledged++;
        else result.failed++; // Ack loss requires outcome reconciliation.
      } catch (error) {
        const permanent = error instanceof Error && error.message === 'OUTBOX_EVENT_INVALID';
        try {
          await failOutboxClaim(pool, item, permanent ? 'OUTBOX_EVENT_INVALID' : 'QUEUE_DISPATCH_FAILED');
        } catch {
          // Leased claims remain recoverable on expiry. Never invent an ack.
        }
        result.failed++;
      }
    }
  }
  return result;
}
