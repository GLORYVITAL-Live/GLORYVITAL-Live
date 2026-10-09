import { fail, ok, requireOwner } from "@/lib/api";
import { campaignReport } from "@/lib/campaign-report";
import { withPlatformLabels } from "@/lib/platform";

// รายงานแคมเปญทีละรอบ (?from=YYYY-MM&to=YYYY-MM ไม่เกิน 12 เดือน) — Owner ฝั่ง Mc
export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูหน้า Campaign", "read");
  if ("res" in r) return r.res;
  if (!r.scope.mc) return fail("หน้า Campaign ใช้ข้อมูลฝั่ง Mc ต้องติ๊กสิทธิ์จัดการ Mc", 403);
  const sp = new URL(request.url).searchParams;
  const re = /^\d{4}-(0[1-9]|1[0-2])$/;
  const now = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  const from = sp.get("from") ?? "2026-08", to = sp.get("to") ?? now;
  if (!re.test(from) || !re.test(to) || from > to) return fail("ช่วงเดือนไม่ถูกต้อง");
  const months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1;
  if (months > 12) return fail("เลือกได้ไม่เกิน 12 เดือน");
  try {
    return ok({ report: withPlatformLabels(await campaignReport(from, to)) });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
