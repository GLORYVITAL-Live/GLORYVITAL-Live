-- ข้อความ "กฎการทำงาน" ส่วน "อื่นๆ" ที่ Owner แก้ได้ผ่านเว็บ (หน้าเจ้าของ > กฎการทำงาน)
--   หนึ่งบรรทัด = หนึ่งข้อ / ว่าง (null) = ใช้ข้อความเริ่มต้นในโค้ด (src/lib/rules.ts)
-- ส่วน "การมาสาย" ดึงจากกฎคิดเงิน (src/lib/pay.ts) แก้ที่นี่ไม่ได้

alter table public.settings
  add column if not exists rules_mc text,
  add column if not exists rules_admin text;
