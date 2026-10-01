import { fail, ok, requireOwner } from "@/lib/api";
import { cleanupCalendarEvents } from "@/lib/calendar";

export const maxDuration = 60;

// ล้าง event ซ้ำ / ค้างในปฏิทินของพนักงาน (Owner ที่มีสิทธิ์ทั้ง Mc และ Admin)
//   body: { dryRun: true } = แค่แสดงรายการที่จะลบ / { dryRun: false } = ลบจริง
export async function POST(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์จัดการปฏิทิน");
  if ("res" in r) return r.res;
  if (!r.scope.full) return fail("ล้างปฏิทินได้เฉพาะ Owner ที่มีสิทธิ์ทั้ง Mc และ Admin", 403);
  const body = await request.json().catch(() => null);
  const dryRun = body?.dryRun !== false;
  try {
    const res = await cleanupCalendarEvents(dryRun);
    if (!res) return fail("มีงานลงปฏิทินกำลังทำอยู่ กรุณาลองใหม่อีกครั้งใน 1 นาที", 409);
    return ok({ dryRun, ...res, found: res.found.slice(0, 300), total: res.found.length });
  } catch (err) {
    return fail("ตรวจปฏิทินไม่สำเร็จ: " + String((err as Error)?.message ?? err), 500);
  }
}
