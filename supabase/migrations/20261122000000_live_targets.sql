-- เป้า GMV รายเดือนต่อช่องไลฟ์ (หน้าสถิติไลฟ์ > ภาพรวม · src/lib/live-targets.ts)
--   monthly = เป้าเดือน (บาท) · days = เป้ารายวันที่ใส่เอง {"2026-11-11": 5000000} วันที่เหลือเฉลี่ยจากยอดที่เหลือ

create table if not exists public.live_targets (
  platform   text not null,
  account_id text not null,
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  monthly    numeric not null check (monthly > 0),
  days       jsonb not null default '{}'::jsonb,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (platform, account_id, month)
);
alter table public.live_targets enable row level security;

notify pgrst, 'reload schema';
