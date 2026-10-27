-- เฟรมไลฟ์ + บรีฟการแต่งตัว
--   เฟรมอ่านจากแท็บ "Frame live" ในชีตวางแผน (settings.frame_sheet_id — ตั้งด้วย SQL ไม่อยู่ในโค้ดเพราะ repo เป็นสาธารณะ)
--     แต่ละช่อง (GLORY MALL / Cherry Glory / Skin Expert / Shopee) x ช่วงวัน (เช่น 25-31 Oct) = 1 เฟรม
--   บรีฟการแต่งตัว 1 อันต่อ ช่อง + ช่วงวันของเฟรม: ข้อความ + รูปชุดตัวอย่าง (bucket live-briefs)
--   จัดการได้: Owner ที่จัดการ Mc ได้ + Admin ที่ติ๊ก can_manage_briefs (หน้าพนักงาน) · Mc / Admin เห็นในรายละเอียด slot ของตัวเอง

alter table public.settings add column if not exists frame_sheet_id text;
alter table public.staff add column if not exists can_manage_briefs boolean not null default false;

create table if not exists public.live_briefs (
  platform    text not null,                       -- ชื่อช่องในระบบ (GLORY MALL / Cherry Glory / Skin Expert / Shopee)
  date_from   date not null,
  date_to     date not null,
  note        text not null default '',
  images      jsonb not null default '[]'::jsonb,  -- ["path ใน bucket live-briefs", ...]
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (platform, date_from, date_to)
);
alter table public.live_briefs enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('live-briefs', 'live-briefs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
