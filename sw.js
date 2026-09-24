// Kotoba Labo service worker.
// Bump CACHE_VERSION whenever the app shell (HTML/CSS/JS in this file's own
// scope) changes, so returning users actually get the new version instead
// of a stale cached copy.
const CACHE_VERSION = 'v2.0.0';
const SHELL_CACHE = `kotoba-labo-shell-${CACHE_VERSION}`;
const DATA_CACHE = `kotoba-labo-data-${CACHE_VERSION}`;

// Only the small app-shell files are precached at install time. The data/
// files (dictionaries, audio -- well over 100MB combined) are deliberately
// NOT precached: forcing that whole download on first install would be slow
// and failure-prone. Instead they're cached opportunistically the first
// time each one is actually fetched (see the fetch handler below), so a
// mode you've actually opened works offline afterward, without paying for
// data you've never touched.
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './modes/jisho/index.html',
  './modes/bunkei/index.html',
  './modes/pitch_drill/index.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name !== SHELL_CACHE && name !== DATA_CACHE)
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin (audio CDN, fonts, etc.)

  const isDataFile = url.pathname.includes('/data/');

  if (isDataFile) {
    // Cache-first, long-lived: these files are large and effectively
    // immutable per release, so once cached they're served instantly and
    // work offline. A fresh deploy should bump CACHE_VERSION to invalidate.
    event.respondWith(
      caches.open(DATA_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // App shell: network-first so edits show up right away when online, with
  // a cache fallback for offline use.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const resClone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
