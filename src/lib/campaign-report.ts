import "server-only";
import { instLabel, previousInstance, type CampCell, type CampInstance, type CampaignReport, type CampPlatformRow } from "@/lib/campaign";
import { loadCampaignContext, type CtxSlot } from "@/lib/campaign-data";
import { gmvCoverage } from "@/lib/gmv";
import { CAP, type ExpectRow, type RankCellRaw, type RankPeriod, type RankReport } from "@/lib/mc-rank";
import { addDays } from "@/lib/window";

/**
 * รายงานแคมเปญทีละรอบ (Pay Day ก.ย. / Pay Day ต.ค. / 9.9 / 10.10 …) + ดัชนีของ Mc แต่ละคนต่อรอบ
 *   GMV แคมเปญ = ยอดจากไฟล์ Export ที่ตกใน slot ของ Mc (ไม่รวมช่วงที่ไม่มี Mc)
 *   ดันยอด (lift) = GMV ÷ ยอดที่ slot เดียวกันควรได้ถ้าเป็นวันปกติ (ช่องและช่วงเวลาเดียวกัน)
 *   ดัชนี Mc = ยอดจริง ÷ ค่าที่คาดหวัง ใช้ยอดที่กรอกใน slot ก่อน (แม่น) ไม่มี = ยอดที่แบ่งจากไฟล์ Export (ประมาณ)
 */

const bkkDate = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export async function campaignReport(from: string, to: string): Promise<CampaignReport> {
  const ctx = await loadCampaignContext(`${from}-01`, lastDayOf(to));
  const slots = [...ctx.values()];
  const now = Date.now(), today = bkkDate(now);

  // ---------- รายรอบ ----------
  type Group = { slots: CtxSlot[]; tags: Set<string> };
  const groups = new Map<string, Group>();
  for (const s of slots) {
    if (!s.camp) continue;
    const g = groups.get(s.camp.key) ?? { slots: [], tags: new Set<string>() };
    g.slots.push(s);
    if (s.camp.tag) g.tags.add(s.camp.tag);
    groups.set(s.camp.key, g);
  }
  const hasExp = (s: CtxSlot) => !!s.exp && s.exp.hours >= 0.5;

  const stat = (list: CtxSlot[]) => {
    const byPlatform = new Map<string, CampPlatformRow & { norm: number; normGmv: number }>();
    for (const s of list.filter(hasExp)) {
      const r = byPlatform.get(s.platform) ?? { platform: s.platform, slots: 0, hours: 0, gmv: 0, rate: null, lift: null, norm: 0, normGmv: 0 };
      r.slots++; r.hours += s.exp!.hours; r.gmv += s.exp!.gmv;
      if (s.normRate) { r.norm += s.normRate * s.exp!.hours; r.normGmv += s.exp!.gmv; }
      byPlatform.set(s.platform, r);
    }
    const all = [...byPlatform.values()];
    const hours = all.reduce((a, r) => a + r.hours, 0), gmv = all.reduce((a, r) => a + r.gmv, 0);
    const norm = all.reduce((a, r) => a + r.norm, 0), normGmv = all.reduce((a, r) => a + r.normGmv, 0);
    return {
      hours, gmv, rate: hours ? gmv / hours : null, lift: norm ? normGmv / norm : null,
      platforms: all.map((r): CampPlatformRow => ({
        platform: r.platform, slots: r.slots, hours: r.hours, gmv: r.gmv, rate: r.hours ? r.gmv / r.hours : null, lift: r.norm ? r.normGmv / r.norm : null,
      })).sort((a, b) => b.gmv - a.gmv),
    };
  };

  const base: CampInstance[] = [...groups.entries()].map(([key, g]) => {
    const c = g.slots[0].camp!;
    const st = stat(g.slots);
    return {
      key, nameKey: c.nameKey, label: c.label, family: c.family, big: c.big, start: c.start, end: c.end,
      tags: [...g.tags].sort(),
      status: c.end < today ? "done" : c.start > today ? "upcoming" : "live",
      slots: g.slots.length, plannedHours: g.slots.reduce((a, s) => a + s.hours, 0), mcs: new Set(g.slots.map((s) => s.mc)).size,
      hours: st.hours, gmv: st.gmv, rate: st.rate, lift: st.lift, platforms: st.platforms,
      prevKey: null, prevLabel: null, prevRate: null, prevLift: null,
    } satisfies CampInstance;
  });
  const instances = base.map((i) => {
    const prev = previousInstance(i, base);
    return prev ? { ...i, prevKey: prev.key, prevLabel: instLabel(prev), prevRate: prev.rate, prevLift: prev.lift } : i;
  }).sort((a, b) => b.start.localeCompare(a.start) || a.label.localeCompare(b.label));

  const normalStat = stat(slots.filter((s) => !s.camp));
  const normal = normalStat.platforms.map((p) => ({ platform: p.platform, hours: p.hours, gmv: p.gmv, rate: p.rate }));

  // ---------- Mc x รอบ ----------
  const cells = new Map<string, CampCell>();
  for (const u of slotUnits(slots, now).units) {
    const k = `${u.mc}|${u.key}`;
    const c = cells.get(k) ?? { mc: u.mc, key: u.key, slots: 0, hE: 0, aE: 0, eE: 0, hX: 0, aX: 0, eX: 0 };
    c.slots += u.slots;
    if (u.source === "E") { c.hE += u.hours; c.aE += u.actual; c.eE += u.expected; } else { c.hX += u.hours; c.aX += u.actual; c.eX += u.expected; }
    cells.set(k, c);
  }
  return { from, to, today, instances, cells: [...cells.values()].filter((c) => c.hE + c.hX > 0), normal };
}

