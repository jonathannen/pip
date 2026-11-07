// A small service worker: hashed build assets are cached first (they never change under one name),
// everything else goes to the network. Pages and /api are never cached, so Access and fresh data
// behave as they would without it.
const CACHE = 'pip-assets-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) {
    return;
  }
  if (!url.pathname.startsWith('/assets/')) {
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) {
        return hit;
      }
      const res = await fetch(event.request);
      if (res.ok) {
        cache.put(event.request, res.clone());
      }
      return res;
    }),
  );
});
