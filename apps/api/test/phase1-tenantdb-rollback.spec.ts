import { TenantDbService } from '../src/database/tenant-db.service';

describe('PH1-G26-006: TenantDbService preserves transaction errors and never reuses poisoned connections', () => {
  const kinds = ['tenant', 'user', 'token'] as const;
  const ctx = {
    orgId: 'org-test', userId: 'user-test', actorType: 'SYSTEM' as const,
    requestId: 'request-test',
  };
  for (const kind of kinds) {
    const execute = async (db: TenantDbService, callback: () => Promise<unknown>) => {
      if (kind === 'tenant') return db.withTenantContext(ctx, callback);
      if (kind === 'user') return db.withUserContext(ctx.userId, callback);
      return db.withTokenContext('canary-token-hash', callback);
    };
    it(`${kind}: original failure is preserved when ROLLBACK fails`, async () => {
      const original = new Error('ORIGINAL_TRANSACTION_ERROR');
      const client = {
        query: jest.fn(async (sql: string) => {
          if (sql === 'ROLLBACK') throw new Error('CONNECTION_STATE_UNKNOWN');
          return { rows: [], rowCount: 1 };
        }),
        release: jest.fn(),
      };
      const db = new TenantDbService({ connect: async () => client } as any);
      await expect(execute(db, async () => { throw original; })).rejects.toBe(original);
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledTimes(1);
      expect(client.release).toHaveBeenCalledWith(true);
    });

    it(`${kind}: clean rollback retains a reusable connection with bounded transaction timeouts`, async () => {
      const original = new Error('EXPECTED_CALLER_REJECTION');
      const client = {
        query: jest.fn(async (_sql: string) => ({ rows: [], rowCount: 1 })),
        release: jest.fn(),
      };
      const db = new TenantDbService({ connect: async () => client } as any);
      await expect(execute(db, async () => { throw original; })).rejects.toBe(original);
      expect(client.release).toHaveBeenCalledWith(false);
      const sql = client.query.mock.calls.map(([statement]) => statement);
      expect(sql).toContain("SET LOCAL lock_timeout='15s'");
      expect(sql).toContain("SET LOCAL statement_timeout='90s'");
      expect(sql).toContain("SET LOCAL idle_in_transaction_session_timeout='60s'");
    });
  }
});
