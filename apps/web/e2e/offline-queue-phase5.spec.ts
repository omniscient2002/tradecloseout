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
  hashSource + '\n' + queueSource + '\nwindow.__queue = { enqueueFieldUpload, drainOfflineUploadQueue, setOfflineActorPartition, listOfflineUploadDrafts, discardOfflineUploadDraft, assertOfflineDraftBudget, getMemberOfflineActorPartition, ApiProblemError };',
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
      if (url.includes('/documents/doc-one')) {
        a.push('status');
        return { versions: [{ id: 'version-one', file_status: 'READY' }] };
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
      if (url.includes('/documents/doc-one')) {
        return { versions: [{ id: 'version-one', file_status: 'PROCESSING' }] };
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
      if (url.includes('/documents/doc-one')) {
        return { versions: [{ id: 'version-one', file_status: state }] };
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
      if (url.includes('/documents/doc-one')) {
        return { versions: [{ id: 'version-one', file_status: 'FAILED' }] };
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
