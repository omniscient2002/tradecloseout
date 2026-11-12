import { uuidv7 } from 'uuidv7';
import { HandoverService } from '../src/modules/handover/handover.service';

describe('PH4-G14-002: atomic frozen handover package manifest', () => {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const reqId = uuidv7();
  const versionId = uuidv7();
  const docId = uuidv7();
  const objectId = uuidv7();
  const snapshotId = uuidv7();
  const ctx: any = {
    orgId, userId: uuidv7(), actorType: 'SYSTEM',
    requestId: 'phase4-snapshot', ip: '127.0.0.1', userAgent: 'jest',
  };

  const source = {
    document_version_id: versionId, document_id: docId, object_id: objectId,
    title: 'AHU test certificate', revision_code: 'R2',
    bucket: 'vault', object_key: 'orgs/example/test-immutable.pdf',
    mime: 'application/pdf', sha256: 'a'.repeat(64),
    size_bytes: '4096', provider_version_id: 'v-immutable-123',
  };

  function fakeDb(overrides: {
    projectStatus?: string;
    activeSnapshots?: number;
    pinnedSources?: any[];
    approved?: boolean;
  } = {}) {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT id, status FROM projects')) {
          return { rows: [{ id: projectId, status: overrides.projectStatus ?? 'HANDOVER' }] };
        }
        if (sql.includes('SELECT p.code AS project_code, p.name AS project_name')) {
          return { rows: [{
            project_code: 'PROJECT-A', project_name: 'HVAC Site A',
            org_name: 'Engineering Company', contract_ref: 'CONTRACT-1', client_name: 'Customer Ltd',
          }] };
        }
        if (sql.includes('SELECT r.id, r.requirement_key, r.title, r.mandatory')) {
          return { rows: [{
            id: reqId, requirement_key: 'AHU-ITR', mandatory: true,
            has_approved_evidence: overrides.approved !== false,
            has_expired_approved_evidence: false,
            has_expiring_approved_evidence: false, has_valid_waiver: false,
            status: 'APPROVED',
          }] };
        }
        if (sql.includes('SELECT id, resolved_payload_json FROM checklist_snapshots')) {
          return { rows: [{ id: snapshotId, resolved_payload_json: {
            requirements: [{ key: 'AHU-ITR', mandatory: true }],
          } }] };
        }
        if (sql.includes('SELECT id, checksum FROM checklist_snapshots')) {
          const n = overrides.activeSnapshots ?? 1;
          return { rows: Array.from({ length: n }, (_, i) =>
            ({ id: i ? uuidv7() : snapshotId, checksum: 'a'.repeat(64) })) };
        }
        if (sql.includes('SELECT value FROM usage_counters')) {
          return { rows: [{ value: '0' }] };
        }
        if (sql.includes('MAX(version_no)')) return { rows: [{ max_ver: 0 }] };
        if (sql.includes('SELECT r.id, r.requirement_key, r.scope_key')) {
          return { rows: [{
            id: reqId, requirement_key: 'AHU-ITR', title: 'AHU ITR',
            scope_key: 'project', doc_type_key: 'DT-001', mandatory: true,
            status: 'APPROVED', due_at: null,
            version_ids: [versionId], has_valid_evidence: overrides.approved !== false,
            has_expired_evidence: false, revision_code: 'R2',
            valid_waiver_type: null, asset_tag: null,
          }] };
        }
        if (sql.includes('SELECT dv.id AS document_version_id')) {
          return { rows: overrides.pinnedSources ?? [source] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: jest.fn(),
    };
    return { client, queries, pool: { connect: jest.fn(async () => client) } as any };
  }

  it('uses REPEATABLE READ before the project lock and persists pinned source and decision facts', async () => {
    const { pool, queries } = fakeDb();
    const result = await new HandoverService(pool, {} as any)
      .requestHandoverPackageGeneration(ctx, projectId, {});
    expect(result.status).toBe('QUEUED');
    const sqls = queries.map(q => q.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const lockIndex = sqls.findIndex(x => x.includes('SELECT id, status FROM projects'));
    const readyIndex = sqls.findIndex(x => x.includes('SELECT r.id, r.requirement_key, r.title'));
    const versionIndex = sqls.findIndex(x => x.includes('SELECT dv.id AS document_version_id'));
    expect(lockIndex).toBeGreaterThan(0);
    expect(readyIndex).toBeGreaterThan(lockIndex);
    expect(versionIndex).toBeGreaterThan(readyIndex);
    const packageInsert = queries.find(q => q.sql.includes('INSERT INTO handover_packages'));
    expect(packageInsert?.sql).toContain('manifest_format_version');
    expect(packageInsert?.sql).toContain("'FULL_HANDOVER', 2");
    const cover = JSON.parse(packageInsert?.params[8]);
    expect(cover).toEqual({
      orgName: 'Engineering Company',
      projectCode: 'PROJECT-A',
      projectName: 'HVAC Site A',
      contractRef: 'CONTRACT-1',
      clientName: 'Customer Ltd',
    });
    const sourceInsert = queries.find(q => q.sql.includes('INSERT INTO package_items'));
    expect(sourceInsert?.sql).toContain('source_object_id');
    expect(sourceInsert?.params[10]).toBe(objectId);
    expect(sourceInsert?.params[11]).toBe(source.title);
    expect(sourceInsert?.params[17]).toBe(source.sha256);
    expect(sourceInsert?.params[18]).toBe(source.provider_version_id);
    const requirementInsert = queries.find(q => q.sql.includes('INSERT INTO package_requirements'));
    expect(requirementInsert?.sql).toContain('waiver_id_at_generation');
    expect(requirementInsert?.params[13]).toBe('R2');
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
  });

  it('PH4-G14-001: rejects exclusions and unrecognized package scopes before opening a transaction', async () => {
    const { pool } = fakeDb();
    const svc = new HandoverService(pool, {} as any);
    for (const value of [
      { excludedRequirementIds: [{ requirementId: reqId, reason: 'Sensitive'}] },
      { excludedRequirementIds: 'not-an-array' },
      { scope: { type: 'ASSET', assetIds: [uuidv7()] } },
      null,
    ]) {
      await expect(svc.requestHandoverPackageGeneration(ctx, projectId, value as any))
        .rejects.toBeDefined();
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects a closed project under the same project lock as closure', async () => {
    const { pool, queries } = fakeDb({ projectStatus: 'CLOSED' });
    await expect(new HandoverService(pool, {} as any)
      .requestHandoverPackageGeneration(ctx, projectId, {}))
      .rejects.toMatchObject({ response: { code: 'PACKAGE_PROJECT_LIFECYCLE_BLOCKED' } });
    expect(queries.some(q => q.sql.includes('INSERT INTO handover_packages'))).toBe(false);
    expect(queries.map(q => q.sql)).toContain('ROLLBACK');
  });

  it('rejects ambiguous active snapshots rather than choosing an arbitrary checklist', async () => {
    const { pool, queries } = fakeDb({ activeSnapshots: 2 });
    await expect(new HandoverService(pool, {} as any)
      .requestHandoverPackageGeneration(ctx, projectId, {}))
      .rejects.toMatchObject({ response: { code: 'MULTIPLE_ACTIVE_SNAPSHOTS' } });
    expect(queries.some(q => q.sql.includes('INSERT INTO handover_packages'))).toBe(false);
    expect(queries.map(q => q.sql)).toContain('ROLLBACK');
  });

  it('refuses missing frozen storage receipts and rolls back the whole manifest', async () => {
    const { pool, queries } = fakeDb({ pinnedSources: [] });
    await expect(new HandoverService(pool, {} as any)
      .requestHandoverPackageGeneration(ctx, projectId, {}))
      .rejects.toMatchObject({ response: { code: 'PACKAGE_MANIFEST_SOURCE_NOT_PINNED' } });
    expect(queries.some(q => q.sql.includes('INSERT INTO package_items'))).toBe(false);
    expect(queries.map(q => q.sql)).toContain('ROLLBACK');
  });

  it('refuses conflicting canonical readiness and selected-source requirements', async () => {
    const { pool, queries } = fakeDb({ approved: false });
    await expect(new HandoverService(pool, {} as any)
      .requestHandoverPackageGeneration(ctx, projectId, {}))
      .rejects.toMatchObject({ response: { code: 'READINESS_BLOCKERS_PRESENT' } });
    expect(queries.some(q => q.sql.includes('INSERT INTO handover_packages'))).toBe(false);
  });
});
