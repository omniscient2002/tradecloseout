import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Actual production queue module, transpiled without its API-client import so
// each browser fixture can inject deterministic, in-memory API responses.
// This tests IndexedDB, navigator.locks and real fetch dispatch in Chromium.
const hashSource = readFileSync(resolve(process.cwd(), 'src/lib/chunked-sha256.ts'), 'utf8')
  .replace(/\bexport\s+/g, '');
const queueSource = readFileSync(resolve(process.cwd(), 'src/lib/offline-upload-queue.ts'), 'utf8')
  .replace("import { sha256BlobChunked } from './chunked-sha256';", '')
  .replace("import { apiFetch, ApiProblemError } from './api-client';", `
    class ApiProblemError extends Error {}
    const apiFetch = (...args) => window.__apiFetch(...args);
  `)
  .replace(/\bexport\s+/g, '');
const queueScript = ts.transpileModule(
  hashSource + '\n' + queueSource + '\nwindow.__queue = { enqueueFieldUpload, drainOfflineUploadQueue, setOfflineActorPartition, listOfflineUploadDrafts, discardOfflineUploadDraft, recoverOfflineUploadDraft, assertOfflineDraftBudget, getMemberOfflineActorPartition, nextUploadRetryDelay, isTransientUploadFailure, ApiProblemError };',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

async function fixture(page: import('@playwright/test').Page, expired: boolean) {
  const uploads: string[] = [];
  await page.route('http://127.0.0.1:32114/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/expired') {
      uploads.push('expired');
      return route.fulfill({ status: expired ? 403 : 200, headers: { ETag: '"p1"' }, body: '' });
    }
    if (url.pathname === '/fresh') {
      uploads.push('fresh');
      await new Promise((done) => setTimeout(done, 90));
      return route.fulfill({ status: 200, headers: { ETag: '"p1"' }, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' });
  });
  await page.goto('http://127.0.0.1:32114/');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    (window as any).__actions = [] as string[];
    (window as any).__apiFetch = async (url: string, opts?: { method?: string }) => {
      const a = (window as any).__actions as string[];
      if (url.includes('/upload-intents')) {
        a.push('intent');
        return { documentId: 'doc-one', versionId: 'version-one',
          isMultipart: true, partSizeBytes: 4,
          parts: [{ partNumber: 1, url: 'http://127.0.0.1:32114/expired' }] };
      }
      if (url.includes('/refresh-upload-urls')) {
        a.push('refresh');
        return { versionId: 'version-one',
          refreshedParts: [{ partNumber: 1, uploadUrl: 'http://127.0.0.1:32114/fresh' }] };
      }
      if (url.includes('/complete') && opts?.method === 'POST') {
        a.push('complete');
        return {};
      }
      if (url.includes('/document-versions/version-one/upload-state')) {
        a.push('status');
        return { versionId: 'version-one', fileStatus: 'READY', storageStatus: 'READY' };
      }
      throw Error('Unexpected API URL: ' + url);
    };
  });
  await page.addScriptTag({ content: queueScript });
  await page.evaluate(async () => {
    const q = (window as any).__queue;
    q.setOfflineActorPartition('actor-original');
    await q.enqueueFieldUpload({
      actorPartition: 'actor-original', projectId: 'project-one',
      requirementId: 'requirement-one', file: new File(['ABCD'], 'site.pdf', { type: 'application/pdf' }),
      revisionCode: 'A', issueDate: '2026-11-12', title: 'Authentic site PDF',
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });
  return uploads;
}

test('expired part URL refreshes once, preserves intent and completes once', async ({ page }) => {
  const puts = await fixture(page, true);
  expect(await page.evaluate(() => Boolean(navigator.locks?.request))).toBe(true);
  await page.evaluate(() => (window as any).__queue.drainOfflineUploadQueue());
  expect(puts).toEqual(['expired', 'fresh']);
  const actions = await page.evaluate(() => (window as any).__actions as string[]);
  expect(actions.filter((a) => a === 'intent')).toHaveLength(1);
  expect(actions.filter((a) => a === 'refresh')).toHaveLength(1);
  expect(actions.filter((a) => a === 'complete')).toHaveLength(1);
  await page.evaluate(() => (window as any).__queue.drainOfflineUploadQueue());
  expect(puts).toHaveLength(2);
});

test('concurrent drains use one origin-wide sender and one completion', async ({ page }) => {
  const puts = await fixture(page, false);
  await page.evaluate(async () => {
    const q = (window as any).__queue;
    await Promise.all([q.drainOfflineUploadQueue(), q.drainOfflineUploadQueue()]);
  });
  expect(puts).toEqual(['expired']);
  const actions = await page.evaluate(() => (window as any).__actions as string[]);
  expect(actions.filter((a) => a === 'intent')).toHaveLength(1);
  expect(actions.filter((a) => a === 'complete')).toHaveLength(1);
});

test('other-actor drafts cannot upload or silently reactivate after a switch', async ({ page }) => {
  const puts = await fixture(page, false);
  await page.evaluate(async () => {
    const q = (window as any).__queue;
    q.setOfflineActorPartition('actor-other');
    await q.drainOfflineUploadQueue();
    q.setOfflineActorPartition('actor-original');
    await q.drainOfflineUploadQueue();
  });
  expect(puts).toHaveLength(0);
  const actions = await page.evaluate(() => (window as any).__actions as string[]);
  expect(actions).toHaveLength(0);
});


test('a different actor cannot mutate the persisted original or its status during drain', async ({ page }) => {
  const puts = await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const persistedStatus = async (): Promise<string> => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('tradecloseout_field_pwa', 1);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        return await new Promise<string>((resolve, reject) => {
          const tx = db.transaction('tc_offline_upload_outbox', 'readonly');
          const request = tx.objectStore('tc_offline_upload_outbox').getAll();
          request.onsuccess = () => resolve(request.result[0]?.status);
          request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    };
    const before = await persistedStatus();
    q.setOfflineActorPartition('actor-unrelated');
    await q.drainOfflineUploadQueue();
    const after = await persistedStatus();
    return { before, after };
  });
  expect(puts).toHaveLength(0);
  expect(result).toEqual({ before: 'QUEUED_OFFLINE', after: 'QUEUED_OFFLINE' });
});

test('storage policy rejects oversized, too many and over-budget offline originals', async ({ page }) => {
  await fixture(page, false);
  const outcomes = await page.evaluate(() => {
    const q = (window as any).__queue;
    const results: string[] = [];
    const check = (name: string, action: () => void) => {
      try { action(); results.push(name + ':ACCEPTED'); }
      catch (e) { results.push(name + ':' + (e as Error).message.split(':')[0]); }
    };
    const mib = 1024 * 1024;
    check('oversized', () => q.assertOfflineDraftBudget(101 * mib, [], 'actor-original'));
    check('ten', () => q.assertOfflineDraftBudget(1, Array(10).fill({actorPartition:'actor-original',sizeBytes:1}), 'actor-original'));
    check('actor-quota', () => q.assertOfflineDraftBudget(90 * mib,
      Array(3).fill({ actorPartition: 'actor-original', sizeBytes: 90 * mib }), 'actor-original'));
    check('global-quota', () => q.assertOfflineDraftBudget(90 * mib,
      Array(5).fill({ actorPartition: 'actor-other', sizeBytes: 95 * mib }), 'actor-original'));
    check('normal', () => q.assertOfflineDraftBudget(90 * mib, [], 'actor-original'));
    return results;
  });
  expect(outcomes).toEqual([
    'oversized:UPLOAD_SIZE_LIMIT',
    'ten:UPLOAD_QUEUE_ITEM_LIMIT',
    'actor-quota:UPLOAD_QUEUE_STORAGE_LIMIT',
    'global-quota:UPLOAD_QUEUE_STORAGE_LIMIT',
    'normal:ACCEPTED',
  ]);
});

test('other actor cannot list or discard a queued original; owner can discard locally', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const ownerList = await q.listOfflineUploadDrafts();
    q.setOfflineActorPartition('actor-other');
    const otherList = await q.listOfflineUploadDrafts();
    let blocked = '';
    try { await q.discardOfflineUploadDraft(ownerList[0].queueId); }
    catch (err) { blocked = (err as Error).message; }
    q.setOfflineActorPartition('actor-original');
    await q.discardOfflineUploadDraft(ownerList[0].queueId);
    const after = await q.listOfflineUploadDrafts();
    return { ownerList, otherList, blocked, after };
  });
  expect(result.ownerList).toHaveLength(1);
  expect(result.ownerList[0]).toMatchObject({
    filename: 'site.pdf', status: 'QUEUED_OFFLINE', hasActiveIntent: false,
  });
  expect(result.otherList).toHaveLength(0);
  expect(result.blocked).toBe('UPLOAD_ACTOR_CONTEXT_CHANGED');
  expect(result.after).toHaveLength(0);
});


