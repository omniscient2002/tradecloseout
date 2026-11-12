import { apiFetch, ApiProblemError } from './api-client';

export interface OfflineQueuedUpload {
  queueId: string;
  actorPartition: string;
  projectId: string;
  requirementId: string;
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
}

const DB_NAME = 'tradecloseout_field_pwa';
const STORE_NAME = 'tc_offline_upload_outbox';
const ACTOR_PARTITION_KEY = 'tc_offline_actor_partition';
const DRAIN_LOCK_NAME = 'tradecloseout:field-upload-drain';
// Multipart part URLs expire. One refresh/retry per failed part prevents an
// unbounded permission-error loop, while preserving receipts already persisted.
const MAX_PART_URL_REFRESHES = 1;

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
  const bytes = (list: typeof actor) => list.reduce((sum, entry) => sum + (Number(entry.sizeBytes) || 0), 0);
  if (actor.length >= MAX_ACTOR_DRAFTS) {
    throw new Error('UPLOAD_QUEUE_ITEM_LIMIT: Resolve or discard existing drafts before capturing more.');
  }
  if (bytes(actor) + fileBytes > MAX_ACTOR_DRAFT_BYTES ||
      bytes(existing as typeof actor) + fileBytes > MAX_GLOBAL_DRAFT_BYTES) {
    throw new Error('UPLOAD_QUEUE_STORAGE_LIMIT: Free space by synchronizing or discarding drafts.');
  }
}


function assertSameActor(item: OfflineQueuedUpload): void {
  if (typeof window === 'undefined' ||
      window.localStorage.getItem(ACTOR_PARTITION_KEY) !== item.actorPartition) {
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

async function checkDocumentProcessingState(item: OfflineQueuedUpload): Promise<'READY' | 'PENDING' | 'REJECTED'> {
  if (!item.uploadIntent) throw new Error('UPLOAD_INTENT_MISSING');
  assertSameActor(item);
  const doc = await apiFetch<{ versions?: Array<{ id: string; file_status: string }> }>(
    `/api/v1/documents/${encodeURIComponent(item.uploadIntent.documentId)}`,
  );
  assertSameActor(item);
  const current = doc.versions?.find((v) => v.id === item.uploadIntent?.versionId);
  if (current?.file_status === 'READY') return 'READY';
  if (current?.file_status === 'FAILED' || current?.file_status === 'QUARANTINED') return 'REJECTED';
  return 'PENDING';
}


export function setOfflineActorPartition(partition: string | null): void {
  if (typeof window === 'undefined') return;
  if (!partition) {
    window.localStorage.removeItem(ACTOR_PARTITION_KEY);
    return;
  }
  window.localStorage.setItem(ACTOR_PARTITION_KEY, partition);
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
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
  assertOfflineDraftBudget(originalFile.size, [], actorPartition);
  assertSameActor({ actorPartition } as OfflineQueuedUpload);
  const checksumSha256 = await computeBrowserFileSha256(originalFile);
  // An account switch during the async hash must not persist the evidence
  // under an old actor's partition or trigger a stale-network upload.
  assertSameActor({ actorPartition } as OfflineQueuedUpload);
  const item: OfflineQueuedUpload = {
    queueId: crypto.randomUUID(),
    actorPartition,
    projectId: params.projectId,
    requirementId: params.requirementId,
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
    if (item.status === 'COMPLETED') continue;

    const currentActorPartition = window.localStorage.getItem(ACTOR_PARTITION_KEY);
    if (!currentActorPartition || item.actorPartition !== currentActorPartition) {
      item.status = 'BLOCKED_SCOPE';
      item.lastError = 'This draft belongs to a different signed-in account or guest grant.';
      await saveQueueItem(db, item);
      continue;
    }
    // Never silently revive a blocked draft after a session/grant change.
    // An explicit same-identity recovery workflow is required.
    if (item.status === 'BLOCKED_SCOPE') continue;

    try {
      assertSameActor(item);
      if (item.status === 'PROCESSING' || item.completedUploadAt) {
        const status = await checkDocumentProcessingState(item);
        if (status === 'READY') {
          await deleteQueueItem(db, item.queueId);
        } else if (status === 'REJECTED') {
          item.status = 'FAILED';
          item.lastError = 'Server rejected or quarantined the evidence. Do not re-upload without reviewing the failure.';
          await saveQueueItem(db, item);
        }
        // Do not POST completion twice or send bytes again after acceptance.
        continue;
      }
      item.status = 'UPLOADING';
      item.lastError = undefined;
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

      // Step 3: Complete multipart upload with checksum & trigger scan (TC2-001 & TC2-030)
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
      item.status = authBlocked ? 'BLOCKED_SCOPE' :
        (typeof navigator !== 'undefined' && !navigator.onLine ? 'QUEUED_OFFLINE' : 'FAILED');
      item.lastError = authBlocked
        ? 'Authentication or access changed. This draft cannot be replayed automatically.'
        : error;
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
