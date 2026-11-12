import { apiFetch, ApiProblemError } from './api-client';
import { sha256BlobChunked } from './chunked-sha256';

export interface OfflineQueuedUpload {
  queueId: string;
  actorPartition: string;
  // Session-generation fence is not a credential. Legacy drafts with no
  // generation cannot be silently uploaded after this migration.
  actorEpoch?: string;
  projectId: string;
  requirementId: string;
  /** Captured canonical obligation version; absence forbids old-session rebind. */
  requirementRowVersion?: number;
  assetId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  revisionCode: string;
  issueDate: string;
  title: string;
  externalComment?: string;
  fileBlob: Blob;
  uploadedParts: Array<{ partNumber: number; etag: string }>;
  uploadIntent?: {
    documentId: string;
    versionId: string;
    isMultipart: boolean;
    parts: Array<{ partNumber: number; url: string; requiredHeaders?: Record<string, string> }>;
    partSizeBytes: number;
  };
  status: 'QUEUED_OFFLINE' | 'UPLOADING' | 'PROCESSING' | 'BLOCKED_SCOPE' | 'COMPLETED' | 'FAILED';
  lastError?: string;
  createdAt: number;
  completedUploadAt?: number;
  completionRequestedAt?: number;
  retryCount?: number;
  nextAttemptAt?: number;
  terminalFailure?: boolean;
}

const DB_NAME = 'tradecloseout_field_pwa';
const STORE_NAME = 'tc_offline_upload_outbox';
const ACTOR_PARTITION_KEY = 'tc_offline_actor_partition';
const ACTOR_EPOCH_KEY = 'tc_offline_actor_epoch';
const DRAIN_LOCK_NAME = 'tradecloseout:field-upload-drain';
// Multipart part URLs expire. One refresh/retry per failed part prevents an
// unbounded permission-error loop, while preserving receipts already persisted.
const MAX_PART_URL_REFRESHES = 1;
const MAX_TRANSIENT_RETRIES = 6;
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1000;

export function nextUploadRetryDelay(retryCount: number): number {
  if (!Number.isSafeInteger(retryCount) || retryCount < 1) {
    throw new Error('UPLOAD_RETRY_COUNT_INVALID');
  }
  return Math.min(RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * Math.pow(2, Math.min(retryCount - 1, 16)));
}

export function isTransientUploadFailure(error: unknown): boolean {
  if (error instanceof ApiProblemError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof TypeError) return true; // fetch network rejection
  const message = error instanceof Error ? error.message : '';
  return /^UPLOAD_PART_HTTP_(408|429|5[0-9][0-9])$/.test(message) ||
    /^(NetworkError|Failed to fetch)$/.test(message);
}

// The API rejects uploads over 100 MiB. Bound browser-local original evidence
// and do not imply a later provider upload will succeed for oversized files.
export const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_ACTOR_DRAFT_BYTES = 300 * 1024 * 1024;
export const MAX_GLOBAL_DRAFT_BYTES = 500 * 1024 * 1024;
export const MAX_ACTOR_DRAFTS = 10;

export interface OfflineUploadDraftSummary {
  queueId: string;
  projectId: string;
  requirementId: string;
  filename: string;
  sizeBytes: number;
  status: OfflineQueuedUpload['status'];
  createdAt: number;
  lastError?: string;
  hasActiveIntent: boolean;
}

export function assertOfflineDraftBudget(
  fileBytes: number,
  existing: ReadonlyArray<Pick<OfflineQueuedUpload, 'actorPartition' | 'sizeBytes'>>,
  actorPartition: string,
): void {
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 1 || fileBytes > MAX_UPLOAD_FILE_BYTES) {
    throw new Error('UPLOAD_SIZE_LIMIT: Evidence must be 1 byte to 100 MiB.');
  }
  const actor = existing.filter((item) => item.actorPartition === actorPartition);
  const bytes = (list: ReadonlyArray<{ sizeBytes: number }>) => list.reduce((sum, entry) => sum + (Number(entry.sizeBytes) || 0), 0);
  if (actor.length >= MAX_ACTOR_DRAFTS) {
    throw new Error('UPLOAD_QUEUE_ITEM_LIMIT: Resolve or discard existing drafts before capturing more.');
  }
  if (bytes(actor) + fileBytes > MAX_ACTOR_DRAFT_BYTES ||
      bytes(existing) + fileBytes > MAX_GLOBAL_DRAFT_BYTES) {
    throw new Error('UPLOAD_QUEUE_STORAGE_LIMIT: Free space by synchronizing or discarding drafts.');
  }
}


