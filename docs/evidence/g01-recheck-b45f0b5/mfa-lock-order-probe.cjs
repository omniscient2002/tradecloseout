const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {createHash,createHmac,randomUUID} = require('node:crypto');
const {Pool} = require('pg');
const {MfaController} = require('/candidate/apps/api/src/modules/identity/mfa.controller.ts');
const {encryptFactor} = require('/candidate/apps/api/src/modules/identity/mfa-crypto.ts');
const adminUrl='postgres://postgres:review_disposable_pw@127.0.0.1:5432/tc_review_mfa_b45f0b5';
const appUrl='postgres://tc_app:app_local_pw@127.0.0.1:5432/tc_review_mfa_b45f0b5';
const digest=x=>createHash('sha256').update(x).digest('hex');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function result(p){return p.then(()=>({status:'fulfilled'}),e=>({status:'rejected',sqlstate:e.code??null,http_status:e.getStatus?.()??null,message:e.code==='40P01'?'deadlock detected':e.response?.code??'other'}));}
async function main(){
  const control=new Pool({connectionString:adminUrl.replace('/tc_review_mfa_b45f0b5','/postgres')});
  await control.query('CREATE DATABASE tc_review_mfa_b45f0b5');await control.end();
  const migration=spawnSync(process.execPath,['-r','ts-node/register/transpile-only','/candidate/packages/db/src/run-migrations.ts'],{env:{...process.env,MIGRATOR_DATABASE_URL:adminUrl},encoding:'utf8',timeout:60000});
  fs.writeFileSync('/review/mfa-probe-migrations.txt',migration.stdout+'\n'+migration.stderr);
  if(migration.status!==0)throw new Error('MIGRATION_FAILED');
  const admin=new Pool({connectionString:adminUrl});
  const a=new Pool({connectionString:appUrl,application_name:'review_mfa_start'});
  const b=new Pool({connectionString:appUrl,application_name:'review_mfa_confirm'});
  for(const pool of [admin,a,b])pool.on('error',()=>{});
  const sessionLocked=deferred(),allowStart=deferred(),confirmUpdatingSession=deferred();
  const user=randomUUID(),org=randomUUID(),session=randomUUID(),generation=randomUUID();
  const token='disposable-mfa-token-'+randomUUID();
  // Base32 A decodes to twenty zero bytes. This is a disposable fixture only.
  const secret='A'.repeat(32);
  try{
    await admin.query("INSERT INTO users(id,name,status,mfa_totp_pending_secret) VALUES($1,'Lock Order Fixture','ACTIVE',$2)",[user,encryptFactor(secret)]);
    await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'Review Fixture','Review Fixture','KA','ACTIVE')",[org]);
    await admin.query("INSERT INTO memberships(id,user_id,org_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[randomUUID(),user,org]);
    await admin.query("INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,auth_generation,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day')",[session,user,org,digest(token),'a'.repeat(64),generation]);
    function instrument(pool,kind){return {
      query:pool.query.bind(pool),
      connect:async()=>{
        const client=await pool.connect();
        return {
          query:async(sql,values)=>{
            if(kind==='confirm' && /UPDATE sessions/.test(sql))confirmUpdatingSession.resolve();
            const rows=await client.query(sql,values);
            if(kind==='start' && /SELECT id FROM sessions/.test(sql)){
              sessionLocked.resolve();await allowStart.promise;
            }
            return rows;
          },
          release:client.release.bind(client),
        };
      },
    };}
    const req={auth:{sessionId:session,userId:user,activeOrgId:org,authGeneration:generation,mfaVerified:false},cookies:{tc_session:token},userContext:{actorType:'USER'},ip:'192.0.2.22'};
    const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
    const h=createHmac('sha1',Buffer.alloc(20)).update(counter).digest();
    const code=String((h.readUInt32BE(h[h.length-1]&15)&0x7fffffff)%1000000).padStart(6,'0');
    const starting=result(new MfaController(instrument(a,'start')).beginEnrollment(req));
    await sessionLocked.promise;
    const confirming=result(new MfaController(instrument(b,'confirm')).confirmEnrollment(req,{code},{cookie(){}}));
    await confirmUpdatingSession.promise;
    // Both operations are the actual candidate controllers, using real
    // tc_app transactions. Only scheduling is controlled: start holds the
    // session while confirm holds the user and attempts session rotation.
    allowStart.resolve();
    const outcomes=await Promise.all([starting,confirming]);
    const evidence={source_sha:'b45f0b5f4b7c4c1c838a2526aa6209f1a30a5c60',node:process.version,postgres:(await admin.query('SHOW server_version')).rows[0].server_version,runtime:(await a.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],controlled_schedule:'start locks session; confirm locks user and attempts session rotation; start resumes user lock',begin_enrollment:outcomes[0],confirm_enrollment:outcomes[1],deadlock_reproduced:outcomes.some(x=>x.sqlstate==='40P01')};
    fs.writeFileSync('/review/mfa-lock-order-evidence.json',JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence,null,2));
  }finally{allowStart.resolve();await Promise.all([a.end(),b.end(),admin.end()]);}
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
