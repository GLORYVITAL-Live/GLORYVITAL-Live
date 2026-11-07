import "server-only";
import type { LiveSession } from "@/lib/live-stats";
import { createAdminClient } from "@/lib/supabase/server";

// อ่านตาราง live_sessions (ไลฟ์จากไฟล์ Export) ใช้ร่วมกันระหว่างหน้า Data analytics และหน้า CEO Live

const COLS = "platform, account_id, account_name, title, started_at, duration_sec, gmv, orders, items_sold, customers, viewers, views, engaged_viewers, avg_view_sec, comments, shares, likes, new_followers, add_to_cart, impressions, clicks";

type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const sessionFromRow = (r: Row): LiveSession => ({
  platform: r.platform as LiveSession["platform"],
  accountId: String(r.account_id),
  accountName: String(r.account_name ?? ""),
  title: String(r.title ?? ""),
  startedAt: new Date(String(r.started_at)).toISOString(),
  durationSec: Number(r.duration_sec),
  gmv: Number(r.gmv),
  orders: Number(r.orders),
  itemsSold: Number(r.items_sold),
  customers: n(r.customers),
  viewers: Number(r.viewers),
  views: n(r.views),
  engagedViewers: n(r.engaged_viewers),
  avgViewSec: n(r.avg_view_sec),
  comments: n(r.comments),
  shares: n(r.shares),
  likes: n(r.likes),
  newFollowers: n(r.new_followers),
  addToCart: n(r.add_to_cart),
  impressions: n(r.impressions),
  clicks: n(r.clicks),
  liveOwner: (r.live_owner as string | null | undefined) ?? null,
});

/** ไลฟ์ที่เริ่มในช่วง [from, to) เรียงตามเวลาเริ่ม (Supabase ส่งได้ครั้งละ 1,000 แถว ดึงต่อจนครบ) */
export async function loadSessions(from: string, to: string): Promise<LiveSession[]> {
  const db = createAdminClient();
  const rows: Row[] = [];
  let cols = `${COLS}, live_owner`;
  for (let page = 0; ; page++) {
    const { data, error } = await db.from("live_sessions").select(cols)
      .gte("started_at", from).lt("started_at", to)
      .order("started_at").order("id")
      .range(page * 1000, page * 1000 + 999);
    // ยังไม่ได้รัน SQL 20261127000000_live_owner = อ่านแบบเดิม (แยกกลุ่มจากแพลนอย่างเดียว)
    if (error && cols !== COLS && /live_owner/.test(error.message)) { cols = COLS; page--; continue; }
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows.map(sessionFromRow);
}

/** เดือนที่มีข้อมูลแล้ว "YYYY-MM" (ใหม่ไปเก่า ไม่ซ้ำ) */
export async function sessionMonths(): Promise<string[]> {
  const { data, error } = await createAdminClient().from("live_session_months").select("month").order("month", { ascending: false });
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((m) => String(m.month)))];
}
