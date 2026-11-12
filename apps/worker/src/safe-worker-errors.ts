import { createHash } from 'crypto';

/**
 * Telemetry egress boundary for worker and scheduler failures.
 * Never interpolate throwable messages, stack traces, SQL text, arbitrary
 * identifiers or provider responses into routine logs.
 */
export type WorkerFailureEvent =
  | 'SCHEDULER_CYCLE_FAILED'
  | 'SCHEDULER_LOCK_RELEASE_FAILED'
  | 'FILE_JOB_FAILED'
  | 'PDF_JOB_FAILED'
  | 'FORMAT_JOB_FAILED'
  | 'ARCHIVE_JOB_FAILED'
  | 'FILE_FAILURE_PERSIST_FAILED'
  | 'PACKAGE_FAILURE_PERSIST_FAILED'
  | 'OUTBOX_EVENT_DISPATCH_FAILED'
  | 'OUTBOX_TENANT_POLL_FAILED'
  | 'OUTBOX_POLLER_FAILED'
  | 'WORKER_BOOT_FAILED'
  | 'WORKER_SHUTDOWN_FAILED';

const APPROVED_ERROR_CODES: Readonly<Record<string, string>> = Object.freeze({
  '23505': 'DB_UNIQUE_CONFLICT',
  '40P01': 'DB_DEADLOCK',
  '55P03': 'DB_LOCK_UNAVAILABLE',
  '57014': 'DB_QUERY_TIMEOUT',
  '08006': 'DB_CONNECTION_FAILURE',
  ECONNRESET: 'CONNECTION_RESET',
  ETIMEDOUT: 'DEPENDENCY_TIMEOUT',
  EAI_AGAIN: 'DNS_TEMPORARY_FAILURE',
});

export function safeWorkerErrorCategory(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'UNCLASSIFIED';
  try {
    // An inherited/malicious getter must not run during telemetry.
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
      return 'UNCLASSIFIED';
    }
    return Object.prototype.hasOwnProperty.call(APPROVED_ERROR_CODES, descriptor.value)
      ? APPROVED_ERROR_CODES[descriptor.value] : 'UNCLASSIFIED';
  } catch {
    return 'UNCLASSIFIED';
  }
}

/** Opaque, stable job correlation without emitting the original untrusted ID. */
export function jobFingerprint(jobId: unknown): string | null {
  if (typeof jobId !== 'string' && typeof jobId !== 'number') return null;
  const value = String(jobId);
  if (!value || value.length > 512) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function reportWorkerFailure(
  event: WorkerFailureEvent,
  error: unknown,
  jobId?: unknown,
): void {
  const fingerprint = jobFingerprint(jobId);
  console.error(JSON.stringify({
    event,
    errorCategory: safeWorkerErrorCategory(error),
    ...(fingerprint ? { jobFingerprint: fingerprint } : {}),
  }));
}

/**
 * BullMQ stores thrown processor Error.message and stack on each failed job,
 * including across retries and after the request has completed. Only freshly
 * constructed, low-cardinality errors may cross that persistence boundary.
 */
export type WorkerQueueName = 'file' | 'pdf' | 'format' | 'archive';

export function safeQueueFailure(error: unknown, queue: WorkerQueueName): Error {
  // Preserve the one classification used by file-worker terminal state logic,
  // without retaining the potentially sensitive scanner response suffix.
  if (queue === 'file' && error !== null && typeof error === 'object') {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
      if (typeof descriptor?.value === 'string' &&
          descriptor.value.startsWith('SCAN_UNAVAILABLE:')) {
        return new Error('SCAN_UNAVAILABLE: Antivirus scanner connection failed');
      }
    } catch {
      // Untrusted proxies/getters must not affect the safe failure contract.
    }
  }

  return new Error(`WORKER_${queue.toUpperCase()}_FAILED:${safeWorkerErrorCategory(error)}`);
}

/** Keep error sanitization at the outermost callback boundary of every BullMQ worker. */
export async function protectQueueJob<T>(queue: WorkerQueueName, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw safeQueueFailure(error, queue);
  }
}
