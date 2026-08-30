/* NL2 Med Quiz — ตรรกะทั้งหมดของแอป (แยกออกจาก index.html)
   โหลดด้วย defer จึงรันหลัง DOM พร้อม และไม่บล็อกการวาดหน้า */
const CFG = window.APP_CONFIG || {};
const LAB = ["A","B","C","D","E","F"];
const NEED_CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const LIB_MISSING = NEED_CLOUD && !window.supabase;
let supa = null, user = null;
if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
  try { supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); } catch(e){ console.warn(e); }
}
const CLOUD = !!supa;

/* ---------- admin gate (ซ่อนอีเมล: เทียบด้วยแฮช SHA-256 ไม่เก็บอีเมลจริงในโค้ด) ---------- */
// เก็บเป็นแฮช SHA-256 ของอีเมลแอดมิน (ย้อนกลับเป็นอีเมลไม่ได้) — override ได้ผ่าน config.js
const ADMIN_HASH = (CFG.ADMIN_EMAIL_HASH || '59e3dc80aba4aa1837d321b12e87eec7ebff154c9bfa994fb88c075662b4853e').trim().toLowerCase();
let isAdminFlag = false;
async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function computeAdmin(){
  if(!CLOUD) return true;                         // อุปกรณ์ส่วนตัว/ไม่มีระบบบัญชี
  if(!user || !user.email || !ADMIN_HASH) return false;
  try{ return (await sha256Hex(user.email.trim().toLowerCase())) === ADMIN_HASH; }catch(e){ return false; }
}
function isAdmin(){ return isAdminFlag; }
/* อนุญาตเฉพาะอีเมล @up.ac.th (หรือแอดมิน) — ใช้บังคับหลังล็อกอินทุกวิธี รวมถึง Google */
async function emailAllowed(email){
  if(!email) return false;
  const e=email.trim().toLowerCase();
  return e.endsWith('@up.ac.th') || (await sha256Hex(e))===ADMIN_HASH;
}

/* palette accents per set (for file-card tab labels) */
const SET_TAGS = {
  set1:["Cardiology","Pulmonology"], set2:["Nephrology","Endocrine"],
  set3:["GI/Hepatology","Hematology"], set4:["Infectious","Rheumatology"], set5:["Neurology","Integrated"]
};
const EST_MIN = q => Math.max(5, Math.round(q*0.9)); // ~0.9 นาที/ข้อ

/* ---------- หมวดหมู่รายวิชา (ward) ---------- */
const SUBJECTS = [
  {id:'med',   name:'Medicine',                  th:'อายุรศาสตร์',    icon:'stethoscope'},
  {id:'ecg',   name:'Medicine (ECG เน้น ๆ)',      th:'อ่าน ECG จาก tracing จริง', icon:'pulse'},
  {id:'surg',  name:'Surgery',                   th:'ศัลยศาสตร์',     icon:'scalpel'},
  {id:'obgyn', name:'Obstetrics & Gynecology',   th:'สูติ-นรีเวช',    icon:'mother'},
  {id:'ped',   name:'Pediatrics',                th:'กุมารเวชศาสตร์', icon:'baby'},
  {id:'emergency', name:'Emergency Medicine',    th:'เวชศาสตร์ฉุกเฉิน', icon:'ambulance'},
  {id:'forensic',  name:'Forensic/Ethics/Law',  th:'นิติเวช-จริยธรรม-กฎหมาย', icon:'scale'},
  {id:'past',  name:'Past Exams',                 th:'ข้อสอบเก่า',     icon:'archive'},
];
/* ตัวช่วยฝังไอคอนจาก sprite — ic('flag') → <svg class="i"><use href="#i-flag"/></svg> */
function ic(name,cls){ return `<svg class="i${cls?' '+cls:''}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function quizSubject(q){ return q.subject || (String(q.id).startsWith('set')?'med':'med'); }
function subjectQuizzes(sid){ return allQuizzes().filter(q=>quizSubject(q)===sid); }
function curSubject(){ return state.view==='subject' ? state.subject : 'med'; }
/* เปลี่ยนชื่อชุด Med ให้ขึ้นต้นด้วย "Med ชุดที่ N" */
function qTitle(q){ return /^ชุดที่/.test(q.title) ? ('Med '+q.title) : q.title; }

/* ---------- storage ---------- */
const LS = {
  get:(k,d)=>{ try{return JSON.parse(localStorage.getItem(k)) ?? d}catch(e){return d} },
  set:(k,v)=>{ localStorage.setItem(k,JSON.stringify(v)); markSynced(k); },
};

/* ============================================================================
   sync ความคืบหน้าข้ามเครื่อง
   ----------------------------------------------------------------------------
   ปัญหาเดิม: ประวัติการทำข้อสอบ sync ขึ้นคลาวด์ แต่ "ความคืบหน้า" ทั้งหมด
   (กล่อง Leitner, ข้อที่ Save, เป้าประจำวัน, วันสอบ) อยู่ใน localStorage ล้วน
   สลับจากคอมไปมือถือแล้วคิวทบทวนหาย streak รีเซ็ต

   วิธี merge (สำคัญกว่าการ sync เอง — ถ้าใช้ last-write-wins ทั้งก้อนจะทำข้อมูลหาย):
     • srs  → รวมทีละคีย์ เลือกฝั่งที่ทบทวนล่าสุด (last มากกว่า) ชนะ
     • pace → ต่อ array กันแล้วตัดเหลือ 200 ค่าล่าสุด
     • คีย์อื่น → เทียบ timestamp รายคีย์ ฝั่งที่แก้ทีหลังชนะ
   ========================================================================== */
const SYNC_KEYS=['srs','savedQuestions','bookmarks','dailyGoal','examDate','planBuffer','pace','dailyDone'];
let __syncTimer=null, __syncState='idle', __syncAt=0, __syncReady=false;
function syncMeta(){ try{ return JSON.parse(localStorage.getItem('syncMeta'))||{}; }catch(e){ return {}; } }
function markSynced(k){
  if(!SYNC_KEYS.includes(k)) return;
  const m=syncMeta(); m[k]=Date.now();
  try{ localStorage.setItem('syncMeta',JSON.stringify(m)); }catch(e){}
  schedulePush();
}
function localState(){
  const o={v:1,meta:syncMeta()};
  SYNC_KEYS.forEach(k=>{ const raw=localStorage.getItem(k); if(raw!=null){ try{ o[k]=JSON.parse(raw); }catch(e){} } });
  return o;
}
function mergeState(a,b){                     /* a = ในเครื่อง, b = บนคลาวด์ */
  if(!b||typeof b!=='object') return a;
  const out={v:1,meta:{}}, ma=a.meta||{}, mb=b.meta||{};
  SYNC_KEYS.forEach(k=>{
    const A=a[k], B=b[k], ta=ma[k]||0, tb=mb[k]||0;
    if(k==='srs'){
      const m={...(B&&typeof B==='object'?B:{})};
      Object.keys(A||{}).forEach(q=>{ const l=A[q], c=m[q];
        if(!c || (l&&(l.last||0)>=(c.last||0))) m[q]=l; });   /* ทบทวนล่าสุดชนะ */
      out[k]=m; out.meta[k]=Math.max(ta,tb);
    } else if(k==='pace'){
      const sa=(A&&A.samples)||[], sb=(B&&B.samples)||[];
      out[k]={samples:[...sa,...sb].slice(0,200)}; out.meta[k]=Math.max(ta,tb);
    } else {
      const useLocal = A!==undefined && (B===undefined || ta>=tb);
      if(useLocal){ if(A!==undefined) out[k]=A; out.meta[k]=ta; }
      else if(B!==undefined){ out[k]=B; out.meta[k]=tb; }
    }
  });
  return out;
}
function applyState(s){
  if(!s) return;
  SYNC_KEYS.forEach(k=>{ if(s[k]!==undefined){ try{ localStorage.setItem(k,JSON.stringify(s[k])); }catch(e){} } });
  try{ localStorage.setItem('syncMeta',JSON.stringify(s.meta||{})); }catch(e){}
}
async function pullState(){
  if(!CLOUD||!user||!supa) { __syncReady=true; return; }
  try{
    __syncState='syncing';
    const {data,error}=await supa.from('user_state').select('data').eq('user_id',user.id).maybeSingle();
    if(error) throw error;
    const merged=mergeState(localState(), data?data.data:null);
    applyState(merged);
    await pushState(merged);                  /* เขียนผลรวมกลับ ให้ทุกเครื่องตรงกัน */
    __syncState='ok'; __syncAt=Date.now(); __syncReady=true;
    invalidateAnalytics(); __dueCache=null;
  }catch(e){ console.warn('sync pull failed',e); __syncState='error'; __syncReady=true; }
}
async function pushState(st){
  if(!CLOUD||!user||!supa) return;
  try{
    const payload=st||localState();
    const {error}=await supa.from('user_state')
      .upsert({user_id:user.id,data:payload,updated_at:new Date().toISOString()},{onConflict:'user_id'});
    if(error) throw error;
    __syncState='ok'; __syncAt=Date.now();
  }catch(e){ console.warn('sync push failed',e); __syncState='error'; }
}
function schedulePush(){
  if(!CLOUD||!user||!__syncReady) return;     /* ยังไม่ดึงของคลาวด์มา merge ห้ามเขียนทับ */
  clearTimeout(__syncTimer);
  __syncTimer=setTimeout(()=>pushState(),3000);
}
function syncLabel(){
  if(!CLOUD||!user) return 'ไม่ได้เข้าสู่ระบบ — ความคืบหน้าเก็บในเครื่องนี้เท่านั้น';
  if(__syncState==='error') return 'ซิงก์ไม่สำเร็จ — ข้อมูลยังอยู่ในเครื่อง จะลองใหม่อัตโนมัติ';
  if(__syncState==='syncing') return '⏳ กำลังซิงก์...';
  if(__syncAt) return 'ซิงก์แล้ว '+new Date(__syncAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
  return 'พร้อมซิงก์ข้ามเครื่อง';
}
window.addEventListener('beforeunload',()=>{ if(__syncTimer){ clearTimeout(__syncTimer); pushState(); } });
function customQuizzes(){ return LS.get('customQuizzes',[]); }
function allQuizzes(){ return [...window.QUIZ_DATA, ...customQuizzes()]; }
/* จำนวนข้อของชุด — ตอนยังไม่ได้โหลดเนื้อหา (เป็นแค่โครงจากสารบัญ) ให้ใช้ count
   จากสารบัญแทน จะได้วาดการ์ดหน้าแรกได้ทันทีโดยไม่ต้องรอโหลดข้อสอบชุดไหนเลย */
function qCount(qz){ return qz && (qz.__stub ? (qz.count||0) : (qz.questions||[]).length); }
function findQuiz(id){ if(id==='combined'&&window.__combined)return window.__combined; if(window.__search&&id==='search')return window.__search; if(id==='mistakes'&&window.__mistakes)return window.__mistakes; if(id==='nl2sim'&&window.__sim)return window.__sim; if(id==='sysquiz'&&window.__sys)return window.__sys; if(id==='saved'&&window.__saved)return window.__saved; return allQuizzes().find(q=>q.id===id); }
/* ---------- stable question key + global index (for mistakes & weakness) ---------- */
function qkey(text){ let h=5381; const s=String(text||''); for(let i=0;i<s.length;i++){h=((h<<5)+h+s.charCodeAt(i))>>>0;} return 'q'+h.toString(36); }
let __qidx=null;
function QIDX(){ if(__qidx)return __qidx; __qidx={}; allQuizzes().forEach(qz=>{ (qz.questions||[]).forEach(x=>{ __qidx[qkey(x.q)]={q:x, subject:quizSubject(qz), topic:x.topic, quizTitle:qTitle(qz)}; }); }); return __qidx; }
function resetIdx(){ __qidx=null; }
/* ══════════════════════════════════════════════════════════════════════════
   คลังข้อสอบ — ไฟล์ static รายชุดใน data/

   ทำไมไม่ดึงจาก Supabase ทุกครั้ง
     คลังทั้งหมดหนัก ~14.7 MB ถ้าดึงผ่าน API ทุกครั้งที่เปิดเว็บ โควตา egress
     ของ Supabase (5 GB/เดือน) จะหมดภายในราว 340 ครั้ง แล้วเว็บจะดึงข้อสอบไม่ได้เลย
     ส่วน GitHub Pages เสิร์ฟไฟล์ static ได้ ~100 GB/เดือน แถม gzip ให้ (ลด 78%)
     และเบราว์เซอร์แคชได้ → เปิดซ้ำแทบไม่เสียแบนด์วิดท์
     Supabase จึงเหลือหน้าที่แค่บัญชี/คะแนน/อันดับ ซึ่งเป็นข้อมูลไม่กี่ KB

   โหลดยังไง
     เปิดเว็บ      → data/index.json (1.5 KB gzip) ได้รายชื่อชุด + จำนวนข้อ
                     พอสำหรับวาดหน้าแรกและการ์ดทุกใบ
     กดเข้าชุด     → ensureSet(id) ดึง data/<id>.json เฉพาะชุดนั้น
     ฟีเจอร์ที่ต้องรู้ทั้งคลัง (ทบทวน จุดอ่อน จำลองสอบ ฯลฯ)
                   → ensureAllSets() และมีการโหลดล่วงหน้าเงียบ ๆ ตอนว่าง
                     ทำให้ส่วนใหญ่กดแล้วมาเลยไม่ต้องรอ
   ══════════════════════════════════════════════════════════════════════════ */
const DATA_DIR = 'data/';
let   __setIndex = [];                 /* [{id,title,subject,count,file}] */
const __setLoading = new Map();        /* id → promise (กันโหลดซ้อน) */

/* สารบัญ — เรียกครั้งเดียวตอนบูต */
async function loadIndex(){
  try{
    const r = await fetch(DATA_DIR+'index.json', {cache:'no-cache'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const idx = await r.json();
    __setIndex = idx.sets||[];
    if(!__setIndex.length) throw new Error('สารบัญว่าง');
    /* วาง "โครงชุด" ที่ยังไม่มีตัวข้อสอบไว้ก่อน หน้าแรกใช้ count วาดการ์ดได้เลย
       โดยไม่ต้องรอโหลดเนื้อหาชุดไหน */
    window.QUIZ_DATA = __setIndex.map(s=>({
      id:s.id, title:s.title, subject:s.subject||undefined,
      count:s.count, questions:[], __stub:true
    }));
    resetIdx();
    console.log('สารบัญข้อสอบ:',__setIndex.length,'ชุด /',idx.total,'ข้อ');
    return true;
  }catch(e){
    console.warn('โหลดสารบัญข้อสอบไม่สำเร็จ:', e.message||e);
    return false;
  }
}
/* ดึงข้อสอบของชุดเดียว — ปลอดภัยเมื่อเรียกซ้ำ/เรียกพร้อมกัน */
function ensureSet(id){
  const cur = (window.QUIZ_DATA||[]).find(s=>s.id===id);
  if(!cur) return Promise.resolve(false);            /* ชุดที่สร้างเองระหว่างใช้งาน */
  if(!cur.__stub) return Promise.resolve(true);      /* โหลดแล้ว */
  if(__setLoading.has(id)) return __setLoading.get(id);
  const meta = __setIndex.find(s=>s.id===id);
  const p = fetch(DATA_DIR+(meta&&meta.file||id+'.json'))
    .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(data=>{
      cur.questions = data.questions||[];
      cur.title = data.title||cur.title;
      if(data.subject) cur.subject = data.subject;
      delete cur.__stub;
      resetIdx();
      return true;
    })
    .catch(e=>{ console.warn('โหลดชุด',id,'ไม่สำเร็จ:',e.message||e); __setLoading.delete(id); return false; });
  __setLoading.set(id,p);
  return p;
}
/* ดึงครบทุกชุด — ใช้กับฟีเจอร์ที่ต้องมองเห็นทั้งคลัง
   จำกัดการยิงพร้อมกันไว้ 6 เส้น กันเบราว์เซอร์มือถือคอขวด */
async function ensureAllSets(){
  const ids=(window.QUIZ_DATA||[]).filter(s=>s.__stub).map(s=>s.id);
  if(!ids.length) return true;
  const LIMIT=6;
  for(let i=0;i<ids.length;i+=LIMIT) await Promise.all(ids.slice(i,i+LIMIT).map(ensureSet));
  return true;
}
/* เรียกก่อนเข้าหน้าที่ต้องใช้ทั้งคลัง — โชว์ loader ให้เฉพาะตอนที่ยังโหลดไม่เสร็จจริง ๆ */
async function needAllSets(){
  if(!(window.QUIZ_DATA||[]).some(s=>s.__stub)) return;
  showLoader('กำลังเตรียมคลังข้อสอบ...');
  try{ await ensureAllSets(); } finally { hideLoader(); }
}
/* โหลดล่วงหน้าเงียบ ๆ ตอนเบราว์เซอร์ว่าง — ผู้ใช้กำลังอ่านหน้าแรกอยู่พอดี
   ทำให้พอกดเข้าหน้าทบทวน/จุดอ่อน มักจะพร้อมแล้วไม่ต้องรอ */
function prefetchSets(){
  /* เคารพผู้ใช้ที่เปิดโหมดประหยัดเน็ต หรืออยู่บนสัญญาณช้า — ไม่ดึงล่วงหน้า
     ให้ไปโหลดตอนกดใช้จริงแทน (จะมี loader ขึ้นให้เห็นว่ากำลังทำอะไรอยู่) */
  const c = navigator.connection || {};
  if(c.saveData) return;
  if(/(^|-)2g$/.test(c.effectiveType||'')) return;
  const go=()=>ensureAllSets().then(()=>{ if(state && state.view==='home') render(); });
  if('requestIdleCallback' in window) requestIdleCallback(go,{timeout:4000});
  else setTimeout(go,1500);
}
/* map a fine topic to a broad clinical system/subject bucket */
function sysBucket(t){ t=(t||'').toLowerCase();
  if(t.includes('pediatr')||t.includes('neonat')) return 'Pediatrics';
  if(t.includes('obstet')||t.includes('gyneco')||t.includes('ob-gyn')||t.includes('obgyn')) return 'OB-GYN';
  if(t.includes('orthop')||t.includes('rehab')||t.includes('fracture')) return 'Orthopedics';
  if(t.includes('ophthal')||t.includes('eye')) return 'Ophthalmology';
  if(t.includes('otolaryng')||t==='ent'||t.includes('ear, nose')) return 'ENT';
  if(t.includes('psychiat')||t.includes('behavioral')||t.includes('adolescent')) return 'Psychiatry/Behavioral';
  if(t.includes('emergen')||t.includes('toxic')||t.includes('trauma')||t.includes('resuscitation')) return 'Emergency';
  if(t.includes('forensic')||t.includes('ethic')||t.includes('community')||t.includes('ebm')||t.includes('family')) return 'Forensic/Ethics/Community';
  if(t==='surgery'||t.includes('surgical')) return 'Surgery';
  return 'Internal Medicine';
}
function bookmarks(){ return LS.get('bookmarks',[]); }
function toggleBookmark(id,ev){ if(ev)ev.stopPropagation(); let b=bookmarks(); b=b.includes(id)?b.filter(x=>x!==id):[...b,id]; LS.set('bookmarks',b); render(); }

/* ---------- attempts ---------- */
async function saveAttempt(a){
  if(CLOUD && user){
    const {error} = await supa.from('attempts').insert({quiz_id:a.quiz_id,quiz_title:a.quiz_title,score:a.score,total:a.total,answers:a.answers});
    if(error) console.warn(error);
  } else {
    const arr=LS.get('guestAttempts',[]); arr.unshift({...a,created_at:new Date().toISOString()}); LS.set('guestAttempts',arr.slice(0,300));
  }
  invalidateAnalytics();                       /* คิวทบทวน/สถิติต้องคำนวณใหม่หลังบันทึกผล */
}
async function listAttempts(){
  if(CLOUD && user){
    const {data,error}=await supa.from('attempts').select('*').order('created_at',{ascending:false}).limit(300);
    if(error){console.warn(error);return[]} return data||[];
  }
  return LS.get('guestAttempts',[]);
}
async function bestScores(){
  const at=await listAttempts(); const best={};
  at.forEach(a=>{const pct=a.score/a.total; if(!best[a.quiz_id]||pct>best[a.quiz_id].pct) best[a.quiz_id]={pct,score:a.score,total:a.total};});
  return best;
}

/* ---------- auth ---------- */
async function refreshUser(){
  if(!CLOUD){ user=null; }
  else {
    const {data}=await supa.auth.getSession();
    user=data?.session?.user||null;
    if(user && !(await emailAllowed(user.email))){ await supa.auth.signOut(); user=null; alert('อนุญาตเฉพาะบัญชีอีเมล @up.ac.th เท่านั้น'); }
  }
  isAdminFlag = await computeAdmin();
  await pullState();                          /* ดึง+merge ความคืบหน้าก่อน render ครั้งแรก */
  renderTopbar(); render();
}
function displayName(){
  if(CLOUD && user) return (user.user_metadata && user.user_metadata.username) || user.email.split('@')[0];
  if(!CLOUD) return LS.get('guestName','ผู้เยี่ยม');
  return '';
}
function renderTopbar(){
  const pill=document.getElementById('modePill');
  pill.textContent = user ? displayName() : 'ยังไม่ได้เข้าสู่ระบบ';
  pill.style.cursor='pointer'; pill.title='แก้ชื่อที่แสดง'; pill.onclick=openProfile;
  setThemeIcon();
  const rb=document.getElementById('reportsBtn'); if(rb)rb.style.display=isAdmin()?'':'none';
  const ab=document.getElementById('authBtn');
  ab.querySelector('span').textContent = user? 'ออกจากระบบ' : 'เข้าสู่ระบบ';
  ab.onclick = user? doSignOut : openAuth;
  markActiveNav();
}
/* ไอคอนธีมสลับดวงจันทร์/ดวงอาทิตย์ตามโหมดปัจจุบัน (เดิมใช้อีโมจิในข้อความปุ่ม) */
function setThemeIcon(){
  const u=document.querySelector('#themeBtn use'); if(!u)return;
  u.setAttribute('href', document.documentElement.dataset.theme==='dark' ? '#i-sun' : '#i-moon');
}
/* ไฮไลต์ปุ่มของหน้าที่กำลังเปิดอยู่ ทั้งเมนูบนและแถบล่าง */
function markActiveNav(){
  const v=state.view;
  document.querySelectorAll('.nav [data-view],#tabbar [data-view]').forEach(b=>{
    b.classList.toggle('on', b.dataset.view===v || (b.dataset.view==='cat' && v==='home'));
  });
}
async function doSignOut(){ if(supa) await supa.auth.signOut(); user=null; invalidateAnalytics(); renderTopbar(); go('home'); }
function openProfile(){
  if(CLOUD && !user){ openAuth(); return; }
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal">
    <h3 style="margin:0 0 10px;color:var(--navy)">โปรไฟล์</h3>
    ${CLOUD&&user?`<div class="muted" style="margin-bottom:8px">อีเมล: ${esc(user.email)}</div>`:'<div class="muted" style="margin-bottom:8px">โหมด Guest — ชื่อจะเก็บในเครื่องนี้</div>'}
    <label class="fld">ชื่อที่แสดง (username)</label>
    <input id="uname" type="text" maxlength="30" placeholder="ตั้งชื่อของคุณ">
    <div id="pmsg"></div>
    <div class="row" style="margin-top:16px"><button class="btn" id="saveP">บันทึก</button><button class="btn sec" id="closeP">ปิด</button></div>
  </div>`;
  document.body.appendChild(bg);
  bg.querySelector('#uname').value = displayName();
  bg.querySelector('#closeP').onclick=()=>bg.remove();
  bg.querySelector('#saveP').onclick=async()=>{
    const name=bg.querySelector('#uname').value.trim(); const msg=bg.querySelector('#pmsg');
    if(!name){ msg.innerHTML='<div class="err">กรุณาใส่ชื่อ</div>'; return; }
    msg.innerHTML='<div class="muted">กำลังบันทึก...</div>';
    if(CLOUD && user){
      const {data,error}=await supa.auth.updateUser({data:{username:name}});
      if(error){ msg.innerHTML='<div class="err">'+esc(error.message)+'</div>'; return; }
      user=data.user;
    } else { LS.set('guestName',name); }
    bg.remove(); renderTopbar(); render();
  };
}
function openAuth(){
  let tab='in';
  const bg=document.createElement('div'); bg.className='modal-bg';
  function draw(){
    bg.innerHTML=`<div class="modal">
      <div class="tabs"><div class="tab ${tab==='in'?'active':''}" id="tIn">เข้าสู่ระบบ</div><div class="tab ${tab==='up'?'active':''}" id="tUp">สมัครสมาชิก</div></div>
      <button class="btn" id="googleBtn" style="width:100%;background:#fff;color:#3c4043;border:1px solid #dadce0;display:flex;align-items:center;justify-content:center;gap:10px;font-weight:600"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> เข้าสู่ระบบด้วย Google (@up.ac.th)</button>
      <div class="muted" style="text-align:center;margin:12px 0 4px;font-size:12px">— หรือใช้อีเมล / รหัสผ่าน —</div>
      <label class="fld">อีเมล</label><input id="em" type="email" placeholder="you@email.com">
      <label class="fld">รหัสผ่าน</label><input id="pw" type="password" placeholder="อย่างน้อย 6 ตัว">
      <div id="msg"></div>
      <div class="row" style="margin-top:16px"><button class="btn" id="goBtn">${tab==='in'?'เข้าสู่ระบบ':'สมัคร'}</button><button class="btn sec" id="closeBtn">ปิด</button></div>
    </div>`;
    bg.querySelector('#tIn').onclick=()=>{tab='in';draw()};
    bg.querySelector('#tUp').onclick=()=>{tab='up';draw()};
    bg.querySelector('#googleBtn').onclick=async()=>{
      const msg=bg.querySelector('#msg');
      if(!CLOUD){ msg.innerHTML='<div class="err">ยังไม่ได้ตั้งค่า Supabase (ดู README)</div>'; return; }
      msg.innerHTML='<div class="muted">กำลังไปหน้า Google...</div>';
      const {error}=await supa.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:{hd:'up.ac.th',prompt:'select_account'}}});
      if(error){ msg.innerHTML='<div class="err">'+esc(error.message)+'</div>'; }
    };
    bg.querySelector('#closeBtn').onclick=()=>bg.remove();
    bg.querySelector('#goBtn').onclick=async()=>{
      const em=bg.querySelector('#em').value.trim(), pw=bg.querySelector('#pw').value; const msg=bg.querySelector('#msg');
      if(!CLOUD){ msg.innerHTML='<div class="err">ยังไม่ได้ตั้งค่าระบบล็อกอิน (Supabase) — ต้องใส่ SUPABASE_URL และ ANON_KEY ใน config.js ก่อน (ดูวิธีใน README)</div>'; return; }
      msg.innerHTML='<div class="muted">กำลังดำเนินการ...</div>';
      if(tab==='up'){
        const emLower=em.toLowerCase();
        const allowed = emLower.endsWith('@up.ac.th') || (await sha256Hex(emLower))===ADMIN_HASH;
        if(!allowed){ msg.innerHTML='<div class="err">สมัครสมาชิกได้เฉพาะอีเมล @up.ac.th เท่านั้น</div>'; return; }
      }
      let res = tab==='in'? await supa.auth.signInWithPassword({email:em,password:pw}) : await supa.auth.signUp({email:em,password:pw});
      if(res.error){ msg.innerHTML='<div class="err">'+res.error.message+'</div>'; return; }
      if(tab==='up' && !res.data.session){ msg.innerHTML='<div class="ok-msg">สมัครสำเร็จ! ถ้าเปิดยืนยันอีเมลไว้ ให้เช็คอีเมลก่อนเข้าสู่ระบบ</div>'; return; }
      bg.remove(); await refreshUser();
    };
  }
  draw(); document.body.appendChild(bg);
}

