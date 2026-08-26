/* NL2 Med Quiz service worker — offline app shell + data
   กลยุทธ์:
   - ไฟล์แอป + ข้อมูล (html/js) = network-first → ผู้ใช้ได้เวอร์ชันใหม่เสมอเมื่อออนไลน์,
     ถ้าออฟไลน์ค่อย fallback ไปตัวที่แคชไว้ (แก้ปัญหา "ติดข้อสอบ/แอปเวอร์ชันเก่า")
   - รูปไอคอน/สื่อ = cache-first (แทบไม่เปลี่ยน จึงเสิร์ฟจากแคชเพื่อความเร็ว)
   - CDN ข้ามโดเมน (fonts, Supabase lib) = stale-while-revalidate
*/
const CACHE = 'nl2quiz-v7';
/* รูปข้อสอบแยกแคชต่างหาก เพราะ:
   - มีจำนวนมาก (400+ รูป) ไม่ควรโดนล้างทิ้งทุกครั้งที่ปล่อยแอปเวอร์ชันใหม่
   - รูปข้อสอบไม่เปลี่ยนเนื้อหา จึงใช้ cache-first ล้วน ไม่ต้องยิงเน็ตซ้ำ (ประหยัดเน็ตมือถือมาก) */
const IMG_CACHE = 'nl2quiz-img-v1';
/* คลังสำรอง data.js (~15 MB) แยกแคชและแยกเวอร์ชันต่างหาก เพราะ:
   - ถ้าอยู่รวมกับแคชแอป ทุกครั้งที่แก้ CSS นิดเดียวแล้วบัมป์เวอร์ชัน
     ผู้ใช้จะต้องดาวน์โหลดใหม่ 15 MB โดยไม่จำเป็น
   ► บัมป์เลขตัวนี้ "เฉพาะตอนรัน npm run build-data ใหม่" เท่านั้น            */
const DATA_CACHE = 'nl2quiz-data-v1';
/* data.js ไม่อยู่ใน CORE แล้ว — ไม่ควร precache 15 MB ให้ทุกคนตั้งแต่เข้าครั้งแรก
   ทั้งที่ส่วนใหญ่ใช้ข้อมูลจาก Supabase ตลอด ไฟล์นี้จะถูกดึงเมื่อ:
     (1) โหลดจากคลาวด์ไม่สำเร็จ   (2) ผู้ใช้กดปุ่ม "เตรียมใช้งานออฟไลน์" เอง   */
const CORE = [
  'index.html', 'app.css', 'app.js', 'config.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'study.html'
];
const DATA_FILE = /(?:^|\/)data\.js(?:$|\?)/i;
// ไฟล์ที่ต้อง "สดใหม่เสมอ" (network-first) — เฉพาะตัวแอป ไม่รวมคลังข้อมูล
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
      ks.filter(k => k !== CACHE && k !== IMG_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))
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

  /* คลังสำรอง data.js → cache-first เสมอ และเก็บในแคชของตัวเอง
     เดิมโดนกฎ FRESH จับไปเป็น network-first ทำให้ยิงโหลด 15 MB ใหม่ทุกครั้งที่เปิดเว็บ
     แม้จะมีในแคชอยู่แล้ว — เป็นสาเหตุหนึ่งที่ทำให้เว็บอืดมาก                      */
  if (url.origin === location.origin && DATA_FILE.test(url.pathname)) {
    e.respondWith(
      caches.open(DATA_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && res.ok) c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

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
