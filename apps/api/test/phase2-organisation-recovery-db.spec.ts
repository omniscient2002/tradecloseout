import {randomUUID,createHash} from 'crypto';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {seedTenants} from '../../../packages/db/test/helpers/fixtures';
import {OrganisationsService} from '../src/modules/organisations/organisations.service';
import {WorkAllocationService} from '../src/modules/organisations/work-allocation.service';
import {ProjectsService} from '../src/modules/projects/projects.service';
jest.setTimeout(180000);
it('pending submissions, emergency suspension and seat-aware reactivation preserve current authority and assignment history',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId:owner,tenants:[tenant]}=await seedTenants(admin),org=tenant.orgId,project=tenant.projectIds[0];
  const target=randomUUID(),qc=randomUUID(),ownerSession=randomUUID(),targetSession=randomUUID(),generation=randomUUID();
  for(const [user,role,name]of [[owner,'R-OWNER','Owner'],[target,'R-PM','Departing manager'],[qc,'R-QC','QC reviewer']]){
   if(user!==owner)await admin.query("INSERT INTO users(id,name,status) VALUES($1,$2,'ACTIVE')",[user,name]);
   await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[randomUUID(),org,user,role]);
  }
  for(const [id,user,gen]of [[ownerSession,owner,generation],[targetSession,target,randomUUID()]])await admin.query(`INSERT INTO sessions(id,user_id,active_org_id,auth_generation,token_hash,csrf_token_hash,expires_at,absolute_expires_at,mfa_verified,mfa_verified_at)
   VALUES($1,$2,$3,$4,$5,$5,now()+interval '1 day',now()+interval '1 day',true,now())`,[id,user,org,gen,createHash('sha256').update(id).digest('hex')]);
  await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by) VALUES($1,$2,$3,$4,'R-PM','ACTIVE',$5)",[randomUUID(),org,project,target,owner]);
  const submission=randomUUID();await admin.query("INSERT INTO submissions(id,org_id,project_id,status,created_by) VALUES($1,$2,$3,'DRAFT',$4)",[submission,org,project,target]);
  const ctx:any={orgId:org,userId:owner,actorType:'MEMBER',orgRole:'R-OWNER',sessionId:ownerSession,authGeneration:generation,requestId:randomUUID()};
  const service=new OrganisationsService(app),allocation=new WorkAllocationService(app);
  expect((await service.getOffboardingGapReport(ctx,org,target)).pendingSubmissionsCount).toBe(1);
  await expect(service.updateMemberRole(ctx,org,target,{role:'R-SITE'})).rejects.toMatchObject({response:expect.objectContaining({code:'ROLE_CHANGE_REQUIRES_RESPONSIBILITY_REVIEW'})});
  const manifest=await allocation.manifest(ctx,target);expect(manifest.items).toHaveLength(1);
  expect(manifest.items[0].eligibleReplacements.map((m:any)=>m.userId)).toContain(owner);
  expect(manifest.items[0].eligibleReplacements.map((m:any)=>m.userId)).not.toContain(qc);
  await expect(allocation.allocate(ctx,{targetUserId:target,requestKey:randomUUID(),reason:'Invalid replacement role',allocations:[{kind:'SUBMISSION',id:submission,rowVersion:1,replacementUserId:qc}]})).rejects.toThrow();
  await admin.query("UPDATE sessions SET mfa_verified_at=now()-interval '1 hour' WHERE id=$1",[ownerSession]);
  await expect(service.emergencySuspendMember(ctx,org,target,{reason:'Emergency access withdrawal'})).rejects.toThrow('FRESH_MFA_REQUIRED');
  expect((await admin.query('SELECT status FROM memberships WHERE org_id=$1 AND user_id=$2',[org,target])).rows[0].status).toBe('ACTIVE');
  await admin.query('UPDATE sessions SET mfa_verified_at=now() WHERE id=$1',[ownerSession]);
  await service.emergencySuspendMember(ctx,org,target,{reason:'Emergency access withdrawal'});
  expect((await admin.query('SELECT status FROM projects WHERE id=$1',[project])).rows[0].status).toBe('SUSPENDED');
  expect((await admin.query('SELECT status FROM project_members WHERE project_id=$1 AND user_id=$2',[project,target])).rows[0].status).toBe('REMOVED');
  expect((await admin.query('SELECT revoked_at FROM sessions WHERE id=$1',[targetSession])).rows[0].revoked_at).not.toBeNull();
  const suspended=(await admin.query('SELECT row_version FROM memberships WHERE org_id=$1 AND user_id=$2',[org,target])).rows[0];
  await expect(service.reactivateMember({...ctx,sessionId:undefined,authGeneration:undefined},org,target,suspended.row_version)).rejects.toThrow('FRESH_MFA_REQUIRED');
  const policy=randomUUID(),plan=randomUUID();
  // Synthetic policy/plan facts exercise capacity mechanics, not finance/provider acceptance.
  await admin.query("INSERT INTO billing_policy_versions(id,version,schema_version,status,grace_seconds,created_by_identity,reviewer_identity,approved_at,evidence_ref) VALUES($1::uuid,$1::text,1,'APPROVED',0,'synthetic-author','synthetic-independent-reviewer',now(),'https://example.invalid/synthetic-only')",[policy]);
  await admin.query("INSERT INTO plans(id,code,name,limits_json,price_paise,interval,status,policy_version_id) VALUES($1::uuid,$1::text,'Synthetic recovery plan',$2,0,'MONTH','ACTIVE',$3)",[plan,JSON.stringify({maxSeats:3,maxActiveProjects:2,maxStorageBytes:100,maxPackageGenerationsPerMonth:1}),policy]);
  await admin.query("INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day',now()+interval '1 day')",[randomUUID(),org,plan]);
  await service.reactivateMember(ctx,org,target,suspended.row_version);
  expect((await admin.query('SELECT status FROM memberships WHERE org_id=$1 AND user_id=$2',[org,target])).rows[0].status).toBe('ACTIVE');
  expect((await admin.query('SELECT status FROM project_members WHERE project_id=$1 AND user_id=$2',[project,target])).rows[0].status).toBe('REMOVED');
  expect((await admin.query('SELECT created_by,responsible_user_id FROM submissions WHERE id=$1',[submission])).rows[0]).toEqual({created_by:target,responsible_user_id:target});
  const fourth=randomUUID();await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Over-capacity member','ACTIVE')",[fourth]);await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-SITE','SUSPENDED')",[randomUUID(),org,fourth]);
  await expect(service.reactivateMember(ctx,org,fourth,1)).rejects.toMatchObject({response:expect.objectContaining({code:'SEAT_LIMIT_EXCEEDED'})});
  await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by) VALUES($1,$2,$3,$4,'R-PM','ACTIVE',$4)",[randomUUID(),org,project,owner]);
  await new ProjectsService(app).transitionProject({...ctx,idempotencyKey:randomUUID()},project,'RESUME',2,'New manager appointed explicitly');
  await allocation.allocate(ctx,{targetUserId:target,requestKey:randomUUID(),reason:'Explicit submission responsibility transfer',allocations:[{kind:'SUBMISSION',id:submission,rowVersion:1,replacementUserId:owner}]});
  expect((await service.getOffboardingGapReport(ctx,org,target)).pendingSubmissionsCount).toBe(0);
  expect((await admin.query('SELECT created_by FROM submissions WHERE id=$1',[submission])).rows[0].created_by).toBe(target);
 });
});