/* ---------- router ---------- */
let state={view:'home',quiz:null,session:null};
function requireLogin(){
  if(user) return true;
  if(CLOUD){ openAuth(); }
  else { alert('ต้องเข้าสู่ระบบก่อนจึงจะทำข้อสอบได้ (ยังไม่ได้ตั้งค่า Supabase — ดูวิธีเปิดล็อกอินใน README)'); }
  return false;
}
/* ══════════════════════════════════════════════════════════════════════════
   ROUTING — แต่ละหน้ามีลิงก์ของตัวเอง

   ใช้ hash (#/…) ไม่ใช่ path จริง เพราะเว็บโฮสต์บน GitHub Pages ซึ่ง:
     • ไม่มี rewrite rule → กด refresh ที่ /quiz/nl2-2024 จะเจอ 404
       (ทางแก้ยอดนิยมคือทำ 404.html redirect ซึ่งหน้าจอกระพริบและปุ่มย้อนกลับเพี้ยน)
     • service worker แคช index.html ไว้ ถ้าใช้ path จริงต้องเขียน logic
       map ทุก path กลับมาที่ index เพิ่มจุดพังโดยไม่ได้อะไร
   hash ให้ครบทุกอย่างที่ต้องการอยู่แล้ว: แชร์ลิงก์ได้ ปุ่มย้อนกลับ/เดินหน้าทำงาน
   บุ๊กมาร์กได้ และลิงก์ตรงเข้าข้อได้ โดยไม่ต้องแตะ hosting เลย

   รูปแบบเส้นทาง:
     #/                     หน้าแรก
     #/subject/<id>         ชุดข้อสอบในหมวดวิชา
     #/set/<id>             หน้าตั้งค่าก่อนเริ่มทำ
     #/quiz/<id>            กำลังทำข้อสอบ
     #/quiz/<id>/q<n>       ข้อที่ n (โหมดทีละข้อ)
     #/result               หน้าสรุปผลรอบล่าสุด
     #/review #/stats #/weakness #/readiness #/systems #/sim
     #/saved #/study #/rank #/reports #/search/<คำค้น>
   ══════════════════════════════════════════════════════════════════════════ */
const ROUTES={ home:'', subject:'subject', config:'set', quiz:'quiz', result:'result',
  review:'review', history:'stats', weakness:'weakness', readiness:'readiness',
  systems:'systems', simconfig:'sim', saved:'saved', study:'study',
  leaderboard:'rank', reports:'reports', search:'search', attempt:'attempt' };
const VIEW_OF=Object.fromEntries(Object.entries(ROUTES).map(([v,r])=>[r,v]));
let __applyingHash=false;   /* กันลูป: เขียน hash แล้วอย่าไปตอบสนอง hashchange ของตัวเอง */

/* สร้างสตริง hash จาก state ปัจจุบัน */
function hashFor(st){
  const seg=ROUTES[st.view]; if(seg===undefined) return '#/';
  if(st.view==='home') return '#/';
  if(st.view==='subject') return '#/subject/'+encodeURIComponent(st.subject||'');
  if(st.view==='config')  return '#/set/'+encodeURIComponent(st.quiz||'');
  if(st.view==='quiz'){
    const s=st.session, id=encodeURIComponent((s&&s.quizId)||st.quiz||'');
    /* ใส่เลขข้อเฉพาะโหมดทีละข้อ — โหมดเลื่อนยาวไม่มี "ข้อปัจจุบัน" ที่ชัดเจน */
    return (s&&quizView()==='focus'&&!s.submitted&&s.cur!=null)
      ? `#/quiz/${id}/q${s.cur+1}` : `#/quiz/${id}`;
  }
  if(st.view==='search') return '#/search/'+encodeURIComponent(window.__searchKw||'');
  return '#/'+seg;
}
/* เขียน hash ลง address bar — replace=true เมื่อเป็นการอัปเดตในหน้าเดิม
   (เช่นเปลี่ยนข้อ) จะได้ไม่ถมประวัติจนกดย้อนกลับทีละข้อ 130 ครั้ง */
