import "server-only";
import { slotPlatformOf } from "@/lib/campaign-data";
import { fetchAll } from "@/lib/data";
import { crewKey, type LiveCrew } from "@/lib/live-stats";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * ไลฟ์แต่ละไลฟ์ (ไฟล์ Export) ใครไลฟ์ / แคมเปญอะไร: จับคู่กับ slot ของช่องเดียวกันที่เวลาซ้อนกัน
 *   1) slot ของเรา (แท็บ Deal Mc / Admin เสริม) 2) แพลนในเว็บ (Agency TDH / Shopee In house / Infinite / MCN)
 *   บัญชี -> ช่องใน slot ใช้ตารางเดียวกับอันดับ Mc (lib/campaign-data) · ซ้อนกันน้อยกว่า 10 นาทีไม่นับ (คาบเกี่ยวรอยต่อ slot)
 *   ไลฟ์ที่นำเข้าจากชีต (ไม่มีเวลาเริ่มจริง ตั้งเป็น 00:0x) จับคู่ไม่ได้
 */

type SlotRow = {
  platform: string; live_date: string; start_time: string; end_time: string; starts_at: string; ends_at: string;
  person: { name: string } | null;
};
type McRow = SlotRow & { campaign: string | null };
type AgencyRow = { agency: string; platform: string; live_date: string; start_time: string; end_time: string };
/** ช่วงที่ไลฟ์ (slot ของเรา / แพลนในเว็บ) ที่ใช้จับคู่ */
type Hit = { startMs: number; endMs: number; start: string; end: string; mc: string; admin: string | null; campaign: string };

const MIN_OVERLAP_MS = 10 * 60_000;
const hm = (t: string) => t.slice(0, 5);
const bkkDate = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
const slotKey = (r: SlotRow) => `${r.platform.trim().toLowerCase()}|${Date.parse(r.starts_at)}|${Date.parse(r.ends_at)}`;
/** วัน + เวลา (ไทย) -> ms เวลาจบก่อนเวลาเริ่ม = ข้ามเที่ยงคืน (นับเป็นวันไลฟ์เดิม) */
const bkkMs = (date: string, t: string) => Date.parse(`${date}T${hm(t)}:00+07:00`);
/** ชื่อกลุ่มแพลนในเว็บ (เหมือนหน้า Plan Slot Live) */
const agencyLabel = (a: string) => (a === "In house" || a === "MCN" ? a : `Agency ${a}`);

/** ชื่อของช่วงที่ต่อกัน: คนเดียวทั้งไลฟ์ = ชื่ออย่างเดียว / หลายคน = ชื่อ (ช่วงเวลา) ชื่อเดิมที่ต่อกันรวมเป็นช่วงเดียว */
function names(list: { name: string; start: string; end: string }[]) {
  const runs: { name: string; start: string; end: string }[] = [];
  for (const x of list) {
    const last = runs.at(-1);
    if (last && last.name === x.name && last.end === x.start) last.end = x.end;
    else runs.push({ ...x });
  }
  return new Set(runs.map((r) => r.name)).size <= 1 ? (runs[0]?.name ?? "") : runs.map((r) => `${r.name} (${r.start}–${r.end})`).join(" · ");
}

