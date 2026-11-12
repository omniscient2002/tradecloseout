// MVP transient-loss support: this worker NEVER uploads in a closed tab,
// stores private HTML, API responses, guest identity or presigned object URLs.
const SHELL_CACHE_PREFIX = 'tc-shell-';
const SHELL_CACHE_NAME = 'tc-shell-v022';
const PUBLIC_SHELL_ROUTES = ['/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => cache.addAll(PUBLIC_SHELL_ROUTES)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        // Never erase other applications' or unrelated origin caches.
        .filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE_NAME)
        .map((oldKey) => caches.delete(oldKey))))
      .then(() => self.clients.claim()),
  );
});

// Authenticated navigations, API payloads and provider URLs must not enter
// CacheStorage, including URL-encoded/alternate-case presigned parameters.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode === 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Next's hashed public assets are immutable. Do not cache route HTML or
  // arbitrary same-origin content, even if the response status is successful.
  if (!url.pathname.startsWith('/_next/static/') &&
      !PUBLIC_SHELL_ROUTES.includes(url.pathname)) return;
  if (url.search || request.headers.has('Authorization')) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    const directive = response.headers.get('Cache-Control') || '';
    if (response.ok && response.type === 'basic' &&
        !/(?:private|no-store)/i.test(directive)) {
      // A browser quota error must not make a successful network fetch fail.
      try { await cache.put(request, response.clone()); } catch { /* best effort shell cache */ }
    }
    return response;
  })());
});

// This is merely a foreground notification. It cannot drain when no app
// window exists, and never receives credentials or original evidence bytes.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'tc-drain-offline-uploads') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          client.postMessage({ type: 'TC_TRIGGER_OFFLINE_QUEUE_DRAIN' });
        }
      }),
  );
});
