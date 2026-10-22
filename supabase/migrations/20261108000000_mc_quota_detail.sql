-- แร็งค์ในโปรไฟล์ Mc (ตารางของฉัน): เก็บคะแนนแยกวันแคมเปญ / วันปกติ ไว้อธิบายให้ Mc เห็นว่าได้แร็งค์นี้เพราะอะไร
--   detail = {"campaign": {"index": 1.05, "hours": 12.5} | null, "normal": {...} | null} — src/lib/mc-quota-db.ts computeMonth
alter table public.mc_quota add column if not exists detail jsonb;

notify pgrst, 'reload schema';
