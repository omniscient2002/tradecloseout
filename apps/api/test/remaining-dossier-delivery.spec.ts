import { UnprocessableEntityException } from '@nestjs/common';
import { HandoverService } from '../src/modules/handover/handover.service';

const orgId = '0192e3a0-0000-7000-8000-000000000001';
const projectId = '0192e3a0-1000-7000-8000-000000000002';
const ctx: any = {
  orgId, userId: '0192e3a0-2000-7000-8000-000000000003',
  actorType: 'MEMBER', ip: '127.0.0.1', userAgent: 'dossier-review', requestId: 'review-001',
};

function build(status: string) {
  const latestId = '0192e3a0-4000-7000-8000-000000000004';
  const artifact = {
    status, version_no: 3, checksum: 'a'.repeat(64), sha256: 'a'.repeat(64),
    mime: 'application/pdf', size_bytes: '2048', observed_size_bytes: '2048',
    object_status: 'READY', object_key: 'orgs/test/verified-dossier.pdf',
    provider_version_id: 'real-provider-version',
  };
  const client: any = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM handover_packages')) {
        return { rows: [{ id: latestId }] };
      }
      if (sql.includes('FROM handover_packages hp') && sql.includes('storage_objects so')) {
        return { rows: [artifact] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => client) } as any;
  const storage: any = { createSignedDownloadUrl: jest.fn(async () => 'https://s3.example.com/signed/verified') };
  return { svc: new HandoverService(pool, storage), storage, latestId };
}

describe('Verified full-dossier legacy download', () => {
  it('returns the signed latest READY worker artifact and its checksum', async () => {
    const { svc, storage, latestId } = build('READY');
    const result = await svc.getLatestDossierDownloadUrl(ctx, projectId);
    expect(result.packageId).toBe(latestId);
    expect(result.downloadUrl).toBe('https://s3.example.com/signed/verified');
    expect(result.checksum).toBe('a'.repeat(64));
    expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      versionId: 'real-provider-version', filename: 'handover-v3.pdf',
    }));
  });

  it('permits authentic accepted packages to remain downloadable', async () => {
    const { svc } = build('ACCEPTED');
    const result = await svc.getLatestDossierDownloadUrl(ctx, projectId);
    expect(result.status).toBe('READY');
  });

  it('refuses an incomplete newest revision rather than serving a stale older dossier', async () => {
    const { svc, storage } = build('QUEUED');
    await expect(svc.getLatestDossierDownloadUrl(ctx, projectId))
      .rejects.toThrow(UnprocessableEntityException);
    expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
