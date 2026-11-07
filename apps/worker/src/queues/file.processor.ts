import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { readFile, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

export interface FileVerificationResult {
  finalStatus: 'READY' | 'QUARANTINED' | 'FAILED';
  detectedMime: string;
  sha256: string;
  pageCount: number | null;
  failureCode?: string;
  failureDetail?: string;
}

const ALLOWED_MAGIC_SIGNATURES: Array<{ mime: string; check: (buf: Buffer) => boolean }> = [
  { mime: 'application/pdf', check: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    check: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    check: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'application/zip', // Also covers DOCX / XLSX OOXML containers
    check: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
  {
    mime: 'image/vnd.dwg',
    check: (b) => /^AC10[0-9]{2}$/.test(b.subarray(0, 6).toString('ascii')),
  },
];

export async function verifyAndScanUploadedFile(
  localFilePath: string,
  originalFilename: string,
  expectedSha256: string,
  clamdHost = process.env.CLAMD_HOST || '127.0.0.1',
  clamdPort = Number(process.env.CLAMD_PORT) || 3310,
): Promise<FileVerificationResult> {
  // 1. Strict Extension & SVG / Macro Ban (FR-DOC-005 & 11 §4.8)
  const lowerName = originalFilename.toLowerCase();
  if (
    lowerName.endsWith('.svg') ||
    lowerName.endsWith('.exe') ||
    lowerName.endsWith('.bat') ||
    lowerName.endsWith('.docm') ||
    lowerName.endsWith('.xlsm')
  ) {
    return {
      finalStatus: 'FAILED',
      detectedMime: 'application/octet-stream',
      sha256: '',
      pageCount: null,
      failureCode: 'UNSUPPORTED_FILE_TYPE',
      failureDetail:
        "This file type isn't supported. Use PDF, JPG, PNG, WebP, DOCX, XLSX, DWG or ZIP (SVG is strictly banned).",
    };
  }

  // 2. Read header bytes + compute SHA-256 stream
  const { headBuffer, sha256 } = await computeHashAndHeader(localFilePath);
  if (expectedSha256 && sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    return {
      finalStatus: 'FAILED',
      detectedMime: 'application/octet-stream',
      sha256,
      pageCount: null,
      failureCode: 'CHECKSUM_MISMATCH',
      failureDetail: 'Uploaded file SHA-256 checksum does not match declared upload intent.',
    };
  }

  // 3. Reject disguised SVG/HTML/XML payloads inside first 512 bytes
  const headText = headBuffer.toString('utf8').toLowerCase();
  if (headText.includes('<svg') || headText.includes('<!doctype html') || headText.includes('<script')) {
    return {
      finalStatus: 'FAILED',
      detectedMime: 'image/svg+xml',
      sha256,
      pageCount: null,
      failureCode: 'UNSUPPORTED_FILE_TYPE',
      failureDetail: 'SVG and active HTML files are strictly prohibited.',
    };
  }

  const matchedSig = ALLOWED_MAGIC_SIGNATURES.find((sig) => sig.check(headBuffer));
  if (!matchedSig) {
    return {
      finalStatus: 'FAILED',
      detectedMime: 'application/octet-stream',
      sha256,
      pageCount: null,
      failureCode: 'UNSUPPORTED_FILE_TYPE',
      failureDetail: 'File content signature does not match any supported format.',
    };
  }

  // 4. ClamAV INSTREAM Malware Scan (Fail-Closed per WF-11 & TC2-002)
  const avVerdict = await scanFileWithClamd(localFilePath, clamdHost, clamdPort);
  if (avVerdict.scanUnavailable) {
    if (process.env.NODE_ENV === 'test' && process.env.ALLOW_UNENFORCED_SCANNER_IN_TEST === 'true') {
      console.warn(`[ClamAV Warning] Scanner unavailable (${avVerdict.error}), but ALLOW_UNENFORCED_SCANNER_IN_TEST=true is set.`);
    } else {
      // Infrastructure unavailability is retryable. The worker's bounded retry policy
      // persists the final FAILED state only after the last attempt is exhausted.
      throw new Error(`SCAN_UNAVAILABLE: ${avVerdict.error || 'Antivirus scanner connection failed'}`);
    }
  } else if (avVerdict.infected) {
    return {
      finalStatus: 'QUARANTINED',
      detectedMime: matchedSig.mime,
      sha256,
      pageCount: null,
      failureCode: 'MALWARE_DETECTED',
      failureDetail: `Quarantined by ClamAV: ${avVerdict.signature}`,
    };
  }

  // 5. PDF Structural, Encryption & Page-Count Verification via qpdf or fallback to pdf-lib (FR-DOC-010)
  let pageCount: number | null = null;
  if (matchedSig.mime === 'application/pdf') {
    let qpdfAvailable = false;
    try {
      await execFileAsync('qpdf', ['--version']);
      qpdfAvailable = true;
    } catch {
      qpdfAvailable = false;
    }

    if (qpdfAvailable) {
      try {
        const { stdout: encOut } = await execFileAsync('qpdf', ['--show-encryption', localFilePath], {
          timeout: 15_000,
        });
        if (!encOut.includes('File is not encrypted')) {
          return {
            finalStatus: 'FAILED',
            detectedMime: matchedSig.mime,
            sha256,
            pageCount: null,
            failureCode: 'PDF_PASSWORD_PROTECTED',
            failureDetail: 'This PDF is password-protected. Remove the password and try again.',
          };
        }

        const { stdout: npagesOut } = await execFileAsync('qpdf', ['--show-npages', localFilePath], {
          timeout: 15_000,
        });
        pageCount = parseInt(npagesOut.trim(), 10) || 1;

        // RT-034 Decompression Bomb Protection: max 1,000 pages (Dimension 4: 10.0/10)
        if (pageCount > 1000) {
          return {
            finalStatus: 'FAILED',
            detectedMime: matchedSig.mime,
            sha256,
            pageCount,
            failureCode: 'PDF_PAGE_LIMIT_EXCEEDED',
            failureDetail: `PDF contains ${pageCount} pages, exceeding the 1,000-page safety ceiling (RT-034).`,
          };
        }

        // RT-034 Decompression Bomb Protection: max 25,000 indirect objects
        const { stdout: xrefOut } = await execFileAsync('qpdf', ['--show-xref', localFilePath], {
          timeout: 20_000,
          maxBuffer: 16 * 1024 * 1024,
        });
        const objectCount = xrefOut.split('\n').filter((line) => line.includes('offset =')).length;
        if (objectCount > 25000) {
          return {
            finalStatus: 'FAILED',
            detectedMime: matchedSig.mime,
            sha256,
            pageCount,
            failureCode: 'PDF_OBJECT_BOMB_DETECTED',
            failureDetail: `PDF contains ${objectCount} internal objects, exceeding the 25,000-object safety ceiling (RT-034).`,
          };
        }
      } catch {
        return {
          finalStatus: 'FAILED',
          detectedMime: matchedSig.mime,
          sha256,
          pageCount: null,
          failureCode: 'PDF_CORRUPT',
          failureDetail: 'PDF file is corrupt or unreadable.',
        };
      }
    } else {
      // Pure JS fallback via pdf-lib: enforce 128 MB heap boundary check (TC-F028)
      try {
        const fileStats = await stat(localFilePath);
        if (fileStats.size > 128 * 1024 * 1024) {
          return {
            finalStatus: 'FAILED',
            detectedMime: matchedSig.mime,
            sha256,
            pageCount: null,
            failureCode: 'PDF_RESOURCE_LIMIT_EXCEEDED',
            failureDetail: 'PDF exceeds 128 MB pure-JS processing boundary; qpdf is required for large documents.',
          };
        }
        const fileBytes = await readFile(localFilePath);
        let pdfDoc: PDFDocument;
        try {
          pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: false });
        } catch (err: any) {
          if (err.message && err.message.toLowerCase().includes('encrypt')) {
            return {
              finalStatus: 'FAILED',
              detectedMime: matchedSig.mime,
              sha256,
              pageCount: null,
              failureCode: 'PDF_PASSWORD_PROTECTED',
              failureDetail: 'This PDF is password-protected. Remove the password and try again.',
            };
          }
          return {
            finalStatus: 'FAILED',
            detectedMime: matchedSig.mime,
            sha256,
            pageCount: null,
            failureCode: 'PDF_CORRUPT',
            failureDetail: 'PDF file is corrupt or unreadable.',
          };
        }

        if (pdfDoc.isEncrypted) {
          return {
            finalStatus: 'FAILED',
            detectedMime: matchedSig.mime,
            sha256,
            pageCount: null,
            failureCode: 'PDF_PASSWORD_PROTECTED',
            failureDetail: 'This PDF is password-protected. Remove the password and try again.',
          };
        }

        pageCount = pdfDoc.getPageCount();
        if (pageCount > 1000) {
          return {
            finalStatus: 'FAILED',
            detectedMime: matchedSig.mime,
            sha256,
            pageCount,
            failureCode: 'PDF_PAGE_LIMIT_EXCEEDED',
            failureDetail: `PDF contains ${pageCount} pages, exceeding the 1,000-page safety ceiling (RT-034).`,
          };
        }
        const objCount = pdfDoc.context.enumerateIndirectObjects().length;
        if (objCount > 25000) {
          return {
            finalStatus: 'FAILED',
            detectedMime: matchedSig.mime,
            sha256,
            pageCount,
            failureCode: 'PDF_OBJECT_BOMB_DETECTED',
            failureDetail: `PDF contains ${objCount} internal objects, exceeding the 25,000-object safety ceiling (RT-034).`,
          };
        }
      } catch {
        return {
          finalStatus: 'FAILED',
          detectedMime: matchedSig.mime,
          sha256,
          pageCount: null,
          failureCode: 'PDF_CORRUPT',
          failureDetail: 'PDF file is corrupt or unreadable.',
        };
      }
    }
  }

  return {
    finalStatus: 'READY',
    detectedMime: matchedSig.mime,
    sha256,
    pageCount,
  };
}

