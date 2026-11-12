import { randomUUID } from 'node:crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G17-004: supplier defect authority must be scoped to live assignment', () => {
  const orgId = randomUUID(), projectId = randomUUID(), defectId = randomUUID();
  const supplierPartyId = randomUUID(), otherPartyId = randomUUID(), assetId = randomUUID();
  const guest: any = {
    orgId, userId: randomUUID(), actorType: 'GUEST', guestGrantId: randomUUID(),
    guestCapabilities: ['defect.manage', 'document.read'],
    ip: '127.0.0.1', userAgent: 'g17-test', requestId: randomUUID(),
  };

  function mockDb(options: {
    assignedPartyId?: string | null;
    grantStatus?: 'ACTIVE' | 'REVOKED';
    scope?: Record<string, unknown>;
  } = {}) {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (sql.includes('FROM defects d')) return { rows: [{
          id: defectId, org_id: orgId, project_id: projectId,
          assigned_party_id: options.assignedPartyId ?? null,
          asset_id: assetId, status: 'OPEN', row_version: 1,
        }] };
        if (sql.includes('FROM guest_grants')) {
          return { rows: options.grantStatus === 'REVOKED' ? [] : [{
            party_id: supplierPartyId, grant_type: 'SUPPLIER_CONTRIBUTOR',
            scope_json: options.scope || { assetIds: [assetId] },
          }] };
        }
        if (sql.includes('SELECT d.*, a.tag AS asset_tag')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    })) };
    return { service: new WarrantyAndBillingService(pool), statements, pool };
  }

  it('denies supplier remedy of a defect assigned to a different supplier', async () => {
    const { service, statements } = mockDb({ assignedPartyId: otherPartyId });
    await expect(service.submitDefectRemedy(guest, projectId, defectId, randomUUID(), 1))
      .rejects.toMatchObject({ response: { code: 'DEFECT_NOT_ASSIGNED_TO_SUPPLIER' } });
    expect(statements.some(x => x.sql.includes('UPDATE defects'))).toBe(false);
    expect(statements.some(x => x.sql.includes('FOR SHARE') && x.sql.includes('FROM guest_grants'))).toBe(true);
  });

  it('denies a supplier whose asset scope excludes this defect', async () => {
    const { service } = mockDb({
      assignedPartyId: supplierPartyId, scope: { assetIds: [randomUUID()] },
    });
    await expect(service.submitDefectRemedy(guest, projectId, defectId, randomUUID(), 1))
      .rejects.toMatchObject({ response: { code: 'DEFECT_NOT_ASSIGNED_TO_SUPPLIER' } });
  });

  it('denies a revoked or expired grant in the transaction', async () => {
    const { service } = mockDb({ assignedPartyId: supplierPartyId, grantStatus: 'REVOKED' });
    await expect(service.submitDefectRemedy(guest, projectId, defectId, randomUUID(), 1))
      .rejects.toMatchObject({ response: { code: 'DEFECT_SUPPLIER_GRANT_INELIGIBLE' } });
  });

  it('filters a supplier defect list by assigned party and asset scope', async () => {
    const { service, statements } = mockDb({
      assignedPartyId: supplierPartyId, scope: { assetIds: [assetId] },
    });
    await service.listDefects(guest, projectId);
    const sql = statements.find(x => x.sql.includes('SELECT d.*, a.tag AS asset_tag'));
    expect(sql?.sql).toContain('d.assigned_party_id = $3');
    expect(sql?.sql).toContain('d.asset_id = ANY($4::uuid[])');
    expect(sql?.params[2]).toEqual(supplierPartyId);
    expect(sql?.params[3]).toEqual([assetId]);
  });

  it('does not let external contributors create arbitrary defects or independently close remedies', async () => {
    const { service, pool } = mockDb();
    await expect(service.createDefect(guest, projectId, { title: 'Unassigned defect' }))
      .rejects.toMatchObject({ response: { code: 'DEFECT_CREATION_REQUIRES_INTERNAL_TRIAGE' } });
    await expect(service.closeDefect(guest, projectId, defectId, randomUUID(), 2))
      .rejects.toMatchObject({ response: { code: 'DEFECT_INDEPENDENT_VERIFIER_REQUIRED' } });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
