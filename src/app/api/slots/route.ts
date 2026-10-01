import { fail, ok, requireMe } from "@/lib/api";
import { getSettings, openAdminSlots, openMcSlots, scheduleNotice } from "@/lib/data";

// หน้าแรก: ประกาศ + slot ที่ว่าง (?role=mc | admin) — แทน action "init" / "adminInit"
// Owner ที่มีสิทธิ์ฝั่งนั้นเปิดดูได้ (ดูอย่างเดียว เห็นแบบเดียวกับ Mc / Admin เสริม)
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const role = new URL(request.url).searchParams.get("role");
  const settings = await getSettings();
  const notices = { siteNotice: settings.site_notice, scheduleNotice: scheduleNotice(settings) };
  const owner = r.me.owner;

  if (role === "mc") {
    if (!r.me.mc && !owner?.mc) return fail("บัญชีนี้ไม่มีสิทธิ์จองคิว Mc", 403);
    return ok({ ...notices, slots: await openMcSlots(settings) });
  }
  if (role === "admin") {
    if (!r.me.admin && !owner?.admin) return fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้า Admin", 403);
    if (r.me.admin && !r.me.admin.isExtra && !owner?.admin) {
      return ok({
        siteNotice: "",
        scheduleNotice: `${r.me.admin.name} เป็น Admin ประจำ คิวของคุณจัดโดยทีมงาน กดที่ชื่อมุมขวาบนเพื่อดู "ตารางของฉัน"`,
        slots: [],
      });
    }
    return ok({ ...notices, slots: await openAdminSlots(settings) });
  }
  return fail("ไม่รู้จักบทบาทนี้");
}
