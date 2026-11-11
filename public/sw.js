const CACHE_NAME = 'bbm-static-v19';
const ASSETS = ['/', '/index.html', '/styles.css?v=20261111-login-music', '/app.js?v=20261111-login-music', '/manifest.webmanifest', '/images/logo-bbm.png', '/images/bbm-cover.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;
  if (requestUrl.pathname.startsWith('/videos/') || requestUrl.pathname.startsWith('/audio/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          return caches.open(CACHE_NAME)
            .then((cache) => cache.put(event.request, response.clone()))
            .then(() => response);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return Response.error();
      })
  );
});