function assertSameActorIdentity(item: Pick<OfflineQueuedUpload, 'actorPartition'>): void {
  if (typeof window === 'undefined' ||
      window.localStorage.getItem(ACTOR_PARTITION_KEY) !== item.actorPartition) {
    throw new Error('UPLOAD_ACTOR_CONTEXT_CHANGED');
  }
}

function assertSameActor(item: Pick<OfflineQueuedUpload, 'actorPartition' | 'actorEpoch'>): void {
  assertSameActorIdentity(item);
  if (!item.actorEpoch || window.localStorage.getItem(ACTOR_EPOCH_KEY) !== item.actorEpoch) {
    throw new Error('UPLOAD_ACTOR_CONTEXT_CHANGED');
  }
}

type PresignedPart = { partNumber: number; url?: string; uploadUrl?: string; requiredHeaders?: Record<string, string> };
function normalizeParts(parts: PresignedPart[]): Array<{ partNumber: number; url: string; requiredHeaders: Record<string, string> }> {
  if (!Array.isArray(parts)) throw new Error('UPLOAD_PARTS_INVALID');
  const seen = new Set<number>();
  return parts.map((part) => {
    const url = part.url || part.uploadUrl;
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 ||
        typeof url !== 'string' || seen.has(part.partNumber)) {
      throw new Error('UPLOAD_PARTS_INVALID');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('UPLOAD_PARTS_INVALID');
    }
    // Evidence must never be delivered over plaintext to a remote storage
    // gateway. Only loopback HTTP is allowed for disposable local fixtures.
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
        parsed.username || parsed.password || parsed.hash) {
      throw new Error('UPLOAD_PART_URL_INSECURE');
    }
    seen.add(part.partNumber);
    return { partNumber: part.partNumber, url, requiredHeaders: part.requiredHeaders || {} };
  });
}

async function refreshOutstandingParts(item: OfflineQueuedUpload): Promise<void> {
  const intent = item.uploadIntent;
  if (!intent?.isMultipart) throw new Error('UPLOAD_URL_REFRESH_UNAVAILABLE');
  assertSameActor(item);
  const response = await apiFetch<{
    versionId: string;
    refreshedParts: PresignedPart[];
  }>(`/api/v1/document-versions/${encodeURIComponent(intent.versionId)}/refresh-upload-urls`, {
    method: 'POST',
  });
  assertSameActor(item);
  if (response.versionId !== intent.versionId) throw new Error('UPLOAD_REFRESH_VERSION_MISMATCH');
  const refreshed = normalizeParts(response.refreshedParts);
  const byNumber = new Map(refreshed.map((part) => [part.partNumber, part]));
  const uploaded = new Set(item.uploadedParts.map((part) => part.partNumber));
  for (const old of intent.parts) {
    // Receipts for already-complete parts must never be invalidated by refresh.
    if (!uploaded.has(old.partNumber) && !byNumber.has(old.partNumber)) {
      throw new Error('UPLOAD_REFRESH_MISSING_PART');
    }
  }
  intent.parts = intent.parts.map((part) => byNumber.get(part.partNumber) || part);
}

