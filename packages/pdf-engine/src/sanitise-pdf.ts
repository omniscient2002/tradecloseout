// packages/pdf-engine/src/sanitise-pdf.ts
// Pure-Node PDF verification & sanitisation pipeline (RT-006, RT-025, RT-034)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib';

const execFileAsync = promisify(execFile);

export interface PdfInspectionResult {
  pageCount: number;
  objectCount: number;
  isEncrypted: boolean;
  safe?: boolean;
  failureCode?: string;
  failureDetail?: string;
}

export const DISALLOWED_ACTIONS = new Set([
  '/Launch',
  '/JavaScript',
  '/JS',
  '/ImportData',
  '/ResetForm',
  '/SubmitForm',
  '/RichMediaExecute',
  '/Rendition',
  '/Movie',
  '/Sound',
]);

export function sanitizeActionDict(
  dict: PDFDict,
  context: any,
  visited: Set<any> = new Set(),
): boolean {
  if (visited.has(dict)) return false;
  visited.add(dict);

  const sVal = dict.get(PDFName.of('S'))?.toString();
  if (sVal && DISALLOWED_ACTIONS.has(sVal)) {
    dict.delete(PDFName.of('S'));
    dict.delete(PDFName.of('F'));
    dict.delete(PDFName.of('JS'));
    dict.delete(PDFName.of('JavaScript'));
    dict.delete(PDFName.of('Win'));
    dict.delete(PDFName.of('Mac'));
    dict.delete(PDFName.of('Unix'));
    dict.delete(PDFName.of('D'));
    dict.delete(PDFName.of('Next'));
    return true;
  }

  const nextObj = dict.get(PDFName.of('Next'));
  if (nextObj) {
    const resolvedNext = context.lookup(nextObj);
    if (resolvedNext instanceof PDFDict) {
      if (sanitizeActionDict(resolvedNext, context, visited)) {
        dict.delete(PDFName.of('Next'));
      }
    } else if (resolvedNext instanceof PDFArray) {
      let hasDisallowed = false;
      for (let i = resolvedNext.size() - 1; i >= 0; i--) {
        const item = context.lookup(resolvedNext.get(i));
        if (item instanceof PDFDict && sanitizeActionDict(item, context, visited)) {
          hasDisallowed = true;
        }
      }
      if (hasDisallowed) {
        dict.delete(PDFName.of('Next'));
      }
    } else {
      dict.delete(PDFName.of('Next'));
    }
  }
  return false;
}

export function sanitizeDictRecursively(
  dict: PDFDict,
  context: any,
  visited: Set<any>,
  depth = 0,
): void {
  if (depth > 50 || visited.has(dict)) return;
  visited.add(dict);

  const sVal = dict.get(PDFName.of('S'))?.toString();
  if (sVal && DISALLOWED_ACTIONS.has(sVal)) {
    dict.delete(PDFName.of('S'));
    dict.delete(PDFName.of('F'));
    dict.delete(PDFName.of('JS'));
    dict.delete(PDFName.of('JavaScript'));
    dict.delete(PDFName.of('Win'));
    dict.delete(PDFName.of('Mac'));
    dict.delete(PDFName.of('Unix'));
    dict.delete(PDFName.of('D'));
    dict.delete(PDFName.of('Next'));
  }

  dict.delete(PDFName.of('JS'));
  dict.delete(PDFName.of('JavaScript'));
  dict.delete(PDFName.of('Launch'));
  dict.delete(PDFName.of('OpenAction'));
  dict.delete(PDFName.of('AA'));

  const aObj = dict.get(PDFName.of('A'));
  if (aObj) {
    const resolvedA = context.lookup(aObj);
    if (resolvedA instanceof PDFDict) {
      if (sanitizeActionDict(resolvedA, context, visited)) {
        dict.delete(PDFName.of('A'));
      }
    }
  }

  const nextObj = dict.get(PDFName.of('Next'));
  if (nextObj) {
    const resolvedNext = context.lookup(nextObj);
    if (resolvedNext instanceof PDFDict) {
      if (sanitizeActionDict(resolvedNext, context, visited)) {
        dict.delete(PDFName.of('Next'));
      }
    } else {
      dict.delete(PDFName.of('Next'));
    }
  }

  for (const [, val] of dict.entries()) {
    const resolved = context.lookup(val);
    if (resolved instanceof PDFDict) {
      sanitizeDictRecursively(resolved, context, visited, depth + 1);
    } else if (resolved instanceof PDFArray) {
      sanitizeArrayRecursively(resolved, context, visited, depth + 1);
    }
  }
}

