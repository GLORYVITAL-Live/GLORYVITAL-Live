-- ทีมไลฟ์ของ Mc / Admin: tiktok (ค่าเริ่มต้น = ทุกคนเดิม) / shopee
--   shopee = ไม่เห็นและจองคิวไลฟ์ TikTok ไม่ได้ ไม่ได้รับแจ้งเตือน slot ว่าง แต่ยังใช้ "ตารางของฉัน" (ใบ 50 ทวิ / เอกสารทำเบิก) ได้
--   ตั้งในหน้าเจ้าของ > พนักงาน > แก้ไข Mc / Admin > "ทีม Shopee"
alter table public.staff add column if not exists live_platform text not null default 'tiktok';

alter table public.staff drop constraint if exists staff_live_platform_check;
alter table public.staff add constraint staff_live_platform_check check (live_platform in ('tiktok', 'shopee'));

notify pgrst, 'reload schema';