test('lost completion response reconciles PROCESSING without a duplicate server command', async ({ page }) => {
  const puts = await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const baseApi = (window as any).__apiFetch;
    let completionRequests = 0;
    (window as any).__apiFetch = async (url: string, opts?: { method?: string }) => {
      if (url.endsWith('/complete') && opts?.method === 'POST') {
        completionRequests++;
        // Simulates the server committing completion and then the response
        // being dropped by the network or browser.
        throw new Error('SIMULATED_LOST_COMPLETION_RESPONSE');
      }
      if (url.includes('/document-versions/version-one/upload-state')) {
        return { versionId: 'version-one', fileStatus: 'PROCESSING', storageStatus: 'PROCESSING' };
      }
      return baseApi(url, opts);
    };
    await q.drainOfflineUploadQueue();
    const first = await q.listOfflineUploadDrafts();
    await q.drainOfflineUploadQueue();
    const second = await q.listOfflineUploadDrafts();
    return {
      completionRequests, firstStatus: first[0].status,
      secondStatus: second[0].status, retained: second.length,
    };
  });
  expect(puts).toHaveLength(1);
  expect(result).toEqual({
    completionRequests: 1, firstStatus: 'FAILED',
    secondStatus: 'PROCESSING', retained: 1,
  });
});

test('same completion idempotency key is retried only after server confirms intent pending', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const baseApi = (window as any).__apiFetch;
    const keys: string[] = [];
    let state = 'PENDING_UPLOAD';
    (window as any).__apiFetch = async (
      url: string, opts?: { method?: string; idempotencyKey?: string },
    ) => {
      if (url.endsWith('/complete') && opts?.method === 'POST') {
        keys.push(opts.idempotencyKey || '');
        if (keys.length === 1) throw new Error('SIMULATED_REQUEST_NEVER_ARRIVED');
        state = 'READY';
        return {};
      }
      if (url.includes('/document-versions/version-one/upload-state')) {
        return { versionId: 'version-one', fileStatus: state,
          storageStatus: state === 'PENDING_UPLOAD' ? 'PENDING' : state };
      }
      return baseApi(url, opts);
    };
    await q.drainOfflineUploadQueue();
    await q.drainOfflineUploadQueue();
    return { keys, remaining: (await q.listOfflineUploadDrafts()).length };
  });
  expect(result.keys).toHaveLength(2);
  expect(result.keys[0]).toMatch(/^complete_[a-z0-9-]+$/i);
  expect(result.keys[1]).toBe(result.keys[0]);
  expect(result.remaining).toBe(0);
});


