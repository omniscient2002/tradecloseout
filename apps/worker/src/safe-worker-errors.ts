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
  | 'FILE_FAILURE_PERSIST_FAILED'
  | 'PACKAGE_FAILURE_PERSIST_FAILED'
  | 'OUTBOX_EVENT_DISPATCH_FAILED'
  | 'OUTBOX_TENANT_POLL_FAILED'
  | 'OUTBOX_POLLER_FAILED'
  | 'WORKER_BOOT_FAILED';

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
    return APPROVED_ERROR_CODES[descriptor.value] ?? 'UNCLASSIFIED';
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
