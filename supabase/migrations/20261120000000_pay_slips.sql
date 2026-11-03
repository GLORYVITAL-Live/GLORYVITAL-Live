-- สลิปโอนเงินค่าจ้าง: ดึงจากโฟลเดอร์ Google Drive ที่ฝ่ายบัญชีอัปไว้ → เจ้าตัวดาวน์โหลดใน "ตารางของฉัน"
--   settings.pay_slip_drive_folder = id โฟลเดอร์ "Slip" (ตั้งด้วย SQL ในแชท — repo เป็นสาธารณะ ไม่ใส่ id ในไฟล์นี้)
--     โครงโฟลเดอร์: Slip > รอบ "261002" > "รายการเบิกสำหรับ MC LIVESTREAM Tiktok Fee" > "MC LIVESTREAM Tiktok -Mc แนน.pdf"
--   pay_slips = ไฟล์สลิปที่ระบบเจอ (อ่าน Drive อย่างเดียว ไม่ย้าย / ไม่ลบไฟล์) + คนที่จับคู่ (src/lib/slips.ts)
--     matched_by owner = Owner เลือกเอง (staff_id ว่าง = ไม่ใช่คนในระบบ) · ระบบจำไว้ ไฟล์ชื่อเดียวกันรอบหลังจับคู่เอง

alter table public.settings add column if not exists pay_slip_drive_folder text;

create table if not exists public.pay_slips (
  id              bigint generated always as identity primary key,
  drive_file_id   text not null unique,
  round           text not null,
  round_date      date,
  role            text not null check (role in ('mc', 'admin')),
  grp             text not null default '',
  file_name       text not null,
  mime            text not null default '',
  size            bigint not null default 0,
  name_key        text not null default '',
  staff_id        bigint references public.staff(id) on delete set null,
  matched_by      text check (matched_by in ('auto', 'owner')),
  file_created_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pay_slips_staff_idx on public.pay_slips (staff_id);
alter table public.pay_slips enable row level security;

notify pgrst, 'reload schema';
