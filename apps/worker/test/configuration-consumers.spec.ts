import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {seedTenants,scoped} from '../../../packages/db/test/helpers/fixtures';
import {enqueueConfiguredReminders} from '../src/configured-reminders';
import {claimNotificationBatch,resolveNotificationClaim} from '../src/notification-dispatch';
import {drawPackageBranding} from '../src/queues/package-branding';
import {assertConfiguredUploadPolicy,isSupportedReminderSchedule,packageOutputFilename} from '@tradecloseout/shared';

void test('configuration consumers validate filenames, upload ceilings and reminder vocabulary',()=>{
 assert.equal(packageOutputFilename('{projectCode}-v{version}','HVAC-01',3),'HVAC-01-v3.pdf');
 for(const pattern of ['../escape','{unknown}','name/child','..','*'])assert.throws(()=>packageOutputFilename(pattern,'HVAC-01',3),/UNSUPPORTED/);
 assert.throws(()=>assertConfiguredUploadPolicy({'security.max_file_size_bytes':0},1,'application/pdf'),/CONFIGURED_FILE_SIZE_LIMIT/);
 assert.throws(()=>assertConfiguredUploadPolicy({'security.allowed_mime_types':['application/pdf']},1,'image/png'),/CONFIGURED_FILE_TYPE_RESTRICTION/);
 assert.doesNotThrow(()=>assertConfiguredUploadPolicy({'security.max_file_size_bytes':10,'security.allowed_mime_types':['application/pdf']},10,'application/pdf'));
 assert.equal(isSupportedReminderSchedule([{event:'REQUIREMENT_DUE',daysBefore:3}]),true);
 for(const value of [[{event:'UNKNOWN',daysBefore:1}],[{event:'REQUIREMENT_DUE',daysBefore:-1}],[{event:'WARRANTY_EXPIRING',daysBefore:1,recipient:'untrusted'}]])assert.equal(isSupportedReminderSchedule(value),false);
});
void test('branding embeds a real bounded PNG and rejects excessive dimensions before embedding',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage(),font=await doc.embedFont(StandardFonts.Helvetica);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 await drawPackageBranding(doc,page,font,{brandColor:'#123456',footerText:'Synthetic footer',signatoryName:'Synthetic contact',logo:{bytes:png,mimeType:'image/png'}});
 const result=await doc.save();assert((await PDFDocument.load(result)).getPageCount()===1);assert(result.length>100);
 const bomb=Buffer.from(png);bomb.writeUInt32BE(100000,16);bomb.writeUInt32BE(100000,20);
 await assert.rejects(drawPackageBranding(doc,page,font,{logo:{bytes:bomb,mimeType:'image/png'}}),/PACKAGE_LOGO_DIMENSIONS_INVALID/);
});
void test('reviewed reminders obey IST windows, preferences, resumption, current due dates and pinned output provenance',async t=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId,tenants:[tenant]}=await seedTenants(admin),org=tenant.orgId,project=tenant.projectIds[0],snapshot=randomUUID(),reviewer=randomUUID();
  await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic reviewer','ACTIVE')",[reviewer]);
  for(const [user,role]of [[userId,'R-OWNER'],[reviewer,'R-ADMIN']])await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[randomUUID(),org,user,role]);
  await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by) VALUES($1,$2,$3,$4,'R-PM','ACTIVE',$4)",[randomUUID(),org,project,userId]);
  const payload={'notifications.schedule':[{event:'REQUIREMENT_DUE',daysBefore:3}],'naming.pattern':'{projectCode}-v{version}',requirements:[{key:'SYNTHETIC-RECORD'}]};
  const checksum=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await admin.query("INSERT INTO checklist_snapshots(id,org_id,project_id,version_no,status,resolved_payload_json,provenance_json,source_json,checksum,created_by) VALUES($1,$2,$3,1,'ACTIVE',$4,'{}','[]',$5,$6)",[snapshot,org,project,JSON.stringify(payload),checksum,userId]);
  // Synthetic approval isolates the scheduling mechanism; it is not HVAC acceptance.
  await admin.query("INSERT INTO project_baseline_approvals(id,org_id,project_id,snapshot_id,checksum,reviewer_user_id,reason) VALUES($1,$2,$3,$4,$5,$6,'Synthetic scheduling mechanics only')",[randomUUID(),org,project,snapshot,checksum,reviewer]);
  const req=randomUUID();
  await admin.query("INSERT INTO requirements(id,org_id,project_id,current_snapshot_id,requirement_key,scope_key,group_key,title,doc_type_key,mandatory,owner_user_id,due_at,status) VALUES($1,$2,$3,$4,'SYNTHETIC-RECORD','project','SYNTHETIC','Synthetic record','SYNTHETIC','true',$5,'2027-01-06T06:30:00Z','APPROVED')",[req,org,project,snapshot,userId]);
  await admin.query("INSERT INTO notification_preferences(id,org_id,user_id,category,channel,enabled) VALUES($1,$2,$3,'WORK','IN_APP',false)",[randomUUID(),org,userId]);
  const now=new Date('2027-01-03T18:30:00Z');
  await t.test('a status string supplies no evidence and disabled preferences prevent enqueue',async()=>{
   assert.equal(await enqueueConfiguredReminders(app,now),0);
   await admin.query("UPDATE notification_preferences SET enabled=true WHERE org_id=$1",[org]);
   assert.equal(await enqueueConfiguredReminders(app,now),1);assert.equal(await enqueueConfiguredReminders(app,now),0);
  });
  const notification=(await admin.query('SELECT * FROM notifications WHERE org_id=$1',[org])).rows[0];
  await t.test('suspension defers and resumption retains the existing immutable notification',async()=>{
   await admin.query("UPDATE projects SET status='SUSPENDED' WHERE id=$1",[project]);assert.equal((await claimNotificationBatch(app,org,false)).length,0);
   assert.equal((await admin.query('SELECT status FROM notifications WHERE id=$1',[notification.id])).rows[0].status,'QUEUED');
   await admin.query("UPDATE projects SET status='ACTIVE' WHERE id=$1",[project]);const claim=(await claimNotificationBatch(app,org,false))[0];assert.equal(claim.id,notification.id);
   assert.equal(await resolveNotificationClaim(app,claim,false),true);
  });
  await t.test('changed due dates retire obsolete reminders and NULL dates never produce a due reminder',async()=>{
   await admin.query('UPDATE requirements SET due_at=NULL WHERE id=$1',[req]);await admin.query('UPDATE notifications SET next_attempt_at=now() WHERE id=$1',[notification.id]);
   assert.equal((await claimNotificationBatch(app,org,false)).length,0);
   assert.equal((await admin.query('SELECT failure_code FROM notifications WHERE id=$1',[notification.id])).rows[0].failure_code,'NOTIFICATION_EXPIRED_OR_NO_LONGER_APPLICABLE');
   assert.equal(await enqueueConfiguredReminders(app,now),0);
  });
  await t.test('package output profile is captured once and never rewritten after profile edits',async()=>{
   await admin.query("INSERT INTO org_profiles(org_id,brand_color,footer_text,signatory_name) VALUES($1,'#123456','Original footer','Synthetic preparer')",[org]);
   const id=randomUUID();
   await scoped(app,org,async client=>{await client.query("INSERT INTO handover_packages(id,org_id,project_id,version_no,status,snapshot_id,snapshot_checksum,requested_by) VALUES($1,$2,$3,1,'DRAFT',$4,$5,$6)",[id,org,project,snapshot,checksum,userId]);});
   const original=(await admin.query('SELECT output_profile_json FROM handover_packages WHERE id=$1',[id])).rows[0].output_profile_json;
   assert.equal(original.footerText,'Original footer');assert.equal(original.namingPattern,'{projectCode}-v{version}');assert.equal(original.legalName,'Tenant A');
   await admin.query("UPDATE org_profiles SET footer_text='Changed footer' WHERE org_id=$1",[org]);
   assert.deepEqual((await admin.query('SELECT output_profile_json FROM handover_packages WHERE id=$1',[id])).rows[0].output_profile_json,original);
   await assert.rejects(scoped(app,org,c=>c.query("UPDATE handover_packages SET output_profile_json='{}' WHERE id=$1",[id])),/PACKAGE_OUTPUT_PROFILE_IMMUTABLE/);
  });
 });
});
