import {notificationTransaction as scoped} from './notification-db';
import {missingCurrentObligationSql} from '@tradecloseout/db';
import type { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { deliverNotification, hasConfiguredNotificationGateway, QueuedNotification } from './notification-delivery';

export interface ClaimedNotification extends QueuedNotification {
  claim_token: string;
  delivery_attempts: number;
  delivery_attempt_id?:string;
}

export async function claimNotificationBatch(pool: Pool, orgId: string, quiet: boolean, limit=2, allowExternal=true, supportedEvents?:string[]): Promise<ClaimedNotification[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4) throw new Error('NOTIFICATION_BATCH_INVALID');
  return scoped(pool,orgId,async client => {
    if(!(await client.query("SELECT id FROM organisations WHERE id=$1 AND status='ACTIVE' FOR SHARE",[orgId])).rows.length)return [];
    const {rows:locks}=await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('notification-rate:'||$1::text,0)) AS acquired",[orgId]);
    if(!locks[0]?.acquired)return [];
    await client.query("DELETE FROM notification_rate_budgets WHERE org_id=$1 AND window_start<date_trunc('minute',now())-interval '2 days'",[orgId]);

    await client.query(`WITH uncertain AS(SELECT n.id FROM notifications n WHERE n.org_id=$1 AND n.status='QUEUED'
      AND n.channel<>'IN_APP' AND n.claim_until<=now() AND n.gateway_state<>'UNCERTAIN'
      AND EXISTS(SELECT 1 FROM notification_delivery_attempts a WHERE a.org_id=n.org_id AND a.notification_id=n.id
        AND a.claim_token=n.claim_token AND a.status='SENDING') ORDER BY n.id LIMIT 50 FOR UPDATE SKIP LOCKED)
      UPDATE notifications n SET gateway_state='UNCERTAIN',failure_code='GATEWAY_OUTCOME_UNCERTAIN',claim_token=NULL,
       claim_until=NULL,reconcile_after=now() FROM uncertain WHERE n.org_id=$1 AND n.id=uncertain.id`,[orgId]);
    await client.query(`UPDATE notification_delivery_attempts a SET status='UNCERTAIN',settled_at=now()
      FROM notifications n WHERE n.org_id=$1 AND a.org_id=n.org_id AND a.notification_id=n.id
       AND a.status='SENDING' AND n.gateway_state='UNCERTAIN' AND (n.claim_until IS NULL OR n.claim_until<=now())`,[orgId]);
    await client.query(`UPDATE notification_delivery_attempts a SET status='ABANDONED',settled_at=now()
      FROM notifications n WHERE n.org_id=$1 AND a.org_id=n.org_id AND a.notification_id=n.id AND a.status='CLAIMED'
       AND (n.claim_until IS NULL OR n.claim_until<=now())`,[orgId]);
    await client.query(`WITH obsolete AS(SELECT n.id FROM notifications n WHERE n.org_id=$1 AND n.status='QUEUED' AND n.gateway_state<>'UNCERTAIN'
      AND (n.claim_until IS NULL OR n.claim_until<=now()) AND (n.expires_at<=now() OR
        n.event_key IN('REQUIREMENT_DUE','WARRANTY_EXPIRING') AND n.payload_json->>'snapshotId' IS NOT NULL AND (
          NOT EXISTS(SELECT 1 FROM checklist_snapshots s JOIN projects p ON p.org_id=s.org_id AND p.id=s.project_id
            WHERE s.org_id=n.org_id AND s.project_id=n.project_id AND s.id::text=n.payload_json->>'snapshotId'
             AND s.status='ACTIVE' AND p.status IN('ACTIVE','HANDOVER','SUSPENDED') AND p.purged_at IS NULL)
          OR n.event_key='REQUIREMENT_DUE' AND NOT EXISTS(SELECT 1 FROM requirements obligation WHERE obligation.org_id=n.org_id
             AND obligation.project_id=n.project_id AND obligation.id::text=n.payload_json->>'obligationId'
             AND to_char((obligation.due_at AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD')=n.payload_json->>'dueDay'
             AND ${missingCurrentObligationSql('obligation')})
          OR n.event_key='WARRANTY_EXPIRING' AND NOT EXISTS(SELECT 1 FROM assets a WHERE a.org_id=n.org_id AND a.project_id=n.project_id
             AND a.id::text=n.payload_json->>'obligationId' AND a.status='ACTIVE' AND a.deleted_at IS NULL
             AND a.warranty_end::text=n.payload_json->>'dueDay')))
      ORDER BY n.created_at,n.id LIMIT 100 FOR UPDATE SKIP LOCKED)
      UPDATE notifications n SET status='FAILED',gateway_state='FAILED',failure_code='NOTIFICATION_EXPIRED_OR_NO_LONGER_APPLICABLE',
       dead_lettered_at=now(),claim_token=NULL,claim_until=NULL FROM obsolete WHERE n.org_id=$1 AND n.id=obsolete.id`,[orgId]);
    // Recovery after an abandoned final lease or a crash before terminal failure.
    await client.query(`WITH overdue AS (
      SELECT id FROM notifications
       WHERE org_id=$1 AND status='QUEUED' AND dead_lettered_at IS NULL
         AND gateway_state<>'UNCERTAIN' AND delivery_attempts>=5 AND (claim_until IS NULL OR claim_until<=now())
       ORDER BY created_at,id LIMIT 50 FOR UPDATE SKIP LOCKED
    ) UPDATE notifications n
         SET status='FAILED',gateway_state='FAILED',dead_lettered_at=now(),
             failure_code='DELIVERY_ATTEMPTS_EXHAUSTED',claim_token=NULL,claim_until=NULL
       FROM overdue WHERE n.org_id=$1 AND n.id=overdue.id`,[orgId]);
    const {rows}=await client.query<ClaimedNotification>(`WITH eligible AS (
      SELECT id,row_number() OVER(PARTITION BY channel ORDER BY next_attempt_at,created_at,id) AS channel_position FROM notifications
       WHERE org_id=$1 AND status='QUEUED' AND dead_lettered_at IS NULL
         AND gateway_state='PENDING' AND delivery_attempts<5 AND next_attempt_at<=now()
         AND (expires_at IS NULL OR expires_at>now())
         AND (category='SECURITY' OR NOT EXISTS(SELECT 1 FROM notification_preferences pref WHERE pref.org_id=notifications.org_id
           AND pref.user_id=notifications.recipient_user_id AND pref.category=notifications.category
           AND pref.channel=notifications.channel AND pref.enabled=false))
         AND (project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.org_id=notifications.org_id
           AND p.id=notifications.project_id AND p.status IN('ACTIVE','HANDOVER') AND p.purged_at IS NULL))
         AND (recipient_user_id IS NULL OR EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
           WHERE m.org_id=notifications.org_id AND m.user_id=notifications.recipient_user_id AND m.status='ACTIVE'
             AND (notifications.category<>'OWNER_DIGEST' OR m.role='R-OWNER')
             AND (notifications.project_id IS NULL OR m.role IN('R-OWNER','R-ADMIN') OR EXISTS(
               SELECT 1 FROM project_members pm WHERE pm.org_id=m.org_id AND pm.user_id=m.user_id
                 AND pm.project_id=notifications.project_id AND pm.status='ACTIVE'))))
         AND (claim_until IS NULL OR claim_until<=now())
         AND ($2::boolean=false OR channel='IN_APP' OR urgent=true AND event_key='SECURITY_NOTICE')
         AND ($5::boolean=true OR channel='IN_APP')
         AND ($6::text[] IS NULL OR channel='IN_APP' OR channel='EMAIL' AND event_key=ANY($6::text[]))
         AND COALESCE((SELECT budget.claimed FROM notification_rate_budgets budget WHERE budget.org_id=notifications.org_id
           AND budget.channel=notifications.channel AND budget.window_start=date_trunc('minute',now())),0)<CASE WHEN channel='IN_APP' THEN 100 ELSE 20 END
    ),due AS(
      SELECT candidate.id FROM notifications candidate JOIN eligible e ON e.id=candidate.id
       WHERE candidate.org_id=$1 AND e.channel_position<=
         CASE WHEN candidate.channel='IN_APP' THEN 100 ELSE 20 END-COALESCE((SELECT claimed FROM notification_rate_budgets
           WHERE org_id=$1 AND channel=candidate.channel AND window_start=date_trunc('minute',now())),0)
       ORDER BY e.channel_position,candidate.next_attempt_at,candidate.created_at,candidate.id
       LIMIT $3 FOR UPDATE OF candidate SKIP LOCKED
    ) UPDATE notifications n
         SET claim_token=$4,claim_until=now()+interval '45 seconds',
             delivery_attempts=n.delivery_attempts+1
       FROM due WHERE n.org_id=$1 AND n.id=due.id
       RETURNING n.id,n.org_id,n.channel,n.event_key,n.payload_json,
         n.recipient_user_id,n.recipient_party_id,n.claim_token,n.delivery_attempts`,
      [orgId,quiet,limit,uuidv7(),allowExternal,supportedEvents??null]);
    for(const channel of [...new Set(rows.map(row=>row.channel))]){
      await client.query(`INSERT INTO notification_rate_budgets(org_id,channel,window_start,claimed)
        VALUES($1,$2,date_trunc('minute',now()),$3) ON CONFLICT(org_id,channel,window_start)
        DO UPDATE SET claimed=notification_rate_budgets.claimed+EXCLUDED.claimed`,[orgId,channel,rows.filter(row=>row.channel===channel).length]);
    }
    for(const row of rows){
      const attemptId=uuidv7();
      await client.query(`INSERT INTO notification_delivery_attempts(id,org_id,notification_id,attempt_no,claim_token,input_hash,status)
        SELECT $1,$2,$3,COALESCE((SELECT MAX(attempt_no) FROM notification_delivery_attempts WHERE org_id=$2 AND notification_id=$3),0)+1,$4,
          encode(digest(jsonb_build_object('event',n.event_key,'channel',n.channel,'recipientUser',n.recipient_user_id,
            'recipientParty',n.recipient_party_id,'payload',n.payload_json)::text,'sha256'),'hex'),'CLAIMED'
        FROM notifications n WHERE n.org_id=$2 AND n.id=$3`,[attemptId,orgId,row.id,row.claim_token]);
      row.delivery_attempt_id=attemptId;
    }
    return rows;
  });
}

