import { fail, ok, requireMe, requirePlanner } from "@/lib/api";
import { forecastStatus, lockForecast, unlockForecast, updateForecast } from "@/lib/cost-forecast-sync";

// Forecast ค่าใช้จ่ายในแท็บ "Sum 2" (src/lib/cost-forecast.ts)
//   GET  ?month=YYYY-MM -> { status } สถานะล็อค + ตัวเลขในชีตตอนนี้
//   POST { month, action: "update" | "lock" | "unlock" } อัปเดตตามแพลนตอนนี้ / ล็อคเลย / ปลดล็อค (ก่อนวันล็อคเท่านั้น)
// สิทธิ์: ดูได้ = คนที่ดูหน้า Cost ได้ · กดปุ่ม = จัดการ Plan Slot Live ได้ (คนเดียวกับที่ตั้งเรท Agency)

export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const o = r.me.owner;
  if (!o?.mc && !o?.admin && !o?.plan) return fail("บัญชีนี้ไม่มีสิทธิ์ดูหน้า Cost", 403);
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) return fail("เดือนไม่ถูกต้อง");
  return ok({ status: await forecastStatus(month) });
}

export async function POST(request: Request) {
  const r = await requirePlanner("บัญชีนี้ไม่มีสิทธิ์จัดการ Forecast");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const month = String(body?.month ?? "");
  if (!MONTH_RE.test(month)) return fail("เดือนไม่ถูกต้อง");
  const actor = { email: r.me.email, name: r.me.owner?.name || r.me.email };
  try {
    if (body?.action === "update") {
      const res = await updateForecast(month, actor);
      if (res.skipped) return fail(res.skipped === "ล็อคแล้ว" ? "Forecast เดือนนี้ล็อคแล้ว" : res.skipped === "เลยวันล็อคแล้ว" ? "เลยวันล็อคแล้ว อัปเดตจากแพลนไม่ได้" : res.skipped);
      if (res.missing) return fail(res.missing);
      return ok({ written: res.written.length, warnings: res.warnings });
    }
    if (body?.action === "lock") {
      const locked = await lockForecast(month, actor);
      return ok({ locked });
    }
    if (body?.action === "unlock") {
      await unlockForecast(month, actor);
      return ok({});
    }
    return fail("ไม่รู้จักคำสั่งนี้");
  } catch (err) {
    return fail(String((err as Error)?.message ?? err), 500);
  }
}
