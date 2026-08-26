/**
 * Service worker for the installed app.
 *
 * Scope is deliberately narrow: it caches the built shell so the app opens
 * instantly and survives a flaky connection, and gets out of the way for
 * everything else.
 *
 * It must never cache /api — a reader seeing yesterday's circle standings, or
 * a stale streak, is worse than seeing a loading state. Book files are skipped
 * for the same reason plus size: they are tens of MB and belong to one person.
 */
const VERSION = 'pb-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data and private files always go to the network.
  if (url.pathname.startsWith('/api')) return;

  // Navigations: network first so a deploy is picked up immediately, with the
  // cached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || Response.error()))
    );
    return;
  }

  // Build assets are content-hashed, so a cache hit is always correct.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      });
    })
  );
});
