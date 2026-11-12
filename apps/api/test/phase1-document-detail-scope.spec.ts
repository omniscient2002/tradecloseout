import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

describe('PH1-G02-001: live document detail read scope', () => {
  const documentId = randomUUID();
  const projectId = randomUUID();
  const orgId = randomUUID();
  const userId = randomUUID();
  const ctx = { orgId, userId, actorType: 'USER' as const, requestId: 'document-scope-test' };

  const create = (options: {
    orgRole?: string;
    projectRole?: string;
    scope?: Record<string, unknown>;
    userActive?: boolean;
    projectStatus?: string;
    docId?: string;
  } = {}) => {
    const seen: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        seen.push(sql);
        if (sql.includes('SELECT d.*')) {
          return { rows: [{
            id: options.docId || documentId, project_id: projectId, doc_type_key: 'DT-001',
            category_key: 'DOCUMENT', created_at: new Date('2026-01-01T00:00:00Z'),
          }] };
        }
        if (sql.includes('SELECT m.role AS org_role')) {
          return { rows: options.userActive === false ? [] : [{ org_role: options.orgRole || 'R-SITE' }] };
        }
        if (sql.includes('SELECT status FROM projects')) return { rows: [{ status: options.projectStatus || 'ACTIVE' }] };
        if (sql.includes('SELECT role, scope_json FROM project_members')) {
          return { rows: [{
            role: options.projectRole || 'R-SITE',
            scope_json: options.scope || { documentIds: [documentId], mode: 'READ_ONLY' },
          }] };
        }
        if (sql.includes('FROM document_versions dv')) return { rows: [{ id: 'version' }] };
        if (sql.includes('FROM document_requirements dr')) return { rows: [{ id: 'requirement' }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const service = new DocumentsService(new TenantDbService({ connect: async () => client }), {} as any);
    return { service, client, seen };
  };

  it('allows a current read-only project member to view only their allowed document', async () => {
    const { service, seen } = create();
    await expect(service.getDocument(ctx, documentId)).resolves.toMatchObject({
      id: documentId, versions: [{ id: 'version' }], requirements: [{ id: 'requirement' }],
    });
    expect(seen.filter(sql => sql === 'COMMIT')).toHaveLength(1);
  });

  it('does not expose a document, version or requirement outside documentIds scope', async () => {
    const { service, seen } = create({ scope: { documentIds: [randomUUID()], mode: 'READ_ONLY' } });
    await expect(service.getDocument(ctx, documentId)).rejects.toBeInstanceOf(NotFoundException);
    expect(seen.some(sql => sql.includes('FROM document_versions dv'))).toBe(false);
    expect(seen.some(sql => sql.includes('FROM document_requirements dr'))).toBe(false);
    expect(seen).toContain('ROLLBACK');
  });

  it('fails closed on unknown scope dimensions or removed membership', async () => {
    for (const options of [
      { scope: { mystery: true } },
      { userActive: false },
      { projectStatus: 'CANCELLED' },
    ]) {
      const { service } = create(options);
      await expect(service.getDocument(ctx, documentId)).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('allows a current owner to read retained CLOSED project evidence without a project role', async () => {
    const { service, seen } = create({ orgRole: 'R-OWNER', projectStatus: 'CLOSED' });
    await expect(service.getDocument(ctx, documentId)).resolves.toMatchObject({
      id: documentId, versions: [{ id: 'version' }],
    });
    expect(seen.some(sql => sql.includes('FROM project_members'))).toBe(false);
  });
});
