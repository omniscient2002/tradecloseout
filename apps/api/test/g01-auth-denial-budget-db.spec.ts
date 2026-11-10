import { Pool } from 'pg';
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
      const replica=new Pool({connectionString:runtime.toString()});
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
      }finally{await replica.end();}
    });
  });

  it('records enrollment-start denial after rollback, without revealing the factor',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const user=uuidv7(),org=uuidv7(),session=uuidv7();
      await admin.query("INSERT INTO users(id,name,status,mfa_enabled_at) VALUES($1,'MFA User','ACTIVE',now())",[user]);
      await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'MFA Org','MFA Org','KA','ACTIVE')",[org]);
      await admin.query(
        `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [session,user,org,'a'.repeat(64),'b'.repeat(64)],
      );
      const request:any={
        auth:{userId:user,activeOrgId:org,sessionId:session},
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

  it('throttles failure diagnostics per replica and never authorizes denied requests',async()=>{
    const rawConsole=jest.spyOn(console,'error').mockImplementation(()=>{});
    const base=Date.now()+120_000;
    const now=jest.spyOn(Date,'now').mockReturnValue(base);
    try{
      const badPool:any={
        query:jest.fn().mockRejectedValue(new Error('leaked otp bearer-secret-sensitive')),
      };
      for(let i=0;i<80;i++){
        await recordDeniedAuthenticationEvent(badPool,'AUTH_SESSION_DENIED',{
          reasonCode:'UNAUTHENTICATED',sourceIp:'192.0.2.42',
        });
      }
      expect(rawConsole).toHaveBeenCalledTimes(1);
      expect(rawConsole.mock.calls[0]).toEqual(['AUTH_SECURITY_EVENT_PERSISTENCE_FAILURE']);
      expect(badPool.query.mock.calls[0][0]).toMatchObject({query_timeout:750});
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
    }finally{
      now.mockRestore();
      rawConsole.mockRestore();
    }
  });
});
