// ====== ตั้งค่าเว็บ (แก้เฉพาะไฟล์นี้) ======
// ถ้าเว้นว่างทั้งสองค่า เว็บจะทำงานแบบ "Guest mode" (เก็บคะแนนในเครื่องนี้เท่านั้น ไม่มีล็อกอิน)
// เมื่อสร้างโปรเจกต์ Supabase แล้ว ให้เอา Project URL และ anon public key มาใส่ (ดูวิธีใน README)
window.APP_CONFIG = {
  SUPABASE_URL: "",       // เช่น "https://abcxyz.supabase.co"
  SUPABASE_ANON_KEY: "",  // เช่น "eyJhbGciOi..."
  APP_NAME: "NL2 Med Quiz"
};