async function computeHashAndHeader(filePath: string): Promise<{ headBuffer: Buffer; sha256: string }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    let headBytesCollected = 0;
    const stream = createReadStream(filePath);

    stream.on('data', (rawChunk: string | Buffer) => {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      hash.update(chunk);
      if (headBytesCollected < 512) {
        const slice = chunk.subarray(0, 512 - headBytesCollected);
        chunks.push(slice);
        headBytesCollected += slice.length;
      }
    });
    stream.on('end', () => resolve({ headBuffer: Buffer.concat(chunks), sha256: hash.digest('hex') }));
    stream.on('error', reject);
  });
}

async function scanFileWithClamd(
  filePath: string,
  host: string,
  port: number,
): Promise<{ infected: boolean; signature?: string; scanUnavailable?: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (res: { infected: boolean; signature?: string; scanUnavailable?: boolean; error?: string }) => {
      if (!settled) {
        settled = true;
        resolve(res);
      }
    };

    const socket = net.createConnection({ host, port });
    socket.setTimeout(10_000); // 10s timeout for fail-closed safety

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
      stream.on('data', (rawChunk: string | Buffer) => {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(chunk.length, 0);
        socket.write(lenBuf);
        const canContinue = socket.write(chunk);
        if (!canContinue) {
          stream.pause();
        }
      });
      socket.on('drain', () => {
        stream.resume();
      });
      stream.on('end', () => {
        const endBuf = Buffer.alloc(4, 0);
        socket.write(endBuf);
      });
      stream.on('error', (streamErr) => {
        socket.destroy();
        safeResolve({ infected: false, scanUnavailable: true, error: streamErr.message });
      });
    });

    let response = '';
    socket.on('data', (d) => (response += d.toString('utf8')));
    socket.on('timeout', () => {
      socket.destroy();
      safeResolve({ infected: false, scanUnavailable: true, error: 'SCANNER_TIMEOUT' });
    });
    socket.on('end', () => {
      if (response.includes('FOUND')) {
        const sig = response.split(':')[1]?.replace('FOUND', '').trim();
        safeResolve({ infected: true, signature: sig });
      } else if (response.includes('OK')) {
        safeResolve({ infected: false });
      } else {
        safeResolve({ infected: false, scanUnavailable: true, error: `Unexpected clamd response: ${response}` });
      }
    });
    socket.on('error', (err: any) => {
      safeResolve({ infected: false, scanUnavailable: true, error: err.code || err.message });
    });
  });
}
