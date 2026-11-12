import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Actual production queue module, transpiled without its API-client import so
// each browser fixture can inject deterministic, in-memory API responses.
// This tests IndexedDB, navigator.locks and real fetch dispatch in Chromium.
const queueSource = readFileSync(resolve(process.cwd(), 'src/lib/offline-upload-queue.ts'), 'utf8')
  .replace("import { apiFetch, ApiProblemError } from './api-client';", `
    class ApiProblemError extends Error {}
    const apiFetch = (...args) => window.__apiFetch(...args);
  `)
  .replace(/\bexport\s+/g, '');
const queueScript = ts.transpileModule(
  queueSource + '\nwindow.__queue = { enqueueFieldUpload, drainOfflineUploadQueue, setOfflineActorPartition };',
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
