/**
 * PH1-G27-005: normal worker logs must never serialise arbitrary Error objects.
 * Database drivers, scanners and providers may embed credentials, PII or SQL
 * parameters in message, stack, cause and custom properties.
 */
export type WorkerFailureStage =
  | 'SCHEDULER_CYCLE'
  | 'SCHEDULER_LEASE_RELEASE'
  | 'FILE_JOB'
  | 'FILE_TERMINAL_PERSISTENCE'
  | 'PDF_JOB'
  | 'FORMAT_JOB'
  | 'OUTBOX_DISPATCH'
  | 'OUTBOX_TENANT'
  | 'OUTBOX_POLL'
  | 'WORKER_BOOT';

export function safeWorkerCorrelationId(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : 'unknown';
  }
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
    ? value : 'unknown';
}

export function workerFailureCategory(error: unknown):
  'DEPENDENCY_UNAVAILABLE' | 'DEPENDENCY_TIMEOUT' | 'DATABASE_ERROR' |
  'SCANNER_UNAVAILABLE' | 'LEASE_LOST' | 'UNCLASSIFIED' {
  try {
    if (typeof error !== 'object' || error === null) return 'UNCLASSIFIED';
    // Inspect only own data descriptors; do not call toString(), JSON.stringify(),
    // a provider Error getter, or a custom object's potentially secretful hooks.
    const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    const message = Object.getOwnPropertyDescriptor(error, 'message')?.value;
    if (message === 'SCHEDULER_LEASE_LOST') return 'LEASE_LOST';
    if (typeof message === 'string' && message.startsWith('SCAN_UNAVAILABLE:')) {
      return 'SCANNER_UNAVAILABLE';
    }
    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'DEPENDENCY_TIMEOUT';
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' ||
        code === 'EHOSTUNREACH' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return 'DEPENDENCY_UNAVAILABLE';
    }
    // PostgreSQL SQLSTATE: categorise without echoing even a trusted-looking code.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return 'DATABASE_ERROR';
  } catch {
    // Proxy/getter traps are untrusted too.
  }
  return 'UNCLASSIFIED';
}

export function logWorkerFailure(
  stage: WorkerFailureStage, error: unknown, correlationId?: unknown,
): void {
  console.error(
    `WORKER_FAILURE stage=${stage} category=${workerFailureCategory(error)} correlation=${safeWorkerCorrelationId(correlationId)}`,
  );
}
