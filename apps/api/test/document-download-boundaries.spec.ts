import { PassThrough, Readable } from 'node:stream';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

describe('document download boundaries', () => {
  const actor = { orgId: 'org-1', userId: 'user-1', actorType: 'USER' as const, requestId: 'request-1' };
  const verifiedVersion = {
    id: 'version-1', file_status: 'READY', storage_status: 'READY', object_key: 'private/object',
    mime: 'application/pdf', size_bytes: '12', observed_size_bytes: '12',
    sha256: 'a'.repeat(64), provider_version_id: 'provider-version', revision_code: 'R1',
    title: 'Test-Doc',
  };

  function setup(version: Record<string, unknown>, guestScopeAllowed = false) {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT dv.*') || sql.includes('SELECT dv.id')) return { rows: [version] };
      if (sql.includes('FROM guest_grants g')) return { rows: guestScopeAllowed ? [{}] : [] };
      return { rows: [] };
    });
    const client = { query, release: jest.fn() };
    const db = new TenantDbService({ connect: jest.fn().mockResolvedValue(client) });
    const storage = {
      createSignedDownloadUrl: jest.fn().mockResolvedValue('signed-url'),
      finalizeUpload: jest.fn(), refreshUploadUrls: jest.fn(), abortUpload: jest.fn(),
      fetchObject: jest.fn().mockResolvedValue(Buffer.from('hello world!')),
    };
    return { service: new DocumentsService(db, storage as any), storage };
  }

  function createMockResponse() {
    const res = new PassThrough() as any;
    res.headers = {};
    res.statusCode = 200;
    res.setHeader = jest.fn((k: string, v: string) => { res.headers[k.toLowerCase()] = v; });
    res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
    return res;
  }

  it.each([
    ['uploading', { ...verifiedVersion, file_status: 'UPLOADING' }],
    ['unverified object', { ...verifiedVersion, storage_status: 'PROCESSING' }],
    ['missing immutable version', { ...verifiedVersion, provider_version_id: null }],
    ['size mismatch', { ...verifiedVersion, observed_size_bytes: '11' }],
  ])('does not issue a URL for %s', async (_label, version) => {
    const { service, storage } = setup(version);
    await expect(service.getDownloadUrl(actor, 'version-1')).rejects.toThrow();
    expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('denies a guest whose grant does not authorize this version', async () => {
    const { service, storage } = setup(verifiedVersion);
    await expect(service.getDownloadUrl({ ...actor, actorType: 'GUEST', guestGrantId: 'grant-1' }, 'version-1'))
      .rejects.toThrow();
    expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('pins an authorized download to the verified provider version', async () => {
    const { service, storage } = setup(verifiedVersion);
    await service.getDownloadUrl(actor, 'version-1');
    expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'provider-version' }));
  });

  it('prevents a guest from completing another grant’s upload', async () => {
    const { service, storage } = setup({ ...verifiedVersion, file_status: 'PENDING_UPLOAD' });
    await expect(service.completeUpload(
      { ...actor, actorType: 'GUEST', guestGrantId: 'other-grant' }, 'version-1', {},
    )).rejects.toThrow();
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
  });

  it('does not enumerate a project’s document list to a guest', async () => {
    const { service } = setup(verifiedVersion);
    await expect(service.listDocuments(
      { ...actor, actorType: 'GUEST', guestGrantId: 'grant-1' }, 'project-1',
    )).rejects.toThrow();
  });

  it('does not trust a cached guest scope after the grant is revoked', async () => {
    const { service, storage } = setup(verifiedVersion);
    await expect(service.createUploadIntent(
      { ...actor, actorType: 'GUEST', guestGrantId: 'grant-1', guestScope: { requirementIds: ['req-1'] } },
      'project-1',
      { filename: 'evidence.pdf', mimeType: 'application/pdf', sizeBytes: 12, requirementId: 'req-1' },
    )).rejects.toThrow();
    expect(storage.finalizeUpload).not.toHaveBeenCalled();
  });

  describe('streamDocumentVersion (byte ranges and conditional caching)', () => {
    const streamVersion = {
      ...verifiedVersion,
      size_bytes: '1000',
      observed_size_bytes: '1000',
      title: 'HVAC-Submittal',
    };

    it('serves full document with HTTP 200, Accept-Ranges, and ETag', async () => {
      const { service, storage } = setup(streamVersion);
      const req = { headers: {} } as any;
      const res = createMockResponse();

      await service.streamDocumentVersion(actor, undefined, 'version-1', req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['etag']).toBe(`"${streamVersion.sha256}"`);
      expect(res.headers['content-length']).toBe('1000');
      expect(storage.fetchObject).toHaveBeenCalledWith({
        objectKey: 'private/object',
        versionId: 'provider-version',
      });
    });

    it('serves partial content with HTTP 206 for valid byte-range request', async () => {
      const { service, storage } = setup(streamVersion);
      const req = { headers: { range: 'bytes=0-100' } } as any;
      const res = createMockResponse();

      await service.streamDocumentVersion(actor, undefined, 'version-1', req, res);

      expect(res.statusCode).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 0-100/1000');
      expect(res.headers['content-length']).toBe('101');
      expect(storage.fetchObject).toHaveBeenCalledWith({
        objectKey: 'private/object',
        versionId: 'provider-version',
        range: 'bytes=0-100',
      });
    });

    it('returns HTTP 416 Range Not Satisfiable when range is beyond content length', async () => {
      const { service, storage } = setup(streamVersion);
      const req = { headers: { range: 'bytes=9999999-' } } as any;
      const res = createMockResponse();

      await service.streamDocumentVersion(actor, undefined, 'version-1', req, res);

      expect(res.statusCode).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */1000');
      expect(storage.fetchObject).not.toHaveBeenCalled();
    });

    it('returns HTTP 304 Not Modified when If-None-Match matches ETag', async () => {
      const { service, storage } = setup(streamVersion);
      const req = { headers: { 'if-none-match': `"${streamVersion.sha256}"` } } as any;
      const res = createMockResponse();

      await service.streamDocumentVersion(actor, undefined, 'version-1', req, res);

      expect(res.statusCode).toBe(304);
      expect(storage.fetchObject).not.toHaveBeenCalled();
    });

    it('aborts upstream stream and handles client disconnect gracefully', async () => {
      const { service, storage } = setup(streamVersion);
      const req = new PassThrough() as any;
      req.headers = {};
      const res = createMockResponse();

      let cleanedUp = false;
      async function* gen() {
        try {
          while (true) {
            yield Buffer.from('chunk');
            await new Promise(r => setTimeout(r, 10));
          }
        } finally {
          cleanedUp = true;
        }
      }
      storage.fetchObject.mockResolvedValue(gen());

      setTimeout(() => req.emit('close'), 25);
      await expect(service.streamDocumentVersion(actor, undefined, 'version-1', req, res)).resolves.toBeUndefined();
      expect(cleanedUp).toBe(true);
    });
  });
});
