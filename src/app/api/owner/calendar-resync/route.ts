import { fail, ok, requireOwner } from "@/lib/api";
import { enqueueUpcomingCalendar, pendingCalendarJobs, processCalendarJobs } from "@/lib/calendar";

export const maxDuration = 60;

// ซิงค์ปฏิทินใหม่ทั้งหมด (Owner ที่มีสิทธิ์ทั้ง Mc และ Admin)
//   body: { start: true } = จดงานของทุกคิวตั้งแต่วันนี้ แล้วเริ่มทำ / { start: false } = ทำงานที่ค้างต่อ
//   แต่ละครั้งทำได้ ~40 วินาที หน้าเว็บเรียกซ้ำจนงานหมด (remaining = 0)
export async function POST(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์จัดการปฏิทิน");
  if ("res" in r) return r.res;
  if (!r.scope.full) return fail("ซิงค์ปฏิทินได้เฉพาะ Owner ที่มีสิทธิ์ทั้ง Mc และ Admin", 403);
  const body = await request.json().catch(() => null);
  try {
    const queued = body?.start === true ? await enqueueUpcomingCalendar() : 0;
    const res = await processCalendarJobs(30, 40_000);
    const remaining = await pendingCalendarJobs();
    return ok({ queued, done: res.done, failed: res.failed, noAccess: res.noAccess, busy: "skipped" in res, remaining });
  } catch (err) {
    return fail("ซิงค์ปฏิทินไม่สำเร็จ: " + String((err as Error)?.message ?? err), 500);
  }
}
