import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {resolveEffectiveEntitlements} from '@tradecloseout/db/entitlements';
import {withTenantTransaction} from '@tradecloseout/db';
import {ProjectsService} from '../src/modules/projects/projects.service';
import {OrganisationsService} from '../src/modules/organisations/organisations.service';
import {uuidv7} from 'uuidv7';
import {createHash} from 'crypto';
jest.setTimeout(120000);
describe('Phase2 legacy migration and authenticated profile concurrency',()=>{
 test('preserves old contract facts/checksums while unapproved or malformed offers grant no new capacity and records remain readable',async()=>{
  const user=uuidv7(),org=uuidv7(),badOrg=uuidv7(),project=uuidv7(),price='1234567890123456';let checksums:any[]=[];
  await withDisposableDatabase(async({admin,app})=>{
   expect((await admin.query('SELECT name,checksum FROM schema_migrations WHERE name<=$1 ORDER BY name',['0048_phase2_ownership_write_boundary.sql'])).rows).toEqual(checksums);
   const context:any={orgId:org,userId:user,orgRole:'R-OWNER',actorType:'MEMBER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-legacy-upgrade'};
   const effective=await withTenantTransaction(app,context,c=>resolveEffectiveEntitlements(c,org));
   expect(effective.effectiveState).toBe('BILLING_POLICY_UNAPPROVED');expect(effective.canConsume).toBe(false);expect(effective.pricePaise).toBe(price);
   const bad=await withTenantTransaction(app,{...context,orgId:badOrg},c=>resolveEffectiveEntitlements(c,badOrg));
   expect(bad.effectiveState).toBe('PLAN_CONFIGURATION_INVALID');expect(bad.canConsume).toBe(false);
   const retained=await new ProjectsService(app).getProject(context,project);
   expect(retained.id).toBe(project);expect(String(retained.contract_value_paise)).toBe(price);
   expect((await admin.query('SELECT count(*)::int AS n FROM billing_policy_versions')).rows[0].n).toBe(0);
  },{baselineThrough:'0048_phase2_ownership_write_boundary.sql',beforeUpgrade:async admin=>{
   checksums=(await admin.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
   await admin.query("INSERT INTO users(id,name) VALUES($1,'Synthetic legacy owner')",[user]);
   for(const [o,limits]of [[org,{maxActiveProjects:1,maxSeats:1,maxStorageBytes:10,maxPackageGenerationsPerMonth:1}],[badOrg,{maxSeats:1}]] as const){
    const plan=uuidv7();await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Synthetic legacy','Synthetic legacy','MH')",[o]);
    await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[uuidv7(),o,user]);
    await admin.query("INSERT INTO plans(id,code,name,limits_json,price_paise,interval,status) VALUES($1,$2,'Legacy synthetic offer',$3,$4,'MONTH','ACTIVE')",[plan,plan,JSON.stringify(limits),price]);
    await admin.query("INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day',now()+interval '1 day')",[uuidv7(),o,plan]);
   }
   await admin.query("INSERT INTO projects(id,org_id,code,name,created_by,contract_value_paise) VALUES($1,$2,'LEGACY-AUDIT','Synthetic retained record',$3,$4)",[project,org,user,price]);
  }});
 });
 test('two authenticated profile writes serialize before shared authority locks and reject the stale version without a deadlock',async()=>{
  await withDisposableDatabase(async({admin,app})=>{
   const org=uuidv7(),user=uuidv7();await admin.query("INSERT INTO users(id,name) VALUES($1,'Synthetic profile owner')",[user]);
   await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Synthetic profile','Synthetic profile','MH')",[org]);
   await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[uuidv7(),org,user]);
   const contexts:any[]=[];
   for(let i=0;i<2;i++){
    const session=uuidv7(),generation=uuidv7(),hash=createHash('sha256').update(session).digest('hex');
    await admin.query(`INSERT INTO sessions(id,user_id,active_org_id,auth_generation,token_hash,csrf_token_hash,expires_at,absolute_expires_at,mfa_verified,mfa_verified_at)
      VALUES($1,$2,$3,$4,$5,$5,now()+interval '1 day',now()+interval '1 day',true,now())`,[session,user,org,generation,hash]);
    contexts.push({orgId:org,userId:user,orgRole:'R-OWNER',actorType:'MEMBER',sessionId:session,authGeneration:generation,requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-concurrency'});
   }
   const service=new OrganisationsService(app);
   const result=await Promise.allSettled(contexts.map((c,n)=>service.updateOrgProfile(c,1,{displayName:'Synthetic '+n})));
   expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);
   const rejected=result.find(x=>x.status==='rejected') as PromiseRejectedResult;
   expect(rejected.reason.response.code).toBe('PRECONDITION_FAILED');
   expect((await admin.query('SELECT row_version FROM organisations WHERE id=$1',[org])).rows[0].row_version).toBe(2);
   expect((await admin.query("SELECT count(*)::int AS n FROM audit_events WHERE org_id=$1 AND action='ORG_PROFILE_UPDATED'",[org])).rows[0].n).toBe(1);
  });
 });
});