test('browser storage write failure does not claim a saved original or delete previous drafts', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const previous = (await q.listOfflineUploadDrafts()).length;
    const put = IDBObjectStore.prototype.put;
    let error = '';
    try {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException('Simulated storage quota exhaustion', 'QuotaExceededError');
      };
      await q.enqueueFieldUpload({
        projectId: 'project-one', requirementId: 'requirement-one',
        file: new File(['new original'], 'second.pdf', { type: 'application/pdf' }),
        revisionCode: 'B', issueDate: '2026-11-12', title: 'Second original',
      });
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    return { previous, after: (await q.listOfflineUploadDrafts()).length, error };
  });
  expect(result.previous).toBe(1);
  expect(result.after).toBe(1);
  expect(result.error).toContain('Simulated storage quota exhaustion');
});


test('remote abort already committed can be reconciled before local discard', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const oldApi = (window as any).__apiFetch;
    let abortCalls = 0;
    (window as any).__apiFetch = async (url: string, opts?: {method?: string}) => {
      if (url.endsWith('/complete')) throw new Error('Lost completion request');
      if (url.endsWith('/abort-upload')) {
        abortCalls++;
        const error = new q.ApiProblemError('Already aborted by server');
        error.status = 409;
        throw error;
      }
      if (url.includes('/document-versions/version-one/upload-state')) {
        return { versionId: 'version-one', fileStatus: 'FAILED', storageStatus: 'ABORTED' };
      }
      return oldApi(url, opts);
    };
    await q.drainOfflineUploadQueue();
    const drafts = await q.listOfflineUploadDrafts();
    await q.discardOfflineUploadDraft(drafts[0].queueId);
    return { abortCalls, remaining: (await q.listOfflineUploadDrafts()).length };
  });
  expect(result).toEqual({ abortCalls: 1, remaining: 0 });
});