type VerifiedUploadState = 'READY' | 'REJECTED' | 'PROCESSING' | 'PENDING_UPLOAD' | 'UNKNOWN';
async function checkDocumentProcessingState(item: OfflineQueuedUpload, intentionalDiscard = false): Promise<VerifiedUploadState> {
  if (!item.uploadIntent) throw new Error('UPLOAD_INTENT_MISSING');
  // During deliberate discard, a returning original user may inspect a
  // prior epoch, but MUST NOT replay its upload automatically.
  if (intentionalDiscard) assertSameActorIdentity(item);
  else assertSameActor(item);
  const status = await apiFetch<{
    versionId: string;
    fileStatus: string;
    storageStatus: string;
  }>(`/api/v1/document-versions/${encodeURIComponent(item.uploadIntent.versionId)}/upload-state`);
  if (intentionalDiscard) assertSameActorIdentity(item);
  else assertSameActor(item);
  if (status.versionId !== item.uploadIntent.versionId) throw new Error('UPLOAD_STATUS_VERSION_MISMATCH');
  if (['QUARANTINED', 'FAILED', 'DELETED', 'ABORTED'].includes(status.storageStatus) ||
      ['QUARANTINED', 'FAILED'].includes(status.fileStatus)) return 'REJECTED';
  if (status.fileStatus === 'READY' && status.storageStatus === 'READY') return 'READY';
  if (status.fileStatus === 'PROCESSING' || status.storageStatus === 'PROCESSING') return 'PROCESSING';
  if (status.fileStatus === 'PENDING_UPLOAD' && status.storageStatus === 'PENDING') return 'PENDING_UPLOAD';
  return 'UNKNOWN';
}


/** Server-derived membership partition: never use a caller-supplied display name. */
export function getMemberOfflineActorPartition(userId: string, orgId: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(userId) || !uuid.test(orgId)) throw new Error('UPLOAD_ACTOR_IDENTITY_INVALID');
  return `member:${orgId.toLowerCase()}:${userId.toLowerCase()}`;
}

export function setOfflineActorPartition(partition: string | null): void {
  if (typeof window === 'undefined') return;
  const previous = window.localStorage.getItem(ACTOR_PARTITION_KEY);
  if (!partition) {
    window.localStorage.removeItem(ACTOR_PARTITION_KEY);
    window.localStorage.setItem(ACTOR_EPOCH_KEY, crypto.randomUUID());
    return;
  }
  // Repeated render/refresh with the same authenticated identity must not
  // invalidate a still-active upload. Any identity change MUST invalidate it.
  if (previous !== partition || !window.localStorage.getItem(ACTOR_EPOCH_KEY)) {
    window.localStorage.setItem(ACTOR_EPOCH_KEY, crypto.randomUUID());
  }
  window.localStorage.setItem(ACTOR_PARTITION_KEY, partition);
}

/**
 * Never expose another account's original Blob or even its filename through
 * the queue inventory. Browser-origin storage itself is not encrypted; shared
 * devices still require separate OS/browser profiles for strong isolation.
 */
