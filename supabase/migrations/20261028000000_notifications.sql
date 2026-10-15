-- แจ้งเตือนในเว็บ (กระดิ่ง) + แจ้งเตือนเด้งเข้ามือถือ (Web Push)
--   notifications       = รายการแจ้งเตือนของแต่ละคน (ผูกกับอีเมลที่ login) อ่านแล้ว = read_at
--     dedupe_key         = กันส่งซ้ำ เช่น เตือนก่อนไลฟ์ของ slot เดียวกัน (ว่าง = ไม่กัน)
--   push_subscriptions  = เครื่องที่กดเปิดแจ้งเตือนบนมือถือ / เบราว์เซอร์ (1 เครื่อง = 1 แถว)

create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  email       text not null,
  kind        text not null,               -- booked / cancelled / slot_open / changed / reminder / open_soon / test
  title       text not null,
  body        text not null default '',
  page        text,                        -- หน้าที่เปิดเมื่อกด (home / owner / mc / admin)
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  constraint notifications_dedupe unique (email, dedupe_key)
);
create index if not exists notifications_email_idx on public.notifications (email, created_at desc);

create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  email       text not null,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text not null default '',
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_email_idx on public.push_subscriptions (email);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

notify pgrst, 'reload schema';
