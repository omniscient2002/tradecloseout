import { randomUUID } from 'node:crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G17-005 ledger history access is limited to current defect authority', () => {
  const orgId = randomUUID(), projectId = randomUUID(), defectId = randomUUID();
  const assetId = randomUUID(), assigneeId = randomUUID(), otherId = randomUUID();
  const ctx = (userId = otherId): any => ({
    orgId, userId, actorType: 'MEMBER', orgRole: 'R-SITE',
    projectRole: 'R-SITE', requestId: randomUUID(), ip: '127.0.0.1',
    userAgent: 'pass2-history-scope',
  });
  const fixture = () => {
    const queries: string[] = [];
    const pool: any = {connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT d.* FROM defects d')) return {rows: [{
          id: defectId, org_id: orgId, project_id: projectId,
          assigned_user_id: assigneeId, assigned_party_id: null,
          asset_id: assetId, raised_at: '2026-11-10T10:00:00Z',
        }]};
        if (sql.includes('FROM defect_transition_events'))
          return {rows: [{
            id: randomUUID(), action: 'REMEDY_REJECTED',
            previous_row_version: 2, next_row_version: 3,
          }]};
        return {rows: []};
      }),
      release: jest.fn(),
    }))};
    return {service: new WarrantyAndBillingService(pool), queries};
  };

  it('hides another contributor’s defect history before querying the immutable ledger', async () => {
    const {service, queries} = fixture();
    await expect(service.listDefectTransitions(
      ctx(), projectId, defectId,
    )).rejects.toMatchObject({response: {code: 'DEFECT_NOT_FOUND'}});
    expect(queries.some(sql => sql.includes('FROM defect_transition_events'))).toBe(false);
  });

  it('allows its assigned Site contributor to see attributable events but flags incomplete legacy history', async () => {
    const {service, queries} = fixture();
    const data = await service.listDefectTransitions(
      ctx(assigneeId), projectId, defectId,
    );
    expect(data.events).toHaveLength(1);
    expect(data.historicalLedgerComplete).toBe(false);
    expect(queries.some(sql => sql.includes('FROM defect_transition_events'))).toBe(true);
  });

  it('denies a narrowed asset scope before returning a defect decision history', async () => {
    const {service, queries} = fixture();
    await expect(service.listDefectTransitions(
      {...ctx(assigneeId), projectScope: {assetIds: [randomUUID()]}},
      projectId, defectId,
    )).rejects.toMatchObject({response: {code: 'DEFECT_ASSET_SCOPE_DENIED'}});
    expect(queries.some(sql => sql.includes('FROM defect_transition_events'))).toBe(false);
  });
});
