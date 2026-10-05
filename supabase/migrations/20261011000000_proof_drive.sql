-- หลักฐานไลฟ์ -> Google Drive (สำเนาสำหรับทำเบิก)
--   โฟลเดอร์: GLORY VITAL หลักฐานไลฟ์ > ปี > เดือน > Mc ชื่อ (สร้างอัตโนมัติในไดรฟ์ของบัญชีระบบ)
--   รูปเดียวที่คลุมหลาย Mc = อัปไว้ในโฟลเดอร์ของ Mc แต่ละคน (คนละไฟล์)
--   ลิงก์ของแต่ละ slot ออกใน CSV ใบสรุปค่าจ้าง (คอลัมน์ N)

alter table public.live_proof_slots
  add column if not exists drive_file_id text,  -- ไฟล์ใน Google Drive (ว่าง = ยังไม่ได้อัป)
  add column if not exists drive_url     text,  -- ลิงก์เปิดไฟล์
  add column if not exists drive_error   text;  -- อัปไม่สำเร็จครั้งล่าสุดเพราะอะไร

-- โฟลเดอร์หลักใน Drive (ระบบสร้างให้เองครั้งแรก ย้ายไปไว้ที่ไหนใน Drive ก็ได้ id ไม่เปลี่ยน)
alter table public.settings
  add column if not exists proof_drive_folder_id text;

notify pgrst, 'reload schema';
