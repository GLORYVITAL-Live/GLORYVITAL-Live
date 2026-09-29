-- GLORY VITAL Live — โครงสร้างฐานข้อมูล (ย้ายจาก Google Sheet "LIVE GLORY 2026")
--
-- แท็บเดิม -> ตารางใหม่
--   Mc Email / Admin Email / Owner Email / เบอร์โทร MC  -> staff
--   การตั้งค่าเว็บ                                     -> settings
--   ลงตาราง Deal Mc                                   -> mc_slots
--   ลงตาราง Admin เสริม                               -> admin_slots
--   Log การจอง                                        -> booking_logs
--   (คิวลงปฏิทินใน Script Properties)                 -> calendar_jobs
--
-- ทุกตารางเปิด RLS และไม่มี policy: browser อ่าน/เขียนตรงไม่ได้
-- ทุกคำขอผ่าน API ของ Next.js ที่ตรวจตัวตนแล้วใช้ service role เท่านั้น

set check_function_bodies = off;

-- ------------------ คน ------------------

create table public.staff (
  id             bigint generated always as identity primary key,
  role           text not null check (role in ('mc', 'admin', 'owner')),
  name           text not null,              -- Mc: ไม่มีคำว่า "Mc" นำหน้า (เช่น "มะนาว")
  email          text,                       -- ตัวพิมพ์เล็กเสมอ ว่าง = login ไม่ได้ (เช่นรายชื่อเก่าในประวัติ)
  phone          text,
  hourly_rate    numeric,                    -- ว่าง = ใช้ค่าเริ่มต้นใน settings
  is_extra_admin boolean not null default false, -- Admin เสริม: รับ/ยกเลิกคิวผ่านเว็บได้
  created_at     timestamptz not null default now(),
  unique (role, name),
  check (email is null or email = lower(btrim(email)))
);
create unique index staff_role_email_key on public.staff (role, email) where email is not null;
create index staff_email_idx on public.staff (email);

-- ------------------ ตั้งค่า (แถวเดียว) ------------------

create table public.settings (
  id                      int primary key default 1 check (id = 1),
  site_notice             text not null default '',  -- ไม่ว่าง = ปิดรับจองชั่วคราว (เดิม B1)
  schedule_cutoff_month   text check (schedule_cutoff_month ~ '^\d{4}-\d{2}$'), -- เดือนสุดท้ายที่เปิดจอง (B2)
  schedule_notice         text not null default '',  -- ข้อความแทนค่าเริ่มต้น (B3)
  admin_chat_url          text not null default '',  -- ลิงก์แชทแอดมิน (B4)
  default_mc_rate         numeric not null default 0, -- (B5)
  default_admin_rate      numeric not null default 0, -- (B6)
  cancel_min_hours        numeric not null default 6,
  mc_max_slots_per_day    int not null default 2,
  mc_max_hours_per_day    numeric not null default 4,
  admin_max_slots_per_day int not null default 2,
  max_per_request         int not null default 10
);
insert into public.settings (id) values (1);

-- ------------------ slot ------------------

-- เวลาเริ่ม/จบจริง (รองรับ slot ข้ามเที่ยงคืน เช่น 23:30–02:30) คำนวณให้อัตโนมัติ เวลาไทย
create or replace function public.set_slot_times() returns trigger
language plpgsql as $$
begin
  new.platform := btrim(coalesce(new.platform, ''));
  new.starts_at := (new.live_date + new.start_time) at time zone 'Asia/Bangkok';
  new.ends_at := (new.live_date + new.end_time
    + case when new.end_time <= new.start_time then interval '1 day' else interval '0' end) at time zone 'Asia/Bangkok';
  new.updated_at := now();
  return new;
end $$;

