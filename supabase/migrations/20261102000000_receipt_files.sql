-- เอกสารยืนยันการรับเงิน (ต่อจาก 20261101000000_pay_receipts)
--   1. ไฟล์ที่ทีมบัญชีอัปไว้เองใน Google Drive ก่อนมีระบบส่งผ่านเว็บ (โฟลเดอร์หลัก > 2026 > 09 September > Mc / Admin > ไฟล์ / โฟลเดอร์ย่อย 1 ชั้น)
--      ระบบตรวจไฟล์ (ปุ่ม "ตรวจไฟล์ใน Drive" + ทุกเช้า) จับคู่ชื่อในไฟล์กับรายชื่อ — จับคู่แล้ว = นับว่าส่งแล้ว (pay_receipts.source = 'drive')
--      ไม่ย้าย / ไม่เปลี่ยนชื่อ / ไม่ลบไฟล์เดิมใน Drive
--   2. ไฟล์ที่ส่งผ่านเว็บ: เก็บในโฟลเดอร์รายคน "Mc ชื่อเล่น (ชื่อจริง)" — จำ id โฟลเดอร์ไว้ ไม่สร้างซ้ำเมื่อชื่อเปลี่ยน
--   ยังไม่ได้รัน SQL นี้ = ส่งผ่านเว็บได้ตามเดิม แต่ยังดึงไฟล์เดิมใน Drive ไม่ได้

-- ที่มาของเอกสาร: 'web' = ส่งผ่านเว็บ / 'drive' = ไฟล์เดิมใน Drive ที่จับคู่แล้ว (ส่งผ่านเว็บทีหลัง = แทนที่ ไฟล์เดิมใน Drive ไม่ถูกลบ)
alter table public.pay_receipts add column if not exists source text not null default 'web' check (source in ('web', 'drive'));
-- โฟลเดอร์ของคนนี้เดือนนี้ใน Drive (ส่งผ่านเว็บ)
alter table public.pay_receipts add column if not exists folder_id text;

create table if not exists public.receipt_files (
  id              bigint generated always as identity primary key,
  drive_file_id   text not null unique,
  month           text not null,                 -- 'YYYY-MM' (จากโฟลเดอร์ปี / เดือน)
  role            text not null check (role in ('mc', 'admin')),
  file_name       text not null,
  path            text not null default '',      -- โฟลเดอร์ใต้เดือน เช่น 'Mc' / 'Mc/Shopee'
  mime            text not null default '',
  size            bigint not null default 0,
  nick            text not null default '',      -- ชื่อที่อ่านได้จากชื่อไฟล์ (ชื่อเล่น)
  real_name       text,                          -- ชื่อจริงในวงเล็บ (ถ้ามี)
  name_key        text not null,                 -- คีย์เทียบชื่อ (จำการจับคู่ของ Owner ต่อบทบาท + คีย์)
  staff_id        bigint references public.staff(id) on delete set null,
  -- auto = ระบบจับคู่ / owner = Owner เลือก (staff_id ว่าง + owner = Owner ตั้งว่าไม่ใช่คนในระบบ)
  matched_by      text check (matched_by in ('auto', 'owner')),
  file_created_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists receipt_files_month_idx on public.receipt_files (month);
create index if not exists receipt_files_key_idx on public.receipt_files (role, name_key);
create index if not exists receipt_files_staff_idx on public.receipt_files (staff_id);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.receipt_files enable row level security;

notify pgrst, 'reload schema';
