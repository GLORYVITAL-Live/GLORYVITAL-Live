-- หน้าเทรนนิ่ง: วิดีโอ product training (โฟลเดอร์ใน Google Drive) + สไลด์บรีฟโปรดักต์ (Google Slides)
--   ทุกคนที่ลงทะเบียน (Mc / Admin / Owner / Marketing) ดูได้ในเว็บ — เล่นวิดีโอ / เปิดสไลด์ในหน้าเว็บได้เลย ไม่ต้องไปที่ไดรฟ์
--   ไฟล์ต้องแชร์แบบ "ทุกคนที่มีลิงก์ดูได้" (ตัวเล่นของ Google ในหน้าเว็บใช้สิทธิ์นี้) + แชร์โฟลเดอร์ให้บัญชีระบบ (อ่านรายชื่อวิดีโอ)
--   ค่า id ตั้งแยก (repo เป็น public): update public.settings set training_drive_folder = '<id โฟลเดอร์>', training_slides = '<id สไลด์>' where id = 1;
alter table public.settings add column if not exists training_drive_folder text;
alter table public.settings add column if not exists training_slides text;
-- โฟลเดอร์ย่อยที่ไม่แสดงในเว็บ (id หรือลิงก์โฟลเดอร์ คั่นด้วยจุลภาค / ขึ้นบรรทัดใหม่) — เปลี่ยนชื่อโฟลเดอร์ในไดรฟ์ก็ยังซ่อนอยู่
alter table public.settings add column if not exists training_exclude text;
