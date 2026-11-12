import { randomUUID } from 'node:crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G17-001/002 Pass 03: immutable scanner bytes and full target-set qualification', () => {
  const orgId = randomUUID(), projectId = randomUUID(), defectId = randomUUID();
  const assetA = randomUUID(), assetB = randomUUID(), evidenceId = randomUUID();
  const remedyVersionId = randomUUID(), documentId = randomUUID();
  const submitter = randomUUID(), verifier = randomUUID();
  const scannedAt = '2026-11-12T10:00:00.000Z';
  const ctx = (userId: string): any => ({
    orgId, userId, actorType: 'SYSTEM', requestId: randomUUID(),
    ip: '127.0.0.1', userAgent: 'p3-scanner-qualification',
  });

  function fixture(options: {
    assetId?: string | null;
    requirementId?: string | null;
    scope?: string[];
    inactiveAsset?: string;
    scannerTime?: string | null;
    storageStatus?: string;
    sha256?: string;
    expectedSha256?: string | null;
    providerVersion?: string;
    sizeBytes?: number;
    observedSizeBytes?: number;
    versionMetadata?: Record<string, unknown>;
    requirementLinked?: boolean;
    linkedInProject?: boolean;
    linkedToAsset?: boolean;
  } = {}) {
    const calls: {sql: string; params: unknown[]}[] = [];
    const state: any = {
      id: defectId, org_id: orgId, project_id: projectId,
      asset_id: options.assetId === undefined ? assetA : options.assetId,
      requirement_id: options.requirementId ?? null,
      status: 'OPEN', row_version: 1, assigned_user_id: null,
      remedied_by: null, closure_evidence_object_id: null,
      remedy_document_version_id: null,
    };
    const object: any = {
      id: evidenceId, status: options.storageStatus ?? 'READY',
      sha256: options.sha256 ?? 'a'.repeat(64),
      expected_sha256: options.expectedSha256 ?? null,
      provider_version_id: options.providerVersion ?? 'immutable-v123',
      size_bytes: options.sizeBytes ?? 1024,
      observed_size_bytes: options.observedSizeBytes ?? 1024,
      av_scanned_at: options.scannerTime === undefined ? scannedAt : options.scannerTime,
      linked_in_project: options.linkedInProject ?? true,
      linked_to_defect_asset: options.linkedToAsset ?? true,
    };
    let scopedAssets = options.scope ?? [assetA, assetB];
    const client = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        calls.push({sql, params});
        if (sql.includes('FROM projects') && sql.includes('FOR UPDATE')) {
          return {rows: [{id: projectId, status: 'ACTIVE', purged_at: null}]};
        }
        if (sql.includes('SELECT d.* FROM defects d')) {
          return {rows: [{...state}]};
        }
        if (sql.includes('FROM storage_objects so')) {
          expect(sql).toContain('FOR SHARE OF so');
          return {rows: [{...object}]};
        }
        if (sql.includes('FROM document_versions dv')) {
          expect(sql).toContain('FOR SHARE OF dv FOR UPDATE OF d');
          return {rows: [{id: remedyVersionId, document_id: documentId,
            metadata_json: options.versionMetadata || {}}]};
        }
        if (sql.includes('FROM document_assets da')) {
          expect(sql).toContain('FOR SHARE OF da, a');
          return {rows: scopedAssets.map(asset_id => ({
            asset_id, status: options.inactiveAsset === asset_id ? 'RETIRED' : 'ACTIVE',
            deleted_at: null,
          }))};
        }
        if (sql.includes('FROM document_requirements')) {
          return {rows: options.requirementLinked ? [{id: randomUUID()}] : []};
        }
        if (sql.includes('UPDATE defects') && sql.includes("status = 'RECTIFIED'")) {
          state.status = 'RECTIFIED';
          state.row_version = 2;
          state.closure_evidence_object_id = params[3];
          state.remedied_by = params[4];
          state.remedy_document_version_id = params[6];
          state.remedy_sha256 = params[7];
          state.remedy_provider_version_id = params[8];
          state.remedy_size_bytes = params[9];
          state.remedy_scanned_at = params[10];
          state.remedy_asset_scope_ids = params[11];
          return {rowCount: 1};
        }
        if (sql.includes('UPDATE defects') && sql.includes("status = 'CLOSED'")) {
          state.status = 'CLOSED';
          state.row_version = 3;
          return {rowCount: 1};
        }
        return {rows: [], rowCount: 1};
      }),
      release: jest.fn(),
    };
    const service = new WarrantyAndBillingService({
      connect: jest.fn(async () => client),
    } as any);
    return {service, state, object, calls,
      replaceScope: (assetIds: string[]) => {scopedAssets = assetIds;}};
  }

  it('accepts shared evidence only if the complete ACTIVE set explicitly contains the defect asset', async () => {
    const {service, state, calls} = fixture();
    const submitted = await service.submitDefectRemedy(
      ctx(submitter), projectId, defectId, evidenceId, 1,
    );
    expect(submitted.status).toBe('RECTIFIED');
    expect(state.remedy_sha256).toBe('a'.repeat(64));
    expect(state.remedy_provider_version_id).toBe('immutable-v123');
    expect(state.remedy_size_bytes).toBe(1024);
    expect(state.remedy_asset_scope_ids).toEqual([assetA, assetB].sort());
    const receipt = calls.find(x => x.sql.includes('INSERT INTO defect_transition_events'));
    expect(receipt?.params[21]).toBe('a'.repeat(64));
    expect(receipt?.params[22]).toBe('immutable-v123');
    expect(receipt?.params[25]).toEqual([assetA, assetB].sort());

    const independent = await service.closeDefect(
      ctx(verifier), projectId, defectId, evidenceId, 2,
    );
    expect(independent.status).toBe('CLOSED');
    expect(calls.some(x => x.sql.includes("status = 'CLOSED'"))).toBe(true);
  });

  it.each([
    ['READY-only marker without scanner', {scannerTime: null}],
    ['wrong client checksum', {expectedSha256: 'b'.repeat(64)}],
    ['no immutable provider version', {providerVersion: 'unversioned'}],
    ['invalid server SHA', {sha256: 'same-size-no-hash'}],
    ['observed size differs', {observedSizeBytes: 1023}],
    ['zero sized evidence', {sizeBytes: 0, observedSizeBytes: 0}],
  ])('fails closed on %s before writing any remedy', async (_label, settings) => {
    const {service, calls} = fixture(settings as any);
    await expect(service.submitDefectRemedy(
      ctx(submitter), projectId, defectId, evidenceId, 1,
    )).rejects.toMatchObject({response: {code: 'DEFECT_EVIDENCE_NOT_VERIFIED'}});
    expect(calls.some(x => x.sql.includes('UPDATE defects'))).toBe(false);
  });

  it.each(['QUARANTINED','DELETED','FAILED','PROCESSING'])(
    'refuses storage status %s even when a digest and scan date are present',
    async status => {
      const {service, calls} = fixture({storageStatus: status});
      await expect(service.submitDefectRemedy(
        ctx(submitter), projectId, defectId, evidenceId, 1,
      )).rejects.toMatchObject({
        response: {code: 'CLOSURE_EVIDENCE_NOT_FOUND_OR_NOT_READY'},
      });
      expect(calls.some(q => q.sql.includes('UPDATE defects'))).toBe(false);
    },
  );

  it('rejects a shared document with a retired asset even when the defect asset is active', async () => {
    const {service, calls} = fixture({inactiveAsset: assetB});
    await expect(service.submitDefectRemedy(
      ctx(submitter), projectId, defectId, evidenceId, 1,
    )).rejects.toMatchObject({response: {code: 'DEFECT_REMEDY_INACTIVE_SHARED_ASSET'}});
    expect(calls.some(x => x.sql.includes('UPDATE defects'))).toBe(false);
  });

  it('requires a positive exact link, not a misleading storage-key or LIMIT 1 match', async () => {
    const {service, calls} = fixture({scope: [assetB]});
    await expect(service.submitDefectRemedy(
      ctx(submitter), projectId, defectId, evidenceId, 1,
    )).rejects.toMatchObject({response: {code: 'DEFECT_REMEDY_ASSET_LINK_REVOKED'}});
    expect(calls.some(x => x.sql.includes('UPDATE defects'))).toBe(false);
  });

  it('rejects an unbound project-wide object unless an explicit defect or requirement relation exists', async () => {
    const {service} = fixture({assetId: null, scope: [], versionMetadata: {}});
    await expect(service.submitDefectRemedy(
      ctx(submitter), projectId, defectId, evidenceId, 1,
    )).rejects.toMatchObject({response: {code: 'DEFECT_REMEDY_EXPLICIT_SCOPE_REQUIRED'}});
    const {service: qualified} = fixture({
      assetId: null, scope: [],
      versionMetadata: {remedyDefectId: defectId},
    });
    await expect(qualified.submitDefectRemedy(
      ctx(submitter), projectId, defectId, evidenceId, 1,
    )).resolves.toMatchObject({status: 'RECTIFIED'});
  });

  it('supports requirement-qualified evidence when the exact document link is recorded', async () => {
    const {service} = fixture({
      assetId: null, requirementId: randomUUID(),
      scope: [], requirementLinked: true,
    });
    await expect(service.submitDefectRemedy(
      ctx(submitter), projectId, defectId, evidenceId, 1,
    )).resolves.toMatchObject({status: 'RECTIFIED'});
  });

  it.each([
    ['same-size checksum mutation', (f: any) => {f.object.sha256 = 'b'.repeat(64);}],
    ['provider-version mutation', (f: any) => {f.object.provider_version_id = 'immutable-v999';}],
    ['verified byte size mutation', (f: any) => {
      f.object.size_bytes = 2048; f.object.observed_size_bytes = 2048;
    }],
    ['new full-scope target', (f: any) => {f.replaceScope([assetA, assetB, randomUUID()]);}],
    ['removed unrelated shared asset', (f: any) => {f.replaceScope([assetA]);}],
    ['scanner timestamp mutation', (f: any) => {f.object.av_scanned_at = '2026-11-12T10:01:00Z';}],
  ])('prevents independent closure after %s without changing CLOSED state', async (_name, mutate) => {
    const f = fixture();
    await f.service.submitDefectRemedy(ctx(submitter), projectId, defectId, evidenceId, 1);
    (mutate as (f: typeof f) => void)(f);
    await expect(f.service.closeDefect(
      ctx(verifier), projectId, defectId, evidenceId, 2,
    )).rejects.toMatchObject({response: {code: 'DEFECT_REMEDY_IMMUTABLE_RECEIPT_CHANGED'}});
    expect(f.state.status).toBe('RECTIFIED');
    expect(f.calls.some(x => x.sql.includes("status = 'CLOSED'"))).toBe(false);
  });

  it('rejects historical RECTIFIED remedies without a scanner receipt instead of inventing one', async () => {
    const f = fixture();
    f.state.status = 'RECTIFIED';
    f.state.row_version = 2;
    f.state.remedied_by = submitter;
    f.state.closure_evidence_object_id = evidenceId;
    f.state.remedy_document_version_id = remedyVersionId;
    await expect(f.service.closeDefect(
      ctx(verifier), projectId, defectId, evidenceId, 2,
    )).rejects.toMatchObject({response: {code: 'DEFECT_LEGACY_REMEDY_RECEIPT_UNPINNED'}});
  });
});
