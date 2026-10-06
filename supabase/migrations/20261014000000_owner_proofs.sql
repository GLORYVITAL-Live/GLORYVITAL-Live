-- สิทธิ์ Owner: จัดการหลักฐานไลฟ์ทุก slot (แนบ / แทนที่ / ลบ รูปหลักฐานของทุก slot)
--   ติ๊กที่หน้าเจ้าของ > พนักงาน > Owner > "จัดการหลักฐานไลฟ์ (ทุก slot)"
--   Owner ที่ติ๊กจัดการ Mc มีสิทธิ์นี้อยู่แล้ว / Admin ทั่วไปแนบได้เฉพาะ slot ของตัวเอง

alter table public.staff
  add column if not exists can_manage_proofs boolean not null default false;

notify pgrst, 'reload schema';