function syncHash(replace){
  const h=hashFor(state);
  if(location.hash===h) return;
  __applyingHash=true;
  try{ replace ? history.replaceState(null,'',h) : history.pushState(null,'',h); }
  catch(e){ location.hash=h; }
  setTimeout(()=>{ __applyingHash=false; },0);
}
/* อ่าน hash แล้วพาไปหน้านั้น (ใช้ตอนเปิดลิงก์ตรง / กดปุ่มย้อนกลับ) */
function applyHash(){
  /* ล็อกอินด้วย Google จะเด้งกลับมาพร้อม hash ที่เป็นโทเคน เช่น
     #access_token=...&refresh_token=... ซึ่งไม่ใช่เส้นทางของเรา
     ปล่อยให้ supabase-js จัดการเอง อย่าไปแตะและอย่า render ทับ
     (ถ้าไม่กันไว้ จะถูกตีความเป็นเส้นทางที่ไม่รู้จักแล้วเด้งกลับหน้าแรกระหว่างล็อกอิน) */
  if(location.hash && !location.hash.startsWith('#/')) return;
  const raw=(location.hash||'').replace(/^#\/?/,'');
  const parts=raw.split('/').filter(Boolean).map(decodeURIComponent);
  const seg=parts[0]||'';
  const view=VIEW_OF[seg];
  if(!view){ state.view='home'; render(); return; }
  if(view==='subject'){ state.view='subject'; state.subject=parts[1]||''; render(); return; }
  if(view==='config'){  state.view='config';  state.quiz=parts[1]||''; render(); return; }
  if(view==='quiz'){
    /* เข้าลิงก์ทำข้อสอบตรง ๆ แต่ไม่มี session ค้างอยู่ → พาไปหน้าตั้งค่าของชุดนั้นแทน
       เพราะเริ่มทำเองเลยโดยไม่ถามโหมด/จับเวลา จะเสียประสบการณ์มากกว่า */
    const id=parts[1]||'';
    if(!state.session || state.session.quizId!==id){ state.view='config'; state.quiz=id; render(); return; }
    const m=/^q(\d+)$/.exec(parts[2]||'');
    if(m){ const i=Math.max(0,Math.min(state.session.items.length-1,+m[1]-1)); state.session.cur=i; }
    state.view='quiz'; render(); return;
  }
  if(view==='search'){
    const kw=parts[1]||'';
    if(kw){ const inp=document.getElementById('searchInput'); if(inp)inp.value=kw; doSearch(kw); return; }
    state.view='home'; render(); return;
  }
  /* หน้าที่ต้องมีข้อมูลค้างอยู่ก่อน ถ้าเปิดลิงก์ตรงมาแล้วไม่มีก็กลับหน้าแรก */
  if((view==='result'||view==='attempt') && !state.session){ state.view='home'; render(); return; }
  state.view=view; render();
}
function go(v,extra={}){
  if((v==='config'||v==='quiz') && !requireLogin()) return;
  state.view=v; Object.assign(state,extra);
  closeMenus(); syncHash(false); render(); window.scrollTo(0,0);
  markActiveNav();
}
/* ย้อนกลับ = ใช้ประวัติของเบราว์เซอร์ตรง ๆ ปุ่มย้อนกลับในเว็บกับของเบราว์เซอร์
   จึงทำงานเหมือนกัน (เดิมเก็บ stack เองแล้วสองอย่างนี้ไม่ตรงกัน) */
function goBack(){
  if(history.length>1){ history.back(); return; }
  go('home');
}
window.addEventListener('hashchange',()=>{ if(!__applyingHash) applyHash(); });
window.addEventListener('popstate',()=>{ if(!__applyingHash) applyHash(); });
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

/* ══════════════════════════════════════════════════════════════════════════
   renderExp — แปลงเฉลย (เก็บเป็น markdown ในฐานข้อมูล) เป็น HTML

   ทำไมต้องมี: เดิมเฉลยถูกยัดผ่าน esc() ตรง ๆ ผู้ใช้จึงเห็นเครื่องหมาย **
   และ | ของตารางเป็นตัวอักษรจริง ๆ แถวขึ้นบรรทัดใหม่ก็ยุบหายหมด กลายเป็น
   ข้อความก้อนเดียวยาว 2,000–5,000 ตัวอักษรที่อ่านแทบไม่ได้

   สิ่งที่รองรับ (ตามที่เฉลยในคลังใช้จริง):
     **ตัวหนา**            → <strong>   (ใช้วิธี "สลับสถานะ" ดูหมายเหตุด้านล่าง)
     บรรทัดที่เป็น **[ป้าย]** ล้วน  → หัวข้อย่อย
     • ...                → รายการ
     1. ...               → รายการมีลำดับ
     | a | b |            → ตารางเปรียบเทียบ
     ย่อหน้าว่าง           → ขึ้นย่อหน้าใหม่
   และจับบล็อกพิเศษ 3 อย่างแยกออกมาจัดหน้าให้ต่างจากเนื้อความ:
     "ทำไมตัวเลือกอื่นด้อยกว่า" → ยุบเก็บได้ (คนอ่านรอบสองมักข้าม)
     "[หลักการที่ควรจำจากข้อนี้]" → กล่องสรุปท้าย
     "[หมายเหตุ]"            → กล่องหมายเหตุ
   ══════════════════════════════════════════════════════════════════════════ */
/* ตัวหนา: เฉลยหลายข้อมี ** ซ้อนกันแบบไม่สมมาตร เช่น  **[ป้าย] **เนื้อหา****
   ถ้าใช้ regex จับคู่จะได้ HTML พัง จึงมองทุก ** เป็น "สวิตช์เปิด/ปิด" แทน
   วิธีนี้ไม่มีทางสร้างแท็กค้าง เพราะปิดให้เองตอนจบบรรทัดเสมอ */
function expBold(raw){
  const parts=String(raw).split('**'); let out='',on=false;
  for(let i=0;i<parts.length;i++){
    out+=esc(parts[i]);
    if(i<parts.length-1){ out+= on?'</strong>':'<strong>'; on=!on; }
  }
  return on ? out+'</strong>' : out;
}
/* ดึง "ป้ายนำหน้า" ในวงเล็บเหลี่ยมออกมาแสดงเป็นตัวหนาสีเน้น แล้วคืนที่เหลือ
   เดิมป้ายพวกนี้อยู่ในวงเล็บซ้อนตัวหนาซ้อนกัน 2–3 ชั้น จนแยกไม่ออกว่าอะไรคือหัวข้อ */
function expLabel(line){
  const m=line.match(/^\s*\*\*\s*\[([^\]]+)\]\s*\*{0,4}\s*(?:—|-|:)?\s*/);
  if(!m) return null;
  return { label:m[1].trim(), rest:line.slice(m[0].length) };
}
function expTable(rows){
  const cells=r=>r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim());
  const head=cells(rows[0]);
  const body=rows.slice(2).map(cells);          // rows[1] คือเส้นคั่น |---|---|
  const th=head.map(h=>`<th>${expBold(h)}</th>`).join('');
  const tb=body.map(r=>{
    const first=`<th>${expBold(r[0]||'')}</th>`;
    const rest=r.slice(1).map(c=>`<td>${expBold(c)}</td>`).join('');
    return `<tr>${first}${rest}</tr>`;
  }).join('');
  return `<div class="cmpwrap"><table class="cmp"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}
function renderExp(text){
  if(!text) return '';
  const lines=String(text).replace(/\r/g,'').split('\n');
  let html='', list=null, i=0;
  let why=[], take=null, note=null, inWhy=false;   // บล็อกที่ดึงออกไปจัดหน้าต่างหาก
  const push=s=>{ if(inWhy) why.push(s); else html+=s; };
  /* ต้องปิดผ่าน push เหมือนตอนเปิด ไม่งั้นถ้าลิสต์เปิดอยู่ในบล็อก "ทำไมตัวเลือกอื่น…"
     แท็กปิดจะไปโผล่ผิดที่ */
  const closeList=()=>{ if(list){ push(`</${list}>`); list=null; } };

  for(; i<lines.length; i++){
    const ln=lines[i], t=ln.trim();
    if(!t){ closeList(); continue; }

    /* ── ตาราง ── */
    if(t.startsWith('|')){
      const rows=[]; while(i<lines.length && lines[i].trim().startsWith('|')){ rows.push(lines[i].trim()); i++; }
      i--; closeList();
      if(rows.length>=2) push(expTable(rows)); else push(`<p>${expBold(rows.join(' '))}</p>`);
      continue;
    }
    /* ── หัวข้อ "ทำไมตัวเลือกอื่นด้อยกว่า" → เปลี่ยนไปเก็บใน details ── */
    if(/^\*{0,2}ทำไมตัวเลือกอื่น/.test(t)){ closeList(); inWhy=true; continue; }
    /* ── กล่องสรุปท้าย ── */
    if(/^\*{0,2}\[?หลักการที่ควรจำจากข้อนี้/.test(t)){
      closeList(); inWhy=false;
      const L=expLabel(t); take=(L?L.rest:t.replace(/^\*+|\*+$/g,''));
      continue;
    }
    /* ── หมายเหตุของข้อ ── */
    if(/^\*{0,2}\[?หมายเหตุ\]?/.test(t) && !inWhy){
      closeList(); const L=expLabel(t); note=(L?L.rest:t.replace(/^\*+/,'').replace(/^\[หมายเหตุ\]\s*/,''));
      continue;
    }
    /* ── รายการมีลำดับ ── */
    let m=t.match(/^(\d+)[.)]\s+(.*)$/);
    if(m){ if(list!=='ol'){ closeList(); push('<ol>'); list='ol'; } push(`<li>${expInline(m[2])}</li>`); continue; }
    /* ── รายการบุลเล็ต (• หรือ - หรือ ▪) ── */
    m=t.match(/^[•▪·]\s*(.*)$/) || t.match(/^-\s+(.*)$/);
    if(m){ if(list!=='ul'){ closeList(); push('<ul>'); list='ul'; } push(`<li>${expInline(m[1])}</li>`); continue; }
    /* ── บรรทัดที่เป็นป้ายล้วน → หัวข้อย่อย ── */
    const L=expLabel(t);
    if(L && !L.rest){ closeList(); push(`<h4>${expBold(L.label)}</h4>`); continue; }
    /* ── ย่อหน้าปกติ ── */
    closeList(); push(`<p>${expInline(t)}</p>`);
  }
  closeList();
  if(inWhy){} // ปิดอัตโนมัติด้านล่าง

  let out='';
  /* บรรทัดแรกของเฉลยคือ "คำตอบ" เสมอ → ยกขึ้นมาเป็นกล่องจุดตัดสิน */
  out+=html.replace(/^<p>(.*?)<\/p>/, (mm,inner)=>
    `<div class="exp-key"><span class="exp-key-l">คำตอบ</span>${inner}</div>`);
  if(note) out+=`<div class="exp-note"><span class="exp-key-l">หมายเหตุ</span>${expInline(note)}</div>`;
  if(why.length) out+=`<details class="exp-why"><summary><svg class="i"><use href="#i-x"/></svg>`+
    `ทำไมตัวเลือกอื่นจึงด้อยกว่า<svg class="i chev"><use href="#i-down"/></svg></summary>`+
    `<div class="in">${why.join('')}</div></details>`;
  if(take) out+=`<div class="exp-take"><span class="exp-key-l">สิ่งที่ควรจำจากข้อนี้</span>${expInline(take)}</div>`;
  return expClean(out);
}
/* inline: ถ้าขึ้นต้นด้วยป้าย [..] ให้แยกป้ายออกมาเป็นตัวหนาสีเน้น */
function expInline(s){
  const L=expLabel(s);
  if(!L) return expBold(s);
  if(!L.rest) return `<b class="exp-lb">${expBold(L.label)}</b>`;
  return `<b class="exp-lb">${expBold(L.label)}</b> ${expBold(L.rest)}`;
}
/* เก็บกวาดหลังแปลง:
   1) ป้าย [..] ที่ยังฝังอยู่กลางตัวหนา ให้ยกออกมาเป็นป้ายเหมือนกัน
      (เฉลยหลายข้อมีป้ายซ้อนกัน 2 ชั้นในบรรทัดเดียว)
   2) ลบ <strong></strong> เปล่า ๆ ที่เกิดจาก **** ท้ายประโยค */
function expClean(h){
  return h
    /* ป้ายตัวแรกของแต่ละบรรทัดถูกดึงออกไปเป็น .exp-lb ตั้งแต่ expInline แล้ว
       ที่เหลือคือป้ายชั้นในซึ่งถ้าทำเป็นสีเน้นด้วยจะกลายเป็นสีแดงเต็มหน้า
       จึงแค่ถอดวงเล็บเหลี่ยมออกแล้วปล่อยให้เป็นตัวหนาธรรมดา */
    .replace(/<strong>\s*\[([^\]<]+)\]\s*<\/strong>/g,'<strong>$1</strong>')
    .replace(/<strong>\s*\[([^\]<]+)\]\s*/g,'<strong>$1 — ')
    /* ป้ายที่โผล่กลางประโยค เช่น "— [เหตุผล] ..." (พบราว 3,400 จุดในคลัง)
       ถอดวงเล็บออกแล้วทำเป็นตัวหนา — จำกัดเฉพาะข้อความที่มีอักษรไทย
       เพื่อไม่ให้ไปโดนสัญกรณ์ความเข้มข้นแบบ [Na+] [K+] ที่เป็นอักษรละติน */
    .replace(/\[([^\]<>\n+]{2,70})\]/g,'<b>$1</b>')
    .replace(/<strong>(?:\s|&nbsp;)*<\/strong>/g,'')
    .replace(/(<b class="exp-lb">[^<]*<\/b>)\s*(?:—|-|:)\s*/g,'$1 ')
    /* เฉลยต้นทางมักปิดตัวหนาแล้วต่อคำทันทีโดยไม่เว้นวรรค เติมช่องว่างให้ */
    .replace(/<\/(b|strong)>(?=[^\s<.,;:!?)\]])/g,'</$1> ');
}
/* รูปโหลดไม่ขึ้น (ไม่มีเน็ต / เว็บต้นทางบล็อก hotlink) — แสดงกล่องบอกเหตุผลแทนไอคอนรูปแตก
   สร้างด้วย DOM ไม่ใช่ innerHTML เพราะ src มาจากภายนอก ไม่ควรเอาไปต่อสตริง HTML */
function imgFail(el){
  if(!el || el.dataset.failed) return; el.dataset.failed='1';
  const src=el.getAttribute('src')||'';
  const d=document.createElement('div'); d.className='imgfail';
  const t=document.createElement('span'); t.textContent='โหลดรูปประกอบไม่สำเร็จ — ';
  const a=document.createElement('a'); a.href=src; a.target='_blank'; a.rel='noopener noreferrer';
  a.textContent='เปิดรูปต้นฉบับ'; a.style.textDecoration='underline';
  const n=document.createElement('div'); n.className='muted'; n.style.fontSize='13px'; n.style.marginTop='4px';
  n.textContent='ถ้าอยู่โหมดออฟไลน์ ให้เปิดข้อนี้ตอนมีเน็ตสักครั้ง ระบบจะเก็บรูปไว้ให้ใช้ออฟไลน์รอบหน้า';
  d.appendChild(t); d.appendChild(a); d.appendChild(n);
  el.replaceWith(d);
}
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function scrollToCat(){ if(state.view!=='home'){go('home');setTimeout(()=>document.getElementById('categories')?.scrollIntoView({behavior:'smooth'}),80);} else document.getElementById('categories')?.scrollIntoView({behavior:'smooth'}); }
function showLoader(m){ const l=document.getElementById('loader'); document.getElementById('loaderMsg').textContent=m||'กำลังเตรียมข้อสอบ...'; l.style.display='flex'; }
function hideLoader(){ document.getElementById('loader').style.display='none'; }

/* หน้าที่ต้อง "มองเห็นทั้งคลัง" ถึงจะคำนวณได้ถูก — ทบทวน จุดอ่อน ความพร้อม
   ตามระบบ จำลองสอบ ที่บันทึกไว้ สถิติ ดูย้อนหลัง
   หน้าแรก/หมวดวิชา ไม่อยู่ในนี้ เพราะใช้แค่ตัวเลขจากสารบัญก็พอ */
let __dataFailed=false;   /* โหลดสารบัญข้อสอบไม่สำเร็จ — ใช้กันไม่ให้ render() วาดหน้าเปล่าทับข้อความบอกสาเหตุ */
const VIEWS_NEED_ALL = new Set(['review','weakness','readiness','systems','simconfig','saved','history','attempt']);
async function render(){
  const app=document.getElementById('app');
  /* โหลดคลังไม่สำเร็จ → คงข้อความบอกสาเหตุไว้เสมอ อย่าวาดหน้าแรกที่ว่างเปล่าทับ
     (การล็อกอินสำเร็จจะยิง render() ตามมาทีหลัง ถ้าไม่กันตรงนี้ข้อความจะหายไป) */
  if(__dataFailed || !(window.QUIZ_DATA||[]).length){ __bootFailedNotice(); return; }
  if(VIEWS_NEED_ALL.has(state.view)) await needAllSets();
  /* หน้าตั้งค่าก่อนเริ่มทำ ต้องมีข้อสอบชุดนั้นจริง ๆ ถึงจะบอกจำนวนข้อ/สุ่มได้ */
  if(state.view==='config' && state.quiz) await ensureSet(state.quiz);
  qdashUnmount();                                  /* ปุ่ม Dashboard โผล่เฉพาะหน้าทำข้อสอบ */
  updateReviewBadge();                             /* ตัวนับข้อค้างทบทวนบนแถบเมนู */
  markActiveNav();                                 /* ไฮไลต์เมนูของหน้าปัจจุบัน */
  if(state.view==='review') return renderReview(app);
  if(state.view==='search') return renderSearch(app);
  if(state.view==='attempt') return renderAttempt(app);
  if(state.view==='home') return renderHome(app);
  if(state.view==='subject') return renderSubject(app);
  if(state.view==='config') return renderConfig(app);
  if(state.view==='quiz') return renderQuiz(app);
  if(state.view==='result') return renderResult(app);
  if(state.view==='history') return renderHistory(app);
  if(state.view==='leaderboard') return renderLeaderboard(app);
  if(state.view==='weakness') return renderWeakness(app);
  if(state.view==='simconfig') return renderSimConfig(app);
  if(state.view==='systems') return renderSystems(app);
  if(state.view==='readiness') return renderReadiness(app);
  if(state.view==='study') return renderStudy(app);
  if(state.view==='reports') return renderReports(app);
  if(state.view==='saved') return renderSaved(app);
}
function renderStudy(app){
  app.innerHTML=`<div class="wrap" style="padding-top:16px">
    <div class="row" style="margin-bottom:10px;align-items:center">
      <b class="qtitle" style="font-size:19px">สรุปอ่านสอบ High-Yield แยก Ward</b>
      <span style="flex:1"></span>
      <button class="btn sm sec" onclick="window.open('study.html','_blank')">เปิดแท็บใหม่</button>
      <button class="btn sm sec" onclick="go('home')">หน้าแรก</button>
    </div>
    <iframe src="study.html" title="สรุปอ่านสอบ" style="width:100%;height:82vh;border:1px solid var(--line);border-radius:12px;background:var(--paper)"></iframe>
  </div>`;
}

/* ---------- HOME ----------
   เดิม hero เป็นแถบไล่สีสูงราว 320px ที่มีแค่คำโปรยกับปุ่ม — คนที่เข้ามาทุกวัน
   ต้องเลื่อนผ่านทุกครั้ง ตอนนี้ใช้พื้นที่ก้อนเดียวกันบอก 4 ตัวเลขที่ทำให้
   ตัดสินใจได้ทันทีว่าจะทำอะไรต่อ แล้ววางปุ่มหลักไว้ตรงนั้นเลย            */
function thaiToday(){
  const d=new Date();
  const wd=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'][d.getDay()];
  const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][d.getMonth()];
  return `วัน${wd}ที่ ${d.getDate()} ${mo}`;
}
function examDaysLeftText(){
  try{ const n=Math.ceil((examDate()-Date.now())/86400000);
    return n>0 ? ` · เหลืออีก ${n.toLocaleString()} วันถึงวันสอบ` : ''; }catch(e){ return ''; }
}
/* % ของข้อในชุดนี้ที่เคยเห็นแล้ว (อิงคิวทบทวน ซึ่งบันทึกทุกข้อที่ตอบไปแล้ว) */
function setProgressPct(q){
  try{
    const m=srsMap(); const ks=q.questions.map(x=>qkey(x.q));
    const seen=ks.filter(k=>m[k]).length;
    return ks.length? Math.round(seen/ks.length*100):0;
  }catch(e){ return 0; }
}
function homeMetricsHTML({at,totalQ,totalDone,weekDone,avg}){
  let due=0; try{ const st=srsStats(); due=st.dueToday+st.overdue; }catch(e){}
  let streak=0; try{ streak=computeStreak(at); }catch(e){}
  const pct = totalQ? Math.round(totalDone/totalQ*100):0;
  const m=(n,k,hot)=>`<div class="metric${hot?' hot':''}"><div class="n">${n}</div><div class="k">${k}</div></div>`;
  return `<div class="metrics">
    ${m(`${due.toLocaleString()}<small>ข้อ</small>`,'ถึงกำหนดทบทวนวันนี้',due>0)}
    ${m(`${totalDone.toLocaleString()}`,`ทำไปแล้วจาก ${totalQ.toLocaleString()} ข้อ (${pct}%)`)}
    ${m(`${avg}<small>%</small>`,'ความแม่นเฉลี่ยทั้งหมด')}
    ${m(`${streak}<small>วัน</small>`,'ทำต่อเนื่อง')}
  </div>`;
}
async function renderHome(app){
  const best=await bestScores(); const qs=allQuizzes(); const bk=bookmarks();
  const at=await listAttempts();
  const now=Date.now();
  const totalDone=at.reduce((s,a)=>s+a.total,0);
  const weekDone=at.filter(a=>now-new Date(a.created_at).getTime()<7*864e5).reduce((s,a)=>s+a.total,0);
  const avg=at.length?Math.round(at.reduce((s,a)=>s+a.score/a.total,0)/at.length*100):0;
  const totalQ=qs.reduce((s,q)=>s+qCount(q),0);

  app.innerHTML=`
  ${resumeBannerHTML()}
  ${examPlanHTML(at)}
  ${streakGoalHTML(at)}
  ${dailyCardHTML()}
  ${LIB_MISSING?`<div class="wrap" style="padding-top:16px"><div class="warn"><b style="color:var(--bad)">โหลดระบบล็อกอินไม่สำเร็จ</b><div class="muted">ตั้งค่า Supabase ครบแล้ว แต่เบราว์เซอร์โหลดไลบรารีไม่ได้ (มักโดนตัวบล็อกโฆษณา/เครือข่ายบล็อก CDN) — ปิดตัวบล็อกโฆษณาสำหรับเว็บนี้แล้วรีเฟรช หรือลองเบราว์เซอร์/เน็ตอื่น. ระหว่างนี้ยังทำข้อสอบได้แบบ Guest</div></div></div>`:''}

  <div class="hero"><div class="wrap">
    <div class="greet">
      <span>${thaiToday()}${examDaysLeftText()}</span>
      <svg class="ecgline" viewBox="0 0 600 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0,14 H30 C34,14 36,9 40,9 C44,9 46,14 50,14 H68 L72,14 L76,3 L82,25 L88,8 L92,14
                 H110 C116,14 120,7 126,7 C132,7 136,14 142,14
                 H230 C234,14 236,9 240,9 C244,9 246,14 250,14 H268 L272,14 L276,3 L282,25 L288,8 L292,14
                 H310 C316,14 320,7 326,7 C332,7 336,14 342,14
                 H430 C434,14 436,9 440,9 C444,9 446,14 450,14 H468 L472,14 L476,3 L482,25 L488,8 L492,14
                 H510 C516,14 520,7 526,7 C532,7 536,14 542,14 H600"/>
      </svg>
    </div>
    <h1>${at.length?'กลับมาต่อจากเดิมได้เลย':'เริ่มข้อแรกกันเลย'}</h1>
    ${homeMetricsHTML({at,totalQ,totalDone,weekDone,avg})}
    <div class="cta">
      <button class="btn" onclick="startCombined()">${ic('play')}เริ่มทำข้อสอบเลย</button>
      <button class="btn outline" onclick="go('study')">${ic('book')}อ่านสรุป High-Yield</button>
      <button class="btn outline" onclick="scrollToCat()">${ic('grid')}เลือกตามรายวิชา</button>
    </div>
  </div>
  <svg class="ecgline" viewBox="0 0 1200 60" preserveAspectRatio="none"><path d="M0,30 L280,30 L300,30 L312,8 L326,52 L340,20 L354,30 L560,30 L580,30 L592,8 L606,52 L620,20 L634,30 L900,30 L920,30 L932,8 L946,52 L960,20 L974,30 L1200,30"/></svg>
  </div>

  <div class="wrap">
    <section id="categories">
      <div class="sechead"><span class="bar"></span><h2>หมวดหมู่รายวิชา</h2><span class="muted" style="margin-left:auto">เลือกหมวด แล้วกดเข้าไปดูชุดข้อสอบ</span></div>
      <div class="cat-grid">
        ${SUBJECTS.map(sub=>{ const list=subjectQuizzes(sub.id); const tq=list.reduce((s,q)=>s+qCount(q),0);
          return `<div class="file-card subj" onclick="go('subject',{subject:'${sub.id}'})">
            <div class="subjico">${ic(sub.icon)}</div>
            <h3 style="margin-top:2px">${sub.name}</h3>
            <div class="muted" style="font-size:13px">${sub.th}</div>
            <div class="meta" style="justify-content:center;margin-top:10px"><span>${list.length} ชุด</span><span>${tq} ข้อ</span></div>
            ${list.length?`<div class="best">${ic('check')} พร้อมทำ</div>`:'<div class="muted" style="font-size:13px">เร็ว ๆ นี้</div>'}
          </div>`;
        }).join('')}
      </div>
    </section>

    <section>
      <div class="sechead"><span class="bar"></span><h2>ข้อสอบแนะนำ</h2>
        <span class="more" onclick="startCombined()">สุ่มรวมทุกชุด ${ic('right')}</span></div>
      <div class="trend-scroll">
        ${qs.map(q=>{ const tags=SET_TAGS[q.id]||['Custom']; const on=bk.includes(q.id);
          /* แถบความคืบหน้าที่ขอบบนการ์ด — สแกนทั้งแถวแล้วรู้ทันทีว่าเหลือชุดไหน
             เดิมต้องกดเข้าไปดูทีละชุดถึงจะรู้ */
          const b=best[q.id]; const pct=setProgressPct(q);
          return `<div class="trend-card">
            <div class="rail"><i style="width:${pct}%"></i></div>
            <div class="row" style="justify-content:space-between">
              <span class="tag teal">${esc(tags[0])}</span>
              <span class="bk ${on?'on':''}" style="position:static" onclick="toggleBookmark('${q.id}',event)">${ic('star')}</span>
            </div>
            <h3>${esc(qTitle(q))}</h3>
            <div class="meta"><span>${qCount(q)} ข้อ</span><span>~${EST_MIN(qCount(q))} นาที</span></div>
            <div class="foot">
              <button class="btn sm" onclick="go('config',{quiz:'${q.id}'})">${ic('play')}${pct>0&&pct<100?'ทำต่อ':'ทำข้อสอบ'}</button>
              <span class="muted" style="font-size:12px;margin-left:auto">${
                pct>=100 ? `ทำครบแล้ว${b?` · ดีที่สุด <b style="color:var(--ok)">${Math.round(b.score/b.total*100)}%</b>`:''}`
                : pct>0 ? `ทำแล้ว ${pct}%` : 'ยังไม่เคยทำ'}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>

    <section>
      <div class="monitor">
        <h3>ความคืบหน้าของคุณ</h3>
        <div class="muted" style="font-size:13px">${CLOUD&&user?'สวัสดี '+esc(displayName()):'เก็บในเครื่องนี้ (โหมด Guest)'}</div>
        <div class="stats">
          <div class="stat"><div class="n">${weekDone}</div><div class="l">ข้อ (7 วันล่าสุด)</div></div>
          <div class="stat"><div class="n">${totalDone}</div><div class="l">ข้อทั้งหมด</div></div>
          <div class="stat"><div class="n">${at.length}</div><div class="l">ครั้งที่ทำ</div></div>
          <div class="stat"><div class="n">${avg}%</div><div class="l">คะแนนเฉลี่ย</div></div>
        </div>
        <div class="msg">${weekDone>0?`สัปดาห์นี้คุณทำข้อสอบไปแล้ว ${weekDone} ข้อ! รักษาจังหวะการเต้นของหัวใจ (ความขยัน) นี้ไว้นะ ❤️`:'ยังไม่มีชีพจร... เริ่มทำข้อแรกเพื่อกระตุ้นหัวใจความขยันกันเถอะ! ⚡'}</div>
        <svg class="ecg" viewBox="0 0 300 80" preserveAspectRatio="none"><path d="M0,40 L70,40 L82,14 L96,66 L110,26 L124,40 L200,40 L212,14 L226,66 L240,26 L254,40 L300,40"/></svg>
      </div>
    </section>
  </div>`;
}

/* ---------- search ---------- */
/* ---------- ค้นหา — เปิดเป็นหน้าอ่านผลลัพธ์ ไม่ใช่โยนเข้าไปทำข้อสอบทันที ----------
   เฉลย 2,699 ข้อที่เขียนไว้จึงใช้เป็นหนังสืออ้างอิงได้ พิมพ์ "Sgarbossa" แล้วอ่านได้เลย  */
let __searchShow=40;
function searchFields(x){ return (x.q+' '+(x.topic||'')+' '+(x.exp||'')+' '+((x.choices||[]).join(' '))).toLowerCase(); }
/* รับ kw ตรง ๆ ได้ด้วย เพื่อให้เปิดลิงก์ #/search/<คำค้น> แล้วค้นให้เองอัตโนมัติ */
async function doSearch(kwArg){
  /* ค้นในเนื้อเฉลยด้วย จึงต้องมีข้อสอบครบทุกชุดก่อน
     (ปกติโหลดล่วงหน้าไปแล้วตั้งแต่ตอนอยู่หน้าแรก จึงมักไม่ต้องรอ) */
  await needAllSets();
  const raw=(kwArg!=null?kwArg:((document.getElementById('searchInput')||{}).value||''));
  const kw=String(raw).trim();
  if(!kw){ scrollToCat(); return; }
  const low=kw.toLowerCase();
  const all=[]; allQuizzes().forEach(q=>q.questions.forEach(x=>all.push(x)));
  const hits=all.filter(x=>searchFields(x).includes(low));
  if(!hits.length){ alert('ไม่พบข้อสอบที่ตรงกับ "'+kw+'"'); return; }
  __searchShow=40;
  window.__searchKw=kw;
  window.__search={id:'search',title:'ผลค้นหา: "'+kw+'" ('+hits.length+' ข้อ)',questions:hits};
  go('search');
}
function searchMore(){ __searchShow+=40; render(); }
function startSearchQuiz(){ if(window.__search) go('config',{quiz:'search'}); }
/* escape ก่อน แล้วค่อยครอบ <mark> — ทำสลับลำดับจะเปิดช่องให้ HTML หลุดเข้ามา */
function hlEsc(s,kw){
  const t=esc(s||''); if(!kw) return t;
  const k=esc(kw).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  try{ return t.replace(new RegExp(k,'gi'), m=>'<mark>'+m+'</mark>'); }catch(e){ return t; }
}
/* ในหน้าผลค้นหาไม่ควรทุ่มเฉลยเต็ม 5,000 ตัวอักษรลงในการ์ดทุกใบ
   ตัดเป็นช่วงสั้น ๆ รอบคำที่ค้นแทน (คนค้นอยากรู้ว่า "อยู่ตรงไหน" ก่อน) */
function expSnippet(exp,kw,span){
  if(!exp) return '';
  const plain=String(exp).replace(/\|/g,' ').replace(/\*\*/g,'').replace(/^[•▪·-]\s*/gm,'')
    .replace(/\s*\n\s*/g,' ').replace(/\s{2,}/g,' ').trim();
  span=span||150;
  let out=plain, more=plain.length>span*2;
  if(kw){
    const at=plain.toLowerCase().indexOf(kw.toLowerCase());
    if(at>-1){
      const a=Math.max(0,at-span), b=Math.min(plain.length,at+kw.length+span);
      out=(a>0?'… ':'')+plain.slice(a,b)+(b<plain.length?' …':'');
      more=false;
    } else { out=plain.slice(0,span*2)+(more?' …':''); more=false; }
  } else { out=plain.slice(0,span*2)+(more?' …':''); more=false; }
  return `<div class="exp-snip">${hlEsc(out,kw)}</div>`;
}
function renderSearch(app){
  const S=window.__search, kw=window.__searchKw||'';
  if(!S){ go('home'); return; }
  const idx=QIDX(), hits=S.questions, show=Math.min(__searchShow,hits.length);
  const inExp=hits.filter(x=>(x.exp||'').toLowerCase().includes(kw.toLowerCase())).length;
  const cards=hits.slice(0,show).map(x=>{
    const rec=idx[qkey(x.q)]||{};
    const ansTxt=(x.choices||[])[x.ans]||'';
    return `<div class="card srch">
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">
        <span class="tag">${esc(rec.quizTitle||'คลังข้อสอบ')}</span>
        ${x.topic?`<span class="tag teal">${esc(x.topic)}</span>`:''}</div>
      <div style="font-weight:500;line-height:1.55">${hlEsc(x.q,kw)}</div>
      <div style="margin-top:7px;color:var(--ok);font-size:15px"><b>เฉลย ${LAB[x.ans]}.</b> ${hlEsc(ansTxt,kw)}</div>
      ${expSnippet(x.exp,kw)}
    </div>`; }).join('');
  app.innerHTML=`<div class="wrap" style="padding-top:18px">
    <div class="row" style="margin-bottom:10px;align-items:center;flex-wrap:wrap">
      <b class="qtitle" style="font-size:20px">${esc(kw)}</b>
      <span class="badge">${hits.length} ข้อ</span>
      <span style="flex:1"></span>
      <button class="btn sm" onclick="startSearchQuiz()">▶ ทำเป็นชุดข้อสอบ</button>
      <button class="btn sm sec" onclick="goBack()">${ic('left')}กลับ</button></div>
    <div class="card" style="padding:12px 18px"><span class="muted" style="font-size:14px">
      พบในเฉลย ${inExp} ข้อ • ที่เหลือพบในโจทย์ ตัวเลือก หรือหัวข้อ — เลื่อนอ่านได้เลย หรือกดปุ่มขวาบนเพื่อเอาทั้งหมดไปทำเป็นชุดข้อสอบ</span></div>
    ${cards}
    ${show<hits.length?`<div class="card" style="text-align:center"><button class="btn sec" onclick="searchMore()">โหลดเพิ่ม (เหลืออีก ${hits.length-show} ข้อ)</button></div>`:''}
  </div>`;
  window.scrollTo({top:0,behavior:'auto'});
}

/* ---------- SUBJECT (ชุดข้อสอบในหมวด) ---------- */
async function renderSubject(app){
  const sub=SUBJECTS.find(s=>s.id===state.subject)||SUBJECTS[0];
  const list=subjectQuizzes(sub.id); const best=await bestScores(); const bk=bookmarks();
  app.innerHTML=`<div class="wrap" style="padding-top:22px">
    <div class="row" style="margin-bottom:12px"><button class="btn sec sm" onclick="go('home')">${ic('left')} หมวดหมู่ทั้งหมด</button></div>
    <div class="sechead"><span class="subjico" style="width:34px;height:34px;margin:0 10px 0 0;border-radius:var(--r-sm)">${ic(sub.icon)}</span><h2>${esc(sub.name)}</h2>
      ${isAdmin()?`<span class="more" style="margin-left:auto" onclick="document.getElementById('upl').click()">อัปโหลดชุด (แอดมิน)</span>
      <input id="upl" type="file" accept=".json,.csv" style="display:none" onchange="handleUpload(event)">`:''}</div>
    ${list.length? `<div class="cat-grid">${list.map(q=>{ const b=best[q.id]; const tags=SET_TAGS[q.id]||[q.questions[0]?.topic||'Custom']; const on=bk.includes(q.id);
      return `<div class="file-card" onclick="go('config',{quiz:'${q.id}'})">
        <span class="bk ${on?'on':''}" title="บันทึกไว้ทำทีหลัง" onclick="toggleBookmark('${q.id}',event)">${ic('bookmark')}</span>
        <h3>${esc(qTitle(q))}</h3>
        <div class="tags">${tags.map(t=>`<span class="tag teal">${esc(t)}</span>`).join('')} ${q.custom?'<span class="tag">อัปโหลดเอง</span>':''}</div>
        <div class="meta"><span>${qCount(q)} ข้อ</span><span>~${EST_MIN(qCount(q))} นาที</span></div>
        ${b?`<div class="best">${ic('check')} คะแนนดีสุด ${b.score}/${b.total} (${Math.round(b.pct*100)}%)</div>`:'<div class="muted">ยังไม่เคยทำ</div>'}
        ${q.custom?`<div style="margin-top:8px"><span class="tag" style="cursor:pointer;background:var(--badbg);color:var(--bad)" onclick="event.stopPropagation();delCustom('${q.id}')">ลบชุดนี้</span></div>`:''}
      </div>`; }).join('')}</div>`
    : `<div class="card"><b class="qtitle" style="font-size:19px">ยังไม่มีข้อสอบในหมวด ${esc(sub.name)}</b><div class="muted" style="margin-top:6px">เร็ว ๆ นี้ 🚧${isAdmin()?' — หรือกดปุ่ม “อัปโหลดชุด (แอดมิน)” ด้านบนเพื่อเพิ่มชุดข้อสอบในหมวดนี้':''}</div></div>`}
  </div>`;
}

/* ---------- CONFIG ---------- */
function renderConfig(app){
  const q=findQuiz(state.quiz);
  app.innerHTML=`<div class="wrap" style="padding-top:26px">
   <div class="row" style="margin-bottom:10px"><button class="btn sec sm" onclick="goBack()">${ic('left')} ย้อนกลับ</button></div>
   <div class="card">
     <h2 class="qtitle">${esc(qTitle(q))}</h2>
     <div class="muted">${qCount(q)} ข้อ • ประมาณ ${EST_MIN(qCount(q))} นาที</div>
     <label class="fld">โหมด</label>
     <select id="mode">
       <option value="practice">ฝึก (Practice) — คลิกตอบแล้วเฉลยทันที</option>
       <option value="exam">สอบ (Exam) — ตอบครบแล้วกดส่ง</option>
     </select>
     <label class="fld">จำนวนข้อ</label>
     <select id="count">
       <option value="10">10 ข้อ</option><option value="20">20 ข้อ</option>
       <option value="50">50 ข้อ</option><option value="all" selected>ทั้งหมด (${qCount(q)})</option>
     </select>
     <label class="fld chk"><input type="checkbox" id="shuffleQ" checked> สลับลำดับข้อ</label>
     <label class="fld chk"><input type="checkbox" id="shuffleO"> สลับลำดับตัวเลือก</label>
     <label class="fld chk"><input type="checkbox" id="timer"> จับเวลา (โหมดสอบ) — 1 นาที/ข้อ</label>
     <div class="row" style="margin-top:18px">
       <button class="btn" onclick="beginQuiz()">${ic('play')}เริ่มทำ</button>
       <button class="btn sec" onclick="goBack()">${ic('left')} ย้อนกลับ</button>
       <button class="btn sec" onclick="go('home')">หน้าแรก</button>
     </div>
   </div></div>`;
}
function val(id){return document.getElementById(id).value;}
function chk(id){return document.getElementById(id).checked;}
function buildSession(quiz,opt){
  let items=quiz.questions.slice();
  if(opt.shuffleQ) items=shuffle(items);
  if(opt.count!=='all') items=items.slice(0,parseInt(opt.count));
  items=items.map(q=>{ let ch=q.choices.map((c,i)=>({c,orig:i})); if(opt.shuffleO)ch=shuffle(ch);
    return {id:q.id,key:qkey(q.q),topic:q.topic,q:q.q,img:q.img,choices:ch.map(x=>x.c),ans:ch.findIndex(x=>x.orig===q.ans),exp:q.exp}; });
  const secPer=opt.secPerItem||60;
  return {quizId:quiz.id,quizTitle:qTitle(quiz),mode:opt.mode,sim:!!opt.sim,items,answers:{},flags:{},times:{},__startedAt:Date.now(),submitted:false,timeLeft:((opt.mode==='exam'&&opt.timer)||opt.sim)?Math.round(items.length*secPer):null};
}
/* ---------- ทำต่อ (resume unfinished quiz) ---------- */
const RESUME_KEY='resumeSession';
function resumeOwner(){ return (user&&user.email)||'guest'; }
function persistSession(){
  const s=state.session;
  if(!s || s.submitted){ try{localStorage.removeItem(RESUME_KEY);}catch(e){} return; }
  try{ LS.set(RESUME_KEY,{owner:resumeOwner(),ts:Date.now(),s:{quizId:s.quizId,quizTitle:s.quizTitle,mode:s.mode,sim:s.sim,items:s.items,answers:s.answers,flags:s.flags,times:s.times,submitted:false,timeLeft:s.timeLeft}}); }catch(e){}
}
function clearResume(){ try{localStorage.removeItem(RESUME_KEY);}catch(e){} }
function savedResume(){ const r=LS.get(RESUME_KEY,null); if(!r||!r.s||r.owner!==resumeOwner())return null; return r; }
function resumeQuiz(){ const r=savedResume(); if(!r)return; state.session=r.s; go('quiz'); if(state.session.timeLeft!=null)startTimer(); }
function exitQuiz(){ if(confirm('ออกจากข้อสอบ? ความคืบหน้าที่บันทึกไว้จะถูกลบ')){ clearResume(); go('home'); } }
function resumeBannerHTML(){
  const r=savedResume(); if(!r)return '';
  const s=r.s; const answered=Object.keys(s.answers||{}).length;
  return `<div class="wrap" style="padding-top:16px"><div class="card" style="border-left:5px solid var(--teal);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:200px"><b style="color:var(--navy)">▶ ทำข้อสอบต่อ (Continue)</b><div class="muted">${esc(s.quizTitle||'ข้อสอบ')} — ตอบแล้ว ${answered}/${(s.items||[]).length} ข้อ${s.mode==='exam'?' • Exam':''}</div></div>
    <button class="btn" onclick="resumeQuiz()">ทำต่อ</button>
    <button class="btn sec" onclick="clearResume();render()">ลบทิ้ง</button>
  </div></div>`;
}
window.addEventListener('beforeunload',persistSession);
window.addEventListener('pagehide',persistSession);
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden')persistSession(); });

function beginQuiz(){
  const q=findQuiz(state.quiz);
  const opt={mode:val('mode'),count:val('count'),shuffleQ:chk('shuffleQ'),shuffleO:chk('shuffleO'),timer:chk('timer')};
  showLoader('กำลังสุ่มข้อสอบ...');
  setTimeout(()=>{ state.session=buildSession(q,opt); persistSession(); hideLoader(); go('quiz'); if(state.session.timeLeft!=null)startTimer(); },550);
}
let timerInt=null;
function startTimer(){ clearInterval(timerInt); timerInt=setInterval(()=>{ const s=state.session; if(!s||s.submitted){clearInterval(timerInt);return;}
  s.timeLeft--; paintTimer();
  if(s.timeLeft<=0){clearInterval(timerInt);submitExam();} },1000); }
function paintTimer(){ const s=state.session; const el=document.getElementById('timer-disp');
  if(!el||!s||s.timeLeft==null)return;
  const m=Math.floor(s.timeLeft/60), ss=s.timeLeft%60;
  el.querySelector('b').textContent=`${m}:${String(ss).padStart(2,'0')}`;
  el.classList.toggle('warn', s.timeLeft<=300);            // 5 นาทีสุดท้ายเปลี่ยนเป็นสีแดง
}

/* ---------- QUIZ ----------
   มีสองมุมมอง เก็บค่าที่เลือกไว้ใน localStorage:
     focus  = ทีละข้อ (ค่าเริ่มต้น) — จอโล่ง เดินหน้าด้วยปุ่มหรือคีย์บอร์ด
     scroll = เลื่อนยาวเห็นทุกข้อ (แบบเดิม) — เหมาะกับตอนไล่ตรวจก่อนส่ง            */
function quizView(){ try{ return localStorage.getItem('quizView')||'focus'; }catch(e){ return 'focus'; } }
function setQuizView(v){ try{ localStorage.setItem('quizView',v); }catch(e){}
  const s=state.session; if(s && s.cur==null) s.cur=0; render(); }
function toggleQuizView(){ setQuizView(quizView()==='focus'?'scroll':'focus'); syncHash(true); }

function renderQuiz(app){
  const s=state.session; if(s.cur==null||s.cur>=s.items.length) s.cur=0;
  const answered=Object.keys(s.answers).length;
  const focus=quizView()==='focus' && !s.submitted;
  /* แถบบนยุบเหลือชั้นเดียวสูง 44px + เส้นความคืบหน้า 2px ที่ขอบบนสุด
     เดิมมี qbar (2 บรรทัด) + qnavbar เกาะล่าง + แถบคีย์ลัด รวมกินความสูงคงที่
     ราว 180px บนมือถือ 390px เหลือพื้นที่อ่านโจทย์จริงไม่ถึงครึ่งจอ */
  app.innerHTML=`
   <div class="qtop">
     <div class="qtop-bar"><i id="pbar" style="width:${answered/s.items.length*100}%"></i></div>
     <div class="qtop-in">
       <svg class="i" style="color:var(--ink-3)"><use href="#i-archive"/></svg>
       <span class="qtop-name">${esc(s.quizTitle)}</span>
       <span class="badge">${s.mode==='exam'?'สอบจริง':'ฝึกทำ'}</span>
       <span style="flex:1"></span>
       ${s.timeLeft!=null?`<span id="timer-disp" class="timer"><svg class="i"><use href="#i-clock"/></svg><b>--:--</b></span>`:''}
       <span class="badge star-badge" id="flagcnt"></span>
       <span class="qcount" id="cnt">${answered}/${s.items.length}</span>
       <button class="actbtn" onclick="toggleQuizView()" title="${focus?'ดูทุกข้อในหน้าเดียว':'ดูทีละข้อ'}"
         aria-label="${focus?'ดูทุกข้อในหน้าเดียว':'ดูทีละข้อ'}">
         <svg class="i"><use href="#i-${focus?'menu':'play'}"/></svg></button>
     </div>
   </div>
   <div class="wrap qwrap">
   <div id="qlist"></div>
   ${focus?`<div class="qfoot">
       <button class="btn sec" onclick="stepQ(-1)" ${s.cur===0?'disabled':''}>
         <svg class="i"><use href="#i-left"/></svg>ก่อนหน้า</button>
       ${s.cur===s.items.length-1
          ? (s.mode==='exam'
              ? `<button class="btn" onclick="confirmSubmit()"><svg class="i"><use href="#i-check"/></svg>ส่งคำตอบ</button>`
              : `<button class="btn" onclick="finishPractice()"><svg class="i"><use href="#i-chart"/></svg>ดูสรุป</button>`)
          : `<button class="btn" onclick="stepQ(1)">ถัดไป<svg class="i"><use href="#i-right"/></svg></button>`}
       <span class="kbdhint">
         <span class="kbd">A–E</span> ตอบ
         <span class="kbd">←</span><span class="kbd">→</span> เปลี่ยนข้อ
         <span class="kbd">S</span> ดาว
         <span class="kbd">B</span> เซฟ
       </span>
     </div>`:''}
   <div class="qfoot">
     ${!focus&&s.mode==='exam'&&!s.submitted?`<button class="btn" onclick="confirmSubmit()"><svg class="i"><use href="#i-check"/></svg>ส่งคำตอบ</button>`:''}
     ${!focus&&s.mode==='practice'?`<button class="btn" onclick="finishPractice()"><svg class="i"><use href="#i-chart"/></svg>ดูสรุปคะแนน / บันทึก</button>`:''}
     <button class="btn quiet" onclick="exitQuiz()">ออกจากชุดนี้</button>
   </div></div>`;
  const list=document.getElementById('qlist');
  if(focus) list.appendChild(qCard(s.items[s.cur],s.cur));
  else s.items.forEach((q,i)=>list.appendChild(qCard(q,i)));
  updateFlagCount(); paintTimer();
  qdashMount();
}
/* เลื่อนไปข้อถัดไป/ก่อนหน้าในโหมดทีละข้อ */
function stepQ(d){ const s=state.session; if(!s)return;
  const n=Math.min(s.items.length-1, Math.max(0, s.cur+d));
  if(n===s.cur)return; s.cur=n;
  /* replace ไม่ใช่ push — ไม่งั้นทำครบ 130 ข้อแล้วต้องกดย้อนกลับ 130 ครั้งกว่าจะออก */
  syncHash(true);
  render(); window.scrollTo({top:0,behavior:'instant'}); }

/* คีย์ลัด — ทำงานเฉพาะตอนอยู่หน้าข้อสอบ ไม่มีโมดัลเปิด และไม่ได้พิมพ์ในช่องกรอก */
document.addEventListener('keydown',e=>{
  if(state.view!=='quiz'||!state.session)return;
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  const t=e.target.tagName; if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return;
  if(window.__qdashModal||window.__submitModal)return;
  const s=state.session, focus=quizView()==='focus'&&!s.submitted;
  const i=focus?s.cur:null;
  const k=e.key.toLowerCase();
  if(focus&&(e.key==='ArrowRight'||k==='j')){ e.preventDefault(); stepQ(1); return; }
  if(focus&&(e.key==='ArrowLeft'||k==='k')){ e.preventDefault(); stepQ(-1); return; }
  if(i===null)return;
  const letters='abcde';
  let j=letters.indexOf(k);
  if(j<0 && k>='1' && k<='5') j=+k-1;
  if(j>=0 && j<s.items[i].choices.length){ e.preventDefault(); selectAns(i,j); return; }
  /* S = ดาว (เดิมใช้ F ยังใช้ได้อยู่เพื่อไม่ให้คนที่ชินต้องเปลี่ยนนิสัย)
     B = บันทึกเข้าคลัง */
  if(k==='s'||k==='f'){ e.preventDefault(); toggleFlag(i); return; }
  if(k==='b'){ e.preventDefault(); const q=s.items[i]; if(q) toggleSavedQ(q.key,i); }
});
/* ข้อความยืนยันสั้น ๆ ข้างปุ่ม — บอกสถานะด้วยตัวอักษรด้วย ไม่ใช่แค่สีเปลี่ยน */
function actHint(i,msg){
  const h=document.getElementById('ah'+i); if(!h)return;
  h.textContent=msg; h.classList.add('show');
  clearTimeout(h.__t); h.__t=setTimeout(()=>h.classList.remove('show'),1800);
}
function updateFlagCount(){ const s=state.session; const fc=document.getElementById('flagcnt'); if(!fc)return;
  const n=s.flags?Object.values(s.flags).filter(Boolean).length:0;
  fc.innerHTML = n ? `<svg class="i"><use href="#i-star"/></svg>${n}` : ''; }
/* วาดการ์ดข้อเดียวใหม่ — โหมดทีละข้อมีลูกแค่ตัวเดียวใน #qlist ส่วนโหมดเลื่อนยาวอิงตามลำดับข้อ */
function refreshQCard(i){
  const list=document.getElementById('qlist'); if(!list)return;
  const pos=(quizView()==='focus'&&!state.session.submitted)?0:i;
  const node=list.children[pos]; if(!node)return;
  list.replaceChild(qCard(state.session.items[i],i),node);
}
function toggleFlag(i){ const s=state.session; if(!s.flags)s.flags={}; s.flags[i]=!s.flags[i];
  const on=s.flags[i];
  refreshQCard(i); updateFlagCount(); qdashBadge(); persistSession();
  actHint(i, on?'ทำเครื่องหมายไว้แล้ว':'เอาเครื่องหมายออก'); }
function jumpTo(i){ __closeSubmit();
  const s=state.session;
  /* โหมดทีละข้อ: ไม่มีอะไรให้เลื่อนหา ต้องสลับไปข้อนั้นแล้ววาดใหม่ */
  if(quizView()==='focus'&&!s.submitted){ s.cur=i; syncHash(true); render(); window.scrollTo(0,0); return; }
  const el=document.getElementById('qc'+i); if(!el)return;
  el.scrollIntoView({behavior:'smooth',block:'center'}); const old=el.style.boxShadow; el.style.boxShadow='0 0 0 3px var(--teal)';
  setTimeout(()=>{ el.style.boxShadow=old||''; },1300); }
function __closeSubmit(){ if(window.__submitModal){ window.__submitModal.remove(); window.__submitModal=null; } }

/* ---------- Question Dashboard — ปุ่มลอยตามจอ + ผังสถานะทุกข้อ ----------
   ทำแล้ว = ไม่มีกรอบ / ยังไม่ทำ = มีกรอบ / มาร์กไว้หรือ Save = ธงแดง
   แตะเลขข้อ = เด้งไปยังข้อนั้นทันที                                        */
function qdashMount(){
  if(document.getElementById('qdashFab'))return;
  const b=document.createElement('button');
  b.id='qdashFab'; b.type='button'; b.title='Dashboard — ผังข้อสอบ'; b.setAttribute('aria-label','เปิด Dashboard ผังข้อสอบ');
  b.onclick=openQDash;
  b.innerHTML=`<svg viewBox="0 0 32 32" aria-hidden="true">
      <rect class="sq" x="4"  y="4"  width="10.5" height="10.5" rx="1.6"/>
      <rect class="sq" x="17.5" y="4"  width="10.5" height="10.5" rx="1.6"/>
      <rect class="sq" x="4"  y="17.5" width="10.5" height="10.5" rx="1.6"/>
      <rect class="sq" x="17.5" y="17.5" width="10.5" height="10.5" rx="1.6"/>
    </svg><span class="fabdot" id="qdashDot"></span>`;
  document.body.appendChild(b);
  qdashBadge();
}
function qdashUnmount(){ const f=document.getElementById('qdashFab'); if(f)f.remove(); closeQDash(); }
function qdashBadge(){ const d=document.getElementById('qdashDot'); const s=state.session; if(!d||!s)return;
  const left=s.items.length-Object.keys(s.answers).length;
  d.textContent=left>0?left:'✓'; d.style.background=left>0?'var(--teal)':'var(--ok)'; }
function closeQDash(){ if(window.__qdashModal){ window.__qdashModal.remove(); window.__qdashModal=null; } }
function qdashCurrent(){ const s=state.session; if(!s)return -1;
  if(quizView()==='focus'&&!s.submitted) return s.cur||0;
  let best=-1,bd=Infinity; const mid=window.innerHeight/2;
  for(let i=0;i<s.items.length;i++){ const el=document.getElementById('qc'+i); if(!el)continue;
    const r=el.getBoundingClientRect(); const d=Math.abs(r.top+r.height/2-mid); if(d<bd){bd=d;best=i;} }
  return best; }
function qdashGo(i){ closeQDash(); jumpTo(i); }
/* วนไปข้อที่ติดดาวถัดไป (วนกลับต้นเมื่อถึงข้อสุดท้าย) — เดิมต้องไล่หาเอง */
function gotoNextFlag(){
  const s=state.session; if(!s||!s.flags)return;
  const all=s.items.map((_,i)=>i).filter(i=>s.flags[i]); if(!all.length)return;
  const cur=qdashCurrent();
  jumpTo(all.find(i=>i>cur) ?? all[0]);
}
function gotoFirstUnanswered(){
  const s=state.session; if(!s)return;
  const i=s.items.findIndex((_,k)=>s.answers[k]===undefined);
  if(i>-1) jumpTo(i);
}
function openQDash(){
  const s=state.session; if(!s)return; closeQDash();
  const cur=qdashCurrent(); let done=0,mk=0;
  const cells=s.items.map((q,i)=>{
    const ans=s.answers[i]!==undefined; if(ans)done++;
    const marked=!!(s.flags&&s.flags[i]); if(marked)mk++;   /* นับเฉพาะ Mark for review ไม่รวม Save */
    /* ดาวมุมช่อง = ข้อที่ทำเครื่องหมายไว้ — ใช้ทั้งสีขอบและรูปดาวบอกสถานะ */
    return `<button class="qd${ans?' done':''}${marked?' mark':''}${i===cur?' cur':''}" onclick="qdashGo(${i})" `+
           `title="ข้อ ${i+1}${ans?' • ตอบแล้ว':' • ยังไม่ตอบ'}${marked?' • ทำเครื่องหมายไว้':''}">`+
           `${i+1}</button>`;
  }).join('');
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:560px">
    <div class="row" style="align-items:baseline;margin-bottom:var(--s4)">
      <b style="font-size:18px">ผังข้อ</b>
      <span class="muted" style="font-size:13px;margin-left:auto">ทำแล้ว ${done} / ${s.items.length}</span>
      <button class="actbtn" onclick="closeQDash()" aria-label="ปิด"><svg class="i"><use href="#i-x"/></svg></button>
    </div>
    <div class="qdash-legend">
      <i><span class="box"></span>ยังไม่ทำ</i>
      <i><span class="box done"></span>ทำแล้ว</i>
      <i><span class="box mark"></span>ทำเครื่องหมายไว้</i>
      <i><span class="box cur"></span>ข้อปัจจุบัน</i>
    </div>
    <div class="qdash-grid">${cells}</div>
    <div class="qdash-foot">
      ${mk?`<button class="btn sec sm" onclick="closeQDash();gotoNextFlag()"><svg class="i"><use href="#i-star"/></svg>ไปข้อที่ทำเครื่องหมายไว้ (${mk})</button>`:''}
      ${done<s.items.length?`<button class="btn quiet sm" onclick="closeQDash();gotoFirstUnanswered()">ไปข้อแรกที่ยังไม่ทำ</button>`:''}
    </div>
  </div>`;
  bg.addEventListener('click',e=>{ if(e.target===bg)closeQDash(); });
  document.body.appendChild(bg); window.__qdashModal=bg;
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeQDash(); });

function confirmSubmit(){ const s=state.session;
  const unanswered=[]; s.items.forEach((q,i)=>{ if(s.answers[i]===undefined)unanswered.push(i); });
  const flagged=Object.keys(s.flags||{}).filter(k=>s.flags[k]).map(Number).sort((a,b)=>a-b);
  const chip=i=>`<button class="btn sm sec" style="padding:3px 9px;margin:2px;min-width:38px" onclick="jumpTo(${i})">${i+1}</button>`;
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal" style="max-width:540px">
    <h3 style="margin:0 0 6px;color:var(--navy)">ยืนยันการส่งคำตอบ</h3>
    <div class="muted">ตอบแล้ว ${Object.keys(s.answers).length}/${s.items.length} ข้อ • คลิกเลขข้อเพื่อกลับไปดู</div>
    <div style="margin-top:12px"><b style="color:var(--bad)">ยังไม่ได้ตอบ (${unanswered.length})</b>
      <div style="max-height:120px;overflow:auto;margin-top:4px">${unanswered.length?unanswered.map(chip).join(''):'<span class="muted">— ตอบครบแล้ว —</span>'}</div></div>
    <div style="margin-top:12px"><b style="color:var(--gold-d)">ทำเครื่องหมายไว้ (${flagged.length})</b>
      <div style="max-height:120px;overflow:auto;margin-top:4px">${flagged.length?flagged.map(chip).join(''):'<span class="muted">— ไม่มี —</span>'}</div></div>
    <div class="row" style="margin-top:18px">
      <button class="btn" onclick="__closeSubmit();submitExam()">ส่งเลย</button>
      <button class="btn sec" onclick="__closeSubmit()">↩ กลับไปตรวจ</button></div>
  </div>`;
  bg.addEventListener('click',e=>{ if(e.target===bg)__closeSubmit(); });
  document.body.appendChild(bg); window.__submitModal=bg;
}
function qCard(q,i){
  const s=state.session; const chosen=s.answers[i]; const reveal=s.mode==='practice'?chosen!==undefined:s.submitted;
  const flagged=!!(s.flags&&s.flags[i]);
  const div=document.createElement('div'); div.className='card'; div.id='qc'+i;
  if(flagged) div.classList.add('flagged');
  /* ปุ่มประจำข้อ 2 ปุ่ม เป็นไอคอนล้วน แต่มี title + aria-label + aria-pressed กำกับเสมอ
       ★ ดาว  = ไม่มั่นใจ เดี๋ยวกลับมาทำ — ชั่วคราวเฉพาะรอบนี้ และโผล่ในผังข้อ (คีย์ S)
       💾 ดิสก์ = เก็บถาวรเข้าคลัง "บันทึกไว้" ข้ามรอบข้ามชุด            (คีย์ B)
     บอกสถานะด้วยทั้งสีและรูปทรง (ดาวทึบ/ดาวโปร่ง) ไม่พึ่งสีอย่างเดียว */
  const flagCtl = !s.submitted
    ? `<button class="actbtn star ${flagged?'on':''}" onclick="toggleFlag(${i})" aria-pressed="${flagged}"
         title="${flagged?'เอาเครื่องหมายออก':'ทำเครื่องหมายไว้ กลับมาทำทีหลัง'} (S)"
         aria-label="${flagged?'เอาเครื่องหมายออก':'ทำเครื่องหมายไว้ กลับมาทำทีหลัง'}"><svg class="i"><use href="#i-star"/></svg></button>`
    : (flagged?'<span class="badge star-badge"><svg class="i"><use href="#i-star"/></svg>ทำเครื่องหมายไว้</span>':'');
  const saved=isSavedQ(q.key);
  const saveBtn=`<button id="sv${i}" class="actbtn save ${saved?'on':''}" onclick="toggleSavedQ('${q.key}',${i})" aria-pressed="${saved}"
      title="${saved?'เอาออกจากคลังของฉัน':'บันทึกข้อนี้เข้าคลังของฉัน'} (B)"
      aria-label="${saved?'เอาออกจากคลังของฉัน':'บันทึกข้อนี้เข้าคลังของฉัน'}"><svg class="i"><use href="#i-save"/></svg></button>`;
  div.innerHTML=`<div class="qhead"><span class="qnum">ข้อ ${i+1}</span>${q.topic?`<span class="tag">${esc(q.topic)}</span>`:''}<span style="flex:1"></span><span class="acthint" id="ah${i}"></span>${flagCtl}${saveBtn}</div><div class="stem">${esc(q.q)}</div>${q.img?`<img class="qimg" src="${esc(q.img)}" alt="รูปประกอบข้อสอบ" loading="lazy" onerror="imgFail(this)">`:''}`;
  q.choices.forEach((c,j)=>{ const b=document.createElement('button'); b.className='opt';
    if(chosen===j)b.classList.add('sel');
    if(reveal){ if(j===q.ans)b.classList.add('correct'); if(j===chosen&&chosen!==q.ans)b.classList.add('wrong'); b.disabled=s.mode==='practice'; }
    b.innerHTML=`<span class="lab">${LAB[j]}</span><span class="otxt">${esc(c)}</span>`; b.onclick=()=>selectAns(i,j); div.appendChild(b); });
  if(reveal){ const ok=chosen===q.ans; const ex=document.createElement('div'); ex.className='exp';
    const mark=chosen===undefined ? '<svg class="i"><use href="#i-x"/></svg>ไม่ได้ตอบ'
              : (ok ? '<svg class="i"><use href="#i-check"/></svg>ถูกต้อง'
                    : '<svg class="i"><use href="#i-x"/></svg>ยังไม่ถูก');
    ex.innerHTML=`<div class="res ${ok?'ok':'bad'}">${mark}<span class="res-sub"> — คำตอบที่ถูกคือ ${LAB[q.ans]}</span></div>`
      + renderExp(q.exp)
      + `<div class="exp-tools"><button id="rep${i}" class="btn sm sec" onclick="reportQuestion(${i})"><svg class="i"><use href="#i-flag"/></svg>รายงานว่าเฉลยผิด</button></div>`;
    div.appendChild(ex); }
  return div;
}
function selectAns(i,j){ const s=state.session;
  if(s.mode==='practice'){ if(s.answers[i]!==undefined)return; s.answers[i]=j; } else { if(s.submitted)return; s.answers[i]=j; }
  recordTime(s,i);
  const answered=Object.keys(s.answers).length;
  const cnt=document.getElementById('cnt'); if(cnt)cnt.textContent=`${answered}/${s.items.length}`;
  const pb=document.getElementById('pbar'); if(pb)pb.style.width=(answered/s.items.length*100)+'%';
  refreshQCard(i);
  qdashBadge();
  persistSession();
}
/* ---------- per-question timing (สัญญาณ "ไม่มั่นใจ" แบบไม่รบกวนผู้ใช้) ----------
   หน้าทำข้อสอบเป็น list เลื่อนยาว ไม่ใช่ทีละข้อ จึงวัดเวลาแบบ "ช่วงห่างระหว่างการตอบ"
   = เวลาที่ตอบข้อนี้ ลบเวลาที่ตอบข้อก่อนหน้า (หรือเวลาเปิดชุด ถ้าเป็นข้อแรก)
   ตัดค่าที่เกิน AWAY_CAP ทิ้ง เพราะแปลว่าลุกไปทำอย่างอื่น ไม่ใช่ว่าคิดนาน           */
const AWAY_CAP = 300;                       // วินาที — เกินนี้ถือว่าไม่ได้อยู่หน้าจอ
function recordTime(s,i){
  if(!s.times) s.times={};
  const now=Date.now();
  const prev=s.__lastAnsAt||s.__startedAt||now;
  s.__lastAnsAt=now;
  if(s.times[i]!==undefined) return;         // เก็บครั้งแรกที่ตอบเท่านั้น
  const sec=Math.round((now-prev)/1000);
  s.times[i] = (sec>=0 && sec<=AWAY_CAP) ? sec : null;   // null = ใช้เป็นสัญญาณไม่ได้
}
/* median เวลาต่อข้อของผู้ใช้เอง (rolling 200 ค่าล่าสุด) — เทียบกับตัวเอง ไม่ใช่ค่าคงที่
   เพราะความเร็วอ่านโจทย์ของแต่ละคนต่างกันมาก                                        */
function paceStats(){ return LS.get('pace',{samples:[]}); }
function pushPace(times){
  const p=paceStats();
  const add=Object.values(times||{}).filter(v=>typeof v==='number'&&v>2);  // <2 วิ = กดรัว ไม่นับ
  p.samples=[...add,...(p.samples||[])].slice(0,200);
  LS.set('pace',p);
}
function paceMedian(){
  const arr=(paceStats().samples||[]).slice().sort((a,b)=>a-b);
  if(arr.length<20) return null;             // ตัวอย่างน้อยเกินไป → ยังไม่ใช้สัญญาณเวลา
  return arr[Math.floor(arr.length/2)];
}
function answerLog(s){ return s.items.map((q,i)=>({k:q.key,t:q.topic,c:s.answers[i]===q.ans,a:s.answers[i]!==undefined})); }
async function submitExam(){ const s=state.session; if(s.submitted)return; s.submitted=true; clearInterval(timerInt);
  let score=0; s.items.forEach((q,i)=>{if(s.answers[i]===q.ans)score++;}); s.score=score;
  updateSRS(s); if(s.quizId==='daily')markDailyDone(); clearResume();
  await saveAttempt({quiz_id:s.quizId,quiz_title:s.quizTitle,score,total:s.items.length,answers:answerLog(s)});
  go('result'); }
async function finishPractice(){ const s=state.session; if(s.submitted)return; s.submitted=true; let score=0; s.items.forEach((q,i)=>{if(s.answers[i]===q.ans)score++;}); s.score=score;
  updateSRS(s); if(s.quizId==='daily')markDailyDone(); clearResume();
  await saveAttempt({quiz_id:s.quizId,quiz_title:s.quizTitle,score,total:s.items.length,answers:answerLog(s)});
  go('result'); }

/* ================= Mistakes / Weakness / NL2 Simulator ================= */
/* OFFICIAL NL2 blueprint (แพทยสภา, เริ่มใช้ ก.ค. 2567): 300 ข้อ = หมวด1 30 + หมวด2 270 (ฉุกเฉิน 50 + ระบบ 220) */
const NL2_TOTAL = 300, NL2_GENERAL = 30, NL2_EMERGENCY = 50;
const NL2_SYS = [
  {id:'I',   n:16, label:'I. Infectious & parasitic diseases'},
  {id:'II',  n:7,  label:'II. Neoplasms'},
  {id:'III', n:12, label:'III. Blood, blood-forming organs & immune'},
  {id:'IV',  n:14, label:'IV. Endocrine, nutritional & metabolic'},
  {id:'V',   n:12, label:'V. Mental & behavioral disorders'},
  {id:'VI',  n:14, label:'VI. Nervous system'},
  {id:'VII', n:7,  label:'VII. Eye & adnexa'},
  {id:'VIII',n:7,  label:'VIII. Ear & mastoid'},
  {id:'IX',  n:14, label:'IX. Circulatory system'},
  {id:'X',   n:14, label:'X. Respiratory system'},
  {id:'XI',  n:14, label:'XI. Digestive system'},
  {id:'XII', n:7,  label:'XII. Skin & subcutaneous tissue'},
  {id:'XIII',n:14, label:'XIII. Musculoskeletal & connective tissue'},
  {id:'XIV', n:15, label:'XIV. Genito-urinary system'},
  {id:'XV',  n:18, label:'XV. Pregnancy, childbirth & puerperium'},
  {id:'XVI', n:8,  label:'XVI. Perinatal conditions'},
  {id:'XVII',n:5,  label:'XVII. Congenital & chromosomal'},
  {id:'XVIII',n:12,label:'XVIII. Injury, poisoning & external causes'},
  {id:'XIX', n:10, label:'XIX. External causes of morbidity/mortality'},
];
/* map a question topic to an official blueprint bucket id (or 'flex' for cross-system tags) */
function classifyICD(t){ t=(t||'').toLowerCase();
  if(t.includes('forensic')||t.includes('ethic')||t.includes('community')||t.includes('ebm')||t.includes('family med')) return 'general';
  if(t.includes('emergen')||t.includes('resuscitation')) return 'emergency';
  if(t.includes('obstet')||t.includes('pregnan')||t.includes('childbirth')||t.includes('puerper')||t.includes('labor')||t.includes('antenatal')) return 'XV';
  if(t.includes('perinat')||t.includes('neonat')||t.includes('newborn')) return 'XVI';
  if(t.includes('congenital')||t.includes('chromosom')||t.includes('genetic')||t.includes('syndrome')) return 'XVII';
  if(t.includes('neoplasm')||t.includes('cancer')||t.includes('tumor')||t.includes('oncolog')||t.includes('leukemia')||t.includes('lymphoma')||t.includes('sarcoma')||t.includes('blastoma')) return 'II';
  if(t.includes('infect')||t.includes('parasit')||t.includes('dengue')||t.includes('malaria')||t.includes('tubercul')||t.includes('hiv')||t.includes('sepsis')) return 'I';
  if(t.includes('hematolog')||t.includes('blood')||t.includes('anemia')||t.includes('thalassemia')||t.includes('immun')||t.includes('bleeding')||t.includes('coagul')) return 'III';
  if(t.includes('endocrin')||t.includes('metabol')||t.includes('nutrition')||t.includes('diabet')||t.includes('thyroid')||t.includes('adrenal')||t.includes('growth')) return 'IV';
  if(t.includes('psychiat')||t.includes('mental')||t.includes('behav')||t.includes('adolescent')||t.includes('depress')) return 'V';
  if(t.includes('neurolog')||t.includes('nervous')||t.includes('seizure')||t.includes('stroke')||t.includes('epilep')||t.includes('meningitis')||t.includes('cerebral')) return 'VI';
  if(t.includes('ophthal')||t.includes('eye')||t.includes('retina')||t.includes('conjunctiv')) return 'VII';
  if(t.includes('otolaryng')||t==='ent'||t.includes('ear')||t.includes('mastoid')||t.includes('otitis')||t.includes('sinus')||t.includes('epistaxis')) return 'VIII';
  if(t.includes('cardio')||t.includes('circulat')||t.includes('vascular')||t.includes('heart')||t.includes('hypertens')||t.includes('arrhythm')) return 'IX';
  if(t.includes('respir')||t.includes('pulmon')||t.includes('lung')||t.includes('asthma')||t.includes('pneumonia')||t.includes('bronchi')||t.includes('croup')) return 'X';
  if(t.includes('gi/')||t.includes('digest')||t.includes('hepatolog')||t.includes('gastro')||t.includes('liver')||t.includes('bowel')||t.includes('append')||t.includes('hepat')) return 'XI';
  if(t.includes('derm')||t.includes('skin')) return 'XII';
  if(t.includes('orthop')||t.includes('musculoskelet')||t.includes('rheumat')||t.includes('connective')||t.includes('bone')||t.includes('joint')||t.includes('fracture')||t.includes('arthritis')) return 'XIII';
  if(t.includes('gyneco')||t.includes('nephrolog')||t.includes('urolog')||t.includes('genito')||t.includes('renal')||t.includes('kidney')||t.includes('bladder')||t.includes('nephro')) return 'XIV';
  if(t.includes('injury')||t.includes('poison')||t.includes('trauma')||t.includes('burn')||t.includes('toxic')||t.includes('bite')||t.includes('drowning')) return 'XVIII';
  if(t.includes('external cause')) return 'XIX';
  return 'flex';   // e.g. "Internal medicine", "Pediatrics", "Surgery", "Medicine" — cross-system tags
}

async function analytics(){
  const at = await listAttempts();
  const idx = QIDX();
  const latest={}, topic={}, sys={};
  at.forEach(a=>{ (a.answers||[]).forEach(e=>{
    if(!e || !e.k) return;                       // skip old-format entries
    if(!(e.k in latest)) latest[e.k]={c:!!e.c, t:e.t};   // attempts are newest-first
    if(e.a){                                     // count accuracy over answered only
      const tp=e.t||'อื่นๆ'; (topic[tp]=topic[tp]||{n:0,ok:0}); topic[tp].n++; if(e.c)topic[tp].ok++;
      // bucket by ICD chapter — same taxonomy as Practice by Organ System, so
      // every weakness row maps 1:1 onto a practice set the user can jump into
      const rec=idx[e.k];
      const b = rec ? (rec.q.sys||classifyICD(rec.topic)) : classifyICD(e.t);
      (sys[b]=sys[b]||{n:0,ok:0}); sys[b].n++; if(e.c)sys[b].ok++;
    }
  }); });
  return {latest, topic, sys};
}

async function startMistakes(){
  if(!requireLogin()) return;
  await needAllSets();
  showLoader('กำลังจัดคิวทบทวน (SRS)...');
  const idx=QIDX();
  const arr=await srsQueueKeys();                 /* ใช้ตัวเดียวกับที่หน้า Smart Review นับให้ ตัวเลขจะได้ตรงกันเสมอ */
  const qs=arr.map(k=>idx[k].q);
  hideLoader();
  if(!qs.length){ alert('ไม่มีข้อค้างทบทวนตอนนี้ 🎉\nทำข้อสอบเพิ่ม แล้วข้อที่พลาด/ถึงกำหนดจะถูกจัดคิวมาทบทวนแบบ spaced repetition'); return; }
  window.__mistakes={id:'mistakes',title:'Smart Review — SRS ('+qs.length+' ข้อ)',subject:'past',questions:qs};
  go('config',{quiz:'mistakes'});
}

function bar(pct,color){ return `<div style="background:var(--line);border-radius:var(--r-full);height:10px;overflow:hidden;flex:1"><div style="width:${pct}%;height:100%;background:${color}"></div></div>`; }
function accColor(p){ return p>=70?'var(--ok)':p>=50?'var(--warn)':'var(--no)'; }

async function renderWeakness(app){
  app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card"><b>กำลังวิเคราะห์จุดอ่อน...</b></div></div>`;
  const {sys,topic}=await analytics();
  const sysArr=Object.entries(sys).map(([k,v])=>({k,...v,p:Math.round(100*v.ok/v.n)})).sort((a,b)=>a.p-b.p);
  const weakTopics=Object.entries(topic).map(([k,v])=>({k,...v,p:Math.round(100*v.ok/v.n)})).filter(x=>x.n>=3).sort((a,b)=>a.p-b.p).slice(0,15);
  if(!sysArr.length){
    app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card">
      <h2 class="qtitle">My Weakness</h2>
      <div class="muted" style="margin-top:8px">ยังไม่มีข้อมูลพอ — ทำข้อสอบสักชุดก่อน แล้วระบบจะสรุป % ความแม่นแยกตามระบบและหัวข้อให้อัตโนมัติ</div>
      <div class="row" style="margin-top:16px"><button class="btn sec" onclick="go('home')">หน้าแรก</button></div></div></div>`; return;
  }
  const sysRows=sysArr.map(x=>`<div style="margin:10px 0">
      <div class="row" style="gap:10px;align-items:center"><b style="min-width:190px">${esc(icdLabel(x.k))}</b>
      ${bar(x.p,accColor(x.p))}<span style="min-width:96px;text-align:right;color:${accColor(x.p)};font-weight:700">${x.p}% <span class="muted" style="font-weight:400">(${x.ok}/${x.n})</span></span>
      <button class="btn sm" onclick="startSystemPractice('${x.k}')">ฝึกหมวดนี้</button></div></div>`).join('');
  const topicRows=weakTopics.length? weakTopics.map(x=>`<div style="margin:8px 0">
      <div class="row" style="gap:10px;align-items:center"><span style="min-width:190px">${esc(x.k)}</span>
      ${bar(x.p,accColor(x.p))}<span style="min-width:96px;text-align:right;color:${accColor(x.p)};font-weight:700">${x.p}% <span class="muted" style="font-weight:400">(${x.ok}/${x.n})</span></span>
      <button class="btn sm" onclick="startTopicPractice(${JSON.stringify(x.k).replace(/"/g,'&quot;')})">ฝึกหัวข้อนี้</button></div></div>`).join('')
    : '<div class="muted">ยังมีข้อมูลไม่พอต่อหัวข้อ (ต้องทำอย่างน้อย 3 ข้อต่อหัวข้อ)</div>';
  app.innerHTML=`<div class="wrap" style="padding-top:24px">
    <div class="card">
      <h2 class="qtitle">My Weakness — ความแม่นแยกตามระบบ</h2>
      <div class="muted">เรียงจากอ่อนสุดก่อน • คำนวณจากทุกครั้งที่ทำข้อสอบ</div>
      <div style="margin-top:14px">${sysRows}</div>
      <div class="row" style="margin-top:8px"><button class="btn" onclick="startMistakes()">ทบทวนข้อที่เคยผิด</button></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2 class="qtitle">หัวข้อที่ควรทบทวนที่สุด</h2>
      <div class="muted">15 หัวข้อที่ % ต่ำสุด (นับเฉพาะหัวข้อที่ทำ ≥ 3 ข้อ)</div>
      <div style="margin-top:12px">${topicRows}</div>
    </div>
    <div class="row" style="margin-top:16px"><button class="btn sec" onclick="go('home')">หน้าแรก</button>
      <button class="btn sec" onclick="go('weakness')">รีเฟรช</button></div>
  </div>`;
}

