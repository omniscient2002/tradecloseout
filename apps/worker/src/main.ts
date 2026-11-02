import { Pool } from 'pg';
import Redis from 'ioredis';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Worker } from 'bullmq';
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
        const hashed = await scheduler.computeAuditHashChainBatch();
        if (hashed > 0) {
          console.log(`[Scheduler] Sealed ${hashed} audit events into hash chain.`);
        }
      });
    } catch (err) {
      console.error('[Scheduler Error]:', err);
    }
  };

  await runScheduledCycles();
  const cycleInterval = setInterval(runScheduledCycles, 60 * 1000);

  // 2. BullMQ Workers
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
      const { input, outputPath } = job.data;
      return await compileHandoverDossierStreamingQpdf(input, outputPath);
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

  console.log('✓ TradeCloseout Worker, BullMQ Queues & Leader-Locked Schedulers are ACTIVE.');

  const shutdown = async () => {
    console.log('Shutting down TradeCloseout Worker...');
    clearInterval(cycleInterval);
    await Promise.all([fileWorker.close(), pdfWorker.close(), formatWorker.close()]);
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
