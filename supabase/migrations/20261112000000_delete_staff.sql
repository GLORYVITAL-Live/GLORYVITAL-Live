-- ลบรายชื่อ Mc / Admin ได้เฉพาะเจ้าของระบบ (Owner ที่ติ๊กจัดการ Mc / Admin ลบไม่ได้)
--   ตั้งด้วย SQL เท่านั้น (ไม่มีช่องในหน้าพนักงาน): update public.staff set can_delete_staff = true where id = ...
--   รายชื่อ Owner / Marketing / ทีมอื่น ลบได้ตามสิทธิ์เดิม (Owner ที่จัดการได้ทั้ง Mc และ Admin)

alter table public.staff add column if not exists can_delete_staff boolean not null default false;

notify pgrst, 'reload schema';