create table public.mc_slots (
  id                bigint generated always as identity primary key,
  platform          text not null default '',
  live_date         date not null,
  start_time        time not null,
  end_time          time not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  campaign          text not null default '',
  mc_id             bigint references public.staff (id),
  confirmed         boolean,                  -- เดิมคอลัมน์ J: false = ไม่นับ/ลบ event, ว่าง = ปกติ
  status            text not null default '', -- เดิมคอลัมน์ K เช่น "เรียบร้อย", "แคน"
  remark            text not null default '',
  is_cancelled      boolean generated always as (status ~* '(แคน|ยกเลิก|cancel)') stored,
  calendar_email    text,                     -- ปฏิทินที่ event อยู่ (ใช้ลบได้แม้ Mc ถูกเอาออกแล้ว)
  calendar_event_id text,
  sheet_row         int unique,               -- เลขแถวในชีตเดิม (ใช้ตอนนำเข้าซ้ำ)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger mc_slots_times before insert or update on public.mc_slots
  for each row execute function public.set_slot_times();
create index mc_slots_open_idx on public.mc_slots (live_date) where mc_id is null;
create index mc_slots_mc_idx on public.mc_slots (mc_id, live_date);
create index mc_slots_key_idx on public.mc_slots (platform, starts_at, ends_at);

create table public.admin_slots (
  id                bigint generated always as identity primary key,
  platform          text not null default '',
  live_date         date not null,
  start_time        time not null,
  end_time          time not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  admin_id          bigint references public.staff (id),
  confirmed         boolean,                  -- เดิมคอลัมน์ I
  remark            text not null default '', -- เดิมคอลัมน์ J
  needs_extra_admin boolean generated always as (btrim(remark) = 'Admin เสริม') stored,
  status            text not null default '', -- เดิมคอลัมน์ K
  is_cancelled      boolean generated always as (status ~* '(แคน|ยกเลิก|cancel)') stored,
  calendar_email    text,
  calendar_event_id text,
  sheet_row         int unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger admin_slots_times before insert or update on public.admin_slots
  for each row execute function public.set_slot_times();
create index admin_slots_open_idx on public.admin_slots (live_date) where admin_id is null and needs_extra_admin;
create index admin_slots_admin_idx on public.admin_slots (admin_id, live_date);
create index admin_slots_key_idx on public.admin_slots (platform, starts_at, ends_at);

-- ------------------ ประวัติ + คิวปฏิทิน ------------------

create table public.booking_logs (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  email      text,
  role       text,
  name       text,
  action     text,
  slot_table text,
  slot_id    bigint,
  platform   text,
  live_date  date,
  time_range text,
  result     text
);

-- งานลงปฏิทินที่รอทำ (ทำเบื้องหลังหลังตอบผู้ใช้แล้ว + cron เก็บตกทุก 1–5 นาที)
create table public.calendar_jobs (
  id         bigint generated always as identity primary key,
  slot_table text not null check (slot_table in ('mc_slots', 'admin_slots')),
  slot_id    bigint not null,
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index calendar_jobs_pending_idx on public.calendar_jobs (created_at) where done_at is null;

alter table public.staff enable row level security;
alter table public.settings enable row level security;
alter table public.mc_slots enable row level security;
alter table public.admin_slots enable row level security;
alter table public.booking_logs enable row level security;
alter table public.calendar_jobs enable row level security;

-- ------------------ ตัวช่วย ------------------

create or replace function public.bkk_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

-- วันสุดท้ายที่เปิดจอง (สิ้นเดือนของ schedule_cutoff_month) null = ไม่จำกัด
create or replace function public.schedule_cutoff_date() returns date
language sql stable as $$
  select (to_date(schedule_cutoff_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
  from public.settings where id = 1 and schedule_cutoff_month is not null
$$;

create or replace function public.fmt_hm(t time) returns text
language sql immutable as $$ select to_char(t, 'HH24:MI') $$;

create or replace function public.slot_hours(s timestamptz, e timestamptz) returns numeric
language sql immutable as $$ select extract(epoch from (e - s)) / 3600.0 $$;

-- ------------------ Mc จองคิว ------------------
-- ตรวจซ้ำทุกกฎฝั่ง server ภายใต้ล็อกเดียวกัน (แทน LockService) คืนผลทีละ slot

create or replace function public.book_mc_slots(p_mc_id bigint, p_slot_ids bigint[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg      public.settings;
  cutoff   date := public.schedule_cutoff_date();
  results  jsonb := '[]'::jsonb;
  sid      bigint;
  s        public.mc_slots;
  clash    public.mc_slots;
  used_n   int;
  used_h   numeric;
begin
  perform pg_advisory_xact_lock(hashtext('glory_booking'));
  select * into cfg from public.settings where id = 1;

  foreach sid in array p_slot_ids loop
    if cfg.site_notice <> '' then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message', 'ระบบปิดรับจองชั่วคราว: ' || cfg.site_notice);
      continue;
    end if;

    select * into s from public.mc_slots where id = sid for update;
    if not found or s.mc_id is not null or s.live_date < public.bkk_today()
       or (cutoff is not null and s.live_date > cutoff) then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message', 'slot นี้ไม่เปิดให้จองแล้ว (อาจมีคนจองไปก่อน)');
      continue;
    end if;

    select * into clash from public.mc_slots x
    where x.mc_id = p_mc_id and x.id <> s.id and not x.is_cancelled and x.confirmed is distinct from false
      and x.starts_at < s.ends_at and x.ends_at > s.starts_at
    limit 1;
    if found then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message',
        format('เวลาทับกับคิวเดิม (%s %s-%s)', clash.platform, fmt_hm(clash.start_time), fmt_hm(clash.end_time)));
      continue;
    end if;

    select count(*), coalesce(sum(slot_hours(x.starts_at, x.ends_at)), 0) into used_n, used_h
    from public.mc_slots x
    where x.mc_id = p_mc_id and x.live_date = s.live_date and not x.is_cancelled and x.confirmed is distinct from false;
    if used_n + 1 > cfg.mc_max_slots_per_day then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message', format('เกินโควต้า %s slot/วัน', cfg.mc_max_slots_per_day));
      continue;
    end if;
    if used_h + slot_hours(s.starts_at, s.ends_at) > cfg.mc_max_hours_per_day then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message', format('เกินโควต้า %s ชม./วัน', cfg.mc_max_hours_per_day));
      continue;
    end if;

    update public.mc_slots set mc_id = p_mc_id, confirmed = true where id = sid;
    insert into public.calendar_jobs (slot_table, slot_id) values ('mc_slots', sid);
    results := results || jsonb_build_object('id', sid, 'success', true, 'message', 'จองสำเร็จ');
  end loop;

  return results;
end $$;

-- ------------------ Admin เสริมรับคิว ------------------
-- กฎ: ห้ามเวลาทับ, สูงสุด N slot/วัน, 2 slot ในวันเดียวกันต้องต่อเนื่องกัน

create or replace function public.assign_admin_slots(p_admin_id bigint, p_slot_ids bigint[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg     public.settings;
  cutoff  date := public.schedule_cutoff_date();
  results jsonb := '[]'::jsonb;
  s       public.admin_slots;
  clash   public.admin_slots;
  same    public.admin_slots;
  same_n  int;
begin
  perform pg_advisory_xact_lock(hashtext('glory_booking'));
  select * into cfg from public.settings where id = 1;

  -- เรียงตามเวลา ให้ 2 slot ที่ต่อกันในคำขอเดียวผ่านกฎ "ต้องต่อเนื่องกัน"
  for s in
    select * from public.admin_slots where id = any (p_slot_ids) order by starts_at for update
  loop
    if cfg.site_notice <> '' then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message', 'ระบบปิดรับจัดคิวชั่วคราว: ' || cfg.site_notice);
      continue;
    end if;
    if s.admin_id is not null or not s.needs_extra_admin or s.live_date < public.bkk_today()
       or (cutoff is not null and s.live_date > cutoff) then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message', 'slot นี้ไม่ได้รอ Admin แล้ว (อาจมีคนรับไปก่อน)');
      continue;
    end if;

    select * into clash from public.admin_slots x
    where x.admin_id = p_admin_id and x.id <> s.id and x.live_date = s.live_date and not x.is_cancelled
      and x.confirmed is distinct from false and x.starts_at < s.ends_at and x.ends_at > s.starts_at
    limit 1;
    if found then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message',
        format('เวลาทับกับคิวเดิม (%s-%s)', fmt_hm(clash.start_time), fmt_hm(clash.end_time)));
      continue;
    end if;

    select count(*) into same_n from public.admin_slots x
    where x.admin_id = p_admin_id and x.id <> s.id and x.live_date = s.live_date and not x.is_cancelled
      and x.confirmed is distinct from false;
    if same_n >= cfg.admin_max_slots_per_day then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message', format('มีคิวครบ %s slot ในวันนี้แล้ว', cfg.admin_max_slots_per_day));
      continue;
    end if;
    if same_n = 1 then
      select * into same from public.admin_slots x
      where x.admin_id = p_admin_id and x.id <> s.id and x.live_date = s.live_date and not x.is_cancelled
        and x.confirmed is distinct from false;
      if not (s.starts_at = same.ends_at or s.ends_at = same.starts_at) then
        results := results || jsonb_build_object('id', s.id, 'success', false, 'message', 'มีคิวในวันนี้แล้ว slot ที่ 2 ต้องต่อเนื่องกัน');
        continue;
      end if;
    end if;

    update public.admin_slots set admin_id = p_admin_id, confirmed = true where id = s.id;
    insert into public.calendar_jobs (slot_table, slot_id) values ('admin_slots', s.id);
    results := results || jsonb_build_object('id', s.id, 'success', true, 'message', 'รับคิวแล้ว ระบบจะลงปฏิทินให้ภายใน 1–2 นาที');
  end loop;

  -- id ที่ไม่มีอยู่จริง
  results := results || coalesce((
    select jsonb_agg(jsonb_build_object('id', x, 'success', false, 'message', 'slot นี้ไม่ได้รอ Admin แล้ว (อาจมีคนรับไปก่อน)'))
    from unnest(p_slot_ids) x where not exists (select 1 from public.admin_slots a where a.id = x)
  ), '[]'::jsonb);
  return results;
end $$;

-- ------------------ ยกเลิกคิว (Mc / Admin เสริม) ------------------

create or replace function public.cancel_slot(p_table text, p_person_id bigint, p_slot_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg      public.settings;
  owner_id bigint;
  st       timestamptz;
  cancelled boolean;
begin
  perform pg_advisory_xact_lock(hashtext('glory_booking'));
  select * into cfg from public.settings where id = 1;

  if p_table = 'mc_slots' then
    select mc_id, starts_at, is_cancelled into owner_id, st, cancelled from public.mc_slots where id = p_slot_id for update;
  elsif p_table = 'admin_slots' then
    select admin_id, starts_at, is_cancelled into owner_id, st, cancelled from public.admin_slots where id = p_slot_id for update;
  else
    return jsonb_build_object('ok', false, 'message', 'ข้อมูล slot ไม่ถูกต้อง');
  end if;

  if owner_id is distinct from p_person_id then
    return jsonb_build_object('ok', false, 'message', 'slot นี้ไม่ใช่คิวของคุณ');
  end if;
  if cancelled then
    return jsonb_build_object('ok', false, 'message', 'คิวนี้ถูกยกเลิกไปแล้ว');
  end if;
  if extract(epoch from (st - now())) / 3600.0 < cfg.cancel_min_hours then
    return jsonb_build_object('ok', false, 'message',
      format('ยกเลิกผ่านเว็บได้ก่อนเวลาไลฟ์อย่างน้อย %s ชั่วโมงเท่านั้น กรุณาติดต่อแอดมินโดยตรง', cfg.cancel_min_hours));
  end if;

  if p_table = 'mc_slots' then
    update public.mc_slots set mc_id = null, confirmed = false where id = p_slot_id;
  else
    update public.admin_slots set admin_id = null, confirmed = false where id = p_slot_id;
  end if;
  insert into public.calendar_jobs (slot_table, slot_id) values (p_table, p_slot_id);
  return jsonb_build_object('ok', true, 'message', 'ยกเลิกคิวแล้ว');
end $$;

revoke all on function public.book_mc_slots(bigint, bigint[]) from public, anon, authenticated;
revoke all on function public.assign_admin_slots(bigint, bigint[]) from public, anon, authenticated;
revoke all on function public.cancel_slot(text, bigint, bigint) from public, anon, authenticated;
