import { randomUUID } from 'crypto';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

describe('PH1-G02-001/009: upload intent is authorised inside the write transaction', () => {
  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const ctx = { orgId, userId, actorType: 'USER' as const, requestId: 'intent-scope-test' };
  const dto = { mimeType: 'application/pdf', fileName: 'hvac.pdf', sizeBytes: 1024 };

  function setup(config: {
    scope?: Record<string, unknown>;
    memberActive?: boolean;
    userActive?: boolean;
    projectStatus?: string;
  } = {}) {
    const statements: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes('SELECT m.role AS org_role')) return {
          rows: config.userActive === false ? [] : [{ org_role: 'R-SITE' }],
        };
        if (sql.includes('SELECT status FROM projects')) return {
          rows: [{ status: config.projectStatus ?? 'ACTIVE' }],
        };
        if (sql.includes('SELECT role, scope_json FROM project_members')) return {
          rows: config.memberActive === false ? [] : [{
            role: 'R-SITE', scope_json: config.scope ?? {},
          }],
        };
        if (sql.includes('SELECT uc.value AS current_storage')) return { rows: [] };
        if (sql.includes('MAX(version_no)')) return { rows: [{ max_v: 0 }] };
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    const storage = {
      createUploadUrls: jest.fn(async () => ({
        uploadId: null, partSizeBytes: dto.sizeBytes,
        parts: [{ partNumber: 1, uploadUrl: 'test-url', requiredHeaders: {} }],
      })),
    };
    const service = new DocumentsService(
      new TenantDbService({ connect: async () => client }),
      storage as any,
    );
    return { service, storage, statements };
  }

  it('creates an intent for a current unrestricted scoped member', async () => {
    const { service, storage, statements } = setup();
    await expect(service.createUploadIntent(ctx, projectId, dto)).resolves.toMatchObject({
      linkedRequirementCount: 0, linkedAssetCount: 0,
    });
    expect(storage.createUploadUrls).toHaveBeenCalledTimes(1);
    expect(statements).toContain('COMMIT');
  });

  it.each(['ACTIVE', 'CLOSED', 'SUSPENDED'] as const)(
    'guest upload intent requires live project status (%s)',
    async status => {
      const requirementId = randomUUID();
      const grantId = randomUUID();
      const statements: string[] = [];
      const client = {
        query: jest.fn(async (sql: string) => {
          statements.push(sql);
          if (sql.includes('SELECT scope_json, capabilities FROM guest_grants')) {
            return { rows: [{
              scope_json: { requirementIds: [requirementId] },
              capabilities: ['document.upload'],
            }] };
          }
          if (sql.includes('SELECT id, doc_type_key FROM requirements')) {
            return { rows: [{ id: requirementId, doc_type_key: 'DT-001' }] };
          }
          if (sql.includes('SELECT status FROM projects')) return { rows: [{ status }] };
          if (sql.includes('SELECT uc.value AS current_storage')) return { rows: [] };
          if (sql.includes('MAX(version_no)')) return { rows: [{ max_v: 0 }] };
          return { rows: [], rowCount: 1 };
        }),
        release: jest.fn(),
      };
      const storage = {
        createUploadUrls: jest.fn(async () => ({
          uploadId: null, partSizeBytes: dto.sizeBytes, parts: [],
        })),
      };
      const service = new DocumentsService(
        new TenantDbService({ connect: async () => client }),
        storage as any,
      );
      const guestCtx = { ...ctx, actorType: 'GUEST' as const, guestGrantId: grantId };
      const command = service.createUploadIntent(guestCtx, projectId, {
        ...dto, requirementId,
      });
      if (status === 'ACTIVE') {
        await expect(command).resolves.toMatchObject({ linkedRequirementCount: 1 });
        expect(storage.createUploadUrls).toHaveBeenCalledTimes(1);
      } else {
        await expect(command).rejects.toThrow('PROJECT_UPLOAD_DISABLED');
        expect(storage.createUploadUrls).not.toHaveBeenCalled();
        expect(statements).not.toContainEqual(expect.stringContaining('INSERT INTO storage_objects'));
        expect(statements).toContain('ROLLBACK');
      }
    },
  );

  it.each([
    ['document ID allowlist', { scope: { documentIds: [randomUUID()] } }],
    ['read only', { scope: { mode: 'READ_ONLY' } }],
    ['malformed scope', { scope: { readOnly: 'false' } }],
    ['unsupported legacy scope', { scope: { legacyScope: true } }],
    ['wrong document type', { scope: { documentTypes: ['DT-OTHER'] } }],
    ['required link missing', { scope: { requirementIds: [randomUUID()] } }],
    ['membership revoked', { memberActive: false }],
    ['user suspended', { userActive: false }],
    ['project closed', { projectStatus: 'CLOSED' }],
  ] as const)('%s denies before creating storage or document records', async (_label, config) => {
    const { service, storage, statements } = setup(config);
    await expect(service.createUploadIntent(ctx, projectId, dto)).rejects.toThrow();
    expect(storage.createUploadUrls).not.toHaveBeenCalled();
    expect(statements).not.toContainEqual(expect.stringContaining('INSERT INTO storage_objects'));
    expect(statements).not.toContainEqual(expect.stringContaining('INSERT INTO documents'));
    expect(statements).toContain('ROLLBACK');
  });
});
