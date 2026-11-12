import { TenantDbService } from '../src/database/tenant-db.service';

describe('PH1-G26-006: API tenant transaction connection hygiene', () => {
  const context = {
    orgId: 'tenant-id',
    userId: 'user-id',
    actorType: 'USER' as const,
    requestId: 'test-id',
  };

  it.each(['tenant', 'user', 'token'] as const)(
    '%s context destroys a poisoned connection without masking its original error',
    async kind => {
      const failure = new Error('query failed');
      const cleanupFailure = new Error('rollback failed');
      const sql: string[] = [];
      const client = {
        query: jest.fn(async (query: string) => {
          sql.push(query);
          if (query === 'SELECT fail') throw failure;
          if (query === 'ROLLBACK') throw cleanupFailure;
          return { rows: [] };
        }),
        release: jest.fn(),
      };
      const service = new TenantDbService({ connect: async () => client });
      const task = async (tx: any) => { await tx.query('SELECT fail'); };
      const operation = kind === 'tenant'
        ? service.withTenantContext(context, task)
        : kind === 'user'
          ? service.withUserContext(context.userId, task)
          : service.withTokenContext('opaque-token-hash', task);

      await expect(operation).rejects.toBe(failure);
      expect(sql).toContain('ROLLBACK');
      expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
      expect(sql).toContain("SET LOCAL statement_timeout = '60s'");
      expect(sql).toContain("SET LOCAL idle_in_transaction_session_timeout = '60s'");
      expect(client.release).toHaveBeenCalledTimes(1);
      expect(client.release).toHaveBeenCalledWith(true);
    },
  );

  it('discards an API client whose COMMIT acknowledgement failed', async () => {
    const failure = new Error('commit result uncertain');
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql === 'COMMIT') throw failure;
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const service = new TenantDbService({ connect: async () => client });
    await expect(service.withTenantContext(context, async () => 42)).rejects.toBe(failure);
    expect(queries).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('returns a clean client to the pool after a successful rollback', async () => {
    const failure = new Error('work failed');
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql === 'SELECT fail') throw failure;
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const service = new TenantDbService({ connect: async () => client });
    await expect(service.withUserContext('user-id', async tx => tx.query('SELECT fail'))).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledWith(false);
  });
});
