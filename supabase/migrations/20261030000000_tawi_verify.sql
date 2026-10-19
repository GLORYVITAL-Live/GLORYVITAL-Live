-- ใบ 50 ทวิ: ยืนยันตัวตนก่อนดาวน์โหลด (ต่อจาก 20261029000000_tawi50)
--   เจ้าตัวกรอกชื่อ-นามสกุลจริง -> ตรงกับชื่อในใบที่ทีมงานจับคู่ให้ = จำคีย์ชื่อนั้นไว้ (ดาวน์โหลดใบที่ชื่อนั้นได้)
--   การกรอกชื่อไม่จับคู่ใบให้ใคร (เลิกใช้ matched_by 'self') · เก็บทุกแถวของอีเมลเดียวกัน (Mc + Admin) ให้เหมือนกัน
--   ยังไม่ได้รัน SQL นี้ = เจ้าตัวดาวน์โหลดไม่ได้ (Owner ที่ดูเอกสารทำเบิกได้ยังเปิดไฟล์ได้)

alter table public.staff add column if not exists tawi_verified_keys text[];                    -- คีย์ชื่อที่ยืนยันแล้ว (tawiNameKey)
alter table public.staff add column if not exists tawi_verified_at timestamptz;                 -- ยืนยันสำเร็จล่าสุด
alter table public.staff add column if not exists tawi_verify_fails integer not null default 0; -- กรอกไม่ตรงกี่ครั้ง (ตั้งแต่ยืนยันสำเร็จ / Owner รีเซ็ตล่าสุด)
alter table public.staff add column if not exists tawi_verify_fails_day integer not null default 0; -- กรอกไม่ตรงกี่ครั้งในวันของ tawi_verify_failed_at (จำกัด 5 ครั้ง/วัน)
alter table public.staff add column if not exists tawi_verify_failed_at timestamptz;            -- กรอกไม่ตรงล่าสุด

notify pgrst, 'reload schema';
