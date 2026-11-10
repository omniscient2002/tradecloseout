import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { InMemoryRedis } from '../src/modules/identity/identity.module';

jest.setTimeout(180_000);

async function seedInvitation(admin: Pool) {
  const orgId=uuidv7(), owner=uuidv7(), invitationId=uuidv7();
  const token='a'.repeat(64), email='newmember@g01.example';
  await admin.query(`INSERT INTO users(id,name,status) VALUES($1,'Inviter Owner','ACTIVE')`,[owner]);
  await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
    VALUES($1,'Invitation Test HVAC','Invitation Test HVAC','KA','ACTIVE')`,[orgId]);
  await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
    VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),orgId,owner]);
  await admin.query(`INSERT INTO invitations(id,org_id,email,role,token_hash,status,expires_at,invited_by)
    VALUES($1,$2,$3,'R-SITE',$4,'PENDING',now()+interval '2 days',$5)`,
    [invitationId,orgId,email,createHash('sha256').update(token).digest('hex'),owner]);
  return { orgId,owner,invitationId,token,email };
}

describe('G01: identity-bound invitations with real RLS', () => {
  it('consumes once for the verified identity without silently creating an unrelated organisation',async()=>{
    const previousDebug=process.env.ENABLE_DEBUG_OTP;
    process.env.ENABLE_DEBUG_OTP='true';
    try {
      await withDisposableDatabase(async ({admin,app})=>{
        const input=await seedInvitation(admin);
        const controller=new IdentityController(app,new InMemoryRedis() as any,
          {sendOtpSms:jest.fn()} as any,{sendOtpEmail:jest.fn()} as any);
        const res:any={cookie:jest.fn(),clearCookie:jest.fn()};
        const req:any={ip:'127.0.0.1',headers:{'user-agent':'g01-test'},cookies:{}};
        const issued=await controller.requestOtp({identifier:input.email},req,res);
        expect(issued.debugOtp).toMatch(/^\d{6}$/);
        const authIntent=res.cookie.mock.calls.find((a:any[])=>a[0]==='tc_auth_intent')?.[1];
        if(authIntent)req.cookies.tc_auth_intent=authIntent;
        // G01-021: hostile browser-supplied UA/request-id metadata can
        // contain raw invitation links or OTPs. Only a fixed device label
        // and server-generated opaque request ID are retained on login.
        req.headers['user-agent'] = 'Mozilla/5.0 Chrome/131.0 (Linux) invite='+input.token;
        req.headers['x-request-id'] = 'otp='+issued.debugOtp+'&invite='+input.token;
        const accepted=await controller.verifyOtp({
          challengeId:issued.challengeId,code:issued.debugOtp,
          invitationToken:input.token,
        },req,res);
        expect(accepted.activeOrgId).toBe(input.orgId);
        const {rows:auditFields}=await admin.query(
          `SELECT s.user_agent,e.user_agent AS event_agent,e.request_id
            FROM sessions s
            JOIN security_events e ON e.actor_user_id=s.user_id
              AND e.event_type='USER_SESSION_CREATED'
           WHERE s.user_id=$1 ORDER BY e.created_at DESC LIMIT 1`,
          [accepted.userId],
        );
        expect(auditFields[0]).toMatchObject({
          user_agent:'Chrome / Linux',event_agent:'Chrome / Linux',
          request_id:expect.stringMatching(/^[0-9a-f-]{36}$/),
        });
        expect(JSON.stringify(auditFields)).not.toContain(input.token);
        expect(JSON.stringify(auditFields)).not.toContain(issued.debugOtp);
        expect(accepted.mfaRequired).toBe(false);
        const membership=(await admin.query(
          'SELECT role,status FROM memberships WHERE org_id=$1 AND user_id=$2',
          [input.orgId,accepted.userId])).rows[0];
        expect(membership).toMatchObject({role:'R-SITE',status:'ACTIVE'});
        expect((await admin.query('SELECT status FROM invitations WHERE id=$1',
          [input.invitationId])).rows[0].status).toBe('ACCEPTED');
        expect((await admin.query('SELECT count(*)::int AS n FROM organisations')).rows[0].n).toBe(1);
        await expect(controller.verifyOtp({
          challengeId:issued.challengeId,code:issued.debugOtp,invitationToken:input.token,
        },req,res)).rejects.toThrow();

        const second=await controller.requestOtp({identifier:input.email},req,res);
        await expect(controller.verifyOtp({
          challengeId:second.challengeId,code:second.debugOtp,invitationToken:input.token,
        },req,res)).rejects.toThrow();
      });
    }finally{
      if(previousDebug===undefined)delete process.env.ENABLE_DEBUG_OTP;
      else process.env.ENABLE_DEBUG_OTP=previousDebug;
    }
  });
});

describe('G01 production PostgreSQL OTP transaction', () => {
  it('retains valid proof after onboarding rollback and consumes it exactly once with session commit', async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV, FRONTEND_URL: process.env.FRONTEND_URL,
      AUTH_OTP_HMAC_KEY: process.env.AUTH_OTP_HMAC_KEY,
      AUTH_CSRF_KEY: process.env.AUTH_CSRF_KEY,
    };
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.g01.test';
    process.env.AUTH_OTP_HMAC_KEY = 'o'.repeat(48);
    process.env.AUTH_CSRF_KEY = 'c'.repeat(48);
    try {
      await withDisposableDatabase(async ({ admin, app }) => {
        const email = 'recoverable@g01.example';
        const mail = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
        const redis = new InMemoryRedis();
        const redisEval = jest.spyOn(redis, 'eval');
        const ctrl = new IdentityController(app, redis as any,
          { sendOtpSms: jest.fn() } as any, mail as any);
        const req:any = {
          ip: '127.0.0.1', headers: {
            origin: 'https://app.g01.test', 'sec-fetch-site': 'same-origin',
            'user-agent': 'g01-production-test',
          }, cookies: {},
        };
        const res:any = {cookie:jest.fn(),clearCookie:jest.fn()};
        const challenge = await ctrl.requestOtp({identifier:email},req,res);
        expect(await redis.get(`otp:alias:${email}`)).toBeNull();
        expect(await redis.get(`otp:challenge:${challenge.challengeId}`)).toBeNull();
        expect(redisEval.mock.calls.every((call:any[]) =>
          !JSON.stringify(call).includes(email))).toBe(true);
        const code = mail.sendOtpEmail.mock.calls[0][1] as string;
        expect(code).toMatch(/^\d{6}$/);
        req.cookies.tc_auth_intent = res.cookie.mock.calls.find(
          (args:any[]) => args[0] === 'tc_auth_intent')?.[1];

        const incorrect = await ctrl.verifyOtp({
          challengeId:challenge.challengeId,code:'000000',
        },req,res).catch((e:any)=>e);
        expect(incorrect?.response?.code).toBe('OTP_INVALID');
        const before = (await admin.query(
          'SELECT attempts,consumed_at,delivery_status FROM otp_challenges WHERE id=$1',
          [challenge.challengeId])).rows[0];
        expect(before).toMatchObject({attempts:1,consumed_at:null,delivery_status:'SENT'});

        // A real transaction failure must NOT burn the correct proof.
        await expect(ctrl.verifyOtp({
          challengeId:challenge.challengeId,code,
        },req,res)).rejects.toThrow();
        expect((await admin.query(
          'SELECT consumed_at FROM otp_challenges WHERE id=$1',
          [challenge.challengeId])).rows[0].consumed_at).toBeNull();

        // Malformed JSON must yield a controlled validation response rather
        // than calling .trim() on a non-string and returning a server 500.
        const malformed = await ctrl.verifyOtp({
          challengeId: challenge.challengeId, code,
          signupProfile: {
            fullName: { trim: 42 } as any, orgName: 'Verified MEP Ltd',
            state: 'KA',
          },
        }, req, res).catch((e:any) => e);
        expect(malformed?.getStatus?.()).toBe(422);
        expect(malformed?.getResponse?.()).toMatchObject({
          code: 'SIGNUP_PROFILE_REQUIRED',
        });
        expect((await admin.query(
          'SELECT consumed_at FROM otp_challenges WHERE id=$1',
          [challenge.challengeId])).rows[0].consumed_at).toBeNull();

        const created=await ctrl.verifyOtp({
          challengeId:challenge.challengeId,code,
          signupProfile:{fullName:'G01 Correct User',orgName:'Verified MEP Ltd',state:'KA'},
        },req,res);
        expect(created.userId).toBeDefined();
        expect(created.mfaRequired).toBe(true);
        expect((await admin.query(
          'SELECT consumed_at FROM otp_challenges WHERE id=$1',
          [challenge.challengeId])).rows[0].consumed_at).toBeTruthy();
        expect((await admin.query(
          'SELECT count(*)::int AS n FROM sessions WHERE user_id=$1',
          [created.userId])).rows[0].n).toBe(1);
        await expect(ctrl.verifyOtp({
          challengeId:challenge.challengeId,code,
        },req,res)).rejects.toThrow();
      });
    } finally {
      for (const [k,v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
  it('refuses success for a late internal OTP after another request superseded its proof', async () => {
    const prior = {
      NODE_ENV: process.env.NODE_ENV,
      FRONTEND_URL: process.env.FRONTEND_URL,
      AUTH_OTP_HMAC_KEY: process.env.AUTH_OTP_HMAC_KEY,
      AUTH_CSRF_KEY: process.env.AUTH_CSRF_KEY,
    };
    process.env.NODE_ENV='production';
    process.env.FRONTEND_URL='https://app.g01.test';
    process.env.AUTH_OTP_HMAC_KEY='o'.repeat(48);
    process.env.AUTH_CSRF_KEY='c'.repeat(48);
    try {
      await withDisposableDatabase(async ({admin,app})=>{
        let onFirstSend!:()=>void;
        let finishFirstSend!:()=>void;
        const started = new Promise<void>(resolve=>{onFirstSend=resolve;});
        const hold = new Promise<void>(resolve=>{finishFirstSend=resolve;});
        const mail={
          sendOtpEmail: jest.fn()
            .mockImplementationOnce(async()=>{onFirstSend();await hold;})
            .mockResolvedValue(undefined),
        };
        const ctrl = new IdentityController(app,new InMemoryRedis() as any,
          {sendOtpSms:jest.fn()} as any,mail as any);
        const req:any={ip:'127.0.0.1',headers:{
          origin:'https://app.g01.test',
          'sec-fetch-site':'same-origin',
          'user-agent':'g01-race-test',
        },cookies:{}};
        const res:any={cookie:jest.fn(),clearCookie:jest.fn()};
        const email='resend-race@g01.example';
        const first=ctrl.requestOtp({identifier:email},req,res);
        await started;
        const latest=await ctrl.requestOtp({identifier:email},req,res);
        finishFirstSend();
        await expect(first).rejects.toMatchObject({
          response:expect.objectContaining({code:'OTP_CHALLENGE_SUPERSEDED'}),
        });
        const states=(await admin.query(
          `SELECT id,consumed_at,delivery_status
             FROM otp_challenges WHERE identifier=$1 AND purpose='LOGIN'`,
          [email])).rows;
        expect(states).toHaveLength(2);
        const earlier=states.find((x:any)=>x.id!==latest.challengeId);
        const current=states.find((x:any)=>x.id===latest.challengeId);
        expect(earlier.consumed_at).toBeTruthy();
        expect(current.delivery_status).toBe('SENT');
        expect(current.consumed_at).toBeNull();
      });
    } finally {
      for(const [k,v] of Object.entries(prior)){
        if(v===undefined) delete process.env[k];
        else process.env[k]=v;
      }
    }
  });

});
