import { randomUUID } from 'node:crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G17-005/006 Pass 2 defect revisions and recovery', () => {
  const orgId = randomUUID(), projectId = randomUUID(), defectId = randomUUID();
  const assigneeId = randomUUID(), reviewerId = randomUUID(), assetId = randomUUID();
  const objectId = randomUUID(), versionId = randomUUID(), partyId = randomUUID();
  const reason = 'Independent inspection found the submitted repair incomplete.';
  const pm = (): any => ({
    orgId, userId: reviewerId, actorType: 'MEMBER',
    orgRole: 'R-PM', projectRole: 'R-PM', requestId: randomUUID(),
    ip: '127.0.0.1', userAgent: 'pass2-jest',
  });
  const qc = (): any => ({...pm(), orgRole: 'R-QC', projectRole: 'R-QC'});
  type Options = {
    status?: string; severity?: string; mandatory?: boolean;
    assignment?: string | null; projectStatus?: string;
    inactiveMember?: boolean; inactiveParty?: boolean;
    differentProject?: boolean; role?: string;
  };
  function fixture(opts: Options = {}) {
    const state: any = {
      id: defectId, org_id: orgId,
      project_id: opts.differentProject ? randomUUID() : projectId,
      asset_id: null,
      defect_context: 'CLOSEOUT',
      status: opts.status ?? 'OPEN', row_version: 1,
      severity: opts.severity ?? 'MEDIUM',
      mandatory: opts.mandatory ?? true,
      assigned_user_id: opts.assignment === undefined ? assigneeId : opts.assignment,
      assigned_party_id: null, raised_at: '2026-11-10T10:00:00Z',
      closure_evidence_object_id: opts.status === 'RECTIFIED' ||
        opts.status === 'CLOSED' ? objectId : null,
      remedy_document_version_id: opts.status === 'RECTIFIED' ||
        opts.status === 'CLOSED' ? versionId : null,
      remedied_by: assigneeId, due_at: null,
    };
    const calls: Array<{sql: string; params: any[]}> = [];
    const pool: any = {
      connect: jest.fn(async () => ({
        query: jest.fn(async (sql: string, params: any[] = []) => {
          calls.push({sql, params});
          if (sql.includes('FROM projects') && sql.includes('FOR UPDATE'))
            return {rows: [{id: projectId, status: opts.projectStatus ?? 'ACTIVE', purged_at: null}]};
          if (sql.includes('SELECT d.* FROM defects d') || sql.includes('SELECT d.* FROM defects d'))
            return {rows: [{...state}]};
          if (sql.includes('FROM project_members pm'))
            return {rows: opts.inactiveMember ? [] : [{user_id: params[2]}]};
          if (sql.includes('SELECT id FROM parties'))
            return {rows: opts.inactiveParty ? [] : [{id: params[1]}]};
          if (sql.includes('FROM storage_objects so'))
            return {rows: [{
              id: objectId, status: 'READY', sha256: 'a'.repeat(64),
              provider_version_id: 'provider-v1',
              size_bytes: 1024, observed_size_bytes: 1024,
              linked_in_project: true, linked_to_defect_asset: true,
            }]};
          if (sql.includes('FROM document_versions dv'))
            return {rows: [{id: versionId, document_id: randomUUID()}]};
          if (sql.includes('UPDATE defects')) {
            if (sql.includes("status = 'IN_PROGRESS'")) state.status = 'IN_PROGRESS';
            if (sql.includes("status = 'RECTIFIED'")) state.status = 'RECTIFIED';
            if (sql.includes("status = 'CLOSED'")) state.status = 'CLOSED';
            if (sql.includes("status = 'WAIVED'")) state.status = 'WAIVED';
            if (sql.includes("status = 'OPEN'")) state.status = 'OPEN';
            if (sql.includes('status = $7')) state.status = params[6];
            if (sql.includes('assigned_user_id = $4')) state.assigned_user_id = params[3];
            if (sql.includes('assigned_party_id = $5')) state.assigned_party_id = params[4];
            if (sql.includes('SET severity = $4')) state.severity = params[3];
            if (sql.includes('remedy_document_version_id = $7'))
              state.remedy_document_version_id = params[6];
            if (sql.includes('closure_evidence_object_id = $4'))
              state.closure_evidence_object_id = params[3];
            if (sql.includes('remedy_document_version_id = NULL')) {
              state.remedy_document_version_id = null;
              state.closure_evidence_object_id = null;
              state.remedied_by = null;
            }
            state.row_version++;
            return {rowCount: 1, rows: []};
          }
          return {rows: [], rowCount: 1};
        }),
        release: jest.fn(),
      })),
    };
    return {service: new WarrantyAndBillingService(pool), calls, state};
  }
  const actions = (calls: Array<{sql: string; params: any[]}>) =>
    calls.filter(c => c.sql.includes('INSERT INTO defect_transition_events'));

  it('assigns only an active project member and records one immutable versioned history event', async () => {
    const {service, calls, state} = fixture({assignment: null});
    const result = await service.assignDefect(pm(), projectId, defectId, {
      expectedRowVersion: 1, assignedUserId: assigneeId,
      assignedPartyId: partyId, dueAt: '2026-12-03T12:00:00Z',
      reason: 'Assign trained contractor and accountable site officer.',
    });
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.rowVersion).toBe(2);
    expect(state.assigned_user_id).toBe(assigneeId);
    expect(actions(calls)).toHaveLength(1);
    const event = actions(calls)[0].params;
    expect(event[4]).toBe('ASSIGNED');
    expect(event.slice(5, 9)).toEqual(['OPEN', 'IN_PROGRESS', 1, 2]);
    expect(event[10]).toBe(assigneeId);
    expect(event[11]).toBe(partyId);
  });

  it('rejects inactive assignees and parties and preserves the old row/version', async () => {
    for (const options of [{inactiveMember: true}, {inactiveParty: true}]) {
      const {service, calls, state} = fixture(options);
      await expect(service.assignDefect(pm(), projectId, defectId, {
        expectedRowVersion: 1, assignedUserId: assigneeId, assignedPartyId: partyId,
      })).rejects.toMatchObject({
        response: {code: options.inactiveMember ? 'DEFECT_ASSIGNEE_INACTIVE' : 'DEFECT_PARTY_INACTIVE'},
      });
      expect(state.row_version).toBe(1);
      expect(actions(calls)).toHaveLength(0);
    }
  });

  it('does not allow a stale assign or severity correction to overwrite a newer decision', async () => {
    const {service, calls} = fixture();
    await expect(service.assignDefect(pm(), projectId, defectId, {
      expectedRowVersion: 0, assignedUserId: reviewerId,
    })).rejects.toMatchObject({response: {code: 'DEFECT_CONCURRENCY_CONFLICT'}});
    await expect(service.updateDefectSeverity(pm(), projectId, defectId, {
      expectedRowVersion: 2, severity: 'CRITICAL', reason,
    })).rejects.toMatchObject({response: {code: 'DEFECT_CONCURRENCY_CONFLICT'}});
    expect(actions(calls)).toHaveLength(0);
  });

  it('rejects a rectified remedy independently and retains its evidence/version before resubmission', async () => {
    const {service, calls, state} = fixture({status: 'RECTIFIED'});
    const rejected = await service.rejectDefectRemedy(qc(), projectId, defectId, {
      expectedRowVersion: 1, reason,
    });
    expect(rejected.status).toBe('IN_PROGRESS');
    expect(state.closure_evidence_object_id).toBeNull();
    const old = actions(calls)[0].params;
    expect(old[4]).toBe('REMEDY_REJECTED');
    expect(old[13]).toBe(objectId);
    expect(old[14]).toBe(versionId);
    expect(old[15]).toBe(reason);
    const remedied = await service.submitDefectRemedy(
      {...pm(), userId: assigneeId}, projectId, defectId, objectId, 2,
    );
    expect(remedied.status).toBe('RECTIFIED');
    expect(remedied.rowVersion).toBe(3);
    const history = actions(calls).map(c => c.params);
    expect(history.map(p => p[4])).toEqual(['REMEDY_REJECTED','REMEDY_SUBMITTED']);
    expect(history.map(p => p[8])).toEqual([2,3]);
  });

  it('prohibits performer or assignee from rejecting their own remedy', async () => {
    const {service, calls} = fixture({status: 'RECTIFIED'});
    await expect(service.rejectDefectRemedy(
      {...qc(), userId: assigneeId}, projectId, defectId,
      {expectedRowVersion: 1, reason},
    )).rejects.toMatchObject({response: {code: 'INDEPENDENT_VERIFICATION_REQUIRED'}});
    expect(actions(calls)).toHaveLength(0);
  });

  it('fails closed for mandatory waiver and invalid/short reviewer explanations', async () => {
    const {service, calls} = fixture({mandatory: true});
    await expect(service.waiveDefect(pm(), projectId, defectId, {
      expectedRowVersion: 1, reason,
    })).rejects.toMatchObject({
      response: {code: 'DEFECT_MANDATORY_WAIVER_SECOND_APPROVAL_REQUIRED'},
    });
    await expect(service.rejectDefectRemedy(qc(), projectId, defectId, {
      expectedRowVersion: 1, reason: 'bad',
    })).rejects.toMatchObject({response: {code: 'DEFECT_DECISION_REASON_REQUIRED'}});
    expect(actions(calls)).toHaveLength(0);
  });

  it('records nonmandatory waiver and audited reopen without rewriting prior evidence', async () => {
    const {service, calls, state} = fixture({mandatory: false, assignment: null});
    const waived = await service.waiveDefect(pm(), projectId, defectId, {
      expectedRowVersion: 1, reason: 'Aftercare claim is not contractually applicable.',
    });
    expect(waived.status).toBe('WAIVED');
    const reopened = await service.reopenDefect(pm(), projectId, defectId, {
      expectedRowVersion: 2, reason: 'New supplier evidence requires investigation again.',
    });
    expect(reopened.status).toBe('OPEN');
    expect(state.row_version).toBe(3);
    expect(actions(calls).map(c => c.params[4])).toEqual(['WAIVED','REOPENED']);
    expect(actions(calls).map(c => c.params[8])).toEqual([2,3]);
  });

  it('normalizes MAJOR to HIGH and records an attributed severity delta', async () => {
    const {service, calls} = fixture({severity: 'MEDIUM'});
    const out = await service.updateDefectSeverity(pm(), projectId, defectId, {
      expectedRowVersion: 1, severity: 'MAJOR', reason,
    });
    expect(out.severity).toBe('HIGH');
    const event = actions(calls)[0].params;
    expect(event[4]).toBe('SEVERITY_UPDATED');
    expect(event[13]).toBe('MEDIUM');
    expect(event[14]).toBe('HIGH');
    await expect(service.updateDefectSeverity(pm(), projectId, defectId, {
      expectedRowVersion: 2, severity: 'UNKNOWN' as any, reason,
    })).rejects.toMatchObject({response: {code: 'DEFECT_SEVERITY_UNSUPPORTED'}});
  });

  it('refuses unauthorized Site waiver, assignment or reopen even with project scope', async () => {
    const {service, calls} = fixture({mandatory: false});
    const site = {...pm(), orgRole: 'R-SITE', projectRole: 'R-SITE'};
    await expect(service.assignDefect(site, projectId, defectId, {
      expectedRowVersion: 1, assignedUserId: assigneeId,
    })).rejects.toMatchObject({response: {code: 'DEFECT_SUPERVISOR_REQUIRED'}});
    await expect(service.waiveDefect(site, projectId, defectId, {
      expectedRowVersion: 1, reason,
    })).rejects.toMatchObject({response: {code: 'DEFECT_SUPERVISOR_REQUIRED'}});
    await expect(service.reopenDefect(site, projectId, defectId, {
      expectedRowVersion: 1, reason,
    })).rejects.toMatchObject({response: {code: 'DEFECT_SUPERVISOR_REQUIRED'}});
    expect(actions(calls)).toHaveLength(0);
  });
});
