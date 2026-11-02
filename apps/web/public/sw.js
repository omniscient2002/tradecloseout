const SHELL_CACHE_NAME = 'tc-shell-v021';
const STATIC_SHELL_ROUTES = ['/login', '/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => cache.addAll(STATIC_SHELL_ROUTES)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE_NAME)
            .map((oldKey) => caches.delete(oldKey)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Never cache /api/v1/* or presigned S3 URLs to enforce strict tenant isolation (05 §10)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.searchParams.has('X-Amz-Signature')
  ) {
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || STATIC_SHELL_ROUTES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((networkRes) => {
            const clone = networkRes.clone();
            caches.open(SHELL_CACHE_NAME).then((cache) => cache.put(request, clone));
            return networkRes;
          }),
      ),
    );
  }
});

// Background Sync trigger when Android phone regains 4G signal after leaving basement
self.addEventListener('sync', (event) => {
  if (event.tag === 'tc-drain-offline-uploads') {
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({ type: 'TC_TRIGGER_OFFLINE_QUEUE_DRAIN' });
          }
        }),
    );
  }
});
