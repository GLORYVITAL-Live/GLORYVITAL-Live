import { fail, ok, requireOwner } from "@/lib/api";
import { rankReport } from "@/lib/campaign-report";
import type { RankPeriod } from "@/lib/mc-rank";

// อันดับ Mc ตามช่วง (?period=month|30|90&month=YYYY-MM) — Owner ฝั่ง Mc
//   month = เดือนที่เลือก (เทียบเดือนก่อน) / 30 · 90 = ย้อนหลังจากวันนี้ (เทียบช่วงยาวเท่ากันก่อนหน้า)
export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูอันดับ Mc", "read");
  if ("res" in r) return r.res;
  if (!r.scope.mc) return fail("อันดับ Mc ใช้ข้อมูลฝั่ง Mc ต้องติ๊กสิทธิ์จัดการ Mc", 403);
  const sp = new URL(request.url).searchParams;
  const period = (sp.get("period") ?? "90") as RankPeriod;
  if (!["month", "30", "90"].includes(period)) return fail("ช่วงไม่ถูกต้อง");
  const month = sp.get("month") ?? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("เดือนไม่ถูกต้อง");
  try {
    return ok({ report: await rankReport(period, month) });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
