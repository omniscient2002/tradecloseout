import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Worker, Queue } from 'bullmq';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { reconcileStorageQuotaOnFileStatusChange } from '@tradecloseout/db/tenant-tx';
import { TradeCloseoutScheduler } from './scheduler';
import { verifyAndScanUploadedFile } from './queues/file.processor';
import { convertSupportingFormatToPdf } from './queues/format-converter';
import { compileAndPersistHandoverPackage, markHandoverPackageFailed } from './queues/handover-package.processor';
import { compileAndPersistPortableArchive } from './queues/portable-archive.processor';
import { BoundedByteStream } from './queues/bounded-stream';
import { OUTBOX_EVENT_REGISTRY } from './event-registry';
import { jobFingerprint, reportWorkerFailure, protectQueueJob } from './safe-worker-errors';

const execFileAsync = promisify(execFile);

const pool = new Pool({
  connectionString:
    process.env.APP_DATABASE_URL ||
    'postgres://tc_app:tc_app_pass@127.0.0.1:5432/tradecloseout',
});

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

const scheduler = new TradeCloseoutScheduler(pool, redis);
let qpdfAvailable = false;
const s3 = new S3Client({
  region: process.env.AWS_REGION || process.env.S3_REGION || 'ap-south-1',
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY } }
    : process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } }
      : {}),
});

async function checkDependencies() {
  try {
    await execFileAsync('qpdf', ['--version']);
    console.log('✓ qpdf engine detected');
    qpdfAvailable = true;
  } catch {
    console.warn('! qpdf binary not found in PATH; install qpdf for out-of-process PDF linearization.');
    qpdfAvailable = false;
  }
}

