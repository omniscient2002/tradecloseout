import { UnprocessableEntityException, ConflictException, BadRequestException } from '@nestjs/common';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { ChecklistsService } from '../src/modules/checklists/checklists.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { ProjectsService } from '../src/modules/projects/projects.service';

const orgId = '0192e3a0-0000-7000-8000-000000000001';
const projectId = '0192e3a0-1000-7000-8000-000000000002';
const userId = '0192e3a0-2000-7000-8000-000000000003';
const ctx: any = { orgId, projectId, userId, actorType: 'MEMBER', ip: '127.0.0.1', userAgent: 'test', requestId: 'test' };

function mockPool(handler: (sql: string, params?: any[]) => any) {
  const client: any = {
    query: jest.fn(async (sql: string, params?: any[]) => {
      const result = handler(sql, params);
      return result === undefined ? { rows: [] } : result;
    }),
    release: jest.fn(),
  };
  return { pool: { connect: jest.fn(async () => client) } as any, client };
}

describe('HVAC checklist and readiness release gates', () => {
  it('refuses an unconfigured snapshot instead of inventing a one-document dossier', async () => {
    const { pool } = mockPool(() => undefined);
    const svc = new ChecklistsService(pool);
    await expect(svc.createSnapshot(ctx, projectId)).rejects.toThrow(UnprocessableEntityException);
  });

  it('imports real document mappings with exact asset scope and preserves previous requirements', async () => {
    const previous = {
      requirements: [{
        key: 'ORIGINAL', title: 'Signed contract', groupKey: 'CONTRACT',
        docTypeKey: 'DT-001', mandatory: true, scopeType: 'PROJECT',
      }],
    };
    const { pool, client } = mockPool((sql) => sql.includes('SELECT resolved_payload_json')
      ? { rows: [{ resolved_payload_json: previous }] }
      : undefined);
    const svc = new ChecklistsService(pool);
    const apply = jest.spyOn(svc, 'createAndApplySnapshot').mockResolvedValue({ snapshotId: 'mock' } as any);
    const assetId = '0192e3a0-4000-7000-8000-000000000004';
    await svc.importL3Checklist(ctx, projectId, {
      requirements: [{
        key: 'AHU-TEST', title: 'AHU-03 Commissioning', docTypeKey: 'DT-099',
        groupKey: 'COMMISSIONING', scopeType: 'ASSET', assetId,
      }],
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT resolved_payload_json'), [orgId, projectId],
    );
    const layers = apply.mock.calls[0]![2] as any[];
    expect(layers[0].payload.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'ORIGINAL' }),
      expect.objectContaining({ key: 'AHU-TEST', scopeType: 'ASSET', assetId }),
    ]));
    expect(layers[0].payload.requirements).toHaveLength(2);
  });

  it('rejects unmapped document types and empty imports', async () => {
    const { pool } = mockPool(() => undefined);
    const svc = new ChecklistsService(pool);
    await expect(svc.importL3Checklist(ctx, projectId, { requirements: [] }))
      .rejects.toThrow(UnprocessableEntityException);
    await expect(svc.importL3Checklist(ctx, projectId, {
      requirements: [{ title: 'Unknown consultant form' }],
    })).rejects.toThrow(UnprocessableEntityException);
  });

  it('does not report an empty project as ready for handover', async () => {
    const { pool } = mockPool((sql) => sql.includes('FROM requirements r')
      ? { rows: [] } : undefined);
    const svc = new HandoverService(pool, {} as any);
    const result = await svc.evaluateProjectReadiness(ctx, projectId);
    expect(result.readyWithoutOverride).toBe(false);
    expect(result.configurationBlocker).toBe('ACTIVE_CHECKLIST_WITH_MANDATORY_REQUIREMENTS_REQUIRED');
  });

  it('supersedes requirements removed from a later checklist snapshot', async () => {
    const { pool, client } = mockPool((sql) => {
      if (sql.includes('SELECT id FROM projects') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: projectId }] };
      }
      return undefined;
    });
    const svc = new ChecklistsService(pool);
    const applied = await svc.createAndApplySnapshot(ctx, projectId, [{
      level: 'PROJECT', versionId: 'new-snapshot-config',
      payload: { requirements: [{
        key: 'AHU-COMMISSIONING', groupKey: 'COMMISSIONING',
        title: 'AHU test and commissioning', docTypeKey: 'DT-042',
        mandatory: true, scopeType: 'PROJECT',
      }] },
    }]);
    expect(applied.instantiatedRequirements).toBe(1);
    const retiring = client.query.mock.calls.find(([sql]: any[]) =>
      sql.includes('UPDATE requirements r') && sql.includes('jsonb_to_recordset'));
    expect(retiring).toBeDefined();
    expect(JSON.parse(retiring![1][2])).toEqual([
      { requirement_key: 'AHU-COMMISSIONING', scope_key: 'project' },
    ]);
  });

  it('rejects evidence intentionally misclassified against its contractual requirement', async () => {
    const reqId = '0192e3a0-4000-7000-8000-000000000004';
    const fakeDb: any = {
      withTenantContext: jest.fn(async (_actor: any, fn: any) => fn({
        query: jest.fn(async (sql: string) => sql.includes('SELECT id, doc_type_key FROM requirements')
          ? { rows: [{ id: reqId, doc_type_key: 'DT-057' }] }
          : { rows: [] }),
      })),
    };
    const svc = new DocumentsService(fakeDb, {} as any);
    await expect(svc.createUploadIntent(ctx, projectId, {
      mimeType: 'application/pdf', sizeBytes: 1024,
      fileName: 'wrong-document-type.pdf',
      requirementId: reqId, docTypeKey: 'DT-001',
    })).rejects.toThrow(BadRequestException);
  });

  it('persists HOSPITAL project type used by applicable closeout rules', async () => {
    const { pool, client } = mockPool(() => undefined);
    const svc = new ProjectsService(pool);
    await svc.createProject(ctx, { code: 'HOSPITAL01', name: 'Hospital HVAC', projectType: 'HOSPITAL' });
    const insert = client.query.mock.calls.find(([sql]: any[]) => sql.includes('INSERT INTO projects'));
    expect(insert).toBeDefined();
    expect(insert![0]).toContain('project_type');
    expect(insert![1][insert![1].length - 1]).toBe('HOSPITAL');
  });

  it('rejects unrecognised project types before touching the database', async () => {
    const { pool } = mockPool(() => undefined);
    await expect(new ProjectsService(pool).createProject(ctx, {
      code: 'PROJECT01', name: 'Unknown Type', projectType: 'UNSAFE_UNKNOWN_TYPE',
    })).rejects.toThrow(UnprocessableEntityException);
  });

  it('blocks submission of a package that has not finished generation', async () => {
    const { pool } = mockPool((sql) => sql.includes('FROM handover_packages hp')
      ? { rows: [{ id: 'pkg-1', status: 'QUEUED' }] } : undefined);
    const svc = new HandoverService(pool, {} as any);
    await expect(svc.createSubmission(ctx, projectId, {
      packageId: 'pkg-1',
      recipients: [{ name: 'Client', email: 'client@example.com', isRequiredApprover: true }],
    })).rejects.toThrow(ConflictException);
  });

  it('resolves the package-only submission route to its actual project', async () => {
    const { pool, client } = mockPool((sql) => {
      if (sql.includes('SELECT project_id FROM handover_packages')) {
        return { rows: [{ project_id: projectId }] };
      }
      if (sql.includes('FROM handover_packages hp')) {
        return { rows: [{ id: 'pkg-1', status: 'READY' }] };
      }
      return undefined;
    });
    const svc = new HandoverService(pool, {} as any);
    const res = await svc.createSubmission(ctx, '', {
      packageId: 'pkg-1',
      recipients: [{ name: 'Client', email: 'client@example.com', isRequiredApprover: true }],
    });
    expect(res.status).toBe('SUBMITTED');
    const insert = client.query.mock.calls.find(([sql]: any[]) => sql.includes('INSERT INTO submissions'));
    expect(insert![1][2]).toBe(projectId);
  });

  it('requires accepted, not partially accepted, submissions before project closure', async () => {
    const { pool } = mockPool((sql) => {
      if (sql.includes('SELECT id, status, row_version FROM projects')) {
        return { rows: [{ id: projectId, status: 'HANDOVER', row_version: 1 }] };
      }
      if (sql.includes('FROM submissions')) return { rows: [] };
      return undefined;
    });
    const svc = new ProjectsService(pool);
    await expect(svc.closeProject(ctx, projectId)).rejects.toThrow(ConflictException);
  });
});
