-- Forecast ค่าใช้จ่ายรายเดือนที่ล็อคแล้ว (แท็บ "Sum 2" ในชีตของทีม · src/lib/cost-forecast.ts)
--   ก่อนล็อค เว็บอัปเดตคอลัมน์ Forecast ของเดือนหน้าตามแพลนทุกวัน · ล็อคสิ้นวันที่ 20 ของเดือนก่อนหน้า (หรือกดล็อคเองก่อน)
--   ล็อคแล้ว = เก็บตัวเลขชุดนั้นไว้ที่นี่ หน้า Cost ใช้ชุดนี้ และเว็บไม่แตะคอลัมน์ Forecast ของเดือนนั้นอีก

create table if not exists public.cost_forecasts (
  month      text primary key,                 -- "YYYY-MM"
  entries    jsonb not null default '[]'::jsonb, -- [{ app, owner, kind, forecast, forecastHours }]
  total      numeric not null default 0,       -- เงินรวม (บาท)
  hours      numeric not null default 0,       -- ชั่วโมงไลฟ์รวม (ไม่นับชั่วโมง Admin)
  locked_at  timestamptz not null default now(),
  locked_by  text not null default ''          -- อีเมลคนที่กดล็อค · ว่าง = ล็อคอัตโนมัติ
);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.cost_forecasts enable row level security;

notify pgrst, 'reload schema';
