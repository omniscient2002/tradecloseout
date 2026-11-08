import { uuidv7 } from 'uuidv7';
import {
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { TenantActorContext } from '@tradecloseout/db/tenant-tx';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { WorkItemsService } from '../src/modules/work-items/work-items.service';
import { CommissioningService } from '../src/modules/commissioning/commissioning.service';
import { AssetsService } from '../src/modules/assets/assets.service';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';
import { HandoverService } from '../src/modules/handover/handover.service';

describe('HVAC Domain Excellence Suite (XP11..XP18)', () => {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const userId = uuidv7();

  const mockCtx: TenantActorContext = {
    orgId,
    userId,
    actorType: 'MEMBER',
    orgRole: 'R-OWNER',
    requestId: 'req-hvac-test-1',
    ip: '127.0.0.1',
    userAgent: 'jest',
  };

  // ==========================================================================
  // XP11: Import-First Project Onboarding
  // ==========================================================================
  describe('XP11: Import-First Project Onboarding & Atomic Commit', () => {
    it('dryRun preview detects internal duplicate tags and existing project tags without mutating state', async () => {
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM assets WHERE')) {
              // Existing tag in database
              return { rows: [{ tag: 'CH-01' }] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const assetsService = new AssetsService(mockPool);
      const items = [
        { tag: 'CH-01', name: 'Water-Cooled Centrifugal Chiller 1', categoryKey: 'CHILLER' }, // Collides with DB
        { tag: 'AHU-01', name: 'Air Handling Unit 1', categoryKey: 'AHU' },
        { tag: 'AHU-01', name: 'Air Handling Unit 1 Duplicate', categoryKey: 'AHU' }, // Duplicate in file
        { tag: '', name: 'Nameless Unit', categoryKey: 'FCU' }, // Missing tag
      ];

      const preview: any = await assetsService.importAssets(mockCtx, projectId, items, true);

      expect(preview.dryRun).toBe(true);
      expect(preview.total).toBe(4);
      expect(preview.validCount).toBe(1); // Only AHU-01 (first instance)
      expect(preview.conflictCount).toBe(2); // CH-01 (DB) and AHU-01 (file dup)
      expect(preview.errorCount).toBe(1); // empty tag
    });

    it('rejects with ConflictException when conflictStrategy is FAIL on detected collisions', async () => {
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM assets WHERE')) {
              return { rows: [{ tag: 'CH-01' }] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const assetsService = new AssetsService(mockPool);
      const items = [
        { tag: 'CH-01', name: 'Water-Cooled Centrifugal Chiller 1', categoryKey: 'CHILLER' },
      ];

      await expect(
        assetsService.importAssets(mockCtx, projectId, items, false, { conflictStrategy: 'FAIL' }),
      ).rejects.toThrow(ConflictException);
    });

    it('atomic commit successfully commits valid items and generates SHA-256 tag receipt', async () => {
      const executedInserts: any[] = [];
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('FROM assets WHERE')) {
              return { rows: [] }; // No existing tags
            }
            if (sql.includes('SELECT status, purged_at FROM projects')) {
              return { rows: [{ status: 'ACTIVE', purged_at: null }] };
            }
            if (sql.includes('INSERT INTO assets')) {
              executedInserts.push(params);
              return { rowCount: 1, rows: [{ id: params[0], tag: params[3] }] };
            }
            if (sql.includes('SELECT * FROM requirements')) {
              return { rows: [] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const assetsService = new AssetsService(mockPool);
      const items = [
        { tag: 'CH-01', name: 'Water-Cooled Chiller 1', categoryKey: 'CHILLER', make: 'Trane', model: 'CVGF' },
        { tag: 'CT-01', name: 'Cooling Tower 1', categoryKey: 'COOLING_TOWER', make: 'Paharpur', model: 'NC8400' },
      ];

      const res: any = await assetsService.importAssets(mockCtx, projectId, items, false, {
        conflictStrategy: 'SKIP',
        atomic: true,
      });

      expect(res.dryRun).toBe(false);
      expect(res.importedCount).toBe(2);
      expect(res.commitReceipt).toBeDefined();
      expect(res.commitReceipt.batchId).toBeDefined();
      expect(res.commitReceipt.tagChecksum).toHaveLength(64); // SHA-256 hex digest
      expect(executedInserts).toHaveLength(2);
    });
  });

  // ==========================================================================
  // XP12: Daily Actionable Inbox & Work Items
  // ==========================================================================
  describe('XP12: Actionable Inbox & Work Item Projections', () => {
    it('aggregates source-derived work items across reviews, waivers, defects, revalidations and obligations', async () => {
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('COUNT(*) AS total')) {
              return {
                rows: [
                  {
                    total: '5',
                    reviews: '1',
                    waivers: '1',
                    defects: '1',
                    revalidations: '1',
                    supplier_obligations: '1',
                  },
                ],
              };
            }
            if (sql.includes('WITH all_items AS')) {
              return {
                rows: [
                  {
                    entity_id: uuidv7(),
                    entity_version: 1,
                    title: 'Chiller O&M Manual Rev 0',
                    project_id: projectId,
                    project_code: 'PRJ-CHILLER',
                    project_name: 'Metro HVAC Central Plant',
                    created_at: new Date(),
                    type: 'REVIEW_PENDING',
                    priority: 'HIGH',
                    waiting_on: 'Awaiting submittal review decision',
                    entity_type: 'DOCUMENT_VERSION',
                    next_path: `/projects/${projectId}/reviews/rev-1`,
                    next_method: 'POST',
                    next_action: 'DECIDE_REVIEW',
                  },
                  {
                    entity_id: uuidv7(),
                    entity_version: 1,
                    title: 'Ductwork leakage test mandatory waiver',
                    project_id: projectId,
                    project_code: 'PRJ-CHILLER',
                    project_name: 'Metro HVAC Central Plant',
                    created_at: new Date(),
                    type: 'WAIVER_PENDING_COUNTERSIGN',
                    priority: 'CRITICAL',
                    waiting_on: 'Awaiting PMC second approval / countersign',
                    entity_type: 'WAIVER',
                    next_path: `/projects/${projectId}/checklists/waivers/w-1/countersign`,
                    next_method: 'POST',
                    next_action: 'COUNTERSIGN_WAIVER',
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const workItemsService = new WorkItemsService(mockPool);
      const result = await workItemsService.listWorkItems(mockCtx, { projectId });

      expect(result.counts.total).toBe(5);
      expect(result.counts.reviews).toBe(1);
      expect(result.counts.waivers).toBe(1);
      expect(result.counts.defects).toBe(1);
      expect(result.counts.revalidations).toBe(1);
      expect(result.counts.supplierObligations).toBe(1);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].type).toBe('REVIEW_PENDING');
      expect(result.items[0].nextCommand.actionName).toBe('DECIDE_REVIEW');
      expect(result.items[1].type).toBe('WAIVER_PENDING_COUNTERSIGN');
      expect(result.items[1].priority).toBe('CRITICAL');
    });
  });

  // ==========================================================================
  // XP13: Equipment Passport Spine
  // ==========================================================================
  describe('XP13: Equipment Passport Spine & Cryptographic QR Verification', () => {
    it('returns passport with unit identity, revisions, procurement lines, and verifiable QR payload', async () => {
      const assetId = uuidv7();

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM assets')) {
              return {
                rows: [
                  {
                    id: assetId,
                    org_id: orgId,
                    project_id: projectId,
                    tag: 'CH-01',
                    name: 'Water-Cooled Centrifugal Chiller',
                    category_key: 'CHILLER',
                    make: 'Carrier',
                    model: '19XR',
                    serial_no: 'CARRIER-2026-9988',
                    location: 'Basement 2 Plant Room',
                    warranty_start: '2026-01-01',
                    warranty_end: '2027-01-01',
                    warranty_start_basis: 'HANDOVER',
                  },
                ],
              };
            }
            if (sql.includes('FROM asset_identity_revisions')) {
              return {
                rows: [
                  {
                    id: uuidv7(),
                    revision_no: 1,
                    tag: 'CH-01',
                    serial_no: 'CARRIER-2026-9988',
                    change_type: 'INITIAL_REGISTRATION',
                  },
                ],
              };
            }
            if (sql.includes('FROM procurement_order_lines pol')) {
              return {
                rows: [
                  {
                    id: uuidv7(),
                    line_no: 1,
                    asset_category_key: 'CHILLER',
                    description: 'Water-cooled centrifugal chiller 500 TR',
                    po_number: 'PO-HVAC-2026-001',
                    supplier_name: 'Carrier Airconditioning & Refrigeration Ltd',
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const assetsService = new AssetsService(mockPool);
      const passport = await assetsService.getEquipmentPassport(mockCtx, projectId, assetId);

      expect(passport.asset.tag).toBe('CH-01');
      expect(passport.asset.serial_no).toBe('CARRIER-2026-9988');

      // Verify QR Code payload
      expect(passport.qrCode).toBeDefined();
      expect(passport.qrCode.tag).toBe('CH-01');
      expect(passport.qrCode.serialNo).toBe('CARRIER-2026-9988');
      expect(passport.qrCode.signatureSha256).toHaveLength(64);

      // Verify Revisions and Procurement
      expect(passport.identityRevisions).toHaveLength(1);
      expect(passport.procurement).toHaveLength(1);
      expect(passport.procurement[0].supplier_name).toBe('Carrier Airconditioning & Refrigeration Ltd');
    });
  });

  // ==========================================================================
  // XP16 & XP17: Testing, Adjusting & Balancing (TAB) & Quality Inspections
  // ==========================================================================
  describe('XP16 & XP17: Air/Water TAB Tolerance Balancing & Quality Inspections', () => {
    it('evaluates flow balancing readings against ±10% tolerance and sets status COMPLETED when in range', async () => {
      let insertedRow: any = null;

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('SELECT id FROM projects')) {
              return { rows: [{ id: projectId }] };
            }
            if (sql.includes('INSERT INTO tab_worksheets')) {
              insertedRow = params;
              return { rowCount: 1 };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);
      const result = await commissioningService.recordTabWorksheet(mockCtx, projectId, {
        systemType: 'AIR_SIDE',
        worksheetType: 'AHU_SUPPLY_AIR_BALANCING',
        tolerancePercent: 10,
        readings: [
          { terminalOrTag: 'VAV-B1-01', designFlow: 500, actualFlow: 520, unit: 'CFM' }, // 4% dev (PASS)
          { terminalOrTag: 'VAV-B1-02', designFlow: 450, actualFlow: 430, unit: 'CFM' }, // 4.4% dev (PASS)
          { terminalOrTag: 'VAV-B1-03', designFlow: 600, actualFlow: 630, unit: 'CFM' }, // 5% dev (PASS)
        ],
      });

      expect(result.isWithinTolerance).toBe(true);
      expect(result.status).toBe('COMPLETED');
      expect(result.designSummary.overallDeviationPercent).toBeLessThan(10);
      expect(result.designSummary.outOfToleranceCount).toBe(0);
      expect(insertedRow).toBeDefined();
    });

    it('sets status to NEEDS_REBALANCING when a reading exceeds allowable tolerance', async () => {
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id FROM projects')) {
              return { rows: [{ id: projectId }] };
            }
            if (sql.includes('INSERT INTO tab_worksheets')) {
              return { rowCount: 1 };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);
      const result = await commissioningService.recordTabWorksheet(mockCtx, projectId, {
        systemType: 'WATER_SIDE',
        worksheetType: 'PRIMARY_CHILLED_WATER_PUMP_BALANCING',
        tolerancePercent: 10,
        readings: [
          { terminalOrTag: 'PUMP-CHW-01', designFlow: 1000, actualFlow: 1020, unit: 'GPM' }, // 2% dev (PASS)
          { terminalOrTag: 'PUMP-CHW-02', designFlow: 1000, actualFlow: 820, unit: 'GPM' },  // 18% dev (FAIL > 10%)
        ],
      });

      expect(result.isWithinTolerance).toBe(false);
      expect(result.status).toBe('NEEDS_REBALANCING');
      expect(result.designSummary.outOfToleranceCount).toBe(1);
    });

    it('records Quality Inspection Test Request (ITR) and signs witness sign-off', async () => {
      const inspectionId = uuidv7();
      let storedWitnesses: any[] = [];

      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('SELECT id FROM projects')) {
              return { rows: [{ id: projectId }] };
            }
            if (sql.includes('INSERT INTO quality_inspections')) {
              return { rowCount: 1 };
            }
            if (sql.includes('SELECT * FROM quality_inspections')) {
              return {
                rows: [
                  {
                    id: inspectionId,
                    org_id: orgId,
                    project_id: projectId,
                    itr_number: 'ITR-HVAC-001',
                    witness_parties_json: storedWitnesses,
                  },
                ],
              };
            }
            if (sql.includes('UPDATE quality_inspections')) {
              storedWitnesses = JSON.parse(params[3]);
              return { rowCount: 1 };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);

      // 1. Record ITR
      const itrRes = await commissioningService.recordQualityInspection(mockCtx, projectId, {
        itrNumber: 'ITR-HVAC-001',
        title: 'Chiller Hydrostatic Pressure Test & Leak Check',
        stageKey: 'PRE_COMMISSIONING',
        checklistItems: [
          { itemNo: 1, description: 'Pressure held at 1.5x design for 4 hours', result: 'PASS' },
          { itemNo: 2, description: 'Zero visible weld weep or gasket leaks', result: 'PASS' },
        ],
      });
      expect(itrRes.outcome).toBe('PASSED');

      // 2. Sign witness
      const signRes = await commissioningService.recordInspectionWitnessAttendance(mockCtx, projectId, inspectionId, {
        partyName: 'ABC PMC Consultants Pvt Ltd',
        representativeName: 'P. K. Sharma',
        role: 'LEAD_HVAC_CONSULTANT',
        notes: 'Hydrostatic pressure held at 12 bar confirmed.',
      });

      expect(signRes.witnesses).toHaveLength(1);
      expect(signRes.lastSigned.representativeName).toBe('P. K. Sharma');
      expect(signRes.lastSigned.signedByUserId).toBeNull();
      expect(signRes.lastSigned.isVerified).toBe(false);
    });
  });

  // ==========================================================================
  // XP18: Seasonal Commissioning
  // ==========================================================================
  describe('XP18: Seasonal Commissioning Deferred Test Scheduling', () => {
    it('creates deferred seasonal commissioning schedule for peak summer load testing', async () => {
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id FROM projects')) {
              return { rows: [{ id: projectId }] };
            }
            if (sql.includes('INSERT INTO seasonal_commissioning_schedules')) {
              return { rowCount: 1 };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);
      const res = await commissioningService.createSeasonalSchedule(mockCtx, projectId, {
        season: 'SUMMER_PEAK',
        targetDate: '2027-05-15',
        parameters: {
          ambientDryBulbTarget: 44.0,
          chilledWaterSupplyTarget: 6.7,
          fullLoadCapacityKw: 1750,
        },
      });

      expect(res.season).toBe('SUMMER_PEAK');
      expect(res.targetDate).toBe('2027-05-15');
      expect(res.status).toBe('SCHEDULED');
    });
  });

  // ==========================================================================
  // Real Database Integration Tests: Findings F01 - F07
  // ==========================================================================
  describe('HVAC Remediation Real Database Verification (F01–F07)', () => {
    it('verifies F01–F07 invariants against real migrated PostgreSQL with restricted runtime role', async () => {
      await withDisposableDatabase(async ({ admin, app }) => {
        const { userId: seededUserId, tenants: [tA, tB] } = await seedTenants(admin);
        const orgIdA = tA.orgId;
        const projectA0 = tA.projectIds[0];
        const projectA1 = tA.projectIds[1];
        const orgIdB = tB.orgId;
        const projectB0 = tB.projectIds[0];

        // Seed an independent user for independent verification / approval
        const independentUserId = uuidv7();
        await admin.query(`INSERT INTO users (id, name, status) VALUES ($1, 'Independent Verifier', 'ACTIVE')`, [independentUserId]);
        await admin.query(`INSERT INTO memberships (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'R-PM', 'ACTIVE')`, [uuidv7(), orgIdA, independentUserId]);

        const ctxA: TenantActorContext = {
          orgId: orgIdA,
          userId: seededUserId,
          actorType: 'MEMBER',
          orgRole: 'R-OWNER',
          requestId: 'req-f01-f07',
          ip: '127.0.0.1',
          userAgent: 'jest',
        };

        const ctxIndep: TenantActorContext = {
          orgId: orgIdA,
          userId: independentUserId,
          actorType: 'MEMBER',
          orgRole: 'R-PM',
          requestId: 'req-f01-f07-indep',
          ip: '127.0.0.1',
          userAgent: 'jest',
        };

        const assetsService = new AssetsService(app);
        const commissioningService = new CommissioningService(app);
        const warrantyService = new WarrantyAndBillingService(app);
        const mockStorage: any = {
          createSignedDownloadUrl: jest.fn().mockImplementation(async (opts) => `https://signed.s3/${opts.objectKey}?v=${opts.versionId}`),
        };
        const handoverService = new HandoverService(app, mockStorage);

        // Seed assets in Project A0 and Project A1
        const assetA0 = uuidv7();
        const assetA1 = uuidv7();
        await admin.query(`INSERT INTO assets (id, org_id, project_id, tag, name, category_key, created_by) VALUES ($1, $2, $3, 'AHU-01', 'Air Handling Unit 1', 'HVAC_AHU', $4)`, [assetA0, orgIdA, projectA0, seededUserId]);
        await admin.query(`INSERT INTO assets (id, org_id, project_id, tag, name, category_key, created_by) VALUES ($1, $2, $3, 'CH-01', 'Chiller 1', 'HVAC_CHILLER', $4)`, [assetA1, orgIdA, projectA1, seededUserId]);

        // --------------------------------------------------------------------
        // F01: Evidence Revalidation Real SQL & Concurrency
        // --------------------------------------------------------------------
        const docId = uuidv7();
        const docVerId = uuidv7();
        const storageObjId = uuidv7();
        const revalId = uuidv7();

        await admin.query(`
          INSERT INTO storage_objects (id, org_id, bucket, object_key, size_bytes, observed_size_bytes, mime, sha256, status, provider_version_id)
          VALUES ($1, $2, 'vault', 'test.pdf', 1024, 1024, 'application/pdf', $3, 'READY', 'v1')
        `, [storageObjId, orgIdA, 'b'.repeat(64)]);

        await admin.query(`
          INSERT INTO documents (id, org_id, project_id, title, doc_type_key, category_key, status, created_by)
          VALUES ($1, $2, $3, 'O&M Manual', 'MANUAL', 'EQUIPMENT', 'ACTIVE', $4)
        `, [docId, orgIdA, projectA0, seededUserId]);

        await admin.query(`
          INSERT INTO document_versions (id, org_id, project_id, document_id, version_no, revision_code, object_id, file_status, review_status, issue_date, uploaded_by)
          VALUES ($1, $2, $3, $4, 1, 'R0', $5, 'READY', 'APPROVED', CURRENT_DATE, $6)
        `, [docVerId, orgIdA, projectA0, docId, storageObjId, seededUserId]);

        const revisionId = uuidv7();
        await admin.query(`
          INSERT INTO asset_identity_revisions (id, org_id, project_id, asset_id, revision_no, tag, name, reason, created_by)
          VALUES ($1, $2, $3, $4, 1, 'AHU-01', 'Air Handling Unit 1', 'Specification update', $5)
        `, [revisionId, orgIdA, projectA0, assetA0, seededUserId]);

        await admin.query(`
          INSERT INTO evidence_revalidations (id, org_id, project_id, asset_id, identity_revision_id, document_version_id, status, row_version)
          VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', 1)
        `, [revalId, orgIdA, projectA0, assetA0, revisionId, docVerId]);

        // Gap 6: Omitting expectedRowVersion fails with PRECONDITION_REQUIRED
        await expect(
          assetsService.revalidateEvidence(ctxIndep, projectA0, assetA0, revalId, {
            status: 'CONFIRMED',
          } as any),
        ).rejects.toThrow(ConflictException);

        // Uploader cannot self-revalidate
        await expect(
          assetsService.revalidateEvidence(ctxA, projectA0, assetA0, revalId, {
            status: 'CONFIRMED',
            expectedRowVersion: 1,
          }),
        ).rejects.toThrow(ForbiddenException);

        // Stale expectedRowVersion is rejected
        await expect(
          assetsService.revalidateEvidence(ctxIndep, projectA0, assetA0, revalId, {
            status: 'CONFIRMED',
            expectedRowVersion: 99,
          }),
        ).rejects.toThrow(ConflictException);

        // Valid independent revalidation succeeds against real DB without SQL errors (dv.uploaded_by, FOR UPDATE OF er)
        const revalResult = await assetsService.revalidateEvidence(ctxIndep, projectA0, assetA0, revalId, {
          status: 'CONFIRMED',
          notes: 'Asset identity revision matches equipment tag',
          expectedRowVersion: 1,
        });
        expect(revalResult.status).toBe('CONFIRMED');
        expect(revalResult.row_version).toBe(2);

        // Replaying with stale row_version 1 fails
        await expect(
          assetsService.revalidateEvidence(ctxIndep, projectA0, assetA0, revalId, {
            status: 'CONFIRMED',
            expectedRowVersion: 1,
          }),
        ).rejects.toThrow(ConflictException);

        // Gap 1: Equipment passport query executes without column errors and returns linked revalidation
        const passport = await assetsService.getEquipmentPassport(ctxA, projectA0, assetA0);
        expect(passport.asset.id).toBe(assetA0);
        expect(passport.asset.tag).toBe('AHU-01');
        expect(passport.revalidations).toBeDefined();
        expect(passport.revalidations.length).toBe(1);
        expect(passport.revalidations[0].notes).toBe('Asset identity revision matches equipment tag');
        expect(passport.revalidations[0].reason).toBe('Specification update');
        expect(passport.revalidations[0].uploader_user_id).toBe(seededUserId);
        expect(passport.revalidations[0].verified_by).toBe(independentUserId);
        expect(passport.revalidations[0].verified_by_name).toBe('Independent Verifier');

        // Gap 2: Cross-asset evidence sharing isolation in package readiness
        const assetA2 = uuidv7();
        await admin.query(`
          INSERT INTO assets (id, org_id, project_id, tag, name, category_key, created_by)
          VALUES ($1, $2, $3, 'AHU-02', 'Air Handling Unit 2', 'HVAC_AHU', $4)
        `, [assetA2, orgIdA, projectA0, seededUserId]);

        // Both assets share docId via document_assets
        await admin.query(`
          INSERT INTO document_assets (id, org_id, project_id, document_id, asset_id)
          VALUES ($1, $2, $3, $4, $5), ($6, $2, $3, $4, $7)
        `, [uuidv7(), orgIdA, projectA0, docId, assetA0, uuidv7(), assetA2]);

        // Set docId's current_approved_version_id to docVerId
        await admin.query(`
          UPDATE documents SET current_approved_version_id = $1 WHERE id = $2
        `, [docVerId, docId]);

        // Insert checklist snapshot
        const snapshotId = uuidv7();
        await admin.query(`
          INSERT INTO checklist_snapshots (id, org_id, project_id, version_no, status, resolved_payload_json, provenance_json, source_json, checksum, created_by)
          VALUES ($1, $2, $3, 1, 'ACTIVE', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'snap-chk', $4)
        `, [snapshotId, orgIdA, projectA0, seededUserId]);

        // Insert mandatory requirement for assetA0 and assetA2
        const reqA0Id = uuidv7();
        const reqA2Id = uuidv7();
        await admin.query(`
          INSERT INTO requirements (id, org_id, project_id, current_snapshot_id, requirement_key, scope_key, asset_id, group_key, title, doc_type_key, mandatory, status)
          VALUES
            ($1, $2, $3, $4, 'REQ-AHU-01', $5, $6, 'EQUIPMENT_DOCS', 'AHU-01 O&M', 'MANUAL', true, 'NOT_STARTED'),
            ($7, $2, $3, $4, 'REQ-AHU-02', $8, $9, 'EQUIPMENT_DOCS', 'AHU-02 O&M', 'MANUAL', true, 'NOT_STARTED')
        `, [reqA0Id, orgIdA, projectA0, snapshotId, `asset:${assetA0}`, assetA0, reqA2Id, `asset:${assetA2}`, assetA2]);

        // Link both requirements to docId
        await admin.query(`
          INSERT INTO document_requirements (id, org_id, project_id, document_id, requirement_id)
          VALUES
            ($1, $2, $3, $4, $5),
            ($6, $2, $3, $4, $7)
        `, [uuidv7(), orgIdA, projectA0, docId, reqA0Id, uuidv7(), reqA2Id]);

        // Add a PENDING revalidation for assetA0 only
        const reval2Id = uuidv7();
        const rev2Id = uuidv7();
        await admin.query(`
          INSERT INTO asset_identity_revisions (id, org_id, project_id, asset_id, revision_no, tag, name, reason, created_by)
          VALUES ($1, $2, $3, $4, 2, 'AHU-01-REV', 'Air Handling Unit 1 Rev', 'Serial change', $5)
        `, [rev2Id, orgIdA, projectA0, assetA0, seededUserId]);

        await admin.query(`
          INSERT INTO evidence_revalidations (id, org_id, project_id, asset_id, scope_key, identity_revision_id, document_version_id, status, row_version)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', 1)
        `, [reval2Id, orgIdA, projectA0, assetA0, `asset:${assetA0}`, rev2Id, docVerId]);

        // Evaluate readiness: REQ-AHU-02 is ready! It is NOT blocked by assetA0's revalidation!
        const readiness = await handoverService.evaluateProjectReadiness(ctxA, projectA0);
        const req2Blocker = readiness.blockers.missingMandatory.find((r: any) => r.id === reqA2Id);
        expect(req2Blocker).toBeUndefined(); // assetA2 is NOT blocked!

        const req1Blocker = readiness.blockers.missingMandatory.find((r: any) => r.id === reqA0Id);
        expect(req1Blocker).toBeDefined(); // assetA0 IS blocked by its pending revalidation

        // --------------------------------------------------------------------
        // F02: Commissioning Asset Scoping & Composite FKs
        // --------------------------------------------------------------------
        // Service check: inspection referencing other-project asset is rejected
        await expect(
          commissioningService.recordQualityInspection(ctxA, projectA0, {
            assetId: assetA1, // assetA1 belongs to projectA1!
            itrNumber: 'ITR-CROSS-PROJ-01',
            title: 'Cross project test',
            stageKey: 'PRE_COMMISSIONING',
            checklistItems: [{ itemNo: 1, description: 'Test', result: 'PASS' }],
          }),
        ).rejects.toThrow(NotFoundException);

        // Database constraint check: direct SQL insert referencing other-project asset violates composite FK
        await expect(
          admin.query(`
            INSERT INTO quality_inspections (id, org_id, project_id, asset_id, itr_number, title, stage_key, checklist_items_json, outcome, inspected_by)
            VALUES ($1, $2, $3, $4, 'ITR-FK-01', 'Direct SQL FK Test', 'INSTALLATION', '[]'::jsonb, 'PENDING', $5)
          `, [uuidv7(), orgIdA, projectA0, assetA1, seededUserId]),
        ).rejects.toThrow();

        // Direct SQL insert into tab_worksheets referencing other-project asset violates composite FK
        await expect(
          admin.query(`
            INSERT INTO tab_worksheets (id, org_id, project_id, asset_id, system_type, worksheet_type, tolerance_percent, readings_json, status, created_by)
            VALUES ($1, $2, $3, $4, 'AIR_SIDE', 'FAN_COIL_AIR_BALANCING', 10, '[]'::jsonb, 'PENDING', $5)
          `, [uuidv7(), orgIdA, projectA0, assetA1, seededUserId]),
        ).rejects.toThrow();

        // Direct SQL insert into seasonal_commissioning_schedules referencing foreign tenant asset violates composite FK
        await expect(
          admin.query(`
            INSERT INTO seasonal_commissioning_schedules (id, org_id, project_id, asset_id, season, target_date, status, created_by)
            VALUES ($1, $2, $3, $4, 'SUMMER_PEAK', '2027-06-01', 'SCHEDULED', $5)
          `, [uuidv7(), orgIdA, projectA0, assetA1, seededUserId]),
        ).rejects.toThrow();

        // --------------------------------------------------------------------
        // F03: Inspection Non-Empty & Result Validation + Witness Authority
        // --------------------------------------------------------------------
        // Empty checklist is rejected
        await expect(
          commissioningService.recordQualityInspection(ctxA, projectA0, {
            assetId: assetA0,
            itrNumber: 'ITR-EMPTY-01',
            title: 'Empty checklist test',
            stageKey: 'PRE_COMMISSIONING',
            checklistItems: [],
          }),
        ).rejects.toThrow(UnprocessableEntityException);

        // All-NA checklist is recorded as PENDING (cannot produce accepted PASSED)
        const allNaInspection = await commissioningService.recordQualityInspection(ctxA, projectA0, {
          assetId: assetA0,
          itrNumber: 'ITR-ALL-NA-01',
          title: 'All NA checklist test',
          stageKey: 'PRE_COMMISSIONING',
          checklistItems: [
            { itemNo: 1, description: 'Optional step 1', result: 'NA' },
            { itemNo: 2, description: 'Optional step 2', result: 'NA' },
          ],
        });
        expect(allNaInspection.outcome).toBe('PENDING');

        // Valid checklist with PASS produces PASSED
        const validInspection = await commissioningService.recordQualityInspection(ctxA, projectA0, {
          assetId: assetA0,
          itrNumber: 'ITR-VALID-01',
          title: 'Valid Inspection',
          stageKey: 'PRE_COMMISSIONING',
          checklistItems: [
            { itemNo: 1, description: 'Step 1 complete', result: 'PASS' },
            { itemNo: 2, description: 'Step 2 complete', result: 'PASS' },
          ],
        });
        expect(validInspection.outcome).toBe('PASSED');

        // Witness authority: missing partyName or role throws BadRequestException
        await expect(
          commissioningService.recordInspectionWitnessAttendance(ctxA, projectA0, validInspection.id, {
            partyName: '',
            role: 'CONSULTANT',
            representativeName: 'John Consultant',
          } as any),
        ).rejects.toThrow(BadRequestException);

        // Valid witness sign-off succeeds
        const witnessResult = await commissioningService.recordInspectionWitnessAttendance(ctxA, projectA0, validInspection.id, {
          partyName: 'Consultant Engineering Corp',
          role: 'CHIEF_INSPECTOR',
          representativeName: 'Jane Smith',
          notes: 'Inspected and verified on site',
        });
        expect(witnessResult.inspectionId).toBe(validInspection.id);
        expect(witnessResult.lastSigned.partyName).toBe('Consultant Engineering Corp');

        // --------------------------------------------------------------------
        // F04: TAB Worksheet Dimension & Tolerance Validation + Gap 7 Unrounded
        // --------------------------------------------------------------------
        // Mixed units (CFM and GPM) are rejected
        await expect(
          commissioningService.recordTabWorksheet(ctxA, projectA0, {
            systemType: 'AIR_SIDE',
            worksheetType: 'PRIMARY_AIR_SUPPLY_BALANCING',
            tolerancePercent: 10,
            readings: [
              { terminalOrTag: 'DIFF-01', designFlow: 200, actualFlow: 195, unit: 'CFM' },
              { terminalOrTag: 'DIFF-02', designFlow: 200, actualFlow: 205, unit: 'GPM' },
            ],
          }),
        ).rejects.toThrow(BadRequestException);

        // Tolerance exceeding 15% is rejected
        await expect(
          commissioningService.recordTabWorksheet(ctxA, projectA0, {
            systemType: 'AIR_SIDE',
            worksheetType: 'PRIMARY_AIR_SUPPLY_BALANCING',
            tolerancePercent: 25,
            readings: [
              { terminalOrTag: 'DIFF-01', designFlow: 200, actualFlow: 195, unit: 'CFM' },
            ],
          }),
        ).rejects.toThrow(BadRequestException);

        // Valid readings succeed
        const validTab = await commissioningService.recordTabWorksheet(ctxA, projectA0, {
          systemType: 'AIR_SIDE',
          worksheetType: 'PRIMARY_AIR_SUPPLY_BALANCING',
          tolerancePercent: 10,
          readings: [
            { terminalOrTag: 'DIFF-01', designFlow: 200, actualFlow: 195, unit: 'CFM' },
            { terminalOrTag: 'DIFF-02', designFlow: 200, actualFlow: 202, unit: 'CFM' },
          ],
        });
        expect(validTab.status).toBe('COMPLETED');
        expect(validTab.isWithinTolerance).toBe(true);

        // Gap 7: Raw deviation ratio 10.004% with 10% tolerance MUST fail without premature rounding
        const unroundedTab = await commissioningService.recordTabWorksheet(ctxA, projectA0, {
          systemType: 'AIR_SIDE',
          worksheetType: 'PRIMARY_AIR_SUPPLY_BALANCING',
          tolerancePercent: 10,
          readings: [
            { terminalOrTag: 'DIFF-01', designFlow: 10000, actualFlow: 11000.4, unit: 'CFM' },
          ],
        });
        expect(unroundedTab.status).toBe('NEEDS_REBALANCING');
        expect(unroundedTab.isWithinTolerance).toBe(false);
        expect(unroundedTab.designSummary.evaluationBasis).toBe('EXACT_RAW_UNROUNDED');

        // Seasonal Commissioning Lifecycle: Schedule & Complete
        const seasonalSched = await commissioningService.createSeasonalSchedule(ctxA, projectA0, {
          assetId: assetA0,
          season: 'SUMMER_PEAK',
          targetDate: '2027-06-01',
          parameters: { targetChilledWaterSupplyTempC: 7.0 },
        });
        expect(seasonalSched.status).toBe('SCHEDULED');

        const completedSched = await commissioningService.updateSeasonalSchedule(ctxA, projectA0, seasonalSched.id, {
          status: 'COMPLETED',
          testResults: { observedChilledWaterSupplyTempC: 6.9, chillerCop: 5.85 },
          notes: 'Peak summer load testing successfully completed',
        });
        expect(completedSched.status).toBe('PERFORMED');
        expect(completedSched.testResults?.chillerCop).toBe(5.85);

        // --------------------------------------------------------------------
        // F05: Submission Recipient Consensus & Gap 4 Optional Recipient
        // --------------------------------------------------------------------
        const pkgId = uuidv7();
        const subId = uuidv7();
        const party1 = uuidv7();
        const party2 = uuidv7();
        const party3 = uuidv7();
        const recipient1 = uuidv7();
        const recipient2 = uuidv7();
        const recipient3 = uuidv7();

        await admin.query(`
          INSERT INTO handover_packages (id, org_id, project_id, title, status, snapshot_checksum, created_by)
          VALUES ($1, $2, $3, 'HVAC Final Handover Package', 'READY', $4, $5)
        `, [pkgId, orgIdA, projectA0, 'a'.repeat(64), seededUserId]);

        await admin.query(`
          INSERT INTO submissions (id, org_id, project_id, package_id, method, status, created_by)
          VALUES ($1, $2, $3, $4, 'PORTAL', 'SUBMITTED', $5)
        `, [subId, orgIdA, projectA0, pkgId, seededUserId]);

        await admin.query(`
          INSERT INTO parties (id, org_id, name, types, status)
          VALUES ($1, $2, 'Consultant Corp', ARRAY['CONSULTANT'], 'ACTIVE'),
                 ($3, $2, 'Client Corp', ARRAY['CLIENT'], 'ACTIVE'),
                 ($4, $2, 'Observer Corp', ARRAY['OBSERVER'], 'ACTIVE')
        `, [party1, orgIdA, party2, party3]);

        await admin.query(`
          INSERT INTO submission_recipients (id, org_id, project_id, submission_id, recipient_party_id, role, is_required_approver, status)
          VALUES
            ($1, $2, $3, $4, $5, 'CONSULTANT', true, 'SENT'),
            ($6, $2, $3, $4, $7, 'CLIENT_REP', true, 'SENT'),
            ($8, $2, $3, $4, $9, 'OBSERVER', false, 'SENT')
        `, [recipient1, orgIdA, projectA0, subId, party1, recipient2, party2, recipient3, party3]);

        // Acceptance uses a separate authenticated party-bound guest grant.
        // The project owner remains unable to impersonate a recipient.
        const recipientCtx = async (partyId: string): Promise<TenantActorContext> => {
          const grantId = uuidv7();
          await admin.query(`INSERT INTO guest_grants
            (id,org_id,project_id,party_id,grant_type,role,capabilities,
             target_email,token_hash,status,expires_at,created_by,independent_authority_verified_at,independent_authority_evidence_ref)
            VALUES ($1,$2,$3,$4,'CLIENT_VIEW','R-CLIENT',$5,$6,$7,'ACTIVE',now()+interval '1 day',$8,now(),'TEST_FIXTURE:INDEPENDENTLY_APPROVED')`,
            [grantId,orgIdA,projectA0,partyId,['package.accept'],
             `${partyId}@example.com`,uuidv7().replace(/-/g,''),seededUserId]);
          return { ...ctxA, actorType: 'GUEST', guestGrantId: grantId,
            guestCapabilities: ['package.accept'] };
        };
        const observerGuest = await recipientCtx(party3);
        const consultantGuest = await recipientCtx(party1);
        const clientGuest = await recipientCtx(party2);

        // Gap 4: Optional observer rejects -> Does NOT reject the submission
        const rec3Decision = await handoverService.recordRecipientSubmissionDecision(observerGuest, projectA0, subId, {
          recipientPartyId: party3,
          decision: 'REJECT',
          remarks: 'Observer notes cosmetic remarks',
        });
        expect(rec3Decision.status).toBe('SUBMITTED'); // Still SUBMITTED! Not REJECTED!

        // Recipient 1 accepts
        const rec1Decision = await handoverService.recordRecipientSubmissionDecision(consultantGuest, projectA0, subId, {
          recipientPartyId: party1,
          decision: 'ACCEPT',
          remarks: 'Consultant approves HVAC package',
        });
        // Overall submission status must NOT be ACCEPTED yet because recipient 2 has not decided!
        expect(rec1Decision.status).toBe('SUBMITTED');

        // Recipient 2 accepts
        const rec2Decision = await handoverService.recordRecipientSubmissionDecision(clientGuest, projectA0, subId, {
          recipientPartyId: party2,
          decision: 'ACCEPT',
          remarks: 'Client Rep accepts package',
        });
        // Now that all required recipients have accepted, overall status is ACCEPTED
        expect(rec2Decision.status).toBe('ACCEPTED');

        // --------------------------------------------------------------------
        // F06: Archive Storage Object Verification & Gap 3
        // --------------------------------------------------------------------
        const exportId = uuidv7();
        const archiveStorageObjId = uuidv7();
        const actualArchiveKey = `archives/${orgIdA}/${projectA0}/${exportId}/export.zip`;
        const archiveSha = 'c'.repeat(64);

        // Missing artifact.objectId throws ARCHIVE_ARTIFACT_INTEGRITY_MISSING
        await admin.query(`
          INSERT INTO archive_exports (id, org_id, project_id, schema_version, status, archive_sha256, verification_receipt_json)
          VALUES ($1, $2, $3, '2.0', 'COMPLETED', $4, $5)
        `, [exportId, orgIdA, projectA0, archiveSha, JSON.stringify({ artifact: { objectKey: actualArchiveKey, providerVersionId: 'v1' } })]);

        await expect(
          handoverService.getArchiveExport(ctxA, projectA0, exportId),
        ).rejects.toThrow(ConflictException);

        // Gap 3: Storage object with NULL provider_version_id throws ARCHIVE_STORAGE_INTEGRITY_MISMATCH
        await admin.query(`
          INSERT INTO storage_objects (id, org_id, bucket, object_key, size_bytes, observed_size_bytes, mime, sha256, status, provider_version_id)
          VALUES ($1, $2, 'vault', $3, 2048, 2048, 'application/zip', $4, 'READY', NULL)
        `, [archiveStorageObjId, orgIdA, actualArchiveKey, archiveSha]);

        await admin.query(`
          UPDATE archive_exports
             SET verification_receipt_json = $1
           WHERE id = $2
        `, [JSON.stringify({ artifact: { objectId: archiveStorageObjId, bucket: 'vault', objectKey: actualArchiveKey, providerVersionId: null, sizeBytes: 2048, sha256: archiveSha } }), exportId]);

        await expect(
          handoverService.getArchiveExport(ctxA, projectA0, exportId),
        ).rejects.toThrow(ConflictException);

        // Storage object with mismatched SHA throws ARCHIVE_STORAGE_INTEGRITY_MISMATCH
        await admin.query(`
          UPDATE storage_objects
             SET provider_version_id = 'v1', sha256 = $1
           WHERE id = $2
        `, ['d'.repeat(64), archiveStorageObjId]);

        await admin.query(`
          UPDATE archive_exports
             SET verification_receipt_json = $1
           WHERE id = $2
        `, [JSON.stringify({ artifact: { objectId: archiveStorageObjId, bucket: 'vault', objectKey: actualArchiveKey, providerVersionId: 'v1', sizeBytes: 2048, sha256: archiveSha } }), exportId]);

        await expect(
          handoverService.getArchiveExport(ctxA, projectA0, exportId),
        ).rejects.toThrow(ConflictException);

        // Matching storage object with non-null provider_version_id signs URL successfully
        await admin.query(`
          UPDATE storage_objects
             SET sha256 = $1
           WHERE id = $2
        `, [archiveSha, archiveStorageObjId]);

        const validExportRes = await handoverService.getArchiveExport(ctxA, projectA0, exportId);
        expect(validExportRes.downloadUrl).toBeDefined();

        // --------------------------------------------------------------------
        // F07: Defect Remedy Lifecycle & Commercial Readiness + Gap 5
        // --------------------------------------------------------------------
        const defectId = uuidv7();
        const remedyEvidenceId = uuidv7();
        const otherEvidenceId = uuidv7();
        const remedyDocId = uuidv7();
        const remedyVerId = uuidv7();

        // Seed unrelated/generic storage object (manual without asset binding)
        await admin.query(`
          INSERT INTO storage_objects (id, org_id, bucket, object_key, size_bytes, observed_size_bytes, mime, sha256, status, provider_version_id)
          VALUES ($1, $2, 'vault', $3, 512, 512, 'application/pdf', $4, 'READY', 'v1')
        `, [otherEvidenceId, orgIdA, `orgs/${orgIdA}/projects/${projectA0}/manuals/general.pdf`, 'f'.repeat(64)]);

        // Seed remedy evidence storage object bound to defect in object_key
        await admin.query(`
          INSERT INTO storage_objects (id, org_id, bucket, object_key, size_bytes, observed_size_bytes, mime, sha256, status, provider_version_id)
          VALUES ($1, $2, 'vault', $3, 1024, 1024, 'image/jpeg', $4, 'READY', 'v1')
        `, [remedyEvidenceId, orgIdA, `orgs/${orgIdA}/projects/${projectA0}/defects/${defectId}/photo.jpg`, 'e'.repeat(64)]);

        await admin.query(`
          INSERT INTO documents (id, org_id, project_id, title, doc_type_key, category_key, status, created_by)
          VALUES ($1, $2, $3, 'Defect Rectification Photo', 'PHOTO', 'DEFECT', 'ACTIVE', $4)
        `, [remedyDocId, orgIdA, projectA0, seededUserId]);

        await admin.query(`
          INSERT INTO document_versions (id, org_id, project_id, document_id, version_no, revision_code, object_id, file_status, review_status, issue_date, uploaded_by)
          VALUES ($1, $2, $3, $4, 1, 'R0', $5, 'READY', 'APPROVED', CURRENT_DATE, $6)
        `, [remedyVerId, orgIdA, projectA0, remedyDocId, remedyEvidenceId, seededUserId]);

        // Insert OPEN critical defect bound to assetA0
        await admin.query(`
          INSERT INTO defects (id, org_id, project_id, asset_id, title, description, severity, status, raised_by, row_version)
          VALUES ($1, $2, $3, $4, 'Critical chilled water leak', 'Flange leak on pump outlet', 'CRITICAL', 'OPEN', $5, 1)
        `, [defectId, orgIdA, projectA0, assetA0, seededUserId]);

        // Commercial readiness is blocked by OPEN critical defect
        const readinessBlocked = await warrantyService.getCommercialReadiness(ctxA, projectA0);
        expect(readinessBlocked.commercialReadiness.isRetentionEligible).toBe(false);
        expect(readinessBlocked.defects.critical).toBe(1);

        // Attempting to close OPEN defect directly is denied (OPEN -> CLOSED bypass forbidden)
        await expect(
          warrantyService.closeDefect(ctxIndep, projectA0, defectId, remedyEvidenceId, 1),
        ).rejects.toThrow(ConflictException);

        // Gap 5: Attempting to remedy asset defect with generic evidence throws CLOSURE_EVIDENCE_ASSET_MISMATCH
        await expect(
          warrantyService.submitDefectRemedy(ctxA, projectA0, defectId, otherEvidenceId, 1),
        ).rejects.toThrow(ConflictException);

        // Submit remedy transitions defect to RECTIFIED and records remedied_by
        const remedyRes = await warrantyService.submitDefectRemedy(ctxA, projectA0, defectId, remedyEvidenceId, 1);
        expect(remedyRes.status).toBe('RECTIFIED');
        expect(remedyRes.rowVersion).toBe(2);

        // Commercial readiness remains blocked while defect is in RECTIFIED status (until verified closed)
        const readinessStillBlocked = await warrantyService.getCommercialReadiness(ctxA, projectA0);
        expect(readinessStillBlocked.commercialReadiness.isRetentionEligible).toBe(false);
        expect(readinessStillBlocked.defects.critical).toBe(1);

        // Remedy submitter (user A) cannot self-verify and close the defect
        await expect(
          warrantyService.closeDefect(ctxA, projectA0, defectId, remedyEvidenceId, 2),
        ).rejects.toThrow(ForbiddenException);

        // Gap 5: Independent verifier cannot close with DIFFERENT unreviewed evidence
        await expect(
          warrantyService.closeDefect(ctxIndep, projectA0, defectId, otherEvidenceId, 2),
        ).rejects.toThrow(ConflictException);

        // Independent verifier (independent user) successfully verifies and closes defect with matching remedy evidence
        const closeRes = await warrantyService.closeDefect(ctxIndep, projectA0, defectId, remedyEvidenceId, 2);
        expect(closeRes.status).toBe('CLOSED');
        expect(closeRes.rowVersion).toBe(3);

        // Defect is now CLOSED -> critical defects count drops to 0
        const readinessAfterClose = await warrantyService.getCommercialReadiness(ctxA, projectA0);
        expect(readinessAfterClose.defects.critical).toBe(0);
      });
    }, 45000);
  });
});
