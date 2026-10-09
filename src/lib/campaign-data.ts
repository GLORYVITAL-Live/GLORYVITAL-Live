import "server-only";
import { assignCampaigns, bandOf, type Band, type CampInfo } from "@/lib/campaign";
import { createAdminClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/window";

/**
 * ข้อมูลสำหรับให้คะแนน Mc ตามแคมเปญ
 *   - แคมเปญของแต่ละ slot (กฎใน lib/campaign.ts)
 *   - ค่าที่คาดหวังของ slot = GMV/ชม. เฉลี่ยของ slot แบบเดียวกัน (ช่อง x แคมเปญ x ช่วงเวลา) จากทุกไลฟ์ในไฟล์ Export
 *     ยอดไลฟ์ใน Export แบ่งให้ slot ตามนาทีที่ซ้อนกัน (ใช้เป็นเกณฑ์เฉลี่ยเท่านั้น ไม่ใช่ยอดรายคน เพราะ Mc ในไลฟ์เดียวกันจะได้ยอดต่อชม.เท่ากัน)
 */

/** ไฟล์ Export ที่มีเวลาเริ่มไลฟ์จริงเริ่มตั้งแต่เดือนนี้ (ก่อนหน้าเป็นยอดรายวันจากชีต จับคู่กับ slot ไม่ได้) */
export const EXPORT_START = "2026-08-01";
const SLOTS_START = "2026-02-01";
/** ย้อนหลังกี่วันที่ใช้หาค่าเฉลี่ย */
const TRAILING_DAYS = 120;
/** กลุ่มที่มี slot น้อยกว่านี้ไม่ใช้เป็นเกณฑ์ (ใช้กลุ่มกว้างกว่าแทน) */
const MIN_CELL = 6;

/** บัญชีในไฟล์ Export -> ชื่อช่องใน slot */
const SLOT_PLATFORM_OF_ACCOUNT: Record<string, string> = {
  "TikTok|7126874351866037275": "GLORY MALL",
  "TikTok|7081240278438429722": "Skin Expert",
  "TikTok|6723716820899365890": "Cherry Glory",
};
export const slotPlatformOf = (platform: string, accountId: string) =>
  platform === "Shopee" ? "Shopee" : SLOT_PLATFORM_OF_ACCOUNT[`${platform}|${accountId}`] ?? null;

export type CtxSlot = {
  id: number;
  platform: string;
  date: string;
  startMs: number;
  endMs: number;
  hours: number;
  band: Band;
  mc: string; // "Mc ชื่อ"
  gmv: number | null; // ยอดที่กรอกใน slot
  camp: CampInfo | null;
  /** ยอดจาก Export ที่แบ่งให้ slot นี้ (ประมาณ) */
  exp: { gmv: number; hours: number } | null;
  /** GMV/ชม. ที่คาดหวัง (slot แบบเดียวกันเฉลี่ยเท่าไร) null = ข้อมูลเทียบไม่พอ */
  expRate: number | null;
  /** GMV/ชม. ของวันปกติ ช่องและช่วงเวลาเดียวกัน */
  normRate: number | null;
};

type Row = {
  id: number; platform: string; live_date: string; start_time: string; starts_at: string; ends_at: string;
  campaign: string | null; gmv: number | string | null; mc_id: number | null; person: { name: string } | null;
};

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error((error as { message?: string })?.message ?? String(error));
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** slot ของ Mc ในช่วง [first, last] พร้อมแคมเปญ / ค่าที่คาดหวัง (หาค่าเฉลี่ยจากช่วง first-120 วัน ถึง last) */
export async function loadCampaignContext(first: string, last: string): Promise<Map<number, CtxSlot>> {
  const db = createAdminClient();
  // ชื่อแคมเปญใน slot มีตั้งแต่ ก.พ. 2026 (ก่อนหน้าเป็นเลขเก่าที่ไม่ใช้) / ยอดจากไฟล์ Export จับคู่กับ slot ได้ตั้งแต่ ส.ค. 2026
  const from = addDays(first, -TRAILING_DAYS) > SLOTS_START ? addDays(first, -TRAILING_DAYS) : SLOTS_START;
  if (last < from) return new Map();

  const rows = await fetchAll<Row>((a, b) =>
    db.from("mc_slots")
      .select("id, platform, live_date, start_time, starts_at, ends_at, campaign, gmv, mc_id, person:staff!mc_id(name)")
      .eq("is_cancelled", false).not("mc_id", "is", null).or("confirmed.is.null,confirmed.eq.true")
      .gte("live_date", from).lte("live_date", last).order("id").range(a, b) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
  );
  const camps = assignCampaigns(rows.map((r) => ({ id: Number(r.id), date: r.live_date, campaign: r.campaign })));
  const slots: CtxSlot[] = rows.filter((r) => r.person).map((r) => {
    const startMs = Date.parse(r.starts_at), endMs = Date.parse(r.ends_at);
    return {
      id: Number(r.id), platform: r.platform, date: r.live_date, startMs, endMs, hours: (endMs - startMs) / 3600_000,
      band: bandOf(r.start_time), mc: `Mc ${r.person!.name}`, gmv: r.gmv === null ? null : Number(r.gmv),
      camp: camps.get(Number(r.id)) ?? null, exp: null, expRate: null, normRate: null,
    };
  });

  // ---------- ยอดจาก Export แบ่งให้ slot ตามนาทีที่ซ้อนกัน ----------
  const sessFrom = from > EXPORT_START ? from : EXPORT_START;
  const sessions = last < EXPORT_START ? [] : await fetchAll<{ platform: string; account_id: string; started_at: string; duration_sec: number; gmv: number }>((a, b) =>
    db.from("live_sessions").select("platform, account_id, started_at, duration_sec, gmv")
      .gte("started_at", new Date(`${addDays(sessFrom, -1)}T00:00:00+07:00`).toISOString())
      .lt("started_at", new Date(`${addDays(last, 2)}T00:00:00+07:00`).toISOString())
      .order("id").range(a, b) as unknown as PromiseLike<{ data: never[] | null; error: unknown }>,
  );
  const byPlatform = new Map<string, CtxSlot[]>();
  for (const s of slots) byPlatform.set(s.platform.toLowerCase(), [...(byPlatform.get(s.platform.toLowerCase()) ?? []), s]);
  for (const s of sessions) {
    const platform = slotPlatformOf(String(s.platform), String(s.account_id));
    if (!platform || !Number(s.gmv)) continue;
    const s0 = Date.parse(s.started_at), s1 = s0 + Number(s.duration_sec) * 1000;
    // ไลฟ์ที่นำเข้าจากชีต (ไม่มีเวลาเริ่ม ตั้งเป็น 00:0x) จับคู่เวลาไม่ได้
    const local = new Date(s0 + 7 * 3600_000);
    if (local.getUTCHours() === 0 && local.getUTCMinutes() < 10) continue;
    const hit = (byPlatform.get(platform.toLowerCase()) ?? []).map((x) => ({ x, o: overlap(s0, s1, x.startMs, x.endMs) })).filter((y) => y.o > 0);
    const total = hit.reduce((a, y) => a + y.o, 0);
    if (!total) continue;
    for (const y of hit) {
      const e = y.x.exp ?? { gmv: 0, hours: 0 };
      e.gmv += (Number(s.gmv) * y.o) / total;
      e.hours += y.o / 3600_000;
      y.x.exp = e;
    }
  }

  // ---------- ค่าเฉลี่ยของ slot แบบเดียวกัน: ช่อง x แคมเปญ x ช่วงเวลา (ไม่พอ = ช่อง x มี/ไม่มีแคมเปญ x ช่วงเวลา) ----------
  type Cell = { g: number; h: number; n: number };
  const specific = new Map<string, Cell>(), flag = new Map<string, Cell>();
  const add = (m: Map<string, Cell>, k: string, g: number, h: number) => {
    const c = m.get(k) ?? { g: 0, h: 0, n: 0 };
    c.g += g; c.h += h; c.n++;
    m.set(k, c);
  };
  const flagKey = (s: CtxSlot, c: boolean) => `${s.platform}|${c ? "C" : "N"}|${s.band}`;
  for (const s of slots) {
    if (!s.exp || s.exp.hours < 0.5) continue;
    add(specific, `${s.platform}|${s.camp?.nameKey ?? ""}|${s.band}`, s.exp.gmv, s.exp.hours);
    add(flag, flagKey(s, !!s.camp), s.exp.gmv, s.exp.hours);
  }
  const rate = (c: Cell | undefined) => (c && c.n >= MIN_CELL && c.h > 0 ? c.g / c.h : null);
  for (const s of slots) {
    s.expRate = rate(specific.get(`${s.platform}|${s.camp?.nameKey ?? ""}|${s.band}`)) ?? rate(flag.get(flagKey(s, !!s.camp)));
    s.normRate = rate(flag.get(flagKey(s, false)));
  }
  return new Map(slots.filter((s) => s.date >= first).map((s) => [s.id, s]));
}
