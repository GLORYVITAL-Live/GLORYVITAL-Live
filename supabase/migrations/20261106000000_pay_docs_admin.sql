-- สิทธิ์ดูเอกสารของ Owner แยกฝั่ง: can_view_pay_docs = ฝั่ง Mc · can_view_pay_docs_admin = ฝั่ง Admin
--   (เอกสารทำเบิก / ใบ 50 ทวิ / เอกสารรับเงิน + การ์ดในหน้าแรก) ติ๊กได้ที่หน้าพนักงาน
--   คนที่ดูได้อยู่แล้ว = ได้ทั้งสองฝั่งเหมือนเดิม
alter table public.staff add column if not exists can_view_pay_docs_admin boolean not null default false;
update public.staff set can_view_pay_docs_admin = true where can_view_pay_docs = true;
