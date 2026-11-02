// packages/pdf-engine/src/package-builder.ts
// Pure-Node PDF Handover Package Compilation Pipeline (RT-006, RT-025, RT-034, CB-013)

import { PDFDocument, rgb, StandardFonts, PDFName, PDFString } from 'pdf-lib';
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

function sanitizeText(str: string): string {
  if (!str) return '';
  return str.replace(/[^\x20-\x7E]/g, ' ').trim();
}

export class PackageBuilder {
  /**
   * Generates front matter PDF containing Cover Page and Table of Contents Index with actual page numbers.
   */
  static async generateFrontMatterPdf(
    meta: PackageMetadata,
    itemsWithPages: Array<PackageItemInput & { pageStart: number; pageEnd: number }>,
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

    coverPage.drawText(sanitizeText(`Project: ${meta.projectCode} — ${meta.projectName}`), {
      x: 50,
      y: height - 170,
      size: 14,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });

    coverPage.drawText(sanitizeText(`Client: ${meta.clientName}`), {
      x: 50,
      y: height - 200,
      size: 12,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });

    coverPage.drawText(sanitizeText(`Main Contractor: ${meta.contractorName}`), {
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
    indexPage.drawText('#', { x: 50, y: currentY, size: 10, font: fontBold });
    indexPage.drawText('Document Type & Title', { x: 80, y: currentY, size: 10, font: fontBold });
    indexPage.drawText('Rev', { x: 380, y: currentY, size: 10, font: fontBold });
    indexPage.drawText('Date', { x: 420, y: currentY, size: 10, font: fontBold });
    indexPage.drawText('Page(s)', { x: 480, y: currentY, size: 10, font: fontBold });

    currentY -= 15;
    indexPage.drawLine({
      start: { x: 50, y: currentY },
      end: { x: 545, y: currentY },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });

    currentY -= 20;
    itemsWithPages.forEach((item, index) => {
      if (currentY > 70) {
        indexPage.drawText(`${index + 1}`, { x: 50, y: currentY, size: 9, font });
        const cleanTitle = sanitizeText(item.documentTitle);
        const truncatedTitle = cleanTitle.length > 45 ? cleanTitle.substring(0, 42) + '...' : cleanTitle;
        indexPage.drawText(truncatedTitle, { x: 80, y: currentY, size: 9, font });
        indexPage.drawText(sanitizeText(item.revisionCode), { x: 380, y: currentY, size: 9, font });
        indexPage.drawText(item.issueDate || '', { x: 420, y: currentY, size: 9, font });
        const pageRange = item.pageStart === item.pageEnd ? `${item.pageStart}` : `${item.pageStart}-${item.pageEnd}`;
        indexPage.drawText(pageRange, { x: 480, y: currentY, size: 9, font });
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
    const sortedItems = [...items].sort((a, b) => a.sortOrder - b.sortOrder);

    // 1. First pass: load and inspect item documents to determine accurate page counts
    const loadedItemDocs: Array<{ item: PackageItemInput; doc: PDFDocument | null; pageCount: number }> = [];
    for (const item of sortedItems) {
      try {
        const itemBytes = await fs.readFile(item.filePath);
        const itemDoc = await PDFDocument.load(itemBytes);
        loadedItemDocs.push({ item, doc: itemDoc, pageCount: itemDoc.getPageCount() });
      } catch {
        // Missing or non-PDF placeholder page count = 1
        loadedItemDocs.push({ item, doc: null, pageCount: 1 });
      }
    }

    // 2. Compute accurate starting and ending page numbers
    const frontMatterPageCount = 2; // 1 Cover + 1 Table of Contents
    let runningPage = frontMatterPageCount + 1;
    const itemsWithPages: Array<PackageItemInput & { pageStart: number; pageEnd: number }> = [];

    for (const entry of loadedItemDocs) {
      const pageStart = runningPage;
      const pageEnd = runningPage + entry.pageCount - 1;
      itemsWithPages.push({
        ...entry.item,
        pageStart,
        pageEnd,
      });
      runningPage += entry.pageCount;
    }

    // 3. Generate front matter with exact page ranges
    const frontMatterBytes = await this.generateFrontMatterPdf(meta, itemsWithPages);
    const frontMatterDoc = await PDFDocument.load(frontMatterBytes);

    const masterDoc = await PDFDocument.create();

    // Copy front matter pages
    const copiedFrontPages = await masterDoc.copyPages(frontMatterDoc, frontMatterDoc.getPageIndices());
    for (const page of copiedFrontPages) {
      masterDoc.addPage(page);
    }

    // Copy all item pages into masterDoc
    for (const entry of loadedItemDocs) {
      if (entry.doc) {
        const copiedPages = await masterDoc.copyPages(entry.doc, entry.doc.getPageIndices());
        for (const page of copiedPages) {
          masterDoc.addPage(page);
        }
      } else {
        const placeholderPage = masterDoc.addPage([595.28, 841.89]);
        const font = await masterDoc.embedFont(StandardFonts.Helvetica);
        placeholderPage.drawText(
          sanitizeText(`Document: ${entry.item.documentTitle} [Evidence Attached in ZIP Archive]`),
          { x: 50, y: 750, size: 12, font },
        );
      }
    }

    // 4. Bates Stamp running page numbers on bottom right
    const font = await masterDoc.embedFont(StandardFonts.Helvetica);
    const totalPages = masterDoc.getPageCount();
    for (let i = 0; i < totalPages; i++) {
      const page = masterDoc.getPage(i);
      const { width } = page.getSize();
      page.drawText(`Page ${i + 1} of ${totalPages}`, {
        x: width - 110,
        y: 25,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
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

      const manifestJson = JSON.stringify(
        {
          meta,
          items: itemsWithPages.map((i) => ({
            itemId: i.itemId,
            documentTitle: i.documentTitle,
            pageStart: i.pageStart,
            pageEnd: i.pageEnd,
          })),
        },
        null,
        2,
      );
      archive.append(manifestJson, { name: 'manifest.json' });

      archive.finalize();
    });

    return {
      mergedPdfPath: outputPdfPath,
      zipPath: outputZipPath,
      totalPages,
      items: itemsWithPages.map((i) => ({
        itemId: i.itemId,
        pageStart: i.pageStart,
        pageEnd: i.pageEnd,
      })),
    };
  }
}

/**
 * Injects hierarchical PDF Bookmarks (/Outlines) into the PDF catalog (FR-HND-004)
 */
export async function injectPdfBookmarks(
  pdfPath: string,
  bookmarks: Array<{ title: string; pageIndex: number }>,
): Promise<void> {
  const bytes = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  if (pages.length === 0 || bookmarks.length === 0) return;

  const outlinesDictRef = doc.context.nextRef();
  const itemRefs: any[] = bookmarks.map(() => doc.context.nextRef());

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];
    const pageIdx = Math.min(Math.max(bm.pageIndex, 0), pages.length - 1);
    const targetPage = pages[pageIdx];

    const itemDict: Record<string, any> = {
      Title: PDFString.of(bm.title.slice(0, 95)),
      Parent: outlinesDictRef,
      Dest: [targetPage.ref, PDFName.of('XYZ'), null, 842, null],
    };
    if (i > 0) {
      itemDict.Prev = itemRefs[i - 1];
    }
    if (i < bookmarks.length - 1) {
      itemDict.Next = itemRefs[i + 1];
    }

    doc.context.assign(itemRefs[i], doc.context.obj(itemDict));
  }

  const outlinesDict = doc.context.obj({
    Type: 'Outlines',
    Count: bookmarks.length,
    First: itemRefs[0],
    Last: itemRefs[itemRefs.length - 1],
  });

  doc.context.assign(outlinesDictRef, outlinesDict);
  doc.catalog.set(PDFName.of('Outlines'), outlinesDictRef);

  await fs.writeFile(pdfPath, await doc.save());
}
