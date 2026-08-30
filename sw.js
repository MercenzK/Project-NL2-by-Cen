/* NL2 Med Quiz service worker — แคชเฉพาะ "ตัวแอป" (เว็บนี้ทำงานแบบออนไลน์)
   กลยุทธ์:
   - ไฟล์แอป (html/css/js) = network-first → ได้เวอร์ชันใหม่เสมอเมื่อออนไลน์
     ออฟไลน์ค่อยเสิร์ฟตัวที่แคชไว้ เพื่อให้เปิดขึ้นมาแล้วเห็นข้อความบอกสถานะ
     แทนหน้า error ของเบราว์เซอร์ (ข้อสอบยังต้องใช้เน็ตดึงจาก Supabase)
   - รูปไอคอน/รูปข้อสอบ = cache-first (แทบไม่เปลี่ยน จึงเสิร์ฟจากแคชเพื่อความเร็ว)
   - CDN ข้ามโดเมน (fonts, Supabase lib) = stale-while-revalidate
*/
const CACHE = 'nl2quiz-v9';
/* รูปข้อสอบแยกแคชต่างหาก เพราะ:
   - มีจำนวนมาก (400+ รูป) ไม่ควรโดนล้างทิ้งทุกครั้งที่ปล่อยแอปเวอร์ชันใหม่
   - รูปข้อสอบไม่เปลี่ยนเนื้อหา จึงใช้ cache-first ล้วน ไม่ต้องยิงเน็ตซ้ำ (ประหยัดเน็ตมือถือมาก) */
const IMG_CACHE = 'nl2quiz-img-v1';
/* เว็บทำงานแบบออนไลน์อย่างเดียว — ข้อสอบดึงจาก Supabase ตอนเปิดหน้า
   service worker จึงแคชเฉพาะ "ตัวแอป" (html/css/js/ไอคอน) ให้เปิดซ้ำได้เร็ว
   ไม่ได้แคชคลังข้อสอบ และไม่มี data.js ในสมการอีกต่อไป                     */
const CORE = [
  'index.html', 'app.css', 'app.js', 'config.js', 'manifest.json',
  'icon.svg', 'icon-192-v2.png', 'icon-512-v2.png', 'icon-maskable-512.png', 'study.html'
];
// ไฟล์ที่ต้อง "สดใหม่เสมอ" (network-first) — ตัวแอปทั้งหมด
const FRESH = /\.(?:html|js|css)(?:$|\?)/i;
const IMG_EXT = /\.(?:png|jpe?g|gif|webp|svg)(?:$|\?)/i;
const isImg = (req, url) => req.destination === 'image' || IMG_EXT.test(url.pathname);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    // ล้างเฉพาะแคชแอปรุ่นเก่า — แคชรูปเก็บไว้ ไม่งั้นผู้ใช้ต้องโหลดรูป ECG ใหม่ทุกครั้งที่อัปเดตเว็บ
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

/* รูป: cache-first เสมอ — เจอในแคชคืนทันที ไม่เจอค่อยโหลดแล้วเก็บไว้
   ห่อ put ด้วย catch เพราะรูปข้ามโดเมนที่ไม่มี CORS จะเป็น opaque response
   ซึ่งบางเบราว์เซอร์เก็บไม่ได้ — ถ้าเก็บไม่ได้ก็แค่ไม่แคช ไม่ทำให้หน้าพัง         */
function imageFirst(req) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const cp = res.clone();
      caches.open(IMG_CACHE).then(c => c.put(req, cp)).catch(() => {});
    }
    return res;
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // รูปทุกแหล่ง (รวมรูป ECG ที่ยังชี้ไปเว็บนอก) → cache-first แคชแยก
  if (isImg(req, url)) { e.respondWith(imageFirst(req)); return; }

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
