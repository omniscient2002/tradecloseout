import { UnprocessableEntityException, ConflictException } from '@nestjs/common';
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
