// Kotoba Labo service worker.
// SHELL_VERSION and DATA_VERSION are separate on purpose: the shell (this
// app's own HTML/CSS/JS) changes often as features get fixed, while the
// data/ files (dictionaries, audio) almost never do. Bump SHELL_VERSION
// whenever the app itself changes; only bump DATA_VERSION when the actual
// data/ files change. Bumping one never forces users to re-download the
// other -- in particular, a shell update never re-triggers the ~150MB+ of
// data downloads.
const SHELL_VERSION = 'v2.0.4';
const DATA_VERSION = 'v2.0.0';
const SHELL_CACHE = `kotoba-labo-shell-${SHELL_VERSION}`;
const DATA_CACHE = `kotoba-labo-data-${DATA_VERSION}`;

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

// Every file under data/ that any mode ever loads, eager or lazy -- the full
// "download for offline" set. Kept here (rather than duplicated in each
// page) so there's exactly one place that knows the whole file list and the
// one true DATA_CACHE name to put them in.
const ALL_DATA_FILES = [
  'data.js', 'freq.js', 'glosses.js', 'jp_glosses.js', 'names.js',
  'user_audio.js', 'jlpt_vocab_tags.js', 'jlpt_grammar.js',
  'freq_vocab_cloze_examples.js', 'kanji_dict.js', 'anki_word_audio.js',
  'shared_sentences.json'
];

// "Download for offline" support: a page asks for this via postMessage
// (see the button on the landing page) instead of just looping fetch()
// itself, so the caching logic and the DATA_CACHE name stay defined in
// exactly one place. Files already cached (e.g. from ordinary browsing)
// are skipped instantly -- only what's actually missing gets fetched.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'CACHE_ALL_DATA') return;
  const client = event.source;
  const total = ALL_DATA_FILES.length;
  event.waitUntil((async () => {
    const cache = await caches.open(DATA_CACHE);
    for (let i = 0; i < total; i++) {
      const name = ALL_DATA_FILES[i];
      const url = new URL(`./data/${name}`, self.location.href).toString();
      let ok = true;
      try {
        const already = await cache.match(url);
        if (!already) {
          const res = await fetch(url, { cache: 'reload' });
          if (res && res.ok) {
            await cache.put(url, res);
          } else {
            ok = false;
          }
        }
      } catch (e) {
        ok = false;
      }
      if (client) client.postMessage({ type: 'CACHE_ALL_DATA_PROGRESS', done: i + 1, total, file: name, ok });
    }
    if (client) client.postMessage({ type: 'CACHE_ALL_DATA_DONE' });
  })());
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
    // work offline. Only bump DATA_VERSION above if these files themselves
    // are ever regenerated/changed.
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

  // App shell: stale-while-revalidate. This used to be network-first, which
  // meant every single page open -- even with everything cached -- waited
  // on a full network round-trip before showing anything, since the cache
  // was only ever a fallback for when that request failed. Now a cached
  // copy (once one exists) is served immediately, while a fresh copy is
  // fetched in the background to update the cache for *next* time. A code
  // update still reaches you -- just on the following load instead of
  // blocking the current one.
  event.respondWith(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached || caches.match('./index.html'));
        // If we already have a cached copy, return it immediately and keep
        // the background refetch alive with waitUntil -- otherwise the
        // browser can tear down this worker before that fetch/cache.put
        // finishes, since nothing else is holding the event open for it.
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        return network;
      })
    )
  );
});
