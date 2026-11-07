import { Transform, TransformCallback } from 'stream';

/**
 * Finding N19 / V09: Enforce streamed byte limits and transfer cancellation to protect disk and memory.
 * Rejects NaN, Infinity, negative, zero, or non-finite inputs to prevent uncapped disk consumption.
 */
export class BoundedByteStream extends Transform {
  private totalBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytesInput: number) {
    super();
    const parsed = Number(maxBytesInput);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isSafeInteger(parsed)) {
      throw new TypeError(`INVALID_BYTE_CEILING: expected positive safe integer, got ${maxBytesInput}`);
    }
    this.maxBytes = parsed;
  }

  _transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.maxBytes) {
      callback(new Error(`STREAM_SIZE_LIMIT_EXCEEDED: transferred ${this.totalBytes} bytes, exceeding ceiling ${this.maxBytes}`));
      return;
    }
    callback(null, chunk);
  }
}
