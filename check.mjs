/* ============================================================================
   check.mjs — ตรวจทุกอย่างก่อนอัปโหลดขึ้น GitHub

     node check.mjs          ตรวจเฉพาะโค้ด (เร็ว ไม่ต้องมี data.js)
     node check.mjs --full   ตรวจเรนเดอร์เฉลยทุกข้อจาก data.js ด้วย (ต้องมีไฟล์ ช้ากว่า)

   ตรวจอะไรบ้าง
     1. app.js  ผ่าน syntax หรือไม่
     2. app.css วงเล็บปีกกาสมดุล + ไม่มีตัวแปร --xxx ที่เรียกแต่ไม่ประกาศ
     3. ไอคอนที่โค้ดเรียก มีอยู่ใน sprite ของ index.html ครบ
     4. ฟังก์ชันที่ onclick ใน index.html เรียก หาเจอใน app.js จริง
     5. ไฟล์ที่ sw.js precache มีอยู่จริงทุกไฟล์
     6. ไฟล์ใน data/ ครบตามสารบัญ + ไม่มีโค้ดโหลดคลังแบบเก่าหลงเหลือ
     7. (--full) เรนเดอร์เฉลยทุกข้อ ต้องไม่มีแท็กค้างและไม่มี ** หลงเหลือ
   ========================================================================== */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const F = n => join(HERE, n);
const read = n => readFileSync(F(n), 'utf8');
const FULL = process.argv.includes('--full');

let fails = 0, warns = 0;
const ok   = m => console.log('  ✓', m);
const bad  = m => { fails++; console.log('  ✗', m); };
const warn = m => { warns++; console.log('  ▲', m); };

const html = read('index.html');
const css  = read('app.css');
const js   = read('app.js');

/* ---- 1. syntax ของ app.js ---- */
console.log('\n1) syntax ของ app.js');
try { new vm.Script(js); ok('ผ่าน'); }
catch (e) { bad('พัง: ' + e.message.split('\n')[0]); }

/* ---- 2. app.css ---- */
console.log('\n2) app.css');
const open = (css.match(/{/g) || []).length, close = (css.match(/}/g) || []).length;
open === close ? ok(`วงเล็บปีกกาสมดุล (${open})`) : bad(`วงเล็บไม่สมดุล ${open} / ${close}`);
const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(m => m[1]));
const decl = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const miss = [...used].filter(v => !decl.has(v));
miss.length ? bad('ตัวแปรที่เรียกแต่ไม่ประกาศ: ' + miss.join(', ')) : ok('ตัวแปร CSS ครบ');

