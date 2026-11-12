/**
 * Incremental SHA-256 for original browser Blobs. WebCrypto subtle.digest()
 * cannot accept a stream and materializing a 100 MiB file in one ArrayBuffer
 * causes avoidable mobile-memory spikes. This implements FIPS 180-4 SHA-256,
 * processing only 64-byte blocks and bounded 1 MiB Blob slices.
 *
 * This preserves the ORIGINAL evidence bytes; compression is never implicit.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotateRight(n: number, by: number): number {
  return (n >>> by) | (n << (32 - by));
}

export class Sha256Incremental {
  private readonly state = new Uint32Array(INITIAL);
  private readonly schedule = new Uint32Array(64);
  private readonly pending = new Uint8Array(64);
  private pendingSize = 0;
  private originalLength = 0;
  private finished = false;

  update(bytes: Uint8Array): this {
    if (this.finished) throw new Error('SHA256_ALREADY_FINALIZED');
    if (!(bytes instanceof Uint8Array)) throw new Error('SHA256_INVALID_INPUT');
    this.originalLength += bytes.length;
    if (!Number.isSafeInteger(this.originalLength) || this.originalLength > 0x1fffffffffffff / 8) {
      throw new Error('SHA256_INPUT_TOO_LARGE');
    }
    let offset = 0;
    if (this.pendingSize > 0) {
      const length = Math.min(64 - this.pendingSize, bytes.length);
      this.pending.set(bytes.subarray(0, length), this.pendingSize);
      this.pendingSize += length;
      offset += length;
      if (this.pendingSize === 64) {
        this.compress(this.pending);
        this.pendingSize = 0;
      }
    }
    while (offset + 64 <= bytes.length) {
      this.compress(bytes.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < bytes.length) {
      this.pending.set(bytes.subarray(offset), this.pendingSize);
      this.pendingSize += bytes.length - offset;
    }
    return this;
  }

  digestHex(): string {
    if (this.finished) throw new Error('SHA256_ALREADY_FINALIZED');
    this.finished = true;
    const bits = this.originalLength * 8;
    this.pending[this.pendingSize++] = 0x80;
    if (this.pendingSize > 56) {
      this.pending.fill(0, this.pendingSize, 64);
      this.compress(this.pending);
      this.pendingSize = 0;
    }
    this.pending.fill(0, this.pendingSize, 56);
    const view = new DataView(this.pending.buffer);
    view.setUint32(56, Math.floor(bits / 0x100000000), false);
    view.setUint32(60, bits >>> 0, false);
    this.compress(this.pending);

    return Array.from(this.state)
      .map((word) => word.toString(16).padStart(8, '0'))
      .join('');
  }

  private compress(block: Uint8Array): void {
    const view = new DataView(block.buffer, block.byteOffset, 64);
    const w = this.schedule;
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = Array.from(this.state);
    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

export async function sha256BlobChunked(file: Blob, chunkBytes = 1024 * 1024): Promise<string> {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 64 || chunkBytes > 8 * 1024 * 1024) {
    throw new Error('SHA256_CHUNK_SIZE_INVALID');
  }
  const digest = new Sha256Incremental();
  let chunkNo = 0;
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    const bytes = new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer());
    digest.update(bytes);
    // Yield to input/painting; never hold a whole 100 MiB original in memory.
    if (++chunkNo % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return digest.digestHex();
}