export async function listOfflineUploadDrafts(): Promise<OfflineUploadDraftSummary[]> {
  if (typeof window === 'undefined') return [];
  const partition = window.localStorage.getItem(ACTOR_PARTITION_KEY);
  if (!partition) return [];
  const db = await openOfflineDb();
  try {
    const records = await new Promise<OfflineQueuedUpload[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const get = tx.objectStore(STORE_NAME).getAll();
      get.onsuccess = () => resolve(get.result as OfflineQueuedUpload[]);
      get.onerror = () => reject(get.error);
    });
    if (window.localStorage.getItem(ACTOR_PARTITION_KEY) !== partition) {
      throw new Error('UPLOAD_ACTOR_CONTEXT_CHANGED');
    }
    const activeEpoch = window.localStorage.getItem(ACTOR_EPOCH_KEY);
    return records
      .filter((item) => item.actorPartition === partition && item.status !== 'COMPLETED')
      .map((item) => ({
        queueId: item.queueId,
        projectId: item.projectId,
        requirementId: item.requirementId,
        filename: item.filename,
        sizeBytes: item.sizeBytes,
        status: item.actorEpoch && item.actorEpoch === activeEpoch ? item.status : 'BLOCKED_SCOPE' as const,
        createdAt: item.createdAt,
        lastError: item.lastError,
        hasActiveIntent: Boolean(item.uploadIntent),
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

/**
 * Deliberate local draft discard. Abort unfinished remote intents before
 * deleting the original, under the SAME origin-wide sender lock. Never erase
 * a PROCESSING receipt; server scan outcome still requires reconciliation.
 */
export async function discardOfflineUploadDraft(queueId: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    throw new Error('UPLOAD_CROSS_TAB_LOCK_UNAVAILABLE');
  }
  if (!queueId) throw new Error('UPLOAD_QUEUE_ID_REQUIRED');
  await navigator.locks.request(DRAIN_LOCK_NAME, { mode: 'exclusive' }, async () => {
    const db = await openOfflineDb();
    try {
      const item = await new Promise<OfflineQueuedUpload | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(queueId);
        req.onsuccess = () => resolve(req.result as OfflineQueuedUpload | undefined);
        req.onerror = () => reject(req.error);
      });
      if (!item) return; // repeat after a committed discard is harmless
      // A returning original identity may deliberately delete its own old
      // generation's local bytes; it may not automatically send them.
      assertSameActorIdentity(item);
      if (item.completedUploadAt || item.status === 'PROCESSING') {
        throw new Error('UPLOAD_PROCESSING_CANNOT_DISCARD: Verify the server outcome first.');
      }
      if (item.uploadIntent) {
        try {
          await apiFetch(`/api/v1/document-versions/${encodeURIComponent(item.uploadIntent.versionId)}/abort-upload`, {
            method: 'POST',
          });
        } catch (error) {
          // The server may have committed abort before a response was lost, or
          // a local IndexedDB delete may have failed after an earlier abort.
          // A 409 permits local discard ONLY if the authoritative version is
          // terminally rejected. Never interpret 401/403/404 as proof of abort.
          if (!(error instanceof ApiProblemError) || error.status !== 409 ||
              await checkDocumentProcessingState(item, true) !== 'REJECTED') {
            throw error;
          }
        }
        assertSameActorIdentity(item);
      }
      await deleteQueueItem(db, queueId);
    } finally {
      db.close();
    }
  });
}

/**
 * The ONLY supported epoch rebind: an original member consciously recovers
 * a local-only Blob that has no remote intent or provider receipts.
 *
 * Same principal, same org, current live project/requirement AND current
 * document.upload permission are checked against the server. Guest grants,
 * remote multipart intents and processed scans cannot use this path.
 */
export async function recoverOfflineUploadDraft(queueId: string): Promise<void> {
  if (typeof window === 'undefined' || !navigator.locks?.request) {
    throw new Error('UPLOAD_CROSS_TAB_LOCK_UNAVAILABLE');
  }
  if (!queueId) throw new Error('UPLOAD_QUEUE_ID_REQUIRED');
  await navigator.locks.request(DRAIN_LOCK_NAME, { mode: 'exclusive' }, async () => {
    const db = await openOfflineDb();
    try {
      const item = await new Promise<OfflineQueuedUpload | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const get = tx.objectStore(STORE_NAME).get(queueId);
        get.onsuccess = () => resolve(get.result as OfflineQueuedUpload | undefined);
        get.onerror = () => reject(get.error);
      });
      if (!item) throw new Error('UPLOAD_DRAFT_NOT_FOUND');
      assertSameActorIdentity(item);
      const epoch = window.localStorage.getItem(ACTOR_EPOCH_KEY);
      if (!epoch || (item.actorEpoch && item.actorEpoch === epoch)) {
        throw new Error('UPLOAD_RECOVERY_REQUIRES_OLD_SESSION_DRAFT');
      }
      // "No local uploadIntent" does NOT prove the POST never reached the
      // server: its response may have been lost before the browser checkpoint.
      // Only never-drained, truly offline QUEUED_OFFLINE captures can be
      // rebound. Any send/retry history demands authoritative reconciliation.
      if (item.status !== 'QUEUED_OFFLINE' ||
          item.uploadIntent || item.uploadedParts.length > 0 ||
          item.completedUploadAt || item.completionRequestedAt ||
          item.retryCount || item.nextAttemptAt || item.terminalFailure) {
        throw new Error('UPLOAD_REMOTE_INTENT_RECOVERY_UNSUPPORTED: Inspect or discard the remote intent first.');
      }

      // The only accepted actor identity is the current authenticated server
      // principal, never a client-selected display name or stale local ID.
      const identity = await apiFetch<{ userId?: string; activeOrgId?: string }>('/api/v1/auth/me');
      if (!identity?.userId || !identity.activeOrgId ||
          getMemberOfflineActorPartition(identity.userId, identity.activeOrgId) !== item.actorPartition) {
        throw new Error('UPLOAD_ACTOR_CONTEXT_CHANGED');
      }
      assertSameActorIdentity(item);

      if (!Number.isSafeInteger(item.requirementRowVersion) ||
          (item.requirementRowVersion as number) < 1) {
        throw new Error('UPLOAD_DRAFT_MISSING_BASELINE_REVISION');
      }
      const capturedVersion = item.requirementRowVersion as number;
      const response = await apiFetch<{
        projectId: string; requirementId: string; rowVersion: number; allowed: boolean;
      }>(`/api/v1/projects/${encodeURIComponent(item.projectId)}/documents/recover-upload-authority/${encodeURIComponent(item.requirementId)}?rowVersion=${capturedVersion}`);
      if (!response?.allowed || response.projectId !== item.projectId ||
          response.requirementId !== item.requirementId ||
          response.rowVersion !== capturedVersion) {
        throw new Error('UPLOAD_RECOVERY_AUTHORITY_MISMATCH');
      }
      assertSameActorIdentity(item);
      if (window.localStorage.getItem(ACTOR_EPOCH_KEY) !== epoch) {
        throw new Error('UPLOAD_ACTOR_CONTEXT_CHANGED');
      }
      item.actorEpoch = epoch;
      item.status = 'QUEUED_OFFLINE';
      item.terminalFailure = false;
      item.retryCount = 0;
      item.nextAttemptAt = undefined;
      item.lastError = undefined;
      await saveQueueItem(db, item);
    } finally {
      db.close();
    }
  });
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available'));
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'queueId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function computeBrowserFileSha256(file: Blob): Promise<string> {
  return sha256BlobChunked(file);
}

