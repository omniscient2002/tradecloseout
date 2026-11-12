import { randomUUID } from 'node:crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G16-001/002: warranty assertions are not OEM confirmation', () => {
  const ctx: any = {
    orgId: randomUUID(), userId: randomUUID(), actorType: 'SYSTEM',
    ip: '127.0.0.1', userAgent: 'phase4-g16-test', requestId: randomUUID(),
  };
  const projectId = randomUUID();
  const event = () => ({
    assetId: randomUUID(), eventType: 'CONFIRMATION' as const,
    oemReference: 'CLAIMED-BY-CONTRACTOR', registeredAt: '2026-11-12',
    warrantyStart: '2026-11-10', warrantyEnd: '2027-11-10',
    basis: 'HANDOVER' as const,
  });
  const fixture = (asset: Record<string, unknown>) => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM assets')) return { rows: [{
          id: asset.id ?? randomUUID(), tag: 'AHU-01',
          warranty_start_basis: 'HANDOVER',
          warranty_start: '2026-11-10', warranty_end: '2027-11-10',
          ...asset,
        }] };
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    return { service: new WarrantyAndBillingService({
      connect: jest.fn(async () => client),
    } as any), queries };
  };

  it('does not turn an unsupported contractor OEM reference into verified coverage', async () => {
    const { service, queries } = fixture({});
    const result = await service.recordWarrantyEvent(ctx, projectId, event());
    expect(result.status).toBe('RECORDED');
    expect(result.requiresIndependentVerification).toBe(true);
    expect(result.coverageUpdated).toBe(false);
    expect(queries.some(q => q.sql.includes('INSERT INTO warranty_events') &&
      q.params[5] === 'RECORDED')).toBe(true);
    expect(queries.some(q => q.sql.includes('UPDATE assets'))).toBe(false);
    expect(queries.some(q => q.sql === 'COMMIT')).toBe(true);
  });

  it('detects same-basis conflicting dates and refuses to certify either coverage', async () => {
    const { service, queries } = fixture({ warranty_start: '2026-11-09' });
    const result = await service.recordWarrantyEvent(ctx, projectId, event());
    expect(result.status).toBe('DISPUTED');
    expect(result.hasBasisConflict).toBe(false);
    expect(result.hasDateConflict).toBe(true);
    expect(queries.some(q => q.sql.includes('UPDATE assets'))).toBe(false);
  });

  it('compares date-typed PostgreSQL coverage values without misclassifying a matching assertion', async () => {
    const { service } = fixture({
      warranty_start: new Date('2026-11-10T00:00:00.000Z'),
      warranty_end: new Date('2027-11-10T00:00:00.000Z'),
    });
    const result = await service.recordWarrantyEvent(ctx, projectId, event());
    expect(result.status).toBe('RECORDED');
    expect(result.hasDateConflict).toBe(false);
  });

  it('records extension requests without changing effective end date', async () => {
    const { service, queries } = fixture({});
    const result = await service.recordWarrantyEvent(ctx, projectId, {
      ...event(), eventType: 'EXTENSION', warrantyEnd: '2028-11-10',
    });
    expect(result.status).toBe('RECORDED');
    expect(result.coverageUpdated).toBe(false);
    expect(queries.some(q => q.sql.includes('UPDATE assets'))).toBe(false);
  });

  it('rejects malformed, noncalendar and backwards dates before opening a transaction', async () => {
    const pool = { connect: jest.fn(() => { throw new Error('NO_DB'); }) };
    const service = new WarrantyAndBillingService(pool as any);
    for (const patch of [
      { warrantyStart: '2026-02-30' },
      { warrantyEnd: '2026-11-01' },
      { registeredAt: '2026-13-01' },
      { eventType: 'VERIFIED' },
      { oemReference: '' },
    ]) {
      await expect(service.recordWarrantyEvent(ctx, projectId, {
        ...event(), ...patch,
      } as any)).rejects.toMatchObject({ response: { code: 'WARRANTY_EVENT_INVALID' } });
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