export async function resolveNotificationClaim(
  pool: Pool, notif: ClaimedNotification, accepted: boolean, uncertain=false,
): Promise<boolean> {
  return scoped(pool,notif.org_id,async client => {
    const {rowCount}=await client.query(`UPDATE notifications
      SET claim_token=NULL,claim_until=NULL,
          status=CASE WHEN $5::boolean THEN 'QUEUED' WHEN $4::boolean THEN CASE WHEN read_at IS NULL THEN 'SENT' ELSE 'READ' END
               WHEN delivery_attempts>=5 THEN 'FAILED' ELSE 'QUEUED' END,
          gateway_state=CASE WHEN $5::boolean THEN 'UNCERTAIN' WHEN $4::boolean AND channel='IN_APP' THEN 'DELIVERED' WHEN $4::boolean THEN 'ACCEPTED'
               WHEN delivery_attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
          sent_at=CASE WHEN $4::boolean THEN now() ELSE sent_at END,
          dead_lettered_at=CASE WHEN NOT $4::boolean AND NOT $5::boolean AND delivery_attempts>=5 THEN now() ELSE NULL END,
          failure_code=CASE WHEN $5::boolean THEN 'GATEWAY_OUTCOME_UNCERTAIN' WHEN $4::boolean THEN NULL ELSE 'DELIVERY_PROVIDER_UNCONFIRMED' END,
          reconcile_after=now()+CASE WHEN $4::boolean THEN interval '5 minutes' ELSE interval '30 seconds' END,
          next_attempt_at=CASE WHEN $4::boolean THEN next_attempt_at
            ELSE now()+make_interval(secs=>LEAST(1800,5*(1<<LEAST(delivery_attempts,8)))+(abs(hashtext(id::text)::bigint)%5)::int) END
      WHERE org_id=$1 AND id=$2 AND claim_token=$3
        AND claim_until>now() AND status='QUEUED' AND dead_lettered_at IS NULL`,
      [notif.org_id,notif.id,notif.claim_token,accepted,uncertain]);
    if(rowCount===1)await client.query(`UPDATE notification_delivery_attempts SET status=$4,settled_at=now(),provider_message_id=
      (SELECT provider_message_id FROM notifications WHERE org_id=$1 AND id=$2) WHERE org_id=$1 AND notification_id=$2 AND claim_token=$3`,
      [notif.org_id,notif.id,notif.claim_token,uncertain?'UNCERTAIN':accepted?(notif.channel==='IN_APP'?'DELIVERED':'ACCEPTED'):'RETRYABLE']);
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
    try { batch=await claimNotificationBatch(pool,orgId,quiet,4,allowExternal,deliver===deliverNotification?['WEEKLY_OWNER_DIGEST',...(process.env.NODE_ENV==='test'?['SAFE_GATEWAY']:[])]:undefined); }
    catch { counts.failed++; continue; }
    counts.claimed+=batch.length;
    const send=async(notif:ClaimedNotification)=>{
      let accepted=false,sendingStarted=false;
      try {
        if(deliver===deliverNotification&&notif.channel!=='IN_APP')await scoped(pool,notif.org_id,async client=>{
          const {rows}=await client.query("SELECT id FROM notifications WHERE org_id=$1 AND id=$2 AND claim_token=$3 AND claim_until>now() AND status='QUEUED' FOR UPDATE",[notif.org_id,notif.id,notif.claim_token]);
          if(!rows.length)throw new Error('NOTIFICATION_CLAIM_LOST');
          const updated=await client.query("UPDATE notification_delivery_attempts SET status='SENDING' WHERE org_id=$1 AND id=$2 AND claim_token=$3 AND status='CLAIMED'",[notif.org_id,notif.delivery_attempt_id,notif.claim_token]);
          if(updated.rowCount!==1)throw new Error('NOTIFICATION_ATTEMPT_LOST');
        });
        sendingStarted=deliver===deliverNotification&&notif.channel!=='IN_APP';
        accepted=deliver===deliverNotification?await deliverNotification(notif,async messageId=>{
        await scoped(pool,notif.org_id,async client=>{
          const result=await client.query(`UPDATE notifications SET provider_message_id=$4 WHERE org_id=$1 AND id=$2
            AND claim_token=$3 AND claim_until>now() AND status='QUEUED' AND (provider_message_id IS NULL OR provider_message_id=$4)`,
            [notif.org_id,notif.id,notif.claim_token,messageId]);
          if(result.rowCount!==1)throw new Error('NOTIFICATION_CLAIM_LOST');
        });
      }):await deliver(notif); } catch { /* Retry same ID; accepted-timeout is ambiguous. */ }
      try {
        if (await resolveNotificationClaim(pool,notif,accepted,sendingStarted&&!accepted)) {
          if (accepted) counts.accepted++; else counts.failed++;
        } else counts.failed++;
      } catch {
        // An uncertain outcome retains the fenced claim until expiry; never
        // falsely mark recipient delivery or disclose gateway exception.
        counts.failed++;
      }
    };
    for(let i=0;i<batch.length;i+=2)await Promise.all(batch.slice(i,i+2).map(send));
  }
  return counts;
}
