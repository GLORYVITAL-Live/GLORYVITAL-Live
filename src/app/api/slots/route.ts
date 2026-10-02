import { fail, ok, requireMe } from "@/lib/api";
import { getSettings, openAdminSlots, openMcSlots, scheduleNotice } from "@/lib/data";

// หน้าแรก: ประกาศ + slot ที่ว่าง (?role=mc | admin) — แทน action "init" / "adminInit"
// Owner ที่มีสิทธิ์ฝั่งนั้นเปิดดูได้ (ดูอย่างเดียว เห็นแบบเดียวกับ Mc / Admin เสริม)
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const role = new URL(request.url).searchParams.get("role");
  if (role !== "mc" && role !== "admin") return fail("ไม่รู้จักบทบาทนี้");
  const settings = await getSettings();
  const owner = r.me.owner;

  if (role === "mc") {
    if (!r.me.mc && !owner?.mc) return fail("บัญชีนี้ไม่มีสิทธิ์จองคิว Mc", 403);
  } else {
    if (!r.me.admin && !owner?.admin) return fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้า Admin", 403);
    if (r.me.admin && !r.me.admin.isExtra && !owner?.admin) {
      return ok({
        siteNotice: "",
        scheduleNotice: `${r.me.admin.name} เป็น Admin ประจำ คิวของคุณจัดโดยทีมงาน กดที่ชื่อมุมขวาบนเพื่อดู "ตารางของฉัน"`,
        slots: [],
      });
    }
  }

  // ช่วงเปิดจองตามคน: คนในรายชื่อจองก่อนได้ช่วงของตัวเอง คนอื่นใช้ช่วงทั่วไป
  // (ข้อความแจ้งบอกแค่ช่วงวันของคนนั้น ไม่บอกว่ามีรายชื่อจองก่อน) Owner ที่เปิดดูเห็นแบบคนทั่วไป
  const personId = (role === "mc" ? r.me.mc : r.me.admin?.isExtra ? r.me.admin : null)?.id ?? null;
  return ok({
    siteNotice: settings.site_notice,
    scheduleNotice: scheduleNotice(settings, role, personId),
    slots: role === "mc" ? await openMcSlots(settings, personId) : await openAdminSlots(settings, personId),
  });
}
