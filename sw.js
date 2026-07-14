/* NL2 Med Quiz service worker — offline app shell + data */
const CACHE = 'nl2quiz-v2';
const CORE = [
  'index.html', 'data.js', 'config.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'study.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // same-origin: cache-first, fall back to network, then to cached index (offline nav)
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res;
      }).catch(() => caches.match('index.html')))
    );
  } else {
    // cross-origin CDN (fonts, Supabase lib): stale-while-revalidate
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => {
          const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
