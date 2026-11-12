import { ConflictException } from '@nestjs/common';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { hashRequestPayload } from '@tradecloseout/db';

describe('expired idempotency claims', () => {
  it('does not take over a receipt whose command outcome is still unknown', async () => {
    const request = {
      method: 'POST', headers: { 'idempotency-key': 'pending-key' },
      baseUrl: '/api/v1', route: { path: '/projects/:projectId/packages' },
      body: {}, params: { projectId: 'project-1' }, query: {},
      auth: { activeOrgId: 'org-1', userId: 'user-1' },
    };
    const requestHash = hashRequestPayload({
      body: request.body, params: request.params, query: request.query, actorId: 'user-1',
    });
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('INSERT INTO idempotency_keys')) return { rows: [] };
        if (sql.includes('SELECT request_hash')) {
          return { rows: [{ request_hash: requestHash, response_status: 0, response_json: {} }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const interceptor = new IdempotencyInterceptor(
      { connect: jest.fn().mockResolvedValue(client) } as any,
      { getAllAndOverride: jest.fn((key: string) => key === 'REQUIRE_IDEMPOTENCY') } as any,
    );
    const next = { handle: jest.fn() };
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
      getHandler: () => ({}), getClass: () => ({}),
    };

    await expect(interceptor.intercept(context as any, next as any)).rejects.toBeInstanceOf(ConflictException);
    expect(next.handle).not.toHaveBeenCalled();
    expect(queries.find((sql) => sql.includes('INSERT INTO idempotency_keys')))
      .toContain('idempotency_keys.response_status <> 0');
    expect(queries.find((sql) => sql.includes('SELECT request_hash')))
      .not.toContain('expires_at > now()');
  });
});
