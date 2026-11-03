import { Pool } from 'pg';
import Redis from 'ioredis';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Worker, Queue } from 'bullmq';
import { TradeCloseoutScheduler } from './scheduler';
import { verifyAndScanUploadedFile } from './queues/file.processor';
import { compileHandoverDossierStreamingQpdf } from './queues/pdf-stream-compiler';
import { convertSupportingFormatToPdf } from './queues/format-converter';

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

async function checkDependencies() {
  try {
    const { stdout } = await execFileAsync('qpdf', ['--version']);
    console.log('✓ qpdf engine detected:', stdout.split('\n')[0]);
  } catch {
    console.warn('! qpdf binary not found in PATH; install qpdf for out-of-process PDF linearization.');
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
      await scheduler.runWithLeaderLock('daily-expiry', 300, async () => {
        const expired = await scheduler.runDailyExpiryJob();
        if (expired > 0) {
          console.log(`[Scheduler] Marked ${expired} expired requirements.`);
        }
      });

      await scheduler.runWithLeaderLock('weekly-owner-digest', 600, async () => {
        await scheduler.runWeeklyOwnerRetentionAtRiskDigest();
      });

      await scheduler.runWithLeaderLock('audit-hash-chain', 60, async () => {
        const { orgCount, verifiedEvents } = await scheduler.verifyAuditHashChainIntegrity();
        if (verifiedEvents > 0) {
          console.log(`[Scheduler] Verified audit hash-chain integrity across ${orgCount} orgs (${verifiedEvents} events).`);
        }
      });
    } catch (err) {
      console.error('[Scheduler Error]:', err);
    }
  };

  await runScheduledCycles();
  const cycleInterval = setInterval(runScheduledCycles, 60 * 1000);

  // 2. BullMQ Queues
  const fileQueue = new Queue('file-processing', { connection: redis });
  const pdfQueue = new Queue('pdf-compilation', { connection: redis });
  const formatQueue = new Queue('format-conversion', { connection: redis });

  // 3. BullMQ Workers
  const fileWorker = new Worker(
    'file-processing',
    async (job) => {
      console.log(`[BullMQ] Processing file job ${job.id}`);
      const { localFilePath, originalFilename, expectedSha256, clamdHost, clamdPort } = job.data;
      return await verifyAndScanUploadedFile(
        localFilePath,
        originalFilename,
        expectedSha256,
        clamdHost,
        clamdPort,
      );
    },
    { connection: redis, concurrency: 4 },
  );

  const pdfWorker = new Worker(
    'pdf-compilation',
    async (job) => {
      console.log(`[BullMQ] Compiling PDF package job ${job.id}`);
      if (job.data.input && job.data.outputPath) {
        return await compileHandoverDossierStreamingQpdf(job.data.input, job.data.outputPath);
      }
      if (job.data.packageId && job.data.orgId) {
        const client = await pool.connect();
        try {
          await client.query(
            `UPDATE handover_packages
                SET status = 'READY',
                    updated_at = now()
              WHERE id = $1 AND org_id = $2`,
            [job.data.packageId, job.data.orgId],
          );
          console.log(`[BullMQ] Handover package ${job.data.packageId} marked as READY.`);
        } finally {
          client.release();
        }
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

  fileWorker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));
  pdfWorker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));
  formatWorker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));

  // 4. Outbox Poller (every 2s)
  const pollOutbox = async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, org_id, project_id, event_type, payload_json, attempts
           FROM outbox_events
          WHERE dispatched_at IS NULL AND attempts < 5
          ORDER BY created_at ASC
          LIMIT 20
          FOR UPDATE SKIP LOCKED`,
      );

      for (const row of rows) {
        try {
          const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;

          if (row.event_type === 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN') {
            await fileQueue.add('scan', payload, {
              attempts: 3,
              backoff: { type: 'exponential', delay: 1000 },
            });
          } else if (row.event_type === 'HANDOVER_PACKAGE_QUEUED') {
            await pdfQueue.add('compile', payload, {
              attempts: 2,
              backoff: { type: 'fixed', delay: 2000 },
            });
          }

          await client.query(
            `UPDATE outbox_events SET dispatched_at = now() WHERE id = $1`,
            [row.id],
          );
        } catch (dispatchErr) {
          console.error(`Failed to dispatch outbox event ${row.id}:`, dispatchErr);
          await client.query(
            `UPDATE outbox_events SET attempts = attempts + 1 WHERE id = $1`,
            [row.id],
          );
        }
      }
    } catch (err) {
      console.error('[Outbox Poller Error]:', err);
    } finally {
      client.release();
    }
  };

  const outboxInterval = setInterval(pollOutbox, 2000);

  console.log('✓ TradeCloseout Worker, BullMQ Queues & Leader-Locked Schedulers are ACTIVE.');

  const shutdown = async () => {
    console.log('Shutting down TradeCloseout Worker...');
    clearInterval(cycleInterval);
    clearInterval(outboxInterval);
    await Promise.all([fileWorker.close(), pdfWorker.close(), formatWorker.close()]);
    await Promise.all([fileQueue.close(), pdfQueue.close(), formatQueue.close()]);
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
