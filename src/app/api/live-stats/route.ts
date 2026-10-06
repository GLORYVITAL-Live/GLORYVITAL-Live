import { fail, ok, requireAnalytics } from "@/lib/api";
import { cleanSession, monthWindow, PLATFORMS, type LiveSession } from "@/lib/live-stats";
import { createAdminClient } from "@/lib/supabase/server";

// สถิติไลฟ์ (หน้าเจ้าของ > สถิติไลฟ์) เฉพาะ Owner
//   GET    ?from=ISO&to=ISO   ไลฟ์ที่เริ่มในช่วง [from, to) (ไม่เกิน 800 วัน)
//   GET    ?months=1          เดือนที่มีข้อมูลแล้ว แยกแพลตฟอร์ม
//   POST   { fileName, sessions }  บันทึกไลฟ์จากไฟล์ Export (บัญชี + เวลาเริ่มเดิม = อัปเดตแถวเดิม)
//   DELETE { platform, month }     ลบข้อมูลทั้งเดือนของแพลตฟอร์มนั้น (อัปไฟล์ผิด)

const COLS = "platform, account_id, account_name, title, started_at, duration_sec, gmv, orders, items_sold, customers, viewers, views, engaged_viewers, avg_view_sec, comments, shares, likes, new_followers, add_to_cart, impressions, clicks";
const MAX_DAYS = 800;

type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const fromRow = (r: Row): LiveSession => ({
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
});

const toRow = (s: LiveSession, fileName: string, by: string) => ({
  platform: s.platform,
  account_id: s.accountId,
  account_name: s.accountName,
  title: s.title,
  started_at: s.startedAt,
  duration_sec: s.durationSec,
  gmv: s.gmv,
  orders: s.orders,
  items_sold: s.itemsSold,
  customers: s.customers,
  viewers: s.viewers,
  views: s.views,
  engaged_viewers: s.engagedViewers,
  avg_view_sec: s.avgViewSec,
  comments: s.comments,
  shares: s.shares,
  likes: s.likes,
  new_followers: s.newFollowers,
  add_to_cart: s.addToCart,
  impressions: s.impressions,
  clicks: s.clicks,
  raw: s.raw ?? {},
  source_file: fileName,
  uploaded_by: by,
  updated_at: new Date().toISOString(),
});

export async function GET(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ดูสถิติไลฟ์");
  if ("res" in r) return r.res;
  const sp = new URL(request.url).searchParams;
  const db = createAdminClient();

  if (sp.get("months")) {
    const { data, error } = await db.from("live_session_months").select("month, platform, lives, gmv").order("month", { ascending: false });
    if (error) return fail(error.message, 500);
    return ok({ months: (data ?? []).map((m) => ({ month: String(m.month), platform: String(m.platform), lives: Number(m.lives), gmv: Number(m.gmv) })) });
  }

  const from = Date.parse(sp.get("from") ?? ""), to = Date.parse(sp.get("to") ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return fail("ช่วงเวลาไม่ถูกต้อง");
  if (to - from > MAX_DAYS * 86400_000) return fail(`เลือกช่วงได้ไม่เกิน ${MAX_DAYS} วัน`);

  // Supabase ส่งได้ครั้งละ 1,000 แถว ดึงต่อจนครบ
  const rows: Row[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db.from("live_sessions").select(COLS)
      .gte("started_at", new Date(from).toISOString()).lt("started_at", new Date(to).toISOString())
      .order("started_at").order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) return fail(error.message, 500);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return ok({ sessions: rows.map(fromRow) });
}

export async function POST(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์อัปโหลดสถิติไลฟ์");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const fileName = String(body?.fileName ?? "").slice(0, 200);
  const list = Array.isArray(body?.sessions) ? body.sessions : [];
  if (!list.length) return fail("ไม่มีข้อมูลไลฟ์ให้บันทึก");
  if (list.length > 2000) return fail("ส่งได้ครั้งละไม่เกิน 2,000 ไลฟ์");
  const sessions = list.map(cleanSession);
  const bad = sessions.findIndex((s: LiveSession | null) => !s);
  if (bad >= 0) return fail(`ข้อมูลไลฟ์ลำดับที่ ${bad + 1} ไม่ครบ (แพลตฟอร์ม / บัญชี / เวลาเริ่ม / GMV)`);
  // ไลฟ์ซ้ำในชุดเดียวกัน (บัญชี + เวลาเริ่ม) ใช้อันหลังสุด ไม่งั้น upsert ล้ม
  const clean = [...new Map((sessions as LiveSession[]).map((s) => [`${s.platform}|${s.accountId}|${s.startedAt}`, s])).values()];

  // นับว่าใหม่กี่ไลฟ์ อัปเดตกี่ไลฟ์ (เทียบกับที่มีอยู่แล้วในช่วงเวลาเดียวกัน)
  const db = createAdminClient();
  const times = clean.map((s) => s.startedAt).sort();
  const existing = new Set<string>();
  for (let page = 0; ; page++) {
    const { data, error } = await db.from("live_sessions").select("platform, account_id, started_at")
      .gte("started_at", times[0]).lte("started_at", times[times.length - 1])
      .order("id").range(page * 1000, page * 1000 + 999);
    if (error) return fail(error.message, 500);
    for (const x of data ?? []) existing.add(`${x.platform}|${x.account_id}|${new Date(String(x.started_at)).toISOString()}`);
    if (!data || data.length < 1000) break;
  }
  const updated = clean.filter((s) => existing.has(`${s.platform}|${s.accountId}|${s.startedAt}`)).length;

  const by = r.me.owner?.name || r.me.email;
  for (let i = 0; i < clean.length; i += 500) {
    const { error } = await db.from("live_sessions")
      .upsert(clean.slice(i, i + 500).map((s) => toRow(s, fileName, by)), { onConflict: "platform,account_id,started_at" });
    if (error) return fail(error.message, 500);
  }
  const platforms = [...new Set(clean.map((s) => s.platform))].join(", ");
  await db.from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name ?? "",
    action: `อัปโหลดสถิติไลฟ์ ${platforms}: ${fileName} (${clean.length} ไลฟ์ ใหม่ ${clean.length - updated} / อัปเดต ${updated})`,
    result: "สำเร็จ",
  });
  return ok({ inserted: clean.length - updated, updated });
}

export async function DELETE(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ลบสถิติไลฟ์");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const platform = PLATFORMS.find((p) => p === body?.platform);
  const month = String(body?.month ?? "");
  if (!platform || !/^\d{4}-\d{2}$/.test(month)) return fail("ระบุแพลตฟอร์มและเดือนให้ถูกต้อง");
  const { from, to } = monthWindow(month);
  const db = createAdminClient();
  const { count, error } = await db.from("live_sessions").delete({ count: "exact" })
    .eq("platform", platform).gte("started_at", from).lt("started_at", to);
  if (error) return fail(error.message, 500);
  await db.from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name ?? "",
    action: `ลบสถิติไลฟ์ ${platform} เดือน ${month} (${count ?? 0} ไลฟ์)`, result: "สำเร็จ",
  });
  return ok({ deleted: count ?? 0 });
}
