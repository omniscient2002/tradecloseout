// apps/api/src/worker.main.ts
// Background Worker Entry Point for file.process and asynchronous jobs (CB-010)

import { inspectAndSanitisePdf } from '@tradecloseout/pdf-engine';
import { Pool } from 'pg';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export interface FileProcessJobData {
  orgId: string;
  versionId: string;
  storageObjectId: string;
  filePath?: string;
  mimeType: string;
}

export async function processFileJob(data: FileProcessJobData, dbPool?: Pool) {
  console.log(`[Worker] Processing file job for versionId: ${data.versionId}, storageObjectId: ${data.storageObjectId}`);

  const pool =
    dbPool ||
    new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://tc_app:tc_app_dev_pw@127.0.0.1:5432/tradecloseout',
    });

  const client = await pool.connect();
  try {
    let isQuarantined = false;
    let quarantineReason = '';
    let calculatedSha256: string | null = null;
    let calculatedSizeBytes: number | null = null;

    if (data.filePath) {
      try {
        const fileBytes = await fs.readFile(data.filePath);
        calculatedSizeBytes = fileBytes.length;
        calculatedSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');

        // Magic byte & sanitization check if PDF
        if (data.mimeType === 'application/pdf') {
          // Check PDF magic byte '%PDF-'
          if (fileBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
            throw new Error('INVALID_PDF_HEADER');
          }

          const tempOut = path.join(
            os.tmpdir(),
            `sanitised-${data.versionId}-${Date.now()}.pdf`,
          );
          await inspectAndSanitisePdf(data.filePath, tempOut);

          // Update hash & size from sanitised file
          const sanitisedBytes = await fs.readFile(tempOut);
          calculatedSizeBytes = sanitisedBytes.length;
          calculatedSha256 = crypto.createHash('sha256').update(sanitisedBytes).digest('hex');

          try {
            await fs.rename(tempOut, data.filePath);
          } catch {
            await fs.copyFile(tempOut, data.filePath);
            await fs.unlink(tempOut);
          }
        }
      } catch (err: any) {
        console.error(`[Worker] File inspection/sanitisation rejected: ${err.message}`);
        isQuarantined = true;
        quarantineReason = err.message || 'SANITISATION_FAILED';
      }
    }

    const newStatus = isQuarantined ? 'QUARANTINED' : 'READY';

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_org', $1, true)", [data.orgId]);

    await client.query(
      `UPDATE storage_objects
       SET status = $1,
           av_scanned_at = now(),
           sha256 = COALESCE($2, sha256),
           size_bytes = COALESCE($3, size_bytes)
       WHERE id = $4 AND org_id = $5`,
      [newStatus, calculatedSha256, calculatedSizeBytes, data.storageObjectId, data.orgId],
    );

    await client.query(
      `UPDATE document_versions
       SET file_status = $1
       WHERE id = $2 AND org_id = $3`,
      [newStatus, data.versionId, data.orgId],
    );

    await client.query('COMMIT');

    console.log(
      `[Worker] Completed file job for versionId: ${data.versionId} with status: ${newStatus}`,
    );
    return {
      status: newStatus,
      quarantineReason,
      sha256: calculatedSha256,
      sizeBytes: calculatedSizeBytes,
      processedAt: new Date().toISOString(),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[Worker] Error processing file job:`, error);
    throw error;
  } finally {
    client.release();
    if (!dbPool) {
      await pool.end();
    }
  }
}

async function runWorker() {
  console.log('[Worker] Background processing worker started.');
}

if (require.main === module) {
  runWorker();
}
