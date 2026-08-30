/* ============================================================================
   build-data.mjs — สร้าง data.js (คลังสำรอง/ออฟไลน์) ใหม่จาก Supabase
   ----------------------------------------------------------------------------
   ทำไมต้องมี
     • เว็บโหลดข้อสอบจาก Supabase เป็นหลัก แต่ถ้าเน็ตล่ม / โดนบล็อก CDN /
       เปิดแบบออฟไลน์ (PWA) จะ fallback มาใช้ data.js แทน
     • data.js ไม่ได้อัปเดตอัตโนมัติ → พอแก้ข้อสอบใน Supabase แล้วไม่รันสคริปต์นี้
       ผู้ใช้ตอนออฟไลน์จะยังได้ข้อสอบเวอร์ชันเก่า
     • service worker แคช data.js ไว้เป็นไฟล์หลัก ยิ่งต้องให้ตรงกับของจริง

   วิธีใช้ (รันบนเครื่องตัวเอง)
     cd "โฟลเดอร์ Website"

     SUPABASE_URL="https://xxxx.supabase.co" \
     SUPABASE_ANON_KEY="eyJhbGciOi..." \
     node build-data.mjs

     ใส่ --dry-run ต่อท้ายเพื่อดูผลก่อนโดยยังไม่เขียนทับ

   ใช้ anon key พอ (คีย์เดียวกับที่เว็บใช้ ไม่ต้องใช้ service_role)
   ถ้าไม่ตั้ง env สคริปต์จะลองอ่านจาก config.js ในโฟลเดอร์เดียวกันให้เอง
   ต้องใช้ Node 18 ขึ้นไป
   ========================================================================== */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT  = join(HERE, 'data.js');
const DRY  = process.argv.includes('--dry-run');

/* ---- หา URL/key: env ก่อน ถ้าไม่มีค่อยแคะจาก config.js ---- */
function fromConfigJs() {
  const p = join(HERE, 'config.js');
  if (!existsSync(p)) return {};
  const t = readFileSync(p, 'utf8');
  const pick = k => (t.match(new RegExp(k + '\\s*:\\s*"([^"]*)"')) || [])[1] || '';
  return { url: pick('SUPABASE_URL'), key: pick('SUPABASE_ANON_KEY') };
}
const cfg = fromConfigJs();
const URL_ = process.env.SUPABASE_URL     || cfg.url;
const KEY  = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY || cfg.key;

if (!URL_ || !KEY) {
  console.error('❌ ไม่พบ SUPABASE_URL / SUPABASE_ANON_KEY');
  console.error('   ตั้งเป็น environment variable หรือใส่ไว้ใน config.js (ดูวิธีใช้ด้านบนของไฟล์)');
  process.exit(1);
}

const supa = createClient(URL_, KEY, { auth: { persistSession: false } });

/* ---- นับข้อในไฟล์เดิม ไว้เทียบกันกันเขียนทับพลาด ---- */
function currentCounts() {
  if (!existsSync(OUT)) return { sets: 0, total: 0, byId: {} };
  try {
    const t = readFileSync(OUT, 'utf8');
    const json = t.slice(t.indexOf('['), t.lastIndexOf(']') + 1);
    const arr = JSON.parse(json);
    const byId = {};
    arr.forEach(s => { byId[s.id] = (s.questions || []).length; });
    return { sets: arr.length, total: arr.reduce((n, s) => n + (s.questions || []).length, 0), byId };
  } catch (e) {
    console.warn('⚠️  อ่าน data.js เดิมไม่ได้ (ข้ามการเทียบ):', e.message);
    return { sets: 0, total: 0, byId: {} };
  }
}

