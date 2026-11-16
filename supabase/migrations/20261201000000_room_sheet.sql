-- ตารางห้องไลฟ์: เว็บเขียนแท็บ "Live <เดือน> <ปี> (เว็บ)" ลงชีตตารางไลฟ์ของแอดมินประจำ (src/lib/room-sheet-sync.ts)
--   เก็บลิงก์หรือ id ของชีตไว้ในฐานข้อมูล ไม่อยู่ในโค้ด (repo เป็น public) · ว่าง = ไม่เขียน
alter table public.settings add column if not exists room_sheet_id text;

notify pgrst, 'reload schema';
