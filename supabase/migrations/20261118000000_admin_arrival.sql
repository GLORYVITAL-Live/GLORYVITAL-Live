-- Admin กด "มาถึงแล้ว" ในเว็บ: เวลาที่กด (เวลาเซิร์ฟเวอร์) → นาทีสาย = เวลาที่กด − เวลาเริ่ม slot (src/lib/arrival.ts)
--   ใช้หักเงินตามกฎเดิมเมื่อช่องสายในชีต (แท็บ Admin เสริม คอลัมน์ M) ว่าง · ยังไม่ได้รัน = เว็บทำงานตามเดิม (ไม่มีปุ่มมาถึงแล้ว)

alter table public.admin_slots add column if not exists arrived_at timestamptz;

notify pgrst, 'reload schema';
