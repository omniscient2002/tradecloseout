import type {Pool,PoolClient} from 'pg';
import {uuidv7} from 'uuidv7';
import type {ClaimedOutboxEvent} from './outbox-dispatch';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIREMENT_EVENTS=new Set(['REQUIREMENT_PENDING','REQUIREMENT_IN_REVIEW','REQUIREMENT_APPROVED','REQUIREMENT_REJECTED','REQUIREMENT_WAIVED']);
const SUBMISSION_EVENTS=new Set(['SUBMISSION_SENT','SUBMISSION_SUBMITTED','SUBMISSION_ACKNOWLEDGED','SUBMISSION_ACCEPTED','SUBMISSION_PARTIALLY_ACCEPTED','SUBMISSION_REJECTED','SUBMISSION_AGGREGATED_ACCEPTED','SUBMISSION_AGGREGATED_PARTIALLY_ACCEPTED','SUBMISSION_AGGREGATED_REJECTED']);
const PROJECT_EVENTS=new Set(['PROJECT_ACTIVATED','PROJECT_SUSPENDED','PROJECT_RESUMED','PROJECT_CLOSED','PROJECT_REOPENED','PROJECT_HANDOVER_INITIATED','BASELINE_CHANGE_REQUESTED']);
const REVIEW_EVENTS=new Set(['DOCUMENT_SUBMITTED_FOR_REVIEW','DOCUMENT_REVIEW_DECIDED','EXTERNAL_APPROVAL_RECORDED']);
async function recipientIds(client:PoolClient,event:ClaimedOutboxEvent,body:Record<string,unknown>):Promise<string[]>{
 const entity=typeof body.entityId==='string'&&UUID.test(body.entityId)?body.entityId:null;
 if(event.event_type==='OWNERSHIP_TRANSFER_REQUESTED'){
  const id=typeof body.intentId==='string'&&UUID.test(body.intentId)?body.intentId:null;
  return(await client.query("SELECT recipient_user_id AS user_id FROM ownership_transfer_intents WHERE org_id=$1 AND id=$2 AND status='PENDING' AND expires_at>now()",[event.org_id,id])).rows.map(r=>r.user_id);
 }
 if(!event.project_id)return [];
 if(REQUIREMENT_EVENTS.has(event.event_type))return(await client.query('SELECT owner_user_id AS user_id FROM requirements WHERE org_id=$1 AND project_id=$2 AND id=$3 AND superseded_at IS NULL',[event.org_id,event.project_id,entity])).rows.map(r=>r.user_id).filter(Boolean);
 if(SUBMISSION_EVENTS.has(event.event_type))return(await client.query('SELECT responsible_user_id AS user_id FROM submissions WHERE org_id=$1 AND project_id=$2 AND id=$3',[event.org_id,event.project_id,entity])).rows.map(r=>r.user_id).filter(Boolean);
 if(event.event_type==='HANDOVER_PACKAGE_QUEUED'||event.event_type==='HANDOVER_PACKAGE_READY'){
  const id=typeof body.packageId==='string'&&UUID.test(body.packageId)?body.packageId:entity;
  return(await client.query('SELECT responsible_user_id AS user_id FROM handover_packages WHERE org_id=$1 AND project_id=$2 AND id=$3',[event.org_id,event.project_id,id])).rows.map(r=>r.user_id).filter(Boolean);
 }
 if(REVIEW_EVENTS.has(event.event_type)){
  const version=typeof body.documentVersionId==='string'&&UUID.test(body.documentVersionId)?body.documentVersionId:body.entityType==='DOCUMENT_VERSION'?entity:null;
  if(['DOCUMENT_REVIEW_DECIDED','EXTERNAL_APPROVAL_RECORDED'].includes(event.event_type))return(await client.query('SELECT uploaded_by AS user_id FROM document_versions WHERE org_id=$1 AND project_id=$2 AND id=$3',[event.org_id,event.project_id,version])).rows.map(r=>r.user_id).filter(Boolean);
  return(await client.query(`SELECT DISTINCT rv.reviewer_user_id AS user_id FROM reviews rv JOIN document_versions dv
   ON dv.org_id=rv.org_id AND dv.project_id=rv.project_id AND dv.id=rv.document_version_id
   WHERE rv.org_id=$1 AND rv.project_id=$2 AND rv.document_version_id=$3 AND rv.status IN('PENDING','IN_REVIEW')
    AND ($4::uuid IS NULL OR rv.id=$4)
    AND rv.reviewer_subject_type='USER' AND rv.method='IN_APP' AND rv.reviewer_user_id<>dv.uploaded_by`,[event.org_id,event.project_id,version,body.entityType==='REVIEW'?entity:null])).rows.map(r=>r.user_id).filter(Boolean);
 }
 if(PROJECT_EVENTS.has(event.event_type))return(await client.query(`SELECT m.user_id FROM memberships m LEFT JOIN project_members pm ON pm.org_id=m.org_id AND pm.user_id=m.user_id AND pm.project_id=$2 AND pm.status='ACTIVE'
  WHERE m.org_id=$1 AND m.status='ACTIVE' AND (m.role IN('R-OWNER','R-ADMIN') OR pm.role='R-PM')`,[event.org_id,event.project_id])).rows.map(r=>r.user_id);
 return [];
}
/** Native inbox projection only. External messages need their separately approved channel template. */
export async function projectBusinessEventNotifications(pool:Pool,event:ClaimedOutboxEvent):Promise<number>{
 if(!REQUIREMENT_EVENTS.has(event.event_type)&&!SUBMISSION_EVENTS.has(event.event_type)&&!PROJECT_EVENTS.has(event.event_type)&&!REVIEW_EVENTS.has(event.event_type)&&!['OWNERSHIP_TRANSFER_REQUESTED','HANDOVER_PACKAGE_QUEUED','HANDOVER_PACKAGE_READY'].includes(event.event_type))return 0;
 if(!UUID.test(event.id)||!UUID.test(event.org_id)||event.project_id!==null&&!UUID.test(event.project_id))throw new Error('OUTBOX_EVENT_INVALID');
 if(!event.payload_json||typeof event.payload_json!=='object'||Array.isArray(event.payload_json))throw new Error('OUTBOX_EVENT_INVALID');
 const client=await pool.connect();let destroy=false;try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)",[event.org_id]);
  if(!(await client.query("SELECT id FROM organisations WHERE id=$1 AND status='ACTIVE' FOR SHARE",[event.org_id])).rows.length){await client.query('COMMIT');return 0;}
  const targets=[...new Set(await recipientIds(client,event,event.payload_json as Record<string,unknown>))].sort();let count=0;
  for(const target of targets){
   const {rows}=await client.query(`SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
    WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' FOR SHARE OF m,u`,[event.org_id,target]);if(!rows.length)continue;
   if(event.project_id){
    const {rows:projects}=await client.query("SELECT id FROM projects WHERE org_id=$1 AND id=$2 AND purged_at IS NULL AND status NOT IN('CANCELLED','ARCHIVED') FOR SHARE",[event.org_id,event.project_id]);if(!projects.length)continue;
    if(!['R-OWNER','R-ADMIN'].includes(rows[0].role)&&!(await client.query("SELECT id FROM project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",[event.org_id,event.project_id,target])).rows.length)continue;
   }
   const essential=event.event_type==='OWNERSHIP_TRANSFER_REQUESTED';
   const {rowCount}=await client.query(`INSERT INTO notifications(id,org_id,project_id,recipient_user_id,channel,event_key,payload_json,dedup_key,category,status,gateway_state,sent_at)
    SELECT $1,$2,$3,$4,'IN_APP',$5,$6,$7,$8,'SENT','DELIVERED',now() WHERE $9::boolean OR NOT EXISTS(SELECT 1 FROM notification_preferences p
      WHERE p.org_id=$2 AND p.user_id=$4 AND p.category=$8 AND p.channel='IN_APP' AND p.enabled=false)
    ON CONFLICT(org_id,dedup_key,channel,recipient_user_id,recipient_party_id) DO NOTHING`,[uuidv7(),event.org_id,event.project_id,target,event.event_type,
     JSON.stringify({templateVersion:1,sourceEventId:event.id}),`event:${event.id}`,essential?'SECURITY':'WORK',essential]);count+=rowCount??0;
  }
  await client.query('COMMIT');return count;
 }catch(error){try{await client.query('ROLLBACK');}catch{destroy=true;}throw error;}finally{client.release(destroy);}
}
