import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { withPlatformLabels } from "@/lib/platform";
import { enqueueIfShared, missingCalendarCounts, processCalendarJobs, usesCalendar } from "@/lib/calendar";
import { bookingLimits, getSettings, openAdminSlots, openMcSlots, scheduleNotice, upcomingQueues } from "@/lib/data";
import { myQuotas } from "@/lib/mc-quota-db";

// หน้าแรก: ประกาศ + slot ที่ว่าง (?role=mc | admin) — แทน action "init" / "adminInit"
// Owner ที่มีสิทธิ์ฝั่งนั้นเปิดดูได้ (ดูอย่างเดียว เห็นแบบเดียวกับ Mc / Admin เสริม)
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const role = new URL(request.url).searchParams.get("role");
  if (role !== "mc" && role !== "admin") return fail("ไม่รู้จักบทบาทนี้");
  const settings = await getSettings();
  const owner = r.me.owner;

  // Owner ที่ดูฝั่งนั้นได้ (จัดการได้ หรือ ดูได้อย่างเดียว) เปิดดูหน้าจองได้ — จองจริงต้องเป็น Mc / Admin เอง
  if (role === "mc") {
    if (!r.me.mc && !owner?.see.mc) return fail("บัญชีนี้ไม่มีสิทธิ์จองคิว Mc", 403);
  } else {
    if (!r.me.admin && !owner?.see.admin) return fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้า Admin", 403);
    if (r.me.admin && !r.me.admin.isExtra && !owner?.see.admin) {
      // Admin ประจำ: ไม่มี slot ให้รับ และยังไม่ต้องแชร์ปฏิทิน (ไม่เตือน)
      return ok({
        siteNotice: "",
        scheduleNotice: `${r.me.admin.name} เป็น Admin ประจำ คิวของคุณจัดโดยทีมงาน กดที่ชื่อมุมขวาบนเพื่อดู "ตารางของฉัน"`,
        slots: [],
      });
    }
  }

  // ทีม Shopee: คิวในระบบเป็นบัญชี TikTok ทั้งหมด ไม่ส่ง slot ให้เห็น (Owner ที่เปิดดูฝั่งนั้นได้ เห็นตามปกติ)
  if ((role === "mc" ? r.me.mc : r.me.admin)?.platform === "shopee" && !owner?.see[role]) {
    return ok({ siteNotice: "", scheduleNotice: "", slots: [], mine: [] });
  }

  // ช่วงเปิดจองตามคน: คนในรายชื่อจองก่อนได้ช่วงของตัวเอง คนอื่นใช้ช่วงทั่วไป
  // (ข้อความแจ้งบอกแค่ช่วงวันของคนนั้น ไม่บอกว่ามีรายชื่อจองก่อน) Owner ที่เปิดดูเห็นแบบคนทั่วไป
  const personId = (role === "mc" ? r.me.mc : r.me.admin?.isExtra ? r.me.admin : null)?.id ?? null;
  const [slots, mine, missing] = await Promise.all([
    role === "mc" ? openMcSlots(settings, personId) : openAdminSlots(settings, personId),
    // คิวที่จองไว้แล้ว: หน้าจองเช็กโควต้าต่อวัน / เวลาทับ ก่อนกดจอง (ไม่ต้องรอฐานข้อมูลปฏิเสธ)
    personId ? upcomingQueues(role, personId) : Promise.resolve([]),
    // คิวที่ยังไม่ขึ้นปฏิทิน (ส่วนใหญ่ = ยังไม่แชร์ปฏิทินให้ระบบ) ใช้แสดงแถบเตือน + วิธีแชร์
    personId && usesCalendar(r.me.email) ? missingCalendarCounts({ role, id: personId }).catch(() => null) : Promise.resolve(null),
  ]);
  // เปิดหน้าครั้งแรก (?check=1) แล้วยังมีคิวไม่ขึ้นปฏิทิน: ถาม Google ว่าแชร์แล้วหรือยัง แชร์แล้วลงคิวที่ค้างให้เลย
  //   (หลังตอบผู้ใช้ ไม่ต้องรอ — รีเฟรชรอบถัดไปของหน้าจอง ป้ายเตือนจะหายเอง) ไม่ต้องกด "แชร์แล้ว เช็กเลย"
  const calendarMissing = personId && missing ? missing.get(personId) ?? 0 : 0;
  // สิทธิ์จองต่อเดือนตามแร็งค์ (เดือนที่มี slot ให้จอง) — โหลดไม่สำเร็จก็จองได้ตามปกติ (ตอนจองฐานข้อมูลตรวจอีกชั้น)
  const quota = role === "mc" && r.me.mc
    ? await myQuotas(settings, r.me.mc.id, slots.map((s) => s.date.slice(0, 7))).catch((err) => {
      console.warn("โหลดสิทธิ์จองไม่สำเร็จ:", (err as Error).message);
      return null;
    })
    : null;
  if (calendarMissing && personId && new URL(request.url).searchParams.get("check") === "1") {
    after(async () => {
      const queued = await enqueueIfShared(role, personId, r.me.email).catch(() => 0);
      if (queued) await processCalendarJobs(30, 20_000).catch(() => undefined);
    });
  }
  return ok({
    siteNotice: settings.site_notice,
    scheduleNotice: scheduleNotice(settings, role, personId),
    // ชื่อช่องที่แสดง (เช่น GLORY MALL -> GLORY VITAL) ชีตยังใช้ชื่อเดิม
    slots: withPlatformLabels(slots),
    mine,
    limits: bookingLimits(settings, role),
    // หน้าต่างยืนยันการจองย้ำกฎยกเลิก (ค่าเดียวกับ /api/my / ฟังก์ชันยกเลิกในฐานข้อมูล)
    cancelMinHours: Number(settings.cancel_min_hours) || 6,
    calendarMissing,
    ...(quota ? { quota } : {}),
  });
}
