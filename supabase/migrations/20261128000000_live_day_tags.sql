-- ป้ายวันต่อแพลตฟอร์ม (หน้าสถิติไลฟ์ > วันปกติ vs วันแคมเปญ · src/lib/live-days.ts)
--   นำเข้าจากชีตของทีม: Shopee = คอลัมน์ remark แท็บ "GLORY Shopee " · TikTok = คอลัมน์หมายเหตุ แท็บ "GLORY TIKTOK"
--   kind: bau = วันปกติ · teasing = ก่อนแคมเปญ · dday = วันแคมเปญ · payday · extend = หลังแคมเปญ · other = อื่นๆ (JBP / NPD ...)
--   ไม่มีแถว = ไม่มีข้อมูลป้ายของวันนั้น (ไม่นับในการเทียบ)
create table if not exists public.live_day_tags (
  platform   text not null check (platform in ('TikTok', 'Shopee')),
  day        date not null,
  kind       text not null check (kind in ('bau', 'teasing', 'dday', 'payday', 'extend', 'other')),
  label      text not null default '',
  updated_at timestamptz not null default now(),
  primary key (platform, day)
);
alter table public.live_day_tags enable row level security;

notify pgrst, 'reload schema';