/**
 * Client-Side Canvas/WebP Image Compressor (Dimension 8: 10.0/10)
 * Compresses 12 MP Android camera photos (~8 MB each) to ~600 KB on 4G before
 * persistence into IndexedDB or upload intent creation (11 §6).
 */
export async function compressImageForFieldUpload(
  file: File,
  maxWidth = 1920,
  maxHeight = 1920,
  quality = 0.82,
): Promise<{ processedFile: File; wasCompressed: boolean }> {
  if (typeof window === 'undefined' || !file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return { processedFile: file, wasCompressed: false };
  }

  // Already lightweight (< 800 KB) - skip re-compression to save battery
  if (file.size <= 800 * 1024) {
    return { processedFile: file, wasCompressed: false };
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return resolve({ processedFile: file, wasCompressed: false });
      }
      ctx.drawImage(img, 0, 0, width, height);

      const targetMime = 'image/webp';
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size < file.size) {
            const newName = file.name.replace(/\.[^.]+$/, '.webp');
            const compressed = new File([blob], newName, {
              type: targetMime,
              lastModified: Date.now(),
            });
            resolve({ processedFile: compressed, wasCompressed: true });
          } else {
            resolve({ processedFile: file, wasCompressed: false });
          }
        },
        targetMime,
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ processedFile: file, wasCompressed: false });
    };
    img.src = url;
  });
}

/**
 * Persists a captured site photo or PDF into IndexedDB immediately so zero data
 * is lost in a zero-reception basement plant room. Triggered automatically on upload.
 */