export async function liveCrew(fromMs: number, toMs: number): Promise<Record<string, LiveCrew>> {
  const db = createAdminClient();
  const from = new Date(fromMs).toISOString(), to = new Date(toMs).toISOString();
  // slot เผื่อวันก่อน / หลัง: ไลฟ์ข้ามเที่ยงคืน และ slot หลังเที่ยงคืนที่นับเป็นวันก่อน
  const dayFrom = bkkDate(fromMs - 86400_000), dayTo = bkkDate(toMs + 86400_000);
  const [sessions, mcRows, adminRows, agencyRows] = await Promise.all([
    fetchAll<{ platform: string; account_id: string; started_at: string; duration_sec: number }>((a, b) =>
      db.from("live_sessions").select("platform, account_id, started_at, duration_sec")
        .gte("started_at", from).lt("started_at", to).order("id").range(a, b) as never),
    fetchAll<McRow>((a, b) =>
      db.from("mc_slots").select("platform, live_date, start_time, end_time, starts_at, ends_at, campaign, person:staff!mc_id(name)")
        .eq("is_cancelled", false).gte("live_date", dayFrom).lte("live_date", dayTo).order("id").range(a, b) as never),
    fetchAll<SlotRow>((a, b) =>
      db.from("admin_slots").select("platform, live_date, start_time, end_time, starts_at, ends_at, person:staff!admin_id(name)")
        .eq("is_cancelled", false).gte("live_date", dayFrom).lte("live_date", dayTo).order("id").range(a, b) as never),
    // ยังไม่ได้รัน SQL ตาราง agency_slots = ไม่ใช้แพลนในเว็บ
    fetchAll<AgencyRow>((a, b) =>
      db.from("agency_slots").select("agency, platform, live_date, start_time, end_time")
        .gte("live_date", dayFrom).lte("live_date", dayTo).order("id").range(a, b) as never).catch(() => [] as AgencyRow[]),
  ]);

  const admins = new Map(adminRows.map((r) => [slotKey(r), r.person?.name ?? ""]));
  const byPlatform = new Map<string, Hit[]>();
  const push = (platform: string, h: Hit) => {
    const p = platform.trim().toLowerCase();
    byPlatform.set(p, [...(byPlatform.get(p) ?? []), h]);
  };
  for (const r of mcRows) {
    push(r.platform, {
      startMs: Date.parse(r.starts_at), endMs: Date.parse(r.ends_at), start: hm(r.start_time), end: hm(r.end_time),
      mc: r.person?.name ? `Mc ${r.person.name}` : "Mc ว่าง", admin: admins.get(slotKey(r)) || "Admin ว่าง", campaign: (r.campaign ?? "").trim(),
    });
  }
  for (const r of agencyRows) {
    const startMs = bkkMs(r.live_date, r.start_time);
    let endMs = bkkMs(r.live_date, r.end_time);
    if (endMs <= startMs) endMs += 86400_000;
    push(r.platform, { startMs, endMs, start: hm(r.start_time), end: hm(r.end_time), mc: agencyLabel(r.agency), admin: null, campaign: "" });
  }

  const out: Record<string, LiveCrew> = {};
  for (const s of sessions) {
    const key = crewKey({ platform: s.platform, accountId: String(s.account_id), startedAt: s.started_at });
    const empty = (note: string): LiveCrew => ({ mc: "", admin: "", campaign: "", slots: "", note });
    const s0 = Date.parse(s.started_at), s1 = s0 + Number(s.duration_sec) * 1000;
    const local = new Date(s0 + 7 * 3600_000);
    if (local.getUTCHours() === 0 && local.getUTCMinutes() < 10) { out[key] = empty("ไม่มีเวลาเริ่มจริง (นำเข้าจากชีตรายวัน)"); continue; }
    const platform = slotPlatformOf(String(s.platform), String(s.account_id));
    if (!platform) { out[key] = empty("บัญชีนี้ไม่ได้ผูกกับช่องใน slot"); continue; }
    // ไลฟ์สั้นกว่า 20 นาที: นับ slot ที่ซ้อนกันเกินครึ่งของไลฟ์
    const need = Math.min(MIN_OVERLAP_MS, (s1 - s0) / 2);
    const hits = (byPlatform.get(platform.toLowerCase()) ?? [])
      .filter((h) => Math.min(s1, h.endMs) - Math.max(s0, h.startMs) >= need)
      .sort((a, b) => a.startMs - b.startMs);
    if (!hits.length) {
      out[key] = empty(platform === "Shopee"
        ? "ไม่พบ slot Shopee ในเวลานี้ (Shopee ลงตารางในแท็บ MC Shopee / แพลน Shopee ในหน้า Plan Slot Live)"
        : `ไม่พบ slot ${platform} ในเวลานี้`);
      continue;
    }
    const ours = hits.filter((h) => h.admin !== null);
    out[key] = {
      mc: names(hits.map((h) => ({ name: h.mc, start: h.start, end: h.end }))),
      admin: names(ours.map((h) => ({ name: h.admin!, start: h.start, end: h.end }))),
      campaign: [...new Set(hits.map((h) => h.campaign).filter(Boolean))].join(", "),
      slots: hits.map((h) => `${h.start}–${h.end}`).join(", "),
      note: ours.length < hits.length ? "แพลนในเว็บ (ไม่ลงชีต)" : "",
    };
  }
  return out;
}
