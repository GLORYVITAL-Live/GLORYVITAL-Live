-- ผู้รับอีเมลแจ้งเตือนเมื่อ Mc / Admin เสริมกดยกเลิกคิวผ่านเว็บ (ตั้งในหน้าพนักงาน > Owner)
--   notify_cancel_mc    = รับเมลเมื่อ Mc ยกเลิกคิว
--   notify_cancel_admin = รับเมลเมื่อ Admin เสริมยกเลิกคิว
-- ส่งเฉพาะ Owner ที่มีอีเมล และยังมีสิทธิ์ (ดูได้ / จัดการได้) ฝั่งนั้น

alter table public.staff
  add column if not exists notify_cancel_mc boolean not null default false,
  add column if not exists notify_cancel_admin boolean not null default false;

-- ค่าเริ่มต้น: Sam (บัญชีระบบ) รับทั้งสองฝั่ง / Toey (ดูแลฝั่ง Mc) รับฝั่ง Mc
update public.staff set notify_cancel_mc = true, notify_cancel_admin = true
where role = 'owner' and lower(email) = 'kunraroj.d@glorythailand.com';
update public.staff set notify_cancel_mc = true
where role = 'owner' and lower(email) = 'panutda.s@glorythailand.com';

notify pgrst, 'reload schema';
