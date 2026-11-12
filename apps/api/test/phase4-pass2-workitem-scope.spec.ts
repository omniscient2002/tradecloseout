import { randomUUID } from 'node:crypto';
import { WorkItemsService } from '../src/modules/work-items/work-items.service';

describe('PH4-G17-006 work-item projections honor defect assignment and resource authority', () => {
  const orgId = randomUUID(), userId = randomUUID(), projectId = randomUUID();
  const assetId = randomUUID();
  const fixture = () => {
    const queries: {sql: string; params: unknown[]}[] = [];
    const pool: any = {connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({sql, params});
        if (sql.includes('COUNT(*) AS total')) return {rows: [{total: '0'}]};
        return {rows: []};
      }),
      release: jest.fn(),
    }))};
    return {service: new WorkItemsService(pool), queries};
  };
  const ctx = (): any => ({
    orgId, userId, actorType: 'MEMBER', orgRole: 'R-SITE', projectRole: 'R-SITE',
    requestId: randomUUID(), ip: '127.0.0.1', userAgent: 'p2-work-items',
  });

  it('narrows Site defect work to assigned user, selected assets and dates', async () => {
    const {service, queries} = fixture();
    await service.listWorkItems({
      ...ctx(), projectScope: {
        assetIds: [assetId], assetCategories: ['AHU'],
        startDate: '2026-11-01', endDate: '2026-11-30',
      },
    }, {projectId});
    const combined = queries.find(q => q.sql.includes('WITH all_items'));
    expect(combined).toBeDefined();
    expect(combined?.sql).toContain('d.assigned_user_id = $2');
    expect(combined?.sql).toContain('d.asset_id = ANY(');
    expect(combined?.sql).toContain('da.category_key = ANY(');
    expect(combined?.sql).toContain('d.raised_at::date >=');
    expect(combined?.sql).toContain("d.status IN ('OPEN', 'IN_PROGRESS', 'RECTIFIED')");
    expect(combined?.sql).toContain('ASSIGN_DEFECT');
    expect(combined?.sql).toContain('Assigned remedy overdue; escalation required');
    expect(combined?.params).toContainEqual([assetId]);
    expect(combined?.params).toContainEqual(['AHU']);
  });

  it('does not expose defect work to document-read-only roles without defect.manage', async () => {
    const {service, queries} = fixture();
    await service.listWorkItems({
      ...ctx(), orgRole: 'R-DOC', projectRole: 'R-DOC',
    }, {projectId});
    const combined = queries.find(q => q.sql.includes('WITH all_items'));
    expect(combined?.sql).toContain('AND false');
  });

  it('rejects malformed stored member scope instead of widening it', async () => {
    const {service} = fixture();
    await expect(service.listWorkItems({
      ...ctx(), projectScope: {unsupported: true},
    }, {projectId})).rejects.toMatchObject({
      response: {code: 'DEFECT_WORK_SCOPE_INVALID'},
    });
  });
});