function simTime(n){ const m=Math.round(n*1.5); const h=Math.floor(m/60), mm=m%60; return (h?h+' ชม. ':'')+(mm?mm+' นาที':''); }
function renderSimConfig(app){
  const rows=[`<tr><td>หมวด 1 — ภาวะปกติ/หลักการดูแลทั่วไป (health promotion, ระบาดวิทยา, นิติเวช, จริยธรรม/กฎหมาย)</td><td style="text-align:right">${NL2_GENERAL}</td></tr>`,
    `<tr><td>ภาวะฉุกเฉิน (Emergency — กลุ่มที่ 1)</td><td style="text-align:right">${NL2_EMERGENCY}</td></tr>`]
    .concat(NL2_SYS.map(s=>`<tr><td>${esc(s.label)}</td><td style="text-align:right">${s.n}</td></tr>`)).join('');
  app.innerHTML=`<div class="wrap" style="padding-top:26px">
    <div class="card">
      <h2 class="qtitle">NL2 Simulator</h2>
      <div class="muted">จำลองสนามสอบจริง — จับเวลา, ไม่เฉลยจนกว่าจะส่ง, สุ่มตาม <b>blueprint อย่างเป็นทางการของแพทยสภา (เริ่มใช้ ก.ค. 2567)</b> โดยดึงจาก<b>ข้อสอบ NL2 เก่าเท่านั้น</b></div>
      <label class="fld">จำนวนข้อ (เวลา = 1.5 นาที/ข้อ)</label>
      <select id="simSize">
        <option value="300" selected>เต็มรูปแบบ 300 ข้อ • ~${simTime(300)} (เท่าข้อสอบจริง)</option>
        <option value="150">ครึ่งชุด 150 ข้อ • ~${simTime(150)}</option>
        <option value="100">100 ข้อ • ~${simTime(100)}</option>
        <option value="50">mini mock 50 ข้อ • ~${simTime(50)}</option>
      </select>
      <div class="tablewrap" style="margin-top:14px"><table>
        <tr><th>หมวด / ระบบอวัยวะ (ICD)</th><th style="text-align:right">ข้อ (เต็ม 300)</th></tr>
        ${rows}
        <tr style="font-weight:700;background:var(--okbg)"><td>รวม</td><td style="text-align:right">${NL2_TOTAL}</td></tr>
      </table></div>
      <div class="warn" style="margin-top:12px"><span class="muted">อ้างอิงตาม "ตารางข้อสอบฯ ขั้นตอนที่ 2" ของแพทยสภา: 300 ข้อ (One Best Response) = หมวด1 30 + หมวด2 270 (ฉุกเฉิน 50 + โรคตามระบบ 220). ระบบจะดึงข้อจากคลัง NL2 เก่าให้ตรงตามโควตาแต่ละระบบเท่าที่มี แล้วเติมส่วนที่เหลือจากข้อที่ tag เป็น Med/Ped/Surgery (คร่อมหลายระบบ). เวลา 1.5 นาที/ข้อเป็นค่าประมาณ</span></div>
      <div class="row" style="margin-top:18px">
        <button class="btn" onclick="startSimulator()">▶ เริ่มจำลองสอบ</button>
        <button class="btn sec" onclick="go('home')">ย้อนกลับ</button>
      </div>
    </div></div>`;
}