// ---------- หน่วยยอดของ Mc (ใช้ทั้งแท็บ Campaign และอันดับ Mc) ----------

export type Unit = {
  mc: string; key: string; label: string; campaign: boolean; platform: string; isCeo: boolean;
  /** E = ยอดที่กรอกใน slot (แม่น) / X = ยอดไลฟ์จากไฟล์ Export แบ่งตามนาที (ประมาณ) */
  source: "E" | "X";
  hours: number; gmv: number; actual: number; expected: number; slots: number;
};

/**
 * slot ที่ไลฟ์ไปแล้ว -> หน่วยยอด
 *   E: slot ที่กรอก GMV (+ slot ว่างก่อนหน้าของ Mc คนเดียวกันที่ยอดรวมอยู่ใน slot นี้)
 *   X: slot ที่ไม่มียอดที่กรอก ใช้ยอดที่แบ่งจากไฟล์ Export (ไลฟ์ต้องซ้อนกับ slot อย่างน้อย 30 นาที)
 *   ยอดจริงเกิน CAP เท่าของที่คาดหวัง นับแค่ CAP เท่า (actual) / ไม่มีค่าที่คาดหวัง = ข้าม (skipped)
 */
export function slotUnits(slots: CtxSlot[], now: number): { units: Unit[]; skipped: number } {
  const past = slots.filter((s) => s.startMs <= now);
  const units: Unit[] = [];
  let skipped = 0;
  const base = (s: CtxSlot) => ({
    mc: s.mc, key: s.camp?.key ?? "", label: s.camp?.label ?? "วันปกติ", campaign: !!s.camp, platform: s.platform, isCeo: !!s.camp?.isCeo,
  });
  const cover = gmvCoverage(past.map((s) => ({ id: s.id, platform: s.platform, startMs: s.startMs, endMs: s.endMs, gmv: s.gmv, who: s.mc })));
  const extra = new Map<number, CtxSlot[]>();
  const byId = new Map(past.map((s) => [s.id, s]));
  for (const [emptyId, by] of cover) {
    const e = byId.get(emptyId);
    if (e) extra.set(by.id, [...(extra.get(by.id) ?? []), e]);
  }
  const used = new Set<number>();
  for (const s of past) {
    if (s.gmv === null) continue;
    const unit = [s, ...(extra.get(s.id) ?? [])];
    unit.forEach((u) => used.add(u.id));
    if (unit.some((u) => u.expRate === null || u.expRate <= 0)) { skipped++; continue; }
    const expected = unit.reduce((a, u) => a + u.expRate! * u.hours, 0);
    units.push({
      ...base(s), isCeo: unit.some((u) => u.camp?.isCeo), source: "E", hours: unit.reduce((a, u) => a + u.hours, 0),
      gmv: s.gmv, actual: Math.min(s.gmv, CAP * expected), expected, slots: unit.length,
    });
  }
  for (const s of past) {
    if (used.has(s.id) || !s.exp || s.exp.hours < 0.5) continue;
    if (s.expRate === null || s.expRate <= 0) { skipped++; continue; }
    const expected = s.expRate * s.exp.hours;
    units.push({ ...base(s), source: "X", hours: s.exp.hours, gmv: s.exp.gmv, actual: Math.min(s.exp.gmv, CAP * expected), expected, slots: 1 });
  }
  return { units, skipped };
}

