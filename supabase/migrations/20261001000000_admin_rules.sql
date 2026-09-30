-- กฎรับคิว Admin เสริม (ใหม่)
--   1) สูงสุด 4 slot และ 8 ชม. ต่อวัน
--   2) slot ในวันเดียวกันแบ่งได้ไม่เกิน 2 ช่วง (ช่วง = slot ที่ต่อกัน เช่น 9:30–11:30 + 11:30–13:30)
--   3) เวลาห้ามทับกัน แม้คนละแพลตฟอร์ม
-- ค่าตัวเลขแก้ได้ที่ตาราง settings (ไม่ต้องแก้โค้ด SQL)

alter table public.settings
  add column if not exists admin_max_hours_per_day numeric not null default 8,
  add column if not exists admin_max_blocks_per_day int not null default 2;

update public.settings set admin_max_slots_per_day = 4, admin_max_hours_per_day = 8, admin_max_blocks_per_day = 2 where id = 1;

create or replace function public.assign_admin_slots(p_admin_id bigint, p_slot_ids bigint[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg     public.settings;
  cutoff  date := public.schedule_cutoff_date();
  results jsonb := '[]'::jsonb;
  s       public.admin_slots;
  clash   public.admin_slots;
  same_n  int;
  same_h  numeric;
  blocks  int;
begin
  perform pg_advisory_xact_lock(hashtext('glory_booking'));
  select * into cfg from public.settings where id = 1;

  -- เรียงตามเวลา (slot ที่รับสำเร็จแล้วในคำขอนี้นับเป็นคิวเดิมของรอบถัดไป)
  for s in
    select * from public.admin_slots where id = any (p_slot_ids) order by starts_at, id for update
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

    -- เวลาทับกับคิวเดิม (ทุกแพลตฟอร์ม รวม slot ข้ามเที่ยงคืน)
    select * into clash from public.admin_slots x
    where x.admin_id = p_admin_id and x.id <> s.id and not x.is_cancelled
      and x.confirmed is distinct from false and x.starts_at < s.ends_at and x.ends_at > s.starts_at
    limit 1;
    if found then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message',
        format('เวลาทับกับคิวเดิม (%s %s-%s)', clash.platform, fmt_hm(clash.start_time), fmt_hm(clash.end_time)));
      continue;
    end if;

    -- จำนวน slot / ชั่วโมงในวันนี้
    select count(*), coalesce(sum(slot_hours(x.starts_at, x.ends_at)), 0) into same_n, same_h
    from public.admin_slots x
    where x.admin_id = p_admin_id and x.id <> s.id and x.live_date = s.live_date and not x.is_cancelled
      and x.confirmed is distinct from false;
    if same_n + 1 > cfg.admin_max_slots_per_day then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message', format('มีคิวครบ %s slot ในวันนี้แล้ว', cfg.admin_max_slots_per_day));
      continue;
    end if;
    if same_h + slot_hours(s.starts_at, s.ends_at) > cfg.admin_max_hours_per_day then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message', format('เกินโควต้า %s ชม. ต่อวัน', cfg.admin_max_hours_per_day));
      continue;
    end if;

    -- จำนวนช่วงในวันนี้: คิวเดิม + slot นี้ + slot ที่ยังรอรับในคำขอเดียวกัน (เผื่อ slot ถัดไปมาเชื่อมช่องว่าง)
    select count(*) into blocks from (
      select t.st, lag(t.en) over (order by t.st, t.en) as prev_en
      from (
        select x.starts_at as st, x.ends_at as en from public.admin_slots x
        where x.admin_id = p_admin_id and x.id <> s.id and x.live_date = s.live_date and not x.is_cancelled
          and x.confirmed is distinct from false
        union all
        select s.starts_at, s.ends_at
        union all
        select y.starts_at, y.ends_at from public.admin_slots y
        where y.id = any (p_slot_ids) and y.admin_id is null and y.needs_extra_admin
          and y.live_date = s.live_date and (y.starts_at, y.id) > (s.starts_at, s.id)
      ) t
    ) b
    where b.prev_en is distinct from b.st;
    if blocks > cfg.admin_max_blocks_per_day then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message',
        format('วันนี้แบ่งได้ไม่เกิน %s ช่วง (slot ต้องต่อกับช่วงเดิม)', cfg.admin_max_blocks_per_day));
      continue;
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

revoke all on function public.assign_admin_slots(bigint, bigint[]) from public, anon, authenticated;
