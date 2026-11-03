-- ค่ารถ Admin (ติ๊กรายคนที่หน้าพนักงาน > แก้ Admin)
--   staff.travel_allowance = ค่ารถต่อวัน (บาท) · ว่าง = ไม่ได้ค่ารถ
--   ได้เฉพาะวันที่มีคิว Admin เลิก 23:30 วันละครั้ง (src/lib/pay.ts travelPicks) · Admin ประจำ (เงินเดือน) ไม่คิด
--   รวมในยอดเงิน: สรุปรายเดือน / ไฟล์เบิก / ตารางของฉัน
--   pay_month_rates.travel_allowance = ค่ารถที่ล็อกไว้ของเดือนนั้น (เปลี่ยนค่ารถ "มีผลเดือนหน้า" / บันทึกโอนแล้ว)

alter table public.staff add column if not exists travel_allowance numeric;
alter table public.staff drop constraint if exists staff_travel_allowance_check;
alter table public.staff add constraint staff_travel_allowance_check check (travel_allowance is null or travel_allowance > 0);

alter table public.pay_month_rates add column if not exists travel_allowance numeric;

notify pgrst, 'reload schema';
