import { DocumentsService } from '../src/modules/documents/documents.service';

// Lightweight service-boundary regression. Storage is mocked, so this does NOT
// certify provider-side revocation or a real storage account.
function createSubject(fileStatus: string, storageStatus: string) {
  const refreshUploadUrls = jest.fn().mockResolvedValue({
    parts: [{ partNumber: 1, uploadUrl: 'https://storage.example.test/part', requiredHeaders: {} }],
    expiresInSeconds: 300,
  });
  const query = jest.fn().mockResolvedValue({
    rows: [{
      id: 'version-1', file_status: fileStatus,
      storage_status: storageStatus, object_key: 'org/v1',
      s3_upload_id: 'upload-1', size_bytes: 64,
    }],
    rowCount: 1,
  });
  const service = Object.create(DocumentsService.prototype) as DocumentsService;
  (service as any).db = {
    withTenantContext: async (_ctx: unknown, action: (client: unknown) => Promise<unknown>) =>
      action({ query }),
  };
  (service as any).storageAdapter = { refreshUploadUrls };
  const ctx = { orgId: 'org-1', actorType: 'USER', guestGrantId: null } as any;
  return { service, ctx, query, refreshUploadUrls };
}

describe('PH5-G22-001: refresh only live upload intents', () => {
  it.each([
    ['APPROVED/READY', 'READY', 'READY'],
    ['quarantined object', 'PENDING_UPLOAD', 'QUARANTINED'],
    ['aborted object', 'PENDING_UPLOAD', 'ABORTED'],
    ['processing scanner', 'PROCESSING', 'PROCESSING'],
    ['failed upload', 'FAILED', 'FAILED'],
  ])('denies revoked intent: %s', async (_label, fileStatus, storageStatus) => {
    const { service, ctx, refreshUploadUrls } = createSubject(fileStatus, storageStatus);
    await expect(service.refreshUploadUrls(ctx, 'version-1'))
      .rejects.toThrow('UPLOAD_INTENT_NOT_ACTIVE');
    expect(refreshUploadUrls).not.toHaveBeenCalled();
  });

  it('refreshes exactly once for an active PENDING_UPLOAD/PENDING version', async () => {
    const { service, ctx, query, refreshUploadUrls } =
      createSubject('PENDING_UPLOAD', 'PENDING');
    const response = await service.refreshUploadUrls(ctx, 'version-1');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE OF dv, so');
    expect(refreshUploadUrls).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({ versionId: 'version-1', expiresInSeconds: 300 });
  });
});
