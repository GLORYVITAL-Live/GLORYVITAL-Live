-- หน้าเทรนนิ่ง: Owner จัดการในเว็บ (ต่อจาก 20261103000000_training)
--   ref = 'drive:<id ไฟล์>' (วิดีโอในไดรฟ์) · 'folder:<id โฟลเดอร์>' (กลุ่มสินค้า) · 'youtube:<id>' (คลิป YouTube)
--   hidden = ซ่อนจากหน้าเทรนนิ่ง (ไฟล์ในไดรฟ์ไม่ถูกลบ) · title = ชื่อที่แสดงแทนชื่อไฟล์ / ชื่อโฟลเดอร์
--   added = คลิปที่ Owner เพิ่มจากลิงก์ (ไม่อยู่ในโฟลเดอร์เทรนนิ่ง) อยู่ในกลุ่ม group_name
create table if not exists public.training_items (
  id          bigint generated always as identity primary key,
  ref         text not null unique,
  added       boolean not null default false,
  title       text,
  group_name  text,
  hidden      boolean not null default false,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.training_items enable row level security;

-- ย้ายโฟลเดอร์ที่ซ่อนไว้ใน settings.training_exclude มาไว้ที่นี่ (กดแสดงกลับในเว็บได้)
insert into public.training_items (ref, hidden)
select 'folder:' || trim(x), true
from public.settings, unnest(string_to_array(coalesce(training_exclude, ''), ',')) as x
where id = 1 and trim(x) <> ''
on conflict (ref) do update set hidden = true;
update public.settings set training_exclude = null where id = 1;
