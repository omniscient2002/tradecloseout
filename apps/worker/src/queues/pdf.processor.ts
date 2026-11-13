import {drawPackageBranding,brandingColour} from './package-branding';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';

export interface PackageCompileInput {
  branding?: import('./package-branding').PackageBranding;
  packageId: string;
  versionNo: number;
  orgLegalName: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  contractRef: string;
  snapshotChecksum: string;
  generatedAtIst: string;
  requirementsIndex: Array<{
    requirementKey: string;
    title: string;
    assetTag: string | null;
    docTypeKey: string;
    revisionCode: string | null;
    statusAtGeneration: string;
    decidedBy: string | null;
    decisionMethod: 'IN_APP' | 'EXTERNAL' | 'WAIVED' | null;
  }>;
  sourceFiles: Array<{
    documentVersionId: string;
    sectionKey: string;
    title: string;
    localPath: string;
    sha256: string;
  }>;
}

/**
 * Sanitises any user-controlled string before drawing into PDF content streams
 * or PDF metadata dictionaries (AUD-006 / RB-12).
 */
export function sanitisePdfText(input: string | null | undefined, maxLen = 140): string {
  if (!input) return '—';
  return input
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // Strip control characters
    .replace(/[<>\\]/g, '') // Strip angle brackets & escapes
    .trim()
    .slice(0, maxLen);
}

export async function compileHandoverDossierPdf(
  input: PackageCompileInput,
  outputPath: string,
): Promise<{
  totalPages: number;
  pdfSha256: string;
  itemPageRanges: Array<{ documentVersionId: string; pageStart: number; pageEnd: number }>;
}> {
  const mergedPdf = await PDFDocument.create();
  const fontBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const fontMono = await mergedPdf.embedFont(StandardFonts.Courier);

  // 1. Render A4 Executive Cover Page + CPWD/PMC Signature Block (07 §9.3 & FR-HND-002)
  const coverPage = mergedPdf.addPage([595.28, 841.89]); // A4 Portrait
  const { width, height } = coverPage.getSize();

  // Top Blueprint Navy Accent Bar
  coverPage.drawRectangle({
    x: 0,
    y: height - 28,
    width,
    height: 28,
    color: brandingColour(input.branding?.brandColor), // #0F2942
  });

  coverPage.drawText(sanitisePdfText(input.orgLegalName, 80).toUpperCase(), {
    x: 48,
    y: height - 76,
    size: 11,
    font: fontBold,
    color: brandingColour(input.branding?.brandColor),
  });

  coverPage.drawText('TECHNICAL CLOSEOUT & O&M HANDOVER DOSSIER', {
    x: 48,
    y: height - 104,
    size: 18,
    font: fontBold,
    color: rgb(0.059, 0.09, 0.165),
  });

  const metaRows: Array<[string, string]> = [
    ['Project Code & Title', `${sanitisePdfText(input.projectCode, 30)} — ${sanitisePdfText(input.projectName, 70)}`],
    ['Client Organisation', sanitisePdfText(input.clientName, 80)],
    ['Contract Reference', sanitisePdfText(input.contractRef, 60)],
    ['Package Version', `v${input.versionNo}`],
    ['Generated (IST)', sanitisePdfText(input.generatedAtIst, 40)],
    ['Checklist Snapshot SHA-256', sanitisePdfText(input.snapshotChecksum, 64)],
  ];

  let yCursor = height - 155;
  for (const [label, value] of metaRows) {
    coverPage.drawText(`${label}:`, {
      x: 48,
      y: yCursor,
      size: 9.5,
      font: fontBold,
      color: rgb(0.28, 0.33, 0.41),
    });
    coverPage.drawText(value, {
      x: 210,
      y: yCursor,
      size: 9.5,
      font: label.includes('SHA-256') ? fontMono : fontRegular,
      color: rgb(0.06, 0.09, 0.16),
    });
    yCursor -= 22;
  }

  // Government / PSU / PMC 3-Column Signature & Rubber-Stamp Grid (07 §9.3 AUD-P-18)
  const boxY = 140;
  const boxW = (width - 96) / 3;
  const stampTitles = [
    'PREPARED BY (SUBCONTRACTOR)',
    'REVIEWED BY (MEP CONSULTANT)',
    'ACCEPTED BY (CLIENT / MC)',
  ];
  stampTitles.forEach((title, idx) => {
    const bx = 48 + idx * boxW;
    coverPage.drawRectangle({
      x: bx,
      y: boxY,
      width: boxW - 8,
      height: 110,
      borderColor: rgb(0.58, 0.64, 0.72),
      borderWidth: 0.8,
    });
    coverPage.drawText(title, {
      x: bx + 8,
      y: boxY + 94,
      size: 7.5,
      font: fontBold,
      color: rgb(0.2, 0.25, 0.33),
    });
    coverPage.drawText('Sign & Stamp:', {
      x: bx + 8,
      y: boxY + 14,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.4, 0.45, 0.52),
    });
  });

  // 2. Render Approval Summary & Requirement Index Page (FR-HND-002 / AUD-008)
  let indexPage = mergedPdf.addPage([595.28, 841.89]);
  let rowY = height - 60;
  indexPage.drawText('MASTER REQUIREMENT & APPROVAL REGISTER', {
    x: 48,
    y: rowY,
    size: 13,
    font: fontBold,
    color: brandingColour(input.branding?.brandColor),
  });
  rowY -= 26;

  for (const req of input.requirementsIndex) {
    if (rowY < 60) {
      indexPage = mergedPdf.addPage([595.28, 841.89]);
      rowY = height - 60;
    }
    const methodLabel =
      req.decisionMethod === 'EXTERNAL'
        ? 'Approved (external)'
        : req.decisionMethod === 'WAIVED'
        ? 'Waived'
        : sanitisePdfText(req.statusAtGeneration, 24);

    const line = `${sanitisePdfText(req.requirementKey, 16).padEnd(16)} | ${sanitisePdfText(
      req.assetTag ?? 'PROJECT',
      12,
    ).padEnd(12)} | ${sanitisePdfText(req.revisionCode ?? '-', 4).padEnd(4)} | ${methodLabel}`;

    indexPage.drawText(line, {
      x: 48,
      y: rowY,
      size: 8,
      font: fontMono,
      color: rgb(0.1, 0.15, 0.22),
    });
    rowY -= 14;
  }

  // 3. Merge Validated Source PDFs & Record Exact Page Ranges (FR-HND-003)
  const itemPageRanges: Array<{ documentVersionId: string; pageStart: number; pageEnd: number }> = [];

  for (const src of input.sourceFiles) {
    const fileBytes = await readFile(src.localPath);
    const actualSha = createHash('sha256').update(fileBytes).digest('hex');
    if (actualSha.toLowerCase() !== src.sha256.toLowerCase()) {
      throw new Error(`Checksum mismatch while merging version ${src.documentVersionId}`);
    }

    const srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: false });
    const startPage = mergedPdf.getPageCount() + 1;
    const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
    for (const p of copiedPages) {
      mergedPdf.addPage(p);
    }
    const endPage = mergedPdf.getPageCount();

    itemPageRanges.push({
      documentVersionId: src.documentVersionId,
      pageStart: startPage,
      pageEnd: endPage,
    });
  }

  await drawPackageBranding(mergedPdf,coverPage,fontRegular,input.branding);
  const finalBytes = await mergedPdf.save();
  await writeFile(outputPath, finalBytes);
  const pdfSha256 = createHash('sha256').update(finalBytes).digest('hex');

  return {
    totalPages: mergedPdf.getPageCount(),
    pdfSha256,
    itemPageRanges,
  };
}
