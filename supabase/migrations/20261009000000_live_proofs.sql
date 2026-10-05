-- หลักฐานไลฟ์ (ใช้ทำเบิก): รูปแดชบอร์ด TikTok LIVE + เวลาเริ่ม/จบไลฟ์จริง
--   ไลฟ์ครั้งเดียวคลุมได้หลาย slot ของ Mc -> รูปเดียวผูกได้หลาย slot (slot ละ 1 หลักฐาน)
--   อัปโหลดได้: Admin ของ slot นั้น + Owner ที่มีสิทธิ์ฝั่ง Mc (ตรวจในเว็บ src/lib/proofs.ts)
--   รูปเก็บใน Supabase Storage bucket "live-proofs" (ส่วนตัว เปิดดูผ่านเว็บเท่านั้น)

create table if not exists public.live_proofs (
  id                bigint generated always as identity primary key,
  platform          text not null,
  live_date         date not null,             -- วันของ slot แรกที่ผูก
  started_at        timestamptz not null,      -- เวลาเริ่มไลฟ์จริง (จากแดชบอร์ด)
  ended_at          timestamptz not null,      -- เวลาจบไลฟ์จริง
  image_path        text not null,             -- path ใน bucket live-proofs
  uploaded_by_email text not null,
  uploaded_by_name  text not null default '',
  created_at        timestamptz not null default now(),
  check (ended_at > started_at)
);
create index if not exists live_proofs_date_idx on public.live_proofs (live_date);

-- slot ของ Mc <-> หลักฐาน (slot ละ 1 อัน / ลบ slot หรือหลักฐาน = ลบการผูกให้เอง)
create table if not exists public.live_proof_slots (
  mc_slot_id bigint primary key references public.mc_slots (id) on delete cascade,
  proof_id   bigint not null references public.live_proofs (id) on delete cascade
);
create index if not exists live_proof_slots_proof_idx on public.live_proof_slots (proof_id);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.live_proofs enable row level security;
alter table public.live_proof_slots enable row level security;

-- ที่เก็บรูป (ส่วนตัว ไม่เกิน 5 MB ต่อรูป)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('live-proofs', 'live-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
