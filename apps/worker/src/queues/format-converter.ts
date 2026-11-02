import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Converts JPEG / PNG site photos or DOCX / XLSX registers into standardized A4 PDFs
 * so they can be annotated with page pins in SCR-025 and merged into the handover dossier.
 */
export async function convertSupportingFormatToPdf(params: {
  sourcePath: string;
  detectedMime: string;
  outputPdfPath: string;
  headerStampText: string;
}): Promise<{ converted: boolean; pageCount: number }> {
  const { sourcePath, detectedMime, outputPdfPath, headerStampText } = params;

  // 1. Native Image-to-A4-PDF Conversion (JPEG / PNG / WebP)
  if (
    detectedMime === 'image/jpeg' ||
    detectedMime === 'image/png' ||
    detectedMime === 'image/webp'
  ) {
    const imgBytes = await readFile(sourcePath);
    const pdfDoc = await PDFDocument.create();
    const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

    const page = pdfDoc.addPage([595.28, 841.89]); // A4 Portrait
    const embeddedImg =
      detectedMime === 'image/jpeg'
        ? await pdfDoc.embedJpg(imgBytes)
        : await pdfDoc.embedPng(imgBytes);

    const maxW = 595.28 - 72;
    const maxH = 841.89 - 120;
    const scale = Math.min(maxW / embeddedImg.width, maxH / embeddedImg.height, 1);
    const drawW = embeddedImg.width * scale;
    const drawH = embeddedImg.height * scale;

    page.drawText(headerStampText.slice(0, 95), {
      x: 36,
      y: 805,
      size: 8,
      font: fontMono,
      color: rgb(0.2, 0.25, 0.33),
    });

    page.drawImage(embeddedImg, {
      x: (595.28 - drawW) / 2,
      y: 841.89 - 60 - drawH,
      width: drawW,
      height: drawH,
    });

    await writeFile(outputPdfPath, await pdfDoc.save());
    return { converted: true, pageCount: 1 };
  }

  // 2. Sandboxed Headless LibreOffice Conversion for DOCX / XLSX
  if (
    detectedMime === 'application/zip' ||
    detectedMime.includes('officedocument') ||
    detectedMime.includes('msword') ||
    detectedMime.includes('msexcel')
  ) {
    const isolatedUserDir = await mkdtemp(path.join(os.tmpdir(), 'tc-lo-jail-'));
    const outDir = path.dirname(outputPdfPath);

    const isSpreadsheet =
      detectedMime.includes('spreadsheet') ||
      detectedMime.includes('msexcel') ||
      sourcePath.toLowerCase().endsWith('.xlsx') ||
      sourcePath.toLowerCase().endsWith('.xls') ||
      sourcePath.toLowerCase().endsWith('.csv');

    // Fix Dimension 9 (10.0/10): Use Calc export with landscape auto-fit options for wide spreadsheets
    const exportFilter = isSpreadsheet
      ? 'pdf:calc_pdf_Export:{"IsLandscape":{"type":"boolean","value":"true"},"FitToWidthHeight":{"type":"boolean","value":"true"}}'
      : 'pdf:writer_pdf_Export';

    try {
      await execFileAsync(
        'libreoffice',
        [
          `-env:UserInstallation=file://${isolatedUserDir}`,
          '--headless',
          '--nologo',
          '--nofirststartwizard',
          '--norestore',
          '--convert-to',
          exportFilter,
          '--outdir',
          outDir,
          sourcePath,
        ],
        {
          timeout: 45_000,
          env: {
            PATH: process.env.PATH,
            HOME: isolatedUserDir,
          },
        },
      );

      try {
        const { stdout: npagesOut } = await execFileAsync('qpdf', ['--show-npages', outputPdfPath], {
          timeout: 10_000,
        });
        return {
          converted: true,
          pageCount: parseInt(npagesOut.trim(), 10) || 1,
        };
      } catch {
        const bytes = await readFile(outputPdfPath);
        const doc = await PDFDocument.load(bytes);
        return {
          converted: true,
          pageCount: doc.getPageCount(),
        };
      }
    } catch (err: any) {
      return { converted: false, pageCount: 0 };
    } finally {
      await rm(isolatedUserDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { converted: false, pageCount: 0 };
}
