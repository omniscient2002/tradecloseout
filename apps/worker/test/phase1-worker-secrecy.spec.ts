import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyAndScanUploadedFile } from '../src/queues/file.processor';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jobFingerprint, reportWorkerFailure, safeWorkerErrorCategory,
} from '../src/safe-worker-errors';

const canary = 'SYNTHETIC_PRIVATE_CANARY_XYZ';

test('PH1-G27-005: routine worker logging does not serialize arbitrary error details', () => {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    const err = Object.assign(new Error(canary), { code: '40P01', cause: { detail: canary } });
    reportWorkerFailure('OUTBOX_EVENT_DISPATCH_FAILED', err, 'job-' + canary);
    assert.equal(calls.length, 1);
    const record = JSON.parse(String(calls[0][0]));
    assert.equal(record.errorCategory, 'DB_DEADLOCK');
    assert.equal(record.jobFingerprint, jobFingerprint('job-' + canary));
    assert(!JSON.stringify(calls).includes(canary));
  } finally {
    console.error = original;
  }
});

test('PH1-G27-005: error class mapping cannot be tricked by inherited keys or getters', () => {
  assert.equal(safeWorkerErrorCategory({ code: 'constructor' }), 'UNCLASSIFIED');
  assert.equal(safeWorkerErrorCategory({ code: 'toString' }), 'UNCLASSIFIED');
  assert.equal(safeWorkerErrorCategory({ code: canary }), 'UNCLASSIFIED');
  const hostile = Object.defineProperty({}, 'code', { get() { throw new Error(canary); } });
  assert.equal(safeWorkerErrorCategory(hostile), 'UNCLASSIFIED');
  assert.equal(safeWorkerErrorCategory({ code: 'ETIMEDOUT' }), 'DEPENDENCY_TIMEOUT');
  assert.equal(jobFingerprint({ toString() { throw new Error(canary); } }), null);
});

test('PH1-G27-005: untrusted scanner protocol response stays out of job failure reason', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'tc-scanner-check-'));
  const filename = path.join(scratch, 'valid-signature.png');
  const image = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4,5]);
  await writeFile(filename, image);
  const digest = createHash('sha256').update(image).digest('hex');
  const scanner = createServer(socket => {
    let data = Buffer.alloc(0);
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 14 && data.subarray(-4).equals(Buffer.alloc(4))) {
        socket.end('stream: ' + canary + ' ERROR\n');
      }
    });
  });
  const originalBypass = process.env.ALLOW_UNENFORCED_SCANNER_IN_TEST;
  process.env.ALLOW_UNENFORCED_SCANNER_IN_TEST = 'false';
  try {
    await new Promise<void>((resolve, reject) => {
      scanner.once('error', reject);
      scanner.listen(0, '127.0.0.1', resolve);
    });
    const port = (scanner.address() as AddressInfo).port;
    await assert.rejects(
      verifyAndScanUploadedFile(filename, 'valid-signature.png', digest, '127.0.0.1', port),
      (err: unknown) => {
        assert(err instanceof Error);
        assert.equal(err.message, 'SCAN_UNAVAILABLE: Antivirus scanner connection failed');
        assert(!String(err.stack).includes(canary));
        return true;
      },
    );
  } finally {
    if (originalBypass === undefined) delete process.env.ALLOW_UNENFORCED_SCANNER_IN_TEST;
    else process.env.ALLOW_UNENFORCED_SCANNER_IN_TEST = originalBypass;
    await new Promise<void>(resolve => scanner.close(() => resolve()));
    await rm(scratch, { recursive: true, force: true });
  }
});