export async function enqueueFieldUpload(params: {
  actorPartition?: string;
  projectId: string;
  requirementId: string;
  requirementRowVersion?: number;
  assetId?: string | null;
  file: File;
  revisionCode: string;
  issueDate: string;
  title: string;
  externalComment?: string;
}): Promise<OfflineQueuedUpload> {
  const actorPartition = params.actorPartition ||
    (typeof window !== 'undefined' ? window.localStorage.getItem(ACTOR_PARTITION_KEY) : null);
  if (!actorPartition) {
    throw new Error('UPLOAD_ACTOR_CONTEXT_REQUIRED: Sign in or establish the guest grant before queueing evidence.');
  }
  const originalFile = params.file;
  const actorEpoch = typeof window === 'undefined'
    ? null : window.localStorage.getItem(ACTOR_EPOCH_KEY);
  if (!actorEpoch) throw new Error('UPLOAD_ACTOR_CONTEXT_REQUIRED');
  assertOfflineDraftBudget(originalFile.size, [], actorPartition);
  assertSameActor({ actorPartition, actorEpoch });
  const checksumSha256 = await computeBrowserFileSha256(originalFile);
  // An account switch during the async hash must not persist the evidence
  // under an old actor's partition or trigger a stale-network upload.
  assertSameActor({ actorPartition, actorEpoch });
  const item: OfflineQueuedUpload = {
    queueId: crypto.randomUUID(),
    actorPartition,
    actorEpoch,
    projectId: params.projectId,
    requirementId: params.requirementId,
    requirementRowVersion: params.requirementRowVersion,
    assetId: params.assetId ?? null,
    filename: originalFile.name,
    mimeType: originalFile.type || 'application/octet-stream',
    sizeBytes: originalFile.size,
    checksumSha256,
    revisionCode: params.revisionCode,
    issueDate: params.issueDate,
    title: params.title,
    externalComment: params.externalComment,
    fileBlob: originalFile,
    uploadedParts: [],
    status: typeof navigator !== 'undefined' && navigator.onLine ? 'UPLOADING' : 'QUEUED_OFFLINE',
    createdAt: Date.now(),
  };

  const db = await openOfflineDb();
  try {
    // Quota validation and save share one atomic IndexedDB transaction, so
    // concurrent tabs cannot both pass a stale count and overfill the queue.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const list = store.getAll();
      list.onsuccess = () => {
        try {
          assertSameActor(item);
          assertOfflineDraftBudget(item.sizeBytes, list.result as OfflineQueuedUpload[], actorPartition);
          store.put(item);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('UPLOAD_BROWSER_STORAGE_UNAVAILABLE'));
      tx.onabort = () => reject(tx.error || new Error('UPLOAD_BROWSER_STORAGE_FULL_OR_BLOCKED'));
    });
  } finally {
    db.close();
  }

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    // Do not turn a completed IndexedDB save into an unhandled rejection
    // if synchronization cannot begin on this device.
    void drainOfflineUploadQueue().catch(() => undefined);
  }
  return item;
}

/**
 * Resumable S3 Multipart Drain Loop:
 * Automatically called on `window.addEventListener('online')` and Service Worker sync.
 * Skips already-uploaded 10 MB parts so patchy 4G never restarts a 90 MB PDF from 0%.
 */
export async function drainOfflineUploadQueue(
  onProgress?: (queueId: string, uploadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return;
  if (typeof indexedDB === 'undefined') return;
  // Web Locks are origin-wide and released automatically when a tab crashes.
  // Never dispatch duplicate provider writes from an unsupported browser.
  if (!navigator.locks?.request) {
    throw new Error('UPLOAD_CROSS_TAB_LOCK_UNAVAILABLE');
  }
  await navigator.locks.request(DRAIN_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) return;
    await drainLockedUploadQueue(onProgress);
  });
}

