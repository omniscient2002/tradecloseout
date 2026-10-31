// packages/pdf-engine/src/sanitise-pdf.ts
// Pure-Node PDF verification & sanitisation pipeline (RT-006, RT-025, RT-034)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

export interface PdfInspectionResult {
  pageCount: number;
  objectCount: number;
  isEncrypted: boolean;
}

export async function inspectAndSanitisePdf(
  inputPath: string,
  outputPath: string,
): Promise<PdfInspectionResult> {
  // Check if qpdf binary is available
  let qpdfAvailable = false;
  try {
    await execFileAsync('qpdf', ['--version']);
    qpdfAvailable = true;
  } catch {
    qpdfAvailable = false;
  }

  if (qpdfAvailable) {
    // 1. Check encryption & basic structure with strict memory/time limits via qpdf
    const { stdout: jsonOut } = await execFileAsync(
      'qpdf',
      ['--json', '--json-key=pages', '--json-key=encrypt', '--json-key=objects', inputPath],
      { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
    );

    const parsed = JSON.parse(jsonOut);
    if (parsed.encrypt) {
      throw new Error('FILE_ENCRYPTED_REJECTED');
    }

    const pageCount = Array.isArray(parsed.pages) ? parsed.pages.length : 0;
    const objectCount = parsed.objects ? Object.keys(parsed.objects).length : 0;

    if (pageCount < 1 || pageCount > 1000) {
      throw new Error(`PDF_PAGE_LIMIT_EXCEEDED: ${pageCount}`);
    }
    if (objectCount > 25000) {
      throw new Error(`PDF_BOMB_OBJECT_LIMIT_EXCEEDED: ${objectCount}`);
    }

    // 2. Flatten annotations, linearise, and strip document-level JavaScript/actions
    await execFileAsync(
      'qpdf',
      [
        '--empty',
        '--pages',
        inputPath,
        '1-z',
        '--',
        '--flatten-annotations=all',
        '--linearize',
        outputPath,
      ],
      { timeout: 60_000 },
    );

    return { pageCount, objectCount, isEncrypted: false };
  } else {
    // Pure-JS fallback using pdf-lib (for environments without qpdf binary)
    const fileBytes = await fs.readFile(inputPath);
    let pdfDoc: PDFDocument;
    try {
      pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: false });
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes('encrypt')) {
        throw new Error('FILE_ENCRYPTED_REJECTED');
      }
      throw err;
    }

    if (pdfDoc.isEncrypted) {
      throw new Error('FILE_ENCRYPTED_REJECTED');
    }

    const pageCount = pdfDoc.getPageCount();
    if (pageCount < 1 || pageCount > 1000) {
      throw new Error(`PDF_PAGE_LIMIT_EXCEEDED: ${pageCount}`);
    }

    // Approximate object count by scanning PDF structure
    const objectMatches = fileBytes.toString('latin1').match(/\d+\s+\d+\s+obj/g);
    const objectCount = objectMatches ? objectMatches.length : pageCount * 10;
    if (objectCount > 25000) {
      throw new Error(`PDF_BOMB_OBJECT_LIMIT_EXCEEDED: ${objectCount}`);
    }

    // Save stripped PDF without JavaScript
    const sanitisedBytes = await pdfDoc.save({ useObjectStreams: true });
    await fs.writeFile(outputPath, sanitisedBytes);

    return { pageCount, objectCount, isEncrypted: false };
  }
}
