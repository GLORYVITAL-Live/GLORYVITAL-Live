-- สไลด์บรีฟโปรดักต์แบบอ่านทีละหน้าในเว็บ (Admin เสริมใหม่ต้องอ่านครบทุกหน้าก่อนรับคิว — src/lib/training.ts)
--   รูปแต่ละหน้าดึงจาก Google Slides ครั้งแรกที่มีคนเปิดหน้านั้น แล้วเก็บไว้ใน bucket นี้ (<รุ่นของสไลด์>/<id หน้า>.png)
--   แก้สไลด์ = รุ่นใหม่ ระบบดึงใหม่และลบรูปของรุ่นเก่าเอง · อ่าน / เขียนจากเซิร์ฟเวอร์ (service role) เท่านั้น
--   อ่านครบแล้ว = training_views kind 'done' ref 'slides:<id สไลด์>' (ใช้ตารางเดิม ไม่ต้องแก้)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-slides', 'training-slides', false, 10485760, array['image/png'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
