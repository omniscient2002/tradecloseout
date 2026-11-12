import { randomUUID } from 'node:crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G17-003: aftercare cannot silently mutate accepted closeout', () => {
  const orgId = randomUUID(), projectId = randomUUID(), assetId = randomUUID();
  const acceptedPackageId = randomUUID();
  const ctx: any = {
    orgId, userId: randomUUID(), actorType: 'SYSTEM',
    requestId: randomUUID(), ip: '127.0.0.1', userAgent: 'phase4-aftercare',
  };

  const aftercare = {
    title: 'Post-handover compressor noise',
    caseType: 'AFTERCARE' as const,
    assetId, severity: 'HIGH' as const,
    postHandoverReason: 'Customer reported abnormal compressor noise after handover.',
    aftercareReference: 'WARRANTY-REPORT-004',
  };

  function makeService(state: string, latestStatus = 'ACCEPTED', closedAt: string | null = '2026-11-11T12:00:00Z') {
    const calls: { sql: string; params: any[] }[] = [];
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string, params: any[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT id, status, closed_at, purged_at') &&
            sql.includes('FROM projects')) {
          expect(sql).toContain('FOR UPDATE');
          return { rows: [{ id: projectId, status: state, closed_at: closedAt, purged_at: null }] };
        }
        if (sql.includes('SELECT id FROM assets')) {
          expect(sql).toContain('FOR SHARE');
          return { rows: [{ id: assetId }] };
        }
        if (sql.includes('SELECT id, status FROM handover_packages')) {
          expect(sql).toContain("package_purpose = 'FULL_HANDOVER'");
          expect(sql).toContain('ORDER BY version_no DESC');
          return { rows: [{ id: acceptedPackageId, status: latestStatus }] };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    })) };
    return { service: new WarrantyAndBillingService(pool), calls };
  }

  it('locks project and adds a mandatory CLOSEOUT defect while ACTIVE', async () => {
    const { service, calls } = makeService('ACTIVE');
    const result = await service.createDefect(ctx, projectId, { title: 'Pre-handover snag' });
    expect(result.caseType).toBe('CLOSEOUT');
    expect(result.mandatory).toBe(true);
    expect(result.acceptedPackageId).toBeNull();
    const insert = calls.find(x => x.sql.includes('INSERT INTO defects'));
    expect(insert).toBeDefined();
    expect(insert?.params.slice(11, 16)).toEqual(['CLOSEOUT', null, null, null, true]);
    expect(calls.findIndex(x => x.sql.includes('FROM projects'))).toBeLessThan(
      calls.findIndex(x => x.sql.includes('INSERT INTO defects')),
    );
  });

  it('rejects an unclassified closeout defect once the project is CLOSED', async () => {
    const { service, calls } = makeService('CLOSED');
    await expect(service.createDefect(ctx, projectId, { title: 'Unreviewed snag' }))
      .rejects.toMatchObject({ response: { code: 'DEFECT_PROJECT_LIFECYCLE_BLOCKED' } });
    expect(calls.some(x => x.sql.includes('INSERT INTO defects'))).toBe(false);
    expect(calls.some(x => x.sql === 'ROLLBACK')).toBe(true);
  });

  it('tracks a legitimate aftercare report against the immutable accepted dossier, without reopening', async () => {
    const { service, calls } = makeService('CLOSED');
    const result = await service.createDefect(ctx, projectId, aftercare);
    expect(result.caseType).toBe('AFTERCARE');
    expect(result.mandatory).toBe(false);
    expect(result.acceptedPackageId).toBe(acceptedPackageId);
    const insert = calls.find(x => x.sql.includes('INSERT INTO defects'));
    expect(insert?.params.slice(11, 16)).toEqual([
      'AFTERCARE', acceptedPackageId, aftercare.postHandoverReason,
      aftercare.aftercareReference, false,
    ]);
    expect(calls.some(x => x.sql.includes('UPDATE handover_packages'))).toBe(false);
    expect(calls.some(x => x.sql.includes('UPDATE projects'))).toBe(false);
  });

  it('does not attach to a stale accepted package when the newest dossier is not accepted', async () => {
    const { service, calls } = makeService('CLOSED', 'READY');
    await expect(service.createDefect(ctx, projectId, aftercare))
      .rejects.toMatchObject({ response: { code: 'AFTERCARE_CURRENT_DOSSIER_NOT_ACCEPTED' } });
    expect(calls.some(x => x.sql.includes('INSERT INTO defects'))).toBe(false);
  });

  for (const state of ['DRAFT', 'SUSPENDED', 'CANCELLED', 'ARCHIVED', 'ACTIVE', 'HANDOVER']) {
    it(`refuses AFTERCARE reports on ${state} projects`, async () => {
      const { service, calls } = makeService(state);
      await expect(service.createDefect(ctx, projectId, aftercare))
        .rejects.toMatchObject({ response: { code: 'DEFECT_PROJECT_LIFECYCLE_BLOCKED' } });
      expect(calls.some(x => x.sql.includes('INSERT INTO defects'))).toBe(false);
    });
  }

  it('requires an asset, explicit case reference and meaningful aftercare reason', async () => {
    const { service, calls } = makeService('CLOSED');
    for (const change of [
      { assetId: undefined },
      { postHandoverReason: 'short' },
      { aftercareReference: '' },
      { caseType: 'WRONG' as any },
    ]) {
      await expect(service.createDefect(ctx, projectId, { ...aftercare, ...change }))
        .rejects.toBeDefined();
    }
    expect(calls).toEqual([]);
  });
});
