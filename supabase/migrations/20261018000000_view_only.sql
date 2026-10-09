-- สิทธิ์ "ดูได้อย่างเดียว" ของ Owner (หน้าพนักงาน > Owner > เลือกระดับสิทธิ์: ไม่มี / ดูได้ / จัดการได้)
--   สิทธิ์เดิมทุกตัว = จัดการได้ (ไม่เปลี่ยน) / คอลัมน์ใหม่ = ดูได้อย่างเดียว
--   can_view_mc / can_view_admin   = ดูฝั่ง Mc / Admin (สรุป · ผลงาน Mc · ตาราง slot · รายชื่อ) ไม่เห็นค่าจ้าง แก้ไม่ได้
--   can_view_proofs                = ดูหลักฐานไลฟ์ทุก slot แนบ / ลบ / กรอก GMV ไม่ได้
--   can_view_plan                  = ดูแพลนทั้งเดือน บันทึกไม่ได้
--   analytics_readonly             = ติ๊ก Data analytics แบบดูอย่างเดียว (อัปโหลด / ลบข้อมูล / แก้แคมเปญไม่ได้)

alter table public.staff
  add column if not exists can_view_mc        boolean not null default false,
  add column if not exists can_view_admin     boolean not null default false,
  add column if not exists can_view_proofs    boolean not null default false,
  add column if not exists can_view_plan      boolean not null default false,
  add column if not exists analytics_readonly boolean not null default false;

notify pgrst, 'reload schema';
