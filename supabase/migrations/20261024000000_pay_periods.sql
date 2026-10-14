-- ปิดงวดรายเดือน (ค่าจ้าง): เก็บตัวเลขสรุปรายเดือน ณ ตอนปิด แยกฝั่ง Mc / Admin
--   ปิดแล้ว = หน้าสรุปรายเดือน + ไฟล์เบิกของเดือนนั้นใช้ตัวเลขที่เก็บไว้เสมอ ข้อมูลจริงเปลี่ยนทีหลัง (เช่น แก้ชีตย้อนหลัง) = ขึ้นป้ายส่วนต่าง
--   เปิดงวดใหม่ได้: แถวเดิมถูกตั้ง reopened_at (เก็บไว้เป็นประวัติ) ปิดใหม่ = แถวใหม่
--   ปิด / เปิดได้เฉพาะ Owner ที่ตั้ง can_close_periods (ตั้งด้วย SQL เท่านั้น ไม่มีปุ่มในหน้าพนักงาน)

create table if not exists public.pay_periods (
  id            bigint generated always as identity primary key,
  month         text not null check (month ~ '^\d{4}-\d{2}$'),
  side          text not null check (side in ('mc', 'admin')),
  closed_at     timestamptz not null default now(),
  closed_by     text not null default '',
  closed_email  text not null default '',
  snapshot      jsonb not null,            -- { people, details, rates, defaultRate } ของฝั่งนั้น ณ ตอนปิด
  reopened_at   timestamptz,
  reopened_by   text
);
-- ปิดอยู่ได้ทีละแถวต่อ เดือน + ฝั่ง
create unique index if not exists pay_periods_open_key on public.pay_periods (month, side) where reopened_at is null;

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.pay_periods enable row level security;

-- Owner ที่ปิด / เปิดงวดได้ (ตั้งด้วย SQL: update public.staff set can_close_periods = true where id = ...)
alter table public.staff add column if not exists can_close_periods boolean not null default false;

notify pgrst, 'reload schema';
