-- เลิกใช้งบก้อนรายเดือน: ค่าที่มีย้ายไป agency_rates แล้ว (20261125000000_agency_rates) โค้ดไม่อ่านตารางนี้แล้ว
--   รันหลังโค้ดเรทต่อชั่วโมงขึ้นเว็บแล้วเท่านั้น

drop table if exists public.agency_budgets;

notify pgrst, 'reload schema';
