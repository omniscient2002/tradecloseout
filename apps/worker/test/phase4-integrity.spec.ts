import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { isImmutableStorageVersion } from '@tradecloseout/shared';
import { assertPdfHasNoActiveActions, sanitizeAndCheckPdfBomb, compileHandoverDossierStreamingQpdf } from '../src/queues/pdf-stream-compiler';

const exec = promisify(execFile);

test('PH4-G14-004: immutable version identity denies unversioned and malformed provider receipts', () => {
  for (const version of [null, undefined, '', 'null', 'NULL', ' undefined ', 'none',
    'unversioned', 'valid\nversion', ' padded ', 123]) {
    assert.equal(isImmutableStorageVersion(version), false, String(version));
  }
  assert.equal(isImmutableStorageVersion('3HL4kqtJlcpXrof3'), true);
});

test('PH4-G25-001/002: live PDF compiler rejects page-level JavaScript without changing original bytes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'phase4-pdf-'));
  try {
    const clean = path.join(dir, 'clean.pdf');
    const unsafe = path.join(dir, 'unsafe.pdf');
    const output = path.join(dir, 'dossier.pdf');
    const unsafeOutput = path.join(dir, 'sanitized.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).drawText('Inspection');
    await writeFile(clean, await doc.save());
    const bad = await PDFDocument.load(await (await import('node:fs/promises')).readFile(clean));
    const action = bad.context.obj({
      S: PDFName.of('JavaScript'),
      JS: PDFString.of('app.alert("executed")'),
    });
    bad.getPage(0).node.set(PDFName.of('AA'), bad.context.obj({ O: action }));
    await writeFile(unsafe, await bad.save());
    const hasQpdf = await exec('qpdf', ['--version']).then(() => true).catch(() => false);
    await assert.doesNotReject(assertPdfHasNoActiveActions(clean, hasQpdf));
    await assert.rejects(assertPdfHasNoActiveActions(unsafe, hasQpdf), /PDF_ACTIVE_CONTENT_REJECTED/);
    const result = await sanitizeAndCheckPdfBomb(unsafe, unsafeOutput);
    assert.equal(result.safe, false, 'sanitizer must fail closed, not claim stripped scripts');
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    const sha = createHash('sha256').update(await readFile(unsafe)).digest('hex');
    await assert.rejects(
      compileHandoverDossierStreamingQpdf({
        packageId: 'phase4-test',
        versionNo: 1,
        orgLegalName: 'Test organisation',
        projectCode: 'P4',
        projectName: 'Fixture',
        clientName: 'Customer',
        contractRef: 'C4',
        snapshotChecksum: 'a'.repeat(64),
        generatedAtIst: '12 Nov 2026',
        requirementsIndex: [],
        sourceFiles: [{
          documentVersionId: 'bad-version',
          sectionKey: 'TEST',
          title: 'Unsafe',
          localPath: unsafe,
          sha256: sha,
        }],
      }, output),
      /PDF_ACTIVE_CONTENT_REJECTED/,
    );
    assert.equal(createHash('sha256').update(await readFile(unsafe)).digest('hex'), sha);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
