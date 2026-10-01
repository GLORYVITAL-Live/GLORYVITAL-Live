-- สิทธิ์ของ Owner แต่ละคน (ใช้เฉพาะแถว role = 'owner')
--   can_manage_mc    = เห็น/แก้ฝั่ง Mc (สรุปรายเดือน, slot ฝั่ง Mc, รายชื่อ Mc)
--   can_manage_admin = เห็น/แก้ฝั่ง Admin
--   ติ๊กทั้งคู่ = จัดการได้ทั้งหมด รวมถึงรายชื่อ/สิทธิ์ของ Owner คนอื่น
-- Owner เดิมได้สิทธิ์ทั้งคู่ (ค่าเริ่มต้น true)

alter table public.staff
  add column if not exists can_manage_mc boolean not null default true,
  add column if not exists can_manage_admin boolean not null default true;
