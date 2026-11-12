import { randomUUID } from 'crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G19-002: second TDS entry point enforces invoice-locked cumulative bounds', () => {
  const ctx: any = {
    orgId: randomUUID(), userId: randomUUID(),
    actorType: 'SYSTEM', ip: '127.0.0.1', userAgent: 'jest', requestId: randomUUID(),
  };
  const input = () => ({
    invoiceId: randomUUID(), section: '194J', rateBps: 200,
    amountPaise: 250n, deductedAt: '2026-11-12',
  });

  it('never inserts a deduction exceeding the already-consumed invoice balance', async () => {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT total_paise, status FROM invoices'))
          return { rows: [{ total_paise: '1000', status: 'ISSUED' }] };
        if (sql.includes('SUM(amount_paise)'))
          return { rows: [{ deducted_paise: '850' }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    })) };
    await expect(new WarrantyAndBillingService(pool).recordInvoiceTdsDeduction(ctx, input()))
      .rejects.toMatchObject({ response: { code: 'TDS_EXCEEDS_INVOICE_BALANCE' } });
    expect(queries.some(q => q.sql.includes('SELECT total_paise, status FROM invoices') &&
      q.sql.includes('FOR UPDATE'))).toBe(true);
    expect(queries.some(q => q.sql.includes('INSERT INTO invoice_tds'))).toBe(false);
    expect(queries.some(q => q.sql === 'ROLLBACK')).toBe(true);
  });

  it('commits a deduction no larger than the remainder and records its audit event', async () => {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const pool: any = { connect: jest.fn(async () => ({
      query: jest.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT total_paise, status FROM invoices'))
          return { rows: [{ total_paise: '1000', status: 'ISSUED' }] };
        if (sql.includes('SUM(amount_paise)'))
          return { rows: [{ deducted_paise: '750' }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    })) };
    const result = await new WarrantyAndBillingService(pool).recordInvoiceTdsDeduction(ctx, input());
    expect(result.invoiceId).toBeDefined();
    expect(queries.some(q => q.sql.includes('INSERT INTO invoice_tds') && q.params[5] === '250')).toBe(true);
    expect(queries.some(q => q.sql.includes('INSERT INTO audit_events'))).toBe(true);
    expect(queries.some(q => q.sql === 'COMMIT')).toBe(true);
  });

  it('rejects invalid amounts, rates and impossible dates without opening a transaction', async () => {
    const pool: any = { connect: jest.fn(() => { throw new Error('unwanted connection'); }) };
    const service = new WarrantyAndBillingService(pool);
    for (const bad of [
      { amountPaise: -1n }, { amountPaise: 0n },
      { rateBps: -1 }, { rateBps: 10001 },
      { section: 'x;DROP TABLE' }, { deductedAt: '2026-02-31' },
    ]) {
      await expect(service.recordInvoiceTdsDeduction(ctx, { ...input(), ...bad }))
        .rejects.toMatchObject({ response: { code: 'TDS_INPUT_INVALID' } });
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
