-- สถานะ Adjusted รายวันของแพลน Agency (หน้า Plan Slot Live · ไฟล์ส่งออกแผ่น Agency)
--   มีแถว = วันนั้นเป็น Adjusted / ไม่มีแถว = Confirmed
--   แยกจาก agency_slots เพราะการแก้เวลาคือลบแถวเดิมแล้วเพิ่มแถวใหม่ สถานะจะได้ไม่หายตามไปด้วย

create table if not exists public.agency_adjusted (
  agency     text not null,
  live_date  date not null,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  primary key (agency, live_date)
);
alter table public.agency_adjusted enable row level security;

notify pgrst, 'reload schema';
