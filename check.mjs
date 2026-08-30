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
     6. ไม่มีร่องรอยคลังสำรอง data.js หลงเหลือในหน้าเว็บ
     7. (--full) เรนเดอร์เฉลยทุกข้อ ต้องไม่มีแท็กค้างและไม่มี ** หลงเหลือ
   ========================================================================== */
import { readFileSync, existsSync, statSync } from 'node:fs';
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

/* ---- 6. เตือนถ้ายังมีร่องรอย data.js ในหน้าเว็บ ---- */
console.log('\n6) โหมดออนไลน์อย่างเดียว');
const leftover = [];
// ตัดคอมเมนต์ออกก่อน ไม่งั้นข้อความอธิบายที่พูดถึง data.js จะถูกนับเป็นการเรียกใช้จริง
const htmlNoComment = html.replace(/<!--[\s\S]*?-->/g, '');
const swNoComment   = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const jsNoComment   = js.replace(/\/\*[\s\S]*?\*\//g, '');
if (/<script[^>]*src="data\.js"/.test(htmlNoComment)) leftover.push('index.html ยังโหลด data.js');
if (/'data\.js'/.test(swNoComment))                   leftover.push('sw.js ยังอ้าง data.js');
if (/loadFallbackData|prepOffline/.test(jsNoComment)) leftover.push('app.js ยังมีโค้ดคลังสำรอง');
leftover.length ? bad(leftover.join(' · ')) : ok('ไม่มีร่องรอยคลังสำรองหลงเหลือ');
if (existsSync(F('data.js')))
  warn(`ยังมี data.js (${(statSync(F('data.js')).size/1048576).toFixed(1)} MB) อยู่ในโฟลเดอร์ — `
     + 'เว็บไม่ใช้แล้ว ไม่ต้องอัปขึ้น GitHub (เก็บไว้เป็นข้อมูลสำรองในเครื่องได้)');

/* ---- 7. เรนเดอร์เฉลยทุกข้อ ---- */
if (FULL && existsSync(F('data.js'))) {
  console.log('\n7) เรนเดอร์เฉลยทุกข้อ');
  const a = js.indexOf('function esc(s){');
  const b = js.indexOf('\n}', js.indexOf('function expClean(h){')) + 2;
  const ctx = { console: { log() {}, warn() {} } };
  vm.createContext(ctx);
  vm.runInContext(js.slice(a, b), ctx);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('data.js'), sandbox);
  let n = 0, broken = 0;
  const pair = (h, o, c) => (h.split(o).length === h.split(c).length);
  for (const set of sandbox.window.QUIZ_DATA) for (const q of (set.questions || [])) {
    if (!q.exp || q.exp.length < 200) continue;
    n++;
    const h = ctx.renderExp(q.exp);
    if (!pair(h, '<strong>', '</strong>') || !pair(h, '<ul>', '</ul>') ||
        !pair(h, '<ol>', '</ol>') || /\*\*/.test(h)) broken++;
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
