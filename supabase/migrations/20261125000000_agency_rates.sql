-- เรทต่อชั่วโมงของกลุ่มภายนอก (Agency TDH / Agency Infinite / MCN) ในหน้า Plan Slot Live
--   ต่อกลุ่มต่อเดือน · งบของเดือน = เรท × ชั่วโมงในแพลน · ไม่มีแถว = ยังไม่ตั้งเรท (src/lib/agency-budget.ts)
--   แทนตาราง agency_budgets (งบก้อนรายเดือน) ค่าที่ใส่ไว้เดิมย้ายมาเป็นเรท

create table if not exists public.agency_rates (
  agency     text not null,
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  rate       numeric not null check (rate > 0),
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (agency, month)
);
alter table public.agency_rates enable row level security;

insert into public.agency_rates (agency, month, rate, updated_by, updated_at)
select agency, month, amount, updated_by, updated_at from public.agency_budgets
on conflict (agency, month) do nothing;

notify pgrst, 'reload schema';
