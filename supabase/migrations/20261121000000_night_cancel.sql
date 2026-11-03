-- ยกเลิกคิวตอนกลางคืน (22:00–08:00) ต้องทัก LINE คนดูแลแต่ละฝ่าย (src/lib/cancel-rule.ts)
--   ลิงก์ตั้งที่หน้าเจ้าของ > กฎการทำงาน · ว่าง = ใช้ลิงก์แชทแอดมินเดิม (admin_chat_url)
--   cancel_line_mc_tiktok = แอดมินดูแล Mc TikTok · cancel_line_mc_shopee = แอดมินดูแล Mc Shopee · cancel_line_admin = Owner (สำหรับ Admin เสริม)

alter table public.settings add column if not exists cancel_line_mc_tiktok text;
alter table public.settings add column if not exists cancel_line_mc_shopee text;
alter table public.settings add column if not exists cancel_line_admin text;

notify pgrst, 'reload schema';
