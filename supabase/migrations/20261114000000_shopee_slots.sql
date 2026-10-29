-- หน้าจองคิว Shopee: slot ของแท็บ "ลงตาราง MC Shopee" (ซิงค์สองทางเหมือน Deal Mc) เก็บใน mc_slots
--   mc_slots.sheet_tab = แท็บที่ slot นี้อยู่ ('mc' = ลงตาราง Deal Mc / 'shopee' = ลงตาราง MC Shopee) ไม่มีแถวคู่ฝั่ง Admin
--   ทีมไลฟ์ของ Mc / Admin เพิ่ม 'both' = TikTok + Shopee (จองได้ทั้งสองหน้า)
--   กฎการจองของ Shopee แยกจาก TikTok: ช่วงเปิดจอง (book_window_shopee) + จำนวน slot / ชม. ต่อวัน (นับเฉพาะคิว Shopee)

alter table public.mc_slots add column if not exists sheet_tab text not null default 'mc';
alter table public.mc_slots drop constraint if exists mc_slots_sheet_tab_check;
alter table public.mc_slots add constraint mc_slots_sheet_tab_check check (sheet_tab in ('mc', 'shopee'));
create index if not exists mc_slots_sheet_tab_date_idx on public.mc_slots (sheet_tab, live_date);

alter table public.staff drop constraint if exists staff_live_platform_check;
alter table public.staff add constraint staff_live_platform_check check (live_platform in ('tiktok', 'shopee', 'both'));

alter table public.settings add column if not exists book_window_shopee jsonb;
alter table public.settings add column if not exists shopee_max_slots_per_day int not null default 2;
alter table public.settings add column if not exists shopee_max_hours_per_day numeric not null default 6;

-- ------------------ Mc จองคิว: นับโควต้าต่อวัน / สิทธิ์ต่อเดือน แยกตามแท็บของ slot ------------------
-- slot Shopee ใช้ shopee_max_slots_per_day / shopee_max_hours_per_day และนับเฉพาะคิว Shopee ของวันนั้น
-- slot TikTok นับเฉพาะคิว TikTok (สิทธิ์จองต่อเดือนก็นับเฉพาะ TikTok) · เวลาทับ = ตรวจทุกคิว (ไลฟ์สองที่พร้อมกันไม่ได้)
-- กฎอื่นเหมือน 20261107000000_mc_quota ทุกอย่าง

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
  max_n    int;
  max_h    numeric;
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

    if s.sheet_tab = 'shopee' then
      max_n := cfg.shopee_max_slots_per_day;
      max_h := cfg.shopee_max_hours_per_day;
    else
      max_n := cfg.mc_max_slots_per_day;
      max_h := cfg.mc_max_hours_per_day;
    end if;
    select count(*), coalesce(sum(slot_hours(x.starts_at, x.ends_at)), 0) into used_n, used_h
    from public.mc_slots x
    where x.mc_id = p_mc_id and x.live_date = s.live_date and x.sheet_tab = s.sheet_tab
      and not x.is_cancelled and x.confirmed is distinct from false;
    if used_n + 1 > max_n then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message', format('เกินโควต้า %s slot/วัน', max_n));
      continue;
    end if;
    if used_h + slot_hours(s.starts_at, s.ends_at) > max_h then
      results := results || jsonb_build_object('id', sid, 'success', false, 'message', format('เกินโควต้า %s ชม./วัน', max_h));
      continue;
    end if;

    -- สิทธิ์จองของเดือนนั้น (slot ที่จองสำเร็จก่อนหน้าในคำขอนี้นับแล้ว) — ใช้กับคิว TikTok เท่านั้น
    m_key := to_char(s.live_date, 'YYYY-MM');
    if s.sheet_tab = 'mc' and p_month_max is not null and p_month_max ? m_key then
      m_max := (p_month_max ->> m_key)::int;
      select count(*) into m_used from public.mc_slots x
      where x.mc_id = p_mc_id and x.sheet_tab = 'mc' and not x.is_cancelled and x.confirmed is distinct from false
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
