import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

function workerFixture() {
  const handlers = new Map<string, (event: any) => void>();
  const cacheData = new Map<string, Map<string, any>>();
  const removed: string[] = [];
  const fetchCalls: string[] = [];
  let response = { ok: true, type: 'basic', headers: {
    get: (_key: string) => 'public, max-age=3600',
  }, clone() { return this; } } as any;
  let posted = 0;
  const self = {
    location: { origin: 'https://tradecloseout.example' },
    addEventListener: (key: string, callback: (event: any) => void) =>
      handlers.set(key, callback),
    skipWaiting: () => undefined,
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ postMessage: () => { posted++; } }],
    },
  };
  const caches = {
    open: async (name: string) => {
      if (!cacheData.has(name)) cacheData.set(name, new Map());
      const content = cacheData.get(name)!;
      return {
        addAll: async (paths: string[]) => {
          for (const path of paths) content.set(path, response);
        },
        match: async (req: { url: string }) => content.get(req.url),
        put: async (req: { url: string }, value: any) => {
          content.set(req.url, value);
        },
      };
    },
    keys: async () => [...cacheData.keys()],
    delete: async (key: string) => {
      removed.push(key);
      return cacheData.delete(key);
    },
  };
  runInNewContext(source, {
    self, caches, URL,
    fetch: async (request: { url: string }) => {
      fetchCalls.push(request.url);
      return response;
    },
  });
  const call = async (name: string, event: any) => {
    const pending: Promise<unknown>[] = [];
    const outputs: Promise<unknown>[] = [];
    handlers.get(name)!({
      ...event,
      waitUntil: (result: Promise<unknown>) => pending.push(result),
      respondWith: (result: Promise<unknown>) => outputs.push(result),
    });
    await Promise.all([...pending, ...outputs]);
    return { outputs };
  };
  const makeRequest = (url: string, options: { mode?: string; method?: string; auth?: boolean } = {}) => ({
    url,
    method: options.method ?? 'GET',
    mode: options.mode ?? 'same-origin',
    headers: { has: (key: string) => key === 'Authorization' && Boolean(options.auth) },
  });
  return {
    cacheData, removed, fetchCalls, call, makeRequest,
    setResponse: (next: any) => { response = next; },
    posted: () => posted,
  };
}

test('install never precaches responses before cache-control checks', async () => {
  const fixture = workerFixture();
  await fixture.call('install', {});
  expect(fixture.cacheData.get('tc-shell-v022')?.size).toBe(0);
  expect(fixture.fetchCalls).toEqual([]);
});

test('activating TradeCloseout worker preserves unrelated origin caches', async () => {
  const fixture = workerFixture();
  await fixture.cacheData.set('another-application', new Map());
  await fixture.cacheData.set('tc-shell-v021', new Map());
  await fixture.cacheData.set('tc-shell-v022', new Map());
  await fixture.call('activate', {});
  expect(fixture.removed).toEqual(['tc-shell-v021']);
  expect([...fixture.cacheData.keys()]).toEqual(['another-application', 'tc-shell-v022']);
});

test('worker never caches login HTML, protected APIs, provider links or another origin', async () => {
  const fixture = workerFixture();
  const denied = [
    fixture.makeRequest('https://tradecloseout.example/login', { mode: 'navigate' }),
    fixture.makeRequest('https://tradecloseout.example/login'),
    fixture.makeRequest('https://tradecloseout.example/api/v1/documents/secret'),
    fixture.makeRequest('https://other.example/_next/static/public.js'),
    fixture.makeRequest('https://tradecloseout.example/_next/static/file.js?X-Amz-Signature=secret'),
    fixture.makeRequest('https://tradecloseout.example/_next/static/file.js', { auth: true }),
    fixture.makeRequest('https://tradecloseout.example/_next/static/file.js', { method: 'POST' }),
  ];
  for (const request of denied) {
    const result = await fixture.call('fetch', { request });
    expect(result.outputs).toHaveLength(0);
  }
  expect(fixture.fetchCalls).toEqual([]);
});

test('hashed same-origin public static files may be cached, but failures/private responses cannot', async () => {
  const fixture = workerFixture();
  const publicFile = fixture.makeRequest('https://tradecloseout.example/_next/static/build-abcd.js');
  const first = await fixture.call('fetch', { request: publicFile });
  expect(first.outputs).toHaveLength(1);
  await fixture.call('fetch', { request: publicFile });
  expect(fixture.fetchCalls).toEqual([publicFile.url]);
  expect(fixture.cacheData.get('tc-shell-v022')?.size).toBe(1);

  const privateFile = fixture.makeRequest('https://tradecloseout.example/_next/static/private.js');
  fixture.setResponse({
    ok: true, type: 'basic',
    headers: { get: () => 'private, no-store' },
    clone() { return this; },
  });
  await fixture.call('fetch', { request: privateFile });
  expect(fixture.cacheData.get('tc-shell-v022')?.has(privateFile.url)).toBe(false);

  const failedFile = fixture.makeRequest('https://tradecloseout.example/_next/static/failure.js');
  fixture.setResponse({
    ok: false, type: 'basic',
    headers: { get: () => 'public' },
    clone() { return this; },
  });
  await fixture.call('fetch', { request: failedFile });
  expect(fixture.cacheData.get('tc-shell-v022')?.has(failedFile.url)).toBe(false);
});

test('background sync only signals an open window, never uploads evidence or credentials', async () => {
  const fixture = workerFixture();
  await fixture.call('sync', { tag: 'tc-drain-offline-uploads' });
  expect(fixture.posted()).toBe(1);
  expect(fixture.fetchCalls).toHaveLength(0);
});