// ---------- อันดับ Mc ตามช่วง (เดือนที่เลือก / 30 วันล่าสุด / 90 วันล่าสุด) ----------

const pad2 = (n: number) => String(n).padStart(2, "0");
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
};

/** รวมหน่วยยอดเป็นแถว Mc x แคมเปญ x ช่อง x ที่มา (ส่งไปให้หน้าเว็บคิดคะแนนเอง สลับ "ไม่นับ CEO" ได้ทันที) */
function toRankCells(units: Unit[]): RankCellRaw[] {
  const m = new Map<string, RankCellRaw>();
  for (const u of units) {
    const k = `${u.mc}|${u.key}|${u.platform}|${u.source}|${u.isCeo ? 1 : 0}`;
    const c = m.get(k) ?? { mc: u.mc, key: u.key, label: u.label, campaign: u.campaign, platform: u.platform, isCeo: u.isCeo, source: u.source, hours: 0, gmv: 0, actual: 0, expected: 0, slots: 0 };
    c.hours += u.hours; c.gmv += u.gmv; c.actual += u.actual; c.expected += u.expected; c.slots += u.slots;
    m.set(k, c);
  }
  return [...m.values()];
}

export async function rankReport(period: RankPeriod, month: string): Promise<RankReport> {
  const now = Date.now(), today = bkkDate(now);
  let from: string, to: string, prevFrom: string, prevTo: string;
  if (period === "month") {
    from = `${month}-01`; to = lastDayOf(month);
    const pm = shiftMonth(month, -1);
    prevFrom = `${pm}-01`; prevTo = lastDayOf(pm);
  } else {
    const n = Number(period);
    to = today; from = addDays(today, -(n - 1));
    prevTo = addDays(from, -1); prevFrom = addDays(prevTo, -(n - 1));
  }
  const ctx = await loadCampaignContext(prevFrom, to);
  const all = [...ctx.values()];
  const cur = all.filter((s) => s.date >= from && s.date <= to);
  const prev = all.filter((s) => s.date >= prevFrom && s.date <= prevTo);
  const u = slotUnits(cur, now);

  // ความคืบหน้า: ชั่วโมงที่จอง / ไลฟ์ไปแล้ว / มียอดที่กรอก (รายแคมเปญ + ราย Mc)
  const campaigns = new Map<string, { label: string; start: string; total: number; past: number }>();
  const perMc: Record<string, { total: number; past: number }> = {};
  let total = 0, past = 0;
  for (const s of cur) {
    const done = s.startMs <= now;
    total += s.hours; if (done) past += s.hours;
    const k = s.camp?.key ?? "";
    const c = campaigns.get(k) ?? { label: s.camp ? instLabel(s.camp) : "วันปกติ", start: s.camp?.start ?? "", total: 0, past: 0 };
    c.total += s.hours; if (done) c.past += s.hours;
    campaigns.set(k, c);
    const p = perMc[s.mc] ?? { total: 0, past: 0 };
    p.total += s.hours; if (done) p.past += s.hours;
    perMc[s.mc] = p;
  }
  const entered = u.units.filter((x) => x.source === "E").reduce((a, x) => a + x.hours, 0);

  // ค่าที่คาดหวังที่ใช้ (แคมเปญ x ช่อง x ช่วงเวลา)
  const expect = new Map<string, ExpectRow>();
  for (const s of cur) {
    const label = s.camp?.label ?? "วันปกติ";
    const r = expect.get(`${label}|${s.platform}`) ?? { label, platform: s.platform, rates: {}, slots: 0 };
    r.slots++;
    if (s.expRate !== null) r.rates[s.band] = s.expRate;
    expect.set(`${label}|${s.platform}`, r);
  }

  return {
    period, month, from, to, prevFrom, prevTo, today,
    partial: to >= today,
    cells: toRankCells(u.units), prevCells: toRankCells(slotUnits(prev, now).units), skipped: u.skipped,
    expect: [...expect.values()].sort((a, b) => Number(a.label === "วันปกติ") - Number(b.label === "วันปกติ") || a.label.localeCompare(b.label) || a.platform.localeCompare(b.platform)),
    progress: {
      total, past, entered,
      campaigns: [...campaigns.values()].filter((c) => c.label !== "วันปกติ").sort((a, b) => a.start.localeCompare(b.start)).map(({ label, total: t, past: p }) => ({ label, total: t, past: p })),
      perMc,
    },
  };
}
