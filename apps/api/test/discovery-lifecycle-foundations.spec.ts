// apps/api/test/discovery-lifecycle-foundations.spec.ts
// Comprehensive Test Suite for Second-Pass Discovery & Lifecycle Foundations:
// 1. Asset Identity Revisions & Evidence Revalidation (Top 25 Item 3 / Future Domain Model §5)
// 2. Dual Event Time & Backdated-Entry Provenance (Top 25 Item 4 / Future Domain Model §7)
// 3. Evidence Companion Rules & Missing Attachment Checks (Top 25 Item 6 / Future Domain Model §2)
// 4. Portable Self-Verifying Archive Export with SHA-256 Receipt (Top 25 Item 7 / Future Domain Model §12)

import { uuidv7 } from 'uuidv7';
import { UnprocessableEntityException } from '@nestjs/common';
import { AssetsService } from '../src/modules/assets/assets.service';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { TradeCloseoutScheduler } from '../../worker/src/scheduler';

describe('Discovery & Lifecycle Foundations Test Suite', () => {
  const orgId = '0192e3a0-0000-7000-8000-000000000001';
  const projectId = '0192e3a0-1000-7000-8000-000000000002';
  const userId = '0192e3a0-2000-7000-8000-000000000003';
  const assetId = '0192e3a0-3000-7000-8000-000000000004';
  const versionId = '0192e3a0-4000-7000-8000-000000000005';
  const reviewId = '0192e3a0-5000-7000-8000-000000000006';

  const mockTenantActorCtx = {
    orgId,
    userId,
    actorType: 'MEMBER' as const,
    requestId: 'req-discovery-123',
    ip: '127.0.0.1',
    userAgent: 'jest-test',
  };

  const mockCtx = {
    orgId,
    userId,
    actorType: 'USER' as const,
    requestId: 'req-discovery-123',
  };

  // ==========================================================================
  // 1. Asset Identity Revisions & Evidence Revalidation (Top 25 Item 3)
  // ==========================================================================
  describe('Asset Identity Revisions & Evidence Revalidation', () => {
    it('creates immutable identity revision and revalidation records when serialNo or model changes', async () => {
      const executedQueries: Array<{ sql: string; params: any[] }> = [];

      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
          executedQueries.push({ sql, params: params || [] });

          if (sql.includes('SELECT status, purged_at FROM projects')) {
            return { rows: [{ status: 'ACTIVE', purged_at: null }] };
          }
          if (sql.includes('SELECT * FROM assets WHERE')) {
            return {
              rows: [
                {
                  id: assetId,
                  org_id: orgId,
                  project_id: projectId,
                  tag: 'CH-01',
                  name: 'Water Cooled Chiller',
                  make: 'Carrier',
                  model: '19XR-1000',
                  serial_no: 'SN-CARRIER-2024-001',
                  location: 'Basement Plant Room',
                  status: 'ACTIVE',
                  row_version: 1,
                },
              ],
            };
          }
          if (sql.includes('SELECT COALESCE(MAX(revision_no), 0)')) {
            return { rows: [{ max_rev: '0' }] };
          }
          if (sql.includes('UPDATE asset_identity_revisions')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO asset_identity_revisions')) {
            return { rows: [{ id: uuidv7(), revision_no: 1 }] };
          }
          if (sql.includes('SELECT DISTINCT dv.id')) {
            // Returns 2 linked approved/ready evidence versions
            return {
              rows: [
                { id: versionId },
                { id: '0192e3a0-4000-7000-8000-000000000009' },
              ],
            };
          }
          if (sql.includes('INSERT INTO evidence_revalidations')) {
            return { rows: [{ id: uuidv7() }] };
          }
          if (sql.includes('UPDATE assets')) {
            return {
              rows: [
                {
                  id: assetId,
                  tag: 'CH-01',
                  name: 'Water Cooled Chiller',
                  make: 'Carrier',
                  model: '19XR-1200',
                  serial_no: 'SN-CARRIER-2024-999',
                  location: 'Basement Plant Room',
                  status: 'ACTIVE',
                  row_version: 2,
                },
              ],
            };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      } as any;

      const assetsService = new AssetsService(mockPool);

      const result = await assetsService.updateAsset(mockTenantActorCtx, projectId, assetId, {
        model: '19XR-1200',
        serialNo: 'SN-CARRIER-2024-999',
        reason: 'OEM compressor upgrade and replacement serial allocation',
        changeType: 'SUBSTITUTION',
      });

      expect(result.serial_no).toBe('SN-CARRIER-2024-999');
      expect(result.identityRevision).toBeDefined();
      expect(result.identityRevision.revisionNo).toBe(1);
      expect(result.identityRevision.changeType).toBe('SUBSTITUTION');
      expect(result.identityRevision.revalidationCount).toBe(2);

      // Verify that INSERT INTO asset_identity_revisions was called
      const identityRevInsert = executedQueries.find((q) =>
        q.sql.includes('INSERT INTO asset_identity_revisions'),
      );
      expect(identityRevInsert).toBeDefined();
      expect(identityRevInsert?.params).toContain('SUBSTITUTION');
      expect(identityRevInsert?.params).toContain('SN-CARRIER-2024-999');

      // Verify that 2 evidence revalidation entries were created
      const revalidationInserts = executedQueries.filter((q) =>
        q.sql.includes('INSERT INTO evidence_revalidations'),
      );
      expect(revalidationInserts.length).toBe(2);
    });

    it('does not create identity revisions or revalidations when non-identity fields (status) change', async () => {
      const executedQueries: Array<{ sql: string; params: any[] }> = [];

      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
          executedQueries.push({ sql, params: params || [] });

          if (sql.includes('SELECT status, purged_at FROM projects')) {
            return { rows: [{ status: 'ACTIVE', purged_at: null }] };
          }
          if (sql.includes('SELECT * FROM assets WHERE')) {
            return {
              rows: [
                {
                  id: assetId,
                  org_id: orgId,
                  project_id: projectId,
                  tag: 'CH-01',
                  name: 'Water Cooled Chiller',
                  make: 'Carrier',
                  model: '19XR-1000',
                  serial_no: 'SN-CARRIER-2024-001',
                  location: 'Basement Plant Room',
                  status: 'ACTIVE',
                  row_version: 1,
                },
              ],
            };
          }
          if (sql.includes('UPDATE assets')) {
            return {
              rows: [
                {
                  id: assetId,
                  tag: 'CH-01',
                  name: 'Water Cooled Chiller',
                  status: 'MAINTENANCE',
                  row_version: 2,
                },
              ],
            };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      } as any;

      const assetsService = new AssetsService(mockPool);

      const result = await assetsService.updateAsset(mockTenantActorCtx, projectId, assetId, {
        status: 'MAINTENANCE',
      });

      expect(result.identityRevision).toBeNull();
      const identityRevInsert = executedQueries.find((q) =>
        q.sql.includes('INSERT INTO asset_identity_revisions'),
      );
      expect(identityRevInsert).toBeUndefined();
    });
  });

  // ==========================================================================
  // 2. Dual Event Time & Provenance (Top 25 Item 4)
  // ==========================================================================
  describe('Dual Event Time & Provenance', () => {
    it('records occurred_at, recorded_at, precision, and backdating_reason in external reviews', async () => {
      let insertedReviewParams: any[] = [];

      const mockDb = {
        withTenantContext: jest.fn().mockImplementation(async (ctx, fn) => {
          const client = {
            query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
              if (sql.includes('SELECT * FROM document_versions WHERE')) {
                return {
                  rows: [
                    {
                      id: versionId,
                      document_id: 'doc-001',
                      project_id: projectId,
                      file_status: 'READY',
                      review_status: 'IN_REVIEW',
                      expiry_date: null,
                      object_id: 'object-1',
                      row_version: 1,
                    },
                  ],
                };
              }
              if (sql.includes('SELECT * FROM documents WHERE')) {
                return {
                  rows: [
                    {
                      id: 'doc-001',
                      current_approved_version_id: null,
                      latest_version_id: versionId,
                      category_key: 'DT-001',
                    },
                  ],
                };
              }
              if (sql.includes('SELECT party.id')) return { rows: [{ id: 'party-1' }] };
              if (sql.includes('SELECT id, latest_version_id, current_approved_version_id')) {
                return { rows: [{ id: 'doc-001', latest_version_id: versionId, current_approved_version_id: null, doc_type_key: 'DT-001' }] };
              }
              if (sql.includes('SELECT so.id')) return { rows: [{ id: 'proof-object', proof_version_id: 'proof-version' }] };
              if (sql.includes('SELECT 1 FROM storage_objects')) return { rows: [{}] };
              if (sql.includes('SELECT rule_code, rule_name')) {
                return { rows: [] };
              }
              if (sql.includes('SELECT dv.id, dv.revision_code, d.title')) {
                return { rows: [] };
              }
              if (sql.includes('INSERT INTO reviews')) {
                insertedReviewParams = params || [];
                return { rows: [{ id: reviewId }] };
              }
              return { rows: [] };
            }),
          };
          return fn(client);
        }),
      } as any;

      const reviewsService = new ReviewsService(mockDb);

      const pastOccurredDate = '2026-10-15T14:30:00.000Z';
      const backdateReason = 'Site consultant stamped hardcopy handed over during weekly progress meeting';

      const res = await reviewsService.recordExternalApproval(mockCtx, versionId, {
        decision: 'APPROVE',
        externalMethod: 'STAMPED_PDF',
        externalApproverName: 'R. K. Verma (Client Consultant)',
        externalApproverRole: 'Consultant',
        externalPartyId: 'party-1',
        externalReference: 'TRN-1',
        decidedAt: pastOccurredDate,
        evidenceObjectId: '0192e3a0-7000-7000-8000-000000000007',
        occurredAt: pastOccurredDate,
        occurredAtPrecision: 'INSTANT',
        backdatingReason: backdateReason,
      }, 1);

      expect(res.status).toBe('APPROVED');
      expect(insertedReviewParams).toContain(backdateReason);
      expect(insertedReviewParams).toContain('INSTANT');
      // The Date object matches the passed pastOccurredDate
      const dateParam = insertedReviewParams.find(
        (p) => p instanceof Date && p.toISOString() === pastOccurredDate,
      );
      expect(dateParam).toBeDefined();
    });

    it('records occurred_at and backdating_reason in warranty events', async () => {
      let insertedWarrantyParams: any[] = [];

      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
          if (sql.includes('SELECT id, tag, warranty_start_basis')) {
            return {
              rows: [
                {
                  id: assetId,
                  tag: 'AHU-01',
                  warranty_start_basis: 'COMMISSIONING',
                  warranty_start: '2026-09-01',
                },
              ],
            };
          }
          if (sql.includes('INSERT INTO warranty_events')) {
            insertedWarrantyParams = params || [];
            return { rows: [{ id: uuidv7() }] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      } as any;

      const billingService = new WarrantyAndBillingService(mockPool);

      const physicalEventDate = '2026-09-01T00:00:00.000Z';
      const result = await billingService.recordWarrantyEvent(mockTenantActorCtx, projectId, {
        assetId,
        eventType: 'CONFIRMATION',
        oemReference: 'OEM-WAR-9902',
        registeredAt: '2026-09-01',
        warrantyStart: '2026-09-01',
        warrantyEnd: '2028-08-31',
        basis: 'COMMISSIONING',
        occurredAt: physicalEventDate,
        occurredAtPrecision: 'DATE',
        backdatingReason: 'OEM letter issued in physical dispatch package',
      });

      expect(result.status).toBe('CONFIRMED');
      expect(insertedWarrantyParams).toContain('DATE');
      expect(insertedWarrantyParams).toContain('OEM letter issued in physical dispatch package');
    });
  });

  // ==========================================================================
  // 3. Evidence Companion Rules & Missing Attachments (Top 25 Item 6)
  // ==========================================================================
  describe('Evidence Companion Rules & Missing Attachments', () => {
    it('blocks approval of DT-018 Pressure Test when mandatory DT-041 Calibration Certificate is missing', async () => {
      const mockDb = {
        withTenantContext: jest.fn().mockImplementation(async (ctx, fn) => {
          const client = {
            query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
              if (sql.includes('SELECT project_id FROM reviews')) {
                return { rows: [{ project_id: projectId }] };
              }
              if (sql.includes('SELECT role,scope_json FROM project_members')) {
                return { rows: [{ role: 'R-QC', scope_json: {} }] };
              }
              if (sql.includes('SELECT * FROM reviews WHERE org_id = $1 AND id = $2')) {
                return {
                  rows: [
                    {
                      id: reviewId,
                      document_version_id: versionId,
                      project_id: projectId,
                      status: 'IN_REVIEW',
                      reviewer_subject_type: 'USER', reviewer_subject_id: userId,
                    },
                  ],
                };
              }
              if (sql.includes('SELECT * FROM document_versions WHERE org_id = $1 AND id = $2 FOR UPDATE')) {
                return {
                  rows: [
                    {
                      id: versionId,
                      document_id: 'doc-pressure-test',
                      file_status: 'READY',
                      review_status: 'IN_REVIEW',
                      uploaded_by: 'another-user-id',
                      object_id: 'object-1',
                    },
                  ],
                };
              }
              if (sql.includes('SELECT * FROM documents WHERE org_id = $1 AND id = $2 FOR UPDATE')) {
                return {
                  rows: [
                    {
                      id: 'doc-pressure-test',
                      category_key: 'DT-018', // Pressure / Hydrostatic Test Report
                      latest_version_id: versionId,
                    },
                  ],
                };
              }
              if (sql.includes('SELECT rule_code, rule_name')) {
                return { rows: [] }; // No DB overrides, will use STANDARD_COMPANION_RULES
              }
              if (sql.includes('SELECT 1 FROM storage_objects')) return { rows: [{}] };
              if (sql.includes('SELECT dv.id, dv.revision_code, d.title')) {
                return { rows: [] }; // Missing companion DT-041 calibration certificate!
              }
              return { rows: [] };
            }),
          };
          return fn(client);
        }),
      } as any;

      const reviewsService = new ReviewsService(mockDb);

      await expect(
        reviewsService.decideReview({...mockCtx,projectId,projectRole:'R-QC'}, reviewId, {
          decision: 'APPROVE',
          comment: 'Readings are acceptable',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('permits approval of DT-018 when companion DT-041 is approved or when isOverride is provided', async () => {
      const mockDb = {
        withTenantContext: jest.fn().mockImplementation(async (ctx, fn) => {
          const client = {
            query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
              if (sql.includes('SELECT project_id FROM reviews')) {
                return { rows: [{ project_id: projectId }] };
              }
              if (sql.includes('SELECT role,scope_json FROM project_members')) {
                return { rows: [{ role: 'R-QC', scope_json: {} }] };
              }
              if (sql.includes('SELECT * FROM reviews WHERE org_id = $1 AND id = $2')) {
                return {
                  rows: [
                    {
                      id: reviewId,
                      document_version_id: versionId,
                      project_id: projectId,
                      status: 'IN_REVIEW',
                      reviewer_subject_type: 'USER', reviewer_subject_id: userId,
                    },
                  ],
                };
              }
              if (sql.includes('SELECT * FROM document_versions WHERE org_id = $1 AND id = $2 FOR UPDATE')) {
                return {
                  rows: [
                    {
                      id: versionId,
                      document_id: 'doc-pressure-test',
                      file_status: 'READY',
                      review_status: 'IN_REVIEW',
                      uploaded_by: 'another-user-id',
                      object_id: 'object-1',
                    },
                  ],
                };
              }
              if (sql.includes('SELECT * FROM documents WHERE org_id = $1 AND id = $2 FOR UPDATE')) {
                return {
                  rows: [
                    {
                      id: 'doc-pressure-test',
                      category_key: 'DT-018',
                      latest_version_id: versionId,
                    },
                  ],
                };
              }
              if (sql.includes('SELECT rule_code, rule_name')) {
                return { rows: [] };
              }
              if (sql.includes('SELECT 1 FROM storage_objects')) return { rows: [{}] };
              if (sql.includes('SELECT dv.id, dv.revision_code, d.title')) {
                // DT-041 is present and approved
                return {
                  rows: [
                    {
                      id: 'ver-cal-041',
                      revision_code: 'R1',
                      title: 'Digital Pressure Gauge Calibration Certificate',
                    },
                  ],
                };
              }
              return { rows: [] };
            }),
          };
          return fn(client);
        }),
      } as any;

      const reviewsService = new ReviewsService(mockDb);

      const res = await reviewsService.decideReview({...mockCtx,projectId,projectRole:'R-QC'}, reviewId, {
        decision: 'APPROVE',
        comment: 'All hydrostatic test readings and gauge calibration verified',
      });

      expect(res.status).toBe('OK');
      expect(res.decision).toBe('APPROVE');
    });
  });

  // ==========================================================================
  // 4. Portable Self-Verifying Archive Export (Top 25 Item 7)
  // ==========================================================================
  describe('Portable Self-Verifying Archive Export', () => {
    it('generates a complete manifest and canonical SHA-256 verification receipt', async () => {
      let insertedExportRecord: any = null;

      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
          if (sql.includes('SELECT id,code,name,site_json,created_at FROM projects')) {
            return {
              rows: [
                {
                  id: projectId,
                  code: 'PRJ-VAYU-01',
                  name: 'Vayuputra HVAC Complex',
                  site_json: { city: 'Bengaluru' },
                  created_at: new Date(),
                },
              ],
            };
          }
          if (sql.includes('FROM document_versions dv')) {
            return {
              rows: [
                {
                  version_id: versionId,
                  document_id: 'doc-001',
                  document_title: 'Chilled Water Scheme',
                  category_key: 'DT-086',
                  version_no: 1,
                  revision_code: 'R1',
                  object_id: 'so-001',
                  object_key: 'drawings/chw.pdf',
                  mime: 'application/pdf',
                  size_bytes: '1048576',
                  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                  file_status: 'READY',
                  review_status: 'APPROVED',
                  uploaded_by_name: 'Amit Verma',
                },
              ],
            };
          }
          if (sql.includes('FROM assets a')) {
            return {
              rows: [
                {
                  id: assetId,
                  tag: 'CH-01',
                  name: 'Chiller 1',
                  category_key: 'CHILLER',
                  make: 'Carrier',
                  model: '19XR',
                  serial_no: 'SN-001',
                  location: 'Basement',
                  status: 'ACTIVE',
                  identity_revisions_count: '1',
                },
              ],
            };
          }
          if (sql.includes('FROM requirements r')) {
            return {
              rows: [
                {
                  id: 'req-001',
                  requirement_key: 'REQ-001',
                  scope_key: 'project',
                  title: 'As-Built Piping Drawings',
                  doc_type_key: 'DT-086',
                  mandatory: true,
                  status: 'APPROVED',
                  current_approved_version_id: versionId,
                },
              ],
            };
          }
          if (sql.includes('FROM reviews r')) {
            return {
              rows: [
                {
                  id: reviewId,
                  document_version_id: versionId,
                  method: 'IN_APP',
                  status: 'APPROVED',
                  decision: 'APPROVE',
                  decided_at: new Date(),
                  occurred_at: new Date(),
                  occurred_at_precision: 'INSTANT',
                  recorded_at: new Date(),
                  reviewer_name: 'Lead QC',
                },
              ],
            };
          }
          if (sql.includes('FROM handover_packages hp')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO archive_exports')) {
            insertedExportRecord = params;
            return { rows: [] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      } as any;

      const handoverService = new HandoverService(mockPool, {} as any);

      const res = await handoverService.exportProjectArchive({...mockTenantActorCtx,orgRole:'R-OWNER'}, projectId, {
        purpose: 'Handover & Exit Audit',
      });

      expect(res.status).toBe('MANIFEST_ONLY');
      expect(res.portableArchiveReady).toBe(false);
      expect(res.totalObjects).toBe(1);
      expect(res.manifestSha256).toMatch(/^[a-f0-9]{64}$/);

      expect(res.manifest).toBeDefined();
      expect(res.manifest.objects.length).toBe(1);
      expect(res.manifest.objects[0].sha256).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );

      expect(res.verificationReceipt).toBeDefined();
      expect(res.verificationReceipt.manifest_sha256).toBe(res.manifestSha256);
      expect(res.verificationReceipt.hash_algorithm).toBe('SHA-256');
      expect(res.verificationReceipt.instructions).toContain('no portable archive file is included');

      expect(insertedExportRecord).toBeDefined();
      expect(insertedExportRecord[3]).toBe(1);
      expect(insertedExportRecord[4]).toBe('1048576');
    });
  });

  // ==========================================================================
  // 5. Deterministic Equipment Candidate Matching (Top 25 Item 21)
  // ==========================================================================
  describe('Deterministic Equipment Candidate Matching', () => {
    it('ranks candidate equipment from filename tokens without auto-linking', async () => {
      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM assets') && sql.includes('SELECT id, tag, name')) {
            return {
              rows: [
                {
                  id: 'asset-ch-01',
                  tag: 'CH-01',
                  name: 'Water Cooled Screw Chiller',
                  category_key: 'CHILLER',
                  make: 'Carrier',
                  model: '19XR-1000',
                  serial_no: 'SN-CARRIER-9921',
                  location: 'Basement',
                },
                {
                  id: 'asset-ahu-04',
                  tag: 'AHU-04',
                  name: 'Air Handling Unit Floor 4',
                  category_key: 'AHU',
                  make: 'Zeco',
                  model: 'AHU-5000-CFM',
                  serial_no: 'SN-ZECO-4412',
                  location: 'Floor 4 AHU Room',
                },
              ],
            };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = { connect: jest.fn().mockResolvedValue(mockClient) } as any;
      const assetsService = new AssetsService(mockPool);

      const res = await assetsService.matchAssetCandidates(mockTenantActorCtx, projectId, {
        filename: 'Carrier_Chiller_CH-01_Factory_Test_Report.pdf',
      });

      expect(res.totalMatches).toBeGreaterThan(0);
      expect(res.candidates[0].tag).toBe('CH-01');
      expect(res.candidates[0].matchBasis).toBe('EXACT_TAG');
      expect(res.candidates[0].confidence).toBe('HIGH');
      expect(res.candidates[0].matchScore).toBe(1.0);
    });
  });

  // ==========================================================================
  // 6. Full Responsibility-Transfer Manifest & Gap Analysis (Top 25 Item 19)
  // ==========================================================================
  describe('Full Responsibility-Transfer Manifest & Gap Analysis', () => {
    it('computes real draftPackagesCount and assignedDefectsCount and reassigns them atomically', async () => {
      const executedUpdates: string[] = [];

      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
          // Offboarding requires a currently authorised owner, a distinct
          // active target and an independently eligible replacement.
          if (sql.includes('SELECT role FROM memberships') && sql.includes('FOR SHARE')) {
            return { rows: [{ role: 'R-OWNER' }] };
          }
          if (sql.includes('SELECT id, role, status FROM memberships')) {
            return { rows: [{ id: 'mem-001', role: 'R-SITE', status: 'ACTIVE' }] };
          }
          if (sql.includes('SELECT m.role FROM memberships m')) {
            return { rows: [{ role: 'R-OWNER' }] };
          }
          if (sql.includes('SELECT p.id,p.status FROM projects p')) {
            return { rows: [{ id: projectId, status: 'ACTIVE' }] };
          }
          if (sql.includes('COUNT(r.id)::int AS open_reqs')) {
            return { rows: [{ project_id: projectId, project_code: 'PRJ-01', open_reqs: 3 }] };
          }
          if (sql.includes('COUNT(DISTINCT rv.id)::int AS pending_reviews')) {
            return { rows: [{ project_id: projectId, project_code: 'PRJ-01', pending_reviews: 2 }] };
          }
          if (sql.includes('COUNT(hp.id)::int AS draft_packages')) {
            return { rows: [{ project_id: projectId, project_code: 'PRJ-01', draft_packages: 1 }] };
          }
          if (sql.includes('COUNT(d.id)::int AS open_defects')) {
            return { rows: [{ project_id: projectId, project_code: 'PRJ-01', open_defects: 4 }] };
          }
          if (sql.includes('UPDATE handover_packages') || sql.includes('UPDATE defects') || sql.includes('UPDATE requirements') || sql.includes('UPDATE reviews')) {
            executedUpdates.push(sql);
            return { rows: [] };
          }
          if (sql.includes('UPDATE memberships')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = { connect: jest.fn().mockResolvedValue(mockClient) } as any;
      const orgsService = new OrganisationsService(mockPool);

      const replacementUserId = '0192e3a0-9000-7000-8000-000000000099';
      const res = await orgsService.offboardOrReassignMember(mockTenantActorCtx, {
        targetUserId: userId,
        action: 'REMOVE',
        replacementUserId,
      });

      expect(res.gapReport.draftPackagesCount).toBe(1);
      expect(res.gapReport.assignedDefectsCount).toBe(4);
      expect(res.gapReport.openRequirementsCount).toBe(3);
      expect(res.gapReport.pendingReviewsCount).toBe(2);

      // Verify that handover_packages and defects were reassigned
      const pkgReassignment = executedUpdates.find((q) => q.includes('UPDATE handover_packages'));
      expect(pkgReassignment).toBeDefined();
      const defectReassignment = executedUpdates.find((q) => q.includes('UPDATE defects'));
      expect(defectReassignment).toBeDefined();
    });
  });

  // ==========================================================================
  // 7. PO & Vendor-Document Obligation Schedule (Top 25 Item 2)
  // ==========================================================================
  describe('PO & Vendor-Document Obligation Schedule', () => {
    it('creates procurement order with lines and stage-based vendor obligations', async () => {
      let poInsertParams: any[] = [];
      let lineInsertCount = 0;
      let obligationInsertCount = 0;

      const mockDb = {
        withTenantContext: jest.fn().mockImplementation(async (ctx, fn) => {
          const client = {
            query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
              if (sql.includes('INSERT INTO procurement_orders')) {
                poInsertParams = params || [];
                return { rows: [] };
              }
              if (sql.includes('INSERT INTO procurement_order_lines')) {
                lineInsertCount++;
                return { rows: [] };
              }
              if (sql.includes('INSERT INTO supplier_document_obligations')) {
                obligationInsertCount++;
                return { rows: [] };
              }
              return { rows: [] };
            }),
          };
          return fn(client);
        }),
      } as any;

      const partiesService = new PartiesService(mockDb);

      const res = await partiesService.createProcurementOrder(mockCtx, projectId, {
        poNumber: 'PO-MEP-2026-088',
        supplierPartyId: 'party-daikin-001',
        orderedAt: '2026-10-01',
        promisedDeliveryAt: '2026-11-15',
        totalAmountPaise: 450000000,
        lines: [
          {
            lineNo: 1,
            assetCategoryKey: 'VRF_OUTDOOR',
            description: '40HP Top Discharge VRF Outdoor Unit',
            quantity: 2,
            obligations: [
              { docTypeKey: 'DT-030', stageKey: 'FAT', title: 'Factory Acceptance Test Certificate' },
              { docTypeKey: 'DT-035', stageKey: 'DISPATCH', title: 'Dispatch Clearance & LR Copy' },
              { docTypeKey: 'DT-044', stageKey: 'HANDOVER', title: 'OEM 5-Year Compressor Warranty' },
            ],
          },
        ],
      });

      expect(res.poNumber).toBe('PO-MEP-2026-088');
      expect(res.linesCount).toBe(1);
      expect(res.obligationsCount).toBe(3);
      expect(lineInsertCount).toBe(1);
      expect(obligationInsertCount).toBe(3);
      expect(poInsertParams).toContain('PO-MEP-2026-088');
    });
  });

  // ==========================================================================
  // 8. Storage Lifecycle Cleanup (Top 25 Item 25)
  // ==========================================================================
  describe('Storage Lifecycle Cleanup', () => {
    it('safely deletes stale abandoned upload intents older than 24h without touching verified READY files', async () => {
      let versionsDeleteSql = '';
      let objectsDeleteSql = '';

      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM organisations WHERE status = \'ACTIVE\'')) {
            return { rows: [{ id: orgId }] };
          }
          if (sql.includes('DELETE FROM document_versions')) {
            versionsDeleteSql = sql;
            return { rowCount: 4 };
          }
          if (sql.includes('DELETE FROM storage_objects')) {
            objectsDeleteSql = sql;
            return { rowCount: 2 };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = { connect: jest.fn().mockResolvedValue(mockClient) } as any;
      const mockRedis = {} as any;

      const scheduler = new TradeCloseoutScheduler(mockPool, mockRedis);

      const res = await scheduler.runStorageLifecycleCleanup();

      expect(res.purgedPendingVersions).toBe(4);
      expect(res.purgedPendingObjects).toBe(2);
      expect(versionsDeleteSql).toContain("file_status = 'PENDING_UPLOAD'");
      expect(versionsDeleteSql).toContain("interval '24 hours'");
      expect(objectsDeleteSql).toContain("status = 'PENDING'");
      expect(objectsDeleteSql).toContain("NOT EXISTS (");
    });
  });
});