test('same-user reauthentication permits explicit discard after a previously committed abort', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const base = (window as any).__apiFetch;
    let aborts = 0;
    (window as any).__apiFetch = async (url: string, opts?: { method?: string }) => {
      if (url.endsWith('/complete')) throw new Error('Completion response dropped');
      if (url.endsWith('/abort-upload')) {
        aborts++;
        const error = new q.ApiProblemError('Already aborted');
        error.status = 409;
        throw error;
      }
      if (url.endsWith('/upload-state')) {
        return { versionId: 'version-one', fileStatus: 'FAILED', storageStatus: 'ABORTED' };
      }
      return base(url, opts);
    };
    await q.drainOfflineUploadQueue();
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition('actor-original');
    const drafts = await q.listOfflineUploadDrafts();
    await q.discardOfflineUploadDraft(drafts[0].queueId);
    return { before: drafts[0].status, aborts, remaining: (await q.listOfflineUploadDrafts()).length };
  });
  expect(result).toEqual({ before: 'BLOCKED_SCOPE', aborts: 1, remaining: 0 });
});

test('remote abort forbidden never deletes local original', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const oldApi = (window as any).__apiFetch;
    (window as any).__apiFetch = async (url: string, opts?: { method?: string }) => {
      if (url.endsWith('/complete')) throw new Error('Lost completion request');
      if (url.endsWith('/abort-upload')) {
        const error = new q.ApiProblemError('Grant revoked');
        error.status = 403;
        throw error;
      }
      return oldApi(url, opts);
    };
    await q.drainOfflineUploadQueue();
    const drafts = await q.listOfflineUploadDrafts();
    let refused = false;
    try { await q.discardOfflineUploadDraft(drafts[0].queueId); }
    catch { refused = true; }
    return { refused, remaining: (await q.listOfflineUploadDrafts()).length };
  });
  expect(result).toEqual({ refused: true, remaining: 1 });
});


test('same identity after logout/login cannot revive an earlier session-generation draft', async ({ page }) => {
  const puts = await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const before = await q.listOfflineUploadDrafts();
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition('actor-original');
    await q.drainOfflineUploadQueue();
    const after = await q.listOfflineUploadDrafts();
    await q.discardOfflineUploadDraft(after[0].queueId);
    return { before: before[0].status, after: after[0].status,
      remaining: (await q.listOfflineUploadDrafts()).length };
  });
  expect(puts).toHaveLength(0);
  expect(result).toEqual({ before: 'QUEUED_OFFLINE', after: 'BLOCKED_SCOPE', remaining: 0 });
});

