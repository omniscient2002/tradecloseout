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
