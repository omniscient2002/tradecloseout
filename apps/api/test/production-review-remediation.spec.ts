// apps/api/test/production-review-remediation.spec.ts
// Regression verification suite for Full Production Review Findings (NP01..NP06, NP09, NP10)

import { uuidv7 } from 'uuidv7';
import {
  BadRequestException,
  NotFoundException,
  HttpException,
  ConflictException,
} from '@nestjs/common';
import { CommissioningService } from '../src/modules/commissioning/commissioning.service';
import { CommissioningController } from '../src/modules/commissioning/commissioning.controller';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import { ReviewsController } from '../src/modules/reviews/reviews.controller';
import { WorkItemsService } from '../src/modules/work-items/work-items.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { ChecklistsController } from '../src/modules/checklists/checklists.controller';

describe('Production Review Remediation Suite (NP01..NP06, NP09, NP10)', () => {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const userId = uuidv7();
  const ctx: any = {
    orgId,
    activeOrgId: orgId,
    userId,
    actorType: 'USER',
    orgRole: 'R-OWNER',
    capabilities: ['*'],
    requestId: uuidv7(),
  };

  // --------------------------------------------------------------------------
  // NP01: Witness Authority and Attendance Qualification
  // --------------------------------------------------------------------------
  describe('NP01: Inspection Witness Identity and Representation', () => {
    it('records attendance with unverified status when party is unverified or no partyId provided', async () => {
      const inspectionId = uuidv7();
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('SELECT * FROM quality_inspections')) {
              return {
                rows: [
                  {
                    id: inspectionId,
                    org_id: orgId,
                    project_id: projectId,
                    witness_parties_json: [],
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);
      const res = await commissioningService.recordInspectionWitnessAttendance(ctx, projectId, inspectionId, {
        partyName: 'Unverified Consultant Pvt Ltd',
        representativeName: 'Jane Doe',
        role: 'CONSULTANT',
      });

      expect(res.lastSigned.attestationType).toBe('RECORDED_ATTENDANCE');
      expect(res.lastSigned.isVerified).toBe(false);
      expect(res.lastSigned.requiresConfirmation).toBe(true);
      expect(res.lastSigned.recordedByUserId).toBe(userId);
    });

    it('rejects witness sign-off if nonexistent partyId is provided', async () => {
      const inspectionId = uuidv7();
      const partyId = uuidv7();
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM parties')) {
              return { rows: [] }; // party not found
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);
      await expect(
        commissioningService.recordInspectionWitnessAttendance(ctx, projectId, inspectionId, {
          partyName: 'Fake Corp',
          representativeName: 'Jane Doe',
          role: 'CONSULTANT',
          partyId,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // NP02: Seasonal Commissioning Lifecycle
  // --------------------------------------------------------------------------
  describe('NP02: Seasonal Commissioning Lifecycle', () => {
    it('rejects marking seasonal schedule PERFORMED or COMPLETED without test results', async () => {
      const scheduleId = uuidv7();
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT * FROM seasonal_commissioning_schedules')) {
              return {
                rows: [
                  {
                    id: scheduleId,
                    org_id: orgId,
                    project_id: projectId,
                    status: 'SCHEDULED',
                    test_results_json: null,
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);
      await expect(
        commissioningService.updateSeasonalSchedule(ctx, projectId, scheduleId, {
          status: 'COMPLETED',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows marking seasonal schedule PERFORMED when test results are supplied', async () => {
      const scheduleId = uuidv7();
      let updatedStatus = '';
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('SELECT * FROM seasonal_commissioning_schedules')) {
              return {
                rows: [
                  {
                    id: scheduleId,
                    org_id: orgId,
                    project_id: projectId,
                    status: 'SCHEDULED',
                    test_results_json: null,
                  },
                ],
              };
            }
            if (sql.includes('UPDATE seasonal_commissioning_schedules')) {
              updatedStatus = params[3];
              return { rows: [] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);
      const res = await commissioningService.updateSeasonalSchedule(ctx, projectId, scheduleId, {
        status: 'PERFORMED',
        testResults: { chillerDeltaT: 5.5, cop: 4.8 },
      });

      expect(res.status).toBe('PERFORMED');
      expect(res.testResults).toEqual({ chillerDeltaT: 5.5, cop: 4.8 });
      expect(updatedStatus).toBe('PERFORMED');
    });

    it('requires notes or reason when moving status to DEFERRED or WAIVED', async () => {
      const scheduleId = uuidv7();
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT * FROM seasonal_commissioning_schedules')) {
              return {
                rows: [
                  {
                    id: scheduleId,
                    org_id: orgId,
                    project_id: projectId,
                    status: 'SCHEDULED',
                    notes: null,
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const commissioningService = new CommissioningService(mockPool);
      await expect(
        commissioningService.updateSeasonalSchedule(ctx, projectId, scheduleId, {
          status: 'DEFERRED',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // NP03: Warranty Events & Effective Asset Dates
  // --------------------------------------------------------------------------
  describe('NP03: Warranty Event Date Derivation and Coverage', () => {
    it('extends effective warranty_end on assets when an EXTENSION event is confirmed', async () => {
      const assetId = uuidv7();
      let updatedEnd = '';
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('FROM assets')) {
              return {
                rows: [
                  {
                    id: assetId,
                    tag: 'CH-01',
                    warranty_start_basis: 'HANDOVER',
                    warranty_start: '2026-11-07',
                    warranty_end: '2027-11-07',
                  },
                ],
              };
            }
            if (sql.includes('UPDATE assets') && sql.includes('warranty_end = CASE')) {
              updatedEnd = params[3];
              return { rows: [] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);
      const res = await warrantyService.recordWarrantyEvent(ctx, projectId, {
        assetId,
        eventType: 'EXTENSION',
        oemReference: 'OEM-EXT-01',
        registeredAt: '2026-11-07',
        warrantyStart: '2026-11-07',
        warrantyEnd: '2028-11-07',
        basis: 'HANDOVER',
      });

      expect(res.status).toBe('CONFIRMED');
      expect(res.hasBasisConflict).toBe(false);
      expect(updatedEnd).toBe('2028-11-07');
    });

    it('does not alter asset warranty dates when a CLAIM event is recorded', async () => {
      const assetId = uuidv7();
      let assetUpdateCalled = false;
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM assets')) {
              return {
                rows: [
                  {
                    id: assetId,
                    tag: 'CH-01',
                    warranty_start_basis: 'HANDOVER',
                    warranty_start: '2026-11-07',
                    warranty_end: '2027-11-07',
                  },
                ],
              };
            }
            if (sql.includes('UPDATE assets')) {
              assetUpdateCalled = true;
              return { rows: [] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);
      await warrantyService.recordWarrantyEvent(ctx, projectId, {
        assetId,
        eventType: 'CLAIM',
        oemReference: 'OEM-CLM-01',
        registeredAt: '2026-11-07',
        warrantyStart: '2026-11-07',
        warrantyEnd: '2027-11-07',
        basis: 'HANDOVER',
      });

      expect(assetUpdateCalled).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // NP04: Subscription Truth & Entitlement DTO
  // --------------------------------------------------------------------------
  describe('NP04: Subscription State Truthfulness', () => {
    it('returns INACTIVE plan tier NONE with zero limits and null id when no subscription exists', async () => {
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM subscriptions')) {
              return { rows: [] }; // no subscription
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);
      const sub = await warrantyService.getSubscription(ctx);

      expect(sub.id).toBeNull();
      expect(sub.status).toBe('INACTIVE');
      expect(sub.planTier).toBe('NONE');
      expect(sub.pricePaise).toBe(0);
      expect(sub.seatLimit).toBe(0);
      expect(sub.storageQuotaBytes).toBe(0);
      expect(sub.limitsJson).toEqual({ maxActiveProjects: 0, maxSeats: 0, maxStorageBytes: 0 });
    });

    it('preserves legitimate zero limits without overriding with defaults', async () => {
      const subId = uuidv7();
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM subscriptions')) {
              return {
                rows: [
                  {
                    id: subId,
                    org_id: orgId,
                    plan_id: uuidv7(),
                    status: 'ACTIVE',
                    plan_name: 'Custom Enterprise',
                    plan_tier: 'ENTERPRISE',
                    price_paise: 5000000,
                    limits_json: { maxSeats: 0, maxStorageBytes: 0, maxActiveProjects: 0 },
                  },
                ],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      };

      const warrantyService = new WarrantyAndBillingService(mockPool);
      const sub = await warrantyService.getSubscription(ctx);

      expect(sub.id).toBe(subId);
      expect(sub.seatLimit).toBe(0);
      expect(sub.storageQuotaBytes).toBe(0);
      expect(sub.maxActiveProjects).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // NP05: Work-Item Command Contracts & Action Endpoints
  // --------------------------------------------------------------------------
  describe('NP05: Work-Item Action Routes and Preconditions', () => {
    it('returns /api/v1 prefixes and row_version on work item projections', async () => {
      const mockPool: any = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM document_versions') || sql.includes('WITH all_items')) {
              return {
                rows: [
                  {
                    entity_id: uuidv7(),
                    entity_version: 3,
                    title: 'Approved Submittal',
                    project_id: projectId,
                    project_code: 'PRJ-1',
                    project_name: 'Tower A',
                    created_at: new Date().toISOString(),
                    type: 'REVIEW_PENDING',
                    priority: 'HIGH',
                    waiting_on: 'Awaiting submittal review decision',
                    entity_type: 'DOCUMENT_VERSION',
                    next_path: `/api/v1/projects/${projectId}/document-versions/dv-1/decision`,
                    next_method: 'POST',
                    next_action: 'DECIDE_REVIEW',
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
      const res = await workItemsService.listWorkItems(ctx, {});
      expect(res.items.length).toBe(1);
      expect(res.items[0].nextCommand.path).toMatch(/^\/api\/v1\//);
      expect(res.items[0].entityVersion).toBe(3);
    });

    it('processes supplier obligation intake only when backed by verified document evidence', async () => {
      const verifiedVersionId=uuidv7();
      const obligationId = uuidv7();
      let updatedStatus = '';
      const mockClient: any = {
        query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
          // Intake is valid only while the target project is live.
          if (sql.includes('SELECT status FROM projects')) {
            return { rows: [{ status: 'ACTIVE' }] };
          }
          if (sql.includes('FROM document_versions dv')) {
            // This stub represents an actual READY, version-pinned object;
            // prove the service SQL enforces the immutable evidence predicates.
            expect(sql).toContain("so.provider_version_id IS NOT NULL");
            expect(sql).toContain("so.observed_size_bytes=so.size_bytes");
            expect(params[2]).toBe(verifiedVersionId);
            return {rows:[{id:verifiedVersionId}]};
          }
          if (sql.includes('FROM supplier_document_obligations')) {
            return {
              rows: [
                {
                  id: obligationId,
                  org_id: orgId,
                  project_id: projectId,
                  status: 'UPLOADED',
                  document_version_id: verifiedVersionId,
                  doc_type_key:'DT-001',
                  supplier_party_id:null,requirement_id:null,
                },
              ],
            };
          }
          if (sql.includes('UPDATE supplier_document_obligations')) {
            expect(sql).toContain("SET status='ACCEPTED',document_version_id=$4");
            expect(params[3]).toBe(verifiedVersionId);
            updatedStatus='ACCEPTED';
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };

      const mockDb: any = {
        withTenantContext: jest.fn().mockImplementation((_, cb) => cb(mockClient)),
      };

      const partiesService = new PartiesService(mockDb, null as any, null as any);
      const res = await partiesService.intakeSupplierObligation(ctx, projectId, obligationId, {
        decision: 'ACCEPT',
      });

      expect(res.status).toBe('ACCEPTED');
      expect(updatedStatus).toBe('ACCEPTED');
    });
  });

  // --------------------------------------------------------------------------
  // NP09: TAB Flow Validation
  // --------------------------------------------------------------------------
  describe('NP09: TAB Flow Measurement Validation', () => {
    it('rejects non-positive and non-finite actual flow measurements', async () => {
      const mockPool: any = {};
      const commissioningService = new CommissioningService(mockPool);

      await expect(
        commissioningService.recordTabWorksheet(ctx, projectId, {
          systemType: 'WATER_SIDE',
          worksheetType: 'PRIMARY_CHILLED_WATER',
          readings: [
            { terminalOrTag: 'CH-1', designFlow: 100, actualFlow: -10, unit: 'GPM' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        commissioningService.recordTabWorksheet(ctx, projectId, {
          systemType: 'WATER_SIDE',
          worksheetType: 'PRIMARY_CHILLED_WATER',
          readings: [
            { terminalOrTag: 'CH-1', designFlow: 100, actualFlow: 0, unit: 'GPM' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        commissioningService.recordTabWorksheet(ctx, projectId, {
          systemType: 'WATER_SIDE',
          worksheetType: 'PRIMARY_CHILLED_WATER',
          readings: [
            { terminalOrTag: 'CH-1', designFlow: 100, actualFlow: NaN, unit: 'GPM' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // NP10: Review Concurrency & Preconditions
  // --------------------------------------------------------------------------
  describe('NP10: Review Decision Concurrency and Decision Validation', () => {
    it('rejects review decision with HTTP 412 PRECONDITION_FAILED when expectedRowVersion does not match current version', async () => {
      const reviewId = uuidv7();
      const versionId = uuidv7();

      const mockClient: any = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM reviews')) {
            return {
              rows: [
                {
                  id: reviewId,
                  org_id: orgId,
                  status: 'IN_REVIEW',
                  reviewer_subject_type: 'USER',
                  reviewer_subject_id: userId,
                  document_version_id: versionId,
                },
              ],
            };
          }
          if (sql.includes('FROM document_versions')) {
            return {
              rows: [
                {
                  id: versionId,
                  org_id: orgId,
                  document_id: uuidv7(),
                  row_version: 5, // current row version is 5
                  file_status: 'READY',
                  review_status: 'IN_REVIEW',
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const mockDb: any = {
        withTenantContext: jest.fn().mockImplementation((_, cb) => cb(mockClient)),
      };

      const reviewsService = new ReviewsService(mockDb);

      // Caller expects row_version 4, but current is 5 -> Precondition failed
      await expect(
        reviewsService.decideReview(ctx, reviewId, {
          decision: 'APPROVE',
          expectedRowVersion: 4,
        }),
      ).rejects.toMatchObject({
        status: 412,
        response: { code: 'PRECONDITION_FAILED' },
      });
    });

    it('rejects unknown decision values with BadRequestException and never falls back to APPROVE', async () => {
      const reviewsController = new ReviewsController({} as any);

      await expect(
        reviewsController.decideVersionReview(
          { userContext: ctx },
          projectId,
          uuidv7(),
          undefined,
          { decision: 'UNKNOWN_DECISION_TYPE' as any },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
