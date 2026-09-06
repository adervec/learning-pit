// ponytail: network-first, cache as fallback. Always fresh when online, works on a
// tablet in a car when not. Bump VERSION only if you ever need to evict the cache.
const VERSION = 'pit-v1';
const SHELL = ['./', './index.html', './app.css', './app.js', './core.js',
  './icon.svg', './icon-180.png', './icon-192.png', './manifest.webmanifest', './PROMPT.md'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // Revalidate rather than trusting the HTTP cache: a server with no Cache-Control (a
    // plain static host, python -m http.server) lets a browser keep an old app.js for
    // hours, and "network-first" would then quietly mean "yesterday's build first".
    fetch(e.request, { cache: 'no-cache' })
      .then(r => {
        const copy = r.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
