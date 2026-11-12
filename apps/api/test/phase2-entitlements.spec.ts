import {reserveActiveSeatForMembership} from '@tradecloseout/db';
import {evaluateEntitlements,parsePlanLimits,resolveEffectiveEntitlements,EntitlementRecord} from '@tradecloseout/db/entitlements';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {randomUUID} from 'crypto';
const limits={maxSeats:1,maxActiveProjects:2,maxStorageBytes:10,maxPackageGenerationsPerMonth:3};
const now=new Date('2026-11-12T00:00:00Z');
function row(p:Partial<EntitlementRecord>={}):EntitlementRecord{return {org_status:'ACTIVE',plan_status:'ACTIVE',policy_version:'SYNTHETIC-MECHANICS-ONLY',policy_status:'APPROVED',policy_approved_at:'2026-11-01',policy_grace_seconds:86400,id:randomUUID(),status:'ACTIVE',plan_id:randomUUID(),current_period_start:'2026-11-01',current_period_end:'2026-12-01',cancel_at:null,grace_until:null,limits_snapshot_json:limits,price_snapshot_paise:'0',interval_snapshot:'MONTH',plan_code_snapshot:'SYNTHETIC-MECHANICS',plan_name:'Synthetic mechanics only',snapshot_version:1,row_version:1,...p};}
describe('PH2 G18 effective entitlements',()=>{
 test.each([null,{},[],{...limits,maxSeats:'1'},{...limits,maxSeats:-1},{...limits,maxSeats:1.1},{...limits,maxSeats:Number.MAX_SAFE_INTEGER+1},{...limits,unknown:1}])('rejects malformed/partial limits %#',v=>expect(()=>parsePlanLimits(v)).toThrow('PLAN_CONFIGURATION_INVALID'));
 test('accepts zero as an actual bounded limit',()=>expect(parsePlanLimits({...limits,maxSeats:0}).maxSeats).toBe(0));
 test.each([
  [{id:null},'NO_SUBSCRIPTION',false], [{status:'TRIAL'},'TRIAL',true], [{status:'ACTIVE'},'ACTIVE',true],
  [{status:'PAST_DUE'},'PAST_DUE',false], [{status:'PAST_DUE',grace_until:'2026-12-02'},'PAST_DUE_GRACE',true],
  [{plan_status:'RETIRED'},'PLAN_INACTIVE',false], [{interval_snapshot:'ONE_TIME_PROJECT'},'PROJECT_OFFER_SCOPE_NOT_CONFIGURED',false], [{policy_status:'RETIRED'},'BILLING_POLICY_UNAPPROVED',false],
  [{policy_version:null},'BILLING_POLICY_UNAPPROVED',false], [{policy_status:'DRAFT'},'BILLING_POLICY_UNAPPROVED',false], [{policy_grace_seconds:0,status:'PAST_DUE',grace_until:'2026-12-02'},'PAST_DUE',false],
  [{status:'SUSPENDED'},'SUSPENDED',false], [{status:'CANCELLED'},'CANCELLED',false],
  [{current_period_end:now},'EXPIRED',false], [{current_period_start:'2026-11-13'},'PERIOD_NOT_STARTED',false],
  [{cancel_at:now},'CANCELLED',false], [{org_status:'SUSPENDED'},'ORGANISATION_INACTIVE',false],
 ] as const)('evaluates status and exact temporal boundary %#',(p,state,can)=>{const e=evaluateEntitlements(row(p),now);expect(e.effectiveState).toBe(state);expect(e.canConsume).toBe(can);expect(e.limits).toEqual(can?limits:{maxSeats:0,maxActiveProjects:0,maxStorageBytes:0,maxPackageGenerationsPerMonth:0});});
 test('pinning, publication immutability, RLS and final-seat serialization use actual PostgreSQL',async()=>{
  await withDisposableDatabase(async({admin,app})=>{
   const org=randomUUID(),otherOrg=randomUUID(),plan=randomUUID(),policy=randomUUID();
   await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Synthetic','Synthetic','MH'),($2,'Other','Other','MH')",[org,otherOrg]);
   // Synthetic approval rows isolate state-machine mechanics; no business approval is claimed.
   await admin.query("INSERT INTO billing_policy_versions(id,version,schema_version,status,grace_seconds,created_by_identity,reviewer_identity,approved_at,evidence_ref) VALUES($1,$2,1,'APPROVED',0,'synthetic-author','synthetic-independent-reviewer',now(),'https://example.invalid/synthetic-mechanics-only')",[policy,policy]);
   await admin.query("INSERT INTO plans(id,code,name,limits_json,price_paise,interval,status,policy_version_id) VALUES($1,$2,'Synthetic mechanics',$3,0,'MONTH','ACTIVE',$4)",[plan,plan,JSON.stringify(limits),policy]);
   await admin.query("INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day',now()+interval '1 day')",[randomUUID(),org,plan]);
   await expect(admin.query("UPDATE plans SET limits_json=$1 WHERE id=$2",[JSON.stringify({...limits,maxSeats:999}),plan])).rejects.toThrow('PUBLISHED_PLAN_IMMUTABLE');
   await expect(admin.query("UPDATE subscriptions SET limits_snapshot_json='{}' WHERE org_id=$1",[org])).rejects.toThrow('SUBSCRIPTION_OFFER_IMMUTABLE');
   async function tx<T>(work:(c:any)=>Promise<T>,tenant=org){const c=await app.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.current_org',$1,true)",[tenant]);const x=await work(c);await c.query('COMMIT');return x;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
   expect((await tx(c=>resolveEffectiveEntitlements(c,org))).limits).toEqual(limits);
   await expect(tx(c=>resolveEffectiveEntitlements(c,org),otherOrg)).rejects.toThrow('PLAN_ORGANISATION_NOT_FOUND');
   await expect(app.query("UPDATE billing_policy_versions SET status='RETIRED' WHERE id=$1",[policy])).rejects.toMatchObject({code:'42501'});
   expect((await tx<{rows:unknown[]}>(c=>c.query('SELECT * FROM lock_current_billing_policy($1)',[policy]),otherOrg)).rows).toEqual([]);
   const users=[randomUUID(),randomUUID()];for(const u of users)await admin.query("INSERT INTO users(id,name) VALUES($1,'Synthetic capacity')",[u]);
   const results=await Promise.allSettled(users.map(u=>tx(async c=>{const allocation=await reserveActiveSeatForMembership(c,org);if(allocation!=='RESERVED')throw new Error(allocation);await c.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-SITE','ACTIVE')",[randomUUID(),org,u]);})));
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
   expect((await admin.query('SELECT count(*)::int AS n FROM memberships WHERE org_id=$1',[org])).rows[0].n).toBe(1);
  });
 },90000);
});
