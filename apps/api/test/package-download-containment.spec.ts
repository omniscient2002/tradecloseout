import { UnprocessableEntityException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { HandoverService } from '../src/modules/handover/handover.service';
import type { TenantActorContext } from '@tradecloseout/db';

describe('PH5-G28-001 handover package quarantine and signing fence', () => {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const packageId = uuidv7();
  const versionId = uuidv7();
  const itemId = uuidv7();
  const objectId = uuidv7();
  const expectedSha = 'a'.repeat(64);
  const ctx = {
    orgId, userId: uuidv7(), actorType: 'MEMBER',
    requestId: 'containment-package-url', ip: '127.0.0.1', userAgent: 'jest',
  } as TenantActorContext;

  function setup(overrides: { status?: string; sourceDeleted?: boolean; missingSource?: boolean } = {}) {
    const lifecycle: string[] = [];
    const signer = jest.fn(async () => {
      lifecycle.push('SIGN');
      return 'https://storage.test/receipt';
    });
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          lifecycle.push(sql);
          return { rows: [] };
        }
        if (sql.includes('SELECT hp.status') && sql.includes('FROM handover_packages')) {
          return { rows: [{
            status: 'READY', object_status: 'READY', version_no: 2,
            checksum: expectedSha, sha256: expectedSha,
            size_bytes: 100, observed_size_bytes: 100,
            object_key: 'org/handover/verified.pdf', mime: 'application/pdf',
            provider_version_id: 'v1',
          }] };
        }
        if (sql.includes('FROM package_items pi') && sql.includes('FOR SHARE OF pi')) {
          return { rows: [{ id: itemId }] };
        }
        if (sql.includes('FROM package_items pi') && sql.includes('FOR SHARE OF dv, evidence')) {
          return { rows: overrides.missingSource ? [] : [{
            item_id: itemId, version_id: versionId, storage_id: objectId,
            file_status: 'READY', version_deleted_at: overrides.sourceDeleted ? new Date() : null,
            storage_status: overrides.status ?? 'READY',
          }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const pool: any = { connect: jest.fn().mockResolvedValue(client) };
    const service = new HandoverService(pool, { createSignedDownloadUrl: signer } as any);
    return { service, signer, lifecycle, client };
  }

  it('issues the presigned URL while the verification transaction still holds locks', async () => {
    const { service, signer, lifecycle, client } = setup();
    const result = await service.getPackageDownloadUrl(ctx, projectId, packageId);
    expect(result).toMatchObject({ packageId, status: 'READY' });
    expect(signer).toHaveBeenCalledTimes(1);
    expect(lifecycle.indexOf('SIGN')).toBeGreaterThan(lifecycle.indexOf('BEGIN'));
    expect(lifecycle.indexOf('SIGN')).toBeLessThan(lifecycle.indexOf('COMMIT'));
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FOR SHARE OF dv, evidence')))
      .toBe(true);
  });

  it.each([
    ['quarantined', { status: 'QUARANTINED' }],
    ['deleted version', { sourceDeleted: true }],
    ['missing source', { missingSource: true }],
  ])('rejects %s before generating a new URL', async (_label, overrides) => {
    const { service, signer } = setup(overrides);
    await expect(service.getPackageDownloadUrl(ctx, projectId, packageId))
      .rejects.toThrow(UnprocessableEntityException);
    expect(signer).not.toHaveBeenCalled();
  });
});
