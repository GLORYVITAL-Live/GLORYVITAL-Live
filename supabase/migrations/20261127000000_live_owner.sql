-- กลุ่มผู้ไลฟ์ที่ยืนยันแล้วของไลฟ์นั้น (หน้าสถิติไลฟ์ > แยกตามกลุ่มผู้ไลฟ์ · src/lib/live-owners.ts)
--   null = เทียบเวลาไลฟ์กับแพลนในหน้า Plan Slot Live (เดือนที่มีแพลนในเว็บ)
--   'ours' = ทีมเรา · อื่นๆ = ชื่อกลุ่ม เช่น TDH / MCN
--   ใช้กับเดือนก่อนมีแพลนในเว็บ และไลฟ์ที่ไม่มีเวลาเริ่มจริง (นำเข้าจากชีต) · อัปไฟล์ Export ซ้ำไม่ทับค่านี้
alter table public.live_sessions add column if not exists live_owner text;

notify pgrst, 'reload schema';
