import { randomUUID } from 'node:crypto';
import { PermissionGuard } from '../src/common/guards/permission.guard';

describe('PH4-G17-004 legacy defect-route permission qualification', () => {
  it('resolves /defects/:id/remedy to the actual project before authority, not the URL body', async () => {
    const orgId = randomUUID(), defectId = randomUUID(), projectId = randomUUID();
    const userId = randomUUID(), seen: string[] = [];
    const ctx: any = {
      orgId, userId, actorType: 'MEMBER', orgRole: 'R-OWNER',
      requestId: randomUUID(), ip: '127.0.0.1', userAgent: 'phase4-pass1',
    };
    const request: any = {
      path: `/api/v1/defects/${defectId}/remedy`,
      method: 'POST', params: {id: defectId},
      body: {remedyEvidenceObjectId: randomUUID(), expectedRowVersion: 1},
      user: {
        orgId, userId, orgRole: 'R-OWNER', actorType: 'MEMBER',
      },
      userContext: ctx,
    };
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        seen.push(sql);
        if (sql.includes('SELECT project_id FROM defects')) {
          expect(params).toEqual([orgId, defectId]);
          return {rows: [{project_id: projectId}]};
        }
        return {rows: []};
      }),
      release: jest.fn(),
    }))};
    const reflector: any = {getAllAndOverride: jest.fn(() => 'defect.manage')};
    const guard = new PermissionGuard(reflector, pool);
    const executionContext: any = {
      getHandler: () => ({}), getClass: () => ({}),
      switchToHttp: () => ({getRequest: () => request}),
    };
    expect(await guard.canActivate(executionContext)).toBe(true);
    expect(request.userContext.projectId).toBe(projectId);
    expect(request.userContext.permission).toBe('defect.manage');
    expect(seen.some(sql => sql.includes('SELECT project_id FROM defects'))).toBe(true);
    expect(seen.some(sql => sql.includes('FROM project_members'))).toBe(false);
  });
});
