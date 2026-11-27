-- ล็อก search_path ของฟังก์ชัน (Supabase Security Advisor: function_search_path_mutable · ผู้ใช้สั่ง 2026-11-27)
--   ทุกตัวใช้แค่ฟังก์ชันพื้นฐาน (pg_catalog ถูกค้นเสมอ) หรืออ้างตารางแบบมี schema (public.settings) อยู่แล้ว
--   ค่าว่าง = ปลอดภัยสุด ผลลัพธ์เหมือนเดิม
--   หมายเหตุ: ถ้า create or replace ฟังก์ชันพวกนี้ใหม่ ต้องใส่ "set search_path = ''" ด้วย ไม่งั้นค่านี้หาย
alter function public.bkk_today() set search_path = '';
alter function public.fmt_hm(time without time zone) set search_path = '';
alter function public.schedule_cutoff_date() set search_path = '';
alter function public.set_slot_times() set search_path = '';
alter function public.slot_hours(timestamp with time zone, timestamp with time zone) set search_path = '';