async function startSimulator(){
  await needAllSets();
  if(!requireLogin()) return;
  const size=parseInt(val('simSize'))||NL2_TOTAL;
  const scale=size/NL2_TOTAL;
  const g={general:[],emergency:[],flex:[]}; NL2_SYS.forEach(s=>g[s.id]=[]);
  let pool=0;
  window.QUIZ_DATA.forEach(qz=>{ if(quizSubject(qz)==='past'){ qz.questions.forEach(x=>{ const c=x.sys||classifyICD(x.topic); (g[c]||g.flex).push(x); pool++; }); } });
  if(!pool){ alert('ไม่พบคลังข้อสอบ NL2 เก่า'); return; }
  Object.keys(g).forEach(k=>g[k]=shuffle(g[k]));
  const used=new Set(), picks=[];
  function take(arr,n){ let c=0; for(const q of (arr||[])){ if(c>=n)break; if(!used.has(q)){used.add(q);picks.push(q);c++;} } }
  take(g.general, Math.round(NL2_GENERAL*scale));
  take(g.emergency, Math.round(NL2_EMERGENCY*scale));
  NL2_SYS.forEach(s=>take(g[s.id], Math.round(s.n*scale)));
  // fill remainder to reach exact size: first from flex (Med/Ped/Surg), then anything
  const everything=shuffle([].concat(...Object.keys(g).map(k=>g[k])));
  for(const src of [g.flex, everything]){ for(const q of src){ if(picks.length>=size)break; if(!used.has(q)){used.add(q);picks.push(q);} } if(picks.length>=size)break; }
  const final=shuffle(picks).slice(0,size);
  window.__sim={id:'nl2sim',title:'NL2 Simulator ('+final.length+' ข้อ)',subject:'past',questions:final};
  showLoader('กำลังจัดชุดข้อสอบตาม blueprint แพทยสภา...');
  setTimeout(()=>{ state.session=buildSession(window.__sim,{mode:'exam',count:'all',shuffleQ:true,shuffleO:true,timer:true,sim:true,secPerItem:90}); persistSession(); hideLoader(); go('quiz'); if(state.session.timeLeft!=null)startTimer(); },650);
}

/* ---------- Practice by Organ System ---------- */
const SYS_ALL=[{id:'general',label:'หมวด 1 — ภาวะปกติ / ดูแลทั่วไป (Health, Forensic, Ethics, EBM)'},
  {id:'emergency',label:'ภาวะฉุกเฉิน (Emergency)'}].concat(NL2_SYS.map(s=>({id:s.id,label:s.label})));
