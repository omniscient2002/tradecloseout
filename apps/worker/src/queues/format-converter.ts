import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdtemp, rm, lstat, stat, realpath } from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_OFFICE_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_CONVERTED_PDF_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 60_000_000;
const MAX_CONVERTED_PAGES = 1_000;

async function assertRegularBoundedInput(source: string, limit: number): Promise<void> {
  if (!path.isAbsolute(source)) throw new Error('CONVERSION_SOURCE_PATH_INVALID');
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink() ||
      !Number.isSafeInteger(info.size) || info.size < 1 || info.size > limit) {
    throw new Error('CONVERSION_SOURCE_RESOURCE_LIMIT');
  }
}

/**
 * Confine file-backed conversion to a designated workspace in deployed modes.
 * Resolve real paths, not just string prefixes: ../ and parent-directory
 * symlinks must never let a queued job read or overwrite arbitrary server files.
 */
export async function assertConverterWorkspace(
  sourcePath: string, outputPdfPath: string, workspace: string,
): Promise<void> {
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(outputPdfPath) ||
      !path.isAbsolute(workspace)) {
    throw new Error('CONVERSION_WORKSPACE_PATH_INVALID');
  }
  const root = await realpath(workspace);
  const input = await realpath(sourcePath);
  const parent = await realpath(path.dirname(outputPdfPath));
  const within = (file: string, allowRoot: boolean) => {
    const relative = path.relative(root, file);
    return (allowRoot || relative !== '') && relative !== '..' &&
      !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  if (!within(input, false) || !within(parent, true)) {
    throw new Error('CONVERSION_WORKSPACE_ESCAPE');
  }
  try {
    const candidate = await lstat(outputPdfPath);
    if (!candidate.isFile() || candidate.isSymbolicLink()) {
      throw new Error('CONVERSION_OUTPUT_TARGET_UNSAFE');
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function assertBoundedOutput(pdfPath: string, pageCount: number): Promise<void> {
  const output = await stat(pdfPath);
  if (!output.isFile() || !Number.isSafeInteger(output.size) ||
      output.size < 1 || output.size > MAX_CONVERTED_PDF_BYTES ||
      !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_CONVERTED_PAGES) {
    throw new Error('CONVERSION_OUTPUT_RESOURCE_LIMIT');
  }
}


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
  if (!params || typeof params.sourcePath !== 'string' ||
      typeof params.outputPdfPath !== 'string' || !path.isAbsolute(params.outputPdfPath) ||
      params.sourcePath === params.outputPdfPath ||
      typeof params.detectedMime !== 'string' ||
      typeof params.headerStampText !== 'string') {
    throw new Error('CONVERSION_INPUT_INVALID');
  }
  const { sourcePath, detectedMime, outputPdfPath, headerStampText } = params;
  if (['staging', 'production'].includes(process.env.NODE_ENV || '')) {
    if (!process.env.CONVERSION_STAGING_ROOT) {
      throw new Error('CONVERSION_STAGING_ROOT_REQUIRED');
    }
    await assertConverterWorkspace(sourcePath, outputPdfPath, process.env.CONVERSION_STAGING_ROOT);
  }

  // 1. Native Image-to-A4-PDF Conversion (JPEG / PNG / WebP)
  if (
    detectedMime === 'image/jpeg' ||
    detectedMime === 'image/png' ||
    detectedMime === 'image/webp'
  ) {
    await assertRegularBoundedInput(sourcePath, MAX_IMAGE_SOURCE_BYTES);
    const imgBytes = await readFile(sourcePath);
    const pdfDoc = await PDFDocument.create();
    const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

    let finalImgBytes = imgBytes;
    let isJpeg = detectedMime === 'image/jpeg';

    if (detectedMime === 'image/webp') {
      try {
        const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'webp-conv-'));
        try {
          const tmpPng = path.join(tmpDir, 'converted.png');
          await execFileAsync('convert', [sourcePath, tmpPng], { timeout: 10_000, maxBuffer: 1024 * 1024 });
          await assertRegularBoundedInput(tmpPng, MAX_IMAGE_SOURCE_BYTES);
          finalImgBytes = await readFile(tmpPng);
        } finally {
          await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      } catch (convErr) {
        throw new Error(`UNSUPPORTED_IMAGE_FORMAT: WebP format could not be converted to PNG: ${(convErr as Error).message}`);
      }
    }

    const page = pdfDoc.addPage([595.28, 841.89]); // A4 Portrait
    const embeddedImg = isJpeg
      ? await pdfDoc.embedJpg(finalImgBytes)
      : await pdfDoc.embedPng(finalImgBytes);

    if (!Number.isSafeInteger(embeddedImg.width) || !Number.isSafeInteger(embeddedImg.height) ||
        embeddedImg.width < 1 || embeddedImg.height < 1 ||
        embeddedImg.width * embeddedImg.height > MAX_IMAGE_PIXELS) {
      throw new Error('CONVERSION_IMAGE_PIXELS_EXCEEDED');
    }
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

    const pdfBytes = await pdfDoc.save();
    if (pdfBytes.length > MAX_CONVERTED_PDF_BYTES) throw new Error('CONVERSION_OUTPUT_RESOURCE_LIMIT');
    await writeFile(outputPdfPath, pdfBytes);
    await assertBoundedOutput(outputPdfPath, 1);
    return { converted: true, pageCount: 1 };
  }

  // 2. Sandboxed Headless LibreOffice Conversion for DOCX / XLSX
  if (
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword', 'application/vnd.ms-excel',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
    ].includes(detectedMime)
  ) {
    await assertRegularBoundedInput(sourcePath, MAX_OFFICE_SOURCE_BYTES);
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
        const pages = Number(npagesOut.trim());
        await assertBoundedOutput(outputPdfPath, pages);
        return { converted: true, pageCount: pages };
      } catch {
        const stats = await stat(outputPdfPath);
        if (!stats.isFile() || stats.size > MAX_CONVERTED_PDF_BYTES || stats.size < 1) {
          throw new Error('CONVERSION_OUTPUT_RESOURCE_LIMIT');
        }
        const bytes = await readFile(outputPdfPath);
        const doc = await PDFDocument.load(bytes);
        const pages = doc.getPageCount();
        await assertBoundedOutput(outputPdfPath, pages);
        return { converted: true, pageCount: pages };
      }
    } catch (err: any) {
      return { converted: false, pageCount: 0 };
    } finally {
      await rm(isolatedUserDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { converted: false, pageCount: 0 };
}
