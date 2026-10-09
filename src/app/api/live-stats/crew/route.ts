import { fail, ok, requireAnalytics } from "@/lib/api";
import { liveCrew } from "@/lib/live-crew";

// ใครไลฟ์ / แคมเปญอะไร ของแต่ละไลฟ์ในช่วง [from, to) (จับคู่กับ slot) ใช้ตอนส่งออกรายการไลฟ์
//   GET ?from=ISO&to=ISO -> { crew: { "<platform>|<accountId>|<startedAt>": { mc, admin, campaign, slots, note } } }

export const maxDuration = 60;
const MAX_DAYS = 800;

export async function GET(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ดูสถิติไลฟ์", "read");
  if ("res" in r) return r.res;
  const sp = new URL(request.url).searchParams;
  const from = Date.parse(sp.get("from") ?? ""), to = Date.parse(sp.get("to") ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return fail("ช่วงเวลาไม่ถูกต้อง");
  if (to - from > MAX_DAYS * 86400_000) return fail(`เลือกช่วงได้ไม่เกิน ${MAX_DAYS} วัน`);
  try {
    return ok({ crew: await liveCrew(from, to) });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
