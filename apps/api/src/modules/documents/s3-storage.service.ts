import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectStoragePresigner } from './documents.service';
import { isImmutableStorageVersion } from '@tradecloseout/shared';

const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024;
const MULTIPART_PART_BYTES = 5 * 1024 * 1024;

@Injectable()
export class S3StorageService implements ObjectStoragePresigner {
  private readonly bucket = process.env.S3_BUCKET || '';
  private readonly region = process.env.AWS_REGION || process.env.S3_REGION || 'ap-south-1';
  private readonly endpoint = process.env.S3_ENDPOINT || undefined;
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: this.region,
      ...(this.endpoint ? { endpoint: this.endpoint, forcePathStyle: true } : {}),
      ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
        ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY } }
        : process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? { credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } }
          : {}),
    });
  }

  async createUploadUrls(params: {
    objectKey: string;
    sizeBytes: number;
    mimeType?: string;
  }): Promise<{
    uploadId: string | null;
    partSizeBytes: number;
    parts: Array<{ partNumber: number; uploadUrl: string; requiredHeaders: Record<string, string> }>;
  }> {
    this.assertConfigured();
    if (!Number.isSafeInteger(params.sizeBytes) || params.sizeBytes < 1) {
      throw new UnprocessableEntityException('INVALID_UPLOAD_SIZE');
    }
    const mimeType = params.mimeType || 'application/octet-stream';

    if (params.sizeBytes <= MULTIPART_THRESHOLD_BYTES) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        ContentType: mimeType,
      });
      return {
        uploadId: null,
        partSizeBytes: params.sizeBytes,
        parts: [{
          partNumber: 1,
          uploadUrl: await getSignedUrl(this.client, command, { expiresIn: 3600 }),
          requiredHeaders: { 'content-type': mimeType },
        }],
      };
    }

    const initiated = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: params.objectKey,
      ContentType: mimeType,
    }));
    if (!initiated.UploadId) {
      throw new ServiceUnavailableException('OBJECT_STORAGE_DID_NOT_CREATE_MULTIPART_SESSION');
    }

    const partCount = Math.ceil(params.sizeBytes / MULTIPART_PART_BYTES);
    const parts = await Promise.all(Array.from({ length: partCount }, async (_, index) => {
      const partNumber = index + 1;
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        UploadId: initiated.UploadId!,
        PartNumber: partNumber,
      });
      return {
        partNumber,
        uploadUrl: await getSignedUrl(this.client, command, { expiresIn: 3600 }),
        requiredHeaders: {},
      };
    }));
    return { uploadId: initiated.UploadId, partSizeBytes: MULTIPART_PART_BYTES, parts };
  }

  async finalizeUpload(params: {
    objectKey: string;
    uploadId: string | null;
    expectedSizeBytes: number;
    parts?: Array<{ partNumber: number; etag?: string }>;
  }): Promise<{ observedSizeBytes: number; versionId: string }> {
    this.assertConfigured();
    let completionError: unknown;
    if (params.uploadId) {
      const parts = [...(params.parts || [])]
        .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag)
        .sort((a, b) => a.partNumber - b.partNumber);
      const expectedPartCount = Math.ceil(params.expectedSizeBytes / MULTIPART_PART_BYTES);
      if (parts.length !== expectedPartCount ||
          parts.some((part, index) => part.partNumber !== index + 1) ||
          new Set(parts.map((part) => part.partNumber)).size !== parts.length) {
        throw new UnprocessableEntityException('MULTIPART_COMPLETION_PARTS_INVALID');
      }
      let listed;
      try {
        listed = await this.client.send(new ListPartsCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          UploadId: params.uploadId,
        }));
      } catch (err) {
        // Continue only if an earlier request already completed this exact-size object.
        const prior = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: params.objectKey })).catch(() => null);
        if (prior?.ContentLength === params.expectedSizeBytes && prior.VersionId) {
          return { observedSizeBytes: prior.ContentLength, versionId: prior.VersionId };
        }
        throw err;
      }
      const providerParts = new Map((listed.Parts || []).map((part) => [part.PartNumber, part]));
      let providerSize = 0;
      for (const part of parts) {
        const providerPart = providerParts.get(part.partNumber);
        if (!providerPart?.ETag || providerPart.ETag !== part.etag) {
          throw new UnprocessableEntityException('MULTIPART_PART_RECEIPT_MISMATCH');
        }
        providerSize += providerPart.Size || 0;
      }
      if (providerParts.size !== expectedPartCount || providerSize !== params.expectedSizeBytes) {
        throw new UnprocessableEntityException('MULTIPART_PROVIDER_SIZE_MISMATCH');
      }
      try {
        await this.client.send(new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          UploadId: params.uploadId,
          MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: providerParts.get(part.partNumber)!.ETag })) },
        }));
      } catch (err) {
        // A retry after provider completion but before DB commit sees NoSuchUpload. The pinned
        // HEAD below decides whether the prior attempt actually completed this exact object.
        completionError = err;
      }
    }

    let head;
    try {
      head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: params.objectKey }));
    } catch (err) {
      throw completionError || err;
    }
    if (head.ContentLength !== params.expectedSizeBytes) {
      throw new UnprocessableEntityException({
        code: 'UPLOADED_SIZE_MISMATCH',
        detail: `Provider object size ${head.ContentLength ?? 'unknown'} does not match declared size ${params.expectedSizeBytes}.`,
      });
    }
    if (!isImmutableStorageVersion(head.VersionId)) {
      throw new ServiceUnavailableException({
        code: 'OBJECT_VERSIONING_REQUIRED',
        detail: 'The storage bucket did not return an immutable object version. Enable provider versioning before accepting uploads.',
      });
    }
    return { observedSizeBytes: head.ContentLength, versionId: head.VersionId };
  }

  async refreshUploadUrls(params: { objectKey: string; uploadId: string; sizeBytes: number }) {
    this.assertConfigured();
    const listed = await this.client.send(new ListPartsCommand({
      Bucket: this.bucket,
      Key: params.objectKey,
      UploadId: params.uploadId,
    }));
    const completed = new Set((listed.Parts || []).map((part) => part.PartNumber));
    const partCount = Math.ceil(params.sizeBytes / MULTIPART_PART_BYTES);
    const parts = await Promise.all(Array.from({ length: partCount }, async (_, index) => {
      const partNumber = index + 1;
      if (completed.has(partNumber)) return null;
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        UploadId: params.uploadId,
        PartNumber: partNumber,
      });
      return {
        partNumber,
        uploadUrl: await getSignedUrl(this.client, command, { expiresIn: 3600 }),
        requiredHeaders: {},
      };
    }));
    return { parts: parts.filter((part): part is NonNullable<typeof part> => Boolean(part)), expiresInSeconds: 3600 };
  }

  async abortUpload(params: { objectKey: string; uploadId: string | null }): Promise<void> {
    this.assertConfigured();
    if (params.uploadId) {
      try {
        await this.client.send(new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          UploadId: params.uploadId,
        }));
        return;
      } catch {
        // Completion may have succeeded before the DB receipt was committed; inspect and remove
        // that exact version below rather than leaving a reusable pending object behind.
      }
    }
    try {
      const current = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: params.objectKey }));
      if (current.VersionId) {
        await this.client.send(new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          VersionId: current.VersionId,
        }));
      }
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode !== 404 && err?.name !== 'NotFound' && err?.name !== 'NoSuchKey') throw err;
    }
  }

  async createSignedDownloadUrl(params: {
    objectKey: string;
    filename?: string;
    inline?: boolean;
    versionId?: string;
    bucket?: string;
  }): Promise<string> {
    this.assertConfigured();
    const targetBucket = params.bucket || this.bucket;
    const dispositionType = params.inline ? 'inline' : 'attachment';
    const disposition = params.filename
      ? `${dispositionType}; filename="${encodeURIComponent(params.filename)}"`
      : dispositionType;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: targetBucket,
        Key: params.objectKey,
        VersionId: params.versionId,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: 900 },
    );
  }

  async fetchObject(params: {
    objectKey: string;
    versionId: string;
    range?: string;
  }): Promise<AsyncIterable<Uint8Array>> {
    this.assertConfigured();
    const commandInput: any = {
      Bucket: this.bucket,
      Key: params.objectKey,
      VersionId: params.versionId,
    };
    if (params.range) {
      commandInput.Range = params.range;
    }
    const result = await this.client.send(new GetObjectCommand(commandInput));
    if (!result.Body) throw new ServiceUnavailableException('OBJECT_STORAGE_EMPTY_RESPONSE');
    return result.Body as AsyncIterable<Uint8Array>;
  }

  private assertConfigured(): void {
    if (!this.bucket) {
      throw new ServiceUnavailableException({
        code: 'OBJECT_STORAGE_UNAVAILABLE',
        detail: 'S3_BUCKET is not configured; no storage operation was performed.',
      });
    }
  }
}