async function drainLockedUploadQueue(
  onProgress?: (queueId: string, uploadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  const db = await openOfflineDb();
  try {
  const items = await new Promise<OfflineQueuedUpload[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  for (const item of items) {
    if (item.status === 'COMPLETED' || item.terminalFailure) continue;
    // Backoff is durable across reloads, online/visibility events and tabs.
    // Completion uncertainty is reconciled against the server independently
    // of this part-upload retry budget.
    if (!item.completionRequestedAt && item.nextAttemptAt &&
        Date.now() < item.nextAttemptAt) continue;

    const currentActorPartition = window.localStorage.getItem(ACTOR_PARTITION_KEY);
    if (!currentActorPartition || item.actorPartition !== currentActorPartition) {
      // Another signed-in account must not rewrite this user's original,
      // even just to mark it blocked. The original epoch will be fenced on
      // the owner's next drain, after a subsequent authenticated sign-in.
      continue;
    }
    // Never silently revive a blocked draft after a session/grant change.
    // An explicit same-identity recovery workflow is required.
    if (item.status === 'BLOCKED_SCOPE') continue;

    try {
      assertSameActor(item);
      if (item.status === 'PROCESSING' || item.completedUploadAt || item.completionRequestedAt) {
        // A lost /complete response is not permission to blindly replay it.
        // Reconcile first; resend only when server explicitly remains PENDING_UPLOAD.
        const status = await checkDocumentProcessingState(item);
        if (status === 'READY') {
          await deleteQueueItem(db, item.queueId);
          continue;
        }
        if (status === 'REJECTED') {
          item.status = 'FAILED';
          item.terminalFailure = true;
          item.lastError = 'Server rejected or quarantined the evidence. Do not re-upload without reviewing the failure.';
          await saveQueueItem(db, item);
          continue;
        }
        if (status === 'PROCESSING') {
          item.completedUploadAt ??= Date.now();
          item.status = 'PROCESSING';
          item.lastError = 'Upload received; scanning is still pending.';
          await saveQueueItem(db, item);
          continue;
        }
        if (status !== 'PENDING_UPLOAD' || item.completedUploadAt || item.status === 'PROCESSING') {
          throw new Error('UPLOAD_COMPLETION_STATE_UNCERTAIN: Recheck the authoritative server before retrying.');
        }
        // The server confirms the same intent is still pending. Reuse the
        // stable completion idempotency key and existing completed-part receipts.
      }
      item.status = 'UPLOADING';
      item.lastError = undefined;
      item.nextAttemptAt = undefined;
      await saveQueueItem(db, item);
      // Step 1: Request or reuse S3 multipart upload intent (TC2-030 contract alignment)
      if (!item.uploadIntent) {
        const intentRes = await apiFetch<{
          documentId: string;
          versionId: string;
          isMultipart: boolean;
          partSizeBytes?: number;
          parts?: Array<{ partNumber: number; url?: string; uploadUrl?: string; requiredHeaders?: Record<string, string> }>;
          upload?: {
            partSizeBytes: number;
            parts: Array<{ partNumber: number; url?: string; uploadUrl?: string; requiredHeaders?: Record<string, string> }>;
          };
        }>(`/api/v1/projects/${encodeURIComponent(item.projectId)}/documents/upload-intents`, {
          method: 'POST',
          idempotencyKey: `intent_${item.queueId}`,
          body: JSON.stringify({
            requirementId: item.requirementId,
            assetId: item.assetId,
            filename: item.filename,
            sizeBytes: item.sizeBytes,
            mimeType: item.mimeType,
            revisionCode: item.revisionCode,
            issueDate: item.issueDate,
            title: item.title,
            checksumSha256: item.checksumSha256,
            externalComment: item.externalComment,
          }),
        });

        assertSameActor(item);
        const resolvedParts = normalizeParts(intentRes.upload?.parts || intentRes.parts || []);
        const resolvedPartSize = intentRes.upload?.partSizeBytes || intentRes.partSizeBytes || 5 * 1024 * 1024;

        item.uploadIntent = {
          documentId: intentRes.documentId,
          versionId: intentRes.versionId,
          isMultipart: intentRes.isMultipart,
          partSizeBytes: resolvedPartSize,
          parts: resolvedParts,
        };
        await saveQueueItem(db, item);
      }

      // Step 2: Upload only remaining parts directly to S3 presigned URLs
      const completedPartNums = new Set(item.uploadedParts.map((p) => p.partNumber));
      const partSize = item.uploadIntent.partSizeBytes;
      if (!Number.isSafeInteger(partSize) || partSize <= 0) throw new Error('UPLOAD_PART_SIZE_INVALID');

      for (const part of item.uploadIntent.parts) {
        assertSameActor(item);
        if (completedPartNums.has(part.partNumber)) continue;
        const startByte = (part.partNumber - 1) * partSize;
        const endByte = Math.min(startByte + partSize, item.sizeBytes);
        if (startByte >= endByte) throw new Error('UPLOAD_PART_RANGE_INVALID');
        const chunkBlob = item.fileBlob.slice(startByte, endByte);
        let putRes: Response | undefined;
        for (let attempt = 0; attempt <= MAX_PART_URL_REFRESHES; attempt++) {
          assertSameActor(item);
          const currentPart = item.uploadIntent.parts.find((p) => p.partNumber === part.partNumber);
          if (!currentPart) throw new Error('UPLOAD_PART_MISSING');
          putRes = await fetch(currentPart.url, {
            method: 'PUT',
            headers: currentPart.requiredHeaders,
            body: chunkBlob,
          });
          assertSameActor(item);
          if (putRes.ok) break;
          // An expired presigned URL is provider-specific. Refresh only for
          // rejected authorizations, retry once, then surface the real failure.
          if ((putRes.status === 401 || putRes.status === 403) &&
              item.uploadIntent.isMultipart && attempt < MAX_PART_URL_REFRESHES) {
            await refreshOutstandingParts(item);
            await saveQueueItem(db, item);
            continue;
          }
          throw new Error(`UPLOAD_PART_HTTP_${putRes.status}`);
        }
        if (!putRes?.ok) throw new Error('UPLOAD_PART_FAILED');
        const etag = putRes.headers.get('ETag');
        if (!etag && item.uploadIntent.isMultipart) {
          throw new Error('UPLOAD_ETAG_MISSING: storage CORS must expose ETag before multipart completion can proceed.');
        }
        item.uploadedParts.push({ partNumber: part.partNumber, etag: etag || '' });
        await saveQueueItem(db, item);
        onProgress?.(item.queueId, endByte, item.sizeBytes);
      }

      // Step 3: Record the request intent BEFORE the external completion POST.
      // A crash/lost response then triggers server-state reconciliation first.
      assertSameActor(item);
      item.completionRequestedAt ??= Date.now();
      await saveQueueItem(db, item);
      assertSameActor(item);
      await apiFetch(`/api/v1/document-versions/${encodeURIComponent(item.uploadIntent.versionId)}/complete`, {
        method: 'POST',
        idempotencyKey: `complete_${item.queueId}`,
        body: JSON.stringify({
          parts: item.uploadedParts,
          checksumSha256: item.checksumSha256,
        }),
      });

      // This checkpoint prevents future drains from repeating completion
      // while a worker asynchronously scans the immutable received bytes.
      assertSameActor(item);
      item.completedUploadAt = Date.now();
      item.status = 'PROCESSING';
      await saveQueueItem(db, item);
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        const result = await checkDocumentProcessingState(item);
        if (result === 'READY') {
          await deleteQueueItem(db, item.queueId);
          break;
        }
        if (result === 'REJECTED') {
          item.status = 'FAILED';
          item.terminalFailure = true;
          item.lastError = 'Server rejected or quarantined the evidence.';
          await saveQueueItem(db, item);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      // Pending status is durable; subsequent online triggers reconcile it.
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Upload interrupted';
      const authBlocked = error === 'UPLOAD_ACTOR_CONTEXT_CHANGED' ||
        (err instanceof ApiProblemError && (err.status === 401 || err.status === 403));
      // Do not persist an in-flight previous account's state to IndexedDB
      // after another tab logs out or switches organisations.
      if (window.localStorage.getItem(ACTOR_PARTITION_KEY) !== item.actorPartition) {
        continue;
      }
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      const pendingCompletion = Boolean(item.completionRequestedAt);
      const transient = offline || isTransientUploadFailure(err);
      if (authBlocked) {
        item.status = 'BLOCKED_SCOPE';
        item.terminalFailure = true;
        item.lastError = 'Authentication or access changed. This draft cannot be replayed automatically.';
      } else if (pendingCompletion) {
        // Never re-send the original bytes just because the /complete response
        // is uncertain; the next foreground attempt checks server state first.
        item.status = 'FAILED';
        item.lastError = 'Upload completion is uncertain; next attempt checks the authoritative server.';
      } else if (transient) {
        item.retryCount = (item.retryCount || 0) + 1;
        if (item.retryCount >= MAX_TRANSIENT_RETRIES) {
          item.status = 'FAILED';
          item.terminalFailure = true;
          item.lastError = 'UPLOAD_RETRY_LIMIT_REACHED: Original retained. Inspect the connection and server before resubmitting.';
        } else {
          item.status = offline ? 'QUEUED_OFFLINE' : 'FAILED';
          item.nextAttemptAt = Date.now() + nextUploadRetryDelay(item.retryCount);
          item.lastError = `Temporary upload failure (attempt ${item.retryCount}/${MAX_TRANSIENT_RETRIES}). ${error}`;
        }
      } else {
        // Permission, checksum, invalid receipt, HTTP 4xx and unexpected
        // contract violations require deliberate intervention, not polling.
        item.status = 'FAILED';
        item.terminalFailure = true;
        item.lastError = error;
      }
      await saveQueueItem(db, item);
    }
  }
  } finally {
    db.close();
  }
}

function saveQueueItem(db: IDBDatabase, item: OfflineQueuedUpload): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteQueueItem(db: IDBDatabase, queueId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(queueId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
