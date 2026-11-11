// apps/api/test/perfect-10-remediation.spec.ts
// Comprehensive Test Suite for the 5 Technical Bug Fixes & 5 Business/Domain Enhancements

import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import {
  evaluateCatalogueApplicability,
  HVAC_APPLICABILITY_RULES,
  ProjectApplicabilityContext,
  withSavepoint,
} from '@tradecloseout/db';
import { executeReviewDecision } from '../src/modules/reviews/review-decision.service';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { SupplierGuestService } from '../src/modules/parties/supplier-guest.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { DigitalSignatureService } from '../src/modules/signatures/digital-signature.service';
import { PDFDocument } from 'pdf-lib';
import { injectPdfBookmarks } from '@tradecloseout/pdf-engine';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Perfect 10 Remediation & Hardening Test Suite', () => {
  const orgId = '0192e3a0-0000-7000-8000-000000000001';
  const projectId = '0192e3a0-1000-7000-8000-000000000002';
  const userId = '0192e3a0-2000-7000-8000-000000000003';

  // --------------------------------------------------------------------------
  // FIX 1 & Bug 5: Deterministic Condition DSL Evaluator (R-001..R-013)
  // --------------------------------------------------------------------------
  describe('Fix 1 & Bug 5: Deterministic Condition DSL Evaluator', () => {
    it('should include mandatory items unconditionally and filter conditional items by rules', () => {
      const catalogue = [
        { code: 'DT-001', title: 'As-Built Drawings', obligation: 'M' as const },
        { code: 'DT-030', title: 'Chiller FAT Report', obligation: 'C' as const },
        { code: 'DT-041', title: 'Cleanroom Room Pressure', obligation: 'C' as const },
        { code: 'DT-018', title: 'BMS Point Schedule', obligation: 'C' as const },
        { code: 'DT-068', title: 'DLP Closure Certificate', obligation: 'C' as const },
      ];

      // Context 1: Commercial Office without cleanroom or BMS
      const ctxOffice: ProjectApplicabilityContext = {
        projectType: 'PRIVATE_COMMERCIAL',
        clientType: 'PRIVATE',
        contractHasBms: false,
        contractDlpMonths: 12,
        maxRefrigerantChargeKg: 10,
        consultantRequiresStampedDrawings: false,
        presentAssetCategories: ['CHILLER'],
      };

      const resultOffice = evaluateCatalogueApplicability(catalogue, ctxOffice);
      const officeCodes = resultOffice.map((r) => r.code);

      expect(officeCodes).toContain('DT-001'); // Mandatory
      expect(officeCodes).toContain('DT-030'); // Chiller rule R-001
      expect(officeCodes).toContain('DT-068'); // DLP rule R-009 (DLP > 0)
      expect(officeCodes).not.toContain('DT-041'); // Cleanroom rule R-003 excluded!
      expect(officeCodes).not.toContain('DT-018'); // BMS rule R-005 excluded!

      // Context 2: Hospital with Cleanroom and BMS
      const ctxHospital: ProjectApplicabilityContext = {
        projectType: 'HOSPITAL',
        clientType: 'GOVERNMENT',
        contractHasBms: true,
        contractDlpMonths: 24,
        maxRefrigerantChargeKg: 50,
        consultantRequiresStampedDrawings: true,
        presentAssetCategories: ['CHILLER', 'FIRE_DAMPER'],
      };

      const resultHospital = evaluateCatalogueApplicability(catalogue, ctxHospital);
      const hospitalCodes = resultHospital.map((r) => r.code);

      expect(hospitalCodes).toContain('DT-001');
      expect(hospitalCodes).toContain('DT-030');
      expect(hospitalCodes).toContain('DT-041'); // Cleanroom included for Hospital
      expect(hospitalCodes).toContain('DT-018'); // BMS included
      expect(hospitalCodes).toContain('DT-068'); // DLP included
    });
  });

  // --------------------------------------------------------------------------
  // FIX 2 & Bug 1: 1-to-Many Document Approval Deadlock Resolution
  // --------------------------------------------------------------------------
  describe('Fix 2 & Bug 1: 1-to-Many Document Approval (FR-DOC-011)', () => {
    it('approves the document version without approving linked requirements', async () => {
      const docVerId = uuidv7();
      const docId = uuidv7();
      const reqId1 = uuidv7();
      const reqId2 = uuidv7();
      const reqId3 = uuidv7();

      const executedQueries: Array<{ sql: string; params: any[] }> = [];

      const mockClient = {
        query: jest.fn(async (sql: string, params: any[] = []) => {
          executedQueries.push({ sql, params });
          if (sql.includes('SELECT dv.id, dv.document_id')) {
            // Return 3 rows simulating a document linked to 3 separate requirements
            return {
              rows: [
                {
                  id: docVerId,
                  document_id: docId,
                  version_no: 1,
                  file_status: 'READY',
                  review_status: 'IN_REVIEW',
                  uploaded_by: 'another-user',
                  row_version: 1,
                  current_approved_version_id: null,
                  requirement_id: reqId1,
                  reviewer_role: 'R-PM',
                  req_status: 'IN_REVIEW',
                },
                {
                  id: docVerId,
                  document_id: docId,
                  version_no: 1,
                  file_status: 'READY',
                  review_status: 'IN_REVIEW',
                  uploaded_by: 'another-user',
                  row_version: 1,
                  current_approved_version_id: null,
                  requirement_id: reqId2,
                  reviewer_role: 'R-PM',
                  req_status: 'IN_REVIEW',
                },
                {
                  id: docVerId,
                  document_id: docId,
                  version_no: 1,
                  file_status: 'READY',
                  review_status: 'IN_REVIEW',
                  uploaded_by: 'another-user',
                  row_version: 1,
                  current_approved_version_id: null,
                  requirement_id: reqId3,
                  reviewer_role: 'R-PM',
                  req_status: 'IN_REVIEW',
                },
              ],
            };
          }
          if (sql.includes('SELECT id FROM document_versions WHERE org_id = $1')) {
            return { rows: [] }; // No newer superseding version
          }
          return { rows: [] };
        }),
      } as unknown as PoolClient;

      const result = await executeReviewDecision(
        mockClient,
        {
          userId,
          activeOrgId: orgId,
          orgRole: 'R-PM',
          projectRoles: ['R-PM'],
          ip: '127.0.0.1',
          userAgent: 'test',
          requestId: 'req-01',
        },
        {
          projectId,
          documentVersionId: docVerId,
          expectedRowVersion: 1,
          method: 'IN_APP',
          decision: 'APPROVE',
        },
      );

      expect(result.documentVersionStatus).toBe('APPROVED');
      // Approving a document revision must not mark every linked requirement satisfied.
      const requirementStatusUpdate = executedQueries.find((q) =>
        q.sql.includes('UPDATE requirements') && q.sql.includes("status = 'APPROVED'"),
      );
      expect(requirementStatusUpdate).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // FIX 3 & Bug 2: Quota Soft Check & Accurate Storage Reconciliation
  // --------------------------------------------------------------------------
  describe('Fix 3 & Bug 2: Accurate Storage Quota Reconciliation', () => {
    it('createUploadIntent performs soft check and rejects when ceiling exceeded', async () => {
      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('SELECT uc.value AS current_storage')) {
              return Promise.resolve({
                rows: [
                  {
                    current_storage: '950000000', // ~950 MB used
                    limits_json: { maxStorageBytes: 1000000000 }, // 1 GB ceiling
                  },
                ],
              });
            }
            return Promise.resolve({ rows: [] });
          }),
          release: jest.fn(),
        }),
      };

      const docService = new DocumentsService(mockPool as any);
      const ctx = {
        orgId,
        userId,
        actorType: 'USER' as const,
        ip: '127.0.0.1',
        userAgent: 'test',
        requestId: 'req-1',
      };

      // Uploading 80 MB when only 50 MB is remaining should be rejected by soft check
      try {
        await docService.createUploadIntent(ctx, projectId, {
          mimeType: 'application/pdf',
          sizeBytes: 80 * 1024 * 1024,
          fileName: 'large-chiller-manual.pdf',
        });
        fail('Expected to throw');
      } catch (err: any) {
        expect(err.getResponse()).toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
      }
    });

    it('deleteDocument refunds storage bytes of ready files', async () => {
      const docId = uuidv7();
      let quotaDeducted = false;

      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation((sql: string, params: any[]) => {
            if (sql.includes('UPDATE documents') && sql.includes('deleted_at = now()')) {
              return Promise.resolve({ rows: [{ id: docId }] });
            }
            if (sql.includes('SELECT COALESCE(SUM(so.size_bytes), 0) AS total_bytes')) {
              return Promise.resolve({ rows: [{ total_bytes: '52428800' }] }); // 50 MB
            }
            if (sql.includes('UPDATE usage_counters') && sql.includes('STORAGE_BYTES')) {
              quotaDeducted = true;
              return Promise.resolve({ rows: [] });
            }
            return Promise.resolve({ rows: [] });
          }),
          release: jest.fn(),
        }),
      };

      const docService = new DocumentsService(mockPool as any);
      const ctx = {
        orgId,
        userId,
        actorType: 'USER' as const,
        ip: '127.0.0.1',
        userAgent: 'test',
        requestId: 'req-2',
      };

      const res = await docService.deleteDocument(ctx, docId);
      expect(res.deleted).toBe(true);
      expect(res.refundedBytes).toBe(52428800);
      expect(quotaDeducted).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // FIX 4 & Bug 3: Hierarchical PDF Bookmarks (/Outlines) post-merge
  // --------------------------------------------------------------------------
  describe('Fix 4 & Bug 3: Hierarchical PDF Bookmarks (/Outlines) in Qpdf Merges', () => {
    it('injectPdfBookmarks attaches valid Outlines dictionary with jump destinations', async () => {
      const tmpPdfPath = path.join(os.tmpdir(), `test-bookmark-${Date.now()}.pdf`);

      // 1. Create a dummy 3-page PDF
      const doc = await PDFDocument.create();
      doc.addPage([595, 842]);
      doc.addPage([595, 842]);
      doc.addPage([595, 842]);
      await writeFile(tmpPdfPath, await doc.save());

      try {
        // 2. Inject bookmarks
        const bookmarks = [
          { title: 'Section 00: Cover Page', pageIndex: 0 },
          { title: 'Section 01: Master Register', pageIndex: 1 },
          { title: 'Section 02: Chiller FAT Report', pageIndex: 2 },
        ];

        await injectPdfBookmarks(tmpPdfPath, bookmarks);

        // 3. Inspect modified PDF to ensure Outlines exists
        const modifiedBytes = await readFile(tmpPdfPath);
        const verifiedDoc = await PDFDocument.load(modifiedBytes);

        const catalog = verifiedDoc.catalog;
        const outlinesRef = catalog.get(verifiedDoc.context.obj('Outlines') as any);
        expect(outlinesRef).toBeDefined();

        const outlinesDict = verifiedDoc.context.lookup(outlinesRef) as any;
        expect(outlinesDict).toBeDefined();
        expect(Number(outlinesDict.get(verifiedDoc.context.obj('Count') as any))).toBe(3);
      } finally {
        await unlink(tmpPdfPath).catch(() => undefined);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 1: SAVEPOINT support in withTenantTransaction
  // --------------------------------------------------------------------------
  describe('Dimension 1: SAVEPOINT Support (Zero 25P02 Transaction Block Aborts)', () => {
    it('withSavepoint rolls back sub-operation error without aborting outer transaction', async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql === 'SAVEPOINT sp_test') return Promise.resolve();
          if (sql === 'ROLLBACK TO SAVEPOINT sp_test') return Promise.resolve();
          if (sql === 'RELEASE SAVEPOINT sp_test') return Promise.resolve();
          if (sql.includes('FAIL_QUERY')) throw new Error('Simulated SQL error');
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as PoolClient;

      // Executing a failing sub-operation inside withSavepoint catches error and rolls back only to savepoint
      await expect(
        withSavepoint(mockClient, 'sp_test', async () => {
          await mockClient.query('FAIL_QUERY');
        }),
      ).rejects.toThrow('Simulated SQL error');

      expect(mockClient.query).toHaveBeenCalledWith('SAVEPOINT sp_test');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT sp_test');
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 3: Bulk ZIP Importer Security Guards (SCR-055)
  // --------------------------------------------------------------------------
  describe('Dimension 3: Bulk ZIP Importer Security Guards', () => {
    const docService = new DocumentsService({} as any);

    it('rejects ZIP-Slip path traversal attempts (../)', () => {
      const maliciousEntries = [
        { entryName: 'valid.pdf', uncompressedSize: 1000, compressedSize: 800 },
        { entryName: '../../etc/passwd', uncompressedSize: 500, compressedSize: 400 },
      ];

      try {
        docService.validateZipArchiveSecurity(maliciousEntries);
        fail('Expected validateZipArchiveSecurity to throw');
      } catch (err: any) {
        expect(err.getResponse()).toMatchObject({ code: 'ZIP_SLIP_PATH_TRAVERSAL_DETECTED' });
      }
    });

    it('rejects ZIP-Bomb with decompression ratio > 50:1', () => {
      const zipBombEntries = [
        { entryName: 'huge_sparse.pdf', uncompressedSize: 60 * 1024 * 1024, compressedSize: 1000 },
      ];

      try {
        docService.validateZipArchiveSecurity(zipBombEntries);
        fail('Expected validateZipArchiveSecurity to throw');
      } catch (err: any) {
        expect(err.getResponse()).toMatchObject({ code: 'ZIP_BOMB_DETECTED' });
      }
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 7: Do not claim signature capability without a verified provider.
  // --------------------------------------------------------------------------
  describe('Dimension 7: Cryptographic signature fail-closed behaviour', () => {
    it('does not prepare a fake PDF signature placeholder or embed caller-supplied bytes', async () => {
      const sigService = new DigitalSignatureService({} as any);
      await expect(sigService.injectByteRangePlaceholder(Buffer.from('%PDF-'), {
        signerName: 'Vikramaditya Reddy',
      })).rejects.toMatchObject({
        response: { code: 'PDF_SIGNATURE_PREPARATION_UNAVAILABLE' },
      });
      expect(() => sigService.embedPkcs7Signature(Buffer.from('%PDF-'), '308201')).toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Business Risk 2: Two-Tier Supplier Link Friction & Project PIN
  // --------------------------------------------------------------------------
  describe('Business Risk 2: Two-Tier Supplier Link Friction', () => {
    it('creates an OTP-protected supplier upload link without a project PIN', async () => {
      const reqId = uuidv7();
      const partyId = uuidv7();

      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('SELECT status FROM projects')) {
              return Promise.resolve({ rows: [{status:'ACTIVE'}] });
            }
            if (sql.includes('SELECT id, requirement_key')) {
              return Promise.resolve({ rows: [{ id: reqId, requirement_key: 'CHLR-FAT', title: 'FAT' }] });
            }
            if (sql.includes('SELECT email')) {
              return Promise.resolve({ rows: [{ email: 'oem@carrier.in', phone: '+919848011100', status: 'ACTIVE', deleted_at: null }] });
            }
            return Promise.resolve({ rows: [] });
          }),
          release: jest.fn(),
        }),
      };

      const guestService = new SupplierGuestService(mockPool as any);
      const ctx = {
        orgId,
        userId,
        actorType: 'MEMBER' as const,
        orgRole: 'R-PROC', // explicitly authorized supplier-link issuer
        ip: '127.0.0.1',
        userAgent: 'test',
        requestId: 'req-link',
      };

      const linkResult = await guestService.createScopedSupplierUploadLink(ctx, projectId, {
        supplierPartyId: partyId,
        requirementIds: [reqId],
      });

      expect(linkResult.otpRequired).toBe(true);
      expect(linkResult.projectPin).toBe('OTP required');
      expect(decodeURIComponent(linkResult.whatsappDeepLink)).not.toContain('Project PIN:');
    });
  });

  // --------------------------------------------------------------------------
  // Business Risk 3: Submittal Transmittal Pack Generator (DT-079)
  // --------------------------------------------------------------------------
  describe('Business Risk 3: Outbound Transmittal Generation & Stamp-Back Loop', () => {
    it('generates a numbered transmittal without claiming an unimplemented QR verification payload', async () => {
      const docId1 = uuidv7();
      const docId2 = uuidv7();

      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('SELECT code, name FROM projects')) {
              return Promise.resolve({ rows: [{ code: 'PRJ-HYD-04', name: 'Hyderabad Tech Park' }] });
            }
            if (sql.includes('SELECT d.id AS document_id')) {
              return Promise.resolve({
                rows: [
                  { document_id: docId1, title: 'Chiller Test', doc_type_key: 'DT-030', version_id: 'v1', version_no: 1, revision_code: 'R0', file_status: 'READY' },
                  { document_id: docId2, title: 'AHU Test', doc_type_key: 'DT-031', version_id: 'v2', version_no: 1, revision_code: 'R0', file_status: 'READY' },
                ],
              });
            }
            return Promise.resolve({ rows: [] });
          }),
          release: jest.fn(),
        }),
      };

      const docService = new DocumentsService(mockPool as any);
      const ctx = {
        orgId,
        userId,
        actorType: 'USER' as const,
        ip: '127.0.0.1',
        userAgent: 'test',
        requestId: 'req-trn',
      };

      const transmittal = await docService.generateSubmittalTransmittalPack(ctx, projectId, [docId1, docId2]);

      expect(transmittal.transmittalNo).toMatch(/^TRN-PRJ-HYD-04-\d+$/);
      expect(transmittal.documentCount).toBe(2);
      expect(transmittal.items[0]).not.toHaveProperty('qrPayload');
      expect(transmittal.items[1]).not.toHaveProperty('qrPayload');
    });
  });

  // --------------------------------------------------------------------------
  // Business Risk 4: Monthly RA Bill Evidence Pack Generator
  // --------------------------------------------------------------------------
  describe('Business Risk 4: Monthly RA Bill Evidence Pack Generator', () => {
    it('compiles evidence pack scoped strictly to billing milestone_key', async () => {
      const reqId = uuidv7();
      const mockPool = {
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('SELECT r.id, r.requirement_key') && sql.includes('r.milestone_key = $3')) {
              return Promise.resolve({
                rows: [
                  {
                    id: reqId,
                    requirement_key: 'CHLR-FAT',
                    scope_key: 'project',
                    title: 'Chiller Factory Acceptance Test',
                    doc_type_key: 'DT-030',
                    mandatory: true,
                    status: 'APPROVED',
                    milestone_key: 'DELIVERY',
                    document_id: 'doc-1',
                    document_title: 'Chiller FAT Report',
                    version_id: 'v-1',
                    version_no: 1,
                    revision_code: 'R0',
                    storage_object_id: 'so-1',
                    size_bytes: 1048576,
                    sha256: 'abc123',
                    asset_tag: 'CHLR-01',
                  },
                ],
              });
            }
            if (sql.includes('SELECT id, checksum FROM checklist_snapshots')) {
              return Promise.resolve({ rows: [{ id: 'snap-1', checksum: 'sha-snap' }] });
            }
            if (sql.includes('SELECT COALESCE(MAX(version_no), 0)')) {
              return Promise.resolve({ rows: [{ max_ver: 0 }] });
            }
            return Promise.resolve({ rows: [] });
          }),
          release: jest.fn(),
        }),
      };

      const handoverService = new HandoverService(mockPool as any, {} as any);
      const ctx = {
        orgId,
        userId,
        actorType: 'MEMBER' as const,
        ip: '127.0.0.1',
        userAgent: 'test',
        requestId: 'req-ra',
      };

      const raPack = await handoverService.compileRaBillEvidencePack(ctx, projectId, {
        milestoneKey: 'DELIVERY',
        billNumber: 'RA-BILL-05',
        billAmountInr: 18000000,
      });

      expect(raPack.billNumber).toBe('RA-BILL-05');
      expect(raPack.milestoneKey).toBe('DELIVERY');
      expect(raPack.includedRequirementsCount).toBe(1);
      expect(raPack.items[0].requirementKey).toBe('CHLR-FAT');
    });
  });

  // --------------------------------------------------------------------------
  // Business Risk 5: Single-Project Closeout Pass Plan (interval = ONE_TIME_PROJECT)
  // --------------------------------------------------------------------------
  describe('Business Risk 5: Single-Project Closeout Pass Pricing', () => {
    it('listPlans returns Single-Project Closeout Pass with interval ONE_TIME_PROJECT', async () => {
      const billingService = new BillingService({
        getPool: () => ({
          query: async () => ({ rows: [{
            id: '0192e3a0-3000-7000-8000-000000000004',
            code: 'PROJECT_PASS', name: 'Configured single-project pass',
            price_paise: '2499900', interval: 'ONE_TIME_PROJECT',
            limits_json: { maxActiveProjects: 1 },
          }] }),
        }),
      } as any);
      const plans = await billingService.listPlans();

      const projectPass = plans.find((p) => p.code === 'PROJECT_PASS');
      expect(projectPass).toBeDefined();
      expect(projectPass?.billingPeriod).toBe('ONE_TIME_PROJECT');
      expect(projectPass?.priceInr).toBe(24999);
      expect(projectPass?.maxProjects).toBe(1);
    });
  });
});
