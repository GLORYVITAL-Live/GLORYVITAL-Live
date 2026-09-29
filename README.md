# glory-booking

ระบบจองคิวไลฟ์ GLORY VITAL (Mc จองคิว, Admin เสริมรับคิว, เจ้าของดูสรุปรายเดือน)
ย้ายจาก HTML + Apps Script + Google Sheet มาเป็น **Next.js + Tailwind + Supabase** รันด้วย **bun**

## โครงสร้าง

| ส่วน | ไฟล์ |
| --- | --- |
| หน้าเว็บ | `src/app/page.tsx`, `src/components/*` |
| API (แทน `doPost` เดิม) | `src/app/api/{slots,book,cancel,my,owner}/route.ts` |
| กฎการจอง / รับคิว / ยกเลิก (atomic, ล็อกกันจองชน) | `supabase/migrations/*_init.sql` (ฟังก์ชัน `book_mc_slots`, `assign_admin_slots`, `cancel_slot`) |
| ลงปฏิทิน Google | `src/lib/calendar.ts` + `src/app/api/cron/calendar/route.ts` |
| นำเข้าข้อมูลจากชีตเดิม | `scripts/import-sheet.ts` |
| หน้าเว็บเดิม (อ้างอิง) | `legacy/index.html` |

## ตั้งค่าครั้งแรก

1. **Supabase**: สร้างโปรเจกต์ที่ supabase.com
   - คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ URL / anon key / service role key
   - สร้างตาราง: `bun x supabase login` → `bun x supabase link` → `bun run db:push`
     (หรือวางไฟล์ใน `supabase/migrations/` ลงใน SQL Editor แล้วกด Run)
   - Authentication > Providers > **Google**: เปิดใช้ ใส่ Client ID / Secret จาก Google Cloud
   - Authentication > URL Configuration: ใส่ Site URL และเพิ่ม `http://localhost:3000/auth/callback`
2. **Google Cloud**: สร้าง Service Account เปิด Calendar API + Sheets API ใส่อีเมล/คีย์ใน `.env.local`
   - แชร์ชีต LIVE GLORY 2026 ให้อีเมล Service Account (ผู้มีสิทธิ์อ่าน)
   - Mc / Admin ทุกคนแชร์ปฏิทินของตัวเองให้อีเมล Service Account สิทธิ์ "ทำการเปลี่ยนแปลงกิจกรรม"
3. **นำเข้าข้อมูล**: `bun run import:sheet --dry-run` ดูสรุปก่อน แล้ว `bun run import:sheet`
4. **รัน**: `bun install` → `bun dev` แล้วเปิด http://localhost:3000

## ตั้งค่าที่เคยอยู่ในชีต

| เดิม | ใหม่ |
| --- | --- |
| การตั้งค่าเว็บ B1 (ปิดรับจอง) | `settings.site_notice` |
| B2 (เดือนสุดท้ายที่เปิดจอง) | `settings.schedule_cutoff_month` เช่น `2026-10` |
| B3 / B4 / B5 / B6 | `schedule_notice` / `admin_chat_url` / `default_mc_rate` / `default_admin_rate` |
| แท็บ Mc Email / Admin Email / Owner Email / เบอร์โทร MC | ตาราง `staff` (role, name, email, phone, hourly_rate, is_extra_admin) |

แก้ได้ที่ Supabase > Table Editor

## ซิงค์สองทางกับ Google Sheet

แก้ slot ได้ทั้งในชีต (แท็บ "ลงตาราง Deal Mc" / "ลงตาราง Admin เสริม") และในเว็บ (หน้าเจ้าของ > จัดการ slot)

- **ชีต -> เว็บ**: `apps-script/web-sync.gs` ในสคริปต์ที่ผูกกับชีต ส่งเลขแถวที่ถูกแก้ไป `/api/sync/sheet`
  (Script Property `SYNC_SECRET` = `SHEET_SYNC_SECRET`) เว็บอัปเดตเฉพาะคอลัมน์ที่ถูกแก้
- **เว็บ -> ชีต**: DB trigger จดงานใน `sheet_jobs` แล้ว `src/lib/sheet-sync.ts` เขียนลงชีต
  slot ใหม่แทรกในกลุ่มวันเดียวกัน เรียงตามเวลาเริ่ม
- คอลัมน์ **V** = รหัส slot (ระบบเขียนเอง ห้ามแก้) ใช้จับคู่แถว จึงแทรก/เรียงแถวในชีตได้
- ลบแถวในชีตจะไม่ลบในเว็บ (ยกเลิกคิว = ลบชื่อ หรือสถานะ "แคน") ลบ slot ในเว็บจะลบแถวในชีตด้วย
- แก้ในชีตแล้วเว็บไม่เปลี่ยน: กด "ซิงค์จากชีตทั้งหมด" ในหน้าจัดการ slot
- ห้ามใช้ `bun run import:sheet` แล้ว (เขียนทับทั้งหมด สคริปต์ถูกล็อกไว้)

## Cron

ตั้งให้เรียก `GET /api/cron/calendar` ทุก 1–5 นาที พร้อม header `Authorization: Bearer $CRON_SECRET`
เพื่อเก็บตกงานลงปฏิทินที่ล้มเหลวชั่วคราว (ปกติระบบลงปฏิทินให้ทันทีหลังจอง)
