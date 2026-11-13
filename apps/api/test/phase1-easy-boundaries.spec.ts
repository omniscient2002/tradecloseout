import { randomUUID, createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { requestCorrelationId, requestCorrelationMiddleware } from '../src/common/middleware/request-correlation.middleware';
import { ProblemJsonExceptionFilter } from '../src/common/filters/problem-json.filter';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { PermissionGuard } from '../src/common/guards/permission.guard';
import { MfaController } from '../src/modules/identity/mfa.controller';
import { MfaEnrollmentStore } from '../src/modules/identity/mfa-enrollment-store';

const context = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) }) as any;

describe('Phase 1 small boundary repairs', () => {
  it.each([undefined, null, ['bad'], 'x'.repeat(129), 'bad\r\nsecret', 'OTP_123456_INVITE_abcdef0123456789'])('normalizes rejected correlation %j before auth and error logging', async raw => {
    const req: any = { headers: { 'x-request-id': raw }, params: {}, method: 'GET', cookies: {} };
    const res: any = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requestCorrelationMiddleware(req, res, next);
    const id = req.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(next).toHaveBeenCalledTimes(1);
    await expect(new SessionCsrfGuard({} as any).canActivate(context(req))).rejects.toThrow();
    const filter = new ProblemJsonExceptionFilter();
    const logger = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    filter.catch(new Error('fixture-secret'), { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any);
    expect(res.json.mock.calls[0][0].requestId).toBe(id);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
    if (typeof raw === 'string') expect(JSON.stringify(logger.mock.calls)).not.toContain(raw);
    expect(req.headers['x-request-id']).not.toContain('OTP_');
    logger.mockRestore();
  });

  it('keeps valid UUID correlation and cannot replace an established ID', () => {
    const id = randomUUID(); const req = { headers: { 'x-request-id': id.toUpperCase() } };
    expect(requestCorrelationId(req)).toBe(id);
    req.headers['x-request-id'] = 'OTP_654321';
    expect(requestCorrelationId(req)).toBe(id);
  });

  it('denies missing permission policy before any pool work and admits an explicit policy', async () => {
    const pool = { connect: jest.fn(), query: jest.fn() };
    await expect(new PermissionGuard({ getAllAndOverride: () => undefined } as any, pool as any).canActivate(context({})))
      .rejects.toMatchObject({ response: { code: 'PERMISSION_POLICY_REQUIRED' } });
    await expect(new PermissionGuard({ getAllAndOverride: () => 'org.manage' } as any, pool as any)
      .canActivate(context({ user: { orgRole: 'R-OWNER' }, params: {} }))).resolves.toBe(true);
    expect(pool.connect).not.toHaveBeenCalled(); expect(pool.query).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', '-'.repeat(36), ['bad'], null])('rejects malformed route IDs before database access: %j', async id => {
    const pool = { query: jest.fn(), connect: jest.fn() };
    for (const param of ['projectId', 'id', 'recipientId', 'exportId', 'contractId', 'userId', 'versionId']) {
      const req = { headers: {}, params: { [param]: id }, user: { orgRole: 'R-OWNER' } };
      await expect(new SessionCsrfGuard(pool as any).canActivate(context(req))).rejects.toBeInstanceOf(BadRequestException);
      await expect(new PermissionGuard({ getAllAndOverride: () => 'asset.manage' } as any, pool as any).canActivate(context(req)))
        .rejects.toMatchObject({ response: { code: 'INVALID_RESOURCE_ID' } });
      expect(pool.query).not.toHaveBeenCalled(); expect(pool.connect).not.toHaveBeenCalled();
    }
  });

  it.each(['bad', '-'.repeat(36), 'a'.repeat(36), '', '00000000-0000-0000-0000-000000000000'])('rejects malformed MFA proposal before rate-budget or DB work: %s', async proposalId => {
    const db = { withUserContext: jest.fn() };
    const req: any = { auth: { userId: randomUUID(), activeOrgId: randomUUID(), sessionId: randomUUID() }, cookies: { tc_session: 'f'.repeat(64) } };
    const controller = new MfaController(db as any);
    await expect(controller.confirm(req, { proposalId, code: '123456' }, {} as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.cancel(req, { proposalId })).rejects.toBeInstanceOf(BadRequestException);
    const ctx = { userId: req.auth.userId, activeOrgId: req.auth.activeOrgId, sessionId: req.auth.sessionId, sessionTokenHash: 'a'.repeat(64) };
    await expect(new MfaEnrollmentStore(db as any).cancel(ctx, proposalId)).rejects.toThrow();
    await expect(new MfaEnrollmentStore(db as any).confirm(ctx, proposalId, '123456')).rejects.toThrow();
    expect(db.withUserContext).not.toHaveBeenCalled();
  });

  it.each([[true, false], [false, false], [true, true]])('loads the organisation download toggle %s without lending it to guests %s', async (enabled, guest) => {
    const csrf = createHash('sha256').update('csrf').digest('hex');
    const client = { query: jest.fn(async (sql: string) => ({ rows: sql.includes('FROM guest_grants') ? [{ status: 'ACTIVE', expires_at: '2099-01-01', capabilities: ['document.read'], scope_json: {}, project_id: randomUUID() }] : [{ org_role: 'R-DOC', membership_status: 'ACTIVE' }] })), release: jest.fn() };
    const pool = { query: jest.fn(async (_sql: string) => ({ rows: [{ session_id: randomUUID(), user_id: randomUUID(), active_org_id: randomUUID(),
      user_status: 'ACTIVE', org_status: 'ACTIVE', expires_at: '2099-01-01', csrf_token_hash: csrf,
      doc_controller_org_wide_download: enabled, guest_grant_id: guest ? randomUUID() : null }] })), connect: async () => client };
    const req: any = { method: 'GET', headers: {}, params: {}, cookies: { tc_session: 'opaque' }, path: '/api/v1/documents' };
    await new SessionCsrfGuard(pool as any).canActivate(context(req));
    expect(pool.query.mock.calls[0][0]).toContain('o.doc_controller_org_wide_download');
    expect(req.user.docControllerOrgWideDownload).toBe(enabled && !guest);
  });
});
