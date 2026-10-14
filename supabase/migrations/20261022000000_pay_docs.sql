-- เอกสารทำเบิกของ Mc / Admin: รูปบัตรประชาชน + รูปหน้าสมุดบัญชี + ชื่อจริง / เลขบัตร / ที่อยู่ / ธนาคาร / เลขบัญชี
--   เจ้าตัวส่ง / แก้ได้เองในเว็บ · ดูได้เฉพาะเจ้าตัว + Owner ที่ตั้ง can_view_pay_docs (ตั้งด้วย SQL เท่านั้น ไม่มีปุ่มในเว็บ)
--   ไฟล์เก็บใน Supabase Storage bucket "pay-docs" (ส่วนตัว เปิดดูผ่านเว็บเท่านั้น) + สำเนาขึ้นโฟลเดอร์ Google Drive ที่ตั้งใน settings
--   1 คน (อีเมล) = 1 ชุด ใช้ร่วมกันทั้งบทบาท Mc และ Admin

-- ต้องส่งเอกสาร: คนที่มีอยู่แล้วตอนรัน SQL นี้ = ไม่ต้อง (false) / เพิ่มใหม่หลังจากนี้ = ต้องส่ง (true)
alter table public.staff add column if not exists pay_docs_required boolean not null default false;
alter table public.staff alter column pay_docs_required set default true;
-- Owner ที่ดูเอกสารทำเบิกได้ (ไม่มีในหน้าพนักงาน ตั้งด้วย SQL: update public.staff set can_view_pay_docs = true where id = ...)
alter table public.staff add column if not exists can_view_pay_docs boolean not null default false;

create table if not exists public.pay_docs (
  email           text primary key check (email = lower(btrim(email))),
  full_name       text not null,
  id_card_no      text not null,
  address         text not null,
  bank            text not null,
  account_no      text not null,
  account_name    text not null,
  id_card_path    text not null,             -- path ใน bucket pay-docs
  bank_book_path  text not null,
  drive_file_ids  jsonb not null default '[]'::jsonb, -- ไฟล์ที่อัปขึ้น Drive ล่าสุด (ทิ้งถังขยะก่อนอัปชุดใหม่)
  drive_folders   jsonb not null default '{}'::jsonb, -- { "mc": folderId, "admin": folderId }
  drive_error     text,
  drive_synced_at timestamptz,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.pay_docs enable row level security;

-- ที่เก็บไฟล์ (ส่วนตัว ไม่เกิน 5 MB ต่อไฟล์ รูป หรือ PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pay-docs', 'pay-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- โฟลเดอร์ Google Drive ที่เก็บสำเนา (id จากลิงก์โฟลเดอร์ ตั้งด้วย SQL: update public.settings set pay_docs_drive_mc = '...')
alter table public.settings add column if not exists pay_docs_drive_mc text;
alter table public.settings add column if not exists pay_docs_drive_admin text;

notify pgrst, 'reload schema';
