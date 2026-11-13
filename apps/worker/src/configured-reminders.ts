import {Pool,PoolClient} from 'pg';
import {uuidv7} from 'uuidv7';
import {missingCurrentObligationSql} from '@tradecloseout/db';
import {isSupportedReminderSchedule} from '@tradecloseout/shared';
async function recipients(client:PoolClient,org:string,project:string,assignee?:string){
 const {rows}=await client.query(`SELECT m.user_id,m.role,pm.role AS project_role FROM memberships m
  JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
  LEFT JOIN project_members pm ON pm.org_id=m.org_id AND pm.user_id=m.user_id AND pm.project_id=$2 AND pm.status='ACTIVE'
  WHERE m.org_id=$1 AND m.status='ACTIVE' AND (m.role IN('R-OWNER','R-ADMIN') OR pm.id IS NOT NULL)
  AND (m.user_id=$3 OR pm.role='R-PM') ORDER BY m.user_id`,[org,project,assignee??null]);
 const assigned=rows.filter(r=>r.user_id===assignee);return assigned.length?assigned:rows.filter(r=>r.project_role==='R-PM');
}
/** Reviewed snapshot policy only; no inferred due dates or administrative warranty events. */
export async function enqueueConfiguredReminders(pool:Pool,now=new Date()):Promise<number>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const {rows:orgs}=await pool.query("SELECT id FROM organisations WHERE status='ACTIVE' ORDER BY id");let enqueued=0;
 for(const org of orgs){const client=await pool.connect();let destroy=false;try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)",[org.id]);
  const {rows:snapshots}=await client.query(`SELECT s.id,s.project_id,s.resolved_payload_json FROM checklist_snapshots s JOIN projects p ON p.org_id=s.org_id AND p.id=s.project_id
   WHERE s.org_id=$1 AND s.status='ACTIVE' AND p.status IN('ACTIVE','HANDOVER') AND p.purged_at IS NULL
   AND (EXISTS(SELECT 1 FROM project_baseline_approvals b WHERE b.org_id=s.org_id AND b.project_id=s.project_id AND b.snapshot_id=s.id AND b.checksum=s.checksum)
    OR EXISTS(SELECT 1 FROM requirement_change_requests cr WHERE cr.org_id=s.org_id AND cr.project_id=s.project_id AND cr.applied_snapshot_id=s.id
     AND cr.status='APPLIED' AND cr.approved_by<>cr.requested_by AND cr.proposed_checksum=s.checksum)) ORDER BY s.project_id` ,[org.id]);
  for(const snapshot of snapshots){const schedule=snapshot.resolved_payload_json['notifications.schedule'];if(!isSupportedReminderSchedule(schedule))continue;
   for(const rule of schedule){
    const {rows:work}=rule.event==='REQUIREMENT_DUE'?await client.query(`SELECT r.id,r.owner_user_id AS assignee,to_char((r.due_at AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD') AS due_day
     FROM requirements r WHERE r.org_id=$1 AND r.project_id=$2 AND r.current_snapshot_id=$3 AND r.due_at IS NOT NULL
     AND (r.due_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $4::date AND $4::date+$5::int AND ${missingCurrentObligationSql('r')}`,[org.id,snapshot.project_id,snapshot.id,day,rule.daysBefore]):
     await client.query(`SELECT a.id,NULL::uuid AS assignee,to_char(a.warranty_end,'YYYY-MM-DD') AS due_day FROM assets a WHERE a.org_id=$1 AND a.project_id=$2
      AND a.status='ACTIVE' AND a.deleted_at IS NULL AND a.warranty_end IS NOT NULL
      AND a.warranty_end BETWEEN $3::date AND $3::date+$4::int`,[org.id,snapshot.project_id,day,rule.daysBefore]);
    for(const item of work){const users=await recipients(client,org.id,snapshot.project_id,item.assignee);const due=item.due_day as string;
     for(const user of users){
      const category=rule.event==='WARRANTY_EXPIRING'?'WARRANTY':'WORK';
      const {rowCount}=await client.query(`INSERT INTO notifications(id,org_id,project_id,recipient_user_id,channel,event_key,payload_json,dedup_key,category,expires_at)
       SELECT $1,$2,$3,$4,'IN_APP',$5,$6,$7,$8,($9::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata'
       WHERE NOT EXISTS(SELECT 1 FROM notification_preferences pref WHERE pref.org_id=$2 AND pref.user_id=$4 AND pref.category=$8 AND pref.channel='IN_APP' AND pref.enabled=false)
       ON CONFLICT(org_id,dedup_key,channel,recipient_user_id,recipient_party_id) DO NOTHING`,[uuidv7(),org.id,snapshot.project_id,user.user_id,rule.event,
        JSON.stringify({templateVersion:1,obligationId:item.id,snapshotId:snapshot.id,dueDay:due}),`reminder:${rule.event}:${snapshot.id}:${item.id}:${due}:${rule.daysBefore}`,category,due]);enqueued+=rowCount??0;
     }
    }
   }
  }
  await client.query('COMMIT');
 }catch(error){try{await client.query('ROLLBACK');}catch{destroy=true;}throw error;}finally{client.release(destroy);}}
 return enqueued;
}
