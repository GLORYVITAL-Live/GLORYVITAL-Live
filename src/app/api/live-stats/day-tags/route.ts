import { fail, monthRange, ok, requireAnalytics } from "@/lib/api";
import { fetchAll } from "@/lib/data";
import type { DayTag } from "@/lib/live-days";
import { createAdminClient } from "@/lib/supabase/server";

// ป้ายวันต่อแพลตฟอร์ม (วันปกติ / Teasing / วันแคมเปญ ...) ไว้เทียบยอดในหน้าสถิติไลฟ์ (src/lib/live-days.ts)
//   GET ?month=YYYY-MM หรือ ?from=YYYY-MM&to=YYYY-MM -> { ready, tags } · ready false = ยังไม่ได้รัน SQL 20261128000000_live_day_tags

export async function GET(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ดูสถิติไลฟ์", "read");
  if ("res" in r) return r.res;
  const sp = new URL(request.url).searchParams;
  const { first } = monthRange(sp.get("from") ?? sp.get("month"));
  const { last } = monthRange(sp.get("to") ?? sp.get("month"));
  const db = createAdminClient();
  try {
    const rows = await fetchAll<{ platform: string; day: string; kind: string; label: string }>((a, b) =>
      db.from("live_day_tags").select("platform, day, kind, label").gte("day", first).lte("day", last).order("day").range(a, b) as never);
    return ok({ ready: true, tags: rows as DayTag[] });
  } catch (err) {
    const msg = (err as { message?: string }).message ?? "โหลดป้ายวันไม่สำเร็จ";
    return /live_day_tags|schema cache|does not exist/i.test(msg) ? ok({ ready: false, tags: [] }) : fail(msg, 500);
  }
}
