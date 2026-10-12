import "server-only";
import { slotPlatformOf } from "@/lib/campaign-data";
import { bkkToday } from "@/lib/data";
import { loadSessions, sessionMonths } from "@/lib/live-stats-db";
import { platformLabel } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/server";
import type { CeoEvent, CeoLiveData, CeoSession } from "@/lib/types";
import { addDays } from "@/lib/window";

// ข้อมูลหน้า CEO Live
//   วัน CEO Live = slot Mc ที่ชื่อแคมเปญมีคำว่า CEO (ไม่นับที่ยกเลิก) + วันที่มีข้อมูลรอบ CEO ที่ track แยก (ตาราง ceo_sessions)
//   ส่งไลฟ์เฉพาะของวัน CEO Live และวันก่อน — ไม่ส่งไลฟ์ของวันอื่น (บัญชี Marketing เห็นแค่ส่วนนี้)

type SlotRow = { live_date: string; platform: string; starts_at: string; ends_at: string; campaign: string };
type TrackedRow = {
  live_date: string; title: string; time_range: string; duration_hr: number | null; gmv: number | null; orders: number | null;
  viewers: number | null; views: number | null; peak_viewers: number | null; peak_time: string; impressions: number | null;
  ctr: number | null; co: number | null;
};

const TRACKED_COLS = "live_date, title, time_range, duration_hr, gmv, orders, viewers, views, peak_viewers, peak_time, impressions, ctr, co";
const bkkMidnight = (date: string) => new Date(`${date}T00:00:00+07:00`).toISOString();
const bkkTime = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(11, 16);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
/** ยังไม่ได้รัน SQL 20261021000000_marketing (ไม่มีตาราง ceo_sessions) */
export const noTrackedTable = (msg: string) => /ceo_sessions/.test(msg) && /exist|schema cache|not find/i.test(msg);

const fromTracked = (r: TrackedRow): CeoSession => ({
  date: String(r.live_date), title: r.title ?? "", timeRange: r.time_range ?? "", durationHr: n(r.duration_hr), gmv: n(r.gmv),
  orders: n(r.orders), viewers: n(r.viewers), views: n(r.views), peakViewers: n(r.peak_viewers), peakTime: r.peak_time ?? "",
  impressions: n(r.impressions), ctr: n(r.ctr), co: n(r.co),
});

export async function ceoLiveData(canEdit: boolean): Promise<CeoLiveData> {
  const db = createAdminClient();
  const today = bkkToday();
  const [slotRes, trackedRes] = await Promise.all([
    db.from("mc_slots").select("live_date, platform, starts_at, ends_at, campaign")
      .ilike("campaign", "%ceo%").eq("is_cancelled", false).order("starts_at").limit(2000),
    db.from("ceo_sessions").select(TRACKED_COLS).order("live_date").limit(2000),
  ]);
  if (slotRes.error) throw new Error(slotRes.error.message);
  const trackedReady = !trackedRes.error || !noTrackedTable(trackedRes.error.message);
  if (trackedRes.error && trackedReady) throw new Error(trackedRes.error.message);
  const tracked = ((trackedRes.data ?? []) as TrackedRow[]).map(fromTracked);

  // รวม slot เป็นรายวัน (วันเดียวมีหลาย slot / หลายช่องได้) + วันที่มีข้อมูลรอบ CEO แต่ slot ไม่ได้ติดแท็ก CEO
  const byDay = new Map<string, SlotRow[]>();
  for (const s of (slotRes.data ?? []) as SlotRow[]) byDay.set(s.live_date, [...(byDay.get(s.live_date) ?? []), s]);
  for (const t of tracked) if (!byDay.has(t.date)) byDay.set(t.date, []);

  // ไลฟ์ของวัน CEO Live + วันก่อน (เฉพาะวันที่ถึงแล้ว) ช่วงที่ติดกันรวมเป็นช่วงเดียว
  const merged: { from: string; to: string }[] = [];
  for (const d of [...byDay.keys()].filter((x) => x <= today).sort()) {
    const w = { from: bkkMidnight(addDays(d, -1)), to: bkkMidnight(addDays(d, 1)) };
    const last = merged.at(-1);
    if (last && w.from <= last.to) last.to = w.to > last.to ? w.to : last.to;
    else merged.push(w);
  }
  const [sessions, months] = await Promise.all([
    Promise.all(merged.map((w) => loadSessions(w.from, w.to))).then((x) => x.flat()),
    sessionMonths(),
  ]);

  // ช่องใน slot (เช่น GLORY MALL) -> บัญชีในไฟล์ Export · วันที่ไม่มี slot = ช่อง GLORY MALL (ช่องที่ CEO ไลฟ์ประจำ)
  const accountsOf = (platforms: Set<string>) => [...new Set(sessions
    .filter((s) => platforms.has((slotPlatformOf(s.platform, s.accountId) ?? "").toUpperCase()))
    .map((s) => `${s.platform}|${s.accountId}`))];
  const trackedBy = new Map(tracked.map((t) => [t.date, t]));

  const events: CeoEvent[] = [...byDay.entries()].map(([date, slots]) => ({
    date,
    label: [...new Set(slots.map((s) => s.campaign.trim()))].join(" + ") || trackedBy.get(date)?.title || "CEO Live",
    times: [...new Map(slots.map((s) => {
      const t = { platform: platformLabel(s.platform), start: bkkTime(s.starts_at), end: bkkTime(s.ends_at) };
      return [`${t.platform}|${t.start}|${t.end}`, t] as const;
    })).values()],
    accounts: accountsOf(new Set(slots.length ? slots.map((s) => s.platform.trim().toUpperCase()) : ["GLORY MALL"])),
  })).sort((a, b) => b.date.localeCompare(a.date));

  return { today, events, sessions, months, tracked, trackedReady, canEdit };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** ตรวจข้อมูลรอบ CEO ที่ส่งมา (จากหน้าอัปโหลด) คืน null = ไม่ถูกต้อง */
export function cleanTracked(v: unknown): CeoSession | null {
  const x = (v ?? {}) as Record<string, unknown>;
  const date = String(x.date ?? "");
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) return null;
  const int = (k: string) => { const t = numOrNull(x[k]); return t === null ? null : Math.round(t); };
  const text = (k: string) => String(x[k] ?? "").trim().slice(0, 60);
  return {
    date, title: text("title"), timeRange: text("timeRange"), durationHr: numOrNull(x.durationHr), gmv: numOrNull(x.gmv),
    orders: int("orders"), viewers: int("viewers"), views: int("views"), peakViewers: int("peakViewers"), peakTime: text("peakTime"),
    impressions: int("impressions"), ctr: numOrNull(x.ctr), co: numOrNull(x.co),
  };
}

export const toTrackedRow = (s: CeoSession, by: string) => ({
  live_date: s.date, title: s.title, time_range: s.timeRange, duration_hr: s.durationHr, gmv: s.gmv, orders: s.orders,
  viewers: s.viewers, views: s.views, peak_viewers: s.peakViewers, peak_time: s.peakTime, impressions: s.impressions,
  ctr: s.ctr, co: s.co, updated_by: by, updated_at: new Date().toISOString(),
});
