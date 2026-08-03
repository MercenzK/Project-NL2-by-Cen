/* ============================================================================
   mirror-images.mjs — ย้ายรูปข้อสอบจากเว็บนอก (litfl.com ฯลฯ) มาเก็บใน Supabase Storage
   ----------------------------------------------------------------------------
   ทำไมต้องย้าย
     • ตอนนี้รูป ECG 300 ข้อ ดึงตรงจาก litfl.com ถ้าเขาบล็อก hotlink หรือย้าย URL
       ข้อสอบทั้งชุดจะไม่มีรูปทันที
     • รูปข้ามโดเมนแคชแบบออฟไลน์ไม่ได้เต็มที่ → ทำข้อสอบตอนไม่มีเน็ตไม่ได้
     • โหลดช้าเพราะยิงไปเซิร์ฟเวอร์ต่างประเทศทีละรูป

   วิธีใช้ (รันบนเครื่องตัวเอง ไม่ใช่บนเว็บ)
     1) เอา service_role key มาจาก Supabase → Settings → API
        (คีย์นี้ข้าม RLS ได้ ห้าม commit ขึ้น git เด็ดขาด)
     2) cd ไปที่โฟลเดอร์ Website แล้วรัน

        SUPABASE_URL="https://xxxx.supabase.co" \
        SUPABASE_SERVICE_KEY="eyJhbGciOi..." \
        node mirror-images.mjs --dry-run     # ดูก่อนว่าจะย้ายกี่รูป ยังไม่แตะของจริง

        แล้วค่อยรันจริงโดยตัด --dry-run ออก

   ปลอดภัย: รันซ้ำได้ รูปที่ย้ายแล้วจะถูกข้าม (idempotent)
   ต้องใช้ Node 18 ขึ้นไป (ใช้ fetch ในตัว)
   ========================================================================== */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const URL_  = process.env.SUPABASE_URL;
const KEY   = process.env.SUPABASE_SERVICE_KEY;
const BUCKET= process.env.BUCKET || 'qimg';
const DRY   = process.argv.includes('--dry-run');
const CONC  = 4;          // ดาวน์โหลดพร้อมกันกี่รูป — อย่าตั้งสูงเกินไป จะโดนฝั่งต้นทางกันไว้
const RETRY = 3;

if (!URL_ || !KEY) {
  console.error('❌ ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_KEY ก่อน (ดูวิธีใช้ด้านบนของไฟล์)');
  process.exit(1);
}
if (typeof fetch !== 'function') {
  console.error('❌ Node เวอร์ชันเก่าเกินไป ต้องใช้ Node 18 ขึ้นไป');
  process.exit(1);
}

const supa = createClient(URL_, KEY, { auth: { persistSession: false } });
const host = new URL(URL_).host;

const extOf = u => {
  const m = String(u).split('?')[0].match(/\.(jpe?g|png|gif|webp)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
};
const mimeOf = e => ({ jpg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp' }[e] || 'image/jpeg');
/* ชื่อไฟล์อิงจาก URL ต้นทาง → รันซ้ำได้ไฟล์ไม่ซ้ำ และรู้ว่ารูปไหนมาจากไหน */
const nameOf = u => createHash('sha1').update(u).digest('hex').slice(0, 20) + '.' + extOf(u);

async function grab(url) {
  for (let a = 1; a <= RETRY; a++) {
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (image mirror for offline study use)' }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 500) throw new Error('ไฟล์เล็กผิดปกติ (' + buf.length + ' bytes) — อาจโดนหน้า error');
      return buf;
    } catch (e) {
      if (a === RETRY) throw e;
      await new Promise(r => setTimeout(r, 800 * a));       // ถอยแล้วลองใหม่
    }
  }
}

async function main() {
  console.log('📋 อ่านรายการรูปจากฐานข้อมูล...');
  const { data, error } = await supa
    .from('questions').select('id,set_id,img')
    .not('img', 'is', null).neq('img', '');
  if (error) throw error;

  const rows = data.filter(r => r.img && !r.img.includes(host));   // ที่ย้ายแล้วจะมีโฮสต์ของเราอยู่
  const done = data.length - rows.length;
  const urls = [...new Set(rows.map(r => r.img))];

  console.log(`   ข้อที่มีรูปทั้งหมด ${data.length} • ย้ายแล้ว ${done} • ยังต้องย้าย ${rows.length} ข้อ (${urls.length} รูปไม่ซ้ำ)`);
  if (!urls.length) { console.log('✅ ย้ายครบแล้ว ไม่มีอะไรต้องทำ'); return; }

  const byHost = {};
  urls.forEach(u => { try { byHost[new URL(u).host] = (byHost[new URL(u).host] || 0) + 1; } catch {} });
  console.log('   แหล่งที่มา:', Object.entries(byHost).map(([h, n]) => `${h} (${n})`).join(', '));

  if (DRY) { console.log('\n🔍 โหมด --dry-run — ยังไม่ได้แตะอะไร ตัด --dry-run ออกเพื่อรันจริง'); return; }

  const map = {};            // url เดิม → url ใหม่
  const fail = [];
  let n = 0;

  const worker = async (queue) => {
    while (queue.length) {
      const url = queue.shift();
      const path = nameOf(url);
      try {
        const buf = await grab(url);
        const up = await supa.storage.from(BUCKET)
          .upload(path, buf, { contentType: mimeOf(extOf(url)), upsert: true, cacheControl: '31536000' });
        if (up.error) throw up.error;
        map[url] = supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        console.log(`   [${++n}/${urls.length}] ✔ ${path}  ←  ${url.slice(0, 70)}`);
      } catch (e) {
        fail.push({ url, err: String(e.message || e) });
        console.log(`   [${++n}/${urls.length}] ✘ ${url.slice(0, 70)} — ${e.message || e}`);
      }
    }
  };

  console.log(`\n⬇️  กำลังดาวน์โหลดและอัปโหลด (พร้อมกัน ${CONC} รูป)...`);
  const queue = [...urls];
  await Promise.all(Array.from({ length: CONC }, () => worker(queue)));

  const ok = Object.keys(map);
  console.log(`\n🔗 อัปเดต URL ในฐานข้อมูล (${ok.length} รูป)...`);
  let updated = 0;
  for (const oldUrl of ok) {
    const ids = rows.filter(r => r.img === oldUrl).map(r => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error: e2 } = await supa.from('questions')
        .update({ img: map[oldUrl] }).in('id', ids.slice(i, i + 100));
      if (e2) { console.log('   ✘ อัปเดตไม่สำเร็จ:', e2.message); break; }
    }
    updated += ids.length;
  }

  console.log(`\n✅ เสร็จ — ย้ายรูปสำเร็จ ${ok.length}/${urls.length} รูป, อัปเดตข้อสอบ ${updated} ข้อ`);
  if (fail.length) {
    console.log(`\n⚠️  ล้มเหลว ${fail.length} รูป (ข้อพวกนี้ยังชี้ไปเว็บเดิมอยู่ รันสคริปต์ซ้ำเพื่อลองใหม่ได้):`);
    fail.slice(0, 20).forEach(f => console.log('   -', f.url, '→', f.err));
    if (fail.length > 20) console.log(`   ... และอีก ${fail.length - 20} รูป`);
  }
  console.log('\nขั้นต่อไป: เปิดเว็บแล้วลองทำชุด ECG ดูว่ารูปขึ้นครบ จากนั้นค่อยลบแคชเบราว์เซอร์เพื่อทดสอบโหมดออฟไลน์');
}

main().catch(e => { console.error('\n❌ ล้มเหลว:', e.message || e); process.exit(1); });
