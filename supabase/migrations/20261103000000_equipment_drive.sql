-- อุปกรณ์โปรดักชั่น: สำเนารูปไว้ใน Google Drive ของบัญชีระบบ (รูปไม่ได้อยู่ในไฟล์สำรองข้อมูล)
--   GLORY VITAL อุปกรณ์ > หมวด > CM01_Nanlite FS-150.jpg
--   เปลี่ยนรูป / รหัส / ชื่อ / หมวด = อัปไฟล์ใหม่ ไฟล์เดิมทิ้งถังขยะ · ลบอุปกรณ์ = ไฟล์ทิ้งถังขยะ
--   รูปที่มีอยู่แล้ว: ระบบทยอยอัปให้ (หลังบันทึกอุปกรณ์ + cron ทุกเช้า)

alter table public.equipment add column if not exists drive_file_id text;
alter table public.equipment add column if not exists drive_url text;
alter table public.equipment add column if not exists drive_error text;

notify pgrst, 'reload schema';
