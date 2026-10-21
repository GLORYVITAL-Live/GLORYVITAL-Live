-- หน้าเทรนนิ่ง: ประวัติการเข้าชม (Owner ที่จัดการได้ดูในแท็บ "ผู้เข้าชม")
--   kind: 'page' = เปิดหน้าเทรนนิ่ง · 'video' = กดเล่นคลิป (ref / title) · 'slides' = เปิดสไลด์บรีฟ
--   ครั้งเดียวกันไม่บันทึกซ้ำภายใน 30 นาที (คนเดิม + เรื่องเดิม)
create table if not exists public.training_views (
  id          bigint generated always as identity primary key,
  email       text not null,
  who         text not null default '',       -- ชื่อที่แสดงตอนเข้าชม เช่น 'Mc ปิ่น'
  role        text not null default '',       -- mc / admin / owner / marketing
  kind        text not null check (kind in ('page', 'video', 'slides')),
  ref         text,                           -- คลิป ('drive:<id>' / 'youtube:<id>')
  title       text,                           -- ชื่อคลิปตอนเล่น
  created_at  timestamptz not null default now()
);
create index if not exists training_views_created_idx on public.training_views (created_at desc);
create index if not exists training_views_email_idx on public.training_views (email, kind, created_at desc);
alter table public.training_views enable row level security;
