/* NL2 Med Quiz service worker — offline app shell + data
   กลยุทธ์:
   - ไฟล์แอป + ข้อมูล (html/js) = network-first → ผู้ใช้ได้เวอร์ชันใหม่เสมอเมื่อออนไลน์,
     ถ้าออฟไลน์ค่อย fallback ไปตัวที่แคชไว้ (แก้ปัญหา "ติดข้อสอบ/แอปเวอร์ชันเก่า")
   - รูปไอคอน/สื่อ = cache-first (แทบไม่เปลี่ยน จึงเสิร์ฟจากแคชเพื่อความเร็ว)
   - CDN ข้ามโดเมน (fonts, Supabase lib) = stale-while-revalidate
*/
const CACHE = 'nl2quiz-v3';
const CORE = [
  'index.html', 'data.js', 'config.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'study.html'
];
// ไฟล์ที่ต้อง "สดใหม่เสมอ" (network-first) — แอปและคลังข้อสอบ
const FRESH = /\.(?:html|js)(?:$|\?)/i;

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
    // เอกสารนำทาง (เปิดหน้า) หรือไฟล์ html/js → network-first
    if (req.mode === 'navigate' || FRESH.test(url.pathname)) {
      e.respondWith(
        fetch(req).then(res => {
          const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res;
        }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
      );
    } else {
      // ไอคอน/สื่ออื่น ๆ → cache-first
      e.respondWith(
        caches.match(req).then(hit => hit || fetch(req).then(res => {
          const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res;
        }))
      );
    }
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
