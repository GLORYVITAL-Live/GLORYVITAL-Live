-- งบรายเดือนของกลุ่มภายนอก (Agency TDH / Agency Infinite / MCN) ในหน้า Plan Slot Live
--   ก้อนเดียวต่อกลุ่มต่อเดือน · ไม่มีแถว = ยังไม่ตั้งงบ · เก็บในเว็บ ไม่ลงชีต (src/lib/agency-budget.ts)

create table if not exists public.agency_budgets (
  agency     text not null,
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  amount     numeric not null check (amount > 0),
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (agency, month)
);
alter table public.agency_budgets enable row level security;

notify pgrst, 'reload schema';
