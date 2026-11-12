import { BadRequestException } from '@nestjs/common';
import { assertValidProcurementOrderInput, normalizeCreateParty, PartiesService } from '../src/modules/parties/parties.service';
import { TenantDbService } from '../src/database/tenant-db.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { uuidv7 } from 'uuidv7';

describe('PH3-G04-001: counterparty validation', () => {
  it('accepts multiple declared party roles and canonical contact fields', () => {
    expect(normalizeCreateParty({
      name: '  Example Engineering ',
      types: ['CLIENT', 'CONSULTANT'],
      email: ' Info@Example.COM ',
      phone: '+91 9876543210',
    })).toEqual({
      name: 'Example Engineering',
      types: ['CLIENT', 'CONSULTANT'],
      gstin: undefined,
      email: 'info@example.com',
      phone: '+91 9876543210',
    });
  });

  it('preserves legacy supplier default when type was omitted', () => {
    expect(normalizeCreateParty({ name: 'Trusted Supplier' }).types).toEqual(['SUPPLIER_OEM']);
  });

  it.each([
    null,
    [],
    { name: 'A', types: ['CLIENT'] },
    { name: 'Valid Company', types: ['UNKNOWN_SUPPLIER_TYPE'] },
    { name: 'Valid Company', types: [] },
    { name: 'Valid Company', types: ['CLIENT', 'CLIENT'] },
    { name: 'Valid Company', types: 'CLIENT' },
    { name: 'Valid Company', types: ['CLIENT'], email: 'not-an-address' },
    { name: 'Valid Company', types: ['CLIENT'], email: 123 },
    { name: 'Valid Company', types: ['CLIENT'], phone: 'call me' },
    { name: 'Valid Company', types: ['CLIENT'], phone: 900 },
    { name: 'Valid Company', types: ['CLIENT'], gstin: 'INVALID' },
    { name: 'Valid Company', types: ['CLIENT'], isVerified: true },
  ])('rejects invalid party data before entering a transaction (%#)', (value) => {
    expect(() => normalizeCreateParty(value)).toThrow(BadRequestException);
  });

  it('PH3-G04-003: validates actual issued procurement line and obligation fields', () => {
    const base = {
      poNumber: 'PO-2026-001',
      supplierPartyId: '01991688-0e04-7a2d-b6ff-cfc3462a00a1',
      totalAmountPaise: 0,
      lines: [{ lineNo: 1, assetCategoryKey: 'AHU', description: 'Air handling unit',
        quantity: 1, obligations: [{ docTypeKey: 'DT-001', stageKey: 'FAT', title: 'Factory inspection' }] }],
    };
    expect(() => assertValidProcurementOrderInput(base)).not.toThrow();
    for (const changed of [
      { ...base, lines: [] },
      { ...base, totalAmountPaise: -50 },
      { ...base, totalAmountPaise: 12.5 },
      { ...base, poNumber: '' },
      { ...base, lines: [{ ...base.lines[0], quantity: 0 }] },
      { ...base, lines: [base.lines[0], base.lines[0]] },
      { ...base, lines: [{ ...base.lines[0], obligations: [{ docTypeKey: 'DT-001', stageKey: 'MADE_UP', title: 'Bad' }] }] },
    ]) {
      expect(() => assertValidProcurementOrderInput(changed)).toThrow(BadRequestException);
    }
  });

  it('PH3-G04-003: an issued order cannot be inserted into a CLOSED project', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const fixture = await seedTenants(admin);
      const orgId = fixture.tenants[0].orgId;
      const projectId = fixture.tenants[0].projectIds[0];
      await admin.query(
        `UPDATE projects SET status = 'CLOSED', closed_at = now()
          WHERE org_id = $1 AND id = $2`, [orgId, projectId],
      );
      const service = new PartiesService(new TenantDbService(app));
      const input = {
        poNumber: 'PO-CLOSED-001',
        supplierPartyId: uuidv7(),
        lines: [{ lineNo: 1, assetCategoryKey: 'AHU', description: 'Air handling unit' }],
      };
      await expect(service.createProcurementOrder(
        { orgId, userId: fixture.userId, actorType: 'USER', requestId: 'phase3-po' },
        projectId, input,
      )).rejects.toThrow(BadRequestException);
      const stored = await admin.query(
        'SELECT id FROM procurement_orders WHERE org_id = $1 AND project_id = $2',
        [orgId, projectId],
      );
      expect(stored.rows).toHaveLength(0);
    });
  });

  it('rejects invalid content before any database operation', async () => {
    const db = { withTenantContext: jest.fn() } as any;
    const service = new PartiesService(db);
    await expect(service.createParty(
      { orgId: 'org', userId: 'user', actorType: 'USER', requestId: 'test' },
      { name: 'Supplier', types: ['FAKE_APPROVER'] },
    )).rejects.toThrow(BadRequestException);
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });
});
