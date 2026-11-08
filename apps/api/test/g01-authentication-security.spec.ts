import { ForbiddenException } from '@nestjs/common';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { createHash } from 'node:crypto';
import {
  assertAuthenticationIntent, assertAuthenticationOrigin,
  assertRuntimeDatabasePrivileges, deriveSessionCsrf, hashAuthIntent, setAuthenticationIntent,
  validateAuthenticationConfig,
} from '../src/modules/identity/auth-security';
import {
  decryptFactor, encryptFactor, hashRecoveryCode,
  newRecoveryCodes, newTotpSecret, verifyTotp,
} from '../src/modules/identity/mfa-crypto';

describe('G01: authentication hardening negative controls', () => {
  const originalMode = process.env.NODE_ENV;
  const originalSecret = process.env.AUTH_MFA_ENCRYPTION_KEY;
  const originalCsrf = process.env.AUTH_CSRF_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalMode;
    if (originalSecret === undefined) delete process.env.AUTH_MFA_ENCRYPTION_KEY;
    else process.env.AUTH_MFA_ENCRYPTION_KEY = originalSecret;
    if (originalCsrf === undefined) delete process.env.AUTH_CSRF_KEY;
    else process.env.AUTH_CSRF_KEY = originalCsrf;
    jest.restoreAllMocks();
  });

  it('requires explicit production keys and HTTPS before starting the API', () => {
    const env = {
      NODE_ENV: 'production',
      APP_DATABASE_URL: 'postgres://tc_app:strong-secure-password@db:5432/tradecloseout',
      REDIS_URL: 'redis://cache:6379',
      FRONTEND_URL: 'https://app.example.com',
      DLT_SMS_URL: 'https://sms.example.com',
      DLT_SMS_API_KEY: 'mock-secret',
      MAIL_GATEWAY_URL: 'https://mail.example.com',
      AUTH_OTP_HMAC_KEY: 'o'.repeat(48),
      AUTH_CSRF_KEY: 'c'.repeat(48),
      AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      AUTH_TRUSTED_PROXY_CIDRS: 'direct',
    };
    expect(() => validateAuthenticationConfig(env)).not.toThrow();
    expect(() => validateAuthenticationConfig({ ...env, NODE_ENV: undefined })).toThrow('BOOT_AUTH_ENV_INVALID');
    expect(() => validateAuthenticationConfig({ ...env, REDIS_URL: undefined })).toThrow('BOOT_AUTH_CONFIG_MISSING');
    expect(() => validateAuthenticationConfig({ ...env, FRONTEND_URL: 'http://app.example.com' })).toThrow('BOOT_AUTH_HTTPS_REQUIRED');
    expect(() => validateAuthenticationConfig({ ...env, AUTH_MFA_ENCRYPTION_KEY: 'bad' })).toThrow('BOOT_AUTH_MFA_ENCRYPTION_KEY_INVALID');
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
      {role_name:'tc_migrator',rolsuper:false,rolbypassrls:false,can_assume_migrator:false},
    ]) {
      await expect(assertRuntimeDatabasePrivileges(make(invalid)))
        .rejects.toThrow('BOOT_AUTH_RUNTIME_ROLE_PRIVILEGED');
    }
  });

  it('rejects cross-site and untrusted login origins rather than trusting CORS alone', () => {
    process.env.NODE_ENV = 'production';
    const oldFrontend = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.example.com';
    try {
      expect(() => assertAuthenticationOrigin({ headers: {
        origin: 'https://app.example.com',
        'sec-fetch-site': 'same-origin',
      } } as any)).not.toThrow();
      for (const headers of [
        { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
        { origin: 'https://attacker.example', 'sec-fetch-site': 'same-site' },
        { origin: 'https://app.example.com', 'sec-fetch-site': 'cross-site' },
        { 'sec-fetch-site': 'cross-site' },
        {},
      ]) expect(() => assertAuthenticationOrigin({ headers } as any)).toThrow(ForbiddenException);
    } finally {
      if (oldFrontend === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = oldFrontend;
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
