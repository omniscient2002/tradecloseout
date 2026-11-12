import { randomUUID } from 'crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G17-002 exact remedy scope qualification', () => {
  const orgId = randomUUID(), projectId = randomUUID(), assetId = randomUUID();
  const defectId = randomUUID(), objectId = randomUUID(), versionId = randomUUID();
  const ctx: any = {
    orgId, userId: randomUUID(), actorType: 'SYSTEM',
    requestId: randomUUID(), ip: '127.0.0.1', userAgent: 'phase4-test',
  };

  function fixture(binding: { linked_in_project: boolean; linked_to_defect_asset: boolean }) {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        queries.push(sql);
        if (sql.includes('FROM defects d')) return { rows: [{
          id: defectId, org_id: orgId, project_id: projectId, asset_id: assetId,
          status: 'OPEN', row_version: 1,
        }] };
        if (sql.includes('FROM storage_objects so')) {
          expect(sql).toContain('JOIN document_assets da');
          expect(sql).toContain('d.current_approved_version_id = dv.id');
          expect(sql).toContain('da.asset_id = $4');
          expect(sql).not.toContain('LIMIT 1');
          expect(params[3]).toEqual(assetId);
          return { rows: [{
            id: objectId, status: 'READY', sha256: 'a'.repeat(64),
            size_bytes: 1024, observed_size_bytes: 1024,
            provider_version_id: 'v1', object_key: `orgs/${orgId}/projects/${projectId}/defects/${defectId}/source`,
            ...binding,
          }] };
        }
        if (sql.includes('FROM document_versions dv')) return { rows: [{ id: versionId }] };
        if (sql.includes("UPDATE defects")) return { rowCount: 1 };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    return { service: new WarrantyAndBillingService({
      connect: jest.fn(async () => client),
    } as any), queries };
  }

  it('rejects a convincingly named storage key without a current project document link', async () => {
    const { service, queries } = fixture({
      linked_in_project: false, linked_to_defect_asset: false,
    });
    await expect(service.submitDefectRemedy(ctx, projectId, defectId, objectId, 1))
      .rejects.toMatchObject({ response: { code: 'CLOSURE_EVIDENCE_PROJECT_MISMATCH' } });
    expect(queries.some(q => q.includes('UPDATE defects'))).toBe(false);
  });

  it('rejects a project-valid document whose asset links do not contain the exact defect asset', async () => {
    const { service, queries } = fixture({
      linked_in_project: true, linked_to_defect_asset: false,
    });
    await expect(service.submitDefectRemedy(ctx, projectId, defectId, objectId, 1))
      .rejects.toMatchObject({ response: { code: 'CLOSURE_EVIDENCE_ASSET_MISMATCH' } });
    expect(queries.some(q => q.includes('UPDATE defects'))).toBe(false);
  });

  it('refuses independent closure after the originally pinned document version is replaced', async () => {
    const original = randomUUID(), newer = randomUUID();
    const queries: string[] = [];
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM defects d')) return { rows: [{
          id: defectId, org_id: orgId, project_id: projectId, asset_id: assetId,
          status: 'RECTIFIED', row_version: 2, remedied_by: randomUUID(),
          closure_evidence_object_id: objectId, remedy_document_version_id: original,
        }] };
        if (sql.includes('FROM storage_objects so')) return { rows: [{
          id: objectId, status: 'READY', sha256: 'a'.repeat(64),
          size_bytes: 1024, observed_size_bytes: 1024,
          provider_version_id: 'v1', linked_in_project: true,
          linked_to_defect_asset: true,
        }] };
        if (sql.includes('FROM document_versions dv')) return { rows: [{ id: newer }] };
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    })) };
    await expect(new WarrantyAndBillingService(pool).closeDefect(
      ctx, projectId, defectId, objectId, 2,
    )).rejects.toMatchObject({ response: { code: 'DEFECT_REMEDY_VERSION_CHANGED' } });
    expect(queries.some(q => q.includes("status = 'CLOSED'"))).toBe(false);
  });

  it('allows currently approved evidence explicitly linked to the exact project and asset', async () => {
    const { service, queries } = fixture({
      linked_in_project: true, linked_to_defect_asset: true,
    });
    const outcome = await service.submitDefectRemedy(ctx, projectId, defectId, objectId, 1);
    expect(outcome.status).toBe('RECTIFIED');
    expect(queries.some(q => q.includes('UPDATE defects'))).toBe(true);
  });
});
