import { GetObjectCommand, PutObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { uuidv7 } from 'uuidv7';
import { ZipArchive } from 'archiver';
import { canonicalJson, isImmutableStorageVersion } from '@tradecloseout/shared';
import { archiveVerifierHtml } from './archive-verifier';

export type ArchiveExportJob = { exportId: string; orgId: string; projectId: string };
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

async function verifiedStream(body: any, expectedSize: number, expectedSha: string, destination?: string) {
  if (!body) throw new Error('ARCHIVE_OBJECT_BODY_MISSING');
  let size = 0;
  const hash = createHash('sha256');
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > expectedSize) return callback(new Error('ARCHIVE_OBJECT_SIZE_MISMATCH'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const sink = destination ? createWriteStream(destination, { flags: 'wx', mode: 0o600 })
    : new Transform({ transform(_chunk, _encoding, callback) { callback(); } });
  await pipeline(Readable.from(body as AsyncIterable<Uint8Array>), meter, sink);
  if (size !== expectedSize || hash.digest('hex') !== expectedSha) throw new Error('ARCHIVE_OBJECT_DIGEST_MISMATCH');
}

async function bind(client: PoolClient, orgId: string) {
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [orgId]);
}

export async function compileAndPersistPortableArchive(pool: Pool, s3: S3Client, job: ArchiveExportJob) {
  const { exportId, orgId, projectId } = job;
  if (![exportId, orgId, projectId].every(id => /^[a-f0-9-]{36}$/i.test(id))) throw new Error('INVALID_ARCHIVE_SCOPE');
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('ARCHIVE_STORAGE_UNAVAILABLE');
  const client = await pool.connect();
  let locked = false;
  let tempDir: string | undefined;
  let claimed = false;
  try {
    // Session lock serializes the whole storage workflow across workers/retries.
    const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired`, [orgId, exportId]);
    locked = lock.rows[0]?.acquired === true;
    if (!locked) throw new Error('ARCHIVE_EXPORT_BUSY');
    await bind(client, orgId);
    const { rows } = await client.query(`SELECT * FROM archive_exports WHERE org_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`, [orgId, projectId, exportId]);
    const row = rows[0];
    if (!row) throw new Error('ARCHIVE_EXPORT_NOT_FOUND');
    const artifact = row.verification_receipt_json?.artifact;
    if (row.status === 'COMPLETED') {
      if (!isImmutableStorageVersion(artifact?.providerVersionId) || !artifact?.objectKey || artifact.bucket !== bucket || !row.archive_sha256)
        throw new Error('ARCHIVE_COMPLETION_RECEIPT_INVALID');
      const stored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: artifact.objectKey, VersionId: artifact.providerVersionId }));
      if (stored.VersionId !== artifact.providerVersionId) throw new Error('ARCHIVE_OBJECT_VERSION_MISMATCH');
      const archiveSize = Number(artifact.sizeBytes);
      if (!Number.isSafeInteger(archiveSize) || archiveSize <= 0 || archiveSize > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_OUTPUT_LIMIT');
      await verifiedStream(stored.Body, archiveSize, row.archive_sha256);
      await client.query('COMMIT');
      return { exportId, status: 'COMPLETED' as const, archiveSha256: row.archive_sha256, totalBytes: archiveSize };
    }
    if (!['PENDING', 'PROCESSING', 'FAILED'].includes(row.status)) throw new Error('ARCHIVE_EXPORT_STATE_INVALID');
    const manifest = row.manifest_json;
    if (!manifest || manifest.export_id !== exportId || manifest.project?.id !== projectId || !Array.isArray(manifest.objects))
      throw new Error('ARCHIVE_MANIFEST_INVALID');
    const manifestJson = canonicalJson(manifest);
    const manifestSha = createHash('sha256').update(manifestJson).digest('hex');
    if (manifestSha !== row.verification_receipt_json?.manifest_sha256) throw new Error('ARCHIVE_MANIFEST_DIGEST_MISMATCH');
    const paths = new Set<string>();
    let sourceBytes = 0;
    for (const object of manifest.objects) {
      if (!object.bucket || !object.object_key || !isImmutableStorageVersion(object.provider_version_id) || !/^[a-f0-9]{64}$/.test(object.sha256) ||
          !/^[a-f0-9-]{36}$/i.test(object.version_id) || object.archive_path !== `evidence/${object.version_id}` || paths.has(object.archive_path))
        throw new Error('ARCHIVE_SOURCE_IDENTITY_INVALID');
      const size = Number(object.size_bytes);
      if (!Number.isSafeInteger(size) || size <= 0) throw new Error('ARCHIVE_SOURCE_SIZE_INVALID');
      sourceBytes += size;
      if (sourceBytes > MAX_SOURCE_BYTES) throw new Error('ARCHIVE_SOURCE_LIMIT');
      paths.add(object.archive_path);
    }
    if (Number(row.total_objects) !== paths.size || String(manifest.summary?.total_documents) !== String(paths.size) ||
        String(manifest.summary?.total_bytes) !== String(sourceBytes)) throw new Error('ARCHIVE_MANIFEST_TOTAL_MISMATCH');
    await client.query(`UPDATE archive_exports SET status = 'PROCESSING' WHERE org_id = $1 AND id = $2`, [orgId, exportId]);
    await client.query('COMMIT');
    claimed = true;
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'tradecloseout-archive-'));
    await mkdir(path.join(tempDir, 'evidence'));
    await writeFile(path.join(tempDir, 'manifest.json'), manifestJson);
    await writeFile(path.join(tempDir, 'verification_receipt.json'), canonicalJson(row.verification_receipt_json));
    await writeFile(path.join(tempDir, 'verify.html'), archiveVerifierHtml(manifestSha));
    for (const object of manifest.objects) {
      const stored = await s3.send(new GetObjectCommand({ Bucket: object.bucket, Key: object.object_key, VersionId: object.provider_version_id }));
      if (stored.VersionId !== object.provider_version_id) throw new Error('ARCHIVE_OBJECT_VERSION_MISMATCH');
      await verifiedStream(stored.Body, Number(object.size_bytes), object.sha256, path.join(tempDir, object.archive_path));
    }
    const zipPath = path.join(tempDir, 'portable-archive.zip');
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const output = createWriteStream(zipPath, { flags: 'wx', mode: 0o600 });
    let outputBytes = 0;
    const zipWritten = pipeline(archive, new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        outputBytes += chunk.length;
        callback(outputBytes > MAX_ARCHIVE_BYTES ? new Error('ARCHIVE_OUTPUT_LIMIT') : null, chunk);
      },
    }), output);
    archive.file(path.join(tempDir, 'manifest.json'), { name: 'manifest.json' });
    archive.file(path.join(tempDir, 'verification_receipt.json'), { name: 'verification_receipt.json' });
    archive.file(path.join(tempDir, 'verify.html'), { name: 'verify.html' });
    archive.directory(path.join(tempDir, 'evidence'), 'evidence');
    await Promise.all([archive.finalize(), zipWritten]);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
    const archiveSha256 = hash.digest('hex');
    const objectKey = `archives/${orgId}/${projectId}/${exportId}/${uuidv7()}.zip`;
    const put = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: 'application/zip',
      ContentLength: outputBytes, ChecksumSHA256: Buffer.from(archiveSha256, 'hex').toString('base64'), Body: createReadStream(zipPath) }));
    if (!isImmutableStorageVersion(put.VersionId)) throw new Error('ARCHIVE_VERSIONING_REQUIRED');
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey, VersionId: put.VersionId }));
    if (head.ContentLength !== outputBytes || head.VersionId !== put.VersionId) throw new Error('ARCHIVE_OUTPUT_RECEIPT_MISMATCH');
    const readback = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey, VersionId: put.VersionId }));
    if (readback.VersionId !== put.VersionId) throw new Error('ARCHIVE_OBJECT_VERSION_MISMATCH');
    await verifiedStream(readback.Body, outputBytes, archiveSha256);
    const objectId = uuidv7();
    await bind(client, orgId);
    await client.query(`INSERT INTO storage_objects
      (id, org_id, bucket, object_key, size_bytes, observed_size_bytes, mime, sha256, status, provider_version_id)
      VALUES ($1, $2, $3, $4, $5, $5, 'application/zip', $6, 'READY', $7)`,
      [objectId, orgId, bucket, objectKey, outputBytes, archiveSha256, put.VersionId]);
    await client.query(`UPDATE archive_exports SET status = 'COMPLETED', archive_sha256 = $1, completed_at = now(),
      verification_receipt_json = verification_receipt_json || $2::jsonb WHERE org_id = $3 AND project_id = $4 AND id = $5`,
      [archiveSha256, JSON.stringify({ artifact: { objectId, bucket, objectKey, providerVersionId: put.VersionId, sizeBytes: outputBytes, sha256: archiveSha256 } }), orgId, projectId, exportId]);
    await client.query('COMMIT');
    return { exportId, status: 'COMPLETED' as const, archiveSha256, totalBytes: outputBytes };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (claimed) {
      await bind(client, orgId);
      await client.query(`UPDATE archive_exports SET status = 'FAILED' WHERE org_id = $1 AND project_id = $2 AND id = $3 AND status <> 'COMPLETED'`, [orgId, projectId, exportId]);
      await client.query('COMMIT');
    }
    throw error;
  } finally {
    try {
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
      if (locked) await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [orgId, exportId]);
    } finally { client.release(); }
  }
}
