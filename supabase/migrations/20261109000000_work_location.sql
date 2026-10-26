-- ลิงก์โลเคชั่นที่ทำงาน (Google Maps) — เห็นเฉพาะคนที่มีบัญชีในระบบ (หัวเว็บ + ตารางของฉัน · src/components/WorkLocation.tsx)
--   ค่าจริงตั้งผ่าน SQL / หน้าเจ้าของ > กฎการทำงาน (ไม่เก็บในโค้ด เพราะ repo เป็นสาธารณะ) · ว่าง = ไม่แสดงปุ่ม
alter table public.settings add column if not exists work_location_url text not null default '';

notify pgrst, 'reload schema';
