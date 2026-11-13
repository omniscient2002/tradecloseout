import {randomUUID,createHmac} from 'crypto';
import {NotificationPublicController} from '../src/modules/notifications/notification-public.controller';
import {WorkAllocationService} from '../src/modules/organisations/work-allocation.service';
import {OrganisationsService} from '../src/modules/organisations/organisations.service';
import {openDisposableDatabaseForSuite} from '../../../packages/db/test/helpers/disposable-database';
import {seedTenants} from '../../../packages/db/test/helpers/fixtures';
import {ProjectsService} from '../src/modules/projects/projects.service';
import {ChecklistsService} from '../src/modules/checklists/checklists.service';
import {ConfigurationService} from '../src/modules/configuration/configuration.service';
import {NotificationsService} from '../src/modules/notifications/notifications.service';
import {TenantDbService} from '../src/database/tenant-db.service';
import {OrganisationAdministrationService} from '../src/modules/organisations/organisation-administration.service';
import {parseLifecycleInput} from '../src/modules/projects/project-lifecycle-input';
jest.setTimeout(180000);
describe('Phase 2 implementation workflows using restricted PostgreSQL',()=>{
 let db:Awaited<ReturnType<typeof openDisposableDatabaseForSuite>>,owner:any,reviewer:any,org:string,other:string,project:string,draft:string;
 let projects:ProjectsService,checklists:ChecklistsService,configuration:ConfigurationService,notifications:NotificationsService;
 beforeAll(async()=>{
  db=await openDisposableDatabaseForSuite();const fixtures=await seedTenants(db.admin);
  org=fixtures.tenants[0].orgId;other=fixtures.tenants[1].orgId;[project,draft]=fixtures.tenants[0].projectIds;
  const reviewerId=randomUUID();await db.admin.query("INSERT INTO users(id,name,status) VALUES($1,'Independent synthetic reviewer','ACTIVE')",[reviewerId]);
  for(const [user,role]of [[fixtures.userId,'R-OWNER'],[reviewerId,'R-ADMIN']])await db.admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[randomUUID(),org,user,role]);
  owner={orgId:org,userId:fixtures.userId,actorType:'MEMBER',orgRole:'R-OWNER',requestId:randomUUID()};reviewer={...owner,userId:reviewerId,orgRole:'R-ADMIN'};
  await db.admin.query("UPDATE projects SET status='DRAFT' WHERE id=$1",[draft]);
  projects=new ProjectsService(db.app);checklists=new ChecklistsService(db.app);configuration=new ConfigurationService(db.app,checklists);notifications=new NotificationsService(new TenantDbService(db.app));
 });
 afterAll(async()=>{await db?.close();});
 test('lifecycle requires version/reason, retries replay once, conflicting identities and stale writes reject',async()=>{
  expect(()=>parseLifecycleInput({expectedRowVersion:1,reason:'x'},true)).toThrow();
  expect(()=>parseLifecycleInput({expectedRowVersion:1,closureDate:'2026-02-30'},false,true)).toThrow();
  const ctx={...owner,idempotencyKey:randomUUID()};
  const first=await projects.suspendProject(ctx,project,1,'Pause while responsibility is reviewed');
  expect(first.status).toBe('SUSPENDED');expect(first.row_version).toBe(2);
  expect(await projects.suspendProject(ctx,project,1,'Pause while responsibility is reviewed')).toEqual(first);
  await expect(projects.suspendProject(ctx,project,1,'Different reason for same request')).rejects.toMatchObject({response:expect.objectContaining({code:'LIFECYCLE_IDEMPOTENCY_CONFLICT'})});
  await expect(projects.transitionProject({...owner,idempotencyKey:randomUUID()},project,'CANCEL',1,'Cancel outstanding work')).rejects.toMatchObject({response:expect.objectContaining({code:'PRECONDITION_FAILED'})});
  const canceled=await projects.transitionProject({...owner,idempotencyKey:randomUUID()},project,'CANCEL',2,'Cancel outstanding work');expect(canceled.status).toBe('CANCELLED');
  const archived=await projects.transitionProject({...owner,idempotencyKey:randomUUID()},project,'ARCHIVE',3,'Retain cancelled history');expect(archived.status).toBe('ARCHIVED');
  expect((await db.admin.query('SELECT count(*)::int AS n FROM project_lifecycle_commands WHERE project_id=$1',[project])).rows[0].n).toBe(3);
  await expect(projects.transitionProject({...owner,orgId:other,idempotencyKey:randomUUID()},project,'ARCHIVE',4,'Cross tenant request')).rejects.toThrow();
 });
 test('persisted draft publication and baseline review are independent; active changes require an approved exact proposal',async()=>{
  const requirement={key:'SYNTHETIC-MECHANICS',title:'Synthetic contract record',groupKey:'SYNTHETIC',docTypeKey:'SYNTHETIC-EXPLICIT',mandatory:false,scopeType:'PROJECT',reviewerRole:'R-QC'};
  const version=await configuration.createVersion(owner,{level:'PROJECT',scopeId:draft,payload:{requirements:[requirement]}});
  await expect(configuration.publish(owner,version.id)).rejects.toThrow('CONFIGURATION_SELF_PUBLICATION_FORBIDDEN');
  await expect(configuration.apply(owner,draft,{versionIds:[version.id],reason:'Apply unreviewed version'})).rejects.toThrow('CONFIGURATION_VERSION_NOT_PUBLISHED');
  await configuration.publish(reviewer,version.id);
  const baseline=await configuration.apply(owner,draft,{versionIds:[version.id],reason:'Synthetic mechanics only'});
  await expect(checklists.reviewBaseline(owner,draft,{snapshotId:baseline.snapshotId,checksum:baseline.checksum,reason:'Self review attempt'})).rejects.toThrow('BASELINE_SELF_REVIEW_FORBIDDEN');
  expect(await checklists.reviewBaseline(reviewer,draft,{snapshotId:baseline.snapshotId,checksum:baseline.checksum,reason:'Synthetic independent mechanics review'})).toMatchObject({reviewed:true});
  // Fixture transition isolates change control; it is not real HVAC activation acceptance.
  await db.admin.query("UPDATE projects SET status='ACTIVE' WHERE id=$1",[draft]);
  const next=await configuration.createVersion(owner,{level:'PROJECT',scopeId:draft,parentVersionId:version.id,payload:{requirements:[{...requirement,title:'Updated synthetic record'}]}});await configuration.publish(reviewer,next.id);
  await expect(configuration.apply(owner,draft,{versionIds:[next.id],reason:'Bypass change control'})).rejects.toMatchObject({response:expect.objectContaining({code:'APPROVED_BASELINE_CHANGE_REQUIRED'})});
  const proposal=await configuration.proposeChange(owner,draft,{versionIds:[next.id],baselineSnapshotId:baseline.snapshotId,reason:'Update synthetic scope'});
  await expect(checklists.decideChangeRequest(owner,proposal.id,{decision:'APPROVED'})).rejects.toThrow();
  await checklists.decideChangeRequest(reviewer,proposal.id,{decision:'APPROVED',comment:'Independent review'});
  const applied=await checklists.applyChangeRequest(owner,draft,proposal.id);expect(applied.snapshotId).not.toBe(baseline.snapshotId);
  expect(await checklists.applyChangeRequest(owner,draft,proposal.id)).toMatchObject({snapshotId:applied.snapshotId,unchanged:true});
  const {rows:[original]}=await db.admin.query('SELECT status,resolved_payload_json FROM checklist_snapshots WHERE id=$1',[baseline.snapshotId]);
  expect(original.status).toBe('SUPERSEDED');expect(original.resolved_payload_json.requirements[0].title).toBe(requirement.title);
 });
 test('inbox projection, pagination, read state, preferences and unsubscribe retain current recipient isolation',async()=>{
  const user={...owner,actorType:'USER'};const system={...user,actorType:'SYSTEM'};
  const first=await notifications.createNotification(system,{channel:'IN_APP',eventKey:'REQUIREMENT_CHANGED',dedupKey:randomUUID(),payload:{internalSecret:'NEVER_RETURN',amountPaise:'99999'}});
  await notifications.createNotification(system,{channel:'IN_APP',eventKey:'REQUIREMENT_CHANGED',dedupKey:randomUUID(),payload:{message:'second'}});
  const page=await notifications.inbox(user,1);expect(page.items).toHaveLength(1);expect(page.nextCursor).toBeTruthy();expect(page.unreadCount).toBe(2);expect(JSON.stringify(page)).not.toContain('NEVER_RETURN');
  const next=await notifications.inbox(user,1,page.nextCursor!);expect(next.items[0].id).not.toBe(page.items[0].id);
  await notifications.markRead(user,first.notification.id);await notifications.markRead(user,first.notification.id);expect((await notifications.inbox(user)).unreadCount).toBe(1);
  await expect(notifications.markRead({...user,userId:reviewer.userId},first.notification.id)).rejects.toThrow('NOTIFICATION_NOT_FOUND');
  const pref=await notifications.updatePreference(user,{category:'WORK',channel:'EMAIL',enabled:false,digest:'IMMEDIATE',rowVersion:0});expect(pref.row_version).toBe(1);
  await expect(notifications.updatePreference(user,{category:'WORK',channel:'EMAIL',enabled:true,digest:'IMMEDIATE',rowVersion:0})).rejects.toThrow('NOTIFICATION_PREFERENCE_STALE');
  await expect(notifications.updatePreference(user,{category:'SECURITY',channel:'EMAIL',enabled:false,digest:'IMMEDIATE',rowVersion:0})).rejects.toThrow('NOTIFICATION_PREFERENCE_INVALID');
  const before=process.env.NOTIFICATION_UNSUBSCRIBE_KEY;process.env.NOTIFICATION_UNSUBSCRIBE_KEY='synthetic-test-key-only-not-a-provider-credential';
  try{const {url}=await notifications.unsubscribeLink(user,'WARRANTY');const token=new URL(url).searchParams.get('token');await expect(notifications.unsubscribe(token+'forged')).rejects.toThrow('UNSUBSCRIBE_LINK_INVALID');expect(await notifications.unsubscribe(token)).toEqual({unsubscribed:true});}finally{if(before===undefined)delete process.env.NOTIFICATION_UNSUBSCRIBE_KEY;else process.env.NOTIFICATION_UNSUBSCRIBE_KEY=before;}
 });
 test('onboarding resumes with concurrency control and rejects fake reviewed templates or missing deletion MFA',async()=>{
  const service=new OrganisationAdministrationService(db.app);const first=await service.onboarding(owner);expect(first.progress.row_version).toBe(0);
  const saved=await service.saveOnboarding(owner,{step:1,rowVersion:0});expect(saved.row_version).toBe(1);
  await expect(service.saveOnboarding(owner,{step:2,rowVersion:0})).rejects.toThrow('ONBOARDING_VERSION_STALE');
  await expect(service.saveOnboarding(owner,{step:4,rowVersion:1})).rejects.toThrow('ONBOARDING_CONSENT_AND_TEMPLATE_REQUIRED');
  await expect(service.saveOnboarding(owner,{step:2,rowVersion:1,templatePackId:randomUUID()})).rejects.toThrow('REVIEWED_TEMPLATE_REQUIRED');
  await expect(service.requestDeletion(owner,{requestKey:randomUUID(),rowVersion:1,confirmedName:'Tenant A',reason:'Synthetic request testing only'})).rejects.toThrow();
  expect((await db.admin.query('SELECT count(*)::int AS n FROM organisation_deletion_requests')).rows[0].n).toBe(0);
 });
 test('signed delivery receipts correlate provider identity and preserve read state',async()=>{
  const service=new NotificationPublicController(notifications,new TenantDbService(db.app));
  const notice=await notifications.createNotification({...owner,actorType:'SYSTEM'},{channel:'EMAIL',eventKey:'REQUIREMENT_CHANGED',dedupKey:randomUUID(),payload:{}});
  await db.admin.query("UPDATE notifications SET provider_message_id='synthetic-provider-id',gateway_state='ACCEPTED',status='SENT',read_at=now() WHERE id=$1",[notice.notification.id]);
  const before=process.env.NOTIFICATION_DELIVERY_CALLBACK_KEY;const key='synthetic-receipt-key-only-not-a-provider-credential';process.env.NOTIFICATION_DELIVERY_CALLBACK_KEY=key;
  const make=(value:unknown)=>{const rawBody=Buffer.from(typeof value==='string'?value:JSON.stringify(value)),timestamp=String(Math.floor(Date.now()/1000));return {rawBody,headers:{'x-notification-timestamp':timestamp,'x-notification-signature':createHmac('sha256',key).update(timestamp+'.').update(rawBody).digest('hex')}};};
  try{
   await expect(service.receipt(make('{bad json'))).rejects.toThrow('NOTIFICATION_RECEIPT_INVALID');
   const value={eventId:randomUUID(),orgId:org,notificationId:notice.notification.id,messageId:'synthetic-provider-id',sequence:1,status:'DELIVERED'};
   await expect(service.receipt(make({...value,messageId:'wrong-provider'}))).rejects.toThrow('NOTIFICATION_RECEIPT_UNCORRELATED');
   expect(await service.receipt(make(value))).toEqual({recorded:true});expect(await service.receipt(make(value))).toEqual({recorded:true});
   await expect(service.receipt(make({...value,status:'FAILED'}))).rejects.toThrow('NOTIFICATION_RECEIPT_REPLAY_CONFLICT');
   expect((await db.admin.query('SELECT status,gateway_state FROM notifications WHERE id=$1',[notice.notification.id])).rows[0]).toEqual({status:'READ',gateway_state:'DELIVERED'});
   expect((await db.admin.query('SELECT count(*)::int AS n FROM notification_delivery_receipts WHERE notification_id=$1',[notice.notification.id])).rows[0].n).toBe(1);
  }finally{if(before===undefined)delete process.env.NOTIFICATION_DELIVERY_CALLBACK_KEY;else process.env.NOTIFICATION_DELIVERY_CALLBACK_KEY=before;}
 });
 test('role changes remove old project grants and return only participant ownership intents',async()=>{
  const service=new OrganisationsService(db.app);const user=randomUUID();
  await db.admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic role transition','ACTIVE')",[user]);
  await db.admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-SITE','ACTIVE')",[randomUUID(),org,user]);
  await db.admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by) VALUES($1,$2,$3,$4,'R-SITE','ACTIVE',$5)",[randomUUID(),org,project,user,owner.userId]);
  await service.updateMemberRole(owner,org,user,{role:'R-QC'});
  expect((await db.admin.query('SELECT status FROM project_members WHERE org_id=$1 AND user_id=$2',[org,user])).rows[0].status).toBe('REMOVED');
  expect(await service.listOwnershipTransfers({...owner,userId:user,orgRole:'R-QC'})).toEqual([]);
 });

 test('explicit per-work allocation is atomic, versioned, replay-safe and preserves submission authorship',async()=>{
  const service=new WorkAllocationService(db.app);const departing=randomUUID(),req=randomUUID(),submission=randomUUID();
  await db.admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic departing operator','ACTIVE')",[departing]);
  await db.admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-PM','ACTIVE')",[randomUUID(),org,departing]);
  await db.admin.query("INSERT INTO requirements(id,org_id,project_id,current_snapshot_id,requirement_key,title,doc_type_key,scope_key,mandatory,owner_user_id,group_key) VALUES($1,$2,$3,(SELECT id FROM checklist_snapshots WHERE org_id=$2 AND project_id=$3 AND status='ACTIVE'),'ALLOCATION','Synthetic allocation','SYNTHETIC','project',false,$4,'SYNTHETIC')",[req,org,draft,departing]);
  await db.admin.query("INSERT INTO submissions(id,org_id,project_id,created_by,status) VALUES($1,$2,$3,$4,'DRAFT')",[submission,org,draft,departing]);
  const manifest=await service.manifest(owner,departing);expect(manifest.items).toHaveLength(2);
  const command={targetUserId:departing,requestKey:randomUUID(),reason:'Distribute synthetic responsibilities',allocations:manifest.items.map(w=>({kind:w.kind,id:w.id,replacementUserId:reviewer.userId,rowVersion:w.row_version}))};
  await expect(service.allocate(owner,{...command,allocations:command.allocations.map((a,i)=>({...a,rowVersion:i===0?99:a.rowVersion}))})).rejects.toThrow('WORK_ALLOCATION_MANIFEST_STALE');
  expect((await db.admin.query('SELECT owner_user_id FROM requirements WHERE id=$1',[req])).rows[0].owner_user_id).toBe(departing);
  const result=await service.allocate(owner,command);expect(result.allocated).toBe(2);expect(result.remaining).toEqual([]);expect(await service.allocate(owner,command)).toEqual(result);
  expect((await db.admin.query('SELECT created_by,responsible_user_id FROM submissions WHERE id=$1',[submission])).rows[0]).toEqual({created_by:departing,responsible_user_id:reviewer.userId});
 });

});
