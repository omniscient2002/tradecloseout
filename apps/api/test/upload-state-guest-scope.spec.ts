import { DocumentsService } from '../src/modules/documents/documents.service';

function subject(actorType: 'MEMBER' | 'GUEST', grantPresent = true, versionPresent = true) {
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('FROM document_versions dv') && sql.includes('storage_objects so')) {
      return { rows: versionPresent
        ? [{ id: 'version-one', file_status: 'READY', storage_status: 'QUARANTINED' }]
        : [] };
    }
    if (sql.includes('FROM guest_grants g')) {
      return { rows: grantPresent ? [{ '?column?': 1 }] : [] };
    }
    throw new Error('Unexpected query: ' + sql);
  });
  const service = Object.create(DocumentsService.prototype) as DocumentsService;
  (service as any).db = {
    withTenantContext: async (_context: unknown, cb: (client: unknown) => Promise<unknown>) =>
      cb({ query }),
  };
  const context = {
    orgId: 'org-one',
    actorType,
    guestGrantId: actorType === 'GUEST' ? 'grant-one' : null,
  } as any;
  return { service, context, query };
}

describe('PH5-G22-003 minimal upload status and guest privacy', () => {
  it('exposes only version and storage states, not document metadata', async () => {
    const { service, context, query } = subject('MEMBER');
    const result = await service.getUploadState(context, 'version-one');
    expect(result).toEqual({
      versionId: 'version-one',
      fileStatus: 'READY',
      storageStatus: 'QUARANTINED',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).not.toContain('SELECT dv.*');
  });

  it('checks active issuer ownership and document.upload, not document.read', async () => {
    const { service, context, query } = subject('GUEST');
    await expect(service.getUploadState(context, 'version-one'))
      .resolves.toMatchObject({ storageStatus: 'QUARANTINED' });
    expect(query.mock.calls[1]?.[1]?.[3]).toBe('document.upload');
    expect(query.mock.calls[1][0]).toContain('dv.uploaded_by_grant_id = g.id');
  });

  it('denies a revoked/out-of-scope guest even when the version exists', async () => {
    const { service, context } = subject('GUEST', false);
    await expect(service.getUploadState(context, 'version-one'))
      .rejects.toThrow('VERSION_NOT_FOUND');
  });

  it('denies missing or deleted versions rather than synthesizing progress', async () => {
    const { service, context } = subject('MEMBER', true, false);
    await expect(service.getUploadState(context, 'version-one'))
      .rejects.toThrow('UPLOAD_VERSION_NOT_FOUND');
  });
});
