import { HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { uuidv7 } from 'uuidv7';
import { compileHandoverDossierStreamingQpdf } from './pdf-stream-compiler';
import { isImmutableStorageVersion } from '@tradecloseout/shared';

type PackageJob = { orgId: string; projectId?: string; packageId?: string; entityId?: string; entityType?: string; eventId?: string };

const DEFAULT_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;
const JS_FALLBACK_MAX_SOURCE_BYTES = 128 * 1024 * 1024;

function configuredLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function decisionMethod(value: string | null): 'IN_APP' | 'EXTERNAL' | 'WAIVED' | null {
  return value === 'IN_APP' || value === 'EXTERNAL' || value === 'WAIVED' ? value : null;
}

/** Builds a frozen, version-pinned handover artifact and publishes READY only after S3 verification. */
export async function compileAndPersistHandoverPackage(
  pool: Pool,
  s3: S3Client,
  job: PackageJob,
  jobId: string,
  qpdfAvailable: boolean,
  attemptOwner: string = `PACKAGE_ATTEMPT:${uuidv7()}`,
): Promise<Record<string, unknown>> {
  const packageId = job.packageId || (job.entityId && job.entityType === 'HANDOVER_PACKAGE' ? job.entityId : undefined);
  const orgId = job.orgId;
  if (!packageId || !orgId) throw new Error('PACKAGE_IDENTITY_REQUIRED');

  // A BullMQ job ID identifies the logical command, not a worker attempt.
  // Hold an exclusive PostgreSQL session lock across read, file compilation,
  // S3 upload, and publication. Session death releases the lock on crashes.
  // This also allows a subsequent attempt to reclaim stale GENERATING rows.
  const owner = attemptOwner;
  if (!/^PACKAGE_ATTEMPT:[0-9a-f-]{36}$/i.test(owner)) {
    throw new Error('PACKAGE_ATTEMPT_OWNER_INVALID');
  }
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lock = await lockClient.query(
      `SELECT pg_try_advisory_lock(hashtext($1::text), hashtext($2::text)) AS acquired`,
      [orgId, packageId],
    );
    locked = lock.rows[0]?.acquired === true;
    if (!locked) throw new Error('PACKAGE_BUILD_ALREADY_RUNNING');

  const client = await pool.connect();
  let packageMeta: any;
  let packageRequirements: any[] = [];
  let sourceRows: any[] = [];
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
      [orgId],
    );
    const { rows: packages } = await client.query(
      `SELECT hp.id, hp.org_id, hp.project_id, hp.version_no, hp.status, hp.manifest_format_version,
              hp.snapshot_checksum, hp.created_at, hp.updated_at, hp.requested_by,
              hp.error_code, hp.pdf_object_id, hp.package_purpose,
              p.code AS project_code, p.name AS project_name,
              o.display_name AS org_name,
              COALESCE(contract.contract_ref, contract.reference, '') AS contract_ref,
              COALESCE(party.name, '') AS client_name
         FROM handover_packages hp
         JOIN projects p ON p.org_id = hp.org_id AND p.id = hp.project_id
         JOIN organisations o ON o.id = hp.org_id
         LEFT JOIN LATERAL (
           SELECT c.contract_ref, c.reference, c.party_id
             FROM contracts c
            WHERE c.org_id = hp.org_id AND c.project_id = hp.project_id AND c.status = 'ACTIVE'
            ORDER BY c.created_at DESC
            LIMIT 1
         ) contract ON true
         LEFT JOIN parties party ON party.org_id = hp.org_id AND party.id = contract.party_id
        WHERE hp.org_id = $1 AND hp.id = $2
        FOR UPDATE OF hp`,
      [orgId, packageId],
    );
    packageMeta = packages[0];
    if (!packageMeta) throw new Error('HANDOVER_PACKAGE_NOT_FOUND');
    if (packageMeta.status === 'READY' && packageMeta.pdf_object_id) {
      await client.query('COMMIT');
      return { packageId, status: 'READY', replayed: true };
    }
    if (packageMeta.manifest_format_version !== 2 || packageMeta.package_purpose !== 'FULL_HANDOVER') {
      throw new Error('PACKAGE_UNPINNED_MANIFEST_REQUIRES_REGENERATION');
    }
    // Advisory session ownership excludes a live competing attempt even when
    // BullMQ redelivers the same job ID. Reclaim a stalled GENERATING row only
    // after holding that lock; the former owner can no longer publish.
    // A truly active attempt causes PACKAGE_BUILD_ALREADY_RUNNING above.
    const claimed = await client.query(
      `UPDATE handover_packages
          SET status = 'GENERATING', error_code = $3, error_detail = NULL,
              row_version = row_version + 1, updated_at = now()
        WHERE org_id = $1 AND id = $2 AND status IN ('QUEUED','GENERATING')
        RETURNING id`,
      [orgId, packageId, owner],
    );
    if (claimed.rowCount !== 1) {
      await client.query('COMMIT');
      return { packageId, status: packageMeta.status, skipped: 'Package is not in a buildable state.' };
    }

    const { rows: requirements } = await client.query(
      `SELECT pr.requirement_key, pr.title, pr.asset_tag, pr.doc_type_key,
              pr.status_at_generation, pr.decision, pr.decided_by, pr.decision_method,
              pr.revision_code_at_generation AS revision_code
         FROM package_requirements pr
        WHERE pr.org_id = $1 AND pr.project_id = $2 AND pr.package_id = $3
        ORDER BY pr.requirement_key, pr.scope_key, pr.id`,
      [orgId, packageMeta.project_id, packageId],
    );
    packageRequirements = requirements;

    const { rows: itemCount } = await client.query(
      `SELECT count(*)::int AS included_count
         FROM package_items
        WHERE org_id = $1 AND project_id = $2 AND package_id = $3 AND included = true`,
      [orgId, packageMeta.project_id, packageId],
    );
    const { rows: items } = await client.query(
      `SELECT pi.document_version_id, pi.section_key, pi.sort_order,
              pi.source_document_id AS document_id, pi.source_object_id AS object_id,
              pi.source_revision_code AS revision_code, pi.source_title AS title,
              pi.source_bucket AS bucket, pi.source_object_key AS object_key,
              pi.source_mime AS mime, pi.source_size_bytes AS size_bytes,
              pi.source_size_bytes AS observed_size_bytes,
              pi.source_provider_version_id AS provider_version_id,
              pi.source_sha256 AS sha256,
              CASE WHEN pi.source_object_id IS NOT NULL THEN 'READY' ELSE 'UNPINNED' END AS object_status
         FROM package_items pi
        WHERE pi.org_id = $1 AND pi.project_id = $2 AND pi.package_id = $3 AND pi.included = true
        ORDER BY pi.sort_order, pi.id`,
      [orgId, packageMeta.project_id, packageId],
    );
    sourceRows = items;
    if (sourceRows.length !== Number(itemCount[0]?.included_count || 0)) {
      throw new Error('PACKAGE_MANIFEST_SOURCE_MISSING');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const maxSourceBytes = configuredLimit('PACKAGE_MAX_SOURCE_BYTES', DEFAULT_MAX_SOURCE_BYTES);
  let totalSourceBytes = 0;
  for (const source of sourceRows) {
    if (source.object_status !== 'READY' || !source.object_id || !source.document_id ||
        !source.bucket || !source.object_key || !source.title ||
        !isImmutableStorageVersion(source.provider_version_id) ||
        !/^[a-f0-9]{64}$/i.test(String(source.sha256 || '')) ||
        !Number.isSafeInteger(Number(source.size_bytes)) || Number(source.size_bytes) <= 0 ||
        Number(source.observed_size_bytes) !== Number(source.size_bytes)) {
      throw new Error(`PACKAGE_SOURCE_NOT_VERIFIED:${source.document_version_id}`);
    }
    if (source.mime !== 'application/pdf') {
      throw new Error(`PACKAGE_SOURCE_FORMAT_UNSUPPORTED:${source.document_version_id}:${source.mime}`);
    }
    totalSourceBytes += Number(source.size_bytes);
    if (!Number.isSafeInteger(totalSourceBytes) || totalSourceBytes > maxSourceBytes) {
      throw new Error('PACKAGE_SOURCE_SIZE_LIMIT_EXCEEDED');
    }
  }
  if (!qpdfAvailable && totalSourceBytes > JS_FALLBACK_MAX_SOURCE_BYTES) {
    throw new Error('PACKAGE_QPDF_REQUIRED_FOR_LARGE_INPUT');
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tradecloseout-package-'));
  try {
    const sourceFiles: Array<{
      documentVersionId: string;
      sectionKey: string;
      title: string;
      localPath: string;
      sha256: string;
    }> = [];

    for (let index = 0; index < sourceRows.length; index++) {
      const source = sourceRows[index];
      const localPath = path.join(tempDir, `source-${index + 1}.pdf`);
      const stored = await s3.send(new GetObjectCommand({
        Bucket: source.bucket,
        Key: source.object_key,
        VersionId: source.provider_version_id,
      }));
      if (!stored.Body) throw new Error(`PACKAGE_SOURCE_EMPTY:${source.document_version_id}`);
      await pipeline(
        Readable.from(stored.Body as AsyncIterable<Uint8Array>),
        createWriteStream(localPath, { flags: 'wx', mode: 0o600 }),
      );
      const fileStats = await stat(localPath);
      if (fileStats.size !== Number(source.size_bytes)) {
        throw new Error(`PACKAGE_SOURCE_SIZE_MISMATCH:${source.document_version_id}`);
      }
      const actualSha = await sha256File(localPath);
      if (actualSha.toLowerCase() !== String(source.sha256).toLowerCase()) {
        throw new Error(`PACKAGE_SOURCE_CHECKSUM_MISMATCH:${source.document_version_id}`);
      }
      sourceFiles.push({
        documentVersionId: source.document_version_id,
        sectionKey: source.section_key,
        title: source.title,
        localPath,
        sha256: source.sha256,
      });
    }

    const requirementsIndex = packageRequirements.map((requirement) => ({
      requirementKey: requirement.requirement_key,
      title: requirement.title,
      assetTag: requirement.asset_tag,
      docTypeKey: requirement.doc_type_key,
      revisionCode: (requirement as any).revision_code || 'R0',
      statusAtGeneration: requirement.status_at_generation,
      decidedBy: requirement.decided_by,
      decisionMethod: decisionMethod(requirement.decision_method),
    }));
    const outputPath = path.join(tempDir, 'handover-dossier.pdf');
    const compileResult = await compileHandoverDossierStreamingQpdf({
      packageId,
      versionNo: packageMeta.version_no,
      orgLegalName: packageMeta.org_name,
      projectCode: packageMeta.project_code,
      projectName: packageMeta.project_name,
      clientName: packageMeta.client_name,
      contractRef: packageMeta.contract_ref,
      snapshotChecksum: packageMeta.snapshot_checksum,
      generatedAtIst: new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(packageMeta.created_at)),
      requirementsIndex,
      sourceFiles,
    }, outputPath);

    const outputStats = await stat(outputPath);
    if (outputStats.size <= 0 || outputStats.size > MAX_OUTPUT_BYTES || outputStats.size !== compileResult.sizeBytes) {
      throw new Error('PACKAGE_OUTPUT_SIZE_INVALID');
    }
    const actualOutputSha = await sha256File(outputPath);
    if (actualOutputSha !== compileResult.pdfSha256) throw new Error('PACKAGE_OUTPUT_CHECKSUM_MISMATCH');

    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error('PACKAGE_STORAGE_NOT_CONFIGURED');
    const artifactId = uuidv7();
    const objectKey = `organisations/${orgId}/projects/${packageMeta.project_id}/handover/${packageId}/${artifactId}.pdf`;
    const putResult = await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: createReadStream(outputPath),
      ContentLength: outputStats.size,
      ContentType: 'application/pdf',
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: Buffer.from(actualOutputSha, 'hex').toString('base64'),
      Metadata: { sha256: actualOutputSha, packageid: packageId },
      ServerSideEncryption: process.env.S3_KMS_KEY_ID ? 'aws:kms' : undefined,
      SSEKMSKeyId: process.env.S3_KMS_KEY_ID || undefined,
    }));
    if (!isImmutableStorageVersion(putResult.VersionId)) throw new Error('PACKAGE_STORAGE_VERSION_ID_MISSING');
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey, VersionId: putResult.VersionId }));
    if (head.ContentLength !== outputStats.size || head.VersionId !== putResult.VersionId ||
        head.Metadata?.sha256 !== actualOutputSha) {
      throw new Error('PACKAGE_STORAGE_VERIFICATION_FAILED');
    }

    let persistClient: PoolClient | undefined;
    let committedReady = false;
    try {
      persistClient = await pool.connect();
      await persistClient.query('BEGIN');
      await persistClient.query(
        `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
        [orgId],
      );
      const { rows: current } = await persistClient.query(
        `SELECT status, error_code FROM handover_packages
          WHERE org_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
        [orgId, packageMeta.project_id, packageId],
      );
      if (!current.length || current[0].status !== 'GENERATING' || current[0].error_code !== owner) {
        throw new Error('PACKAGE_BUILD_LEASE_LOST');
      }
      await persistClient.query(
        `INSERT INTO storage_objects
          (id, org_id, provider, bucket, object_key, original_filename, mime, size_bytes,
           expected_sha256, observed_size_bytes, provider_version_id, sha256, status, created_by, updated_at)
         VALUES ($1, $2, 'S3', $3, $4, $5, 'application/pdf', $6, $7, $6, $8, $7, 'READY', $9, now())`,
        [artifactId, orgId, bucket, objectKey, `handover-${packageMeta.project_code}-v${packageMeta.version_no}.pdf`,
          outputStats.size, actualOutputSha, putResult.VersionId, packageMeta.requested_by],
      );
      for (const range of compileResult.itemPageRanges) {
        await persistClient.query(
          `UPDATE package_items
              SET page_start = $5, page_end = $6
            WHERE org_id = $1 AND project_id = $2 AND package_id = $3
              AND document_version_id = $4 AND included = true`,
          [orgId, packageMeta.project_id, packageId, range.documentVersionId, range.pageStart, range.pageEnd],
        );
      }
      const updated = await persistClient.query(
        `UPDATE handover_packages
            SET status = 'READY', pdf_object_id = $4, checksum = $5,
                error_code = NULL, error_detail = NULL,
                row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3
            AND status = 'GENERATING' AND error_code = $6`,
        [orgId, packageMeta.project_id, packageId, artifactId, actualOutputSha, owner],
      );
      if (updated.rowCount !== 1) throw new Error('PACKAGE_READY_COMPARE_AND_SET_FAILED');
      await persistClient.query(
        `INSERT INTO audit_events
          (id, org_id, project_id, actor_type, actor_user_id, action, entity_type, entity_id,
           before_json, after_json, ip, user_agent, request_id, created_at)
         VALUES ($1, $2, $3, 'SYSTEM', NULL, 'HANDOVER_PACKAGE_ARTIFACT_READY',
                 'HANDOVER_PACKAGE', $4, $5::jsonb, $6::jsonb, NULL, 'tradecloseout-worker', $7, now())`,
        [uuidv7(), orgId, packageMeta.project_id, packageId,
          JSON.stringify({ status: 'GENERATING' }),
          JSON.stringify({ status: 'READY', objectId: artifactId, sha256: actualOutputSha,
            sizeBytes: outputStats.size, totalPages: compileResult.totalPages,
            includedSourceCount: sourceRows.length }),
          String(job.eventId || jobId)],
      );
      await persistClient.query('COMMIT');
      committedReady = true;
      return {
        packageId,
        status: 'READY',
        pdfObjectId: artifactId,
        checksum: actualOutputSha,
        sizeBytes: outputStats.size,
        totalPages: compileResult.totalPages,
        includedSourceCount: sourceRows.length,
      };
    } catch (error) {
      await persistClient?.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      persistClient?.release();
      if (!committedReady) {
        // The key is unique to this attempt, so remove only the unpublished
        // immutable version. A failed cleanup is visible for reconciliation.
        // Crash-after-upload still needs an independent orphan sweeper.
        try {
          await s3.send(new DeleteObjectCommand({
            Bucket: bucket, Key: objectKey, VersionId: putResult.VersionId,
          }));
        } catch (cleanupError) {
          console.error('PACKAGE_UNPUBLISHED_OBJECT_CLEANUP_FAILED', {
            packageId, artifactId, objectKey,
            reason: String((cleanupError as Error)?.message || 'provider error').slice(0, 150),
          });
        }
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  } finally {
    if (locked) {
      try {
        await lockClient.query(
          `SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))`,
          [orgId, packageId],
        );
      } catch {
        // A disconnected PostgreSQL session has already lost its advisory lock.
      }
    }
    lockClient.release();
  }
}

export async function markHandoverPackageFailed(
  pool: Pool,
  job: PackageJob,
  jobId: string,
  error: unknown,
  attemptOwner: string,
): Promise<void> {
  const packageId = job.packageId || (job.entityId && job.entityType === 'HANDOVER_PACKAGE' ? job.entityId : undefined);
  if (!packageId || !job.orgId || !/^PACKAGE_ATTEMPT:[0-9a-f-]{36}$/i.test(attemptOwner)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
      [job.orgId],
    );
    await client.query(
      `UPDATE handover_packages
          SET status = 'FAILED', error_code = 'PACKAGE_BUILD_FAILED',
              error_detail = $4, row_version = row_version + 1, updated_at = now()
        WHERE org_id = $1 AND id = $2 AND status = 'GENERATING' AND error_code = $3`,
      [job.orgId, packageId, attemptOwner,
        String((error as Error)?.message || 'Package build failed').slice(0, 1000)],
    );
    await client.query('COMMIT');
  } catch (persistError) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(`Could not persist package failure for ${packageId}:`, persistError);
  } finally {
    client.release();
  }
}
