import type { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { deliverNotification, hasConfiguredNotificationGateway, QueuedNotification } from './notification-delivery';

export interface ClaimedNotification extends QueuedNotification {
  claim_token: string;
  delivery_attempts: number;
}

async function scoped<T>(pool: Pool, orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout='5s'`);
    await client.query(`SET LOCAL statement_timeout='15s'`);
    await client.query(`SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)`,[orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally { client.release(destroy); }
}

export async function claimNotificationBatch(pool: Pool, orgId: string, quiet: boolean, limit=2, allowExternal=true): Promise<ClaimedNotification[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4) throw new Error('NOTIFICATION_BATCH_INVALID');
  return scoped(pool,orgId,async client => {
    // Recovery after an abandoned final lease or a crash before terminal failure.
    await client.query(`WITH overdue AS (
      SELECT id FROM notifications
       WHERE org_id=$1 AND status='QUEUED' AND dead_lettered_at IS NULL
         AND delivery_attempts>=5 AND (claim_until IS NULL OR claim_until<=now())
       ORDER BY created_at,id LIMIT 50 FOR UPDATE SKIP LOCKED
    ) UPDATE notifications n
         SET status='FAILED',gateway_state='FAILED',dead_lettered_at=now(),
             failure_code='DELIVERY_ATTEMPTS_EXHAUSTED',claim_token=NULL,claim_until=NULL
       FROM overdue WHERE n.org_id=$1 AND n.id=overdue.id`,[orgId]);
    const {rows}=await client.query<ClaimedNotification>(`WITH due AS (
      SELECT id FROM notifications
       WHERE org_id=$1 AND status='QUEUED' AND dead_lettered_at IS NULL
         AND delivery_attempts<5 AND next_attempt_at<=now()
         AND (claim_until IS NULL OR claim_until<=now())
         AND ($2::boolean=false OR channel NOT IN ('SMS','WHATSAPP'))
         AND ($5::boolean=true OR channel='IN_APP')
       ORDER BY next_attempt_at,created_at,id LIMIT $3 FOR UPDATE SKIP LOCKED
    ) UPDATE notifications n
         SET claim_token=$4,claim_until=now()+interval '45 seconds',
             delivery_attempts=n.delivery_attempts+1
       FROM due WHERE n.org_id=$1 AND n.id=due.id
       RETURNING n.id,n.org_id,n.channel,n.event_key,n.payload_json,
         n.recipient_user_id,n.recipient_party_id,n.claim_token,n.delivery_attempts`,
      [orgId,quiet,limit,uuidv7(),allowExternal]);
    return rows;
  });
}

export async function resolveNotificationClaim(
  pool: Pool, notif: ClaimedNotification, accepted: boolean,
): Promise<boolean> {
  return scoped(pool,notif.org_id,async client => {
    const {rowCount}=await client.query(`UPDATE notifications
      SET claim_token=NULL,claim_until=NULL,
          status=CASE WHEN $4::boolean THEN 'SENT'
               WHEN delivery_attempts>=5 THEN 'FAILED' ELSE 'QUEUED' END,
          gateway_state=CASE WHEN $4::boolean THEN 'ACCEPTED'
               WHEN delivery_attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
          sent_at=CASE WHEN $4::boolean THEN now() ELSE sent_at END,
          dead_lettered_at=CASE WHEN NOT $4::boolean AND delivery_attempts>=5 THEN now() ELSE NULL END,
          failure_code=CASE WHEN $4::boolean THEN NULL ELSE 'DELIVERY_PROVIDER_UNCONFIRMED' END,
          next_attempt_at=CASE WHEN $4::boolean THEN next_attempt_at
            ELSE now()+make_interval(secs=>LEAST(1800,5*(1<<LEAST(delivery_attempts,8)))) END
      WHERE org_id=$1 AND id=$2 AND claim_token=$3
        AND claim_until>now() AND status='QUEUED' AND dead_lettered_at IS NULL`,
      [notif.org_id,notif.id,notif.claim_token,accepted]);
    return rowCount===1;
  });
}

/** Gateway calls run after claim COMMIT; failure never logs recipient/payload/credentials. */
export async function dispatchDueNotifications(
  pool: Pool, quiet: boolean,
  deliver: (notif: QueuedNotification) => Promise<boolean> = deliverNotification,
): Promise<{accepted:number;failed:number;claimed:number}> {
  const counts={accepted:0,failed:0,claimed:0};
  // Missing gateway configuration is an operational readiness issue, not a
  // provider rejection. Preserve external retry budgets; IN_APP can proceed.
  const allowExternal=deliver!==deliverNotification || hasConfiguredNotificationGateway();
  const {rows:orgs}=await pool.query<{id:string}>(`SELECT id FROM organisations WHERE status='ACTIVE' ORDER BY id`);
  for (const {id:orgId} of orgs) {
    let batch: ClaimedNotification[];
    try { batch=await claimNotificationBatch(pool,orgId,quiet,2,allowExternal); }
    catch { counts.failed++; continue; }
    counts.claimed+=batch.length;
    for (const notif of batch) {
      let accepted=false;
      try { accepted=await deliver(notif); } catch { /* Retry same ID; accepted-timeout is ambiguous. */ }
      try {
        if (await resolveNotificationClaim(pool,notif,accepted)) {
          if (accepted) counts.accepted++; else counts.failed++;
        } else counts.failed++;
      } catch {
        // An uncertain outcome retains the fenced claim until expiry; never
        // falsely mark recipient delivery or disclose gateway exception.
        counts.failed++;
      }
    }
  }
  return counts;
}