async function main() {
  console.log('📋 ดึงรายชื่อชุดข้อสอบ...');
  const setsRes = await supa.from('quiz_sets').select('id,title,subject,sort').order('sort', { ascending: true });
  if (setsRes.error) throw setsRes.error;
  const setRows = setsRes.data || [];
  if (!setRows.length) throw new Error('ตาราง quiz_sets ว่าง — ยกเลิก ไม่เขียนทับ data.js');
  console.log(`   พบ ${setRows.length} ชุด`);

  console.log('📥 ดึงข้อสอบ (ครั้งละ 1000 แถว)...');
  const qById = {}; const PAGE = 1000; let got = 0;
  for (let from = 0; ; from += PAGE) {
    const r = await supa.from('questions')
      .select('set_id,topic,q,choices,ans,exp,img,sys,sort')
      .order('set_id', { ascending: true }).order('sort', { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw r.error;
    const rows = r.data || [];
    rows.forEach(x => { (qById[x.set_id] || (qById[x.set_id] = [])).push(x); });
    got += rows.length;
    process.stdout.write(`\r   ได้มาแล้ว ${got} ข้อ`);
    if (rows.length < PAGE) break;
  }
  console.log('');

  /* ประกอบให้เหมือนที่ loadCloudQuestions() ใน index.html สร้าง
     เพื่อให้ตอนออฟไลน์กับออนไลน์ได้โครงสร้างข้อมูลชุดเดียวกันเป๊ะ ๆ */
  const built = setRows.map(s => ({
    id: s.id,
    title: s.title,
    ...(s.subject ? { subject: s.subject } : {}),
    questions: (qById[s.id] || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(x => {
      const o = { topic: x.topic || undefined, q: x.q, choices: x.choices, ans: x.ans };
      if (x.exp) o.exp = x.exp;
      if (x.img) o.img = x.img;
      if (x.sys) o.sys = x.sys;
      return o;
    })
  }));

  const total = built.reduce((n, s) => n + s.questions.length, 0);
  const old = currentCounts();

  console.log(`\n📊 ใหม่: ${built.length} ชุด / ${total} ข้อ   เดิม: ${old.sets} ชุด / ${old.total} ข้อ`);

  /* เทียบรายชุด — บอกว่าชุดไหนหาย/เพิ่ม/จำนวนเปลี่ยน */
  const changes = [];
  built.forEach(s => {
    const before = old.byId[s.id];
    if (before === undefined) changes.push(`   + ชุดใหม่ ${s.id} (${s.questions.length} ข้อ)`);
    else if (before !== s.questions.length) changes.push(`   ~ ${s.id}: ${before} → ${s.questions.length} ข้อ`);
  });
  Object.keys(old.byId).forEach(id => {
    if (!built.some(s => s.id === id)) changes.push(`   − หายไป ${id} (เดิม ${old.byId[id]} ข้อ)`);
  });
  if (changes.length) { console.log('การเปลี่ยนแปลงรายชุด:'); changes.forEach(c => console.log(c)); }
  else console.log('   จำนวนข้อรายชุดเท่าเดิมทุกชุด (เนื้อหาข้างในอาจเปลี่ยน)');

  /* ---- กันเขียนทับพลาด: data.js คือตาข่ายกันตก ถ้าดึงมาไม่ครบห้ามทับ ---- */
  const invalid = built.filter(s => s.questions.some(q => !q.q || !Array.isArray(q.choices) || typeof q.ans !== 'number' || q.ans < 0 || q.ans >= q.choices.length));
  if (invalid.length) throw new Error(`ข้อมูลผิดรูปในชุด: ${invalid.map(s => s.id).join(', ')} — ยกเลิก ไม่เขียนทับ`);
  if (!total) throw new Error('ไม่มีข้อสอบเลย — ยกเลิก ไม่เขียนทับ');
  if (old.total && total < old.total * 0.9) {
    throw new Error(`ข้อหายไปเกิน 10% (${old.total} → ${total}) — น่าจะดึงมาไม่ครบ ยกเลิกเพื่อความปลอดภัย\n` +
                    '   ถ้ามั่นใจว่าถูกต้องจริง ให้ลบ data.js เดิมทิ้งก่อนแล้วรันใหม่');
  }

  if (DRY) { console.log('\n🔍 โหมด --dry-run — ยังไม่ได้เขียนอะไร ตัด --dry-run ออกเพื่อเขียนจริง'); return; }

  if (existsSync(OUT)) {
    const bak = `${OUT}.bak_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
    copyFileSync(OUT, bak);
    console.log(`\n💾 สำรองไฟล์เดิมไว้ที่ ${bak.split('/').pop()} (อยู่ใน .gitignore แล้ว)`);
  }

  writeFileSync(OUT, 'window.QUIZ_DATA = ' + JSON.stringify(built) + ';\n', 'utf8');
  const kb = Math.round(readFileSync(OUT).length / 1024);
  console.log(`✅ เขียน data.js เสร็จ — ${built.length} ชุด / ${total} ข้อ / ${kb} KB`);
  console.log('\nหมายเหตุ:');
  console.log('  เว็บทำงานแบบออนไลน์อย่างเดียวแล้ว — ดึงข้อสอบจาก Supabase โดยตรง');
  console.log('  ไฟล์นี้จึง "ไม่ได้ถูกเสิร์ฟบนเว็บ" และอยู่ใน .gitignore ไม่ต้องอัปขึ้น GitHub');
  console.log('  ใช้เป็นข้อมูลสำรองในเครื่อง / ไฟล์ส่งออก / อินพุตของ npm run check:full');
}

main().catch(e => { console.error('\n❌ ล้มเหลว:', e.message || e); process.exit(1); });
