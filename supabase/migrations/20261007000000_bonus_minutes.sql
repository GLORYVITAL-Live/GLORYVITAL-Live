-- ไลฟ์ชดเชย (นาที): ไลฟ์ต่อแทนคนถัดไปที่มาสาย ได้เงินเพิ่มตามค่าจ้าง/ชม. แบบเทียร์ (ดู BONUS_TIERS ใน src/lib/pay.ts)
--   อ่าน "+10" จากช่องเวลาสาย: Mc = แท็บ Deal Mc คอลัมน์ L / Admin = แท็บ Admin เสริม คอลัมน์ M
--   ค่ามาจากชีตอย่างเดียว (เว็บไม่เขียนกลับ)

alter table public.mc_slots add column if not exists bonus_minutes int;
alter table public.admin_slots add column if not exists bonus_minutes int;

-- bonus_minutes ไม่ต้องเขียนกลับลงชีต (ไม่จดงาน sheet_jobs เมื่อเปลี่ยนแค่ช่องนี้)
create or replace function public.enqueue_sheet_job()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  internal text[] := array['calendar_email', 'calendar_event_id', 'updated_at', 'starts_at', 'ends_at',
                           'sheet_row', 'is_cancelled', 'needs_extra_admin', 'created_at', 'late_minutes', 'bonus_minutes'];
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - internal) = (to_jsonb(new) - internal) then
    return new;
  end if;
  insert into public.sheet_jobs (slot_table, slot_id) values (tg_table_name, new.id);
  return new;
end $$;

-- ให้ API ของ Supabase เห็นคอลัมน์ใหม่ทันที
notify pgrst, 'reload schema';
