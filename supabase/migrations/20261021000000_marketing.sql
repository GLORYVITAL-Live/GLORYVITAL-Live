-- บัญชี Marketing: เข้าเว็บแล้วเห็นแค่หน้า "CEO Live" (ดูอย่างเดียว)
--   ยอดทั้งวันของวันที่มี CEO Live เทียบวันก่อน + ข้อมูลรอบ CEO ที่ track แยก · ข้อมูลวันอื่นไม่ถูกส่งไปที่เครื่องของ Marketing
--   เพิ่ม / แก้ / ลบ รายชื่อได้ที่หน้าพนักงาน > Marketing (Owner ที่จัดการได้ทั้ง Mc และ Admin)

-- เพิ่มบทบาท 'marketing' (ลบเงื่อนไขบทบาทเดิมก่อน ไม่ว่าจะตั้งชื่อไว้อย่างไร)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.staff drop constraint %I', c);
  end loop;
end $$;

alter table public.staff add constraint staff_role_check check (role in ('mc', 'admin', 'owner', 'marketing'));

-- ข้อมูล "รอบ CEO Live" ที่ track แยก (ช่วงที่ CEO ไลฟ์ ซึ่งไฟล์ Export แยกให้ไม่ได้ เพราะอยู่ในไลฟ์ยาวไลฟ์เดียว)
--   Owner ที่จัดการ Data analytics ได้ อัปโหลด / วางจากชีตที่หน้า CEO Live · วันละ 1 รอบ (อัปซ้ำ = แทนที่ของวันนั้น)
--   ctr / co เก็บเป็นสัดส่วน (0.2436 = 24.36%)
create table if not exists public.ceo_sessions (
  id            bigint generated always as identity primary key,
  live_date     date not null unique,
  title         text not null default '',   -- ชื่อในชีต เช่น "ceo live" / "durian"
  time_range    text not null default '',   -- ช่วงเวลา เช่น "11.50-13.40"
  duration_hr   numeric(6, 2),
  gmv           numeric(14, 2),
  orders        integer,
  viewers       integer,
  views         integer,
  peak_viewers  integer,
  peak_time     text not null default '',   -- เช่น "11.59/258"
  impressions   integer,
  ctr           numeric(9, 6),
  co            numeric(9, 6),
  updated_by    text not null default '',
  updated_at    timestamptz not null default now()
);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.ceo_sessions enable row level security;

notify pgrst, 'reload schema';
