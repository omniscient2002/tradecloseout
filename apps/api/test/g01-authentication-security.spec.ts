import { ForbiddenException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { executeReviewDecision } from '../src/modules/reviews/review-decision.service';
import { PermissionGuard } from '../src/common/guards/permission.guard';
import { ProblemJsonExceptionFilter } from '../src/common/filters/problem-json.filter';
import { DltSmsService, TransactionalMailService } from '../src/modules/identity/identity.module';
import { createHash } from 'node:crypto';
import {
  assertAuthenticationIntent, assertAuthenticationOrigin,
  assertRuntimeDatabasePrivileges, deriveSessionCsrf, hashAuthIntent, setAuthenticationIntent,
  validateAuthenticationConfig,
} from '../src/modules/identity/auth-security';
import {
  decryptFactor, encryptFactor, hashRecoveryCode, hashRecoveryCodeCandidates,
  newRecoveryCodes, newTotpSecret, verifyTotp,
} from '../src/modules/identity/mfa-crypto';

describe('G01: authentication hardening negative controls', () => {
  const originalMode = process.env.NODE_ENV;
  const originalSecret = process.env.AUTH_MFA_ENCRYPTION_KEY;
  const originalPrevious = process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
  const originalPreviousDeadline = process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT;
  const originalCsrf = process.env.AUTH_CSRF_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalMode;
    if (originalSecret === undefined) delete process.env.AUTH_MFA_ENCRYPTION_KEY;
    else process.env.AUTH_MFA_ENCRYPTION_KEY = originalSecret;
    if (originalPrevious === undefined) delete process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
    else process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS = originalPrevious;
    if (originalPreviousDeadline === undefined) delete process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT;
    else process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT = originalPreviousDeadline;
    if (originalCsrf === undefined) delete process.env.AUTH_CSRF_KEY;
    else process.env.AUTH_CSRF_KEY = originalCsrf;
    jest.restoreAllMocks();
  });

  it('G01-R5: every current member/guest authentication contract rejects unsupported fallback claims',()=>{
    const contract=readFileSync(resolve(__dirname,'../../../10-API-AND-INTEGRATIONS.md'),'utf8');
    const security=readFileSync(resolve(__dirname,'../../../13-SECURITY-PRIVACY-AND-COMPLIANCE.md'),'utf8');
    const between=(text:string,from:string,to:string)=>{
      const a=text.indexOf(from),b=text.indexOf(to,a+from.length);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThan(a);
      return text.slice(a,b);
    };
    const member=between(contract,'### 7.1 Auth and identity','### 7.2 Organisations and members');
    const guest=between(contract,'### 7.3 Parties and guests','### 7.4 Projects and contracts');
    const limits=between(contract,'## 10. Rate limits (proposed)','## 11.');
    const integrations=between(contract,'## 12. Integrations','### 12.1 Payment integration rules');
    const session=between(security,'## 6. Authentication and session security','No passwords in MVP.');
    expect(contract).toContain('original `challengeId`');
    expect(member).toContain('API-005 (withdrawn)');
    expect(member).toContain('API-006 (withdrawn)');
    expect(member).not.toContain('| API-005 | POST `/auth/magic-link/request`');
    expect(guest).toContain('no automatic channel switching or guest email fallback');
    expect(guest).toContain('does not switch to another channel');
    expect(guest).not.toContain('max 3/hr, 10/day per grant; email fallback');
    expect(limits).toContain('no automatic email fallback or alternate recipient');
    expect(limits).not.toContain('15-min cooldown; email fallback;');
    expect(integrations).toContain('No automatic SMS-to-email fallback');
    expect(integrations).not.toMatch(/fallback to email magic link after 2 failures/i);
    expect(session).toContain('Magic link (future, not implemented for member login)');
    expect(session).toContain('No current');
    expect(session).toContain('no automatic SMS-to-email fallback');
    expect(session).not.toContain('| Magic link | ≥128-bit token');
  });

  it('requires explicit production keys and HTTPS before starting the API', () => {
    const env = {
      NODE_ENV: 'production',
      APP_DATABASE_URL: 'postgres://tc_app:strong-secure-password@db:5432/tradecloseout',
      REDIS_URL: 'redis://cache:6379',
      FRONTEND_URL: 'https://app.example.com',
      DLT_SMS_URL: 'https://sms.example.com',
      DLT_SMS_API_KEY: 'mock-secret',
      DLT_SENDER_ID: 'TRDCLS',
      DLT_ENTITY_ID: 'TEST-DLT-ENTITY',
      DLT_OTP_TEMPLATE_ID: 'TEST-DLT-TEMPLATE',
      MAIL_GATEWAY_URL: 'https://mail.example.com',
      MAIL_API_KEY: 'test-mail-api-key',
      MAIL_FROM_ADDRESS: 'security@example.com',
      AUTH_OTP_HMAC_KEY: 'o'.repeat(48),
      AUTH_CSRF_KEY: 'c'.repeat(48),
      AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      AUTH_TRUSTED_PROXY_CIDRS: 'direct',
    };
    expect(() => validateAuthenticationConfig(env)).not.toThrow();
    expect(() => validateAuthenticationConfig({ ...env, NODE_ENV: undefined })).toThrow('BOOT_AUTH_ENV_INVALID');
    expect(() => validateAuthenticationConfig({ ...env, REDIS_URL: undefined })).toThrow('BOOT_AUTH_CONFIG_MISSING');
    expect(() => validateAuthenticationConfig({
      ...env, MAIL_API_KEY: undefined,
    })).toThrow('BOOT_AUTH_MAIL_CREDENTIAL_MISSING');
    expect(() => validateAuthenticationConfig({
      ...env, MAIL_FROM_ADDRESS: 'invalid-address',
    })).toThrow('BOOT_AUTH_MAIL_SENDER_INVALID');
    expect(() => validateAuthenticationConfig({
      ...env, DLT_OTP_TEMPLATE_ID: undefined,
    })).toThrow('BOOT_AUTH_CONFIG_MISSING');
    expect(() => validateAuthenticationConfig({ ...env, FRONTEND_URL: 'http://app.example.com' })).toThrow('BOOT_AUTH_HTTPS_REQUIRED');
    expect(() => validateAuthenticationConfig({ ...env, PUBLIC_APP_URL: 'http://public.example.com' })).toThrow('BOOT_AUTH_HTTPS_REQUIRED');
    expect(() => validateAuthenticationConfig({ ...env, PUBLIC_APP_URL: 'https://public.example.com/path' })).toThrow('BOOT_AUTH_ORIGIN_INVALID');
    expect(() => validateAuthenticationConfig({ ...env, PUBLIC_APP_URL: 'https://public.example.com' })).not.toThrow();
    expect(() => validateAuthenticationConfig({ ...env, AUTH_MFA_ENCRYPTION_KEY: 'bad' })).toThrow('BOOT_AUTH_MFA_ENCRYPTION_KEY_INVALID');
    expect(() => validateAuthenticationConfig({
      ...env, AUTH_MFA_ENCRYPTION_KEY_PREVIOUS: 'bad',
    })).toThrow('BOOT_AUTH_MFA_PREVIOUS_ENCRYPTION_KEY_INVALID');
    expect(() => validateAuthenticationConfig({
      ...env, AUTH_MFA_ENCRYPTION_KEY_PREVIOUS:Buffer.alloc(32,7).toString('base64'),
    })).toThrow('BOOT_AUTH_MFA_PREVIOUS_KEY_EXPIRED_OR_UNBOUNDED');
    expect(() => validateAuthenticationConfig({
      ...env, AUTH_MFA_ENCRYPTION_KEY_PREVIOUS:Buffer.alloc(32,7).toString('base64'),
      AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT:new Date(Date.now()+24*3600_000).toISOString(),
    })).not.toThrow();
    expect(() => validateAuthenticationConfig({ ...env, ENABLE_DEBUG_OTP: 'true' })).toThrow('BOOT_AUTH_DEBUG_MODE_DISABLED');
    expect(() => validateAuthenticationConfig({ ...env, AUTH_TRUSTED_PROXY_CIDRS: '0.0.0.0/0' })).toThrow('BOOT_AUTH_PROXY_SCOPE_INVALID');
    expect(() => validateAuthenticationConfig({
      ...env, AUTH_TRUSTED_PROXY_CIDRS: 'not-a-proxy',
    })).toThrow('BOOT_AUTH_PROXY_SCOPE_INVALID');
    expect(() => validateAuthenticationConfig({
      ...env, AUTH_TRUSTED_PROXY_CIDRS: '198.51.100.4/33',
    })).toThrow('BOOT_AUTH_PROXY_SCOPE_INVALID');
    expect(() => validateAuthenticationConfig({
      ...env, AUTH_TRUSTED_PROXY_CIDRS: '198.51.100.4/32',
    })).not.toThrow();
    expect(() => validateAuthenticationConfig({
      ...env, FRONTEND_URL: 'https://app.example.com/unexpected/path',
    })).toThrow('BOOT_AUTH_ORIGIN_INVALID');
    expect(() => validateAuthenticationConfig({
      ...env, MAIL_GATEWAY_URL: 'https://apikey:secret@mail.example.com',
    })).toThrow('BOOT_AUTH_HTTPS_REQUIRED');
    expect(() => validateAuthenticationConfig({
      ...env, APP_DATABASE_URL: 'not-a-database-url',
    })).toThrow('BOOT_AUTH_DATABASE_URL_INVALID');
  });

  it('checks real database role privileges before serving production HTTP', async () => {
    const make = (role:any) => ({
      query: jest.fn().mockResolvedValue({rows:[role]}),
    }) as any;
    await expect(assertRuntimeDatabasePrivileges(make({
      role_name:'tc_app',rolsuper:false,rolbypassrls:false,
      can_assume_migrator:false,
    }))).resolves.toBeUndefined();
    for (const invalid of [
      {role_name:'postgres',rolsuper:true,rolbypassrls:true,can_assume_migrator:true},
      {role_name:'tc_app',rolsuper:false,rolbypassrls:true,can_assume_migrator:false},
      {role_name:'tc_app',rolsuper:false,rolbypassrls:false,can_assume_migrator:true},
      {role_name:'custom_tc_runtime',rolsuper:false,rolbypassrls:false,
        can_assume_migrator:false,can_approve_external_authority:true},
      {role_name:'tc_migrator',rolsuper:false,rolbypassrls:false,can_assume_migrator:false},
    ]) {
      await expect(assertRuntimeDatabasePrivileges(make(invalid)))
        .rejects.toThrow('BOOT_AUTH_RUNTIME_ROLE_PRIVILEGED');
    }
  });

  it('rejects cross-site and untrusted login origins rather than trusting CORS alone', () => {
    process.env.NODE_ENV = 'production';
    const oldFrontend = process.env.FRONTEND_URL;
    const oldPublicApp = process.env.PUBLIC_APP_URL;
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.PUBLIC_APP_URL = 'http://insecure.example.com';
    try {
      expect(() => assertAuthenticationOrigin({ headers: {
        origin: 'https://app.example.com',
        'sec-fetch-site': 'same-origin',
      } } as any)).not.toThrow();
      for (const headers of [
        { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
        { origin: 'https://attacker.example', 'sec-fetch-site': 'same-site' },
        { origin: 'https://app.example.com', 'sec-fetch-site': 'cross-site' },
        { origin: 'http://insecure.example.com', 'sec-fetch-site': 'same-origin' },
        { 'sec-fetch-site': 'cross-site' },
        {},
      ]) expect(() => assertAuthenticationOrigin({ headers } as any)).toThrow(ForbiddenException);
    } finally {
      if (oldFrontend === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = oldFrontend;
      if (oldPublicApp === undefined) delete process.env.PUBLIC_APP_URL;
      else process.env.PUBLIC_APP_URL = oldPublicApp;
    }
  });

  it('binds the first-factor proof to the original browser intent cookie', () => {
    const res = { cookie: jest.fn() };
    const hash = setAuthenticationIntent(res as any);
    const cookieValue = res.cookie.mock.calls[0][1] as string;
    expect(hash).toBe(hashAuthIntent(cookieValue));
    expect(() => assertAuthenticationIntent({ cookies: { tc_auth_intent: cookieValue } }, hash)).not.toThrow();
    expect(() => assertAuthenticationIntent({ cookies: { tc_auth_intent: 'forged' } }, hash)).toThrow(ForbiddenException);
    expect(() => assertAuthenticationIntent({ cookies: {} }, hash)).toThrow(ForbiddenException);
    const secondResponse = { cookie: jest.fn() };
    const sameBrowserHash = setAuthenticationIntent(
      secondResponse as any, { cookies: { tc_auth_intent: cookieValue } },
    );
    expect(sameBrowserHash).toBe(hash);
    expect(secondResponse.cookie).not.toHaveBeenCalled();
    const thirdResponse = { cookie: jest.fn() };
    const differentBrowserHash = setAuthenticationIntent(thirdResponse as any, { cookies: {} });
    expect(differentBrowserHash).not.toBe(hash);
  });

  it('binds restored CSRF to the current cookie and auth generation', () => {
    const rawToken = 't'.repeat(64);
    const gen = '01999999-9999-7999-8999-999999999999';
    const first = deriveSessionCsrf(rawToken, gen);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(deriveSessionCsrf(rawToken, gen));
    expect(first).not.toBe(deriveSessionCsrf('u'.repeat(64), gen));
    expect(first).not.toBe(deriveSessionCsrf(rawToken, '01999999-9999-7999-8999-999999999998'));
  });

  it('encrypts TOTP secrets with an authenticated envelope and rejects tampering', () => {
    process.env.AUTH_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const envelope = encryptFactor(secret);
    expect(envelope).not.toContain(secret);
    expect(decryptFactor(envelope)).toBe(secret);
    const parts = envelope.split(':');
    parts[3] = Buffer.alloc(20, 11).toString('base64');
    expect(() => decryptFactor(parts.join(':'))).toThrow();
  });

  it('rejects TOTP replay, incorrect codes and malformed inputs', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(59_000);
    const rfcKey = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    // RFC6238 (six-digit truncation of the 8-digit vector at 59s).
    expect(verifyTotp(rfcKey, '287082')).toBe(1);
    expect(verifyTotp(rfcKey, '287082', 1)).toBeNull();
    expect(verifyTotp(rfcKey, '000000')).toBeNull();
    expect(verifyTotp(rfcKey, 'not-a-code')).toBeNull();
    now.mockRestore();
  });

  it('rejects privileged read requests before second-factor verification in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const session:any = {
        session_id: 's1', user_id: 'u1', active_org_id: 'o1',
        csrf_token_hash: 'a'.repeat(64), auth_generation: 'gen1',
        expires_at: new Date(Date.now()+86_400_000).toISOString(),
        absolute_expires_at: new Date(Date.now()+86_400_000).toISOString(),
        last_activity_at: new Date().toISOString(),
        user_status: 'ACTIVE', org_status: 'ACTIVE', user_name: 'Owner',
        mfa_verified: false, mfa_verified_at: null, guest_grant_id: null,
      };
      const client = {
        query: jest.fn(async (sql:string) => sql.includes('FROM memberships')
          ? {rows:[{org_role:'R-OWNER',membership_status:'ACTIVE'}]}
          : {rows:[]}),
        release: jest.fn(),
      };
      const pool = {
        query: jest.fn().mockResolvedValue({rows:[session]}),
        connect: jest.fn().mockResolvedValue(client),
      };
      const guard=new SessionCsrfGuard(pool as any);
      const make = (path:string):any => ({
        cookies: {tc_session:'opaque-test-cookie'}, headers: {}, method:'GET',
        params:{}, path, ip:'127.0.0.1',
      });
      const invoke=(path:string)=>guard.canActivate({
        switchToHttp:()=>({getRequest:()=>make(path)}),
      } as any);
      await expect(invoke('/api/v1/projects')).rejects.toMatchObject({
        response: expect.objectContaining({code:'MFA_STEP_UP_REQUIRED'}),
      });
      await expect(invoke('/api/v1/auth/me')).resolves.toBe(true);
      await expect(invoke('/api/v1/auth/mfa/status')).resolves.toBe(true);
      await expect(invoke('/api/v1/auth/sessions')).resolves.toBe(true);
      // New auth-prefixed endpoints do not automatically inherit the
      // pre-MFA escape hatch: protect their privileged reads by default.
      await expect(invoke('/api/v1/auth/internal-admin')).rejects.toMatchObject({
        response: expect.objectContaining({code:'MFA_STEP_UP_REQUIRED'}),
      });
      await expect(invoke('/api/v1/auth/me/extra')).rejects.toMatchObject({
        response: expect.objectContaining({code:'MFA_STEP_UP_REQUIRED'}),
      });
      session.mfa_verified=true;
      session.mfa_verified_at=new Date().toISOString();
      await expect(invoke('/api/v1/projects')).resolves.toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM sessions s'),
        [createHash('sha256').update('opaque-test-cookie').digest('hex')],
      );
    } finally {
      if (previous===undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV=previous;
    }
  });

  it('requires independent guest authority for binding consultant review decisions', async () => {
    const reflector:any={getAllAndOverride:jest.fn().mockReturnValue('review.decide')};
    const pool:any={connect:jest.fn()};
    const guard=new PermissionGuard(reflector,pool);
    const req:any={
      method:'POST',path:'/api/v1/projects/project-1/reviews/decision',
      params:{projectId:'project-1'},
      user:{
        orgRole:'GUEST',guestGrantId:'guest-1',guestProjectId:'project-1',
        guestCapabilities:['review.decide'],guestAuthorityVerified:false,
      },
    };
    const context:any={
      getHandler:()=>({}),getClass:()=>({}),
      switchToHttp:()=>({getRequest:()=>req}),
    };
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response:expect.objectContaining({code:'INDEPENDENT_PARTY_AUTHORITY_REQUIRED'}),
    });
    req.user.guestAuthorityVerified=true;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('redacts external delivery-provider exceptions from customer-visible HTTP responses', async () => {
    const previous = {
      DLT_SMS_URL:process.env.DLT_SMS_URL,
      DLT_SMS_API_KEY:process.env.DLT_SMS_API_KEY,
      MAIL_GATEWAY_URL:process.env.MAIL_GATEWAY_URL,
      MAIL_API_KEY:process.env.MAIL_API_KEY,
    };
    const originalFetch=global.fetch;
    process.env.DLT_SMS_URL='https://sms.g01.test';
    process.env.DLT_SMS_API_KEY='g01-auth-test';
    process.env.MAIL_GATEWAY_URL='https://mail.g01.test';
    process.env.MAIL_API_KEY='g01-mail-test';
    global.fetch=jest.fn().mockRejectedValue(
      new Error('Provider denied OTP 634219 for client@g01.test'),
    ) as any;
    try {
      const failures: any[] = [];
      try { await new DltSmsService().sendOtpSms('+919999999999','634219','TEMPLATE'); }
      catch (error) { failures.push(error); }
      try { await new TransactionalMailService().sendOtpEmail('client@g01.test','634219','LOGIN'); }
      catch (error) { failures.push(error); }
      try { await new TransactionalMailService().sendMagicLinkEmail('client@g01.test','https://invite.g01.test/secret-token'); }
      catch (error) { failures.push(error); }
      expect(failures).toHaveLength(3);
      for (const error of failures) {
        const message=JSON.stringify(error?.getResponse?.());
        expect(message).not.toContain('634219');
        expect(message).not.toContain('client@g01.test');
        expect(message).not.toContain('secret-token');
        expect(error?.getStatus?.()).toBe(503);
      }
    } finally {
      global.fetch=originalFetch;
      for (const [key,value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key]=value;
      }
    }
  });

  it('rejects the legacy unaudited external-decision helper in production',async()=>{
    const saved=process.env.NODE_ENV;
    process.env.NODE_ENV='production';
    try{
      const db:any={query:jest.fn()};
      await expect(executeReviewDecision(db,{
        userId:'actor-1',activeOrgId:'org-1',orgRole:'R-OWNER',
        projectRoles:[],ip:'127.0.0.1',userAgent:'g01',requestId:'g01',
      },{
        projectId:'project-1',documentVersionId:'version-1',
        expectedRowVersion:1,method:'EXTERNAL',decision:'APPROVE',
      })).rejects.toMatchObject({
        response:expect.objectContaining({
          code:'EXTERNAL_REVIEW_REQUIRES_INDEPENDENT_EVIDENCE_WORKFLOW',
        }),
      });
      expect(db.query).not.toHaveBeenCalled();
    }finally{
      if(saved===undefined)delete process.env.NODE_ENV;
      else process.env.NODE_ENV=saved;
    }
  });

  it('returns a safe 409 when a session changes before a transaction can commit',()=>{
    const filter = new ProblemJsonExceptionFilter();
    const output:any={setHeader:jest.fn(),status:jest.fn().mockReturnThis(),json:jest.fn()};
    const host:any={switchToHttp:()=>({
      getResponse:()=>output,
      getRequest:()=>({path:'/api/v1/projects',headers:{'x-request-id':'session-test'}}),
    })};
    filter.catch(new Error('AUTH_SESSION_CONTEXT_CHANGED'),host);
    expect(output.status).toHaveBeenCalledWith(409);
    expect(output.json.mock.calls[0][0]).toMatchObject({
      code:'AUTH_CONTEXT_CHANGED',status:409,requestId:'session-test',
    });
  });

  it('never logs raw invitation tokens, verification codes or provider stack traces', () => {
    const filter = new ProblemJsonExceptionFilter();
    const write = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});
    const output:any={setHeader:jest.fn(),status:jest.fn().mockReturnThis(),json:jest.fn()};
    const invitation = '9'.repeat(64);
    const host:any={switchToHttp:()=>({
      getResponse:()=>output,
      getRequest:()=>({
        path:`/api/v1/guest/${invitation}/otp/verify`,
        headers:{'x-request-id':'header-with\\nnewline'},
      }),
    })};
    const secretError = new Error(`OTP 638194 at /api/v1/guest/${invitation}`);
    filter.catch(secretError,host);
    const logged=JSON.stringify(write.mock.calls);
    expect(logged).not.toContain('638194');
    expect(logged).not.toContain(invitation);
    expect(logged).not.toContain('header-with');
    expect(logged).toContain('req_unknown');
    expect(output.status).toHaveBeenCalledWith(500);
    expect(output.json.mock.calls[0][0]).toMatchObject({
      code:'INTERNAL_ERROR',requestId:'req_unknown',
    });
  });

  it('stages MFA encryption and recovery-code rotation without losing legacy factors', () => {
    const previous = Buffer.alloc(32, 7).toString('base64');
    const current = Buffer.alloc(32, 8).toString('base64');
    process.env.AUTH_MFA_ENCRYPTION_KEY=previous;
    delete process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
    const secret=newTotpSecret();
    const oldCiphertext=encryptFactor(secret);
    const backup='A'.repeat(24);
    const oldBackupHash=hashRecoveryCode(backup);
    process.env.AUTH_MFA_ENCRYPTION_KEY=current;
    process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS=previous;
    process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT=new Date(Date.now()+24*3600_000).toISOString();
    expect(decryptFactor(oldCiphertext)).toBe(secret);
    expect(hashRecoveryCodeCandidates(backup)).toContain(oldBackupHash);
    expect(hashRecoveryCodeCandidates(backup)).toContain(hashRecoveryCode(backup));
    const rewrapped=encryptFactor(decryptFactor(oldCiphertext));
    delete process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
    expect(decryptFactor(rewrapped)).toBe(secret);
    expect(() => decryptFactor(oldCiphertext)).toThrow('MFA_FACTOR_DECRYPT_FAILED');
    expect(hashRecoveryCodeCandidates(backup)).not.toContain(oldBackupHash);
  });

  it('issues distinct high-entropy recovery codes and stores only keyed hashes', () => {
    process.env.AUTH_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{24}$/);
      expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
      expect(hashRecoveryCode(code)).not.toBe(code);
    }
  });
});
