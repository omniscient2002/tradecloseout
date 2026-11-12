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

  it('PH3-G04-003: creates exactly one valid scoped PO and qualified obligations', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const fixture = await seedTenants(admin);
      const orgId = fixture.tenants[0].orgId;
      const projectId = fixture.tenants[0].projectIds[0];
      const otherProject = fixture.tenants[0].projectIds[1];
      const supplierId = uuidv7();
      const otherAssetId = uuidv7();
      await admin.query(
        `INSERT INTO parties (id, org_id, name, types, status, created_by)
          VALUES ($1, $2, 'Qualified Supplier', ARRAY['SUPPLIER_OEM']::text[], 'ACTIVE', $3)`,
        [supplierId, orgId, fixture.userId],
      );
      await admin.query(
        `INSERT INTO assets (id, org_id, project_id, tag, name, category_key, created_by)
          VALUES ($1, $2, $3, 'AHU-WRONG-PROJECT', 'Another project', 'AHU', $4)`,
        [otherAssetId, orgId, otherProject, fixture.userId],
      );
      const service = new PartiesService(new TenantDbService(app));
      const actor: any = { orgId, userId: fixture.userId, actorType: 'USER', requestId: 'phase3-po-valid' };
      const base = {
        poNumber: 'PO-PH3-001', supplierPartyId: supplierId,
        totalAmountPaise: 100_000,
        lines: [{ lineNo: 1, assetCategoryKey: 'AHU', description: 'Air handling unit',
          quantity: 2, obligations: [{ docTypeKey: 'DT-001', stageKey: 'FAT', title: 'Factory inspection' }] }],
      };
      await expect(service.createProcurementOrder(actor, projectId, {
        ...base, lines: [{ ...base.lines[0], assetId: otherAssetId }],
      })).rejects.toThrow('PROCUREMENT_ASSET_NOT_FOUND');
      const countAfterInvalid = await admin.query(
        'SELECT count(*)::int AS total FROM procurement_orders WHERE org_id = $1 AND project_id = $2',
        [orgId, projectId],
      );
      expect(countAfterInvalid.rows[0].total).toBe(0);

      const created = await service.createProcurementOrder(actor, projectId, base);
      expect(created.status).toBe('ISSUED');
      expect(created.linesCount).toBe(1);
      expect(created.obligationsCount).toBe(1);
      const count = await admin.query(
        `SELECT (SELECT count(*)::int FROM procurement_orders WHERE id = $1) AS orders,
                (SELECT count(*)::int FROM procurement_order_lines WHERE po_id = $1) AS lines,
                (SELECT count(*)::int FROM supplier_document_obligations sdo
                  JOIN procurement_order_lines l ON l.id = sdo.po_line_id WHERE l.po_id = $1) AS obligations`,
        [created.poId],
      );
      expect(count.rows[0]).toMatchObject({ orders: 1, lines: 1, obligations: 1 });
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
