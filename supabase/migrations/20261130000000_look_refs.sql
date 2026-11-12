-- Look แต่งหน้า + แต่งตัว (รูป Ref) แยกผู้หญิง / ผู้ชาย ใช้ทุกไลฟ์
--   Mc / Admin เห็นในโปรไฟล์ (ตารางของฉัน > Look แต่งหน้า/แต่งตัว)
--   แก้ได้: คนที่จัดการบรีฟการแต่งตัวได้ (Owner ที่จัดการ Mc ได้ + Admin ที่ติ๊ก can_manage_briefs) ที่ เทรนนิ่ง > เฟรมไลฟ์
--   รูปเก็บใน bucket live-briefs (มีอยู่แล้ว จาก SQL 20261113000000_live_frames) โฟลเดอร์ looks/<gender>/

create table if not exists public.look_refs (
  gender      text primary key check (gender in ('female', 'male')),
  note        text not null default '',
  images      jsonb not null default '[]'::jsonb,  -- ["path ใน bucket live-briefs", ...]
  updated_by  text not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.look_refs enable row level security;

notify pgrst, 'reload schema';
