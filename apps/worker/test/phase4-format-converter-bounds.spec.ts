import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, truncate, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertSupportingFormatToPdf, assertConverterWorkspace } from '../src/queues/format-converter';

test('PH4-G25-003: converter fails closed on unbounded image and Office input before reading bytes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ph4-converter-'));
  try {
    const png = path.join(dir, 'oversized.png');
    const docx = path.join(dir, 'oversized.docx');
    await writeFile(png, 'png');
    await writeFile(docx, 'docx');
    // Sparse files exercise metadata-based size rejection without allocating memory.
    await truncate(png, 25 * 1024 * 1024 + 1);
    await truncate(docx, 40 * 1024 * 1024 + 1);
    for (const [file, mime] of [
      [png, 'image/png'],
      [docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ]) {
      await assert.rejects(
        convertSupportingFormatToPdf({
          sourcePath: file, detectedMime: mime,
          outputPdfPath: path.join(dir, 'out.pdf'), headerStampText: 'Inspection',
        }),
        /CONVERSION_SOURCE_RESOURCE_LIMIT/,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PH4-G25-003: generic ZIP cannot be passed to the Office converter', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ph4-zip-'));
  try {
    const source = path.join(dir, 'arbitrary.zip');
    await writeFile(source, 'not an approved Office document');
    const outcome = await convertSupportingFormatToPdf({
      sourcePath: source, detectedMime: 'application/zip',
      outputPdfPath: path.join(dir, 'converted.pdf'), headerStampText: 'Test',
    });
    assert.deepEqual(outcome, { converted: false, pageCount: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PH4-G25-003: reject invalid paths and empty sources', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ph4-input-'));
  try {
    const file = path.join(dir, 'empty.png');
    await writeFile(file, '');
    await assert.rejects(convertSupportingFormatToPdf({
      sourcePath: file, detectedMime: 'image/png',
      outputPdfPath: path.join(dir, 'converted.pdf'), headerStampText: 'Inspection',
    }), /CONVERSION_SOURCE_RESOURCE_LIMIT/);
    await assert.rejects(convertSupportingFormatToPdf({
      sourcePath: 'relative.png', detectedMime: 'image/png',
      outputPdfPath: path.join(dir, 'converted.pdf'), headerStampText: 'Inspection',
    }), /CONVERSION_SOURCE_PATH_INVALID/);
    await assert.rejects(convertSupportingFormatToPdf({
      sourcePath: file, detectedMime: 'image/png',
      outputPdfPath: file, headerStampText: 'Inspection',
    }), /CONVERSION_INPUT_INVALID/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PH4-G25-003: deployed converter rejects traversal, symlink parents and unsafe output targets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ph4-converter-root-'));
  const outsider = await mkdtemp(path.join(os.tmpdir(), 'ph4-converter-other-'));
  try {
    const source = path.join(root, 'fixture.png');
    const out = path.join(root, 'converted.pdf');
    const external = path.join(outsider, 'secret.png');
    await writeFile(source, 'src');
    await writeFile(external, 'secret');
    await assert.doesNotReject(assertConverterWorkspace(source, out, root));
    await assert.rejects(assertConverterWorkspace(external, out, root), /CONVERSION_WORKSPACE_ESCAPE/);
    await assert.rejects(assertConverterWorkspace(source, path.join(outsider, 'out.pdf'), root),
      /CONVERSION_WORKSPACE_ESCAPE/);
    const alias = path.join(root, 'escape-dir');
    await symlink(outsider, alias);
    await assert.rejects(assertConverterWorkspace(source, path.join(alias, 'out.pdf'), root),
      /CONVERSION_WORKSPACE_ESCAPE/);
    await symlink(external, out);
    await assert.rejects(assertConverterWorkspace(source, out, root), /CONVERSION_OUTPUT_TARGET_UNSAFE/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsider, { recursive: true, force: true });
  }
});

test('PH4-G25-003: compressed PNG pixel bomb is rejected before attempting decode', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ph4-png-pixels-'));
  try {
    const image = path.join(dir, 'huge.png');
    const header = Buffer.alloc(33);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'ascii');
    header.writeUInt32BE(100_000, 16);
    header.writeUInt32BE(100_000, 20);
    await writeFile(image, header);
    await assert.rejects(
      convertSupportingFormatToPdf({
        sourcePath: image, detectedMime: 'image/png',
        outputPdfPath: path.join(dir, 'out.pdf'), headerStampText: 'Inspection',
      }),
      /CONVERSION_IMAGE_PIXELS_EXCEEDED/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