function qBucket(x){ return x.sys||classifyICD(x.topic); }
function renderSystems(app){
  const c={}; allQuizzes().forEach(qz=>qz.questions.forEach(x=>{ const b=qBucket(x); c[b]=(c[b]||0)+1; }));
  const cards=SYS_ALL.map(s=>{ const n=c[s.id]||0; return `<div class="file-card" style="cursor:${n?'pointer':'default'};opacity:${n?1:.5}" ${n?`onclick="startSystemPractice('${s.id}')"`:''}>
     <div class="tab">${s.id}</div><h3 style="margin-top:20px">${esc(s.label)}</h3>
     <div class="meta">${n} ข้อ</div>
     ${n?`<button class="btn sm" onclick="event.stopPropagation();startSystemPractice('${s.id}')">ฝึกทำ</button>`:'<span class="muted">ยังไม่มีข้อ</span>'}</div>`; }).join('');
  app.innerHTML=`<div class="wrap" style="padding-top:24px">
    <div class="card"><h2 class="qtitle">Practice by Organ System</h2>
      <div class="muted">ฝึกทำแยกตามระบบอวัยวะ (ICD chapter ตาม blueprint แพทยสภา) — รวมทุกคลัง (NL2 เก่า + ชุดที่สร้างใหม่)</div></div>
    <div class="cat-grid">${cards}</div>
    <div class="row" style="margin-top:8px"><button class="btn sec" onclick="go('home')">หน้าแรก</button></div>
  </div>`;
}
async function startSystemPractice(id){
  if(!requireLogin()) return;
  await needAllSets();
  const label=(SYS_ALL.find(s=>s.id===id)||{}).label||id;
  const qs=[]; allQuizzes().forEach(qz=>qz.questions.forEach(x=>{ if(qBucket(x)===id) qs.push(x); }));
  if(!qs.length){ alert('ยังไม่มีข้อในระบบนี้'); return; }
  window.__sys={id:'sysquiz',title:''+label,subject:'past',questions:shuffle(qs)};
  go('config',{quiz:'sysquiz'});
}
/* ฝึกเฉพาะหัวข้อย่อย (เรียกจากหน้า My Weakness) */
async function startTopicPractice(topic){
  if(!requireLogin()) return;
  await needAllSets();
  const qs=[]; allQuizzes().forEach(qz=>qz.questions.forEach(x=>{ if((x.topic||'อื่นๆ')===topic) qs.push(x); }));
  if(!qs.length){ alert('ยังไม่มีข้อในหัวข้อนี้'); return; }
  window.__sys={id:'sysquiz',title:''+topic,subject:'past',questions:shuffle(qs)};
  go('config',{quiz:'sysquiz'});
}

