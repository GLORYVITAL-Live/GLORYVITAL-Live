-- สรุป Mc TikTok (ผลงาน Mc > สรุป Mc TikTok · src/lib/tiktok-mc.ts): ค่าจ้าง Mc ของเรา / GMV / ROI / ชั่วโมง / % เป้า + สไลด์
--   เห็นได้: Owner ที่จัดการฝั่ง Mc ได้ และ (ดู Analytics ได้ หรือ ติ๊กช่องนี้) — ไว้ให้คนดูแล Mc TikTok ดึงสไลด์ได้โดยไม่ต้องเปิด Analytics ทั้งหมด
alter table public.staff add column if not exists can_view_tiktok_mc boolean not null default false;

notify pgrst, 'reload schema';
