import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

describe('PH1-G26-002/G24-007: document storage counter remains BIGINT on lifecycle changes', () => {
  it('persists both delete/refund and restore/recharge inside the document transaction', async () => {
    let counter = 1000n;
    let deleted = false;
    const statements: string[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        statements.push(sql);
        if (sql.includes('UPDATE documents') && sql.includes('SET deleted_at = now()')) {
          if (deleted) return { rows: [] };
          deleted = true;
          return { rows: [{ id: 'document' }] };
        }
        if (sql.includes('UPDATE documents') && sql.includes('SET deleted_at = NULL')) {
          if (!deleted) return { rows: [] };
          deleted = false;
          return { rows: [{ id: 'document' }] };
        }
        if (sql.includes('SUM(so.size_bytes)')) return { rows: [{ total_bytes: '234' }] };
        if (sql.includes('UPDATE usage_counters')) {
          // Exercise the actual application statement rather than a duplicate SQL
          // literal disconnected from DocumentsService.
          expect(sql).toContain('::bigint');
          expect(sql).not.toContain('::text');
          const delta = BigInt(String(params[1]));
          counter = sql.includes('GREATEST') ? (counter > delta ? counter - delta : 0n) : counter + delta;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    const service = new DocumentsService(
      new TenantDbService({ connect: async () => client }),
      {} as any,
    );
    const ctx = {
      orgId: 'org',
      userId: 'user',
      actorType: 'USER' as const,
      requestId: 'req',
    };
    await expect(service.deleteDocument(ctx, 'document')).resolves.toMatchObject({
      deleted: true,
      refundedBytes: 234,
    });
    expect(counter).toBe(766n);
    await expect(service.restoreDocument(ctx, 'document')).resolves.toMatchObject({
      restored: true,
      readdedBytes: 234,
    });
    expect(counter).toBe(1000n);
    expect(statements.filter(sql => sql === 'COMMIT')).toHaveLength(2);
    expect(statements).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(2);
  });
});
