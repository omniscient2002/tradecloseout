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
  hashSource + '\n' + queueSource + '\nwindow.__queue = { enqueueFieldUpload, drainOfflineUploadQueue, setOfflineActorPartition, listOfflineUploadDrafts, discardOfflineUploadDraft, assertOfflineDraftBudget };',
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
  expect(result.keys).toEqual(['complete_' + result.keys[0].slice('complete_'.length),
    'complete_' + result.keys[0].slice('complete_'.length)]);
  expect(result.keys[0]).toMatch(/^complete_/);
  expect(result.remaining).toBe(0);
});
