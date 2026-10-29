-- จ่ายค่าตัวผ่าน Mc อีกคน (Mc ในเครือ เช่น แนน2 ทำจ่ายผ่านคุณแนน)
--   staff.pay_to_id = Mc ที่รับเงินแทน · ว่าง = จ่ายให้ตัวเอง (ปกติ)
--   คนที่จ่ายผ่าน: ยังมีคิว / เรทค่าตัว / ชั่วโมงของตัวเอง แต่ยอดเงินรวมอยู่กับคนรับเงิน
--   (สรุปรายเดือน = แสดงซ้อนใต้คนรับเงิน · ไฟล์เบิก = บรรทัดเดียวของคนรับเงิน · บันทึกโอน = ที่คนรับเงิน · ตารางของฉันของคนรับเงินเห็นยอดนี้)
--   ตั้งที่หน้าเจ้าของ > พนักงาน > แก้ไข Mc > "จ่ายค่าตัวผ่าน" (src/lib/data.ts ownerSummary · src/components/OwnerView.tsx)

alter table public.staff add column if not exists pay_to_id bigint references public.staff(id) on delete set null;
alter table public.staff drop constraint if exists staff_pay_to_self_check;
alter table public.staff add constraint staff_pay_to_self_check check (pay_to_id is null or pay_to_id <> id);

notify pgrst, 'reload schema';