test('member evidence partition must use valid authenticated tenant and user IDs', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(() => {
    const q = (window as any).__queue;
    const u = '0192e000-0000-7000-8000-000000000101';
    const org = '0192e000-0000-7000-8000-000000000001';
    let invalidDenied = false;
    try { q.getMemberOfflineActorPartition('User Display Name', org); }
    catch { invalidDenied = true; }
    return { partition: q.getMemberOfflineActorPartition(u, org), invalidDenied };
  });
  expect(result).toEqual({
    partition: 'member:0192e000-0000-7000-8000-000000000001:0192e000-0000-7000-8000-000000000101',
    invalidDenied: true,
  });
});


test('READY version with quarantined backing object remains a failed local draft, never accepted', async ({ page }) => {
  const puts = await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const originalApi = (window as any).__apiFetch;
    (window as any).__apiFetch = async (url: string, options?: unknown) => {
      if (url.includes('/document-versions/version-one/upload-state')) {
        return { versionId: 'version-one', fileStatus: 'READY', storageStatus: 'QUARANTINED' };
      }
      return originalApi(url, options);
    };
    await q.drainOfflineUploadQueue();
    const first = await q.listOfflineUploadDrafts();
    await q.drainOfflineUploadQueue();
    const second = await q.listOfflineUploadDrafts();
    return {
      first: first.map((d: any) => d.status),
      second: second.map((d: any) => d.status),
      completeCalls: ((window as any).__actions as string[]).filter((x: string) => x === 'complete').length,
    };
  });
  expect(puts).toEqual(['expired']);
  expect(result).toEqual({ first: ['FAILED'], second: ['FAILED'], completeCalls: 1 });
});

test('guest upload status uses only upload permission response and does not require document.read', async ({ page }) => {
  const puts = await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const originalApi = (window as any).__apiFetch;
    const requests: string[] = [];
    (window as any).__apiFetch = async (url: string, options?: unknown) => {
      requests.push(url);
      if (url.includes('/documents/doc-one')) throw new Error('document.read denied');
      return originalApi(url, options);
    };
    await q.drainOfflineUploadQueue();
    return {
      statusQueries: requests.filter((url) => url.endsWith('/upload-state')).length,
      readQueries: requests.filter((url) => url.includes('/documents/doc-one')).length,
      remaining: (await q.listOfflineUploadDrafts()).length,
    };
  });
  expect(puts).toEqual(['expired']);
  expect(result).toEqual({ statusQueries: 1, readQueries: 0, remaining: 0 });
});

test('retry classifier limits retry storms to transient network/provider failures', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(() => {
    const q = (window as any).__queue;
    const denied = new q.ApiProblemError('Access revoked');
    denied.status = 403;
    const unavailable = new q.ApiProblemError('Temporary outage');
    unavailable.status = 503;
    return {
      retry1: q.nextUploadRetryDelay(1),
      retry2: q.nextUploadRetryDelay(2),
      retry8: q.nextUploadRetryDelay(8),
      retryNetwork: q.isTransientUploadFailure(new TypeError('Failed to fetch')),
      retryProvider: q.isTransientUploadFailure(new Error('UPLOAD_PART_HTTP_503')),
      retryHttp: q.isTransientUploadFailure(unavailable),
      denyAuth: q.isTransientUploadFailure(denied),
      denyPart: q.isTransientUploadFailure(new Error('UPLOAD_PART_HTTP_403')),
    };
  });
  expect(result).toEqual({
    retry1: 30_000, retry2: 60_000, retry8: 3_600_000,
    retryNetwork: true, retryProvider: true, retryHttp: true,
    denyAuth: false, denyPart: false,
  });
});

test('network error persists retry checkpoint and prevents immediate second provider PUT', async ({ page }) => {
  await fixture(page, false);
  let attemptedPuts = 0;
  await page.route('http://127.0.0.1:32114/expired', async route => {
    attemptedPuts++;
    await route.abort('failed');
  });
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    await q.drainOfflineUploadQueue();
    const first = await q.listOfflineUploadDrafts();
    await q.drainOfflineUploadQueue();
    const second = await q.listOfflineUploadDrafts();
    return {
      first: first[0].status,
      second: second[0].status,
      error: second[0].lastError,
    };
  });
  expect(attemptedPuts).toBe(1);
  expect(result.first).toBe('FAILED');
  expect(result.second).toBe('FAILED');
  expect(result.error).toContain('attempt 1/6');
});


