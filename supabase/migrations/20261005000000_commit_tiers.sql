-- Commit แบบหลายขั้น (เทียร์) รายคน
--   commit_tiers = [{"hours": 10, "rate": 950}, {"hours": 21, "rate": 900}, {"hours": 41, "rate": 850}]
--   เดือนไหนจอง (ไม่นับคิวที่ยกเลิก) ถึงเทียร์สูงสุดเท่าไร ทุกชั่วโมงของเดือนนั้นคิดราคาของเทียร์นั้น
--   ต่ำกว่าเทียร์แรก = hourly_rate (ค่าจ้างปกติ)
-- ย้าย Commit แบบเดิม (commit_hours / commit_rate) มาเป็นเทียร์แรก
-- คอลัมน์เดิมยังเก็บไว้ (โค้ดใหม่ไม่ใช้แล้ว) กันเว็บเวอร์ชันเก่า error ระหว่างรอ deploy

alter table public.staff add column if not exists commit_tiers jsonb not null default '[]'::jsonb;

update public.staff
   set commit_tiers = jsonb_build_array(jsonb_build_object('hours', commit_hours, 'rate', commit_rate))
 where commit_hours is not null and commit_rate is not null and commit_tiers = '[]'::jsonb;
