// apps/api/test/phase0-evidence-integrity-remediation.spec.ts
// Comprehensive Test Suite for Phase 0 & Phase 1 Invariants (TC2-001 to TC2-028)

import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { TenantDbService } from '../src/database/tenant-db.service';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';
import { verifyAndScanUploadedFile } from '../../worker/src/queues/file.processor';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

describe('TradeCloseout 2.0 — Evidence Integrity & Transformation Suite', () => {
  const orgId = '0192e3a0-0000-7000-8000-000000000001';
  const projectId = '0192e3a0-1000-7000-8000-000000000002';
  const userId = '0192e3a0-2000-7000-8000-000000000003';

  const mockCtx = {
    orgId,
    userId,
    actorType: 'USER' as const,
    requestId: 'req-test-123',
  };

  const mockTenantActorCtx = {
    orgId,
    userId,
    actorType: 'MEMBER' as const,
    requestId: 'req-test-123',
    ip: '127.0.0.1',
    userAgent: 'jest-test',
  };

  // --------------------------------------------------------------------------
  // TC2-004: Missing Originals Cannot Generate Fake "Certified" PDFs
  // --------------------------------------------------------------------------
  describe('TC2-004: Missing Originals Must Throw NotFoundException', () => {
    it('throws EVIDENCE_OBJECT_NOT_FOUND when file does not exist on disk/storage', async () => {
      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT dv.*, so.object_key')) {
            return {
              rows: [
                {
                  id: '0192e3a0-3000-7000-8000-000000000004',
                  object_key: 'orgs/test/projects/test/missing-chiller-manual.pdf',
                  title: 'Chiller O&M Manual',
                  revision_code: '01',
                  file_status: 'READY',
                  sha256: 'a'.repeat(64),
                  mime: 'application/pdf',
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

      const tenantDb = new (require('../src/database/tenant-db.service').TenantDbService)(mockPool);
      const docService = new DocumentsService(mockPool, tenantDb);
      const mockRes = {
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await expect(
        docService.streamDocumentVersion(mockCtx, '0192e3a0-3000-7000-8000-000000000004', mockRes, projectId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // TC2-001: Upload Completion Transitions to PROCESSING (Never Directly READY)
  // --------------------------------------------------------------------------
  describe('TC2-001: completeUpload transitions to PROCESSING and stages worker scan', () => {
    it('marks file_status as PROCESSING and emits FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN', async () => {
      const executedQueries: Array<{ sql: string; params: any[] }> = [];

      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
          executedQueries.push({ sql, params });
          if (sql.includes('SELECT dv.*, so.id AS storage_id')) {
            return {
              rows: [
                {
                  id: 'ver-123',
                  org_id: orgId,
                  project_id: projectId,
                  storage_id: 'storage-123',
                  file_status: 'PENDING_UPLOAD',
                  storage_size_bytes: '1024',
                  expected_sha256: 'b'.repeat(64),
                  object_key: 'orgs/test/test.pdf',
                  doc_id: 'doc-123',
                  current_approved_version_id: null,
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

      const tenantDb = new (require('../src/database/tenant-db.service').TenantDbService)(mockPool);
      const docService = new DocumentsService(tenantDb, {
        finalizeUpload: jest.fn().mockResolvedValue({ observedSizeBytes: 1024, versionId: 'provider-version' }),
      } as any);
      const res = await docService.completeUpload(mockCtx, 'ver-123', {
        checksumSha256: 'b'.repeat(64),
      });

      expect(res.fileStatus).toBe('PROCESSING');
      expect(res.reviewStatus).toBe('PENDING_REVIEW');

      // Verify UPDATE statement set file_status = 'PROCESSING'
      const updateDvQuery = executedQueries.find(
        (q) => q.sql.includes('UPDATE document_versions') && q.sql.includes('file_status'),
      );
      expect(updateDvQuery).toBeDefined();
      expect(updateDvQuery!.sql).toContain("file_status = 'PROCESSING'");

      // Verify outbox scan event was queued with full payload
      const outboxQuery = executedQueries.find((q) => q.sql.includes('INSERT INTO outbox_events'));
      expect(outboxQuery).toBeDefined();
      expect(outboxQuery!.sql).toContain("'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN'");
      const payload = JSON.parse(outboxQuery!.params[3]);
      expect(payload.versionId).toBe('ver-123');
      expect(payload.orgId).toBe(orgId);
      expect(payload.storageObjectId).toBe('storage-123');
    });
  });

  // --------------------------------------------------------------------------
  // TC2-003: Review Approval Requires Verified READY Status
  // --------------------------------------------------------------------------
  describe('TC2-003: Review approval requires file_status === READY and does not mutate it', () => {
    it('throws ConflictException if approving an unscanned or processing version', async () => {
      const mockPool = {} as any;
      const mockDb = {
        withTenantContext: jest.fn().mockImplementation(async (ctx, fn) => {
          const client = {
            query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
              if (sql.includes('SELECT * FROM reviews')) {
                return {
                  rows: [
                    {
                      id: 'rev-1',
                      org_id: orgId,
                      document_version_id: 'ver-unscanned',
                      status: 'IN_REVIEW',
                      reviewer_subject_type: 'USER', reviewer_subject_id: userId,
                    },
                  ],
                };
              }
              if (sql.includes('SELECT * FROM document_versions')) {
                return {
                  rows: [
                    {
                      id: 'ver-unscanned',
                      org_id: orgId,
                      document_id: 'doc-1',
                      file_status: 'PROCESSING', // Not yet READY!
                      uploaded_by: 'other-user',
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
      await expect(
        reviewsService.decideReview(mockCtx, 'rev-1', {
          decision: 'APPROVE',
          comment: 'Approved by QC',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('approves cleanly without modifying file_status when version is already READY', async () => {
      const mockPool = {} as any;
      const executedQueries: Array<{ sql: string; params: any[] }> = [];

      const mockDb = {
        withTenantContext: jest.fn().mockImplementation(async (ctx, fn) => {
          const client = {
            query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
              executedQueries.push({ sql, params });
              if (sql.includes('SELECT * FROM reviews')) {
                return {
                  rows: [
                    {
                      id: 'rev-2',
                      org_id: orgId,
                      document_version_id: 'ver-ready',
                      status: 'IN_REVIEW',
                      reviewer_subject_type: 'USER', reviewer_subject_id: userId,
                    },
                  ],
                };
              }
              if (sql.includes('SELECT * FROM document_versions')) {
                return {
                  rows: [
                    {
                      id: 'ver-ready',
                      org_id: orgId,
                      document_id: 'doc-1',
                      file_status: 'READY',
                      object_id: 'object-1',
                      uploaded_by: 'other-user',
                    },
                  ],
                };
              }
              if (sql.includes('SELECT * FROM documents')) {
                return {
                  rows: [
                    {
                      id: 'doc-1',
                      org_id: orgId,
                      latest_version_id: 'ver-ready',
                      current_approved_version_id: null,
                    },
                  ],
                };
              }
              if (sql.includes('SELECT 1 FROM storage_objects')) return { rows: [{}] };
              return { rows: [] };
            }),
          };
          return fn(client);
        }),
      } as any;

      const reviewsService = new ReviewsService(mockDb);
      const res = await reviewsService.decideReview(mockCtx, 'rev-2', {
        decision: 'APPROVE',
        comment: 'All checks passed',
      });

      expect(res.decision).toBe('APPROVE');

      // Invariant check: review approval MUST NOT set file_status
      const updateVersionQuery = executedQueries.find(
        (q) => q.sql.includes('UPDATE document_versions') && q.sql.includes("review_status = 'APPROVED'"),
      );
      expect(updateVersionQuery).toBeDefined();
      expect(updateVersionQuery!.sql).not.toContain('file_status');
    });
  });

  // --------------------------------------------------------------------------
  // TC2-002: ClamAV Outage Fails Closed
  // --------------------------------------------------------------------------
  describe('TC2-002: ClamAV outage fails closed (SCAN_UNAVAILABLE)', () => {
    it('retries processing when clamd is unavailable', async () => {
      // Create a temporary valid PDF file on disk
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-av-test-'));
      const testFile = path.join(tmpDir, 'test.pdf');
      await fs.writeFile(testFile, '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

      try {
        // Connect to a port where clamd is guaranteed NOT to be running (e.g. 59999)
        await expect(verifyAndScanUploadedFile(
          testFile,
          'test.pdf',
          '',
          '127.0.0.1',
          59999,
        )).rejects.toThrow('SCAN_UNAVAILABLE');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  // --------------------------------------------------------------------------
  // TC2-011: Handover Recipient Acceptance Vocabularies
  // --------------------------------------------------------------------------
  describe('TC2-011: Handover recipient decision maps valid status enums', () => {
    it('maps ACCEPT to ACCEPTED and ACCEPT_WITH_EXCEPTIONS to PARTIALLY_ACCEPTED', async () => {
      const executedQueries: Array<{ sql: string; params: any[] }> = [];

      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            executedQueries.push({ sql, params });
            if (sql.includes('FROM submissions')) {
              return {
                rows: [{ id: 'sub-1', project_id: projectId, status: 'SUBMITTED', package_id: 'pkg-1' }],
              };
            }
            if (sql.includes('FROM submission_recipients')) {
              return {
                rows: [{ id: 'sr-1', status: 'SENT', recipient_party_id: 'party-consultant', decided_at: null }],
              };
            }
            if (sql.includes('UPDATE submission_recipients')) {
              return { rowCount: 1 };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      } as any;

      const handoverService = new HandoverService(mockPool, {} as any);
      const res = await handoverService.recordRecipientSubmissionDecision(
        mockTenantActorCtx,
        projectId,
        'sub-1',
        {
          recipientPartyId: 'party-consultant',
          decision: 'ACCEPT_WITH_EXCEPTIONS',
          remarks: 'Minor punchlist pending on cooling tower balancing',
        },
      );

      expect(res.status).toBe('PARTIALLY_ACCEPTED');

      const updateRec = executedQueries.find((q) => q.sql.includes('UPDATE submission_recipients'));
      expect(updateRec).toBeDefined();
      expect(updateRec!.params[3]).toBe('ACCEPTED_WITH_EXCEPTIONS');
    });
  });

  // --------------------------------------------------------------------------
  // TC2-012: Project Closure Gates
  // --------------------------------------------------------------------------
  describe('TC2-012: Project closure requires HANDOVER status and accepted submissions', () => {
    it('rejects closing a project in ACTIVE status without overrideReason', async () => {
      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id, status, row_version FROM projects')) {
              return { rows: [{ id: projectId, status: 'ACTIVE', row_version: 1 }] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      } as any;

      const projectsService = new ProjectsService(mockPool);
      await expect(
        projectsService.closeProject(mockTenantActorCtx, projectId),
      ).rejects.toThrow(ConflictException);
    });
  });

  // --------------------------------------------------------------------------
  // TC2-016: Defect Creation Severity & Timestamp Reconciliation
  // --------------------------------------------------------------------------
  describe('TC2-016: Defect creation severity mapping and raised_at ordering', () => {
    it('maps MINOR severity to LOW and queries raised_at', async () => {
      const executedQueries: Array<{ sql: string; params: any[] }> = [];

      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
            executedQueries.push({ sql, params });
            if (sql.includes('SELECT d.*, a.tag AS asset_tag')) {
              return { rows: [{ id: 'def-1', title: 'Damper stuck', raised_at: new Date() }] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      } as any;

      const billingService = new WarrantyAndBillingService(mockPool);

      // Test createDefect
      const res = await billingService.createDefect(
        mockTenantActorCtx,
        projectId,
        {
          title: 'Damper stuck in shaft 3',
          severity: 'MINOR',
          location: 'Floor 4 AHU Room',
        },
      );

      expect(res.status).toBe('OPEN');
      expect(res.severity).toBe('LOW');

      const insertDefect = executedQueries.find((q) => q.sql.includes('INSERT INTO defects'));
      expect(insertDefect).toBeDefined();
      expect(insertDefect!.sql).toContain('raised_at');
      expect(insertDefect!.sql).not.toContain('created_at');
      expect(insertDefect!.params[6]).toBe('LOW');

      // Test listDefects
      await billingService.listDefects(
        mockTenantActorCtx,
        projectId,
      );
      const listQuery = executedQueries.find((q) => q.sql.includes('ORDER BY d.raised_at DESC'));
      expect(listQuery).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // TC2-006: Supplier Upload Grant Scoping and uploaded_by_grant_id
  // --------------------------------------------------------------------------
  describe('TC2-006: Supplier Guest Upload Authorization', () => {
    it('rejects guest upload when target requirement is not in grant scope', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: mockClient.query,
          release: jest.fn(),
        }),
      } as any;
      const tenantDb = new TenantDbService(mockPool);
      const documentsService = new DocumentsService(tenantDb);

      const guestCtx = {
        ...mockCtx,
        actorType: 'GUEST' as const,
        guestGrantId: '0192e3a0-guest-grant-0001',
        guestScope: {
          requirementIds: ['0192e3a0-req-allowed-1', '0192e3a0-req-allowed-2'],
        },
      };

      await expect(
        documentsService.createUploadIntent(guestCtx as any, projectId, {
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          fileName: 'valve-datasheet.pdf',
          requirementId: '0192e3a0-req-unassigned-99',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('attributes guest uploads to uploaded_by_grant_id and leaves uploaded_by null', async () => {
      const executedQueries: Array<{ sql: string; params: any[] }> = [];
      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
          executedQueries.push({ sql, params });
          if (sql.includes('SELECT scope_json, capabilities FROM guest_grants')) {
            return { rows: [{ scope_json: { requirementIds: ['0192e3a0-req-allowed-1'] }, capabilities: ['document.upload'] }] };
          }
          if (sql.includes('SELECT id, doc_type_key FROM requirements')) {
            return { rows: [{ id: '0192e3a0-req-allowed-1', doc_type_key: 'DT-043' }] };
          }
          if (sql.includes('SELECT COALESCE(MAX(version_no)')) {
            return { rows: [{ max_v: 0 }] };
          }
          return { rows: [] };
        }),
      };
      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: mockClient.query,
          release: jest.fn(),
        }),
      } as any;
      const tenantDb = new TenantDbService(mockPool);
      const documentsService = new DocumentsService(tenantDb, {
        createUploadUrls: jest.fn().mockResolvedValue({ uploadId: null, partSizeBytes: 2048, parts: [] }),
      } as any);

      const grantId = '0192e3a0-guest-grant-0001';
      const allowedReqId = '0192e3a0-req-allowed-1';
      const guestCtx = {
        ...mockCtx,
        actorType: 'GUEST' as const,
        guestGrantId: grantId,
        guestScope: { requirementIds: [allowedReqId] },
      };

      const res = await documentsService.createUploadIntent(guestCtx as any, projectId, {
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        fileName: 'damper-cert.pdf',
        requirementId: allowedReqId,
      });

      expect(res.versionId).toBeDefined();

      const insertVersion = executedQueries.find((q) => q.sql.includes('INSERT INTO document_versions'));
      expect(insertVersion).toBeDefined();
      expect(insertVersion!.sql).toContain('uploaded_by_grant_id');
      // Parameter 10 is uploaded_by (should be null for guest), Parameter 11 is uploaded_by_grant_id
      expect(insertVersion!.params[10]).toBeNull();
      expect(insertVersion!.params[11]).toBe(grantId);
    });
  });

  // --------------------------------------------------------------------------
  // TC2-009: Real AWS SigV4 Storage Presigner
  // --------------------------------------------------------------------------
  describe('TC2-009: AWS SigV4 Storage Presigner', () => {
    it('generates HMAC-SHA256 signed presigned upload and download URLs', async () => {
      const original = { bucket: process.env.S3_BUCKET, key: process.env.S3_ACCESS_KEY, secret: process.env.S3_SECRET_KEY };
      process.env.S3_BUCKET = 'test-evidence-bucket';
      process.env.S3_ACCESS_KEY = 'test-access-key';
      process.env.S3_SECRET_KEY = 'test-secret-key';
      try {
      const { S3StorageService } = await import('../src/modules/documents/s3-storage.service');
      const storage = new S3StorageService();

      const uploadResult = await storage.createUploadUrls({
        objectKey: 'orgs/test/projects/p1/doc.pdf',
        sizeBytes: 1024,
      });

      expect(uploadResult.parts).toHaveLength(1);
      const uploadUrl = uploadResult.parts[0].uploadUrl;
      expect(uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(uploadUrl).toContain('X-Amz-Signature=');
      expect(uploadUrl).toContain('X-Amz-Expires=3600');

      const downloadUrl = await storage.createSignedDownloadUrl({
        objectKey: 'orgs/test/projects/p1/doc.pdf',
        filename: 'cert.pdf',
      });

      expect(downloadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(downloadUrl).toContain('response-content-disposition=attachment');
      expect(downloadUrl).toContain('X-Amz-Signature=');
      } finally {
        if (original.bucket === undefined) delete process.env.S3_BUCKET; else process.env.S3_BUCKET = original.bucket;
        if (original.key === undefined) delete process.env.S3_ACCESS_KEY; else process.env.S3_ACCESS_KEY = original.key;
        if (original.secret === undefined) delete process.env.S3_SECRET_KEY; else process.env.S3_SECRET_KEY = original.secret;
      }
    });
  });

  // --------------------------------------------------------------------------
  // TC2-034: Equipment Passports & Commercial Readiness Projections
  // --------------------------------------------------------------------------
  describe('TC2-034: Equipment Passport and Commercial Readiness Projections', () => {
    it('projects comprehensive equipment passport with warranty, compliance, and defects', async () => {
      const { AssetsService } = await import('../src/modules/assets/assets.service');
      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT * FROM assets')) {
              return {
                rows: [
                  {
                    id: '0192e3a0-asset-1',
                    tag: 'CH-01',
                    name: 'Trane 450 TR Chiller',
                    warranty_start: '2026-01-01',
                    warranty_end: '2028-01-01',
                    warranty_start_basis: 'HANDOVER',
                  },
                ],
              };
            }
            if (sql.includes('SELECT d.id AS document_id')) {
              return {
                rows: [
                  {
                    document_id: 'doc-1',
                    review_status: 'APPROVED',
                    title: 'Factory Test Report',
                  },
                ],
              };
            }
            if (sql.includes('SELECT r.id, r.requirement_key')) {
              return {
                rows: [
                  {
                    id: 'req-1',
                    requirement_key: 'CH-01-DT025',
                    mandatory: true,
                    status: 'APPROVED',
                    has_qualified_evidence: true,
                  },
                ],
              };
            }
            if (sql.includes('SELECT * FROM warranty_events')) {
              return { rows: [] };
            }
            if (sql.includes('SELECT d.*, u.name AS raised_by_name FROM defects')) {
              return { rows: [] };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      } as any;

      const assetsService = new AssetsService(mockPool);
      const passport = await assetsService.getEquipmentPassport(
        mockTenantActorCtx,
        projectId,
        '0192e3a0-asset-1',
      );

      expect(passport.asset.tag).toBe('CH-01');
      expect(passport.warranty.isUnderWarranty).toBe(true);
      expect(passport.warranty.remainingDays).toBeGreaterThan(0);
      expect(passport.readiness.readinessPercentage).toBe(100);
      expect(passport.readiness.approvedDocumentsCount).toBe(1);
      expect(passport.readiness.isDlpReady).toBe(true);
    });

    it('evaluates commercial readiness and gates retention release on accepted handover and 0 defects', async () => {
      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT p.id, p.name')) {
              return {
                rows: [
                  {
                    id: projectId,
                    name: 'Phoenix Mall MEP',
                    status: 'HANDOVER',
                    contract_value_paise: '500000000',
                    retention_at_risk_paise: '25000000',
                  },
                ],
              };
            }
            if (sql.includes('COUNT(*) FILTER (WHERE mandatory = true)')) {
              return {
                rows: [
                  {
                    total_mandatory: '10',
                    satisfied_mandatory: '10',
                    pending_mandatory: '0',
                  },
                ],
              };
            }
            if (sql.includes('FROM defects')) {
              return {
                rows: [
                  {
                    open_defects: '0',
                    critical_defects: '0',
                  },
                ],
              };
            }
            if (sql.includes('SELECT s.id, s.status, s.package_id')) {
              return {
                rows: [{ id: 'sub-accepted-1', status: 'ACCEPTED' }],
              };
            }
            return { rows: [] };
          }),
          release: jest.fn(),
        }),
      } as any;

      const billingService = new WarrantyAndBillingService(mockPool);
      const readiness = await billingService.getCommercialReadiness(mockTenantActorCtx, projectId);

      expect(readiness.commercialReadiness.isRetentionEligible).toBe(true);
      expect(readiness.commercialReadiness.releaseStatus).toBe('ELIGIBLE');
      expect(readiness.mandatoryRequirements.satisfactionPercentage).toBe(100);
      expect(readiness.handover.hasAcceptedSubmission).toBe(true);
    });
  });
});