/* ---- 3. ไอคอน ---- */
console.log('\n3) ไอคอนใน sprite');
const have = new Set([...html.matchAll(/symbol id="(i-[a-z0-9-]+)"/g)].map(m => m[1]));
const want = new Set([
  ...[...js.matchAll(/href="#(i-[a-z0-9-]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/href="#(i-[a-z0-9-]+)"/g)].map(m => m[1]),
  ...[...js.matchAll(/\bic\('([a-z0-9-]+)'\)/g)].map(m => 'i-' + m[1]),
]);
const noIcon = [...want].filter(i => !have.has(i));
noIcon.length ? bad('ไอคอนที่เรียกแต่ไม่มี: ' + noIcon.join(', ')) : ok(`ครบ (${have.size} ไอคอน)`);

/* ---- 4. ฟังก์ชันที่ onclick เรียก ---- */
console.log('\n4) ฟังก์ชันที่ inline handler เรียก');
const headJs = (html.match(/<script>([\s\S]*?)<\/script>/) || [, ''])[1];
const SKIP = new Set(['if', 'alert', 'confirm', 'return', 'for', 'while', 'location', 'window']);
const calls = new Set([...html.matchAll(/on\w+="(\w+)\(/g)].map(m => m[1]));
const noFn = [...calls].filter(c => !SKIP.has(c) &&
  !new RegExp(`function\\s+${c}\\b`).test(js) && !new RegExp(`function\\s+${c}\\b`).test(headJs));
noFn.length ? bad('หาไม่เจอ: ' + noFn.join(', ')) : ok(`ครบ (${calls.size} ฟังก์ชัน)`);

/* ---- 5. ไฟล์ที่ sw.js precache ---- */
console.log('\n5) ไฟล์ใน CORE ของ sw.js');
const sw = read('sw.js');
const core = [...(sw.match(/const CORE\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1]
  .matchAll(/'([^']+)'/g)].map(m => m[1]);
const gone = core.filter(f => !existsSync(F(f)));
gone.length ? bad('ไฟล์หาย: ' + gone.join(', ')) : ok(`มีครบ (${core.length} ไฟล์)`);
if (core.includes('data.js')) bad('data.js ไม่ควรอยู่ใน CORE — จะบังคับให้ทุกคนโหลด 15 MB ตั้งแต่เข้าครั้งแรก');

/* ---- 6. ไฟล์ข้อสอบใน data/ ---- */
console.log('\n6) ไฟล์ข้อสอบใน data/');
const IDX = F('data/index.json');
if (!existsSync(IDX)) {
  bad('ไม่มี data/index.json — รัน npm run build-data ก่อน');
} else {
  const idx = JSON.parse(readFileSync(IDX, 'utf8'));
  const sets = idx.sets || [];
  const missing = sets.filter(s => !existsSync(F('data/' + (s.file || s.id + '.json'))));
  missing.length ? bad('ไฟล์ชุดหาย: ' + missing.map(s => s.id).join(', '))
                 : ok(`${sets.length} ชุด / ${idx.total} ข้อ — ไฟล์ครบทุกชุด`);
  const sum = sets.reduce((n, s) => n + (s.count || 0), 0);
  if (sum !== idx.total) bad(`ยอดรวมไม่ตรง: index บอก ${idx.total} แต่รวมรายชุดได้ ${sum}`);
  let bytes = 0;
  for (const s of sets) { const f = F('data/' + (s.file || s.id + '.json')); if (existsSync(f)) bytes += statSync(f).size; }
  ok(`ขนาดรวม ${(bytes / 1048576).toFixed(1)} MB (gzip ~${(bytes / 1048576 * 0.22).toFixed(1)} MB) · index ${(statSync(IDX).size / 1024).toFixed(1)} KB`);
  /* ไฟล์ที่ไม่มีใน index แล้ว = ชุดที่ถูกลบไป ควรลบไฟล์ทิ้งไม่ให้ค้างบน GitHub */
  const known = new Set(sets.map(s => s.file || s.id + '.json').concat('index.json'));
  const orphan = readdirSync(F('data')).filter(f => f.endsWith('.json') && !known.has(f));
  if (orphan.length) warn('ไฟล์ที่ไม่อยู่ในสารบัญแล้ว (ลบทิ้งได้): ' + orphan.join(', '));
}
/* ต้องไม่เหลือโค้ดดึงข้อสอบผ่าน Supabase หรือคลังสำรองก้อนเดียว */
const htmlNoComment = html.replace(/<!--[\s\S]*?-->/g, '');
const jsNoComment   = js.replace(/\/\*[\s\S]*?\*\//g, '');
const leftover = [];
if (/<script[^>]*src="data\.js"/.test(htmlNoComment)) leftover.push('index.html ยังโหลด data.js');
if (/loadFallbackData|prepOffline|loadCloudQuestions/.test(jsNoComment)) leftover.push('app.js ยังมีโค้ดโหลดคลังแบบเก่า');
leftover.length ? bad(leftover.join(' · ')) : ok('ไม่มีโค้ดโหลดคลังแบบเก่าหลงเหลือ');

/* ---- 7. เรนเดอร์เฉลยทุกข้อ ---- */
if (FULL && existsSync(F('data/index.json'))) {
  console.log('\n7) เรนเดอร์เฉลยทุกข้อ');
  const a = js.indexOf('function esc(s){');
  const b = js.indexOf('\n}', js.indexOf('function expClean(h){')) + 2;
  const ctx = { console: { log() {}, warn() {} } };
  vm.createContext(ctx);
  vm.runInContext(js.slice(a, b), ctx);
  let n = 0, broken = 0;
  const pair = (h, o, c) => (h.split(o).length === h.split(c).length);
  for (const meta of JSON.parse(readFileSync(F('data/index.json'), 'utf8')).sets) {
    const set = JSON.parse(readFileSync(F('data/' + (meta.file || meta.id + '.json')), 'utf8'));
    for (const q of (set.questions || [])) {
      if (!q.exp || q.exp.length < 200) continue;
      n++;
      const h = ctx.renderExp(q.exp);
      if (!pair(h, '<strong>', '</strong>') || !pair(h, '<ul>', '</ul>') ||
          !pair(h, '<ol>', '</ol>') || /\*\*/.test(h)) broken++;
    }
  }
  broken ? bad(`เรนเดอร์ ${n} ข้อ — พัง ${broken} ข้อ`) : ok(`เรนเดอร์ ${n} ข้อ ไม่มีปัญหา`);
} else if (!FULL) {
  console.log('\n7) เรนเดอร์เฉลย — ข้าม (ใส่ --full เพื่อตรวจ)');
}

console.log('\n' + '─'.repeat(52));
console.log(fails ? `ไม่ผ่าน ${fails} ข้อ` + (warns ? ` · เตือน ${warns} ข้อ` : '')
                  : 'ผ่านทั้งหมด' + (warns ? ` · เตือน ${warns} ข้อ` : ''));
console.log('อย่าลืมรัน python3 contrast-check.py ด้วยถ้าแก้สี\n');
process.exit(fails ? 1 : 0);
