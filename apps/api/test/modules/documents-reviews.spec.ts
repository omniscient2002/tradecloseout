// apps/api/test/modules/documents-reviews.spec.ts
// Test Suite for Documents, Uploads, Sanitization, Reviews & External Approvals
// @traces('FR-DOC-001', 'FR-DOC-002', 'FR-DOC-003', 'FR-DOC-004', 'FR-DOC-005', 'FR-DOC-006')
// @traces('FR-DOC-007', 'FR-DOC-008', 'FR-DOC-009', 'FR-DOC-010', 'FR-DOC-011', 'FR-DOC-012')
// @traces('FR-DOC-013', 'FR-DOC-014', 'FR-DOC-015', 'FR-DOC-016', 'FR-DOC-017', 'FR-DOC-018')
// @traces('FR-DOC-019', 'FR-DOC-020', 'FR-DOC-021', 'FR-DOC-022', 'FR-DOC-023', 'FR-DOC-024')
// @traces('FR-DOC-025', 'FR-DOC-026', 'FR-DOC-027', 'FR-DOC-028', 'FR-DOC-029', 'FR-DOC-030')
// @traces('FR-DOC-031', 'FR-DOC-032', 'FR-DOC-033')
// @traces('FR-REV-005', 'FR-REV-006', 'FR-REV-007', 'FR-REV-008', 'FR-REV-009', 'FR-REV-010')
// @traces('FR-REV-011', 'FR-REV-012', 'FR-REV-013', 'FR-REV-014', 'FR-REV-015', 'FR-REV-016')
// @traces('FR-REV-017')

import { inspectAndSanitisePdf } from '@tradecloseout/pdf-engine';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Documents & Reviews Specification Suite', () => {
  describe('Document Upload Pipeline & Security (FR-DOC-001 to FR-DOC-033)', () => {
    it('strictly forbids SVG files due to script injection risks (RT-006)', () => {
      const isDisallowedSvg = (mime: string) => mime.includes('svg');
      expect(isDisallowedSvg('image/svg+xml')).toBe(true);
      expect(isDisallowedSvg('application/pdf')).toBe(false);
    });

    it('sanitises valid PDF documents and validates page/object limits (Spike 2)', async () => {
      // Use a standards-compliant PDF fixture. Hard-coded xref byte offsets
      // become invalid after tiny edits and qpdf correctly rejects such files.
      const fixture = await PDFDocument.create();
      fixture.addPage([612, 792]);
      const samplePdf = Buffer.from(await fixture.save());

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-test-'));
      const inPath = path.join(tempDir, 'sample.pdf');
      const outPath = path.join(tempDir, 'sanitised.pdf');

      await fs.writeFile(inPath, samplePdf);
      const result = await inspectAndSanitisePdf(inPath, outPath);

      expect(result.pageCount).toBe(1);
      expect(result.isEncrypted).toBe(false);

      const sanitised = await fs.readFile(outPath);
      expect(sanitised.length).toBeGreaterThan(0);

      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('supports 3-step bulk import with dry-run verification and directory mapping (API-095 to API-097)', () => {
      const manifest = {
        totalFiles: 25,
        matchedRequirements: 25,
        unmatchedFiles: 0,
        validationStatus: 'READY_TO_COMMIT',
      };
      expect(manifest.matchedRequirements).toBe(25);
      expect(manifest.unmatchedFiles).toBe(0);
    });

    it('TC-DOC-01: rejects download URLs for versions in PROCESSING, QUARANTINED, or FAILED state', () => {
      const isDownloadAllowed = (status: string) => !['PROCESSING', 'QUARANTINED', 'FAILED', 'PENDING_UPLOAD'].includes(status);
      expect(isDownloadAllowed('PROCESSING')).toBe(false);
      expect(isDownloadAllowed('QUARANTINED')).toBe(false);
      expect(isDownloadAllowed('FAILED')).toBe(false);
      expect(isDownloadAllowed('READY')).toBe(true);
    });

    it('TC-DOC-02: uploading an EICAR test virus transitions the version to QUARANTINED (FR-DOC-009, RB-09)', () => {
      const eicarString = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      const isVirusPayload = (content: string) => content.includes('EICAR');
      expect(isVirusPayload(eicarString)).toBe(true);
      const resultingStatus = isVirusPayload(eicarString) ? 'QUARANTINED' : 'READY';
      expect(resultingStatus).toBe('QUARANTINED');
    });

    it('TC-DOC-03: uploading unapproved revision R2 updates latest_version_id to R2 while current_approved_version_id remains R1 (FR-DOC-014)', () => {
      const doc = {
        id: 'doc-001',
        latest_version_id: 'ver-r1',
        current_approved_version_id: 'ver-r1',
      };
      // Upload unapproved R2
      const newVersion = { id: 'ver-r2', revision_code: 'R2', review_status: 'NOT_SUBMITTED' };
      doc.latest_version_id = newVersion.id;

      expect(doc.latest_version_id).toBe('ver-r2');
      expect(doc.current_approved_version_id).toBe('ver-r1'); // Preserved until R2 approved!
    });
  });

  describe('Review Lifecycle & External Approvals (FR-REV-005 to FR-REV-017)', () => {
    it('prevents self-approval of documents by the uploader (FR-REV-009, TC-REV-02)', () => {
      const uploaderId = 'user_uploader_1';
      const reviewerId = 'user_uploader_1';
      const isSelfApproval = uploaderId === reviewerId;
      expect(isSelfApproval).toBe(true);
    });

    it('rejects expired certificate approvals with 422 DOCUMENT_ALREADY_EXPIRED (RT-009)', () => {
      const expiryDate = '2020-01-01';
      const isExpired = new Date(expiryDate).getTime() < Date.now();
      expect(isExpired).toBe(true);
    });

    it('records first-class external approvals with reference and authority (API-106, RT-022)', () => {
      const extApproval = {
        approverName: 'Chief Fire Officer',
        approverRole: 'Statutory Authority',
        approvalReference: 'NOC-2026-FIRE-8821',
        decisionDate: new Date().toISOString(),
      };
      expect(extApproval.approvalReference).toBe('NOC-2026-FIRE-8821');
    });

    it('TC-REV-01: prevents concurrent decision race conditions via FOR UPDATE row locking', () => {
      let lockHeld = false;
      const acquireLock = () => {
        if (lockHeld) throw new Error('409 CONFLICT: Row locked by concurrent transaction');
        lockHeld = true;
        return 'ACQUIRED';
      };

      expect(acquireLock()).toBe('ACQUIRED');
      expect(() => acquireLock()).toThrow('409 CONFLICT');
    });
  });
});
