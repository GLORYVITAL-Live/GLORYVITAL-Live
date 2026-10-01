-- ค่าจ้างแบบ Commit รายคน (Mc / Admin)
--   ถ้าชั่วโมงที่จองในเดือนนั้น (ไม่นับคิวที่ยกเลิก) >= commit_hours
--   ทุกชั่วโมงของเดือนนั้นคิดราคา commit_rate แทน hourly_rate
--   เช่น ปกติ 950 บาท/ชม. Commit 25 ชม. -> 800 บาท/ชม.
-- ว่างทั้งคู่ = ไม่มี Commit

alter table public.staff
  add column if not exists commit_hours numeric,
  add column if not exists commit_rate numeric;
