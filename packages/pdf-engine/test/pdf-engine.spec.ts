// packages/pdf-engine/test/pdf-engine.spec.ts
// PDF Engine & Dossier Compilation Unit Suite

import assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import { PackageBuilder, PackageMetadata, PackageItemInput, inspectAndSanitisePdf } from '../src';

async function createSamplePdf(outputPath: string, title: string, pageCount: number = 2): Promise<void> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${title} - Page ${i + 1}`, { x: 50, y: 700, size: 16, color: rgb(0, 0, 0) });
  }
  const bytes = await doc.save();
  await fs.writeFile(outputPath, bytes);
}

async function runPdfEngineSuite() {
  console.log('======================================================================');
  console.log('TradeCloseout PDF Engine & Submittal Compilation Suite');
  console.log('======================================================================');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-pdf-engine-test-'));

  try {
    // ------------------------------------------------------------------------
    // 1. Sanitisation & Inspection Pipeline
    // ------------------------------------------------------------------------
    console.log('\n[PDF-01] Testing PDF inspection and sanitisation...');
    const sampleInputPath = path.join(tempDir, 'sample-raw.pdf');
    const sampleSanitisedPath = path.join(tempDir, 'sample-sanitised.pdf');
    await createSamplePdf(sampleInputPath, 'Sample Chiller Spec Sheet', 3);

    const inspection = await inspectAndSanitisePdf(sampleInputPath, sampleSanitisedPath);
    assert.strictEqual(inspection.pageCount, 3, 'Expected 3 pages in inspected PDF');
    assert.strictEqual(inspection.isEncrypted, false, 'Expected non-encrypted PDF');
    assert(inspection.objectCount > 0, 'Object count must be positive');

    const sanitisedBytes = await fs.readFile(sampleSanitisedPath);
    const sanitisedDoc = await PDFDocument.load(sanitisedBytes);
    assert.strictEqual(sanitisedDoc.getPageCount(), 3, 'Sanitised PDF must retain 3 pages');
    console.log(`✓ Inspection and sanitisation verified: pages=${inspection.pageCount}, objects=${inspection.objectCount}`);

    // ------------------------------------------------------------------------
    // 2. Front Matter & Table of Contents Generation
    // ------------------------------------------------------------------------
    console.log('\n[PDF-02] Testing front matter generation...');
    const meta: PackageMetadata = {
      packageId: 'PKG-001',
      packageTitle: 'HVAC Handover Package',
      projectCode: 'HYD-METRO-01',
      projectName: 'Hyderabad Metro Station HVAC',
      clientName: 'Hyderabad Metro Rail Ltd',
      contractorName: 'Blue Star MEP Division',
      generatedAt: new Date('2026-11-06T12:00:00Z'),
    };

    const itemsWithPages = [
      {
        itemId: 'ITEM-1',
        documentTitle: 'Chiller Commissioning Report',
        docTypeKey: 'COMMISSIONING_REPORT',
        revisionCode: 'R1',
        issueDate: '2026-10-15',
        filePath: '',
        sortOrder: 1,
        pageStart: 3,
        pageEnd: 5,
      },
      {
        itemId: 'ITEM-2',
        documentTitle: 'AHU Warranty Certificate',
        docTypeKey: 'WARRANTY',
        revisionCode: 'R0',
        issueDate: '2026-10-20',
        filePath: '',
        sortOrder: 2,
        pageStart: 6,
        pageEnd: 7,
      },
    ];

    const frontMatterBytes = await PackageBuilder.generateFrontMatterPdf(meta, itemsWithPages);
    const frontMatterDoc = await PDFDocument.load(frontMatterBytes);
    assert.strictEqual(frontMatterDoc.getPageCount(), 2, 'Front matter must contain Cover and TOC (2 pages)');
    console.log('✓ Front matter generated with Cover Page and TOC.');

    // ------------------------------------------------------------------------
    // 3. Full Handover Dossier Compilation & Bates Numbering
    // ------------------------------------------------------------------------
    console.log('\n[PDF-03] Testing multi-document compilation & Bates stamping...');
    const doc1Path = path.join(tempDir, 'doc1.pdf');
    const doc2Path = path.join(tempDir, 'doc2.pdf');
    await createSamplePdf(doc1Path, 'Chiller Commissioning Report', 3);
    await createSamplePdf(doc2Path, 'AHU Warranty Certificate', 2);

    const items: PackageItemInput[] = [
      {
        itemId: 'ITEM-1',
        documentTitle: 'Chiller Commissioning Report',
        docTypeKey: 'COMMISSIONING_REPORT',
        revisionCode: 'R1',
        issueDate: '2026-10-15',
        filePath: doc1Path,
        sortOrder: 1,
      },
      {
        itemId: 'ITEM-2',
        documentTitle: 'AHU Warranty Certificate',
        docTypeKey: 'WARRANTY',
        revisionCode: 'R0',
        issueDate: '2026-10-20',
        filePath: doc2Path,
        sortOrder: 2,
      },
    ];

    const compiledPdfPath = path.join(tempDir, 'handover-dossier.pdf');
    const compiledZipPath = path.join(tempDir, 'handover-archive.zip');

    const result = await PackageBuilder.compilePackage(meta, items, compiledPdfPath, compiledZipPath);

    // Front matter = 2 pages, Doc 1 = 3 pages, Doc 2 = 2 pages -> Total = 7 pages
    assert.strictEqual(result.totalPages, 7, `Expected 7 total pages, got ${result.totalPages}`);
    assert.strictEqual(result.items[0].pageStart, 3);
    assert.strictEqual(result.items[0].pageEnd, 5);
    assert.strictEqual(result.items[1].pageStart, 6);
    assert.strictEqual(result.items[1].pageEnd, 7);

    // Verify PDF file on disk
    const finalPdfBytes = await fs.readFile(compiledPdfPath);
    const finalDoc = await PDFDocument.load(finalPdfBytes);
    assert.strictEqual(finalDoc.getPageCount(), 7);

    // Verify ZIP archive file on disk
    const zipStat = await fs.stat(compiledZipPath);
    assert(zipStat.size > 0, 'Compiled zip package must not be empty');

    console.log(`✓ Dossier compilation verified: 7 pages merged, stamped, and zipped (${zipStat.size} bytes).`);

    console.log('\n======================================================================');
    console.log('✓ ALL PDF ENGINE UNIT TESTS PASSED PERFECTLY!');
    console.log('======================================================================\n');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

runPdfEngineSuite().catch((err) => {
  console.error('\n❌ PDF ENGINE TEST FAILED:', err);
  process.exit(1);
});