test('same authenticated member can deliberately recover only local-only previous-epoch evidence', async ({ page }) => {
  const puts = await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const orgId = '0192e000-0000-7000-8000-000000000001';
    const userId = '0192e000-0000-7000-8000-000000000101';
    const member = q.getMemberOfflineActorPartition(userId, orgId);
    q.setOfflineActorPartition(member);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await q.enqueueFieldUpload({
      actorPartition: member, projectId: 'project-one', requirementId: 'requirement-one',
      requirementRowVersion: 7,
      file: new File(['original bytes'], 'saved.pdf', { type: 'application/pdf' }),
      revisionCode: 'A', issueDate: '2026-11-12', title: 'Saved original',
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition(member);
    const before = await q.listOfflineUploadDrafts();
    const baseline = (window as any).__apiFetch;
    const requests: string[] = [];
    (window as any).__apiFetch = async (url: string, opts?: unknown) => {
      requests.push(url);
      if (url === '/api/v1/auth/me') return { userId, activeOrgId: orgId };
      if (url.endsWith('/documents/recover-upload-authority/requirement-one?rowVersion=7')) {
        return { allowed: true, projectId: 'project-one', requirementId: 'requirement-one', rowVersion: 7 };
      }
      return baseline(url, opts);
    };
    await q.recoverOfflineUploadDraft(before[0].queueId);
    const after = await q.listOfflineUploadDrafts();
    return { before: before[0].status, after: after[0].status, requests };
  });
  expect(puts).toHaveLength(0);
  expect(result.before).toBe('BLOCKED_SCOPE');
  expect(result.after).toBe('QUEUED_OFFLINE');
  expect(result.requests).toEqual([
    '/api/v1/auth/me',
    '/api/v1/projects/project-one/documents/recover-upload-authority/requirement-one?rowVersion=7',
  ]);
});

test('foreground session-epoch fence preserves unsent draft eligibility for explicit reauthorization', async ({ page }) => {
  const puts = await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const orgId = '0192e000-0000-7000-8000-000000000001';
    const userId = '0192e000-0000-7000-8000-000000000101';
    const partition = q.getMemberOfflineActorPartition(userId, orgId);
    q.setOfflineActorPartition(partition);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await q.enqueueFieldUpload({
      actorPartition: partition, projectId: 'project-one', requirementId: 'requirement-one',
      requirementRowVersion: 7,
      file: new File(['never sent'], 'local-only.pdf', { type: 'application/pdf' }),
      revisionCode: 'A', issueDate: '2026-11-12', title: 'Offline local-only',
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition(partition);
    // A normal foreground drain marks this historical generation blocked.
    await q.drainOfflineUploadQueue();
    const blocked = (await q.listOfflineUploadDrafts()).find((d: any) => d.filename === 'local-only.pdf');
    const initialFetch = (window as any).__apiFetch;
    (window as any).__apiFetch = async (url: string, opts?: unknown) => {
      if (url === '/api/v1/auth/me') return { userId, activeOrgId: orgId };
      if (url.endsWith('/recover-upload-authority/requirement-one?rowVersion=7')) {
        return { allowed: true, projectId: 'project-one', requirementId: 'requirement-one', rowVersion: 7 };
      }
      return initialFetch(url, opts);
    };
    await q.recoverOfflineUploadDraft(blocked.queueId);
    const recovered = (await q.listOfflineUploadDrafts()).find((d: any) => d.filename === 'local-only.pdf');
    return {
      before: blocked.status, beforeRecoverable: blocked.canRecoverLocalOnly,
      after: recovered.status, afterRecoverable: recovered.canRecoverLocalOnly,
    };
  });
  expect(puts).toHaveLength(0);
  expect(result).toEqual({
    before: 'BLOCKED_SCOPE', beforeRecoverable: true,
    after: 'QUEUED_OFFLINE', afterRecoverable: false,
  });
});

