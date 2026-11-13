import type {Pool} from 'pg';
import {uuidv7} from 'uuidv7';
import {notificationTransaction} from './notification-db';
import {hasConfiguredNotificationStatusGateway,lookupNotificationGatewayOutcome,NotificationGatewayOutcome} from './notification-delivery';
/** Claim lookup work briefly; HTTP never holds a row lock. Callback receipts fence late lookup results. */
export async function reconcileNotificationOutcomes(pool:Pool,lookup:(org:string,id:string)=>Promise<NotificationGatewayOutcome|null>=lookupNotificationGatewayOutcome):Promise<{resolved:number;pending:number}>{
 const result={resolved:0,pending:0};if(lookup===lookupNotificationGatewayOutcome&&!hasConfiguredNotificationStatusGateway())return result;
 const {rows:orgs}=await pool.query("SELECT id FROM organisations WHERE status<>'DELETED' ORDER BY id");
 for(const org of orgs){let rows:any[]=[];
  try{rows=await notificationTransaction(pool,org.id,async client=>(await client.query(`WITH due AS(SELECT id FROM notifications WHERE org_id=$1
   AND gateway_state IN('UNCERTAIN','ACCEPTED') AND reconcile_after<=now() AND (claim_until IS NULL OR claim_until<=now())
   ORDER BY reconcile_after,id LIMIT 5 FOR UPDATE SKIP LOCKED)
   UPDATE notifications n SET claim_token=$2,claim_until=now()+interval '45 seconds' FROM due
    WHERE n.org_id=$1 AND n.id=due.id RETURNING n.id,n.claim_token`,[org.id,uuidv7()])).rows);}catch{result.pending++;continue;}
  for(const row of rows){let outcome:NotificationGatewayOutcome|null=null;
   try{outcome=await lookup(org.id,row.id);}catch{ /* Retain explicit uncertainty without disclosing provider exceptions. */ }
   try{const settled=await notificationTransaction(pool,org.id,async client=>{
    const {rows}=await client.query('SELECT * FROM notifications WHERE org_id=$1 AND id=$2 AND claim_token=$3 AND claim_until>now() FOR UPDATE',[org.id,row.id,row.claim_token]);const current=rows[0];
    if(!current||!['UNCERTAIN','ACCEPTED'].includes(current.gateway_state))return false;
    const correlated=outcome&&outcome.notificationId===current.id&&Number.isSafeInteger(outcome.sequence)&&outcome.sequence>current.receipt_sequence&&
      (outcome.status==='NOT_FOUND'?current.gateway_state==='UNCERTAIN'&&current.provider_message_id===null:
       typeof outcome.messageId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(outcome.messageId)&&(!current.provider_message_id||current.provider_message_id===outcome.messageId));
    if(!correlated){await client.query("UPDATE notifications SET claim_token=NULL,claim_until=NULL,reconcile_after=now()+interval '5 minutes' WHERE org_id=$1 AND id=$2",[org.id,row.id]);return false;}
    if(outcome!.status==='NOT_FOUND'){
     await client.query(`UPDATE notifications SET gateway_state=CASE WHEN delivery_attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
      status=CASE WHEN delivery_attempts>=5 THEN 'FAILED' ELSE 'QUEUED' END,receipt_sequence=$3,claim_token=NULL,claim_until=NULL,next_attempt_at=now(),
      failure_code=CASE WHEN delivery_attempts>=5 THEN 'DELIVERY_ATTEMPTS_EXHAUSTED' ELSE NULL END,
      dead_lettered_at=CASE WHEN delivery_attempts>=5 THEN now() ELSE NULL END WHERE org_id=$1 AND id=$2`,[org.id,row.id,outcome!.sequence]);
     await client.query("UPDATE notification_delivery_attempts SET status='NOT_FOUND',settled_at=now() WHERE org_id=$1 AND notification_id=$2 AND status='UNCERTAIN'",[org.id,row.id]);return true;
    }
    const status=outcome!.status;const failure=['FAILED','BOUNCED'].includes(status);
    await client.query(`UPDATE notifications SET gateway_state=$3,provider_message_id=$4,receipt_sequence=$5,
     status=CASE WHEN $6::boolean THEN 'FAILED' WHEN read_at IS NOT NULL THEN 'READ' ELSE 'SENT' END,
     sent_at=COALESCE(sent_at,now()),claim_token=NULL,claim_until=NULL,reconcile_after=now()+interval '5 minutes',
     failure_code=CASE WHEN $6::boolean THEN 'PROVIDER_CONFIRMED_FAILURE' ELSE NULL END WHERE org_id=$1 AND id=$2`,[org.id,row.id,status,outcome!.messageId,outcome!.sequence,failure]);
    await client.query(`UPDATE notification_delivery_attempts SET status=$3,provider_message_id=COALESCE(provider_message_id,$4),settled_at=now()
     WHERE org_id=$1 AND notification_id=$2 AND status IN('SENDING','UNCERTAIN','ACCEPTED')`,[org.id,row.id,failure?'FAILED':status,outcome!.messageId]);
    // Terminal confirmations remain attributable independently of current notification status.
    if(status!=='ACCEPTED')await client.query(`INSERT INTO notification_delivery_receipts(id,org_id,notification_id,provider_message_id,sequence,outcome)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,notification_id,sequence) DO NOTHING`,[uuidv7(),org.id,row.id,outcome!.messageId,outcome!.sequence,status]);
    return true;
   });if(settled)result.resolved++;else result.pending++;}catch{result.pending++;}
  }
 }
 return result;
}
