import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { Sha256Incremental, sha256BlobChunked } from '../src/lib/chunked-sha256';

test('incremental SHA-256 matches official empty/abc vectors and forbids reuse', () => {
  const empty = new Sha256Incremental();
  expect(empty.digestHex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(() => empty.update(new Uint8Array([1]))).toThrow('SHA256_ALREADY_FINALIZED');
  expect(new Sha256Incremental().update(new TextEncoder().encode('abc')).digestHex())
    .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('incremental SHA-256 matches Node crypto across 64-byte block/padding boundaries', async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 120, 121, 1023, 1024, 1048589]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 89 + (i >>> 3) * 17) & 255;
    const reference = createHash('sha256').update(bytes).digest('hex');

    const streaming = new Sha256Incremental();
    for (let offset = 0; offset < size; offset += 17) {
      streaming.update(bytes.subarray(offset, Math.min(size, offset + 17)));
    }
    expect(streaming.digestHex(), `direct update size=${size}`).toBe(reference);

    const blob = new Blob([Buffer.from(bytes)]);
    const chunked = await sha256BlobChunked(blob, 65536);
    expect(chunked, `blob size=${size}`).toBe(reference);
  }
});

test('bounded SHA-256 rejects memory-unbounded chunk sizes', async () => {
  await expect(sha256BlobChunked(new Blob(['safe']), 0)).rejects.toThrow('SHA256_CHUNK_SIZE_INVALID');
  await expect(sha256BlobChunked(new Blob(['safe']), 9 * 1024 * 1024)).rejects.toThrow('SHA256_CHUNK_SIZE_INVALID');
});
