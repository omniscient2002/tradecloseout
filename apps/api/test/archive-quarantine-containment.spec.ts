import { ConflictException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { HandoverService } from '../src/modules/handover/handover.service';
import type { TenantActorContext } from '@tradecloseout/db';

describe('PH5-G28-001 archive source quarantine download gate', () => {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const exportId = uuidv7();
  const sourceId = uuidv7();
  const objectId = uuidv7();
  const artifactId = uuidv7();
  const sourceHash = 'a'.repeat(64);
  const artifactHash = 'b'.repeat(64);
  const sourceKey = 'org/evidence/one';
  const artifactKey = 'org/archive/one.zip';
  const version = 'immutable-v1';

  const source = {
    version_id: sourceId,
    object_id: objectId,
    provider_version_id: version,
    sha256: sourceHash,
  };

  const ctx: TenantActorContext = {
    orgId, projectId, userId: uuidv7(), actorType: 'MEMBER',
    requestId: 'incident-archive-regression', ip: '127.0.0.1', userAgent: 'jest',
  } as TenantActorContext;

  function harness(
    overrides: {
      sourceStatus?: string;
      sourceObjectVersion?: string;
      manifest?: unknown;
      totalObjects?: number;
    } = {},
  ) {
    const signature = jest.fn().mockResolvedValue('https://example.test/archive?signed');
    const statements: string[] = [];
    const query = jest.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT * FROM archive_exports')) {
        return { rows: [{
          id: exportId, org_id: orgId, project_id: projectId, status: 'COMPLETED',
          total_objects: overrides.totalObjects ?? 1,
          manifest_json: overrides.manifest ?? { objects: [source] },
          archive_sha256: artifactHash,
          verification_receipt_json: {
            artifact: {
              objectId: artifactId, objectKey: artifactKey, bucket: 'vault',
              providerVersionId: version, sha256: artifactHash, sizeBytes: 50,
            },
          },
        }] };
      }
      if (sql.includes('FROM document_versions dv') && sql.includes('FOR SHARE OF dv, so')) {
        return { rows: [{
          version_id: sourceId, file_status: 'READY', object_id: objectId,
          storage_status: overrides.sourceStatus ?? 'READY',
          provider_version_id: overrides.sourceObjectVersion ?? version,
          sha256: sourceHash,
        }] };
      }
      if (sql.includes('FROM storage_objects')) {
        return { rows: [{
          id: artifactId, org_id: orgId, bucket: 'vault',
          object_key: artifactKey, provider_version_id: version,
          sha256: artifactHash, size_bytes: 50, observed_size_bytes: 50,
          status: 'READY',
        }] };
      }
      return { rows: [] };
    });
    const pool: any = {
      connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }),
    };
    const service = new HandoverService(pool, { createSignedDownloadUrl: signature } as any);
    return { service, signature, statements };
  }

  it('never signs a previously completed archive when its source was quarantined', async () => {
    const { service, signature, statements } = harness({ sourceStatus: 'QUARANTINED' });
    await expect(service.getArchiveExport(ctx, projectId, exportId))
      .rejects.toThrow(ConflictException);
    expect(signature).not.toHaveBeenCalled();
    expect(statements.some((sql) => sql.includes('FOR SHARE OF dv, so'))).toBe(true);
  });

  it('rejects a mutable provider object version even if status is still READY', async () => {
    const { service, signature } = harness({ sourceObjectVersion: 'new-object-version' });
    await expect(service.getArchiveExport(ctx, projectId, exportId))
      .rejects.toThrow(ConflictException);
    expect(signature).not.toHaveBeenCalled();
  });

  it('fails closed on incomplete or malformed source manifests', async () => {
    for (const candidate of [
      { manifest: {}, totalObjects: 1 },
      { manifest: { objects: [] }, totalObjects: 1 },
      { manifest: { objects: [source, source] }, totalObjects: 2 },
      { manifest: { objects: [{ ...source, version_id: 'unsafe' }] }, totalObjects: 1 },
    ]) {
      const { service, signature } = harness(candidate);
      await expect(service.getArchiveExport(ctx, projectId, exportId))
        .rejects.toThrow(ConflictException);
      expect(signature).not.toHaveBeenCalled();
    }
  });

  it('signs an archive only if all pinned source versions remain intact', async () => {
    const { service, signature } = harness();
    const result = await service.getArchiveExport(ctx, projectId, exportId);
    expect(result.downloadUrl).toContain('?signed');
    expect(signature).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: artifactKey, versionId: version,
    }));
  });
});