export function sanitizeArrayRecursively(
  arr: PDFArray,
  context: any,
  visited: Set<any>,
  depth = 0,
): void {
  if (depth > 50 || visited.has(arr)) return;
  visited.add(arr);

  for (let i = arr.size() - 1; i >= 0; i--) {
    const resolved = context.lookup(arr.get(i));
    if (resolved instanceof PDFDict) {
      sanitizeDictRecursively(resolved, context, visited, depth + 1);
    } else if (resolved instanceof PDFArray) {
      sanitizeArrayRecursively(resolved, context, visited, depth + 1);
    }
  }
}

export function sanitizePdfDoc(doc: PDFDocument): void {
  const visited = new Set<any>();

  // 1. Strip document-level active content (OpenAction, AA, JavaScript, Names, Launch)
  doc.catalog.delete(PDFName.of('OpenAction'));
  doc.catalog.delete(PDFName.of('AA'));
  doc.catalog.delete(PDFName.of('JavaScript'));
  doc.catalog.delete(PDFName.of('Names'));
  doc.catalog.delete(PDFName.of('Launch'));

  // 2. Strip page-level active actions and scan all annotations on all pages (FV04, FV07)
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of('AA'));
    page.node.delete(PDFName.of('Actions'));
    page.node.delete(PDFName.of('A'));

    const annotsObj = page.node.get(PDFName.of('Annots'));
    if (annotsObj) {
      const annots = doc.context.lookup(annotsObj);
      if (annots instanceof PDFArray) {
        for (let i = 0; i < annots.size(); i++) {
          const aObj = doc.context.lookup(annots.get(i));
          if (aObj instanceof PDFDict) {
            aObj.delete(PDFName.of('AA'));
            aObj.delete(PDFName.of('Launch'));
            aObj.delete(PDFName.of('JavaScript'));
            aObj.delete(PDFName.of('JS'));

            const actionObj = doc.context.lookup(aObj.get(PDFName.of('A')));
            if (actionObj instanceof PDFDict) {
              const isBad = sanitizeActionDict(actionObj, doc.context, visited);
              if (isBad) {
                aObj.delete(PDFName.of('A'));
              }
            }
            sanitizeDictRecursively(aObj, doc.context, visited, 0);
          }
        }
      }
    }
  }

  // 3. Deep scan context indirect objects for dangerous action dictionaries and chained next actions
  const entries = doc.context.enumerateIndirectObjects();
  for (const [, obj] of entries) {
    if (obj instanceof PDFDict) {
      sanitizeDictRecursively(obj, doc.context, visited, 0);
    } else if (obj instanceof PDFArray) {
      sanitizeArrayRecursively(obj, doc.context, visited, 0);
    }
  }
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
      ['--json', inputPath],
      { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
    );

    const parsed = JSON.parse(jsonOut);
    const isEncrypted = Boolean(
      parsed.encrypt &&
      (parsed.encrypt.encrypted === true ||
       (parsed.encrypt.encrypted !== false && Object.keys(parsed.encrypt).length > 0))
    );
    if (isEncrypted) {
      throw new Error('FILE_ENCRYPTED_REJECTED');
    }

    const pageCount = Array.isArray(parsed.pages)
      ? parsed.pages.length
      : (Array.isArray(parsed.qpdf?.[1]?.pages) ? parsed.qpdf[1].pages.length : 0);

    let objectCount = 0;
    if (parsed.objects && typeof parsed.objects === 'object') {
      objectCount = Object.keys(parsed.objects).length;
    } else if (Array.isArray(parsed.qpdf) && parsed.qpdf[1] && typeof parsed.qpdf[1] === 'object') {
      const qpdfObj = parsed.qpdf[1];
      if (qpdfObj.objects && typeof qpdfObj.objects === 'object') {
        objectCount = Object.keys(qpdfObj.objects).length;
      } else {
        objectCount = Object.keys(qpdfObj).filter((k) => k.startsWith('obj:')).length;
      }
    }

    if (pageCount < 1 || pageCount > 1000) {
      return {
        safe: false,
        pageCount,
        objectCount,
        isEncrypted: false,
        failureCode: 'PDF_PAGE_LIMIT_EXCEEDED',
        failureDetail: `PDF contains ${pageCount} pages, exceeding the 1,000-page limit.`,
      };
    }
    if (objectCount > 25000) {
      // qpdf's JSON inventory may include extra object-stream bookkeeping
      // entries. Count parsed indirect objects before reporting the limit,
      // so the result agrees with the actual PDF object inventory (FV08).
      // This is only done for suspicious files; normal documents avoid
      // the additional parser cost. Failure to parse is never considered safe.
      const size = (await fs.stat(inputPath)).size;
      if (size > 100 * 1024 * 1024) {
        return {
          safe: false, pageCount, objectCount, isEncrypted: false,
          failureCode: 'PDF_BOMB_OBJECT_LIMIT_EXCEEDED',
          failureDetail: 'PDF is too large to safely enumerate suspicious object streams.',
        };
      }
      const inspected = await PDFDocument.load(await fs.readFile(inputPath), {
        ignoreEncryption: false,
      });
      if (inspected.isEncrypted) throw new Error('FILE_ENCRYPTED_REJECTED');
      objectCount = inspected.context.enumerateIndirectObjects().length;
      if (objectCount > 25000) {
        return {
          safe: false,
          pageCount,
          objectCount,
          isEncrypted: false,
          failureCode: 'PDF_BOMB_OBJECT_LIMIT_EXCEEDED',
          failureDetail: `PDF contains ${objectCount} indirect objects, exceeding the 25,000 ceiling.`,
        };
      }
    }
    if (objectCount === 0 && pageCount > 0) {
      throw new Error('MALFORMED_QPDF_OUTPUT: Unable to determine object count');
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

    return { safe: true, pageCount, objectCount, isEncrypted: false };
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
      return {
        safe: false,
        pageCount,
        objectCount: 0,
        isEncrypted: false,
        failureCode: 'PDF_PAGE_LIMIT_EXCEEDED',
        failureDetail: `PDF contains ${pageCount} pages, exceeding the 1,000-page limit.`,
      };
    }

    // Precise parsed indirect object inventory (FV08 - includes compressed object streams)
    const objectCount = pdfDoc.context.enumerateIndirectObjects().length;
    if (objectCount > 25000) {
      return {
        safe: false,
        pageCount,
        objectCount,
        isEncrypted: false,
        failureCode: 'PDF_BOMB_OBJECT_LIMIT_EXCEEDED',
        failureDetail: `PDF contains ${objectCount} indirect objects, exceeding the 25,000 ceiling.`,
      };
    }

    // Sanitize PDF to strip JavaScript, OpenAction, AA, Launch, and chained Next actions (FV04, FV07)
    sanitizePdfDoc(pdfDoc);

    // Save stripped PDF without JavaScript
    const sanitisedBytes = await pdfDoc.save({ useObjectStreams: true });
    await fs.writeFile(outputPath, sanitisedBytes);

    return { safe: true, pageCount, objectCount, isEncrypted: false };
  }
}
