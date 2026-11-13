import type {Pool} from 'pg';
import {uuidv7} from 'uuidv7';
import {readStorageCapacity} from '@tradecloseout/db';
const METRICS=['ACTIVE_PROJECTS','SEATS','STORAGE_BYTES'] as const;
/** Repair caches only. This never grants entitlements or rewrites monthly consumption. */
export async function reconcileUsageCounters(pool:Pool){
 const {rows:organisations}=await pool.query('SELECT id FROM organisations ORDER BY id');
 let repairedCounters=0,failedOrgs=0;
 for(const org of organisations){
  let failed=false;
  // Each metric has its own mutex/transaction. Never hold one capacity mutex
  // while waiting for another, or acquire project locks after a capacity mutex.
  for(const metric of METRICS){
   const client=await pool.connect();let destroy=false;
   try{
    await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='20s'");
    await client.query("SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)",[org.id]);
    await client.query(`INSERT INTO usage_counters(id,org_id,metric,period,value) VALUES($1,$2,$3,'ALL_TIME',0)
      ON CONFLICT(org_id,metric,period) DO NOTHING`,[uuidv7(),org.id,metric]);
    const {rows:[counter]}=await client.query("SELECT value::text FROM usage_counters WHERE org_id=$1 AND metric=$2 AND period='ALL_TIME' FOR UPDATE",[org.id,metric]);
    let value:string;
    if(metric==='STORAGE_BYTES')value=(await readStorageCapacity(client,org.id)).readyBytes.toString();
    else{
     const sql=metric==='SEATS'?"SELECT count(*)::text AS value FROM memberships WHERE org_id=$1 AND status='ACTIVE'":
      "SELECT count(*)::text AS value FROM projects WHERE org_id=$1 AND status IN('ACTIVE','HANDOVER','SUSPENDED') AND purged_at IS NULL";
     value=(await client.query(sql,[org.id])).rows[0].value;
    }
    const changed=counter.value!==value;
    if(changed)await client.query("UPDATE usage_counters SET value=$3::bigint,updated_at=now() WHERE org_id=$1 AND metric=$2 AND period='ALL_TIME'",[org.id,metric,value]);
    await client.query('COMMIT');if(changed)repairedCounters++;
   }catch{
    failed=true;try{await client.query('ROLLBACK');}catch{destroy=true;}
   }finally{client.release(destroy);}
  }
  if(failed)failedOrgs++;
 }
 return {scannedOrgs:organisations.length,repairedCounters,failedOrgs};
}
