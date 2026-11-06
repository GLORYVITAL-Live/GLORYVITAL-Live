-- หน้า Cost อ่านค่าใช้จ่ายรายเดือนจากแท็บ "Sum 2" ในชีตของทีม (src/lib/cost-sheet.ts)
--   เก็บลิงก์หรือ id ของชีตไว้ในฐานข้อมูล ไม่อยู่ในโค้ด (repo เป็น public)
alter table public.settings add column if not exists cost_sheet_id text;
