-- สถิติไลฟ์ TikTok / Shopee (หน้า "สถิติไลฟ์" ของ Owner)
--   live_sessions  = ไลฟ์ละ 1 แถว จากไฟล์ Export ที่อัปโหลด (อัปไฟล์เดิมซ้ำ = อัปเดตแถวเดิม ไม่นับซ้ำ)
--   live_campaigns = ช่วงวัน+เวลาของแคมเปญ เทียบกับแคมเปญที่เลือก หรือช่วงเดียวกันของเดือนก่อน
--   ตัวเลขหลัก: TikTok GMV = LIVE-attributed GMV, ออเดอร์ = Orders Paid
--               Shopee GMV / ออเดอร์ / ชิ้น = คำสั่งซื้อที่ยืนยันแล้ว
--   คอลัมน์อื่นในไฟล์เก็บไว้ใน raw (ชื่อคอลัมน์ตามไฟล์)

create table if not exists public.live_sessions (
  id              bigint generated always as identity primary key,
  platform        text not null check (platform in ('TikTok', 'Shopee')),
  account_id      text not null,             -- TikTok Creator ID / Shopee User Id
  account_name    text not null default '',
  title           text not null default '',  -- ชื่อไลฟ์ (Shopee)
  started_at      timestamptz not null,
  duration_sec    integer not null default 0,
  gmv             numeric(14, 2) not null default 0,
  orders          integer not null default 0,
  items_sold      integer not null default 0,
  customers       integer,                   -- TikTok เท่านั้น
  viewers         integer not null default 0,
  views           integer,                   -- TikTok เท่านั้น
  engaged_viewers integer,                   -- Shopee เท่านั้น
  avg_view_sec    integer,
  comments        integer,
  shares          integer,
  likes           integer,
  new_followers   integer,
  add_to_cart     integer,                   -- Shopee เท่านั้น
  impressions     integer,                   -- TikTok Product Impressions
  clicks          integer,                   -- TikTok Product Clicks
  raw             jsonb not null default '{}'::jsonb,
  source_file     text not null default '',
  uploaded_by     text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (platform, account_id, started_at)
);
create index if not exists live_sessions_started_idx on public.live_sessions (started_at);

create table if not exists public.live_campaigns (
  id          bigint generated always as identity primary key,
  name        text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  compare_id  bigint references public.live_campaigns (id) on delete set null, -- null = ช่วงเดียวกันของเดือนก่อน
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists live_campaigns_starts_idx on public.live_campaigns (starts_at);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.live_sessions enable row level security;
alter table public.live_campaigns enable row level security;

-- เดือนที่มีข้อมูลแล้ว (หน้าอัปโหลด) security_invoker = ใช้สิทธิ์ของคนเรียก ตาราง live_sessions ยังปิดอยู่
create or replace view public.live_session_months with (security_invoker = true) as
select
  to_char(started_at at time zone 'Asia/Bangkok', 'YYYY-MM') as month,
  platform,
  count(*)::int as lives,
  sum(gmv)      as gmv
from public.live_sessions
group by 1, 2;

notify pgrst, 'reload schema';
