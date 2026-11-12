import {
  GetBucketVersioningCommand, HeadObjectCommand, ListPartsCommand,
  CompleteMultipartUploadCommand, GetObjectCommand,
} from '@aws-sdk/client-s3';
import { ConflictException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { HandoverService } from '../src/modules/handover/handover.service';
import { isImmutableObjectVersionId } from '@tradecloseout/shared';
import { S3StorageService } from '../src/modules/documents/s3-storage.service';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

describe('PH3-G10-002 — immutable provider receipt contract', () => {
  function storage(send: jest.Mock) {
    const adapter = new S3StorageService();
    (adapter as any).bucket = 'fixture-bucket';
    (adapter as any).client = { send };
    return adapter;
  }

  it.each([null, undefined, '', ' ', 'null', 'NULL', ' Null ', 'bad\nversion',
    '\tversion', 'x'.repeat(1025), 12, {}])(
    'rejects mutable/malformed provider version %p before publication', (value) => {
      expect(isImmutableObjectVersionId(value)).toBe(false);
    },
  );
  it.each(['v1', 'opaque/with+characters==', '0', 'first-version'])(
    'preserves a genuine opaque pinned version %p exactly', (value) => {
      expect(isImmutableObjectVersionId(value)).toBe(true);
    },
  );

  it.each(['Suspended', undefined])(
    'rejects upload intents when bucket versioning is %p', async (status) => {
      const send = jest.fn(async (command: any) => {
        if (command instanceof GetBucketVersioningCommand) return { Status: status };
        throw new Error('NO_STORAGE_WRITE_EXPECTED');
      });
      await expect(storage(send).createUploadUrls({
        objectKey: 'test/evidence.pdf', sizeBytes: 12, mimeType: 'application/pdf',
      })).rejects.toThrow(ServiceUnavailableException);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, null, '', 'null', ' NULL '])(
    'rejects a same-size single-part object without a pinned version %p', async (version) => {
      const send = jest.fn(async (command: any) => {
        if (command instanceof GetBucketVersioningCommand) return { Status: 'Enabled' };
        if (command instanceof HeadObjectCommand) return { ContentLength: 12, VersionId: version };
        throw new Error('UNEXPECTED_S3_ACTION');
      });
      await expect(storage(send).finalizeUpload({
        objectKey: 'test/evidence.pdf', uploadId: null, expectedSizeBytes: 12,
      })).rejects.toThrow(ServiceUnavailableException);
      expect(send.mock.calls.filter(([c]) => c instanceof HeadObjectCommand)).toHaveLength(1);
    },
  );

  it('pins single-part HEAD to the discovered version and rejects a mismatched pinned response', async () => {
    const heads: string[] = [];
    const send = jest.fn(async (command: any) => {
      if (command instanceof GetBucketVersioningCommand) return { Status: 'Enabled' };
      if (command instanceof HeadObjectCommand) {
        heads.push(command.input.VersionId ?? 'LATEST');
        if (!command.input.VersionId) return { ContentLength: 12, VersionId: 'version-A' };
        return { ContentLength: 12, VersionId: 'version-B' };
      }
      throw new Error('UNEXPECTED_S3_ACTION');
    });
    await expect(storage(send).finalizeUpload({
      objectKey: 'test/evidence.pdf', uploadId: null, expectedSizeBytes: 12,
    })).rejects.toThrow('OBJECT_STORAGE_VERSION_RECEIPT_MISMATCH');
    expect(heads).toEqual(['LATEST', 'version-A']);
  });

  it('uses the multipart Complete receipt and never trusts the current object instead', async () => {
    const expectedSizeBytes = 5 * 1024 * 1024;
    const heads: string[] = [];
    const send = jest.fn(async (command: any) => {
      if (command instanceof GetBucketVersioningCommand) return { Status: 'Enabled' };
      if (command instanceof ListPartsCommand) return {
        Parts: [{ PartNumber: 1, ETag: 'etag-1', Size: expectedSizeBytes }],
      };
      if (command instanceof CompleteMultipartUploadCommand) return { VersionId: 'v-multipart' };
      if (command instanceof HeadObjectCommand) {
        heads.push(command.input.VersionId ?? 'LATEST');
        return { ContentLength: expectedSizeBytes, VersionId: command.input.VersionId };
      }
      throw new Error('UNEXPECTED_S3_ACTION');
    });
    const receipt = await storage(send).finalizeUpload({
      objectKey: 'test/evidence.pdf', uploadId: 'multipart-1',
      expectedSizeBytes, parts: [{ partNumber: 1, etag: 'etag-1' }],
    });
    expect(receipt).toEqual({ observedSizeBytes: expectedSizeBytes, versionId: 'v-multipart' });
    expect(heads).toEqual(['v-multipart']);
  });

  it('does not recover a lost multipart receipt from a same-size overwritten current key', async () => {
    const size = 5 * 1024 * 1024;
    const send = jest.fn(async (command: any) => {
      if (command instanceof GetBucketVersioningCommand) return { Status: 'Enabled' };
      if (command instanceof ListPartsCommand) throw new Error('NoSuchUpload');
      if (command instanceof HeadObjectCommand) return { ContentLength: size, VersionId: 'attacker-overwrite' };
      throw new Error('UNEXPECTED_S3_ACTION');
    });
    await expect(storage(send).finalizeUpload({
      objectKey: 'test/evidence.pdf', uploadId: 'expired-upload', expectedSizeBytes: size,
      parts: [{ partNumber: 1, etag: 'etag-1' }],
    })).rejects.toThrow('MULTIPART_COMPLETION_RECEIPT_UNKNOWN');
    expect(send.mock.calls.some(([c]) => c instanceof HeadObjectCommand)).toBe(false);
  });

  it.each([null, undefined, '', 'null', ' Null '])(
    'never signs an unversioned download or fetches it (%p)', async (version) => {
      const send = jest.fn();
      const adapter = storage(send);
      await expect(adapter.createSignedDownloadUrl({ objectKey: 'test/ready.pdf', versionId: version as any }))
        .rejects.toThrow(ServiceUnavailableException);
      await expect(adapter.fetchObject({ objectKey: 'test/ready.pdf', versionId: version as any }))
        .rejects.toThrow(ServiceUnavailableException);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('rejects a GetObject receipt with a different version even if the object body exists', async () => {
    const send = jest.fn(async (command: any) => {
      if (command instanceof GetObjectCommand) return {
        VersionId: 'overwritten-version', Body: Buffer.from('data'),
      };
      throw new Error('UNEXPECTED_S3_ACTION');
    });
    await expect(storage(send).fetchObject({
      objectKey: 'test/ready.pdf', versionId: 'original-version',
    })).rejects.toThrow('OBJECT_STORAGE_VERSION_RECEIPT_MISMATCH');
  });

  function uploadService(versionOverride: Record<string, unknown>, receipt: any) {
    const version = {
      id: 'v1', doc_id: 'd1', project_id: 'p1', storage_id: 'so1', object_key: 'object',
      s3_upload_id: null, storage_size_bytes: '12', file_status: 'PENDING_UPLOAD',
      provider_version_id: null, review_status: 'PENDING_REVIEW',
      current_approved_version_id: null, ...versionOverride,
    };
    const query = jest.fn(async (sql: string, _args?: any[]) => {
      if (sql.includes('SELECT dv.*')) return { rows: [version] };
      return { rows: [] };
    });
    const db = new TenantDbService({ connect: jest.fn(async () => ({
      query, release: jest.fn(),
    })) } as any);
    const adapter: any = { finalizeUpload: jest.fn(async () => receipt) };
    return { service: new DocumentsService(db, adapter), query, adapter };
  }
  const actor: any = {
    orgId: 'org', userId: 'user', requestId: 'version-pass02',
    actorType: 'MEMBER', ip: '127.0.0.1',
  };

  it.each([null, undefined, '', 'null', 'NULL', ' Null '])(
    'keeps DB upload pending on a mutable adapter version %p', async (value) => {
      const { service, query } = uploadService({}, { observedSizeBytes: 12, versionId: value });
      await expect(service.completeUpload(actor, 'v1', {}))
        .rejects.toThrow('IMMUTABLE_UPLOAD_RECEIPT_REQUIRED');
      expect(query.mock.calls.map(([sql]) => sql).filter(sql =>
        /UPDATE document_versions|UPDATE storage_objects|INSERT INTO outbox_events/.test(sql),
      )).toEqual([]);
    },
  );

  it('refuses a matching version ID with a different observed byte count', async () => {
    const { service, query } = uploadService({}, {
      observedSizeBytes: 11, versionId: 'safe-version',
    });
    await expect(service.completeUpload(actor, 'v1', {}))
      .rejects.toThrow('IMMUTABLE_UPLOAD_RECEIPT_REQUIRED');
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE storage_objects'))).toBe(false);
  });

  it('cannot report a legacy PROCESSING version with the null sentinel as completed', async () => {
    const { service, adapter } = uploadService({
      file_status: 'PROCESSING', provider_version_id: 'null',
    }, { observedSizeBytes: 12, versionId: 'safe' });
    await expect(service.completeUpload(actor, 'v1', {})).rejects.toThrow(ConflictException);
    expect(adapter.finalizeUpload).not.toHaveBeenCalled();
  });

  it('transitions only a valid pinned, same-size receipt and writes its version to outbox', async () => {
    const { service, query } = uploadService({}, {
      observedSizeBytes: 12, versionId: 'pinned-v2',
    });
    const settled = await service.completeUpload(actor, 'v1', {});
    expect(settled.fileStatus).toBe('PROCESSING');
    expect(query.mock.calls.some(([sql, args]) =>
      sql.includes('UPDATE storage_objects') && args?.[3] === 'pinned-v2')).toBe(true);
    expect(query.mock.calls.some(([sql, args]) =>
      sql.includes('INSERT INTO outbox_events') &&
      JSON.parse(args?.[3] || '{}').providerVersionId === 'pinned-v2')).toBe(true);
  });

  it.each([undefined, null, '', 'null', ' Null '])(
    'denies handover package downloads with mutable artifact version %p', async (providerVersion) => {
      const checksum = 'a'.repeat(64);
      const pool: any = { connect: jest.fn(async () => ({
        query: jest.fn(async (sql: string) => {
          if (sql.includes('SELECT hp.status, hp.version_no, hp.checksum')) return {
            rows: [{
              status: 'READY', object_status: 'READY', version_no: 1,
              checksum, sha256: checksum, size_bytes: '12', observed_size_bytes: '12',
              provider_version_id: providerVersion, object_key: 'handover/final.pdf',
            }],
          };
          return { rows: [] };
        }), release: jest.fn(),
      })) };
      const storage: any = { createSignedDownloadUrl: jest.fn() };
      const handover = new HandoverService(pool, storage);
      await expect(handover.getPackageDownloadUrl(actor, 'p1', 'package1'))
        .rejects.toThrow(UnprocessableEntityException);
      expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
    },
  );

  it('issues a handover download URL only for an exact immutable artifact version', async () => {
    const checksum = 'a'.repeat(64);
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT hp.status, hp.version_no, hp.checksum')) return {
          rows: [{
            status: 'READY', object_status: 'READY', version_no: 1,
            checksum, sha256: checksum, size_bytes: '12', observed_size_bytes: '12',
            provider_version_id: 'opaque-version-1', object_key: 'handover/final.pdf',
          }],
        };
        return { rows: [] };
      }), release: jest.fn(),
    })) };
    const storage: any = { createSignedDownloadUrl: jest.fn(async () => 'https://fixture/signed') };
    const result = await new HandoverService(pool, storage)
      .getPackageDownloadUrl(actor, 'p1', 'package1');
    expect(result.downloadUrl).toBe('https://fixture/signed');
    expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 'opaque-version-1' }),
    );
  });

  it.each([null, 'null', ' NULL '])(
    'does not sign a historical archive artifact with mutable receipt %p', async (providerVersionId) => {
      const pool: any = { connect: jest.fn(async () => ({
        query: jest.fn(async (sql: string) => {
          if (sql.includes('SELECT * FROM archive_exports')) return {
            rows: [{
              id: 'export1', project_id: 'p1', status: 'COMPLETED',
              verification_receipt_json: {
                artifact: {
                  objectId: 'object1', objectKey: 'archive/file.zip',
                  bucket: 'fixture-bucket', providerVersionId,
                },
              },
            }],
          };
          return { rows: [] };
        }), release: jest.fn(),
      })) };
      const storage: any = { createSignedDownloadUrl: jest.fn() };
      await expect(new HandoverService(pool, storage).getArchiveExport(actor, 'p1', 'export1'))
        .rejects.toThrow(ConflictException);
      expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
    },
  );

});
