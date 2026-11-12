import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

const actor = {
  orgId: 'test-org',
  userId: 'test-user',
  actorType: 'USER' as const,
  requestId: 'test-request',
};
const dto = { fileName: 'new.pdf', mimeType: 'application/pdf', sizeBytes: 512, revisionCode: 'R2' };

describe('PH1-G26-006: replacement does not nest document lookup and upload transactions', () => {
  it('commits document lookup before entering the upload-intent workflow', async () => {
    const statements: string[] = [];
    let insideTransaction = false;
    const client = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql === 'BEGIN') insideTransaction = true;
        if (sql === 'COMMIT' || sql === 'ROLLBACK') insideTransaction = false;
        if (sql.includes('SELECT project_id FROM documents')) {
          return { rows: [{ project_id: 'verified-project' }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const service = new DocumentsService(
      new TenantDbService({ connect: async () => client }),
      {} as any,
    );
    const intent = jest.spyOn(service, 'createUploadIntent').mockImplementation(async (_ctx, projectId, body) => {
      expect(insideTransaction).toBe(false);
      expect(client.release).toHaveBeenCalledTimes(1);
      expect(projectId).toBe('verified-project');
      expect(body.documentId).toBe('document-id');
      return { documentId: 'document-id', versionId: 'new-version' } as any;
    });

    await expect(service.replaceDocumentVersion(actor, 'document-id', dto)).resolves.toMatchObject({
      documentId: 'document-id',
      versionId: 'new-version',
    });
    expect(intent).toHaveBeenCalledTimes(1);
    expect(statements.filter(sql => sql === 'BEGIN')).toHaveLength(1);
    expect(statements.filter(sql => sql === 'COMMIT')).toHaveLength(1);
    expect(statements).not.toContain('ROLLBACK');
  });

  it('rejects a missing/deleted parent before requesting upload resources', async () => {
    const client = {
      query: jest.fn(async () => ({ rows: [] })),
      release: jest.fn(),
    };
    const service = new DocumentsService(
      new TenantDbService({ connect: async () => client }),
      {} as any,
    );
    const intent = jest.spyOn(service, 'createUploadIntent');
    await expect(service.replaceDocumentVersion(actor, 'missing', dto))
      .rejects.toThrow('DOCUMENT_NOT_FOUND');
    expect(intent).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
