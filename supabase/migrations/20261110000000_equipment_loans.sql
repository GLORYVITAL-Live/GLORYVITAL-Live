-- ขอยืมอุปกรณ์จากทีมอื่นในบริษัท (src/lib/loans.ts / src/lib/loans-db.ts)
--   บัญชี "ทีมอื่น" (role borrower): login Google แล้วเห็นแค่หน้า "ขอยืมอุปกรณ์" — เลือกอุปกรณ์ + จำนวน · สถานที่ใช้งาน · วันเวลายืม · วันเวลาคืน
--   คนที่เข้าหน้าอุปกรณ์ได้ (Owner ที่จัดการ Mc / Admin + Admin ที่ติ๊กหน้าอุปกรณ์) อนุมัติ / ไม่อนุมัติ → ส่งของ → รับคืน
--   สถานะ: pending รออนุมัติ · approved อนุมัติแล้ว · rejected ไม่อนุมัติ · borrowed ยืมออกไปแล้ว · returned คืนแล้ว · cancelled ยกเลิก

-- เพิ่มบทบาท 'borrower' (ลบเงื่อนไขบทบาทเดิมก่อน ไม่ว่าจะตั้งชื่อไว้อย่างไร)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.staff drop constraint %I', c);
  end loop;
end $$;

alter table public.staff add constraint staff_role_check check (role in ('mc', 'admin', 'owner', 'marketing', 'borrower'));
-- ชื่อทีม / แผนกของบัญชีทีมอื่น
alter table public.staff add column if not exists team_name text not null default '';

create table if not exists public.equipment_loans (
  id              bigint generated always as identity primary key,
  requester_id    bigint references public.staff(id) on delete set null,
  requester_name  text not null,
  requester_email text not null,
  team            text not null default '',
  phone           text not null default '',
  location        text not null,                -- สถานที่ใช้งาน
  purpose         text not null default '',     -- ใช้ทำอะไร (ไม่บังคับ)
  start_at        timestamptz not null,         -- กำหนดการยืม (รับของ)
  end_at          timestamptz not null,         -- กำหนดการส่งคืน
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'borrowed', 'returned', 'cancelled')),
  decided_by      text,
  decided_at      timestamptz,
  reject_reason   text not null default '',
  handed_by       text,
  handed_at       timestamptz,
  returned_by     text,
  returned_at     timestamptz,
  return_note     text not null default '',     -- สภาพตอนรับคืน
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists equipment_loans_status_idx on public.equipment_loans (status, start_at);
create index if not exists equipment_loans_requester_idx on public.equipment_loans (requester_id);

create table if not exists public.equipment_loan_items (
  loan_id       bigint not null references public.equipment_loans(id) on delete cascade,
  equipment_id  bigint not null references public.equipment(id) on delete restrict,
  quantity      int not null check (quantity > 0),
  primary key (loan_id, equipment_id)
);
create index if not exists equipment_loan_items_equipment_idx on public.equipment_loan_items (equipment_id);

-- เปิด RLS ไม่มี policy = เข้าถึงได้เฉพาะเซิร์ฟเวอร์ของเว็บ (service role)
alter table public.equipment_loans enable row level security;
alter table public.equipment_loan_items enable row level security;

notify pgrst, 'reload schema';
