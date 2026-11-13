import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {seedTenants} from '../../../packages/db/test/helpers/fixtures';
import {reconcileUsageCounters} from '../src/usage-reconciliation';
void test('usage reconciliation repairs canonical caches, preserves reservation/period semantics and isolates failures',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId,tenants:[a,b]}=await seedTenants(admin);
  await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[randomUUID(),a.orgId,userId]);
  await admin.query("UPDATE projects SET status='CLOSED' WHERE org_id=$1",[b.orgId]);
  for(const [status,size]of [['READY',100],['PENDING',200],['PROCESSING',300],['FAILED',400]] as const)
   await admin.query("INSERT INTO storage_objects(id,org_id,bucket,object_key,mime,size_bytes,sha256,status) VALUES($1::uuid,$2,'synthetic-usage',$1::text,'application/pdf',$3,$4,$5)",[randomUUID(),a.orgId,size,'a'.repeat(64),status]);
  for(const tenant of [a,b])for(const metric of ['ACTIVE_PROJECTS','SEATS','STORAGE_BYTES','PACKAGES_MONTH'])
   await admin.query("INSERT INTO usage_counters(id,org_id,metric,period,value) VALUES($1,$2,$3,$4,999)",[randomUUID(),tenant.orgId,metric,metric==='PACKAGES_MONTH'?'2030-01':'ALL_TIME']);
  assert.deepEqual(await reconcileUsageCounters(app),{scannedOrgs:2,repairedCounters:6,failedOrgs:0});
  const counters=(await admin.query("SELECT metric,value::text FROM usage_counters WHERE org_id=$1 ORDER BY metric",[a.orgId])).rows;
  assert.deepEqual(Object.fromEntries(counters.map(row=>[row.metric,row.value])),{ACTIVE_PROJECTS:'2',SEATS:'1',STORAGE_BYTES:'100',PACKAGES_MONTH:'999'});
  assert.equal((await admin.query("SELECT sum(size_bytes)::text AS n FROM storage_objects WHERE org_id=$1 AND status IN('PENDING','PROCESSING')",[a.orgId])).rows[0].n,'500');
  assert.equal((await reconcileUsageCounters(app)).repairedCounters,0);
  await admin.query('UPDATE usage_counters SET value=777 WHERE metric IN(\'ACTIVE_PROJECTS\',\'SEATS\',\'STORAGE_BYTES\')');
  await admin.query(`CREATE FUNCTION synthetic_usage_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id='${b.orgId}'::uuid THEN RAISE EXCEPTION 'SYNTHETIC_USAGE_FAILURE'; END IF;RETURN NEW;END $$`);
  await admin.query('CREATE TRIGGER synthetic_usage_failure BEFORE UPDATE ON usage_counters FOR EACH ROW EXECUTE FUNCTION synthetic_usage_failure()');
  assert.deepEqual(await reconcileUsageCounters(app),{scannedOrgs:2,repairedCounters:3,failedOrgs:1});
  assert.equal((await admin.query("SELECT value::text FROM usage_counters WHERE org_id=$1 AND metric='SEATS'",[a.orgId])).rows[0].value,'1');
  assert.equal((await admin.query("SELECT value::text FROM usage_counters WHERE org_id=$1 AND metric='SEATS'",[b.orgId])).rows[0].value,'777');
  await admin.query('DROP TRIGGER synthetic_usage_failure ON usage_counters');
  assert.equal((await reconcileUsageCounters(app)).failedOrgs,0);
 });
});
