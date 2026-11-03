-- (เลิกใช้แล้ว 2026-11-03) ปุ่ม "มาถึงแล้ว" ของ Admin — เปลี่ยนเป็นเจ้าของใส่สถานะมาสายเอง (ชีตคอลัมน์ M · /api/owner/admin-late)
--   คอลัมน์นี้รันไปแล้วในฐานข้อมูลจริง เก็บไว้เฉยๆ ไม่มีโค้ดอ่าน / เขียน (ลบทิ้งได้ถ้าต้องการ: alter table public.admin_slots drop column arrived_at;)

alter table public.admin_slots add column if not exists arrived_at timestamptz;

notify pgrst, 'reload schema';
