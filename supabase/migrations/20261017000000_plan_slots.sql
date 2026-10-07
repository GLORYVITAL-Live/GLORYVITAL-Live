-- สิทธิ์ Owner: หน้า Plan Slot Live (แพลน slot ทั้งเดือน แล้วเขียนลงแท็บ "ลงตาราง Deal Mc" / "ลงตาราง Admin เสริม")
--   ติ๊กที่หน้าเจ้าของ > พนักงาน > Owner > "Plan Slot Live" (ติ๊กให้คนอื่นได้เฉพาะคนที่มีสิทธิ์นี้อยู่แล้ว)
--   ค่าเริ่มต้น: เปิดให้บัญชี kunraroj.d@glorythailand.com

alter table public.staff
  add column if not exists can_plan_slots boolean not null default false;

update public.staff set can_plan_slots = true
 where role = 'owner' and lower(email) = 'kunraroj.d@glorythailand.com';

notify pgrst, 'reload schema';
