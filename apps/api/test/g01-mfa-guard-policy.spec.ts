import { createHash } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { MfaController } from '../src/modules/identity/mfa.controller';
import { OMIT_GENERIC_IDEMPOTENCY_RECEIPT } from '../src/common/decorators/no-generic-idempotency-receipt.decorator';

describe('PH1-G01 privileged MFA gate and secret-bearing endpoint contract', () => {
  const original = process.env.NODE_ENV;
  const originalOverride = process.env.AUTH_REQUIRE_PRIVILEGED_MFA;
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_REQUIRE_PRIVILEGED_MFA;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
    if (originalOverride === undefined) delete process.env.AUTH_REQUIRE_PRIVILEGED_MFA;
    else process.env.AUTH_REQUIRE_PRIVILEGED_MFA = originalOverride;
  });

  function fixture(opts: { role?: string; verified?: boolean; method?: string; path?: string } = {}) {
    const csrf = 'correct-csrf';
    const member = { role: opts.role ?? 'R-OWNER', membership_status: 'ACTIVE' };
    const session = {
      session_id: 'session-123', user_id: 'user-123', active_org_id: 'org-123',
      csrf_token_hash: createHash('sha256').update(csrf).digest('hex'),
      expires_at: '2099-12-31', guest_grant_id: null,
      user_name: 'Member', user_status: 'ACTIVE', org_status: 'ACTIVE',
      mfa_verified: opts.verified ?? false,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM memberships')) return { rows: [member] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const pool = {
      query: jest.fn(async () => ({ rows: [session] })),
      connect: jest.fn(async () => client),
    };
    const path = opts.path ?? '/api/v1/projects';
    const method = opts.method ?? 'GET';
    const req: any = {
      method, path, originalUrl: path, params: {}, headers: {
        ...(method === 'POST' ? { 'x-csrf-token': csrf } : {}),
      },
      cookies: { tc_session: 'opaque-session' },
    };
    const guard = new SessionCsrfGuard(pool as any);
    return { guard, req, client, context: { switchToHttp: () => ({ getRequest: () => req }) } as any };
  }

  it('blocks default privileged project routes and unknown auth routes before a second factor', async () => {
    for (const path of ['/api/v1/projects', '/api/v1/auth/new-admin-route']) {
      const { guard, context } = fixture({ path });
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        response: { code: 'MFA_STEP_UP_REQUIRED' },
      });
    }
  });

  it('permits only explicitly reviewed bootstrap and recovery routes before MFA', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/auth/me'],
      ['GET', '/api/v1/auth/orgs'],
      ['GET', '/api/v1/auth/mfa/status'],
      ['POST', '/api/v1/auth/mfa/enroll/start'],
      ['POST', '/api/v1/auth/mfa/enroll/confirm'],
      ['POST', '/api/v1/auth/mfa/enroll/cancel'],
      ['POST', '/api/v1/auth/mfa/verify'],
      ['POST', '/api/v1/auth/mfa/recovery'],
      ['POST', '/api/v1/auth/logout'],
    ]) {
      const { guard, context, req } = fixture({ method, path });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(req.auth.mfaVerified).toBe(false);
    }
  });

  it('allows verified privileged sessions, and does not impose owner MFA on ordinary members', async () => {
    const owner = fixture({ verified: true });
    await expect(owner.guard.canActivate(owner.context)).resolves.toBe(true);
    expect(owner.req.auth.mfaVerified).toBe(true);

    const ordinary = fixture({ role: 'R-SITE' });
    await expect(ordinary.guard.canActivate(ordinary.context)).resolves.toBe(true);
  });

  it('does not let a missing CSRF header bypass protection on MFA actions', async () => {
    const { guard, context, req } = fixture({
      method: 'POST', path: '/api/v1/auth/mfa/enroll/start',
    });
    delete req.headers['x-csrf-token'];
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'CSRF_TOKEN_MISSING' },
    });
  });

  it('exempts all factor and recovery endpoints from generic plaintext idempotency receipts', () => {
    const reflector = new Reflector();
    for (const method of [
      MfaController.prototype.begin, MfaController.prototype.confirm,
      MfaController.prototype.cancel, MfaController.prototype.verify,
      MfaController.prototype.recover,
    ]) {
      expect(reflector.getAllAndOverride(OMIT_GENERIC_IDEMPOTENCY_RECEIPT, [
        method, MfaController,
      ])).toBe(true);
    }
  });
});