test('changed member identity cannot recover a previous actor original', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const orgId = '0192e000-0000-7000-8000-000000000001';
    const userId = '0192e000-0000-7000-8000-000000000101';
    const member = q.getMemberOfflineActorPartition(userId, orgId);
    q.setOfflineActorPartition(member);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await q.enqueueFieldUpload({
      actorPartition: member, projectId: 'project-one', requirementId: 'requirement-one',
      requirementRowVersion: 7,
      file: new File(['original'], 'saved.pdf', { type: 'application/pdf' }),
      revisionCode: 'A', issueDate: '2026-11-12', title: 'Original',
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition(member);
    const baseline = (window as any).__apiFetch;
    let attempts = 0;
    (window as any).__apiFetch = async (url: string, opts?: unknown) => {
      attempts++;
      if (url === '/api/v1/auth/me') {
        return { userId: '0192e000-0000-7000-8000-000000000102', activeOrgId: orgId };
      }
      return baseline(url, opts);
    };
    const draft = (await q.listOfflineUploadDrafts())[0];
    let blocked = '';
    try { await q.recoverOfflineUploadDraft(draft.queueId); }
    catch (error) { blocked = (error as Error).message; }
    return {
      blocked, attempts, status: (await q.listOfflineUploadDrafts())[0].status,
    };
  });
  expect(result).toEqual({
    blocked: 'UPLOAD_ACTOR_CONTEXT_CHANGED', attempts: 1, status: 'BLOCKED_SCOPE',
  });
});


test('prior remote upload intent cannot be rebound after reauthentication', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const base = (window as any).__apiFetch;
    (window as any).__apiFetch = async (url: string, opts?: unknown) => {
      if (url.endsWith('/complete')) throw new Error('Lost completion response');
      return base(url, opts);
    };
    await q.drainOfflineUploadQueue();
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition('actor-original');
    const old = (await q.listOfflineUploadDrafts())[0];
    let blocked = '';
    try { await q.recoverOfflineUploadDraft(old.queueId); }
    catch (e) { blocked = (e as Error).message; }
    return {
      blocked,
      status: (await q.listOfflineUploadDrafts())[0].status,
      retained: (await q.listOfflineUploadDrafts()).length,
    };
  });
  expect(result).toEqual({
    blocked: 'UPLOAD_REMOTE_INTENT_RECOVERY_UNSUPPORTED: Inspect or discard the remote intent first.',
    status: 'BLOCKED_SCOPE',
    retained: 1,
  });
});


test('lost upload-intent response cannot masquerade as an untouched offline draft after login', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const base = (window as any).__apiFetch;
    let issuedIntent = 0;
    let recoveryChecks = 0;
    (window as any).__apiFetch = async (url: string, opts?: unknown) => {
      if (url.includes('/upload-intents')) {
        issuedIntent++;
        throw new TypeError('Failed to fetch'); // server may already have accepted
      }
      if (url.includes('/recover-upload-authority') || url === '/api/v1/auth/me') {
        recoveryChecks++;
      }
      return base(url, opts);
    };
    await q.drainOfflineUploadQueue();
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition('actor-original');
    const stale = (await q.listOfflineUploadDrafts())[0];
    let blocked = '';
    try { await q.recoverOfflineUploadDraft(stale.queueId); }
    catch (err) { blocked = (err as Error).message; }
    return {
      issuedIntent, recoveryChecks, blocked,
      retained: (await q.listOfflineUploadDrafts()).length,
      recoverable: stale.canRecoverLocalOnly,
    };
  });
  expect(result.issuedIntent).toBe(1);
  expect(result.recoveryChecks).toBe(0);
  expect(result.blocked).toContain('UPLOAD_REMOTE_INTENT_RECOVERY_UNSUPPORTED');
  expect(result.retained).toBe(1);
  expect(result.recoverable).toBe(false);
});


