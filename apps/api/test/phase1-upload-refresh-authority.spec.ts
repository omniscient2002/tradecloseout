import { randomUUID } from 'crypto';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

describe('PH1-G02-001/009: refresh multipart URL requires current scoped upload authority', () => {
  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const ctx = { orgId, userId, actorType: 'USER' as const, requestId: 'upload-refresh' };

  function setup(options: {
    scope?: Record<string, unknown>;
    memberActive?: boolean;
    orgActive?: boolean;
    projectStatus?: string;
    versionStatus?: string;
  } = {}) {
    const sql: string[] = [];
    let inTransaction = false;
    const client = {
      query: jest.fn(async (statement: string) => {
        sql.push(statement);
        if (statement === 'BEGIN') inTransaction = true;
        if (statement === 'ROLLBACK' || statement === 'COMMIT') inTransaction = false;
        if (statement.includes('SELECT dv.*')) {
          return { rows: [{
            id: versionId, org_id: orgId, project_id: projectId, document_id: documentId,
            doc_type_key: 'DT-001', category_key: 'HANDOVER_DOCS',
            document_created_at: new Date('2026-01-01T00:00:00Z'),
            object_key: 'safe-object-key', s3_upload_id: 'safe-upload-id',
            size_bytes: '65536', file_status: options.versionStatus ?? 'PENDING_UPLOAD',
          }] };
        }
        if (statement.includes('SELECT m.role AS org_role')) return {
          rows: options.orgActive === false ? [] : [{ org_role: 'R-SITE' }],
        };
        if (statement.includes('SELECT status FROM projects')) return {
          rows: [{ status: options.projectStatus ?? 'ACTIVE' }],
        };
        if (statement.includes('SELECT role, scope_json FROM project_members')) return {
          rows: options.memberActive === false ? [] : [{
            role: 'R-SITE',
            scope_json: options.scope ?? { documentIds: [documentId] },
          }],
        };
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    const signer = {
      refreshUploadUrls: jest.fn(async () => {
        expect(inTransaction).toBe(false);
        return { parts: [{ partNumber: 1, uploadUrl: 'signed-url', requiredHeaders: {} }], expiresInSeconds: 900 };
      }),
    };
    const service = new DocumentsService(
      new TenantDbService({ connect: async () => client }),
      signer as any,
    );
    return { service, client, signer, sql };
  }

  it('permits a current document-scoped member and signs outside the DB transaction', async () => {
    const { service, signer, client, sql } = setup();
    await expect(service.refreshUploadUrls(ctx, versionId)).resolves.toMatchObject({
      versionId, s3UploadId: 'safe-upload-id', expiresInSeconds: 900,
    });
    expect(signer.refreshUploadUrls).toHaveBeenCalledTimes(1);
    expect(sql).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['deleted document scope', { scope: { documentIds: [randomUUID()] } }],
    ['read-only scope', { scope: { readOnly: true, documentIds: [documentId] } }],
    ['unknown restrictive scope', { scope: { legacyPermission: 'ALL' } }],
    ['inactive membership', { memberActive: false }],
    ['suspended organization', { orgActive: false }],
    ['closed project', { projectStatus: 'CLOSED' }],
    ['completed upload', { versionStatus: 'READY' }],
  ] as const)('%s fails without signing new URLs', async (_label, options) => {
    const { service, signer, sql } = setup(options);
    await expect(service.refreshUploadUrls(ctx, versionId)).rejects.toThrow();
    expect(signer.refreshUploadUrls).not.toHaveBeenCalled();
    expect(sql).toContain('ROLLBACK');
  });
});
