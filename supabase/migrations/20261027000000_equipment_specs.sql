-- อุปกรณ์โปรดักชั่น: สเปค (หมวดคอมพิวเตอร์) เช่น { "cpu": "Intel i5-12400", "ram": "16GB DDR4", "storage": "SSD 512GB" }
alter table public.equipment add column if not exists specs jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
