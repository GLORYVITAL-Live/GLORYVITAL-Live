-- ระบบที่ซิงค์กัน (ค่าจ้าง / การโอน / เทรนนิ่ง)
--   1) ค่าจ้าง/ชม. ที่ใช้คิดของแต่ละเดือน: เปลี่ยนเรทในหน้าพนักงาน = ล็อกเรทเดิมไว้กับเดือนก่อนหน้า (เดือนเก่าไม่เปลี่ยนตาม)
--      ไม่มีแถวของเดือนนั้น = ใช้เรทปัจจุบันในตาราง staff (เหมือนเดิม)
--   2) บันทึกการโอนค่าจ้างรายคนรายเดือน (โอนได้หลายครั้ง · ยกเลิกรายการ = ตั้ง voided_at เก็บไว้เป็นประวัติ)
--      Mc / Admin เห็น "จ่ายแล้ว / ค้างจ่าย" ในตารางของฉัน · บันทึกโอน = ล็อกเรทของเดือนนั้นด้วย
--   6) เทรนนิ่งบังคับก่อนจองคิว: Owner ติ๊กคลิปที่ต้องดู + เปิดใช้ (ปิดไว้ก่อน) · 'done' = ดูคลิปจบ (เกือบจบ)
--      staff.training_passed = Owner ให้ผ่าน (เช่น เทรนนอกเว็บแล้ว) จองได้โดยไม่ต้องดูคลิป

create table if not exists public.pay_month_rates (
  staff_id     bigint not null references public.staff(id) on delete cascade,
  month        text not null check (month ~ '^\d{4}-\d{2}$'),
  hourly_rate  numeric not null default 0,              -- อัตราที่ใช้จริงตอนล็อก (ไม่ได้ตั้งรายคน = ค่าเริ่มต้นตอนนั้น)
  commit_tiers jsonb not null default '[]'::jsonb,
  is_salaried  boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (staff_id, month)
);
alter table public.pay_month_rates enable row level security;

create table if not exists public.pay_payments (
  id            bigint generated always as identity primary key,
  staff_id      bigint not null references public.staff(id) on delete cascade,
  month         text not null check (month ~ '^\d{4}-\d{2}$'),
  amount        numeric not null check (amount > 0),
  paid_on       date not null,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  created_by    text not null default '',
  created_email text not null default '',
  voided_at     timestamptz,
  voided_by     text
);
create index if not exists pay_payments_month_idx on public.pay_payments (month);
create index if not exists pay_payments_staff_idx on public.pay_payments (staff_id, month);
alter table public.pay_payments enable row level security;

alter table public.training_items add column if not exists required boolean not null default false;
alter table public.settings add column if not exists training_required boolean not null default false;
alter table public.staff add column if not exists training_passed boolean not null default false;
alter table public.training_views drop constraint if exists training_views_kind_check;
alter table public.training_views add constraint training_views_kind_check check (kind in ('page', 'video', 'slides', 'done'));

notify pgrst, 'reload schema';
