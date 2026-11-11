import { createHash, createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { MfaController } from '../src/modules/identity/mfa.controller';

jest.setTimeout(180_000);

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function otp(secret: string, clockMs: number): string {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const letter of secret) {
    value = (value << 5) | alphabet.indexOf(letter);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits -= 8)) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(clockMs / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function seed(admin: Pool) {
  const userId = uuidv7(), orgId = uuidv7(), sessionId = uuidv7();
  const rawToken = 'mfa_test_' + uuidv7();
  await admin.query(
    `INSERT INTO users(id,name,status) VALUES($1,'Security Owner','ACTIVE')`,
    [userId],
  );
  await admin.query(
    `INSERT INTO organisations(id,legal_name,display_name,state,status)
       VALUES($1,'Test MEP Org','Test MEP Org','KA','ACTIVE')`,
    [orgId],
  );
  await admin.query(
    `INSERT INTO memberships(id,user_id,org_id,role,status)
      VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,
    [uuidv7(),userId,orgId],
  );
  await admin.query(
    `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
    [sessionId,userId,orgId,createHash('sha256').update(rawToken).digest('hex'),'a'.repeat(64)],
  );
  const generation=(await admin.query(
    'SELECT auth_generation FROM sessions WHERE id=$1',[sessionId],
  )).rows[0].auth_generation;
  const req:any = {
    auth: { sessionId, userId, activeOrgId: orgId,
      authGeneration: generation, mfaVerified: false },
    cookies: {tc_session:rawToken},
    userContext: { actorType: 'USER' },
  };
  return { orgId,userId,sessionId,req };
}

describe('G01 MFA real PostgreSQL control plane', () => {
  const keyBefore = process.env.AUTH_MFA_ENCRYPTION_KEY;
  const previousKeyBefore = process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
  const previousDeadline = process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT;
  afterAll(() => {
    if (keyBefore === undefined) delete process.env.AUTH_MFA_ENCRYPTION_KEY;
    else process.env.AUTH_MFA_ENCRYPTION_KEY = keyBefore;
    if (previousKeyBefore === undefined) delete process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
    else process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS = previousKeyBefore;
    if (previousDeadline === undefined) delete process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT;
    else process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT = previousDeadline;
  });

  it('G01-R6: overlapping start/confirm serialize without reversing user/session locks', async () => {
    process.env.AUTH_MFA_ENCRYPTION_KEY = Buffer.alloc(32,22).toString('base64');
    await withDisposableDatabase(async ({admin,app}) => {
      const {req}=await seed(admin);
      const initial=await new MfaController(app).beginEnrollment(req);
      const first=new Pool({...app.options, application_name:'g01_r6_start'});
      const second=new Pool({...app.options, application_name:'g01_r6_confirm'});
      first.on('error',()=>{}); second.on('error',()=>{});
      let locked!:()=>void, resume!:()=>void;
      const held=new Promise<void>(resolve=>{locked=resolve;});
      const release=new Promise<void>(resolve=>{resume=resolve;});
      const instrumented={
        query:first.query.bind(first),
        connect:async()=>{
          const c=await first.connect();
          return {release:c.release.bind(c),query:async(sql:string,params?:unknown[])=>{
            const result=await c.query(sql,params);
            if (/SELECT id FROM sessions/.test(sql)) {locked();await release;}
            return result;
          }};
        },
      } as unknown as Pool;
      let starting:Promise<PromiseSettledResult<unknown>>|undefined;
      let confirming:Promise<PromiseSettledResult<unknown>>|undefined;
      const capture=(p:Promise<unknown>)=>p.then(
        value=>({status:'fulfilled',value} as const),
        reason=>({status:'rejected',reason} as const),
      );
      try {
        starting=capture(new MfaController(instrumented).beginEnrollment(req));
        await held;
        confirming=capture(new MfaController(second).confirmEnrollment(req,
          {code:otp(initial.manualSetupKey,Date.now())},{cookie:jest.fn()} as any));
        // Observe a real server wait rather than trusting a fixed sleep. With
        // the old code confirm holds user and waits session; with the fix it
        // waits for the user before taking any other account locks.
        let waiting=false;
        for(let i=0;i<100;i++){
          const {rows}=await admin.query(`SELECT 1 FROM pg_stat_activity
            WHERE application_name='g01_r6_confirm' AND wait_event_type='Lock'
              AND cardinality(pg_blocking_pids(pid))>0`);
          if(rows.length){waiting=true;break;}
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        expect(waiting).toBe(true);
        resume();
        const outcomes=await Promise.all([starting,confirming]);
        expect(outcomes[0].status).toBe('fulfilled');
        for(const outcome of outcomes){
          if(outcome.status==='rejected'){
            expect(outcome.reason.code).not.toBe('40P01');
            expect(outcome.reason.getStatus()).toBe(401);
            expect(outcome.reason.getResponse()).toMatchObject({code:'MFA_CODE_INVALID'});
          }
        }
        const account=(await admin.query(
          'SELECT mfa_totp_secret,mfa_totp_pending_secret,mfa_enabled_at FROM users WHERE id=$1',
          [req.auth.userId],
        )).rows[0];
        expect(account.mfa_totp_secret).toBeNull();
        expect(account.mfa_enabled_at).toBeNull();
        expect(account.mfa_totp_pending_secret).toBeTruthy();
        expect((await admin.query('SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1',
          [req.auth.userId])).rows[0].n).toBe(0);
        await expect(first.query('SELECT 1')).resolves.toBeDefined();
        await expect(second.query('SELECT 1')).resolves.toBeDefined();
      } finally {
        resume();
        await Promise.all([starting,confirming]);
        await Promise.all([first.end(),second.end()]);
      }
    });
  });

  it.each(['recovery','reset'] as const)('G01-R6: %s serializes with the other operation and leaves no partial factor writes',async leading=>{
    process.env.AUTH_MFA_ENCRYPTION_KEY=Buffer.alloc(32,22).toString('base64');
    await withDisposableDatabase(async({admin,app})=>{
      const {req,userId,sessionId}=await seed(admin);
      const controller=new MfaController(app);
      const res:any={cookie:jest.fn(),clearCookie:jest.fn()};
      const setup=await controller.beginEnrollment(req);
      const confirmed=await controller.confirmEnrollment(req,{code:otp(setup.manualSetupKey,Date.now())},res);
      req.auth.authGeneration=confirmed.authGeneration;req.auth.mfaVerified=true;
      req.cookies.tc_session=res.cookie.mock.lastCall[1];
      const first=new Pool({...app.options,application_name:'g01_r6_leading'});
      const second=new Pool({...app.options,application_name:'g01_r6_waiting'});
      first.on('error',()=>{});second.on('error',()=>{});
      let locked!:()=>void,resume!:()=>void;
      const held=new Promise<void>(resolve=>{locked=resolve;});
      const release=new Promise<void>(resolve=>{resume=resolve;});
      const scheduled={query:first.query.bind(first),connect:async()=>{
        const client=await first.connect();
        return {release:client.release.bind(client),query:async(sql:string,values?:unknown[])=>{
          const result=await client.query(sql,values);
          if(sql.includes("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR UPDATE")){
            locked();await release;
          }
          return result;
        }};
      }} as unknown as Pool;
      const capture=(promise:Promise<unknown>)=>promise.then(
        value=>({status:'fulfilled',value} as const),reason=>({status:'rejected',reason} as const));
      const execute=(pool:Pool,kind:'recovery'|'reset')=>kind==='recovery'
        ?new MfaController(pool).recoverFactor(req,{recoveryCode:confirmed.recoveryCodes[0]},res)
        :new MfaController(pool).resetEnrollment(req,{recoveryCode:confirmed.recoveryCodes[1]},res);
      let a:ReturnType<typeof capture>|undefined,b:ReturnType<typeof capture>|undefined;
      try{
        a=capture(execute(scheduled,leading));await held;
        b=capture(execute(second,leading==='recovery'?'reset':'recovery'));
        let waiting=false;
        for(let i=0;i<100;i++){
          if((await admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name='g01_r6_waiting'
            AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`)).rows.length){waiting=true;break;}
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        expect(waiting).toBe(true);resume();
        const [winner,loser]=await Promise.all([a,b]);
        expect(winner.status).toBe('fulfilled');expect(loser.status).toBe('rejected');
        if(loser.status==='rejected'){
          expect(loser.reason.code).not.toBe('40P01');expect(loser.reason.getStatus()).toBe(401);
        }
        const account=(await admin.query('SELECT mfa_enabled_at,mfa_totp_pending_secret FROM users WHERE id=$1',[userId])).rows[0];
        const codes=(await admin.query('SELECT consumed_at FROM mfa_recovery_codes WHERE user_id=$1',[userId])).rows;
        const session=(await admin.query('SELECT revoked_at FROM sessions WHERE id=$1',[sessionId])).rows[0];
        expect(account.mfa_totp_pending_secret).toBeNull();
        if(leading==='reset'){
          expect(account.mfa_enabled_at).toBeNull();expect(codes).toHaveLength(0);
          expect(session.revoked_at).toBeInstanceOf(Date);
        }else{
          expect(account.mfa_enabled_at).toBeInstanceOf(Date);expect(codes).toHaveLength(8);
          expect(codes.filter(code=>code.consumed_at)).toHaveLength(1);expect(session.revoked_at).toBeNull();
        }
        await expect(first.query('SELECT 1')).resolves.toBeDefined();
        await expect(second.query('SELECT 1')).resolves.toBeDefined();
      }finally{resume();await Promise.all([a,b]);await Promise.all([first.end(),second.end()]);}
    });
  });

  it('G01-014/019: stale session cannot write pending MFA enrollment after logout or role revocation', async () => {
    process.env.AUTH_MFA_ENCRYPTION_KEY = Buffer.alloc(32,22).toString('base64');
    await withDisposableDatabase(async ({admin,app}) => {
      const {userId,sessionId,req}=await seed(admin);
      const ctrl=new MfaController(app);
      // Simulate an HTTP request that passed its session guard just before
      // a separate transaction revoked the session. The MFA transaction must
      // lock/recheck the exact generation and token before writing secrets.
      const other=await admin.connect();
      try {
        await other.query('BEGIN');
        await other.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
        const inFlight=ctrl.beginEnrollment(req);
        await new Promise(resolve=>setTimeout(resolve,75));
        await other.query('COMMIT');
        await expect(inFlight).rejects.toMatchObject({
          response:expect.objectContaining({code:'SESSION_CONTEXT_CHANGED'}),
        });
      } finally {
        await other.query('ROLLBACK').catch(()=>{});
        other.release();
      }
      const {rows}=await admin.query(
        'SELECT mfa_totp_pending_secret FROM users WHERE id=$1',[userId],
      );
      expect(rows[0].mfa_totp_pending_secret).toBeNull();
      const logged=(await admin.query(
        `SELECT count(*)::int AS n FROM auth_security_events
          WHERE actor_user_id=$1 AND event_type='MFA_ENROLLMENT_START_DENIED'
            AND reason_code='SESSION_CONTEXT_CHANGED' AND outcome='DENIED'`,
        [userId],
      )).rows[0].n;
      expect(logged).toBe(1);
    });
  });

  it('binds enrollment, factor replay, single-use backup recovery and audited reset', async () => {
    process.env.AUTH_MFA_ENCRYPTION_KEY = Buffer.alloc(32,22).toString('base64');
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, sessionId, req } = await seed(admin);
      const ctrl = new MfaController(app);
      const res:any = { cookie: jest.fn(), clearCookie: jest.fn() };
      const started = await ctrl.beginEnrollment(req);
      expect(started.manualSetupKey).toMatch(/^[A-Z2-7]{32}$/);
      const now = Date.now();
      const firstCode = otp(started.manualSetupKey, now);
      const confirmed = await ctrl.confirmEnrollment(req,{code:firstCode},res);
      expect(confirmed.mfaVerified).toBe(true);
      expect(confirmed.recoveryCodes).toHaveLength(8);
      const originalSession = {
        ...req, auth:{...req.auth}, cookies:{...req.cookies},
      };
      req.auth.authGeneration = confirmed.authGeneration;
      req.cookies.tc_session = res.cookie.mock.lastCall[1];
      expect(res.cookie).toHaveBeenCalledWith('tc_session', expect.any(String), expect.objectContaining({ httpOnly: true }));
      const row=(await admin.query('SELECT mfa_totp_secret,mfa_totp_pending_secret,mfa_enabled_at FROM users WHERE id=$1',[userId])).rows[0];
      expect(row.mfa_totp_secret).not.toContain(started.manualSetupKey);
      expect(row.mfa_totp_pending_secret).toBeNull();
      expect(row.mfa_enabled_at).toBeTruthy();
      expect((await app.query('SELECT mfa_verified FROM sessions WHERE id=$1',[sessionId])).rows[0].mfa_verified).toBe(true);
      req.ip='198.51.100.22';
      await expect(ctrl.verifyFactor(req,{code:firstCode},res)).rejects.toThrow();
      const replay=(await admin.query(
        `SELECT event_type,outcome,reason_code,source_digest
           FROM auth_security_events WHERE actor_user_id=$1
             AND event_type='MFA_VERIFY_DENIED' ORDER BY occurred_at DESC LIMIT 1`,
        [userId],
      )).rows[0];
      expect(replay).toMatchObject({
        event_type:'MFA_VERIFY_DENIED',outcome:'DENIED',
        reason_code:'MFA_CODE_INVALID_OR_REPLAYED',
        source_digest:expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(replay.source_digest).not.toContain('198.51.100.22');
      // Previously issued one-use backup hashes remain valid during a
      // controlled key overlap window. They are not silently reissued.
      process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS =
        Buffer.alloc(32,22).toString('base64');
      process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT =
        new Date(Date.now()+24*3600_000).toISOString();
      process.env.AUTH_MFA_ENCRYPTION_KEY =
        Buffer.alloc(32,23).toString('base64');
      const backup=confirmed.recoveryCodes[0];
      await expect(ctrl.recoverFactor(originalSession,
        {recoveryCode:backup},res)).rejects.toMatchObject({
          response: expect.objectContaining({code:'SESSION_EXPIRED'}),
        });
      const notSpent=(await admin.query(
        'SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1 AND consumed_at IS NOT NULL',
        [userId])).rows[0].n;
      expect(notSpent).toBe(0);
      const recovered=await ctrl.recoverFactor(req,{recoveryCode:backup},res);
      req.auth.authGeneration = recovered.authGeneration;
      req.cookies.tc_session = res.cookie.mock.lastCall[1];
      expect(recovered.mfaVerified).toBe(true);
      await expect(ctrl.recoverFactor(req,{recoveryCode:backup},res)).rejects.toThrow();
      const recoveryDenied=(await admin.query(
        `SELECT reason_code FROM auth_security_events
          WHERE actor_user_id=$1 AND event_type='MFA_RECOVERY_DENIED'
          ORDER BY occurred_at DESC LIMIT 1`,[userId],
      )).rows[0];
      expect(recoveryDenied.reason_code).toBe('RECOVERY_CODE_INVALID');
      expect((await admin.query(
        'SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1 AND consumed_at IS NOT NULL',
        [userId])).rows[0].n).toBe(1);
      req.auth.mfaVerified = true;
      await expect(ctrl.resetEnrollment(req, {} as any, res)).rejects.toThrow();
      await expect(ctrl.resetEnrollment(req, { recoveryCode: backup }, res)).rejects.toThrow();
      expect((await admin.query(
        `SELECT count(*)::int AS n FROM auth_security_events
         WHERE actor_user_id=$1 AND event_type='MFA_RESET_DENIED'
           AND outcome='DENIED' AND reason_code='MFA_FRESH_PROOF_INVALID'`,
         [userId],
      )).rows[0].n).toBeGreaterThan(0);
      expect((await admin.query(
        'SELECT mfa_enabled_at FROM users WHERE id=$1', [userId])).rows[0].mfa_enabled_at).toBeTruthy();
      const reset=await ctrl.resetEnrollment(req,
        { recoveryCode: confirmed.recoveryCodes[1] }, res);
      expect(reset).toMatchObject({
        enrolled: false, mfaVerified: false, reauthenticationRequired: true,
      });
      expect(res.clearCookie).toHaveBeenCalledWith('tc_session',
        expect.objectContaining({httpOnly:true}));
      const oldSession=(await app.query(
        'SELECT mfa_verified, revoked_at FROM sessions WHERE id=$1', [sessionId])).rows[0];
      expect(oldSession.mfa_verified).toBe(false);
      expect(oldSession.revoked_at).toBeTruthy();
      const { rows: events }=await admin.query(
        `SELECT event_type FROM auth_security_events WHERE actor_user_id=$1`,[userId]);
      expect(events.map(x=>x.event_type)).toEqual(expect.arrayContaining([
        'MFA_ENROLLED','MFA_RECOVERY_USED','MFA_RESET_ALL_SESSIONS_REVOKED',
      ]));
    });
  });
});
