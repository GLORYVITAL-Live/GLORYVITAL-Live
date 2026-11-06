import { fail, monthRange, ok, requireAnalytics } from "@/lib/api";
import { fetchAll } from "@/lib/data";
import { ownerSpanOf } from "@/lib/live-owners";
import { createAdminClient } from "@/lib/supabase/server";

// แพลนของกลุ่ม (Agency TDH / Shopee In house / Infinite / MCN) ไว้แยกยอดไลฟ์ในหน้าสถิติไลฟ์ (src/lib/live-owners.ts)
//   GET ?month=YYYY-MM -> { spans: [{ channel, owner, startMs, endMs }] } รวมคืนก่อนต้นเดือน (ไลฟ์หลังเที่ยงคืนของวันที่ 1 นับเป็นแพลนของวันก่อน)

export async function GET(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ดูสถิติไลฟ์", "read");
  if ("res" in r) return r.res;
  const { first, last } = monthRange(new URL(request.url).searchParams.get("month"));
  const dayBefore = new Date(Date.parse(`${first}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  const db = createAdminClient();
  try {
    const rows = await fetchAll<{ agency: string; platform: string; live_date: string; start_time: string; end_time: string }>((a, b) =>
      db.from("agency_slots").select("agency, platform, live_date, start_time, end_time")
        .gte("live_date", dayBefore).lte("live_date", last).order("id").range(a, b) as never);
    return ok({ spans: rows.map(ownerSpanOf) });
  } catch (err) {
    return fail((err as { message?: string }).message ?? "โหลดแพลนไม่สำเร็จ", 500);
  }
}
