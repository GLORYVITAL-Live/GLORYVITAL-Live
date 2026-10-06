-- สิทธิ์ Owner: เข้าหน้า Data analytics (สถิติไลฟ์ / อัปโหลด / ส่งออก / สไลด์)
--   ติ๊กที่หน้าเจ้าของ > พนักงาน > Owner > "เข้าถึง Data analytics"
--   Owner ที่มีอยู่แล้วตอนเพิ่มคอลัมน์ = ได้สิทธิ์ (เดิมเข้าได้ทุกคน) / Owner ใหม่ = ค่าเริ่มต้นปิด

alter table public.staff
  add column if not exists can_view_analytics boolean not null default false;

update public.staff set can_view_analytics = true where role = 'owner';

notify pgrst, 'reload schema';
