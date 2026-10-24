// Service worker: caches every file of the app on install, then serves from the cache
// (Silbo must work with no connection once loaded). VERSION and FILES are filled in by the build.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const FONTS = 'silbo-fonts'; // Google Fonts (Schibsted Grotesk, JetBrains Mono): cached the first time they load online; offline the app falls back to system fonts
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const host = new URL(e.request.url).hostname;
  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok || r.type === 'opaque') {
            const copy = r.clone();
            void caches.open(FONTS).then((c) => c.put(e.request, copy));
          }
          return r;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || Response.error())),
    );
    return;
  }
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match('./'))),
  );
});
