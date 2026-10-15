-- อุปกรณ์โปรดักชั่น (หน้า "อุปกรณ์"): ทะเบียนว่ามีอะไรบ้าง อยู่ที่ไหน สถานะ รูป ยี่ห้อ/รุ่น/Serial วันที่ซื้อ ราคา
--   ใช้ได้: Owner ที่จัดการ Mc หรือ Admin ได้ + Admin ที่ติ๊ก "จัดการอุปกรณ์โปรดักชั่น" (staff.can_manage_equipment ตั้งในหน้าพนักงาน)
--   รูปเก็บใน Storage bucket "equipment" (ส่วนตัว เปิดผ่านเว็บด้วยลิงก์ชั่วคราว)

create table if not exists public.equipment (
  id             bigint generated always as identity primary key,
  name           text not null,
  category       text not null default '',
  quantity       int not null default 1 check (quantity >= 0),
  status         text not null default 'ใช้งานได้' check (status in ('ใช้งานได้', 'ชำรุด', 'ส่งซ่อม', 'หาย', 'เลิกใช้')),
  location       text not null default '',
  brand          text not null default '',
  model          text not null default '',
  serial         text not null default '',
  purchase_date  date,
  price          numeric check (price is null or price >= 0), -- ราคาต่อชิ้น
  note           text not null default '',
  photo_path     text,                                       -- path ใน bucket equipment
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text not null default ''
);
create index if not exists equipment_category_idx on public.equipment (category);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.equipment enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipment', 'equipment', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Admin ที่เข้าหน้าอุปกรณ์ได้ (ติ๊กในหน้าพนักงาน)
alter table public.staff add column if not exists can_manage_equipment boolean not null default false;

notify pgrst, 'reload schema';
