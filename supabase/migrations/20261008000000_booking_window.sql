-- ช่วงเปิดจอง แยก Mc / Admin (หน้าเจ้าของ > จัดการ slot > ช่วงเปิดจอง)
--   null                                     = ไม่จำกัดเพิ่ม (ตามเดือนสุดท้ายที่เปิดจอง)
--   {"mode":"week"}                          = สัปดาห์นี้เท่านั้น (เลื่อนอัตโนมัติทุกวันจันทร์)
--   {"mode":"range","from":"2026-10-01","to":"2026-10-15"} = ช่วงวันที่กำหนดเอง
-- เว็บเป็นคนตรวจ (src/lib/window.ts) ทั้งตอนแสดง slot และตอนกดจอง

alter table public.settings
  add column if not exists book_window_mc jsonb,
  add column if not exists book_window_admin jsonb;

-- ให้ API ของ Supabase เห็นคอลัมน์ใหม่ทันที
notify pgrst, 'reload schema';
