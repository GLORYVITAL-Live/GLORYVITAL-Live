-- สิทธิ์จองคิวของ Mc ต่อเดือน ตามแร็งค์ผลงานเดือนก่อน (src/lib/mc-quota.ts / src/lib/mc-quota-db.ts)
--   A = 15–25 slot · B = 7–15 slot (ไล่ตามคะแนน) · C / ยังไม่มีอันดับ = 6 slot · + สิทธิ์เพิ่มพิเศษที่ Owner ตั้งเอง
--   Mc ประจำ (เงินเดือน) ไม่จำกัด · เปิด / ปิดทั้งระบบที่ settings.mc_quota_on (ค่าเริ่มต้น = ปิด)

-- แร็งค์ + สิทธิ์ของแต่ละ Mc ต่อเดือน (คำนวณจากผลงานเดือนก่อน — อัปเดตเองจนเดือนก่อนจบ + 3 วัน)
create table if not exists public.mc_quota (
  month       text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  staff_id    bigint not null references public.staff(id) on delete cascade,
  tier        text check (tier in ('A', 'B', 'C')), -- null = ยังไม่มีอันดับ (ชม. ที่มียอดน้อยกว่า 8)
  score       numeric,
  hours       numeric not null default 0,
  auto_quota  int not null,
  extra       int not null default 0 check (extra between -100 and 200),
  note        text not null default '',
  computed_at timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (month, staff_id)
);
-- อ่าน / เขียนจากเซิร์ฟเวอร์ (service role) เท่านั้น
alter table public.mc_quota enable row level security;

-- Owner ที่ติ๊กให้ตั้งสิทธิ์จองเพิ่มพิเศษได้ (Owner ที่จัดการได้ทั้ง Mc + Admin ตั้งได้อยู่แล้ว)
alter table public.staff add column if not exists can_manage_quota boolean not null default false;
-- เปิดใช้การจำกัดสิทธิ์จองต่อเดือน
alter table public.settings add column if not exists mc_quota_on boolean not null default false;

-- ------------------ Mc จองคิว: + สิทธิ์จองต่อเดือน ------------------
-- p_month_max = {"2026-11": 12, ...} จำนวน slot สูงสุดของเดือนนั้น (นับรวมคิวที่มีอยู่แล้ว) · ไม่มีเดือนนั้น / null = ไม่จำกัด
-- กฎอื่นเหมือน 20261019000000_book_until ทุกอย่าง

drop function if exists public.book_mc_slots(bigint, bigint[], date);

create or replace function public.book_mc_slots(p_mc_id bigint, p_slot_ids bigint[], p_until date default null, p_month_max jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg      public.settings;
  cutoff   date := coalesce(p_until, public.schedule_cutoff_date());
  results  jsonb := '[]'::jsonb;
  sid      bigint;
  s        public.mc_slots;
  clash    public.mc_slots;
  used_n   int;
  used_h   numeric;
  m_key    text;
  m_max    int;
  m_used   int;
begin
  perform pg_advisory_xact_lock(hashtext('glory_booking'));
  select * into cfg from public.settings where id = 1;

  foreach sid in array p_slot_ids loop
    if cfg.site_notice <> '' then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message', 'ระบบปิดรับจองชั่วคราว: ' || cfg.site_notice);
      continue;
    end if;

    select * into s from public.mc_slots where id = sid for update;
    if found and s.mc_id is null and s.live_date >= public.bkk_today() and cutoff is not null and s.live_date > cutoff then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message', 'วันนี้ยังไม่เปิดให้จอง (เกินช่วงเปิดจอง)');
      continue;
    end if;
    if not found or s.mc_id is not null or s.live_date < public.bkk_today() then
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

    -- สิทธิ์จองของเดือนนั้น (slot ที่จองสำเร็จก่อนหน้าในคำขอนี้นับแล้ว)
    m_key := to_char(s.live_date, 'YYYY-MM');
    if p_month_max is not null and p_month_max ? m_key then
      m_max := (p_month_max ->> m_key)::int;
      select count(*) into m_used from public.mc_slots x
      where x.mc_id = p_mc_id and not x.is_cancelled and x.confirmed is distinct from false
        and x.live_date >= date_trunc('month', s.live_date)::date
        and x.live_date < (date_trunc('month', s.live_date) + interval '1 month')::date;
      if m_used + 1 > m_max then
        results := results || jsonb_build_object('id', sid, 'success', false, 'message',
          format('ครบสิทธิ์จองของเดือน %s แล้ว (%s slot)', to_char(s.live_date, 'MM/YYYY'), m_max));
        continue;
      end if;
    end if;

    update public.mc_slots set mc_id = p_mc_id, confirmed = true where id = sid;
    insert into public.calendar_jobs (slot_table, slot_id) values ('mc_slots', sid);
    results := results || jsonb_build_object('id', sid, 'success', true, 'message', 'จองสำเร็จ');
  end loop;

  return results;
end $$;

-- เรียกได้จากเซิร์ฟเวอร์ (service role) เท่านั้น
revoke all on function public.book_mc_slots(bigint, bigint[], date, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
