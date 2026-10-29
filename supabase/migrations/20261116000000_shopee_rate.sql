-- ค่าจ้าง Shopee แยกจาก TikTok (รายคน) — Mc ที่ไลฟ์ทั้งสองแพลตฟอร์ม ค่าตัวไม่เท่ากัน
--   staff.shopee_rate = ค่าจ้าง/ชม. ของไลฟ์ Shopee (คิวแท็บ MC Shopee) · ว่าง = ใช้เรทเดียวกับ TikTok (hourly_rate / Commit) เหมือนเดิม
--   ตั้งไว้ = ไลฟ์ Shopee คิดเรทนี้คงที่ และ Commit นับเฉพาะชั่วโมง TikTok (src/lib/pay.ts platformRates)
--   pay_month_rates.shopee_rate = เรท Shopee ที่ล็อกไว้ของเดือนนั้น (เปลี่ยนเรท "มีผลเดือนหน้า" / บันทึกโอนแล้ว)

alter table public.staff add column if not exists shopee_rate numeric;
alter table public.staff drop constraint if exists staff_shopee_rate_check;
alter table public.staff add constraint staff_shopee_rate_check check (shopee_rate is null or shopee_rate >= 0);

alter table public.pay_month_rates add column if not exists shopee_rate numeric;

notify pgrst, 'reload schema';
