import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { recordDeniedAuthenticationEvent } from '../src/modules/identity/auth-security';
import { MfaController } from '../src/modules/identity/mfa.controller';
import { uuidv7 } from 'uuidv7';

jest.setTimeout(180_000);

describe('G01-R3: bounded, independently committed denial telemetry',()=>{
  it('shares event-row caps across two real restricted PostgreSQL pools',async()=>{
    await withDisposableDatabase(async({admin,app,name})=>{
      const runtime=new URL(process.env.APP_DATABASE_URL!);
      runtime.pathname='/'+name;
      // Four connections in the second replica make the optional audit pool
      // pressure explicit; unlike auth controls, dropped samples are safe.
      const replica=new Pool({connectionString:runtime.toString(),max:4});
      replica.on('error',()=>{}); // match the disposable helper's pool policy
      try{
        expect((await replica.query('SELECT current_user AS role')).rows[0].role).toBe('tc_app');
        // 200 attempts against the same anonymous source: 10 initial
        // forensic events in one minute, independent of the API replica.
        const anonymous=Array.from({length:200},(_,i)=>
          recordDeniedAuthenticationEvent(i%2?replica:app,'AUTH_SESSION_DENIED',{
            reasonCode:'UNAUTHENTICATED',sourceIp:'198.51.100.77',
          }),
        );
        await Promise.all(anonymous);
        const {rows:session}=await admin.query(
          `SELECT COUNT(*)::int AS n FROM auth_security_events
           WHERE event_type='AUTH_SESSION_DENIED' AND outcome='DENIED'
             AND reason_code='UNAUTHENTICATED'`,
        );
        expect(session[0].n).toBeGreaterThan(0);
        expect(session[0].n).toBeLessThanOrEqual(10);

        // Repeated already-throttled requests must never create one event per
        // retry. Rotate remote sources to also exercise the shared global cap.
        const attempts=Array.from({length:120},(_,i)=>
          recordDeniedAuthenticationEvent(i%2?replica:app,'MFA_VERIFY_DENIED',{
            reasonCode:'RATE_LIMITED',sourceIp:`192.0.2.${i+1}`,
          }),
        );
        await Promise.all(attempts);
        const {rows:mfa}=await admin.query(
          `SELECT COUNT(*)::int AS n FROM auth_security_events
           WHERE event_type='MFA_VERIFY_DENIED' AND outcome='DENIED'
             AND reason_code='RATE_LIMITED'`,
        );
        expect(mfa[0].n).toBeGreaterThan(0);
        expect(mfa[0].n).toBeLessThanOrEqual(30);
        const {rows:global}=await admin.query(
          `SELECT count FROM auth_request_budgets
           WHERE budget_key LIKE 'audit-denied:global:%'`,
        );
        expect(global.length).toBe(2);
        expect(global.every(r=>r.count<=60)).toBe(true);
        // Rejecting requests never removes enforcement of independent login
        // or MFA budgets. This sampler writes no raw phone, IP or OTP.
        const {rows:leaks}=await admin.query(
          `SELECT COUNT(*)::int AS n FROM auth_security_events
           WHERE source_digest LIKE '%198.51.100.77%'`,
        );
        expect(leaks[0].n).toBe(0);
        // Replicas and their shared DB remain usable after the burst.
        await expect(replica.query('SELECT 1 AS ok')).resolves.toMatchObject({
          rows:[{ok:1}],
        });
      }finally{await replica.end();}
    });
  });

  it('sequentially admits 40 distinct throttled sources across two tc_app pools and persists exactly 30',async()=>{
    await withDisposableDatabase(async({admin,app,name})=>{
      const runtime=new URL(process.env.APP_DATABASE_URL!);
      runtime.pathname='/'+name;
      const replica=new Pool({connectionString:runtime.toString(),max:2});
      replica.on('error',()=>{});
      try{
        await app.query('SELECT 1');
        await replica.query('SELECT 1');
        const seconds=Number((await admin.query(
          "SELECT EXTRACT(SECOND FROM clock_timestamp()) AS s",
        )).rows[0].s);
        if(seconds>46)await new Promise(r=>setTimeout(r,(61-seconds)*1000));
        for(let i=0;i<40;i++){
          await recordDeniedAuthenticationEvent(i%2?app:replica,
            'MFA_VERIFY_DENIED',{
              reasonCode:'RATE_LIMITED',sourceIp:`192.0.2.${i+1}`,
            });
        }
        const events=(await admin.query(
          "SELECT count(*)::int AS n FROM auth_security_events WHERE event_type='MFA_VERIFY_DENIED'",
        )).rows[0].n;
        const globals=(await admin.query(
          "SELECT count FROM auth_request_budgets WHERE budget_key LIKE 'audit-denied:global:%'",
        )).rows;
        expect(events).toBe(30);
        expect(globals).toHaveLength(1);
        expect(globals[0].count).toBe(30);
      }finally{await replica.end();}
    });
  });

  it('a queued checkout expires without SQL and releases the late client (real PG16)',async()=>{
    await withDisposableDatabase(async({admin,name})=>{
      const runtime=new URL(process.env.APP_DATABASE_URL!);
      runtime.pathname='/'+name;
      const pool=new Pool({connectionString:runtime.toString(),max:1,
        application_name:'g01_r3_queued'});
      pool.on('error',()=>{});
      const held=await pool.connect();
      try{
        expect((await held.query('SELECT current_user AS role')).rows[0].role).toBe('tc_app');
        const began=performance.now();
        await recordDeniedAuthenticationEvent(pool,'AUTH_SESSION_DENIED',{
          reasonCode:'UNAUTHENTICATED',sourceIp:'198.51.100.10',
        });
        expect(performance.now()-began).toBeLessThan(900);
        expect(pool.waitingCount).toBe(1);
        expect((await admin.query('SELECT count(*)::int AS n FROM auth_security_events')).rows[0].n).toBe(0);
      }finally{held.release();}
      // The late acquisition must be released without querying, and the
      // pool must remain reusable. WaitingCount may take a tick to drain.
      await new Promise(resolve=>setTimeout(resolve,150));
      expect(pool.waitingCount).toBe(0);
      expect((await admin.query('SELECT count(*)::int AS n FROM auth_security_events')).rows[0].n).toBe(0);
      expect((await admin.query('SELECT count(*)::int AS n FROM auth_request_budgets')).rows[0].n).toBe(0);
      await expect(pool.query('SELECT 1 AS ok')).resolves.toMatchObject({rows:[{ok:1}]});
      await pool.end();
    });
  });

  it('server lock_timeout cancels audit SQL and rolls back before releasing the client (real PG16)',async()=>{
    await withDisposableDatabase(async({admin,name})=>{
      const runtime=new URL(process.env.APP_DATABASE_URL!);
      runtime.pathname='/'+name;
      const pool=new Pool({connectionString:runtime.toString(),max:1,
        application_name:'g01_r3_locked'});
      pool.on('error',()=>{});
      const lock=await admin.connect();
      try {
        await lock.query('BEGIN');
        await lock.query('LOCK TABLE auth_request_budgets IN ACCESS EXCLUSIVE MODE');
        const began=performance.now();
        await recordDeniedAuthenticationEvent(pool,'AUTH_SESSION_DENIED',{
          reasonCode:'UNAUTHENTICATED',sourceIp:'198.51.100.11',
        });
        expect(performance.now()-began).toBeLessThan(1_500);
        const active=(await admin.query(
          `SELECT pid,state,wait_event_type FROM pg_stat_activity
            WHERE application_name='g01_r3_locked'
              AND state='active' AND wait_event_type='Lock'`,
        )).rows;
        expect(active).toHaveLength(0);
        expect(pool.waitingCount).toBe(0);
      }finally{
        await lock.query('COMMIT').catch(()=>{});
        lock.release();
      }
      await new Promise(resolve=>setTimeout(resolve,150));
      expect((await admin.query('SELECT count(*)::int AS n FROM auth_security_events')).rows[0].n).toBe(0);
      expect((await admin.query('SELECT count(*)::int AS n FROM auth_request_budgets')).rows[0].n).toBe(0);
      await expect(pool.query('SELECT 1 AS ok')).resolves.toMatchObject({rows:[{ok:1}]});
      await pool.end();
    });
  });

  it('records enrollment-start denial after rollback, without revealing the factor',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const user=uuidv7(),org=uuidv7(),session=uuidv7();
      await admin.query("INSERT INTO users(id,name,status,mfa_enabled_at) VALUES($1,'MFA User','ACTIVE',now())",[user]);
      await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'MFA Org','MFA Org','KA','ACTIVE')",[org]);
      const sessionToken='g01-enrollment-audit-cookie';
      await admin.query(
        `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [session,user,org,createHash('sha256').update(sessionToken).digest('hex'),'b'.repeat(64)],
      );
      const generation=(await admin.query(
        'SELECT auth_generation FROM sessions WHERE id=$1',[session],
      )).rows[0].auth_generation;
      const request:any={
        auth:{userId:user,activeOrgId:org,sessionId:session,authGeneration:generation},
        cookies:{tc_session:sessionToken},
        userContext:{actorType:'USER'},ip:'192.0.2.42',
      };
      const controller=new MfaController(app);
      await expect(controller.beginEnrollment(request)).rejects.toMatchObject({
        response:expect.objectContaining({code:'MFA_ALREADY_ENROLLED'}),
      });
      const {rows}=await admin.query(
        `SELECT event_type,reason_code,source_digest,outcome
           FROM auth_security_events WHERE actor_user_id=$1
           ORDER BY occurred_at DESC`,[user],
      );
      expect(rows[0]).toMatchObject({
        event_type:'MFA_ENROLLMENT_START_DENIED',
        reason_code:'MFA_ALREADY_ENROLLED',outcome:'DENIED',
        source_digest:expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(JSON.stringify(rows)).not.toContain('192.0.2.42');
      // A member-only restriction is also observed without incrementing the
      // MFA enrollment state or generating an authenticator secret.
      await expect(controller.beginEnrollment({
        ...request,userContext:{actorType:'GUEST'},
      })).rejects.toMatchObject({
        response:expect.objectContaining({code:'MFA_MEMBER_ONLY'}),
      });
      const {rows:guest}=await admin.query(
        `SELECT COUNT(*)::int AS n FROM auth_security_events
         WHERE actor_user_id=$1 AND event_type='MFA_ENROLLMENT_START_DENIED'
           AND reason_code='MFA_MEMBER_ONLY'`,[user],
      );
      expect(guest[0].n).toBe(1);
    });
  });

  it('caps repeated actually throttled MFA requests without suppressing the denial',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const user=uuidv7(),org=uuidv7(),session=uuidv7();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Rate Limited User','ACTIVE')",[user]);
      await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'Rate Org','Rate Org','KA','ACTIVE')",[org]);
      await admin.query(
        `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [session,user,org,'c'.repeat(64),'d'.repeat(64)],
      );
      const ctrl=new MfaController(app);
      const req:any={
        auth:{userId:user,activeOrgId:org,sessionId:session},
        userContext:{actorType:'USER'},ip:'198.51.100.91',
      };
      for(let n=0;n<35;n++){
        await expect(ctrl.verifyFactor(req,{code:'123456'},{} as any))
          .rejects.toThrow();
      }
      const {rows:throttled}=await admin.query(
        `SELECT COUNT(*)::int AS n FROM auth_security_events
          WHERE actor_user_id=$1 AND event_type='MFA_VERIFY_DENIED'
            AND outcome='DENIED' AND reason_code='RATE_LIMITED'`,[user],
      );
      expect(throttled[0].n).toBe(1);
      const {rows:budget}=await admin.query(
        `SELECT COUNT(*)::int AS n FROM auth_request_budgets
          WHERE budget_key LIKE 'mfa:verify:user:%' AND count>10`,
      );
      expect(budget[0].n).toBe(1);
    });
  });

  it('throttles failure diagnostics per replica and never authorizes denied requests',async()=>{
    const rawConsole=jest.spyOn(console,'error').mockImplementation(()=>{});
    const base=Date.now()+120_000;
    const now=jest.spyOn(Date,'now').mockReturnValue(base);
    try{
      const failedClients:any[]=[];
      const badPool:any={
        waitingCount:0,
        connect:jest.fn(async()=>{
          const client={
            query:jest.fn().mockRejectedValue(new Error('leaked otp bearer-secret-sensitive')),
            release:jest.fn(),
          };
          failedClients.push(client);
          return client;
        }),
      };
      for(let i=0;i<80;i++){
        await recordDeniedAuthenticationEvent(badPool,'AUTH_SESSION_DENIED',{
          reasonCode:'UNAUTHENTICATED',sourceIp:'192.0.2.42',
        });
      }
      expect(rawConsole).toHaveBeenCalledTimes(1);
      expect(rawConsole.mock.calls[0]).toEqual(['AUTH_SECURITY_EVENT_PERSISTENCE_FAILURE']);
      expect(failedClients[0].query).toHaveBeenCalledWith('BEGIN');
      expect(failedClients[0].release).toHaveBeenCalledWith(true);
      now.mockReturnValue(base+60_001);
      await recordDeniedAuthenticationEvent(badPool,'AUTH_SESSION_DENIED',{
        reasonCode:'UNAUTHENTICATED',
      });
      expect(rawConsole).toHaveBeenCalledTimes(2);
      const controller=new MfaController(badPool);
      await expect(controller.beginEnrollment({
        auth:{userId:uuidv7(),activeOrgId:uuidv7(),sessionId:uuidv7()},
        userContext:{actorType:'GUEST'},ip:'192.0.2.42',
      } as any)).rejects.toMatchObject({
        response:expect.objectContaining({code:'MFA_MEMBER_ONLY'}),
      });
      expect(rawConsole).toHaveBeenCalledTimes(2);
      // A completely stalled pool checkout must not block the original
      // protected denial indefinitely; the backup wall timeout is 1000 ms.
      let lateCheckout: ((client:any)=>void) | undefined;
      const never:any={
        waitingCount:1,
        connect:jest.fn(()=>new Promise(resolve=>{lateCheckout=resolve;})),
      };
      // A busy pool skips optional audit sampling. For the exact pending
      // checkout regression, simulate an as-yet-unreported queued client.
      never.waitingCount=0;
      const before=performance.now();
      await recordDeniedAuthenticationEvent(never,'AUTH_SESSION_DENIED',{
        reasonCode:'UNAUTHENTICATED',
      });
      expect(performance.now()-before).toBeLessThan(1_000);
      const late={query:jest.fn(),release:jest.fn()};
      lateCheckout!(late);
      await new Promise(resolve=>setImmediate(resolve));
      expect(late.release).toHaveBeenCalledTimes(1);
      expect(late.query).not.toHaveBeenCalled();
      expect(rawConsole).toHaveBeenCalledTimes(2);
    }finally{
      now.mockRestore();
      rawConsole.mockRestore();
    }
  });
});
