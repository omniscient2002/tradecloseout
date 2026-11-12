import { Pool } from 'pg';
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
import { lockStorageCapacity, reconcileStorageCapacity } from '@tradecloseout/db';
import { TradeCloseoutScheduler } from './scheduler';
import { verifyAndScanUploadedFile } from './queues/file.processor';
import { convertSupportingFormatToPdf } from './queues/format-converter';
import { compileAndPersistHandoverPackage, markHandoverPackageFailed } from './queues/handover-package.processor';
import { compileAndPersistPortableArchive } from './queues/portable-archive.processor';
import { BoundedByteStream } from './queues/bounded-stream';
import { dispatchDueOutbox } from './outbox-dispatch';
import { validateWorkerStartupConfig, assertWorkerRuntimeDatabasePrivileges } from './worker-startup-security';

const execFileAsync = promisify(execFile);

// In production/staging no development fallback may be selected. Connection
// setup is lazy; bootWorker validates configuration and actual DB identity
// before scheduling, polling or consuming a single tenant job.
const nonProd = ['development','test'].includes(process.env.NODE_ENV || '');
const pool = new Pool({
  connectionString: process.env.APP_DATABASE_URL ||
    (nonProd ? 'postgres://tc_app:tc_app_pass@127.0.0.1:5432/tradecloseout' : ''),
});
const redis = new Redis(process.env.REDIS_URL ||
  (nonProd ? 'redis://127.0.0.1:6379' : 'redis://invalid.invalid:6379'), {
  maxRetriesPerRequest: null,
  lazyConnect: true,
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
    const { stdout } = await execFileAsync('qpdf', ['--version']);
    console.log('✓ qpdf engine detected:', stdout.split('\n')[0]);
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

  validateWorkerStartupConfig();
  if (['staging','production'].includes(process.env.NODE_ENV || '')) {
    await assertWorkerRuntimeDatabasePrivileges(pool);
  }
  // A successful TCP connection alone is not proof the queue is available.
  await redis.connect();
  await redis.ping();
  await checkDependencies();
  if (['staging','production'].includes(process.env.NODE_ENV || '') && !qpdfAvailable) {
    throw new Error('BOOT_WORKER_QPDF_REQUIRED');
  }

  // PH1-G24-006/010: the cycle and the outbox poller must never overlap
  // with themselves; shutdown stops new admission and drains known in-flight work.
  let shuttingDown = false;
  let scheduledInFlight: Promise<void> | null = null;
  let outboxInFlight: Promise<void> | null = null;
  const runWithSafePeriodLock = async (
    ...args: Parameters<typeof scheduler.runWithPeriodLock>
  ): Promise<void> => {
    try {
      await scheduler.runWithPeriodLock(...args);
    } catch {
      // Each task retains its own durable period lock / retry opportunity.
      // Failure of one task must not starve another task on the same tick.
      console.error('SCHEDULER_PERIOD_TASK_FAILED');
    }
  };

  // 1. Scheduled Background Tasks
  const runScheduledCycles = async () => {
    try {
      const periods = scheduler.getIndiaSchedulePeriods();
      await runWithSafePeriodLock(
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
        await runWithSafePeriodLock(
          `weekly-owner-digest:${periods.week}`,
          `sched:done:weekly-owner-digest:${periods.week}`,
          600,
          9 * 24 * 60 * 60,
          async () => scheduler.runWeeklyOwnerRetentionAtRiskDigest(),
        );
      }

      await runWithSafePeriodLock(
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

      await runWithSafePeriodLock(
        `storage-lifecycle-cleanup:${periods.hourSlot}`,
        `sched:done:storage-lifecycle-cleanup:${periods.hourSlot}`,
        300,
        2 * 60 * 60,
        async () => {
          const { expiredVersions, expiredObjects } = await scheduler.runStorageLifecycleCleanup();
          if (expiredVersions > 0 || expiredObjects > 0) {
            console.log(
              `[Scheduler] Expired ${expiredVersions} stale upload versions and ${expiredObjects} pending objects; provider cleanup requires confirmation.`,
            );
          }
        },
      );

      await runWithSafePeriodLock(
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

      await runWithSafePeriodLock(
        `auth-ephemera:${periods.hourSlot}`,
        `sched:done:auth-ephemera:${periods.hourSlot}`,
        300, 2 * 60 * 60,
        async () => {
          const removed = await scheduler.cleanupAuthenticationEphemera();
          if (removed.budgets || removed.challenges || removed.sessions) {
            console.log(`[Scheduler] Purged ${removed.budgets} expired auth budgets, ${removed.challenges} old OTPs and ${removed.sessions} old sessions.`);
          }
        },
      );

      await runWithSafePeriodLock(
        `g01-invitation-reconciliation:${periods.hourSlot}`,
        `sched:done:g01-invitation-reconciliation:${periods.hourSlot}`,
        300,2*60*60,
        async()=>{
          const outcome=await scheduler.cleanupStaleInvitations();
          if(outcome.staleDelivery||outcome.expired){
            console.log(
              `[Scheduler] G01 invalidated ${outcome.staleDelivery} stale unconfirmed invitations and ${outcome.expired} expired invitation links.`,
            );
          }
        },
      );

      try {
        await scheduler.reconcileAuthenticationDeliveries();
      } catch {
        console.error('SCHEDULER_AUTH_DELIVERY_FAILED');
      }

      // Notification delivery is independently scheduled: delivery ledger
      // outage must not block queued notifications or vice versa.
      try {
        const sentNotifications = await scheduler.dispatchQueuedNotifications();
        if (sentNotifications > 0) {
          console.log(`[Scheduler] Dispatched ${sentNotifications} queued notifications.`);
        }
      } catch {
        console.error('SCHEDULER_NOTIFICATION_DELIVERY_FAILED');
      }
    } catch (err) {
      console.error('[Scheduler Error]:', err);
    }
  };

  await runScheduledCycles();
  const scheduleTick = () => {
    if (shuttingDown || scheduledInFlight) return;
    scheduledInFlight = runScheduledCycles().finally(() => {
      scheduledInFlight = null;
    });
  };
  const cycleInterval = setInterval(scheduleTick, 60 * 1000);

  // 2. BullMQ Queues
  const fileQueue = new Queue('file-processing', { connection: redis });
  const pdfQueue = new Queue('pdf-compilation', { connection: redis });
  const formatQueue = new Queue('format-conversion', { connection: redis });
  const archiveQueue = new Queue('archive-export', { connection: redis });

  // 3. BullMQ Workers
  const fileWorker = new Worker(
    'file-processing',
    async (job) => {
      console.log(`[BullMQ] Processing file job ${job.id}`);
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
          const {rows:scope}=await client.query(`SELECT project_id FROM document_versions
            WHERE org_id=$1 AND id=$2 AND object_id=$3`,[orgId,versionId,storageObjectId]);
          if(scope[0]?.project_id)await client.query(`SELECT id FROM projects
            WHERE org_id=$1 AND id=$2 FOR UPDATE`,[orgId,scope[0].project_id]);
          await lockStorageCapacity(client,orgId);
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
            await client.query(
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
            // The mutex prevents a reservation from seeing the transitional
            // state; canonical rows prevent retry/dedup/shared-object overcharge.
            await reconcileStorageCapacity(client,orgId);
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
    },
    { connection: redis, concurrency: 4 },
  );

  const pdfWorker = new Worker(
    'pdf-compilation',
    async (job) => {
      console.log(`[BullMQ] Compiling PDF package job ${job.id}`);
      try {
        return await compileAndPersistHandoverPackage(pool, s3, job.data, String(job.id), qpdfAvailable);
      } catch (err) {
        if (job.attemptsMade + 1 >= Number(job.opts.attempts || 1)) {
          await markHandoverPackageFailed(pool, job.data, String(job.id), err);
        }
        throw err;
      }
    },
    { connection: redis, concurrency: 2 },
  );

  const formatWorker = new Worker(
    'format-conversion',
    async (job) => {
      console.log(`[BullMQ] Converting format job ${job.id}`);
      return await convertSupportingFormatToPdf(job.data);
    },
    { connection: redis, concurrency: 2 },
  );

  const archiveWorker = new Worker(
    'archive-export',
    async (job) => {
      console.log(`[BullMQ] Compiling portable archive job ${job.id}`);
      return await compileAndPersistPortableArchive(pool, s3, job.data);
    },
    { connection: redis, concurrency: 2 },
  );

  fileWorker.on('failed', async (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
    if (!job || job.attemptsMade < Number(job.opts.attempts || 1)) return;

    const { orgId, versionId, storageObjectId, providerVersionId } = job.data;
    if (!orgId || !versionId || !storageObjectId || !providerVersionId) return;

    const failureCode = String(err?.message || '').startsWith('SCAN_UNAVAILABLE:')
      ? 'SCAN_UNAVAILABLE'
      : 'PROCESSING_RETRIES_EXHAUSTED';
    const client = await pool.connect();
    try {
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
      await client.query('ROLLBACK').catch(() => {});
      console.error(`Could not persist terminal file failure for job ${job.id}:`, persistError);
    } finally {
      client.release();
    }
  });
  pdfWorker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
    if (job && job.attemptsMade >= Number(job.opts.attempts || 1)) {
      void markHandoverPackageFailed(pool, job.data, String(job.id), err);
    }
  });
  formatWorker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));

  // 4. Outbox claim/dispatch/ack, every 2s. Queue/network work is outside
  // every tenant DB transaction; each claim has a fenced, expiring owner token.
  const pollOutbox = async () => {
    try {
      const result = await dispatchDueOutbox(pool, async (eventType, payload, eventId) => {
        if (eventType === 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN') {
          await fileQueue.add('scan', payload, {
            jobId: `file-scan-${eventId}`,
            attempts: 3, backoff: {type:'exponential',delay:1000},
          });
        } else if (eventType === 'HANDOVER_PACKAGE_QUEUED') {
          await pdfQueue.add('compile', payload, {
            jobId: `pdf-compile-${eventId}`,
            attempts: 2, backoff: {type:'fixed',delay:2000},
          });
        } else if (eventType === 'PROJECT_ARCHIVE_EXPORT_QUEUED') {
          await archiveQueue.add('export', payload, {
            jobId: `archive-export-${eventId}`,
            attempts: 2, backoff: {type:'fixed',delay:2000},
          });
        } else {
          throw new Error('OUTBOX_EVENT_INVALID');
        }
      });
      if (result.failed) {
        console.error('OUTBOX_DISPATCH_FAILURES', {failed:result.failed});
      }
    } catch {
      // Never forward raw provider errors, payloads, or tenant identifiers.
      console.error('OUTBOX_POLL_FAILED');
    }
  };

  const outboxTick = () => {
    if (shuttingDown || outboxInFlight) return;
    outboxInFlight = pollOutbox().finally(() => {
      outboxInFlight = null;
    });
  };
  const outboxInterval = setInterval(outboxTick, 2000);

  console.log('✓ TradeCloseout Worker, BullMQ Queues & Leader-Locked Schedulers are ACTIVE.');

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down TradeCloseout Worker...');
    clearInterval(cycleInterval);
    clearInterval(outboxInterval);
    const pending = [scheduledInFlight, outboxInFlight].filter(
      (task): task is Promise<void> => task !== null,
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise<boolean>(resolve => {
        deadline = setTimeout(() => resolve(false), 30_000);
      }),
    ]);
    if (deadline) clearTimeout(deadline);
    if (!drained) {
      // An uncertain in-flight outcome must not be announced as a clean exit.
      // Durable claims are left for recovery; the supervisor observes failure.
      console.error('WORKER_INFLIGHT_DRAIN_TIMEOUT');
      process.exit(1);
    }
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
    console.error('Worker failed to boot:', err);
    process.exit(1);
  });
}

export { bootWorker, scheduler };