/* ---------- Readiness / Pass prediction ---------- */
const PASS_MARK = 0.60;   // เกณฑ์ผ่านมาตรฐาน ~60% (ศรว. รายงานผล Pass/Fail; ปรับได้)
function icdLabel(id){ if(id==='general')return 'หมวด 1 — ภาวะปกติ/ดูแลทั่วไป'; if(id==='emergency')return 'ภาวะฉุกเฉิน'; if(id==='flex')return 'อื่นๆ / คร่อมระบบ'; const s=NL2_SYS.find(x=>x.id===id); return s?s.label:id; }
async function readinessData(){
  const at=await listAttempts();
  const sims=at.filter(a=>a.quiz_id==='nl2sim');
  const idx=QIDX(); const sys={}; let tOk=0,tN=0;
  const source = sims.length?sims:at;
  source.forEach(a=>(a.answers||[]).forEach(e=>{ if(!e||!e.k||!e.a)return; const rec=idx[e.k];
    const b=rec?(rec.q.sys||classifyICD(rec.topic)):classifyICD(e.t);
    (sys[b]=sys[b]||{n:0,ok:0}); sys[b].n++; tN++; if(e.c){sys[b].ok++; tOk++;} }));
  const latestSim=sims[0]||null;
  const latestSimPct=latestSim?Math.round(100*latestSim.score/latestSim.total):null;
  const bestSimPct=sims.length?Math.round(100*Math.max(...sims.map(a=>a.score/a.total))):null;
  const overallPct=tN?Math.round(100*tOk/tN):null;
  return {sims, usedFallback:(!sims.length&&at.length>0), hasData:!!source.length, sys, latestSimPct, bestSimPct, overallPct};
}
async function renderReadiness(app){
  app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card"><b>กำลังคำนวณความพร้อมสอบ...</b></div></div>`;
  const r=await readinessData(); const pm=Math.round(PASS_MARK*100);
  if(!r.hasData){
    app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card">
      <h2 class="qtitle">Readiness / Pass Prediction</h2>
      <div class="muted" style="margin-top:8px">ยังไม่มีข้อมูล — ลองทำ <b>NL2 Simulator</b> สักรอบ แล้วระบบจะประเมินความพร้อมสอบและชี้ระบบที่ยังไม่ผ่านเกณฑ์ให้</div>
      <div class="row" style="margin-top:16px"><button class="btn" onclick="go('simconfig')">เริ่ม NL2 Simulator</button>
        <button class="btn sec" onclick="go('home')">หน้าแรก</button></div></div></div>`; return;
  }
  const disp = r.sims.length? r.latestSimPct : r.overallPct;
  const arr=Object.entries(r.sys).map(([k,v])=>({k,...v,p:Math.round(100*v.ok/v.n)}));
  const covered=arr.filter(x=>x.n>=3);
  const passed=covered.filter(x=>x.p>=pm);
  const breadth=covered.length?passed.length/covered.length:0;
  const margin=Math.min(1,(disp/100)/PASS_MARK);
  const readiness=Math.round(100*(0.7*margin+0.3*breadth));
  const weak=covered.filter(x=>x.p<pm).sort((a,b)=>a.p-b.p);
  const rc = readiness>=85?'var(--ok)':readiness>=60?'var(--warn)':'var(--no)';
  const verdict = disp>=pm+5?['พร้อมสอบ','var(--ok)'] : disp>=pm-5?['เฉียดเกณฑ์ — ดันอีกนิด','var(--warn)'] : ['ยังต้องเตรียมอีก','var(--no)'];
  const ring=`<div style="position:relative;width:150px;height:150px;flex:none">
    <svg viewBox="0 0 120 120" style="width:150px;height:150px;transform:rotate(-90deg)">
      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="12"/>
      <circle cx="60" cy="60" r="52" fill="none" stroke="${rc}" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${(2*Math.PI*52).toFixed(1)}" stroke-dashoffset="${(2*Math.PI*52*(1-readiness/100)).toFixed(1)}"/>
    </svg>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div style="font-size:38px;font-weight:800;font-family:'Sarabun';color:${rc};line-height:1">${readiness}%</div>
      <div class="muted" style="font-size:12px">ความพร้อม</div></div></div>`;
  const weakRows = weak.length? weak.map(x=>`<div class="row" style="gap:10px;align-items:center;margin:8px 0">
      <span style="min-width:210px">${esc(icdLabel(x.k))}</span>
      ${bar(x.p,accColor(x.p))}<span style="min-width:90px;text-align:right;color:${accColor(x.p)};font-weight:700">${x.p}% <span class="muted" style="font-weight:400">(${x.ok}/${x.n})</span></span>
      <button class="btn sm sec" onclick="startSystemPractice('${x.k}')">ฝึก</button></div>`).join('')
    : '<div class="muted">ทุกระบบที่มีข้อมูลผ่านเกณฑ์แล้ว!</div>';
  app.innerHTML=`<div class="wrap" style="padding-top:24px">
    <div class="card">
      <h2 class="qtitle">Readiness / Pass Prediction</h2>
      <div class="row" style="gap:24px;align-items:center;flex-wrap:wrap;margin-top:8px">
        ${ring}
        <div style="flex:1;min-width:220px">
          <div style="font-size:20px;font-weight:700;color:${verdict[1]}">${verdict[0]}</div>
          <div style="margin-top:8px">${r.sims.length?`คะแนน Simulator ล่าสุด: <b style="color:${accColor(disp)}">${disp}%</b> • ดีสุด ${r.bestSimPct}%`:`ความแม่นรวม (จากทุกแบบฝึก): <b style="color:${accColor(disp)}">${disp}%</b>`}</div>
          <div class="muted" style="margin-top:4px">เกณฑ์ผ่านโดยประมาณ ~${pm}% • ระบบที่ผ่านเกณฑ์ ${passed.length}/${covered.length}</div>
          ${r.usedFallback?'<div class="muted" style="margin-top:6px;color:var(--gold-d)">* ยังไม่มีผล NL2 Simulator — ประเมินจากผลแบบฝึกทั่วไปไปก่อน ทำ Simulator เพื่อความแม่นยำ</div>':''}
          <div class="row" style="margin-top:12px"><button class="btn" onclick="go('simconfig')">ทำ Simulator อีกรอบ</button></div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2 class="qtitle">ระบบที่ยังไม่ผ่านเกณฑ์ (&lt; ${pm}%)</h2>
      <div class="muted">เรียงจากอ่อนสุด • นับเฉพาะระบบที่ทำ ≥ 3 ข้อ • กด "ฝึก" เพื่อเจาะระบบนั้น</div>
      <div style="margin-top:12px">${weakRows}</div>
    </div>
    <div class="card">
      <div class="muted">📌 "ความพร้อม %" = 70% จากคะแนนเทียบเกณฑ์ผ่าน + 30% จากสัดส่วนระบบที่ผ่านเกณฑ์. เกณฑ์ผ่าน ~${pm}% เป็นค่ามาตรฐานที่ใช้กันทั่วไป (ปัจจุบัน ศรว. รายงานผลเป็น Pass/Fail จากการตั้งเกณฑ์มาตรฐาน) — เป็นการประเมินเพื่อฝึกซ้อม ไม่ใช่การรับประกันผลสอบจริง</div>
      <div class="row" style="margin-top:12px"><button class="btn sec" onclick="go('weakness')">ดูจุดอ่อนรายหัวข้อ</button>
        <button class="btn sec" onclick="go('home')">หน้าแรก</button></div>
    </div>
  </div>`;
}

/* ---------- RESULT ---------- */
/* แจ้งจำนวน "ตอบถูกแต่ไม่มั่นใจ" — ข้อพวกนี้ถูกกันไว้ในคิวทบทวน ไม่ปล่อยหลุด */
function shakyHTML(s){
  const med=paceMedian(); const idxs=[];
  (s.items||[]).forEach((it,i)=>{ if(s.answers[i]===undefined)return;
    if(gradeAnswer(s,i,med)==='hard') idxs.push(i); });
  if(!idxs.length) return '';
  return `<div class="pill" style="margin-top:12px;background:var(--goldbg);color:var(--gold-d);display:inline-block">
    ตอบถูกแบบไม่มั่นใจ ${idxs.length} ข้อ — ถูกกันไว้ในคิวทบทวนแล้ว
    <span class="muted" style="font-weight:400">(${idxs.map(i=>i+1).join(', ')})</span></div>`;
}
/* จุดอ่อน 3 อันดับของรอบนี้ จัดกลุ่มตาม topic ของข้อ */
function resultWeakHTML(s){
  const g={};
  s.items.forEach((q,i)=>{ const t=q.topic||'ไม่ระบุหมวด';
    (g[t]=g[t]||{n:0,ok:0}); g[t].n++; if(s.answers[i]===q.ans) g[t].ok++; });
  const rows=Object.entries(g).map(([t,v])=>({t,pct:Math.round(v.ok/v.n*100),n:v.n}))
    .filter(r=>r.n>=2).sort((a,b)=>a.pct-b.pct).slice(0,3);
  if(!rows.length) return '';
  return `<div class="weak"><div class="lbl" style="margin-top:var(--s4)">หมวดที่อ่อนที่สุดในรอบนี้</div>
    ${rows.map(r=>`<div class="r">
      <span class="nm">${esc(r.t)}</span>
      <span class="tk"><i style="width:${r.pct}%;background:${accColor(r.pct)}"></i></span>
      <span class="pc">${r.pct}%</span></div>`).join('')}</div>`;
}
/* สร้างชุดใหม่จากเฉพาะข้อที่เพิ่งตอบผิด แล้วเข้าสู่โหมดฝึกทันที */
function reviewWrongNow(){
  const s=state.session;
  const qs=s.items.filter((q,i)=>s.answers[i]!==q.ans);
  if(!qs.length){ alert('รอบนี้ไม่มีข้อที่ผิด'); return; }
  window.__saved={id:'wrong',title:'ข้อที่ผิดจาก '+(s.quizTitle||'รอบล่าสุด'),subject:'past',questions:qs};
  go('config',{quiz:'saved'});
}
function renderResult(app){
  const s=state.session; const pct=Math.round(s.score/s.items.length*100);
  const backId = s.quizId;
  /* หน้าผลเดิมบอกแค่ "ได้เท่าไร" แล้วต่อด้วยตารางรายข้อ ผู้ใช้ต้องคิดเองว่าจะทำอะไรต่อ
     ตอนนี้เทียบกับเกณฑ์ผ่านให้เห็นทันที ดึงจุดอ่อน 3 อันดับขึ้นมา
     แล้วเปลี่ยนแต่ละอย่างให้เป็นปุ่มที่กดแล้วเริ่มฝึกได้เลย                      */
  const PASS=60, col=pct>=PASS?'var(--ok)':'var(--no)';
  const C=2*Math.PI*58, off=C*(1-pct/100);
  const wrong=s.items.filter((q,i)=>s.answers[i]!==q.ans).length;
  app.innerHTML=`<div class="wrap" style="padding-top:var(--s5)">
   <div class="result-hd">
     <div class="dial">
       <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
         <circle cx="66" cy="66" r="58" fill="none" stroke="var(--sunken)" stroke-width="11"/>
         <circle cx="66" cy="66" r="58" fill="none" stroke="${col}" stroke-width="11"
                 stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
                 transform="rotate(-90 66 66)"/>
       </svg>
       <div class="val"><b>${pct}%</b><span>${s.score} / ${s.items.length} ข้อ</span></div>
     </div>
     <div style="flex:1;min-width:250px">
       <div class="muted" style="font-size:13px">${esc(s.quizTitle)}</div>
       <span class="pass ${pct>=PASS?'':'no'}">${ic(pct>=PASS?'check':'x')}${
         pct>=PASS?`สูงกว่าเกณฑ์ผ่าน ${PASS}%`:`ต่ำกว่าเกณฑ์ผ่าน ${PASS}%`}</span>
       <h3 style="font-size:18px;margin:10px 0 4px">${
         pct>=80?'เยี่ยมมาก รักษาจังหวะนี้ไว้':pct>=PASS?'ผ่านเกณฑ์ — เก็บข้อที่ผิดต่อ':'ทบทวนเฉลยแล้วลองใหม่'}</h3>
       ${resultWeakHTML(s)}
       <div class="row" style="margin-top:var(--s5)">
         ${wrong?`<button class="btn" onclick="reviewWrongNow()">${ic('repeat')}ทบทวน ${wrong} ข้อที่ผิด</button>`:''}
         <button class="btn sec" onclick="go('config',{quiz:'${backId}'})">${ic('play')}ทำชุดนี้ใหม่</button>
         <button class="btn quiet" onclick="go('history')">${ic('chart')}ประวัติ</button>
       </div>
     </div>
   </div>
   ${shakyHTML(s)}
   <div class="sechead" style="margin-top:var(--s6)"><h2>ทบทวนคำตอบรายข้อ</h2></div>
   <div id="review"></div></div>`;
  const rv=document.getElementById('review'); state.session.items.forEach((q,i)=>rv.appendChild(qCard(q,i)));
}

/* ---------- HISTORY ---------- */
async function renderHistory(app){
  app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card"><b>กำลังโหลดประวัติ...</b></div></div>`;
  const at=await listAttempts();
  window.__attempts=at;                       /* เก็บไว้ให้หน้า "ดูรายข้อ" ใช้ต่อโดยไม่ต้องยิงซ้ำ */
  app.innerHTML=`<div class="wrap" style="padding-top:24px">
   <div class="card">
     <h2 class="qtitle">ประวัติการทำข้อสอบ</h2>
     <div class="muted">${CLOUD&&user?esc(displayName())+' • '+esc(user.email):'เก็บในเครื่องนี้ (Guest)'}</div>
     ${at.length===0?'<div class="muted" style="margin-top:12px">ยังไม่มีประวัติ ลองทำข้อสอบสักชุด</div>':`
     <div class="tablewrap" style="margin-top:12px"><table>
       <tr><th>วันที่</th><th>ชุด</th><th>คะแนน</th><th>%</th><th></th></tr>
       ${at.map((a,i)=>`<tr class="hrow" onclick="go('attempt',{attemptIx:${i}})" style="cursor:pointer"><td>${new Date(a.created_at).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'})}</td><td>${esc(a.quiz_title||a.quiz_id)}</td><td>${a.score}/${a.total}</td><td style="color:${a.score/a.total>=.6?'var(--ok)':'var(--bad)'}">${Math.round(a.score/a.total*100)}%</td><td style="color:var(--teal-d);white-space:nowrap">ดูรายข้อ →</td></tr>`).join('')}
     </table></div>
     <div class="muted" style="margin-top:8px;font-size:14px">คลิกแถวเพื่อดูว่าครั้งนั้นข้อไหนผิด พร้อมอ่านเฉลย</div>`}
     <div class="row" style="margin-top:16px"><button class="btn sec" onclick="go('home')">หน้าแรก</button>
     ${!CLOUD&&at.length?`<button class="btn danger" onclick="if(confirm('ลบประวัติในเครื่องนี้?')){localStorage.removeItem('guestAttempts');go('history')}">ล้างประวัติ</button>`:''}</div>
   </div></div>`;
}

/* ---------- 🔍 ดูย้อนหลังรายข้อของการทำข้อสอบครั้งหนึ่ง ----------
   ข้อมูลรายข้อ (answers: [{k,t,c,a}]) ถูกบันทึกอยู่แล้วทุกครั้งที่ส่งคำตอบ
   แต่เดิมหน้าประวัติแสดงแค่คะแนนรวม กดต่อไม่ได้ — ตรงนี้คือการเปิดข้อมูลที่มีอยู่ให้ใช้  */
let __atWrongOnly=true;
function toggleAtFilter(){ __atWrongOnly=!__atWrongOnly; render(); }
function redoAttemptWrong(){
  const a=(window.__attempts||[])[state.attemptIx]; if(!a)return;
  const idx=QIDX();
  const qs=(a.answers||[]).filter(e=>e&&e.k&&!e.c&&idx[e.k]).map(e=>idx[e.k].q);
  if(!qs.length){ alert('ครั้งนั้นไม่มีข้อที่ผิด 🎉'); return; }
  window.__mistakes={id:'mistakes',title:'แก้ตัว: '+(a.quiz_title||a.quiz_id)+' ('+qs.length+' ข้อ)',subject:'past',questions:qs};
  go('config',{quiz:'mistakes'});
}
async function renderAttempt(app){
  app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card"><b>กำลังโหลด...</b></div></div>`;
  let list=window.__attempts;
  if(!list){ list=await listAttempts(); window.__attempts=list; }
  const a=list[state.attemptIx];
  if(!a){ go('history'); return; }
  const idx=QIDX();
  const rows=(a.answers||[]).filter(e=>e&&e.k);
  const wrong=rows.filter(e=>!e.c), skipped=rows.filter(e=>!e.a);
  const show=__atWrongOnly?wrong:rows;
  const pct=Math.round(a.score/a.total*100);
  const cards=show.map((e,n)=>{
    const rec=idx[e.k];
    if(!rec) return `<div class="card"><div class="muted">ข้อนี้ถูกถอดออกจากคลังแล้ว (${e.t?esc(e.t):'ไม่ทราบหัวข้อ'})</div></div>`;
    const q=rec.q, ansTxt=(q.choices||[])[q.ans]||'';
    return `<div class="card">
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center">
        <span class="badge" style="background:${e.c?'var(--okbg)':'var(--badbg)'};color:${e.c?'var(--ok)':'var(--bad)'}">${e.c?ic('check')+' ถูก':(e.a?ic('x')+' ผิด':'— ไม่ได้ตอบ')}</span>
        <span class="tag">${esc(rec.quizTitle||'')}</span>
        ${q.topic?`<span class="tag teal">${esc(q.topic)}</span>`:''}</div>
      <div style="font-weight:500;line-height:1.55">${esc(q.q)}</div>
      ${q.img?`<img class="qimg" style="margin-top:10px" src="${esc(q.img)}" alt="รูปประกอบข้อสอบ" loading="lazy" onerror="imgFail(this)">`:''}
      <div style="margin-top:7px;color:var(--ok);font-size:15px"><b>เฉลย ${LAB[q.ans]}.</b> ${esc(ansTxt)}</div>
      <div class="exp">${renderExp(q.exp)}</div>
    </div>`; }).join('');
  app.innerHTML=`<div class="wrap" style="padding-top:22px">
   <div class="card">
     <div class="row" style="align-items:center;flex-wrap:wrap;gap:10px">
       <div style="flex:1;min-width:200px">
         <b class="qtitle" style="font-size:19px">${esc(a.quiz_title||a.quiz_id)}</b>
         <div class="muted" style="font-size:14px">${new Date(a.created_at).toLocaleString('th-TH',{dateStyle:'long',timeStyle:'short'})}</div>
       </div>
       <div style="text-align:right"><div style="font-size:26px;font-weight:800;color:${pct>=60?'var(--ok)':'var(--bad)'};line-height:1.1">${a.score}/${a.total}</div>
         <div class="muted" style="font-size:13px">${pct}%</div></div>
     </div>
     <div class="srs-mini">
       <div class="m"><b style="color:var(--ok)">${rows.filter(e=>e.c).length}</b><span>ตอบถูก</span></div>
       <div class="m"><b style="color:var(--bad)">${wrong.filter(e=>e.a).length}</b><span>ตอบผิด</span></div>
       <div class="m"><b>${skipped.length}</b><span>ไม่ได้ตอบ</span></div>
     </div>
     <div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">
       ${wrong.length?`<button class="btn sm" onclick="redoAttemptWrong()">ทำข้อที่พลาดซ้ำ (${wrong.length})</button>`:''}
       <button class="btn sm sec" onclick="toggleAtFilter()">${__atWrongOnly?'แสดงทุกข้อ':'แสดงเฉพาะที่พลาด'}</button>
       <button class="btn sm sec" onclick="go('history')">↩ กลับประวัติ</button>
     </div>
   </div>
   ${rows.length?(show.length?cards:'<div class="card"><div class="muted">ครั้งนี้ตอบถูกหมด 🎉 กด "แสดงทุกข้อ" เพื่อทบทวนทั้งชุด</div></div>')
     :'<div class="card"><div class="muted">ครั้งนี้บันทึกไว้ก่อนระบบเก็บข้อมูลรายข้อ จึงดูย้อนหลังไม่ได้</div></div>'}
  </div>`;
  window.scrollTo({top:0,behavior:'auto'});
}

/* ---------- LEADERBOARD ---------- */
async function renderLeaderboard(app){
  app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card"><b>กำลังโหลด Leaderboard...</b></div></div>`;
  if(!CLOUD){
    app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card">
      <h2 class="qtitle">Leaderboard</h2>
      <div class="muted" style="margin-top:8px">ต้องตั้งค่าระบบล็อกอิน (Supabase) ก่อนจึงจะมีอันดับของทุกคนได้</div>
      <div class="row" style="margin-top:16px"><button class="btn sec" onclick="go('home')">หน้าแรก</button></div>
    </div></div>`; return;
  }
  const {data,error}=await supa.rpc('leaderboard');
  if(error){
    app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card">
      <h2 class="qtitle">Leaderboard</h2>
      <div class="err" style="margin-top:8px">โหลดอันดับไม่สำเร็จ: ${esc(error.message)}</div>
      <div class="muted" style="margin-top:8px">ยังไม่ได้สร้างฟังก์ชัน leaderboard ในฐานข้อมูล? รัน SQL ใน supabase_schema.sql อีกครั้ง</div>
      <div class="row" style="margin-top:16px"><button class="btn sec" onclick="go('home')">หน้าแรก</button></div>
    </div></div>`; return;
  }
  const rows=(data||[]).filter(r=>+r.total_questions>0);
  const MIN_Q=20; // ต้องทำอย่างน้อย 20 ข้อจึงจะติดอันดับ "แม่นยำ" (กันคนทำข้อเดียวได้ 100%)
  const byAcc=rows.filter(r=>+r.total_questions>=MIN_Q)
                  .sort((a,b)=>b.accuracy-a.accuracy || b.total_questions-a.total_questions).slice(0,20);
  const byVol=rows.slice().sort((a,b)=>b.total_questions-a.total_questions || b.accuracy-a.accuracy).slice(0,20);
  const uid=user&&user.id;
  const medal=i=>['🥇','🥈','🥉'][i]||('<b class="muted">'+(i+1)+'</b>');
  const nm=r=>esc(r.name||'ผู้ใช้')+(r.user_id===uid?' <span class="pill" style="font-size:11px">คุณ</span>':'');
  const accTable = byAcc.length? `<div class="tablewrap"><table>
      <tr><th style="width:64px">อันดับ</th><th>ผู้เล่น</th><th>ความแม่นยำ</th><th>ทำไปแล้ว</th></tr>
      ${byAcc.map((r,i)=>`<tr${r.user_id===uid?' style="background:var(--okbg)"':''}><td>${medal(i)}</td><td>${nm(r)}</td>
        <td style="color:${r.accuracy>=60?'var(--ok)':'var(--bad)'};font-weight:700">${(+r.accuracy).toFixed(1)}%</td>
        <td class="muted">${r.total_questions} ข้อ</td></tr>`).join('')}
    </table></div>` : `<div class="muted" style="margin-top:8px">ยังไม่มีใครทำครบ ${MIN_Q} ข้อ</div>`;
  const volTable = byVol.length? `<div class="tablewrap"><table>
      <tr><th style="width:64px">อันดับ</th><th>ผู้เล่น</th><th>จำนวนข้อ</th><th>ความแม่นยำ</th></tr>
      ${byVol.map((r,i)=>`<tr${r.user_id===uid?' style="background:var(--okbg)"':''}><td>${medal(i)}</td><td>${nm(r)}</td>
        <td style="font-weight:700">${r.total_questions} ข้อ</td>
        <td class="muted">${(+r.accuracy).toFixed(1)}%</td></tr>`).join('')}
    </table></div>` : `<div class="muted" style="margin-top:8px">ยังไม่มีข้อมูล</div>`;
  app.innerHTML=`<div class="wrap" style="padding-top:24px">
    <div class="card">
      <h2 class="qtitle">อันดับความแม่นยำสูงสุด</h2>
      <div class="muted">เรียงตาม % การตอบถูก (นับเฉพาะคนที่ทำครบ ${MIN_Q} ข้อขึ้นไป)</div>
      ${accTable}
    </div>
    <div class="card" style="margin-top:16px">
      <h2 class="qtitle">อันดับทำข้อสอบมากสุด</h2>
      <div class="muted">เรียงตามจำนวนข้อที่ทำทั้งหมด</div>
      ${volTable}
    </div>
    <div class="row" style="margin-top:16px"><button class="btn sec" onclick="go('home')">หน้าแรก</button>
      <button class="btn sec" onclick="go('leaderboard')">รีเฟรช</button></div>
  </div>`;
}

/* ---------- combined + upload ---------- */
async function startCombined(){
  await needAllSets();
  const all=[]; window.QUIZ_DATA.forEach(q=>q.questions.forEach(x=>all.push(x)));
  window.__combined={id:'combined',title:'สุ่มรวมทุกชุด',questions:all};
  go('config',{quiz:'combined'});
}
function handleUpload(ev){
  const f=ev.target.files[0]; if(!f)return; const rd=new FileReader();
  rd.onload=()=>{ try{ let quiz;
    if(f.name.toLowerCase().endsWith('.json')){ const j=JSON.parse(rd.result); const questions=Array.isArray(j)?j:j.questions;
      quiz={id:'custom-'+Date.now(),title:(j.title||f.name.replace(/\.json$/i,'')),custom:true,subject:(j.subject||curSubject()),questions:questions.map(normQ)}; }
    else { quiz={id:'custom-'+Date.now(),title:f.name.replace(/\.csv$/i,''),custom:true,subject:curSubject(),questions:parseCSV(rd.result)}; }
    quiz.questions=quiz.questions.filter(Boolean);
    if(!quiz.questions.length){alert('ไม่พบข้อสอบในไฟล์ (ดูรูปแบบใน README)');return;}
    const cs=customQuizzes(); cs.push(quiz); LS.set('customQuizzes',cs);
    alert('อัปโหลดสำเร็จ: '+quiz.title+' ('+quiz.questions.length+' ข้อ)'); go(state.view==='subject'?'subject':'home',state.view==='subject'?{subject:quiz.subject}:{});
  }catch(e){ alert('อ่านไฟล์ไม่สำเร็จ: '+e.message); } };
  rd.readAsText(f);
}
function normQ(o){ const choices=o.choices||[o.A,o.B,o.C,o.D,o.E].filter(x=>x!=null);
  let ans=o.ans; if(typeof ans==='string')ans=LAB.indexOf(ans.trim().toUpperCase());
  if(ans==null&&o.answer!=null){ans=typeof o.answer==='number'?o.answer:LAB.indexOf(String(o.answer).trim().toUpperCase());}
  if(choices.length<2||ans==null||ans<0)return null;
  return {id:'u'+Math.random().toString(36).slice(2),topic:o.topic||'Custom',q:o.q||o.question,img:o.img||o.image||null,choices,ans,exp:o.exp||o.explanation||''}; }
function parseCSV(txt){ const rows=csvRows(txt); if(!rows.length)return[]; const head=rows[0].map(h=>h.trim().toLowerCase()); const idx=n=>head.indexOf(n);
  return rows.slice(1).map(r=>{ const get=n=>{const i=idx(n);return i>=0?r[i]:''};
    const choices=[get('a'),get('b'),get('c'),get('d'),get('e')].filter(x=>x!=='');
    let ans=get('answer')||get('ans'); ans=isNaN(+ans)?LAB.indexOf(String(ans).trim().toUpperCase()):+ans;
    if(choices.length<2||ans<0)return null;
    return {id:'u'+Math.random().toString(36).slice(2),topic:get('topic')||'Custom',q:get('question')||get('q'),choices,ans,exp:get('explanation')||get('exp')}; }).filter(Boolean); }
function csvRows(txt){ const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<txt.length;i++){const c=txt[i];
    if(q){ if(c==='"'){ if(txt[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else { if(c==='"')q=true; else if(c===','){row.push(cur);cur='';} else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur='';} else if(c==='\r'){} else cur+=c; } }
  if(cur!==''||row.length){row.push(cur);rows.push(row);} return rows.filter(r=>r.some(x=>x.trim()!=='')); }
function delCustom(id){ if(!confirm('ลบชุดข้อสอบนี้?'))return; LS.set('customQuizzes',customQuizzes().filter(q=>q.id!==id)); go('home'); }
function reportError(){
  const url=(CFG.REPORT_FORM_URL||'https://forms.gle/rACHgDRm2dFctm847').trim();  // Google Form (override ได้ผ่าน config.js)
  if(url){ window.open(url,'_blank','noopener'); return; }
  alert('ยังไม่ได้ตั้งลิงก์ฟอร์มรายงานข้อผิดพลาด');
}

/* ---------- boot ---------- */
/* เมนูแฮมเบอร์เกอร์ถูกถอดออกแล้ว (แถบล่างบนมือถือทำหน้าที่นี้แทน)
   คงฟังก์ชันไว้เป็นตัวเปล่าเผื่อมีปุ่มเก่าที่ยังเรียกอยู่ จะได้ไม่ error */
function toggleNav(){}
/* ดรอปดาวน์บัญชี/เพิ่มเติมที่มุมขวาบน */
function toggleMore(e){ e.stopPropagation();
  const m=document.getElementById('moreMenu'); if(m)m.classList.toggle('open'); }
document.addEventListener('click',e=>{
  const m=document.getElementById('moreMenu');
  if(m && m.classList.contains('open') && !m.contains(e.target)) m.classList.remove('open');
});
/* ปิดเมนูทุกครั้งที่เปลี่ยนหน้า ไม่ให้ค้างเปิดทับเนื้อหา */
function closeMenus(){
  document.querySelector('.nav')?.classList.remove('open');
  document.getElementById('moreMenu')?.classList.remove('open');
}
(function(){ const n=document.querySelector('.nav'); if(n)n.addEventListener('click',e=>{ if(e.target.closest('button')||e.target.closest('.pill'))n.classList.remove('open'); }); })();

/* ---------- daily goal + streak ---------- */
function dKey(d){ const x=new Date(d); return x.getFullYear()+'-'+(x.getMonth()+1)+'-'+x.getDate(); }
function dailyGoal(){ return LS.get('dailyGoal',30); }
function setGoal(){ const g=prompt('ตั้งเป้าจำนวนข้อต่อวัน (ข้อ)',dailyGoal()); if(g!==null&&!isNaN(g)&&+g>0){ LS.set('dailyGoal',Math.round(+g)); render(); } }
function computeStreak(at){ const days=new Set((at||[]).map(a=>dKey(a.created_at))); let s=0,d=new Date(); if(!days.has(dKey(d)))d.setDate(d.getDate()-1); while(days.has(dKey(d))){ s++; d.setDate(d.getDate()-1); } return s; }
function todayCount(at){ const tk=dKey(new Date()); return (at||[]).filter(a=>dKey(a.created_at)===tk).reduce((s,a)=>s+a.total,0); }
function streakGoalHTML(at){
  const st=computeStreak(at), done=todayCount(at), goal=dailyGoal(), pct=Math.min(100,Math.round(done/goal*100));
  return `<div class="wrap" style="padding-top:16px"><div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <div class="cardico">${ic('fire')}</div>
    <div><div style="font-size:22px;font-weight:800;color:var(--navy);line-height:1.1">${st} วัน</div><div class="muted" style="font-size:13px">streak ต่อเนื่อง</div></div>
    <div style="flex:1;min-width:180px">
      <div class="row" style="justify-content:space-between"><span class="muted">เป้าวันนี้</span><span style="font-weight:700;color:var(--navy)">${done}/${goal} ข้อ${done>=goal?' '+ic('check'):''}</span></div>
      <div class="progressbar" style="margin-top:6px"><div style="width:${pct}%"></div></div>
    </div>
    <button class="btn sec" style="padding:6px 14px" onclick="setGoal()">ตั้งเป้า</button>
  </div></div>`;
}

/* ---------- exam countdown + ข้อสอบประจำวัน + รายงานข้อผิด ---------- */
const EXAM_DATE = new Date('2027-05-02T00:00:00');
const EXAM_LABEL = 'NL ขั้นที่ 2 (ศรว.)';
/* วันสอบแก้เองได้ (เก็บใน localStorage) — ถ้ายังไม่เคยตั้ง ใช้ค่าเริ่มต้นด้านบน */
function examDate(){ const s=LS.get('examDate',''); if(!s) return EXAM_DATE;
  const d=new Date(s+'T00:00:00'); return isNaN(d.getTime())?EXAM_DATE:d; }
function setExamDate(){
  const c=examDate();
  const def=c.getFullYear()+'-'+String(c.getMonth()+1).padStart(2,'0')+'-'+String(c.getDate()).padStart(2,'0');
  const v=prompt('วันสอบ (รูปแบบ YYYY-MM-DD)',def); if(v===null)return;
  const d=new Date(String(v).trim()+'T00:00:00');
  if(isNaN(d.getTime())){ alert('รูปแบบวันที่ไม่ถูกต้อง เช่น 2027-05-02'); return; }
  LS.set('examDate',String(v).trim()); render();
}
/* กันช่วงท้ายไว้ทบทวนอย่างเดียว ไม่เอาข้อใหม่ — ค่าเริ่มต้น 14 วัน */
function planBuffer(){ const n=LS.get('planBuffer',14); return (typeof n==='number'&&n>=0)?n:14; }
function setBuffer(){ const v=prompt('กันช่วงท้ายก่อนสอบไว้ทบทวนกี่วัน? (ช่วงนี้จะไม่นับว่าต้องทำข้อใหม่)',planBuffer());
  if(v===null||isNaN(v)||+v<0)return; LS.set('planBuffer',Math.round(+v)); render(); }
function applyPlanGoal(n){ LS.set('dailyGoal',Math.max(1,Math.round(n))); render(); }
function thDate(d){ try{ return d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}); }
  catch(e){ return d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear(); } }

/* ---------- แผนอ่านสอบ: นับถอยหลัง + คำนวณเป้าต่อวันจากงานที่เหลือจริง ----------
   เดิมการ์ดนี้บอกแค่ "อีกกี่วัน" ซึ่งไม่ได้บอกว่าต้องทำอะไร
   ตอนนี้ผูกกับจำนวนข้อที่ยังไม่เคยเจอ (จาก srsStats) แล้วคำนวณย้อนกลับเป็นเป้าต่อวัน */
function planOpen(){ return LS.get('planOpen',false)===true; }
function togglePlan(){
  const b=document.getElementById('planBody'), t=document.getElementById('planTgl');
  if(!b)return; const on=(b.style.display==='none');
  b.style.display=on?'':'none'; if(t)t.textContent=on?'▴':'▾';
  LS.set('planOpen',on);
}
function examPlanHTML(at){
  const ex=examDate(), days=Math.ceil((ex-Date.now())/86400000);
  if(days<0) return `<div class="wrap" style="padding-top:16px"><div class="card" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <div class="cardico">${ic('clock')}</div><div style="flex:1;min-width:180px"><b style="color:var(--navy)">เลยวันสอบที่ตั้งไว้แล้ว</b>
    <div class="muted" style="font-size:13px">${EXAM_LABEL} • ${thDate(ex)}</div></div></div></div>`;

  const st=srsStats();
  const buf=planBuffer(), studyDays=Math.max(days-buf,1);
  const fresh=st.fresh;                                  /* ข้อที่ยังไม่เคยเจอเลย */
  const need=fresh?Math.ceil(fresh/studyDays):0;
  const week=(at||[]).filter(a=>Date.now()-new Date(a.created_at).getTime()<7*864e5)
                     .reduce((s,a)=>s+a.total,0);
  const pace=Math.round(week/7*10)/10;                   /* ข้อ/วัน จริงใน 7 วันล่าสุด */
  const finish=pace>0&&fresh?new Date(Date.now()+Math.ceil(fresh/pace)*86400000):null;
  const inBuffer=days<=buf;

  let msg,mcol;
  if(!fresh){ msg='ทำครบทุกข้อในคลังแล้ว 🎉 จากนี้โฟกัสที่การเคลียร์คิว Smart Review ให้หมดทุกวัน'; mcol='var(--ok)'; }
  else if(inBuffer){ msg=`เหลือ ${days} วัน — เข้าโหมดทบทวนแล้ว ไม่ควรเปิดข้อใหม่ ให้เคลียร์คิวทบทวนและทำ NL2 Simulator จับเวลา`; mcol='var(--gold-d)'; }
  else if(pace<=0){ msg=`ยังไม่มีข้อมูลจังหวะ — เริ่มทำวันละ ${need} ข้อ แล้วระบบจะเทียบให้เองว่าตามแผนหรือไม่`; mcol='var(--muted)'; }
  else if(pace>=need){ msg=`ตามแผนอยู่ จังหวะปัจจุบัน ${pace} ข้อ/วัน มากกว่าที่ต้องการ (${need} ข้อ/วัน)`; mcol='var(--ok)'; }
  else { const gap=Math.ceil(need-pace);
         msg=`ช้ากว่าแผน — ต้องเพิ่มอีกวันละ ${gap} ข้อ ถ้ายังทำ ${pace} ข้อ/วันเท่าเดิม จะจบคลัง${finish?' '+thDate(finish):''} ซึ่งช้ากว่ากำหนด`; mcol='var(--bad)'; }

  const op=planOpen();
  return `<div class="wrap" style="padding-top:16px"><div class="card" style="border-left:5px solid var(--navy)">
    <div class="row" style="align-items:center;gap:14px;flex-wrap:nowrap;cursor:pointer" onclick="togglePlan()">
      <div class="cardico">${ic('clock')}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:22px;font-weight:800;color:var(--navy);line-height:1.1">อีก ${days} วัน</div>
        <div class="muted" style="font-size:13px">ถึงวันสอบ ${EXAM_LABEL} • ${thDate(ex)}${days>=7?` (~${Math.floor(days/7)} สัปดาห์)`:''}</div>
      </div>
      <button class="plan-tgl" id="planTgl" title="ดูแผนอ่านสอบ" aria-label="ขยาย/ย่อแผนอ่านสอบ">${op?'▴':'▾'}</button>
    </div>
    <div id="planBody" style="display:${op?'':'none'}">
    <div class="srs-mini">
      <div class="m"><b>${fresh}</b><span>ข้อที่ยังไม่เคยทำ</span></div>
      <div class="m"><b style="color:${inBuffer?'var(--muted)':'var(--gold-d)'}">${inBuffer?'—':need}</b><span>ต้องทำ/วัน (เหลือ ${studyDays} วันอ่าน)</span></div>
      <div class="m"><b style="color:${pace>=need&&need?'var(--ok)':'var(--navy)'}">${pace}</b><span>จังหวะจริง (7 วันล่าสุด)</span></div>
      <div class="m"><b style="font-size:17px;padding-top:5px">${finish?thDate(finish):'—'}</b><span>คาดว่าจบคลัง</span></div>
    </div>
    <div class="muted" style="margin-top:12px;font-size:14px;color:${mcol}">${msg}</div>
    <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
      ${(!inBuffer&&need)?`<button class="btn sm" style="padding:6px 14px" onclick="applyPlanGoal(${need})">ตั้งเป้าวันละ ${need} ข้อ</button>`:''}
      <button class="btn sm sec" style="padding:6px 14px" onclick="setBuffer()">กันเวลาทบทวน ${buf} วัน</button>
    </div>
    </div>
  </div></div>`;
}

const DAILY_N = 7;
/* seed จากวันที่ → ทุกคนได้ข้อสอบชุดเดียวกันในแต่ละวัน (FNV-1a + mulberry32) */
function dSeedToday(){ const k=dKey(new Date()); let h=2166136261>>>0; for(let i=0;i<k.length;i++){ h^=k.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function dailyItems(){
  const pool=[]; allQuizzes().forEach(qz=>{ (qz.questions||[]).forEach(x=>pool.push(x)); });
  if(!pool.length) return [];
  const rnd=mulberry32(dSeedToday()); const idx=new Set(); const n=Math.min(DAILY_N,pool.length);
  while(idx.size<n){ idx.add(Math.floor(rnd()*pool.length)); }
  return [...idx].map(i=>pool[i]);
}
function isDailyDone(){ return LS.get('dailyDone','')===dKey(new Date()); }
function markDailyDone(){ LS.set('dailyDone',dKey(new Date())); }
async function startDaily(){
  await needAllSets();
  if(isDailyDone() && !confirm('วันนี้ทำข้อสอบประจำวันแล้ว ต้องการทำซ้ำไหม?')) return;
  const items=dailyItems(); if(!items.length){ alert('ยังไม่มีข้อสอบในระบบ'); return; }
  const q={id:'daily', title:'ข้อสอบประจำวัน '+dKey(new Date()), questions:items};
  showLoader('กำลังจัดข้อสอบประจำวัน...');
  setTimeout(()=>{ state.session=buildSession(q,{mode:'practice',count:'all',shuffleQ:false,shuffleO:true,timer:false}); persistSession(); hideLoader(); go('quiz'); },400);
}
function dailyCardHTML(){
  const done=isDailyDone();
  return `<div class="wrap" style="padding-top:16px"><div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-left:5px solid var(--teal)">
    <div class="cardico">${ic('flask')}</div>
    <div style="flex:1;min-width:180px"><div style="font-size:18px;font-weight:800;color:var(--navy);line-height:1.15">ข้อสอบประจำวัน</div>
      <div class="muted" style="font-size:13px">${DAILY_N} ข้อสุ่มจากคลัง • ทุกคนได้ชุดเดียวกัน${done?' • วันนี้ทำแล้ว ✅':''}</div></div>
    <button class="btn${done?' sec':''}" style="padding:8px 16px" onclick="startDaily()">${done?'ทำซ้ำ':'▶ เริ่มทำ'}</button>
  </div></div>`;
}

/* รายงานข้อสอบที่เฉลย/โจทย์ผิด → เก็บใน Supabase (ตาราง reports) ให้แอดมินตรวจแก้ */
async function reportQuestion(i){
  const s=state.session; const it=s&&s.items&&s.items[i]; if(!it) return;
  if(!CLOUD){ alert('ฟีเจอร์รายงานต้องใช้ระบบคลาวด์ (Supabase)'); return; }
  if(!user){ alert('กรุณาเข้าสู่ระบบก่อนรายงานข้อผิด'); return; }
  const reason=prompt('พบปัญหาอะไรกับข้อนี้? (เช่น เฉลยผิด / โจทย์ไม่ชัด / พิมพ์ผิด)');
  if(reason===null) return;
  const btn=document.getElementById('rep'+i); if(btn){ btn.disabled=true; btn.textContent='กำลังส่ง...'; }
  try{
    const {error}=await supa.from('reports').insert({
      user_email:user.email, set_id:s.quizId||null, qkey:it.key,
      question_text:String(it.q||'').slice(0,800), correct_ans:it.ans, reason:reason||null
    });
    if(error) throw error;
    if(btn){ btn.textContent='ส่งรายงานแล้ว ขอบคุณ'; }
  }catch(e){
    console.warn('report error',e); alert('ส่งรายงานไม่สำเร็จ: '+(e.message||e));
    if(btn){ btn.disabled=false; btn.textContent='รายงานข้อผิด'; }
  }
}

/* ---------- Saved Exam (บันทึกข้อไว้ทบทวน, localStorage) ---------- */
function savedQ(){ return LS.get('savedQuestions',[]); }
function isSavedQ(key){ return savedQ().includes(key); }
function toggleSavedQ(key,i){
  let a=savedQ(); const was=a.includes(key), now=!was;
  a=was?a.filter(k=>k!==key):[...a,key]; LS.set('savedQuestions',a);
  /* เดิมโค้ดตรงนี้เขียนทับ innerHTML ด้วยข้อความ 'Save'/'Saved' ทำให้ไอคอนหายไป
     และสลับสถานะกลับด้าน — เปลี่ยนมาสลับแค่คลาสกับ label แทน */
  const b=document.getElementById('sv'+i);
  if(b){
    b.classList.toggle('on',now);
    b.setAttribute('aria-pressed',String(now));
    const t=now?'เอาออกจากคลังของฉัน':'บันทึกข้อนี้เข้าคลังของฉัน';
    b.setAttribute('title',t+' (B)'); b.setAttribute('aria-label',t);
  }
  if(typeof i==='number') actHint(i, now?'บันทึกเข้าคลังแล้ว':'เอาออกจากคลังแล้ว');
}
function savedQItems(){ const idx=QIDX(); return savedQ().map(k=>idx[k]&&idx[k].q).filter(Boolean); }
function unsaveFromList(k){ LS.set('savedQuestions', savedQ().filter(x=>x!==k)); render(); }
async function startSaved(){ await needAllSets(); const qs=savedQItems(); if(!qs.length){ alert('ยังไม่มีข้อที่บันทึก'); return; }
  window.__saved={id:'saved',title:'Saved Exam',subject:'past',questions:qs}; go('config',{quiz:'saved'}); }
function renderSaved(app){
  const idx=QIDX(); const keys=savedQ(); const items=keys.map(k=>({k,rec:idx[k]})).filter(x=>x.rec);
  app.innerHTML=`<div class="wrap" style="padding-top:24px"><div class="card">
    <div class="row"><b class="qtitle" style="font-size:20px">Saved Exam</b><span style="flex:1"></span>
      ${items.length?`<button class="btn sm" onclick="startSaved()">▶ เริ่มทบทวน (${items.length})</button>`:''}</div>
    <div class="muted" style="margin-top:6px">ข้อที่กดบันทึกไว้ อยากกลับมาทบทวน แม้ตอบถูกหรือเดาถูก</div>
    ${items.length?`<div style="margin-top:12px">${items.map(x=>{ const r=x.rec; const t=(r.q&&r.q.q)||''; return `<div class="card" style="margin-bottom:10px;border-left:4px solid var(--gold)">
        <div class="muted" style="font-size:12px">${esc(r.quizTitle||'-')} • ${esc(r.topic||'-')}</div>
        <div class="stem" style="margin-top:6px;font-size:15px">${esc(t.slice(0,220))}${t.length>220?'…':''}</div>
        <div class="row" style="margin-top:8px"><button class="btn sm sec" style="padding:3px 10px" onclick="unsaveFromList('${x.k}')">เอาออก</button></div>
      </div>`; }).join('')}</div>`
      :`<div class="card" style="margin-top:12px"><div class="muted">ยังไม่มีข้อที่บันทึก — ระหว่างทำข้อสอบ กดปุ่ม Save ข้างเลขข้อ</div></div>`}
    <div class="row" style="margin-top:8px"><button class="btn sec" onclick="go('home')">หน้าแรก</button></div>
  </div></div>`;
}

/* ---------- กล่องรายงาน (เฉพาะแอดมิน) ---------- */
async function renderReports(app){
  if(!isAdmin()){
    app.innerHTML=`<div class="wrap" style="padding-top:26px"><div class="card"><b class="qtitle" style="font-size:19px">เฉพาะแอดมิน</b>
      <div class="muted" style="margin-top:6px">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>
      <div class="row" style="margin-top:14px"><button class="btn sec" onclick="go('home')">หน้าแรก</button></div></div></div>`; return;
  }
  const filt = state.repFilter||'open';
  const chip=(id,label)=>`<button class="btn sm ${filt===id?'':'sec'}" onclick="go('reports',{repFilter:'${id}'})">${label}</button>`;
  app.innerHTML=`<div class="wrap" style="padding-top:26px"><div class="card">
    <div class="row"><b class="qtitle" style="font-size:20px">กล่องรายงานข้อผิด</b><span style="flex:1"></span>
      ${chip('open','⏳ รอจัดการ')} ${chip('fixed','แก้แล้ว')} ${chip('dismissed','ปิดแล้ว')} ${chip('all','ทั้งหมด')}
      <button class="btn sm sec" onclick="render()" title="รีเฟรช">↻</button></div>
    <div id="repList" style="margin-top:14px"><div class="muted">กำลังโหลด...</div></div>
  </div></div>`;
  const box=document.getElementById('repList');
  try{
    let qy=supa.from('reports').select('*').order('created_at',{ascending:false}).limit(300);
    if(filt!=='all') qy=qy.eq('status',filt);
    const {data,error}=await qy;
    if(error) throw error;
    if(!data||!data.length){ box.innerHTML='<div class="muted" style="padding:8px 0">— ไม่มีรายการ —</div>'; return; }
    box.innerHTML=data.map(r=>{
      const when=new Date(r.created_at).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'});
      const badge = r.status==='open'?'<span class="badge" style="background:var(--goldbg);color:var(--gold-d)">⏳ รอจัดการ</span>'
                  : r.status==='fixed'?'<span class="badge" style="background:var(--okbg);color:var(--ok)">แก้แล้ว</span>'
                  : '<span class="badge" style="background:var(--paper2);color:var(--muted)">ปิดแล้ว</span>';
      return `<div class="card" style="margin-bottom:10px;border-left:4px solid var(--teal)">
        <div class="row" style="gap:8px;align-items:center">${badge}<span class="muted" style="font-size:12px">${esc(when)} • ${esc(r.user_email||'-')}</span></div>
        <div class="stem" style="margin-top:8px;font-size:15px">${esc(r.question_text||'(ไม่มีข้อความโจทย์)')}</div>
        <div class="muted" style="margin-top:6px;font-size:13px"><b style="color:var(--bad)">เหตุผล:</b> ${esc(r.reason||'—')}</div>
        <div class="muted" style="margin-top:4px;font-size:12px">เฉลยปัจจุบัน: <b>${r.correct_ans!=null?LAB[r.correct_ans]:'?'}</b> • ชุด: ${esc(r.set_id||'-')} • qkey: <code>${esc(r.qkey||'-')}</code></div>
        <div class="row" style="margin-top:10px;gap:6px">
          ${r.status!=='fixed'?`<button class="btn sm" style="padding:4px 12px" onclick="setReportStatus('${r.id}','fixed')">ทำเครื่องหมายว่าแก้แล้ว</button>`:''}
          ${r.status!=='dismissed'?`<button class="btn sm sec" style="padding:4px 12px" onclick="setReportStatus('${r.id}','dismissed')">ปิด</button>`:''}
          ${r.status!=='open'?`<button class="btn sm sec" style="padding:4px 12px" onclick="setReportStatus('${r.id}','open')">↩ กลับเป็นรอจัดการ</button>`:''}
        </div></div>`;
    }).join('');
  }catch(e){
    console.warn('load reports error',e);
    box.innerHTML=`<div class="err">โหลดรายงานไม่สำเร็จ: ${esc(e.message||String(e))}<div class="muted" style="margin-top:6px">ตรวจว่ารันไฟล์ supabase_reports_schema.sql (ส่วน admin read/update) ใน Supabase แล้ว และล็อกอินด้วยบัญชีแอดมิน</div></div>`;
  }
}
async function setReportStatus(id,st){
  try{
    const {error}=await supa.from('reports').update({status:st}).eq('id',id);
    if(error) throw error;
    render();
  }catch(e){ alert('อัปเดตสถานะไม่สำเร็จ: '+(e.message||e)); }
}

/* ---------- spaced repetition (Leitner, localStorage) ---------- */
function srsMap(){ return LS.get('srs',{}); }
/* จัดเกรดคำตอบ 1 ข้อ: 'again' | 'hard' | 'good'
   'hard' = ตอบถูกแบบไม่มั่นใจ (ติดธง หรือใช้เวลานานผิดปกติ) — ยังถือว่าเป็นจุดอ่อน  */
function gradeAnswer(session,i,med){
  const it=session.items[i], ans=session.answers[i];
  if(ans!==it.ans) return 'again';
  if(session.flags && session.flags[i]) return 'hard';          // ผู้ใช้บอกเองว่าไม่ชัวร์
  const t=session.times ? session.times[i] : null;
  if(med && typeof t==='number' && t > med*2) return 'hard';    // ช้ากว่า median ตัวเอง 2 เท่า
  return 'good';
}
function updateSRS(session){ const m=srsMap(), now=Date.now(), IV=[0,1,3,7,16,35];
  const med=paceMedian();
  (session.items||[]).forEach((it,i)=>{ const ans=session.answers[i]; if(ans===undefined||!it.key)return;
    const cur=m[it.key]||{box:0};
    const g=gradeAnswer(session,i,med);
    let box, due;
    if(g==='again'){ box=1; due=now+IV[1]*86400000; }
    else if(g==='hard'){
      // box ไม่โต → ข้อที่เดาถูกจะไปไม่ถึง box 5 (เกณฑ์หลุดคิวถาวร) จนกว่าจะตอบถูกแบบมั่นใจ
      // เพดาน 4: ถ้าเคย mastered (box 5) มาก่อนแล้วมาเดาถูก ต้องดึงกลับเข้าคิวด้วย
      box=Math.min(Math.max(cur.box||0,1),4);
      due=now+Math.round(IV[box]*86400000/2);                   // กลับมาทบทวนเร็วขึ้นครึ่งหนึ่ง
    } else { box=Math.min((cur.box||0)+1,5); due=now+IV[box]*86400000; }
    m[it.key]={box,due,last:now,g,hard:(cur.hard||0)+(g==='hard'?1:0)};
  });
  LS.set('srs',m);
  pushPace(session.times);
  invalidateAnalytics();
}

/* ---------- Smart Review hub — ทำให้ SRS "มองเห็นได้" ----------
   เดิมมีเครื่องยนต์ Leitner อยู่แล้ว แต่ผู้ใช้ไม่มีทางรู้ว่าวันนี้ค้างกี่ข้อ
   ถ้าไม่กดเข้าไปเดา ส่วนนี้จึงเป็นชั้นแสดงผล + ตัวนับบนแถบเมนู          */
let __ana=null, __dueCache=null;
function invalidateAnalytics(){ __ana=null; __dueCache=null; }
function analyticsCached(){ if(!__ana) __ana=analytics(); return __ana; }
const DAY=86400000, SRS_IV=[0,1,3,7,16,35];
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x.getTime(); }

/* สถิติจาก srsMap อย่างเดียว (ไม่แตะเน็ต) — ใช้กับ ladder / forecast / mastery */
function srsStats(){
  const m=srsMap(), idx=QIDX(), now=Date.now();
  /* คิวทบทวนเก็บใน localStorage ตาม qkey จึงนับได้แม้ยังโหลดข้อสอบไม่ครบ
     ปกติจะกรองข้อที่ถูกถอดออกจากคลังทิ้ง แต่ตอนที่ยังโหลดไม่ครบ (เช่นหน้าแรก
     ที่มีแต่สารบัญ) ต้องไม่กรอง ไม่งั้นตัวเลข "ถึงกำหนดทบทวนวันนี้" จะขึ้น 0 ผิด ๆ */
  const partial = (window.QUIZ_DATA||[]).some(x=>x.__stub);
  const known = k => partial ? true : !!idx[k];
  const t0=startOfDay(now), endToday=t0+DAY-1;
  const total = partial
    ? (__setIndex.reduce((n,x)=>n+(x.count||0),0) || Object.keys(m).length)
    : Object.keys(idx).length;
  const st={total,seen:0,mastered:0,overdue:0,dueToday:0,
            boxes:[0,0,0,0,0,0],fc:[0,0,0,0,0,0,0]};
  Object.keys(m).forEach(k=>{
    if(!known(k)) return;                                /* ข้อที่ถูกถอดออกจากคลังแล้ว */
    const e=m[k], box=Math.min(e.box||0,5); st.seen++; st.boxes[box]++;
    if(box>=5){ st.mastered++; return; }                 /* box 5 = หลุดคิวถาวร */
    const due=e.due||0;
    if(due<t0) st.overdue++;
    else if(due<=endToday) st.dueToday++;
    const dayOff=Math.floor((startOfDay(due)-t0)/DAY);
    if(dayOff>=0 && dayOff<7) st.fc[dayOff]++;
  });
  st.fc[0]+=st.overdue;                                  /* ตกค้างต้องเคลียร์วันนี้ */
  st.due=st.overdue+st.dueToday;
  st.fresh=Math.max(st.total-st.seen,0);                 /* ยังไม่เคยเจอเลย */
  return st;
}
/* คิวจริงที่จะได้เมื่อกดเริ่ม = ข้อที่ถึงกำหนด + ข้อที่ครั้งล่าสุดยังตอบผิด */
async function srsQueueKeys(){
  const {latest}=await analyticsCached(); const idx=QIDX(), m=srsMap(), now=Date.now();
  const keys=new Set();
  Object.keys(latest).forEach(k=>{ if(!latest[k].c && idx[k]) keys.add(k); });
  Object.keys(m).forEach(k=>{ if(idx[k] && (m[k].box||0)<5 && (m[k].due||0)<=now) keys.add(k); });
  return [...keys].filter(k=>idx[k]).sort((a,b)=>{
    const A=m[a]||{box:0,due:0}, B=m[b]||{box:0,due:0};
    return ((A.box||0)-(B.box||0))||((A.due||0)-(B.due||0)); });
}
async function updateReviewBadge(){
  const el=document.getElementById('revDue'); if(!el)return;
  const tb=document.getElementById('tbDue');
  try{
    if(__dueCache===null) __dueCache=(await srsQueueKeys()).length;
    const txt=__dueCache>99?'99+':String(__dueCache);
    el.textContent=txt; el.classList.toggle('on', __dueCache>0);
    if(tb){ tb.textContent=txt; tb.style.display=__dueCache>0?'':'none'; }
  }catch(e){ el.classList.remove('on'); if(tb)tb.style.display='none'; }
}
async function renderReview(app){
  const st=srsStats();
  app.innerHTML=`<div class="wrap" style="padding-top:18px">
    <div class="row" style="margin-bottom:10px;align-items:center">
      <b class="qtitle" style="font-size:20px">Smart Review</b>
      <span class="badge">spaced repetition</span><span style="flex:1"></span>
      <button class="btn sec" onclick="goBack()">${ic('left')}กลับ</button></div>
    <div class="card"><div class="muted">กำลังคำนวณคิวทบทวน...</div></div></div>`;
  let queue=[];
  try{ queue=await srsQueueKeys(); }catch(e){}
  __dueCache=queue.length; updateReviewBadge();
  const wrongOnly=Math.max(queue.length-st.due,0);
  const pctMaster=st.total?Math.round(st.mastered/st.total*100):0;
  const fcMax=Math.max(1,...st.fc);
  const names=['กล่อง 1 · ทบทวนพรุ่งนี้','กล่อง 2 · อีก 3 วัน','กล่อง 3 · อีก 7 วัน',
               'กล่อง 4 · อีก 16 วัน','กล่อง 5 · แม่นแล้ว'];
  const cols=['#e0533f','#e08a2e','#e0c22e','#5fb85f','#12b3a0'];
  const maxBox=Math.max(1,...st.boxes.slice(1));
  const ladder=names.map((nm,i)=>{ const c=st.boxes[i+1]||0;
    return `<div class="lv"><span class="nm">${nm}</span>
      <span class="track"><span class="fill" style="width:${c/maxBox*100}%;background:${cols[i]}"></span></span>
      <span class="ct">${c}</span></div>`; }).join('');
  const dn=['อา','จ','อ','พ','พฤ','ศ','ส'];
  const today=new Date();
  const fcast=st.fc.map((v,i)=>{ const d=new Date(today.getTime()+i*DAY);
    return `<div class="d${i===0?' today':''}"><span class="vv">${v||''}</span>
      <span class="bar" style="height:${Math.max(v/fcMax*100,v?4:1)}%"></span>
      <span class="lb">${i===0?'วันนี้':dn[d.getDay()]+' '+d.getDate()}</span></div>`; }).join('');
  app.innerHTML=`<div class="wrap" style="padding-top:18px">
   <div class="row" style="margin-bottom:10px;align-items:center">
     <b class="qtitle" style="font-size:20px">Smart Review</b>
     <span class="badge">spaced repetition</span><span style="flex:1"></span>
     <button class="btn sec" onclick="goBack()">${ic('left')}กลับ</button></div>

   <div class="card">
     <div class="srs-hero">
       <div><div class="srs-big">${queue.length}</div>
         <div class="muted" style="font-size:15px">ข้อที่ควรทบทวนตอนนี้</div></div>
       <div style="flex:1;min-width:220px">
         ${queue.length
           ? `<button class="btn" style="font-size:17px;padding:12px 22px" onclick="startMistakes()">▶ เริ่มทบทวน ${queue.length} ข้อ</button>
              <div class="muted" style="margin-top:8px;font-size:14px">เรียงข้อที่อ่อนที่สุดขึ้นก่อน (กล่องต่ำ → ค้างนานสุด)</div>`
           : `<div class="warn" style="margin:0">เคลียร์คิวหมดแล้ว — ไปทำชุดใหม่เพื่อเติมข้อเข้าระบบทบทวนได้เลย</div>`}
       </div>
     </div>
     <div class="srs-mini">
       <div class="m"><b style="color:var(--bad)">${st.overdue}</b><span>ค้างจากวันก่อน</span></div>
       <div class="m"><b style="color:var(--gold-d)">${st.dueToday}</b><span>ครบกำหนดวันนี้</span></div>
       <div class="m"><b>${wrongOnly}</b><span>ตอบผิดครั้งล่าสุด</span></div>
       <div class="m"><b style="color:var(--ok)">${st.mastered}</b><span>แม่นแล้ว (กล่อง 5)</span></div>
     </div>
   </div>

   <div class="card">
     <b style="color:var(--navy)">ความคืบหน้าทั้งคลัง</b>
     <div class="row" style="margin-top:10px;align-items:center;gap:12px">
       ${bar(pctMaster,'var(--teal)')}<span style="font-weight:600;color:var(--navy)">${pctMaster}%</span></div>
     <div class="muted" style="margin-top:8px;font-size:14px">
       แม่นแล้ว ${st.mastered} • กำลังทบทวน ${st.seen-st.mastered} • ยังไม่เคยเจอ ${st.fresh} • รวม ${st.total} ข้อ</div>
   </div>

   <div class="card">
     <b style="color:var(--navy)">ขั้นความจำ (Leitner)</b>
     <div class="muted" style="font-size:14px;margin:4px 0 10px">ตอบถูกแบบมั่นใจ = เลื่อนขึ้นกล่อง • ตอบผิด = ตกกลับกล่อง 1 • ถูกแบบไม่มั่นใจ (ติดธง หรือใช้เวลานานผิดปกติ) = ค้างที่เดิมและกลับมาเร็วขึ้น</div>
     <div class="ladder">${ladder}</div>
   </div>

   <div class="card">
     <b style="color:var(--navy)">ภาระ 7 วันข้างหน้า</b>
     <div class="muted" style="font-size:14px;margin:4px 0 2px">วางแผนล่วงหน้าได้ว่าวันไหนจะหนัก (แท่งวันนี้รวมข้อที่ค้างมาแล้ว)</div>
     <div class="fcast">${fcast}</div>
   </div>

   <div class="card">
     <div class="muted" style="font-size:13px;margin-bottom:8px">${syncLabel()}</div>
     <span class="muted" style="font-size:14px">ระบบจะจัดคิวเองจากผลการทำข้อสอบทุกชุด ไม่ต้องมาเลือกเอง — ยิ่งทำข้อสอบมาก คิวยิ่งแม่นขึ้น ข้อที่ถึงกล่อง 5 จะหลุดออกจากคิวถาวร ส่วนข้อที่เดาถูกจะถูกกันไว้ไม่ให้ขึ้นเกินกล่อง 4 จนกว่าจะตอบถูกแบบมั่นใจจริง</span>
   </div>
  </div>`;
}

if(CLOUD){ supa.auth.onAuthStateChange(async(_e,sess)=>{ let u=sess?.user||null; if(u && !(await emailAllowed(u.email))){ await supa.auth.signOut(); u=null; alert('อนุญาตเฉพาะบัญชีอีเมล @up.ac.th เท่านั้น'); } user=u; isAdminFlag=await computeAdmin(); __syncReady=false; await pullState(); renderTopbar(); render(); }); }
/* ---------- บูต: โหลดสารบัญข้อสอบ (ไฟล์เดียว 1.5 KB) แล้ววาดหน้าได้เลย ---------- */
(async()=>{
  let ok=false;
  try{ showLoader('กำลังโหลดคลังข้อสอบ...'); ok=await loadIndex(); }
  catch(e){ console.warn('boot: load index failed', e); }
  hideLoader();
  if(!ok){ __bootFailedNotice(); return; }
  await refreshUser();    /* ตัวนี้เรียก renderTopbar()+render() ให้ตอนจบอยู่แล้ว */
  /* เปิดลิงก์ตรง เช่น .../#/quiz/nl2-2024 → พาไปหน้านั้นเลย */
  if(location.hash.startsWith('#/') && location.hash!=='#/') applyHash();
  else syncHash(true);    /* ไม่มี hash → เขียน #/ ให้เรียบร้อยโดยไม่ถมประวัติ */
  /* ผู้ใช้กำลังอ่านหน้าแรกอยู่ ระหว่างนั้นค่อย ๆ ดึงชุดที่เหลือมาไว้เงียบ ๆ
     พอกดเข้าหน้าทบทวน/จุดอ่อน/จำลองสอบ มักจะพร้อมแล้วไม่ต้องรอ */
  prefetchSets();
})();
/* โหลดคลังไม่ได้ — บอกให้ชัดว่าเกิดอะไรและทำอะไรต่อได้ ดีกว่าโชว์หน้าเปล่า ๆ

   หมายเหตุสำคัญ: ตัวฟังก์ชันนี้เขียนทับ #app ตรง ๆ แต่ onAuthStateChange
   ของ Supabase จะยิง render() ตามมาทีหลังแล้วลบข้อความนี้ทิ้ง จนกลายเป็น
   หน้าแรกที่ว่างเปล่าโดยไม่บอกสาเหตุ — จึงต้องมีธง __dataFailed ให้ render()
   เช็คด้วย (ดูต้นฟังก์ชัน render) ไม่ใช่พึ่งการเขียน innerHTML อย่างเดียว     */
function __bootFailedNotice(){
  __dataFailed=true;
  const app=document.getElementById('app'); if(!app)return;
  const offline = navigator.onLine===false;
  const isFile  = location.protocol==='file:';
  app.innerHTML=`<div class="wrap" style="padding-top:var(--s7)"><div class="warn">
    <b style="color:var(--no)">${
      isFile ? 'เปิดไฟล์ตรง ๆ จะโหลดข้อสอบไม่ได้'
             : offline ? 'ตอนนี้ไม่ได้ต่ออินเทอร์เน็ต' : 'ยังโหลดคลังข้อสอบไม่ได้'}</b>
    <div class="muted" style="margin-top:6px;line-height:1.75">
      ${isFile
        ? 'ตอนนี้เปิดด้วย <code>file://</code> ซึ่งเบราว์เซอร์ห้ามอ่านไฟล์ใน <code>data/</code> ด้วยเหตุผลด้านความปลอดภัย '
          +'ถ้าจะทดสอบในเครื่อง ให้เปิดผ่านเซิร์ฟเวอร์เล็ก ๆ แทน — เปิด Terminal แล้วพิมพ์:<br>'
          +'<code style="display:inline-block;margin-top:8px;padding:6px 10px;background:var(--sunken);border-radius:6px">'
          +'cd &quot;โฟลเดอร์ Website&quot; แล้ว python3 -m http.server 8000</code><br>'
          +'จากนั้นเปิด <code>http://localhost:8000</code>'
        : offline
        ? 'เว็บนี้ต้องใช้เน็ตในการดึงข้อสอบ ต่อ Wi-Fi หรือเปิดเน็ตมือถือแล้วลองใหม่อีกครั้ง'
        : 'หาไฟล์ <code>data/index.json</code> ไม่เจอ หรือเน็ตมีปัญหา<br>'
          +'ถ้าเพิ่งอัปเว็บขึ้น GitHub ให้ตรวจว่าอัปโฟลเดอร์ <code>data/</code> ขึ้นไปด้วยแล้วหรือยัง '
          +'(รัน <code>npm run build-data</code> เพื่อสร้าง)'}
    </div>
    <button class="btn" style="margin-top:var(--s4)" onclick="location.reload()">ลองใหม่</button>
  </div></div>`;
}
/* เน็ตกลับมาแล้วแต่หน้ายังค้างอยู่ที่ข้อความ "ต่อเน็ตไม่ได้" → โหลดให้เองเลย
   ไม่ต้องให้ผู้ใช้มานั่งกดรีเฟรชเอง */
window.addEventListener('online',()=>{
  if(!(window.QUIZ_DATA||[]).length) location.reload();
});
