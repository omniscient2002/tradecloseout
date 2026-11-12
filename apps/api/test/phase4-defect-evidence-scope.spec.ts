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
        if (sql.includes('FROM projects') && sql.includes('FOR UPDATE')) {
              return { rows: [{ id: projectId, status: 'ACTIVE',
                closed_at: null, purged_at: null }] };
            }
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
            provider_version_id: 'v1', av_scanned_at: '2026-11-12T10:00:00Z', object_key: `orgs/${orgId}/projects/${projectId}/defects/${defectId}/source`,
            ...binding,
          }] };
        }
        if (sql.includes('FROM document_versions dv')) return { rows: [{ id: versionId, document_id: randomUUID() }] };
        if (sql.includes('FROM document_assets da')) return { rows: [{ asset_id: assetId, status: 'ACTIVE', deleted_at: null }] };
        if (sql.includes("UPDATE defects")) return { rowCount: 1 };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    return { service: new WarrantyAndBillingService({
      connect: jest.fn(async () => client),
    } as any), queries };
  }

  it('PH4-G17-005: never overwrites an already RECTIFIED remedy without independent reversal', async () => {
    const queries: string[] = [];
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM projects') && sql.includes('FOR UPDATE')) {
              return { rows: [{ id: projectId, status: 'ACTIVE',
                closed_at: null, purged_at: null }] };
            }
            if (sql.includes('FROM defects d')) return { rows: [{
          id: defectId, org_id: orgId, project_id: projectId,
          asset_id: assetId, status: 'RECTIFIED', row_version: 2,
          closure_evidence_object_id: objectId, remedy_document_version_id: versionId,
        }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    })) };
    await expect(new WarrantyAndBillingService(pool).submitDefectRemedy(
      ctx, projectId, defectId, randomUUID(), 2,
    )).rejects.toMatchObject({ response: { code: 'DEFECT_REMEDY_TRANSITION_NOT_ALLOWED' } });
    expect(queries.some(sql => sql.includes('UPDATE defects'))).toBe(false);
  });

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
        if (sql.includes('FROM projects') && sql.includes('FOR UPDATE')) {
              return { rows: [{ id: projectId, status: 'ACTIVE',
                closed_at: null, purged_at: null }] };
            }
            if (sql.includes('FROM defects d')) return { rows: [{
          id: defectId, org_id: orgId, project_id: projectId, asset_id: assetId,
          status: 'RECTIFIED', row_version: 2, remedied_by: randomUUID(),
          closure_evidence_object_id: objectId, remedy_document_version_id: original,
          remedy_sha256: 'a'.repeat(64), remedy_provider_version_id: 'v1',
          remedy_size_bytes: 1024, remedy_scanned_at: '2026-11-12T10:00:00Z',
          remedy_asset_scope_ids: [assetId],
        }] };
        if (sql.includes('FROM storage_objects so')) return { rows: [{
          id: objectId, status: 'READY', sha256: 'a'.repeat(64),
          size_bytes: 1024, observed_size_bytes: 1024,
          provider_version_id: 'v1', av_scanned_at: '2026-11-12T10:00:00Z', linked_in_project: true,
          linked_to_defect_asset: true,
        }] };
        if (sql.includes('FROM document_versions dv')) return { rows: [{ id: newer, document_id: randomUUID() }] };
        if (sql.includes('FROM document_assets da')) return { rows: [{ asset_id: assetId, status: 'ACTIVE', deleted_at: null }] };
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

describe('PH4-G17-006 defect severity contract', () => {
  const ctx: any = {
    orgId: randomUUID(), userId: randomUUID(), actorType: 'SYSTEM',
    requestId: randomUUID(), ip: '127.0.0.1', userAgent: 'phase4-test',
  };
  it('fails before DB access for unknown severity and empty title', async () => {
    const pool: any = { connect: jest.fn(() => { throw new Error('DATABASE_SHOULD_NOT_BE_CALLED'); }) };
    const svc = new WarrantyAndBillingService(pool);
    await expect(svc.createDefect(ctx, randomUUID(), {
      title: 'Unsafe', severity: 'SAFETY' as any,
    })).rejects.toMatchObject({ response: { code: 'DEFECT_SEVERITY_UNSUPPORTED' } });
    await expect(svc.createDefect(ctx, randomUUID(), {
      title: '  ', severity: 'CRITICAL',
    })).rejects.toMatchObject({ response: { code: 'DEFECT_INPUT_INVALID' } });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('maps only documented legacy alias MAJOR to HIGH, never arbitrary severity', async () => {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT id, status, closed_at, purged_at') &&
            sql.includes('FROM projects')) {
          return { rows: [{ id: params[1], status: 'ACTIVE',
            closed_at: null, purged_at: null }] };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    })) };
    const result = await new WarrantyAndBillingService(pool).createDefect(ctx, randomUUID(), {
      title: ' Commissioning discrepancy ', severity: 'MAJOR',
    });
    expect(result.severity).toBe('HIGH');
    const inserted = queries.find(q => q.sql.includes('INSERT INTO defects'));
    expect(inserted).toBeDefined();
    expect(inserted?.params[4]).toBe('Commissioning discrepancy');
    expect(inserted?.params[6]).toBe('HIGH');
    expect(queries.some(q => q.sql === 'COMMIT')).toBe(true);
  });
});
