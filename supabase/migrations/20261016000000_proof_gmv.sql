-- ยอด GMV ต่อ slot ของ Mc (กรอกในหน้าหลักฐานไลฟ์ ได้ทุก slot รวม Mc ประจำที่ไม่ต้องแนบหลักฐาน)
--   แดชบอร์ด TikTok LIVE แสดงยอดสะสมทั้งไลฟ์ ไลฟ์ยาวต่อกันหลาย slot (คนละ Mc) จึงต้องหักยอดของ slot ก่อนหน้า
--   gmv        = ยอดของ slot นี้ (หลังหักแล้ว) ใช้ในหน้าสรุป
--   gmv_input  = สิ่งที่พิมพ์ (บวก/ลบกันได้ เช่น "123506 - 60540")
--   gmv_minus  = ยอดสะสมของ slot ก่อนหน้าที่ระบบหักให้อัตโนมัติ (ว่าง = ไม่ได้หัก)

alter table public.mc_slots
  add column if not exists gmv       numeric(14, 2),
  add column if not exists gmv_input text,
  add column if not exists gmv_minus numeric(14, 2);

-- GMV ไม่ได้อยู่ในชีต: แก้ GMV ไม่ต้องจดงานเขียนชีต (เพิ่ม gmv* ในรายการคอลัมน์ที่ระบบใช้เอง)
create or replace function public.enqueue_sheet_job()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  internal text[] := array['calendar_email', 'calendar_event_id', 'updated_at', 'starts_at', 'ends_at',
                           'sheet_row', 'is_cancelled', 'needs_extra_admin', 'created_at', 'late_minutes', 'bonus_minutes',
                           'gmv', 'gmv_input', 'gmv_minus'];
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - internal) = (to_jsonb(new) - internal) then
    return new;
  end if;
  insert into public.sheet_jobs (slot_table, slot_id) values (tg_table_name, new.id);
  return new;
end $$;

notify pgrst, 'reload schema';
