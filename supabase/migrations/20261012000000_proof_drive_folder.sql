-- จำโฟลเดอร์ Google Drive ของ Mc (ปี > เดือน > Mc) ที่ไฟล์หลักฐานแต่ละอันอยู่
--   ใช้ใส่ลิงก์โฟลเดอร์รวมหลักฐานทั้งเดือนของ Mc แต่ละคน ในแถว "รวม Mc ..." ของใบสรุปค่าจ้าง (คอลัมน์ N)
--   ไฟล์ที่อัปไปแล้ว ระบบเติมให้เองตอนกด "ส่งรูปขึ้น Google Drive" / ตอนแนบหลักฐานครั้งถัดไป

alter table public.live_proof_slots
  add column if not exists drive_folder_id text;

notify pgrst, 'reload schema';
