-- สิทธิ์ Owner: หน้า Plan Slot Live (แพลน slot ทั้งเดือน แล้วเขียนลงแท็บ "ลงตาราง Deal Mc" / "ลงตาราง Admin เสริม")
--   ติ๊กที่หน้าเจ้าของ > พนักงาน > Owner > "Plan Slot Live" (ติ๊กให้คนอื่นได้เฉพาะคนที่มีสิทธิ์นี้อยู่แล้ว)
--   ค่าเริ่มต้น: เปิดให้บัญชี kunraroj.d@glorythailand.com

alter table public.staff
  add column if not exists can_plan_slots boolean not null default false;

update public.staff set can_plan_slots = true
 where role = 'owner' and lower(email) = 'kunraroj.d@glorythailand.com';

-- แพลน slot ของ Agency (เช่น TDH ไลฟ์ผ่านช่อง GLORY MALL) ไว้ดูภาพรวม / สรุปชั่วโมงในหน้า Plan Slot Live
--   ไม่เขียนลงชีต และไม่เกี่ยวกับ slot ของ Mc / Admin (Agency หาคนไลฟ์เอง)
--   เวลาจบก่อนเวลาเริ่ม = ข้ามเที่ยงคืน (นับเป็นวันไลฟ์เดิม เหมือนในชีต)
create table if not exists public.agency_slots (
  id          bigint generated always as identity primary key,
  agency      text not null,
  platform    text not null,
  live_date   date not null,
  start_time  time not null,
  end_time    time not null,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  unique (agency, platform, live_date, start_time, end_time)
);
create index if not exists agency_slots_date_idx on public.agency_slots (live_date);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.agency_slots enable row level security;

notify pgrst, 'reload schema';
