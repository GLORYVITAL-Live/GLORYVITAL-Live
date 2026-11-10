-- ใบ 50 ทวิ: อ่านจากโฟลเดอร์ของทีมบัญชี "Form_ใบหัก (50 ทวิ)" > เดือน (10.2026) > โฟลเดอร์ทีม (WHT_LIVE 10.2026) > PDF
--   tawi_team_folder  = id โฟลเดอร์ "Form_ใบหัก (50 ทวิ)" (ตั้งด้วย SQL แยก ไม่ใส่ id ในไฟล์นี้ เพราะ repo เป็นสาธารณะ)
--   tawi_team_keyword = คำในชื่อโฟลเดอร์ทีมเรา ใช้หาโฟลเดอร์ทีมของทุกเดือน (เดือนใหม่ที่ทีมบัญชีสร้างเพิ่มอ่านได้เอง)
--   โฟลเดอร์เดิม (tawi_drive_folder) ยังใช้เป็นประวัติ ก.พ.–ก.ย. 2026: เดือนที่โฟลเดอร์เดิมมีแล้วไม่อ่านซ้ำจากโฟลเดอร์ทีม (src/lib/tawi-name.ts pickTawiFiles)
alter table settings add column if not exists tawi_team_folder text;
alter table settings add column if not exists tawi_team_keyword text;
