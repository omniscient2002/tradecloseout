const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {Pool} = require('pg');
const {recordDeniedAuthenticationEvent: audit} = require('/candidate/apps/api/src/modules/identity/auth-security.ts');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = '/home/cassandra/tradecloseout';
const adminUrl = 'postgres://postgres:review_disposable_pw@127.0.0.1:5432/tc_review_4f8a7bb';
const appUrl = 'postgres://tc_app:app_local_pw@127.0.0.1:5432/tc_review_4f8a7bb';
const evidence = {source_sha:'4f8a7bb183e892ee4626d9116c00a34dc097f76c', node:process.version, pg:require('pg/package.json').version};
async function main(){
  const control = new Pool({connectionString:'postgres://postgres:review_disposable_pw@127.0.0.1:5432/postgres'});
  await control.query('CREATE DATABASE tc_review_4f8a7bb');
  await control.end();
  const migration = spawnSync(process.execPath,['-r',root+'/node_modules/ts-node/register/transpile-only','/candidate/packages/db/src/run-migrations.ts'],{
    env:{...process.env,MIGRATOR_DATABASE_URL:adminUrl,NODE_ENV:'test'},encoding:'utf8',timeout:60000,
  });
  fs.writeFileSync('/review/migrations.log',migration.stdout+'\n'+migration.stderr);
  if(migration.status!==0)throw new Error('Fresh candidate migration failed; inspect migrations.log');
  const admin = new Pool({connectionString:adminUrl});
  const first = new Pool({connectionString:appUrl,max:1,application_name:'review_r3_first'});
  const second = new Pool({connectionString:appUrl,max:1,application_name:'review_r3_second'});
  for(const pool of [admin,first,second])pool.on('error',()=>{});
  const version=(await admin.query('SHOW server_version')).rows[0].server_version;
  evidence.postgres=version;
  evidence.runtime=(await first.query('SELECT current_user,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE rolname=current_user')).rows[0];
  process.env.NODE_ENV='production';
  process.env.AUTH_OTP_HMAC_KEY='isolated-probe-hmac-key-32-characters-plus';
  async function clear(){await admin.query('TRUNCATE auth_security_events,auth_request_budgets');}
  async function count(){return Number((await admin.query('SELECT count(*) AS n FROM auth_security_events')).rows[0].n);}
  try{
    // Keep the fixed-window probes within one DB minute, without faking its clock.
    const secondOfMinute=Number((await admin.query('SELECT extract(second FROM clock_timestamp()) AS s')).rows[0].s);
    if(secondOfMinute>47)await sleep((61-secondOfMinute)*1000);
    await first.query('SELECT 1');await second.query('SELECT 1');
    await clear();
    for(let i=0;i<40;i++)await audit(i%2?first:second,'MFA_VERIFY_DENIED',{
      reasonCode:'RATE_LIMITED',sourceIp:'192.0.2.'+(i+1),
    });
    evidence.sequential_shared_global_cap={attempts:40,events:await count(),expected:30};
    await clear();
    await Promise.all(Array.from({length:120},(_,i)=>audit(i%2?first:second,'MFA_VERIFY_DENIED',{
      reasonCode:'RATE_LIMITED',sourceIp:'192.0.2.'+(i+1),
    })));
    evidence.warmed_parallel_test={attempts:120,events:await count(),configured_global_cap:30};
    await clear();
    // Test the exact queue deadline: hold the only runtime connection, then
    // release it AFTER the helper has returned from its 1000ms deadline.
    const held = await first.connect();
    const start=performance.now();
    await audit(first,'AUTH_SESSION_DENIED',{reasonCode:'UNAUTHENTICATED',sourceIp:'198.51.100.10'});
    const returned=performance.now()-start;
    const before=await count();
    const waiting=first.waitingCount;
    held.release();
    await sleep(150);
    evidence.queued_deadline={helper_return_ms:Math.round(returned),waiting_after_deadline:waiting,
      events_at_deadline:before,events_after_connection_release:await count()};
    await clear();
    // A real backend lock distinguishes a client read timeout from SQL cancellation.
    const locker=await admin.connect();
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE auth_request_budgets IN ACCESS EXCLUSIVE MODE');
    try{
      const started=performance.now();
      await audit(first,'AUTH_SESSION_DENIED',{reasonCode:'UNAUTHENTICATED',sourceIp:'198.51.100.11'});
      const returned=performance.now()-started;
      const active=async()=> (await admin.query(
        `SELECT state,wait_event_type,wait_event,clock_timestamp()-query_start AS age
           FROM pg_stat_activity WHERE application_name='review_r3_first'
             AND state='active' AND query LIKE 'WITH tick AS (%'`
      )).rows;
      const atReturn=await active();
      await sleep(1000);
      const later=await active();
      await locker.query('COMMIT');
      await sleep(150);
      evidence.locked_backend_deadline={helper_return_ms:Math.round(returned),backend_at_return:atReturn,
        backend_one_second_later:later,events_after_unlock:await count()};
    }finally{
      await locker.query('ROLLBACK').catch(()=>{});
      locker.release();
    }
    fs.writeFileSync('/review/evidence.json',JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence,null,2));
  }finally{
    await Promise.all([first.end(),second.end(),admin.end()]);
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
