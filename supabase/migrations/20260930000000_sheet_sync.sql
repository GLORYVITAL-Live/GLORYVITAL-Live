-- ซิงค์สองทางกับ Google Sheet "LIVE GLORY 2026"
--
--   เว็บ -> ชีต: ทุกครั้งที่ slot เปลี่ยน (จอง/ยกเลิก/รับคิว/Owner แก้/สร้าง) trigger ด้านล่างจดงานลง sheet_jobs
--                แล้ว Next.js เขียนแถวนั้นลงชีต (จับคู่ด้วยรหัส slot ในคอลัมน์ V)
--   ชีต -> เว็บ: Apps Script ในชีตส่งเลขแถวที่ถูกแก้มาที่ /api/sync/sheet แล้ว Next.js อ่านแถวนั้นมาอัปเดต DB
--
-- sync_locks กันไม่ให้หลายคำขอเขียน/แทรกแถวในชีตพร้อมกัน (เลขแถวจะเลื่อนผิด)

create table public.sheet_jobs (
  id         bigint generated always as identity primary key,
  slot_table text not null check (slot_table in ('mc_slots', 'admin_slots')),
  slot_id    bigint not null,
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index sheet_jobs_pending_idx on public.sheet_jobs (created_at) where done_at is null;
alter table public.sheet_jobs enable row level security;

create table public.sync_locks (
  name         text primary key,
  locked_until timestamptz not null default 'epoch',
  holder       text
);
alter table public.sync_locks enable row level security;

-- ขอล็อกแบบมีเวลาหมดอายุ (ถ้าคนถือล็อกค้าง ล็อกจะหลุดเองเมื่อครบเวลา)
create or replace function public.try_sync_lock(p_name text, p_seconds int, p_holder text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.sync_locks (name) values (p_name) on conflict do nothing;
  update public.sync_locks
     set locked_until = now() + make_interval(secs => p_seconds), holder = p_holder
   where name = p_name and locked_until < now();
  return found;
end $$;

create or replace function public.release_sync_lock(p_name text, p_holder text)
returns void
language sql security definer set search_path = public as $$
  update public.sync_locks set locked_until = 'epoch', holder = null where name = p_name and holder = p_holder
$$;

-- จดงานเขียนชีตเมื่อข้อมูลที่แสดงในชีตเปลี่ยน (ไม่นับคอลัมน์ที่ระบบใช้เอง เช่น event ปฏิทิน)
create or replace function public.enqueue_sheet_job()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  internal text[] := array['calendar_email', 'calendar_event_id', 'updated_at', 'starts_at', 'ends_at',
                           'sheet_row', 'is_cancelled', 'needs_extra_admin', 'created_at'];
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - internal) = (to_jsonb(new) - internal) then
    return new;
  end if;
  insert into public.sheet_jobs (slot_table, slot_id) values (tg_table_name, new.id);
  return new;
end $$;

create trigger mc_slots_sheet_job after insert or update on public.mc_slots
  for each row execute function public.enqueue_sheet_job();
create trigger admin_slots_sheet_job after insert or update on public.admin_slots
  for each row execute function public.enqueue_sheet_job();

revoke all on function public.try_sync_lock(text, int, text) from public, anon, authenticated;
revoke all on function public.release_sync_lock(text, text) from public, anon, authenticated;