async function bootWorker() {
  console.log('======================================================================');
  console.log('TradeCloseout Background Worker & Leader-Locked Scheduler Booting...');
  console.log('======================================================================');

  await checkDependencies();

  // 1. Scheduled Background Tasks
  const runScheduledCycles = async () => {
    try {
      const periods = scheduler.getIndiaSchedulePeriods();
      await scheduler.runWithPeriodLock(
        `daily-expiry:${periods.day}`,
        `sched:done:daily-expiry:${periods.day}`,
        300,
        36 * 60 * 60,
        async () => {
        const expired = await scheduler.runDailyExpiryJob();
        if (expired > 0) {
          console.log(`[Scheduler] Marked ${expired} expired requirements.`);
        }
        },
      );

      if (periods.weekday === 'Mon') {
        await scheduler.runWithPeriodLock(
          `weekly-owner-digest:${periods.week}`,
          `sched:done:weekly-owner-digest:${periods.week}`,
          600,
          9 * 24 * 60 * 60,
          async () => scheduler.runWeeklyOwnerRetentionAtRiskDigest(),
        );
      }

      await scheduler.runWithPeriodLock(
        `audit-hash-chain:${periods.day}`,
        `sched:done:audit-hash-chain:${periods.day}`,
        600,
        36 * 60 * 60,
        async () => {
          const { orgCount, verifiedEvents } = await scheduler.verifyAuditHashChainIntegrity();
          if (verifiedEvents > 0) {
            console.log(`[Scheduler] Verified audit hash-chain integrity across ${orgCount} orgs (${verifiedEvents} events).`);
          }
        },
      );

      await scheduler.runWithPeriodLock(
        `storage-lifecycle-cleanup:${periods.hourSlot}`,
        `sched:done:storage-lifecycle-cleanup:${periods.hourSlot}`,
        300,
        2 * 60 * 60,
        async () => {
          const { purgedPendingVersions, purgedPendingObjects } = await scheduler.runStorageLifecycleCleanup();
          if (purgedPendingVersions > 0 || purgedPendingObjects > 0) {
            console.log(
              `[Scheduler] Cleaned up ${purgedPendingVersions} stale pending versions and ${purgedPendingObjects} unattached pending objects.`,
            );
          }
        },
      );

      await scheduler.runWithPeriodLock(
        `idempotency-reconciliation:${periods.hourSlot}`,
        `sched:done:idempotency-reconciliation:${periods.hourSlot}`,
        300,
        2 * 60 * 60,
        async () => {
          const count = await scheduler.reconcileIdempotencyClaims();
          if (count > 0) {
            console.log(`[Scheduler] Purged ${count} expired completed idempotency receipts.`);
          }
        },
      );

      // Notification delivery cycle honoring IST quiet hours
      const sentNotifications = await scheduler.dispatchQueuedNotifications();
      if (sentNotifications > 0) {
        console.log(`[Scheduler] Dispatched ${sentNotifications} queued notifications.`);
      }
    } catch (err) {
      reportWorkerFailure('SCHEDULER_CYCLE_FAILED', err);
    }
  };

  await runScheduledCycles();
  const cycleInterval = setInterval(runScheduledCycles, 60 * 1000);

  // 2. BullMQ Queues
  const fileQueue = new Queue('file-processing', { connection: redis });
  const pdfQueue = new Queue('pdf-compilation', { connection: redis });
  const formatQueue = new Queue('format-conversion', { connection: redis });
  const archiveQueue = new Queue('archive-export', { connection: redis });

  // 3. BullMQ Workers
  const fileWorker = new Worker(
    'file-processing',
    async (job) => protectQueueJob('file', async () => {
      console.log(`[BullMQ] Processing file job ${jobFingerprint(job.id) ?? 'unknown'}`);
      const { originalFilename, expectedSha256, clamdHost, clamdPort, versionId, orgId, storageObjectId,
        bucket, objectKey, providerVersionId } = job.data;
      if (!versionId || !orgId || !storageObjectId || !bucket || !objectKey || !providerVersionId) {
        throw new Error('FILE_SCAN_SOURCE_UNAVAILABLE: event is missing tenant-bound immutable storage identity');
      }
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tradecloseout-scan-'));
      const localFilePath = path.join(tempDir, 'source.bin');
      let result;
      try {
        const storedObject = await s3.send(new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          VersionId: providerVersionId,
        }));
        if (!storedObject.Body) throw new Error('OBJECT_STORAGE_EMPTY_RESPONSE');

        // N19 / V09: Bounded streaming transform with validated finite positive integer ceiling
        const rawExpected = Number(job.data.expectedSizeBytes);
        const validatedExpected = Number.isFinite(rawExpected) && rawExpected > 0 && Number.isSafeInteger(rawExpected)
          ? rawExpected
          : 100 * 1024 * 1024;
        const maxScanBytes = Math.min(validatedExpected, 100 * 1024 * 1024); // 100 MB ceiling

        const byteLimiter = new BoundedByteStream(maxScanBytes);
        await pipeline(
          Readable.from(storedObject.Body as AsyncIterable<Uint8Array>),
          byteLimiter,
          createWriteStream(localFilePath, { flags: 'wx', mode: 0o600 }),
          { signal: AbortSignal.timeout(60_000) },
        );
        result = await verifyAndScanUploadedFile(
          localFilePath,
          originalFilename || path.basename(objectKey),
          expectedSha256,
          clamdHost,
          clamdPort,
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }

      // Atomically update database with verification result (TC2-001 & TC2-002)
      if (versionId && orgId) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [orgId]);
          const { rows: currentRows } = await client.query(
            `SELECT dv.file_status, so.status AS storage_status, so.provider_version_id
               FROM document_versions dv
               JOIN storage_objects so ON so.org_id = dv.org_id AND so.id = dv.object_id
              WHERE dv.org_id = $1 AND dv.id = $2 AND so.id = $3
              FOR UPDATE OF dv, so`,
            [orgId, versionId, storageObjectId],
          );
          const current = currentRows[0];
          if (!current || current.file_status !== 'PROCESSING' ||
              current.storage_status !== 'PROCESSING' || current.provider_version_id !== providerVersionId) {
            await client.query('COMMIT');
            return { ...result, finalStatus: 'IGNORED_STALE_RECEIPT' };
          }
          if (result.finalStatus === 'READY') {
            const updRes = await client.query(
              `UPDATE document_versions
                  SET file_status = 'READY',
                      updated_at = now()
                WHERE id = $1 AND org_id = $2 AND object_id = $3 AND file_status = 'PROCESSING'
                RETURNING id`,
              [versionId, orgId, storageObjectId],
            );
            if (storageObjectId) {
              await client.query(
                `UPDATE storage_objects
                    SET status = 'READY',
                        sha256 = COALESCE($3, sha256),
                        updated_at = now()
                  WHERE id = $1 AND org_id = $2 AND status = 'PROCESSING'
                    AND provider_version_id = $4`,
                [storageObjectId, orgId, result.sha256, providerVersionId],
              );
            }
            // Idempotent storage quota accounting (TC2-024)
            if (updRes.rows.length > 0 && storageObjectId) {
              const { rows: soRows } = await client.query(
                `SELECT size_bytes FROM storage_objects WHERE id = $1 AND org_id = $2`,
                [storageObjectId, orgId],
              );
              if (soRows.length > 0 && soRows[0].size_bytes) {
                const sizeBytes = BigInt(soRows[0].size_bytes);
                await reconcileStorageQuotaOnFileStatusChange(client, orgId, sizeBytes, 'MARKED_READY');
              }
            }
          } else if (result.finalStatus === 'QUARANTINED') {
            await client.query(
              `UPDATE document_versions
                  SET file_status = 'QUARANTINED',
                      review_status = 'REJECTED',
                      updated_at = now()
                WHERE id = $1 AND org_id = $2 AND object_id = $3 AND file_status = 'PROCESSING'`,
              [versionId, orgId, storageObjectId],
            );
            if (storageObjectId) {
              await client.query(
                `UPDATE storage_objects
                    SET status = 'QUARANTINED',
                        updated_at = now()
                  WHERE id = $1 AND org_id = $2 AND status = 'PROCESSING'
                    AND provider_version_id = $3`,
                [storageObjectId, orgId, providerVersionId],
              );
            }
          } else {
            await client.query(
              `UPDATE document_versions
                  SET file_status = 'FAILED',
                      updated_at = now()
                WHERE id = $1 AND org_id = $2 AND object_id = $3 AND file_status = 'PROCESSING'`,
              [versionId, orgId, storageObjectId],
            );
            if (storageObjectId) {
              await client.query(
                `UPDATE storage_objects
                    SET status = 'FAILED',
                        updated_at = now()
                  WHERE id = $1 AND org_id = $2 AND status = 'PROCESSING'
                    AND provider_version_id = $3`,
                [storageObjectId, orgId, providerVersionId],
              );
            }
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }

      return result;
    }),
    { connection: redis, concurrency: 4 },
  );

  const pdfWorker = new Worker(
    'pdf-compilation',
    async (job) => protectQueueJob('pdf', async () => {
      console.log(`[BullMQ] Compiling PDF package job ${jobFingerprint(job.id) ?? 'unknown'}`);
      try {
        return await compileAndPersistHandoverPackage(pool, s3, job.data, String(job.id), qpdfAvailable);
      } catch (err) {
        if (job.attemptsMade + 1 >= Number(job.opts.attempts || 1)) {
          await markHandoverPackageFailed(pool, job.data, String(job.id), err);
        }
        throw err;
      }
    }),
    { connection: redis, concurrency: 2 },
  );

  const formatWorker = new Worker(
    'format-conversion',
    async (job) => protectQueueJob('format', async () => {
      console.log(`[BullMQ] Converting format job ${jobFingerprint(job.id) ?? 'unknown'}`);
      return await convertSupportingFormatToPdf(job.data);
    }),
    { connection: redis, concurrency: 2 },
  );

  const archiveWorker = new Worker(
    'archive-export',
    async (job) => protectQueueJob('archive', async () => {
      console.log(`[BullMQ] Compiling portable archive job ${jobFingerprint(job.id) ?? 'unknown'}`);
      return await compileAndPersistPortableArchive(pool, s3, job.data);
    }),
    { connection: redis, concurrency: 2 },
  );

  fileWorker.on('failed', async (job, err) => {
    reportWorkerFailure('FILE_JOB_FAILED', err, job?.id);
    if (!job || job.attemptsMade < Number(job.opts.attempts || 1)) return;

    const { orgId, versionId, storageObjectId, providerVersionId } = job.data;
    if (!orgId || !versionId || !storageObjectId || !providerVersionId) return;

    const failureCode = String(err?.message || '').startsWith('SCAN_UNAVAILABLE:')
      ? 'SCAN_UNAVAILABLE'
      : 'PROCESSING_RETRIES_EXHAUSTED';
    // EventEmitter does not await async listeners: connection acquisition must
    // be inside the catch boundary as well as the SQL writes.
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
        [orgId],
      );
      const failed = await client.query(
        `UPDATE document_versions dv
            SET file_status = 'FAILED',
                checks_json = COALESCE(dv.checks_json, '{}'::jsonb) || $5::jsonb,
                updated_at = now()
          WHERE dv.org_id = $1 AND dv.id = $2 AND dv.object_id = $3
            AND dv.file_status = 'PROCESSING'
            AND EXISTS (
              SELECT 1 FROM storage_objects so
               WHERE so.org_id = $1 AND so.id = $3 AND so.status = 'PROCESSING'
                 AND so.provider_version_id = $4
            )`,
        [orgId, versionId, storageObjectId, providerVersionId, JSON.stringify({
          failureCode,
          failureDetail: 'File processing retries were exhausted. Verify storage and scanner health, then retry processing or upload a new revision.',
          attempts: job.attemptsMade,
          recordedAt: new Date().toISOString(),
        })],
      );
      if ((failed.rowCount || 0) > 0) {
        await client.query(
          `UPDATE storage_objects
              SET status = 'FAILED', updated_at = now()
            WHERE org_id = $1 AND id = $2 AND status = 'PROCESSING'
              AND provider_version_id = $3`,
          [orgId, storageObjectId, providerVersionId],
        );
      }
      await client.query('COMMIT');
    } catch (persistError) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      reportWorkerFailure('FILE_FAILURE_PERSIST_FAILED', persistError, job.id);
    } finally {
      client?.release();
    }
  });
  pdfWorker.on('failed', (job, err) => {
    reportWorkerFailure('PDF_JOB_FAILED', err, job?.id);
    if (job && job.attemptsMade >= Number(job.opts.attempts || 1)) {
      void markHandoverPackageFailed(pool, job.data, String(job.id), err)
        .catch(persistError => reportWorkerFailure('PACKAGE_FAILURE_PERSIST_FAILED', persistError, job.id));
    }
  });
  formatWorker.on('failed', (job, err) => reportWorkerFailure('FORMAT_JOB_FAILED', err, job?.id));
  archiveWorker.on('failed', (job, err) => reportWorkerFailure('ARCHIVE_JOB_FAILED', err, job?.id));

  // 4. Outbox Poller (every 2s) with durable transaction locking (TC2-005)
  const pollOutbox = async () => {
    try {
      // organisations is the only global discovery surface. Event rows themselves are
      // never queried until app.current_org has been set in a tenant-bound transaction.
      const { rows: orgRows } = await pool.query(
        `SELECT id FROM organisations WHERE status <> 'DELETED' ORDER BY id`,
      );

      for (const { id: orgId } of orgRows) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`,
            [orgId],
          );
          const { rows } = await client.query(
            `SELECT id, org_id, project_id, event_type, payload_json
               FROM outbox_events
              WHERE org_id = $1 AND dispatched_at IS NULL AND attempts < 5
              ORDER BY created_at ASC
              LIMIT 20
              FOR UPDATE SKIP LOCKED`,
            [orgId],
          );

          for (const row of rows) {
            try {
              const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
              const fullPayload = {
                ...payload,
                orgId: row.org_id,
                projectId: payload.projectId || row.project_id,
                eventId: row.id,
              };

              const reg = OUTBOX_EVENT_REGISTRY[row.event_type];
              if (!reg) {
                throw new Error(`UNKNOWN_OUTBOX_EVENT_TYPE: ${row.event_type} (${row.id}) is not registered in the outbox event catalog`);
              }

              if (row.event_type === 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN') {
                await fileQueue.add('scan', fullPayload, {
                  jobId: `file-scan-${row.id}`,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1000 },
                });
              } else if (row.event_type === 'HANDOVER_PACKAGE_QUEUED') {
                await pdfQueue.add('compile', fullPayload, {
                  jobId: `pdf-compile-${row.id}`,
                  attempts: 2,
                  backoff: { type: 'fixed', delay: 2000 },
                });
              } else if (row.event_type === 'PROJECT_ARCHIVE_EXPORT_QUEUED') {
                await archiveQueue.add('export', fullPayload, {
                  jobId: `archive-export-${row.id}`,
                  attempts: 2,
                  backoff: { type: 'fixed', delay: 2000 },
                });
              } else if (reg.category === 'INFORMATIONAL') {
                // Registered informational domain events are acknowledged for downstream audit / notification
                console.log('[Outbox Poller] Dispatched registered informational event');
              } else {
                throw new Error(`UNHANDLED_EXECUTABLE_OUTBOX_EVENT: ${row.event_type} (${row.id})`);
              }

              await client.query(
                `UPDATE outbox_events SET dispatched_at = now()
                  WHERE org_id = $1 AND id = $2 AND dispatched_at IS NULL`,
                [orgId, row.id],
              );
            } catch (dispatchErr) {
              reportWorkerFailure('OUTBOX_EVENT_DISPATCH_FAILED', dispatchErr, row.id);
              await client.query(
                `UPDATE outbox_events SET attempts = attempts + 1 WHERE org_id = $1 AND id = $2`,
                [orgId, row.id],
              );
            }
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          reportWorkerFailure('OUTBOX_TENANT_POLL_FAILED', err);
        } finally {
          client.release();
        }
      }
    } catch (err) {
      reportWorkerFailure('OUTBOX_POLLER_FAILED', err);
    }
  };

  const outboxInterval = setInterval(pollOutbox, 2000);

  console.log('✓ TradeCloseout Worker, BullMQ Queues & Leader-Locked Schedulers are ACTIVE.');

  const shutdown = async () => {
    console.log('Shutting down TradeCloseout Worker...');
    clearInterval(cycleInterval);
    clearInterval(outboxInterval);
    await Promise.all([fileWorker.close(), pdfWorker.close(), formatWorker.close(), archiveWorker.close()]);
    await Promise.all([fileQueue.close(), pdfQueue.close(), formatQueue.close(), archiveQueue.close()]);
    await pool.end();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  bootWorker().catch((err) => {
    reportWorkerFailure('WORKER_BOOT_FAILED', err);
    process.exit(1);
  });
}

export { bootWorker, scheduler };
