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
const VERSION = 'pb-shell-v5';
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

// A fetch that asks the server whether the browser's copy is still current
// (a 304 when it is). A browser too old to take options on a page request
// rejects it; that one fetches the page as before.
function checked(request) {
  return fetch(request, { cache: 'no-cache' }).catch(() => fetch(request));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data and private files always go to the network.
  if (url.pathname.startsWith('/api')) return;

  // Navigations: network first so a deploy is picked up immediately, with the
  // cached shell as the offline fallback. The page is always checked with the
  // server: index.html comes with no cache rule, so a plain fetch could take
  // the browser's own copy from before the last deploy and run the old build
  // for an hour or more (2026-10-07).
  if (request.mode === 'navigate') {
    event.respondWith(
      checked(request)
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

// The reading reminder. Every push must show a notification (iOS revokes
// the permission otherwise), so a push without a readable body still
// shows a plain one.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'PowerBook';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    // Android draws the badge as a silhouette: the mark alone, white on clear
    badge: '/icons/icon-monochrome-512.png',
    // One reminder replaces the previous one instead of piling up.
    tag: data.tag || 'powerbook',
    data: { url: data.url || '/round?source=push' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// A tap on it opens the round page, in the app window that is already open
// when there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/round', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
