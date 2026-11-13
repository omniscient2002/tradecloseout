import {randomUUID,createHash} from 'crypto';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {seedTenants,scoped} from '../../../packages/db/test/helpers/fixtures';
import {ProjectOfferController} from '../src/modules/billing/project-offer.controller';
import {resolveEffectiveEntitlements} from '@tradecloseout/db/entitlements';
jest.setTimeout(180000);
it('one-project offer binding requires fresh authority and current reviewed policy, then scopes all consumption',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId,tenants:[tenant,other]}=await seedTenants(admin),org=tenant.orgId,project=tenant.projectIds[0],session=randomUUID(),generation=randomUUID();
  await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[randomUUID(),org,userId]);
  await admin.query(`INSERT INTO sessions(id,user_id,active_org_id,auth_generation,token_hash,csrf_token_hash,expires_at,absolute_expires_at,mfa_verified,mfa_verified_at)
   VALUES($1,$2,$3,$4,$5,$5,now()+interval '1 day',now()+interval '1 day',true,now())`,[session,userId,org,generation,createHash('sha256').update(session).digest('hex')]);
  const policy=randomUUID(),plan=randomUUID();
  // Synthetic approval exercises the binding mechanism; no finance acceptance is claimed.
  await admin.query("INSERT INTO billing_policy_versions(id,version,schema_version,status,grace_seconds,created_by_identity,reviewer_identity,approved_at,evidence_ref,one_time_project_model) VALUES($1::uuid,$1::text,1,'APPROVED',0,'synthetic-author','synthetic-reviewer',now(),'https://example.invalid/synthetic-mechanics','ORG_TEAM_AND_ONE_PROJECT')",[policy]);
  await admin.query("INSERT INTO plans(id,code,name,limits_json,price_paise,interval,status,policy_version_id) VALUES($1::uuid,$1::text,'Synthetic project offer',$2,0,'ONE_TIME_PROJECT','ACTIVE',$3)",[plan,JSON.stringify({maxSeats:10,maxActiveProjects:10,maxStorageBytes:1000,maxPackageGenerationsPerMonth:2}),policy]);
  await admin.query("INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day',now()+interval '1 day')",[randomUUID(),org,plan]);
  const userContext:any={orgId:org,userId,actorType:'MEMBER',orgRole:'R-OWNER',sessionId:session,authGeneration:generation,requestId:randomUUID()};
  const controller=new ProjectOfferController(app);
  await expect(controller.bind({userContext:{...userContext,sessionId:undefined,authGeneration:undefined}},{projectId:project,rowVersion:1})).rejects.toThrow('FRESH_MFA_REQUIRED');
  await expect(controller.bind({userContext},{projectId:other.projectIds[0],rowVersion:1})).rejects.toThrow('PROJECT_OFFER_TARGET_NOT_ELIGIBLE');
  const bound=await controller.bind({userContext},{projectId:project,rowVersion:1});expect(bound.scopeProjectId).toBe(project);
  expect(await controller.bind({userContext},{projectId:project,rowVersion:1})).toEqual(bound);
  await expect(controller.bind({userContext},{projectId:tenant.projectIds[1],rowVersion:2})).rejects.toThrow('PROJECT_OFFER_VERSION_OR_SCOPE_CONFLICT');
  expect((await scoped(app,org,c=>resolveEffectiveEntitlements(c,org,{projectId:project}))).canConsume).toBe(true);
  expect((await scoped(app,org,c=>resolveEffectiveEntitlements(c,org,{projectId:tenant.projectIds[1]}))).effectiveState).toBe('PROJECT_OFFER_SCOPE_MISMATCH');
  expect((await scoped(app,org,c=>resolveEffectiveEntitlements(c,org,{operation:'ORG_TEAM'}))).canConsume).toBe(true);
  await expect(scoped(app,org,c=>c.query('UPDATE subscriptions SET project_id=$2 WHERE org_id=$1',[org,tenant.projectIds[1]]))).rejects.toThrow('PROJECT_OFFER_BINDING_IMMUTABLE');
  await admin.query("UPDATE billing_policy_versions SET status='RETIRED' WHERE id=$1",[policy]);
  expect((await scoped(app,org,c=>resolveEffectiveEntitlements(c,org,{projectId:project}))).canConsume).toBe(false);
 });
});