test('a changed requirement revision cannot silently absorb an old local original', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const orgId = '0192e000-0000-7000-8000-000000000001';
    const userId = '0192e000-0000-7000-8000-000000000101';
    const partition = q.getMemberOfflineActorPartition(userId, orgId);
    q.setOfflineActorPartition(partition);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await q.enqueueFieldUpload({
      actorPartition: partition, projectId: 'project-one', requirementId: 'requirement-one',
      requirementRowVersion: 7,
      file: new File(['original evidence'], 'original.pdf', { type: 'application/pdf' }),
      revisionCode: 'A', issueDate: '2026-11-12', title: 'Old obligation original',
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition(partition);
    const base = (window as any).__apiFetch;
    (window as any).__apiFetch = async (url: string, opts?: unknown) => {
      if (url === '/api/v1/auth/me') return { userId, activeOrgId: orgId };
      if (url.endsWith('/recover-upload-authority/requirement-one?rowVersion=7')) {
        return { allowed: true, projectId: 'project-one', requirementId: 'requirement-one', rowVersion: 8 };
      }
      return base(url, opts);
    };
    const previous = (await q.listOfflineUploadDrafts())[0];
    let blocked = '';
    try { await q.recoverOfflineUploadDraft(previous.queueId); }
    catch (error) { blocked = (error as Error).message; }
    return { blocked, status: (await q.listOfflineUploadDrafts())[0].status };
  });
  expect(result).toEqual({
    blocked: 'UPLOAD_RECOVERY_AUTHORITY_MISMATCH', status: 'BLOCKED_SCOPE',
  });
});


test('legacy drafts predating pre-network checkpoints cannot claim offline-only recovery', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const orgId = '0192e000-0000-7000-8000-000000000001';
    const userId = '0192e000-0000-7000-8000-000000000101';
    const partition = q.getMemberOfflineActorPartition(userId, orgId);
    q.setOfflineActorPartition(partition);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const item = await q.enqueueFieldUpload({
      actorPartition: partition, projectId: 'project-one',
      requirementId: 'requirement-one', requirementRowVersion: 7,
      file: new File(['legacy original'], 'legacy.pdf', { type: 'application/pdf' }),
      revisionCode: 'A', issueDate: '2026-11-12', title: 'Older queue record',
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('tradecloseout_field_pwa', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('tc_offline_upload_outbox', 'readwrite');
        const store = tx.objectStore('tc_offline_upload_outbox');
        const get = store.get(item.queueId);
        get.onsuccess = () => {
          const legacy = get.result;
          delete legacy.recoveryContractVersion;
          store.put(legacy);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    q.setOfflineActorPartition(null);
    q.setOfflineActorPartition(partition);
    const draft = (await q.listOfflineUploadDrafts()).find((d: any) => d.filename === 'legacy.pdf');
    let denied = '';
    try { await q.recoverOfflineUploadDraft(draft.queueId); }
    catch (error) { denied = (error as Error).message; }
    return { canRecoverLocalOnly: draft.canRecoverLocalOnly, denied };
  });
  expect(result).toEqual({
    canRecoverLocalOnly: false,
    denied: 'UPLOAD_REMOTE_INTENT_RECOVERY_UNSUPPORTED: Inspect or discard the remote intent first.',
  });
});


test('cancelled local capture leaves IndexedDB original inventory unchanged', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const q = (window as any).__queue;
    const before = await q.listOfflineUploadDrafts();
    const controller = new AbortController();
    controller.abort();
    let cancelName = '';
    try {
      await q.enqueueFieldUpload({
        actorPartition: 'actor-original', projectId: 'project-one',
        requirementId: 'requirement-one', requirementRowVersion: 7,
        file: new File(['must not save'], 'cancelled.pdf', { type: 'application/pdf' }),
        revisionCode: 'A', issueDate: '2026-11-12', title: 'Cancelled original',
        signal: controller.signal,
      });
    } catch (error) {
      cancelName = (error as Error).name;
    }
    const after = await q.listOfflineUploadDrafts();
    return {
      cancelName,
      before: before.map((entry: any) => entry.filename),
      after: after.map((entry: any) => entry.filename),
    };
  });
  expect(result).toEqual({
    cancelName: 'AbortError',
    before: ['site.pdf'],
    after: ['site.pdf'],
  });
});
