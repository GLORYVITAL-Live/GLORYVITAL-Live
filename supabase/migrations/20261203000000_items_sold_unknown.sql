-- ชิ้นที่ขาย: ไม่รู้ = null (ไฟล์ Export บางแบบไม่มีคอลัมน์นี้ เช่น Shopee ที่ Export ปลาย พ.ย. 2026)
--   เดิมบันทึกเป็น 0 ทำให้หน้าสถิติไลฟ์เทียบแล้วขึ้นว่าชิ้นที่ขายลดลง 100% · null = แสดงว่าไม่มีข้อมูล
--   อัปไฟล์ที่ไม่มีคอลัมน์ทับไลฟ์เดิม = เว็บไม่ส่งคอลัมน์นี้ (คงค่าจากไฟล์ที่ครบไว้) · ไลฟ์ใหม่จากไฟล์แบบนั้น = ค่าเริ่มต้น (null)
alter table public.live_sessions alter column items_sold drop not null;
alter table public.live_sessions alter column items_sold set default null;

-- ไลฟ์ Shopee ที่อัปจากไฟล์ที่ไม่มีคอลัมน์ชิ้นที่ขาย (เก็บหัวคอลัมน์ไว้ใน raw) = ไม่รู้
update public.live_sessions set items_sold = null
 where platform = 'Shopee' and not (raw ? 'สินค้าที่ขายได้(คำสั่งซื้อที่ยืนยันแล้ว)');

notify pgrst, 'reload schema';
