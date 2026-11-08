import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { PartiesService } from '../src/modules/parties/parties.service';

describe('guest session boundaries', () => {
  it('loads an active session grant with tenant settings on the same connection', async () => {
    const statements: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM guest_grants')) return { rows: [{ role: 'R-SUPPLIER-OEM', capabilities: ['document.upload'], scope_json: {}, status: 'ACTIVE', expires_at: '2099-01-01', principal_user_id: 'user-1', independent_authority_verified_at: null }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [{ session_id: 'session-1', user_id: 'user-1', active_org_id: 'org-1',
        guest_grant_id: 'grant-1', user_name: 'Guest', user_status: 'ACTIVE', org_status: 'ACTIVE', expires_at: '2099-01-01' }] }),
      connect: jest.fn().mockResolvedValue(client),
    };
    const req: any = { cookies: { tc_session: 'opaque-token' }, headers: {}, method: 'GET', params: {}, path: '/api/v1/guest/me/context' };
    const guard = new SessionCsrfGuard(pool as any);
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any)).resolves.toBe(true);
    expect(statements.findIndex((sql) => sql.includes("set_config('app.current_org'")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes('FROM guest_grants')));
    expect(req.userContext.guestGrantId).toBe('grant-1');
  });

  it('does not create bearer-only sessions for legacy grants', async () => {
    const service = new PartiesService({} as any);
    await expect(service.createGuestSession('legacy-token')).rejects.toMatchObject({ response: { code: 'OTP_REQUIRED' } });
  });

  it('returns an allowlisted public link response without raw contact or assigned requirements', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM guest_grants')) return { rows: [{ id: 'grant-1', org_id: 'org-1', project_id: 'project-1',
        grant_type: 'SUPPLIER_UPLOAD', target_email: 'private@example.com', target_phone_e164: '+919999999999',
        scope_json: { requirementIds: ['requirement-1'] }, otp_required: false }] };
      if (sql.includes('FROM organisations')) return { rows: [{ contractor_name: 'Contractor', project_name: 'Project', project_code: 'P1' }] };
      return { rows: [] };
    });
    const service = new PartiesService({ withTokenContext: async (_token: string, work: any) => work({ query }) } as any);
    const result = await service.getGuestGrant('opaque-token');
    expect(result.otpRequired).toBe(true);
    expect(result.otpVerified).toBe(false);
    expect(result).not.toHaveProperty('target_email');
    expect(result).not.toHaveProperty('scope_json');
    expect(result).not.toHaveProperty('assignedRequirements');
  });

  it('rejects OTP verification without a valid challenge identifier', async () => {
    const service = new PartiesService({} as any);
    await expect(service.verifyGuestOtp('opaque-token', '123456', 'invalid'))
      .rejects.toThrow('INVALID_CHALLENGE_OR_CODE');
  });

  it('commits an invalid-code attempt before returning the authentication error', async () => {
    const statements: string[] = [];
    const grant = { id: 'grant-1', org_id: 'org-1', failed_otp_count: 1, cooldown_until: null };
    const client = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes('SELECT * FROM guest_grants')) return { rows: [grant] };
        if (sql.includes('SELECT * FROM otp_challenges')) return { rows: [{ id: 'challenge-1', code_hash: 'wrong-hash' }] };
        return { rows: [] };
      }),
    };
    let committed = false;
    const service = new PartiesService({ withTokenContext: async (_token: string, work: any) => {
      const result = await work(client);
      committed = true;
      return result;
    } } as any);
    await expect(service.verifyGuestOtp('opaque-token', '123456', '0192e3a0-0000-7000-8000-000000000001'))
      .rejects.toThrow('INVALID_OTP_CODE');
    expect(committed).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE guest_grants SET failed_otp_count'))).toBe(true);
    expect(statements.some((sql) => sql.includes('INSERT INTO sessions'))).toBe(false);
  });
});
