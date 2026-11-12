import { randomUUID } from 'crypto';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

describe('PH1-G26-002/G24-007: document storage counter remains BIGINT on lifecycle changes', () => {
  it.each(['delete', 'restore'] as const)(
    '%s rolls back the document change if the conditional counter update cannot reconcile',
    async operation => {
      const documentId = randomUUID();
      const projectId = randomUUID();
      const statements: string[] = [];
      const client = {
        query: jest.fn(async (sql: string) => {
          statements.push(sql);
          if (sql.includes('SELECT project_id FROM documents')) return { rows: [{ project_id: projectId }] };
          if (sql.includes('SELECT m.role AS org_role')) return { rows: [{ org_role: 'R-OWNER' }] };
          if (sql.includes('SELECT status FROM projects')) return { rows: [{ status: 'ACTIVE' }] };
          if (sql.includes('SELECT id, project_id, doc_type_key')) {
            return { rows: [{ id: documentId, project_id: projectId, doc_type_key: 'DT-001', created_at: new Date() }] };
          }
          if (sql.includes('UPDATE documents')) return { rows: [{ id: documentId }] };
          if (sql.includes('SUM(so.size_bytes)')) return { rows: [{ total_bytes: '234' }] };
          if (sql.includes('UPDATE usage_counters')) {
            expect(sql).toContain(operation === 'delete'
              ? 'value >= $2::bigint'
              : 'value <= 9223372036854775807::bigint - $2::bigint');
            return { rows: [], rowCount: 0 };
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
        orgId: randomUUID(),
        userId: randomUUID(),
        actorType: 'USER' as const,
        requestId: 'quota-reconcile',
      };
      const command = operation === 'delete'
        ? service.deleteDocument(ctx, documentId)
        : service.restoreDocument(ctx, documentId);
      await expect(command).rejects.toThrow('STORAGE_QUOTA_RECONCILIATION_REQUIRED');
      expect(statements).toContain('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
      expect(client.release).toHaveBeenCalledTimes(1);
    },
  );

  it('persists both delete/refund and restore/recharge inside the document transaction', async () => {
    let counter = 1000n;
    let deleted = false;
    const documentId = randomUUID();
    const projectId = randomUUID();
    const statements: string[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        statements.push(sql);
        if (sql.includes('SELECT project_id FROM documents')) return { rows: [{ project_id: projectId }] };
        if (sql.includes('SELECT m.role AS org_role')) return { rows: [{ org_role: 'R-OWNER' }] };
        if (sql.includes('SELECT status FROM projects')) return { rows: [{ status: 'ACTIVE' }] };
        if (sql.includes('SELECT id, project_id, doc_type_key')) {
          return { rows: [{ id: documentId, project_id: projectId, doc_type_key: 'DT-001', created_at: new Date() }] };
        }
        if (sql.includes('UPDATE documents') && sql.includes('SET deleted_at = now()')) {
          if (deleted) return { rows: [] };
          deleted = true;
          return { rows: [{ id: documentId }] };
        }
        if (sql.includes('UPDATE documents') && sql.includes('SET deleted_at = NULL')) {
          if (!deleted) return { rows: [] };
          deleted = false;
          return { rows: [{ id: documentId }] };
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
      orgId: randomUUID(),
      userId: randomUUID(),
      actorType: 'USER' as const,
      requestId: 'req',
    };
    await expect(service.deleteDocument(ctx, documentId)).resolves.toMatchObject({
      deleted: true,
      refundedBytes: 234,
    });
    expect(counter).toBe(766n);
    await expect(service.restoreDocument(ctx, documentId)).resolves.toMatchObject({
      restored: true,
      readdedBytes: 234,
    });
    expect(counter).toBe(1000n);
    expect(statements.filter(sql => sql === 'COMMIT')).toHaveLength(2);
    expect(statements).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(2);
  });
});
