-- เอกสารยืนยันการรับเงิน (สลิปโอน / ใบสำคัญรับเงินที่เซ็นแล้ว) รายเดือน
--   Mc / Admin ส่งเอกสารของเดือนนั้นที่ "ตารางของฉัน" ก่อน ถึงดาวน์โหลดใบ 50 ทวิเดือนนั้นได้ (ส่งแล้วโหลดได้ทันที)
--   ไฟล์อัปขึ้น Google Drive: โฟลเดอร์หลัก (settings.receipt_drive_folder) > 2026 > 10 October > Mc / Admin > "Mc ชื่อ - 2026-10.pdf"
--   Owner ที่ดูเอกสารทำเบิกได้ (can_view_pay_docs) ดูได้ทุกคน กด "ไม่ผ่าน" + เหตุผล = ใบเดือนนั้นล็อกอีกครั้งจนกว่าจะส่งใหม่
--   ยังไม่ได้รัน SQL นี้ / ยังไม่ได้ตั้งโฟลเดอร์ = ยังไม่บังคับ (ดาวน์โหลดได้ตามเดิม)

alter table public.settings add column if not exists receipt_drive_folder text;                     -- id โฟลเดอร์หลักใน Drive (ตั้งด้วย SQL แยก)
-- บังคับตั้งแต่เดือนนี้ 'YYYY-MM' (ว่าง / null = ไม่บังคับ) · แถวเดิมได้ค่าเริ่มต้นตอนเพิ่มคอลัมน์ รันซ้ำไม่ทับค่าที่เปลี่ยนไว้
alter table public.settings add column if not exists receipt_required_from text default '2026-06';

create table if not exists public.pay_receipts (
  id            bigint generated always as identity primary key,
  email         text not null,                 -- คน = อีเมล (เป็นทั้ง Mc และ Admin = เอกสารเดียวกัน)
  staff_id      bigint references public.staff(id) on delete set null,  -- รายชื่อที่ใช้ตั้งชื่อไฟล์ / โฟลเดอร์ (Mc / Admin)
  month         text not null,                 -- 'YYYY-MM'
  drive_file_id text not null,
  file_name     text not null,
  mime          text not null,
  size          integer not null default 0,
  status        text not null default 'ok' check (status in ('ok', 'rejected')),
  reject_reason text,
  reviewed_by   text,                          -- อีเมล Owner ที่ตรวจล่าสุด
  reviewed_at   timestamptz,
  uploaded_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint pay_receipts_email_month unique (email, month)
);
create index if not exists pay_receipts_month_idx on public.pay_receipts (month);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.pay_receipts enable row level security;

notify pgrst, 'reload schema';
