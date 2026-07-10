// ====== ตั้งค่าเว็บ (แก้เฉพาะไฟล์นี้) ======
// ถ้าเว้นว่างทั้งสองค่า เว็บจะทำงานแบบ "Guest mode" (เก็บคะแนนในเครื่องนี้เท่านั้น ไม่มีล็อกอิน)
// เมื่อสร้างโปรเจกต์ Supabase แล้ว ให้เอา Project URL และ anon public key มาใส่ (ดูวิธีใน README)
window.APP_CONFIG = {
  SUPABASE_URL: "",       // เช่น "https://abcxyz.supabase.co"
  SUPABASE_ANON_KEY: "",  // เช่น "eyJhbGciOi..."
  // แฮช SHA-256 ของอีเมลแอดมิน (คนเดียวที่เห็นปุ่มอัปโหลด). เก็บเป็นแฮชเพื่อไม่ให้อีเมลจริงโผล่ในโค้ด
  // ค่านี้คือแฮชของอีเมลแอดมิน (แอดมินยังใช้สมัครสมาชิกได้แม้ไม่ใช่ @up.ac.th) — ถ้าใช้อีเมลอื่น สร้างแฮชใหม่ได้ที่ช่อง console ด้วย: await sha256Hex("อีเมลคุณ")
  ADMIN_EMAIL_HASH: "59e3dc80aba4aa1837d321b12e87eec7ebff154c9bfa994fb88c075662b4853e",
  REPORT_FORM_URL: "",    // ลิงก์ Google Form สำหรับปุ่ม "รายงานข้อสอบผิดพลาด" เช่น "https://forms.gle/xxxxxxxx"
  APP_NAME: "NL2 Med Quiz"
};
