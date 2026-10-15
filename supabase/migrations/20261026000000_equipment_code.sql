-- อุปกรณ์โปรดักชั่น: รหัสอุปกรณ์ (เช่น CM01 / LT05 / NB03 ตามชีต "รายการอุปกรณ์ Production GLORY") ชิ้นละรหัส ใช้ติดป้าย / ค้นหา
alter table public.equipment add column if not exists code text not null default '';
create index if not exists equipment_code_idx on public.equipment (code);

notify pgrst, 'reload schema';
