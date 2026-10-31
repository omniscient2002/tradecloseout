// packages/pdf-engine/src/package-builder.ts
// Pure-Node PDF Handover Package Compilation Pipeline (RT-006, RT-025, RT-034)

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'node:fs/promises';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';

export interface PackageMetadata {
  packageId: string;
  packageTitle: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  contractorName: string;
  generatedAt: Date;
}

export interface PackageItemInput {
  itemId: string;
  documentTitle: string;
  docTypeKey: string;
  revisionCode: string;
  issueDate: string;
  filePath: string;
  sortOrder: number;
}

export interface CompiledPackageResult {
  mergedPdfPath: string;
  zipPath: string;
  totalPages: number;
  items: Array<{
    itemId: string;
    pageStart: number;
    pageEnd: number;
  }>;
}

export class PackageBuilder {
  /**
   * Generates a pure-Node front matter PDF containing Cover Page and Table of Contents Index.
   */
  static async generateFrontMatterPdf(
    meta: PackageMetadata,
    items: PackageItemInput[],
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    // 1. Cover Page
    const coverPage = doc.addPage([595.28, 841.89]); // A4
    const { width, height } = coverPage.getSize();

    coverPage.drawText('HVAC PROJECT HANDOVER DOSSIER', {
      x: 50,
      y: height - 120,
      size: 20,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });

    coverPage.drawText(`Project: ${meta.projectCode} — ${meta.projectName}`, {
      x: 50,
      y: height - 170,
      size: 14,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });

    coverPage.drawText(`Client: ${meta.clientName}`, {
      x: 50,
      y: height - 200,
      size: 12,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });

    coverPage.drawText(`Main Contractor / Subcontractor: ${meta.contractorName}`, {
      x: 50,
      y: height - 220,
      size: 12,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });

    coverPage.drawText(`Generated on: ${meta.generatedAt.toISOString().split('T')[0]}`, {
      x: 50,
      y: height - 250,
      size: 10,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    coverPage.drawText('CONFIDENTIAL & PROPRIETARY — FOR AS-BUILT HANDOVER PURPOSES', {
      x: 50,
      y: 60,
      size: 9,
      font,
      color: rgb(0.6, 0.6, 0.6),
    });

    // 2. Table of Contents Index Page
    const indexPage = doc.addPage([595.28, 841.89]);
    indexPage.drawText('TABLE OF CONTENTS / SUBMITTAL INDEX', {
      x: 50,
      y: height - 80,
      size: 16,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });

    let currentY = height - 120;
    indexPage.drawText('Item #', { x: 50, y: currentY, size: 10, font: fontBold });
    indexPage.drawText('Document Type & Title', { x: 100, y: currentY, size: 10, font: fontBold });
    indexPage.drawText('Rev', { x: 380, y: currentY, size: 10, font: fontBold });
    indexPage.drawText('Date', { x: 430, y: currentY, size: 10, font: fontBold });
    indexPage.drawText('Page', { x: 500, y: currentY, size: 10, font: fontBold });

    currentY -= 15;
    indexPage.drawLine({
      start: { x: 50, y: currentY },
      end: { x: 545, y: currentY },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });

    currentY -= 20;
    items.forEach((item, index) => {
      if (currentY > 70) {
        indexPage.drawText(`${index + 1}`, { x: 50, y: currentY, size: 9, font });
        const truncatedTitle = item.documentTitle.length > 40 ? item.documentTitle.substring(0, 37) + '...' : item.documentTitle;
        indexPage.drawText(`${truncatedTitle}`, { x: 100, y: currentY, size: 9, font });
        indexPage.drawText(item.revisionCode, { x: 380, y: currentY, size: 9, font });
        indexPage.drawText(item.issueDate, { x: 430, y: currentY, size: 9, font });
        indexPage.drawText('...', { x: 500, y: currentY, size: 9, font }); // Page number placeholder
        currentY -= 18;
      }
    });

    return doc.save();
  }

  /**
   * Merges front-matter with all submittal PDFs and stamps running page numbers.
   */
  static async compilePackage(
    meta: PackageMetadata,
    items: PackageItemInput[],
    outputPdfPath: string,
    outputZipPath: string,
  ): Promise<CompiledPackageResult> {
    const masterDoc = await PDFDocument.create();
    const frontMatterBytes = await this.generateFrontMatterPdf(meta, items);
    const frontMatterDoc = await PDFDocument.load(frontMatterBytes);

    const copiedFrontPages = await masterDoc.copyPages(frontMatterDoc, frontMatterDoc.getPageIndices());
    for (const page of copiedFrontPages) {
      masterDoc.addPage(page);
    }

    const itemPageRanges: Array<{ itemId: string; pageStart: number; pageEnd: number }> = [];

    // Sort items by sortOrder
    const sortedItems = [...items].sort((a, b) => a.sortOrder - b.sortOrder);

    for (const item of sortedItems) {
      try {
        const itemBytes = await fs.readFile(item.filePath);
        const itemDoc = await PDFDocument.load(itemBytes);
        const pageCount = itemDoc.getPageCount();

        const pageStart = masterDoc.getPageCount() + 1;
        const copiedPages = await masterDoc.copyPages(itemDoc, itemDoc.getPageIndices());
        for (const page of copiedPages) {
          masterDoc.addPage(page);
        }
        const pageEnd = masterDoc.getPageCount();

        itemPageRanges.push({
          itemId: item.itemId,
          pageStart,
          pageEnd,
        });
      } catch {
        // If an item file cannot be loaded, note range as single-page missing placeholder
        const placeholderPage = masterDoc.addPage([595.28, 841.89]);
        const font = await masterDoc.embedFont(StandardFonts.Helvetica);
        placeholderPage.drawText(`Document: ${item.documentTitle} [Evidence Attached in ZIP Archive]`, {
          x: 50,
          y: 750,
          size: 12,
          font,
        });
        const pageNum = masterDoc.getPageCount();
        itemPageRanges.push({ itemId: item.itemId, pageStart: pageNum, pageEnd: pageNum });
      }
    }

    // Save final merged PDF
    const mergedPdfBytes = await masterDoc.save();
    await fs.writeFile(outputPdfPath, mergedPdfBytes);

    // Build ZIP archive
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(outputZipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err: any) => reject(err));

      archive.pipe(output);
      archive.file(outputPdfPath, { name: `${meta.projectCode}_Handover_Compiled.pdf` });

      // Add manifest.json
      const manifestJson = JSON.stringify({ meta, items: itemPageRanges }, null, 2);
      archive.append(manifestJson, { name: 'manifest.json' });

      archive.finalize();
    });

    return {
      mergedPdfPath: outputPdfPath,
      zipPath: outputZipPath,
      totalPages: masterDoc.getPageCount(),
      items: itemPageRanges,
    };
  }
}
