-- ใบ 50 ทวิ (หนังสือรับรองการหักภาษี ณ ที่จ่าย) รายเดือน จากโฟลเดอร์ Google Drive ของบัญชี
--   โฟลเดอร์หลัก (settings.tawi_drive_folder) > โฟลเดอร์รายเดือน ("09Sep") > ไฟล์ PDF รายคน
--   ระบบอ่านชื่อจริงจากชื่อไฟล์ แล้วจับคู่กับรายชื่อ Mc / Admin (staff.legal_name / ชื่อในเอกสารทำเบิก / ไฟล์ที่เคยจับคู่)
--   Owner ที่ดูเอกสารทำเบิกได้ (can_view_pay_docs) จับคู่เองได้ · เจ้าตัวดาวน์โหลดใบของตัวเองที่ "ตารางของฉัน"

alter table public.settings add column if not exists tawi_drive_folder text;   -- id โฟลเดอร์หลักใน Drive (ตั้งด้วย SQL)
alter table public.staff add column if not exists legal_name text;             -- ชื่อ-นามสกุลจริงตามเอกสารภาษี

create table if not exists public.tawi_docs (
  id            bigint generated always as identity primary key,
  month         text not null,                 -- 'YYYY-MM'
  drive_file_id text not null unique,
  file_name     text not null,
  real_name     text not null,                 -- ชื่อจริงที่อ่านจากชื่อไฟล์
  name_key      text not null,                 -- ชื่อสำหรับเทียบ (ตัดคำนำหน้า / ช่องว่าง, ตัวพิมพ์เล็ก)
  staff_id      bigint references public.staff(id) on delete set null,
  matched_by    text check (matched_by in ('auto', 'owner', 'self')),
  notified_at   timestamptz,                   -- แจ้งเจ้าตัวแล้ว / ไม่ต้องแจ้ง (ไฟล์ย้อนหลังตอนตรวจครั้งแรก)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tawi_docs_staff_month_idx on public.tawi_docs (staff_id, month);
create index if not exists tawi_docs_month_idx on public.tawi_docs (month);
create index if not exists tawi_docs_name_key_idx on public.tawi_docs (name_key);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.tawi_docs enable row level security;

notify pgrst, 'reload schema';
