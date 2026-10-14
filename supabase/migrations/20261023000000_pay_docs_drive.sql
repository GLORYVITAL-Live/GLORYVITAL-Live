-- เอกสารทำเบิกที่มีอยู่แล้วใน Google Drive (ส่งทาง LINE เดิม แล้ว Owner เก็บไว้ในโฟลเดอร์ "Mc ชื่อ" / "Admin ชื่อ")
--   ระบบจับคู่ชื่อรายชื่อกับโฟลเดอร์ย่อยในโฟลเดอร์ Mc / Admin (settings.pay_docs_drive_mc / _admin) หรือ Owner ผูกเองในหน้าพนักงาน
--   ผูกแล้ว = มีเอกสารแล้ว ไม่ขึ้นป้ายเตือนให้ส่ง · ส่งผ่านเว็บทีหลัง = ไฟล์ใหม่ลงโฟลเดอร์นี้

alter table public.staff add column if not exists pay_docs_drive_folder text; -- id โฟลเดอร์ของคนนี้ใน Drive

notify pgrst, 'reload schema';
