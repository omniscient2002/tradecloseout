import { randomUUID } from 'node:crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G17-003/G17-004 Pass 1 project lifecycle and current defect authority', () => {
  const orgId = randomUUID(), projectId = randomUUID(), defectId = randomUUID();
  const assetId = randomUUID(), packageId = randomUUID(), objectId = randomUUID();
  const versionId = randomUUID(), assigneeId = randomUUID(), reviewerId = randomUUID();
  const base = (userId = assigneeId): any => ({
    orgId, userId, actorType: 'MEMBER', orgRole: 'R-PM',
    projectRole: 'R-PM', requestId: randomUUID(),
    ip: '127.0.0.1', userAgent: 'phase4-pass1-test',
  });
  type Scenario = {
    projectStatus?: string;
    defectContext?: 'CLOSEOUT' | 'AFTERCARE';
    defectStatus?: string;
    acceptedStatus?: string;
    acceptedPackageId?: string;
    assignee?: string | null;
    assetCategory?: string;
    assignedParty?: string | null;
    projectOfDefect?: string;
  };
  function fixture(input: Scenario = {}) {
    const calls: {sql: string; params: any[]}[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        calls.push({sql, params});
        if (sql.includes('SELECT project_id FROM defects')) {
          return {rows: [{project_id: input.projectOfDefect ?? projectId}]};
        }
        if (sql.includes('FROM projects') && sql.includes('FOR UPDATE')) {
          return {rows: [{id: projectId, status: input.projectStatus ?? 'ACTIVE',
            closed_at: input.projectStatus === 'CLOSED'
              ? '2026-11-11T12:00:00.000Z' : null,
            purged_at: null}]};
        }
        if (sql.includes('SELECT d.* FROM defects d')) {
          return {rows: [{
            id: defectId, org_id: orgId,
            project_id: input.projectOfDefect ?? projectId,
            asset_id: assetId,
            assigned_party_id: input.assignedParty ?? null,
            assigned_user_id: input.assignee === undefined ? assigneeId : input.assignee,
            defect_context: input.defectContext ?? 'CLOSEOUT',
            accepted_package_id: input.acceptedPackageId ?? packageId,
            status: input.defectStatus ?? 'OPEN', row_version: 1,
            raised_at: '2026-11-09T10:00:00Z',
            remedy_document_version_id: versionId,
            closure_evidence_object_id: objectId,
            remedied_by: assigneeId,
          }]};
        }
        if (sql.includes('FROM handover_packages') &&
            sql.includes("package_purpose = 'FULL_HANDOVER'")) {
          return {rows: [{id: packageId, status: input.acceptedStatus ?? 'ACCEPTED'}]};
        }
        if (sql.includes('FROM assets') && sql.includes('SELECT category_key')) {
          return {rows: [{category_key: input.assetCategory ?? 'AHU'}]};
        }
        if (sql.includes('FROM storage_objects so')) {
          return {rows: [{
            id: objectId, status: 'READY', sha256: 'a'.repeat(64),
            provider_version_id: 'provider-version-1',
            size_bytes: 1024, observed_size_bytes: 1024,
            linked_in_project: true, linked_to_defect_asset: true,
          }]};
        }
        if (sql.includes('FROM document_versions dv')) {
          return {rows: [{id: versionId, document_id: randomUUID()}]};
        }
        if (sql.includes('SELECT id FROM document_assets')) {
          return {rows: [{id: randomUUID()}]};
        }
        if (sql.includes('UPDATE defects')) return {rowCount: 1, rows: []};
        return {rows: [], rowCount: 1};
      }),
      release: jest.fn(),
    };
    const pool = {connect: jest.fn(async () => client)};
    return {service: new WarrantyAndBillingService(pool as any), calls, client};
  }

  it('serializes closeout remedy with project closure and rejects CLOSED baseline edits before evidence reads', async () => {
    const {service, calls} = fixture({projectStatus: 'CLOSED'});
    await expect(service.submitDefectRemedy(
      base(), projectId, defectId, objectId, 1,
    )).rejects.toMatchObject({response: {code: 'CLOSEOUT_DEFECT_PROJECT_LIFECYCLE_BLOCKED'}});
    const p = calls.findIndex(q => q.sql.includes('FROM projects') && q.sql.includes('FOR UPDATE'));
    const d = calls.findIndex(q => q.sql.includes('SELECT d.* FROM defects d'));
    expect(p).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThan(p);
    expect(calls.some(q => q.sql.includes('FROM storage_objects so'))).toBe(false);
    expect(calls.some(q => q.sql.includes('UPDATE defects'))).toBe(false);
  });

  it('rejects archive/suspension aftercare transitions without modifying accepted package', async () => {
    for (const projectStatus of ['ARCHIVED', 'SUSPENDED', 'CANCELLED']) {
      const {service, calls} = fixture({projectStatus, defectContext: 'AFTERCARE'});
      await expect(service.submitDefectRemedy(
        base(), projectId, defectId, objectId, 1,
      )).rejects.toMatchObject({response: {code: 'AFTERCARE_MUTATION_LIFECYCLE_BLOCKED'}});
      expect(calls.some(q => q.sql.includes('UPDATE handover_packages'))).toBe(false);
      expect(calls.some(q => q.sql.includes('UPDATE defects'))).toBe(false);
    }
  });

  it('denies aftercare when its accepted dossier is superseded or no longer accepted', async () => {
    for (const scenario of [
      {acceptedStatus: 'READY'}, {acceptedPackageId: randomUUID()},
    ]) {
      const {service, calls} = fixture({
        projectStatus: 'CLOSED', defectContext: 'AFTERCARE', ...scenario,
      });
      await expect(service.submitDefectRemedy(
        base(), projectId, defectId, objectId, 1,
      )).rejects.toMatchObject({response: {code: 'AFTERCARE_ACCEPTED_PACKAGE_CHANGED'}});
      expect(calls.some(q => q.sql.includes('UPDATE defects'))).toBe(false);
    }
  });

  it('can record a legitimate postclose aftercare remedy without modifying the accepted dossier', async () => {
    const {service, calls} = fixture({projectStatus: 'CLOSED', defectContext: 'AFTERCARE'});
    const result = await service.submitDefectRemedy(base(), projectId, defectId, objectId, 1);
    expect(result.status).toBe('RECTIFIED');
    expect(result.rowVersion).toBe(2);
    expect(calls.some(q => q.sql.includes('UPDATE handover_packages'))).toBe(false);
    expect(calls.some(q => q.sql.includes('UPDATE projects'))).toBe(false);
    expect(calls.some(q => q.sql.includes("status = 'RECTIFIED'"))).toBe(true);
  });

  it('denies a different internal assignee who merely has project-wide defect.manage', async () => {
    const {service, calls} = fixture({assignee: assigneeId});
    await expect(service.submitDefectRemedy(
      base(reviewerId), projectId, defectId, objectId, 1,
    )).rejects.toMatchObject({response: {code: 'DEFECT_NOT_ASSIGNED_TO_MEMBER'}});
    expect(calls.some(q => q.sql.includes('UPDATE defects'))).toBe(false);
  });

  it('denies member remedy for narrowed asset, category and READ_ONLY resource scopes', async () => {
    for (const projectScope of [
      {assetIds: [randomUUID()]},
      {assetCategories: ['CHILLER']},
      {mode: 'READ_ONLY'},
    ]) {
      const {service, calls} = fixture();
      await expect(service.submitDefectRemedy(
        {...base(), projectScope}, projectId, defectId, objectId, 1,
      )).rejects.toMatchObject({response: {code: 'DEFECT_ASSET_SCOPE_DENIED'}});
      expect(calls.some(q => q.sql.includes('UPDATE defects'))).toBe(false);
    }
  });

  it('requires an eligible QC/PM/Owner verifier, separate from the remedy actor', async () => {
    const {service, calls} = fixture({defectStatus: 'RECTIFIED'});
    await expect(service.closeDefect(
      {...base(reviewerId), orgRole: 'R-SITE', projectRole: 'R-SITE'},
      projectId, defectId, objectId, 1,
    )).rejects.toMatchObject({response: {code: 'DEFECT_VERIFIER_ROLE_REQUIRED'}});
    expect(calls.some(q => q.sql.includes('UPDATE defects'))).toBe(false);
  });

  it('keeps standalone defect IDs project-bound and never infers scope from request body', async () => {
    const {service, calls} = fixture();
    const result = await service.submitDefectRemedy(base(), '', defectId, objectId, 1);
    expect(result.status).toBe('RECTIFIED');
    expect(calls.some(q => q.sql.includes('SELECT project_id FROM defects'))).toBe(true);
    expect(calls.some(q => q.sql.includes('FROM projects') &&
      q.sql.includes('FOR UPDATE'))).toBe(true);
  });

  it('uses assigned-user and member asset/category/date filters for narrow list access', async () => {
    const {service, calls} = fixture();
    await service.listDefects({
      ...base(), orgRole: 'R-SITE', projectRole: 'R-SITE',
      projectScope: {
        assetIds: [assetId],
        assetCategories: ['AHU'],
        startDate: '2026-11-01',
        endDate: '2026-11-30',
      },
    }, projectId);
    const q = calls.find(x => x.sql.includes('SELECT d.*, a.tag AS asset_tag'));
    expect(q).toBeDefined();
    expect(q?.params[3]).toEqual([assetId]);
    expect(q?.params[4]).toEqual(['AHU']);
    expect(q?.params[5]).toBe(assigneeId);
    expect(q?.params.slice(6, 8)).toEqual(['2026-11-01', '2026-11-30']);
    expect(q?.sql).toContain('d.assigned_user_id = $6');
  });
});
