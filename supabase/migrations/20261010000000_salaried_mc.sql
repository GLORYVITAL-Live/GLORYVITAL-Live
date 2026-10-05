-- Mc ประจำ (พนักงานประจำ ได้เงินเดือน): ไม่ต้องแนบหลักฐานไลฟ์
--   ติ๊กที่หน้าเจ้าของ > พนักงาน > แก้ไข Mc > "Mc ประจำ (เงินเดือน)"
--   slot ของ Mc ประจำไม่ขึ้นในหน้าหลักฐานไลฟ์ และสรุปรายเดือนแสดง "ไม่ต้องแนบ"

alter table public.staff
  add column if not exists is_salaried boolean not null default false;

notify pgrst, 'reload schema';
