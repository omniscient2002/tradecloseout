import { firstValueFrom, from } from 'rxjs';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { TradeCloseoutScheduler } from '../../worker/src/scheduler';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { scoped, seedTenants } from '../../../packages/db/test/helpers/fixtures';

describe('TX-05/06: receipt persistence failure and cleanup', () => {
  it('preserves the claim and refuses replay after the business transaction already committed', async () => {
    await withDisposableDatabase(async ({ app, admin }) => {
      const { userId, tenants: [tenant] } = await seedTenants(admin);
      const projectId = tenant.projectIds[0];
      const request = { method: 'POST', headers: { 'idempotency-key': 'committed-command' },
        baseUrl: '/api/v1', route: { path: '/test-command' }, body: {}, params: {}, query: {},
        auth: { activeOrgId: tenant.orgId, userId } };
      const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
        getHandler: () => ({}), getClass: () => ({}) } as any;
      const reflector = { getAllAndOverride: (key: string) => key === 'REQUIRE_IDEMPOTENCY' } as any;
      // Simulates losing the receipt store after the handler's real transaction commits.
      const failedReceiptPool = { connect: async () => {
        const client = await app.connect();
        return { release: () => client.release(), query: (sql: string, values: any[]) => {
          if (/UPDATE idempotency_keys/.test(sql)) throw new Error('INJECTED_RECEIPT_FAILURE');
          return client.query(sql, values);
        } };
      } } as any;
      const handler = { handle: jest.fn(() => from(scoped(app, tenant.orgId, async client => {
        await client.query('UPDATE projects SET row_version = row_version + 1 WHERE id = $1', [projectId]);
        return { projectId };
      }))) };
      const first = new IdempotencyInterceptor(failedReceiptPool, reflector);
      await expect(firstValueFrom(await first.intercept(context, handler))).rejects.toThrow('INJECTED_RECEIPT_FAILURE');
      await admin.query(`UPDATE idempotency_keys SET expires_at = now() - interval '1 day', created_at = now() - interval '2 days'`);
      await new TradeCloseoutScheduler(app, {} as any).reconcileIdempotencyClaims();
      const replay = new IdempotencyInterceptor(app, reflector);
      await expect(replay.intercept(context, handler)).rejects.toMatchObject({ response: { code: 'REQUEST_IN_PROGRESS' } });
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect((await admin.query('SELECT row_version FROM projects WHERE id = $1', [projectId])).rows[0].row_version).toBe(2);
      expect((await admin.query('SELECT response_status FROM idempotency_keys')).rows).toEqual([{ response_status: 0 }]);
    });
  }, 30_000);
});
