-- ช่วงเปิดจองที่ใส่วันสุดท้ายเอง เปิดเกิน "เดือนสุดท้ายที่เปิดจอง" ได้ (เช่น ให้บางคนจองเดือนหน้าก่อน)
--   เว็บคิดวันสุดท้ายที่คนนี้จองได้จากช่วงเปิดจอง (src/lib/window.ts bookRange) แล้วส่งมาเป็น p_until
--   p_until ว่าง = ใช้สิ้นเดือนที่เปิดจองเหมือนเดิม
--   ฟังก์ชันเรียกได้จากเซิร์ฟเวอร์ (service role) เท่านั้น ผู้ใช้ส่ง p_until เองไม่ได้
-- กฎอื่นเหมือนเดิมทุกอย่าง (book_mc_slots จาก 20260929000000_init / assign_admin_slots จาก 20261001000000_admin_rules)
-- + slot ที่เกินวันสุดท้ายที่จองได้ บอกเหตุผลตรงๆ (เดิมขึ้นว่า "อาจมีคนรับไปก่อน" ทำให้เข้าใจผิด)

drop function if exists public.book_mc_slots(bigint, bigint[]);
drop function if exists public.assign_admin_slots(bigint, bigint[]);

-- ------------------ Mc จองคิว ------------------

create or replace function public.book_mc_slots(p_mc_id bigint, p_slot_ids bigint[], p_until date default null)
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

    update public.mc_slots set mc_id = p_mc_id, confirmed = true where id = sid;
    insert into public.calendar_jobs (slot_table, slot_id) values ('mc_slots', sid);
    results := results || jsonb_build_object('id', sid, 'success', true, 'message', 'จองสำเร็จ');
  end loop;

  return results;
end $$;

-- ------------------ Admin เสริมรับคิว ------------------

create or replace function public.assign_admin_slots(p_admin_id bigint, p_slot_ids bigint[], p_until date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg     public.settings;
  cutoff  date := coalesce(p_until, public.schedule_cutoff_date());
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
    if s.admin_id is null and s.needs_extra_admin and s.live_date >= public.bkk_today() and cutoff is not null and s.live_date > cutoff then
      results := results || jsonb_build_object('id', s.id, 'success', false, 'message', 'วันนี้ยังไม่เปิดให้รับคิว (เกินช่วงเปิดจอง)');
      continue;
    end if;
    if s.admin_id is not null or not s.needs_extra_admin or s.live_date < public.bkk_today() then
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

-- เรียกได้จากเซิร์ฟเวอร์ (service role) เท่านั้น
revoke all on function public.book_mc_slots(bigint, bigint[], date) from public, anon, authenticated;
revoke all on function public.assign_admin_slots(bigint, bigint[], date) from public, anon, authenticated;

notify pgrst, 'reload schema';
