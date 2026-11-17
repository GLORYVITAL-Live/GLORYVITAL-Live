import { BANDS, instLabel, type Band, type CampInfo } from "@/lib/campaign";
import { gmvCoverage } from "@/lib/gmv";
import { isShopeePlatform } from "@/lib/platform";
import { itemRate, type PayData } from "@/lib/owner-pay";
import { slotPay } from "@/lib/pay";
import type { OwnerDetail } from "@/lib/types";

/**
 * ความคุ้มค่า Mc (หน้า Cost > ความคุ้มค่า Mc): ค่าจ้าง Mc ของคิว เทียบยอดขายของคิวเดียวกัน
 *   ค่าจ้าง = สูตรเดียวกับสรุปรายเดือน (src/lib/owner-pay.ts) · ไม่นับ Mc ประจำ (เงินเดือน) ทั้งค่าจ้างและยอด
 *   ยอดต่อคิว = แบบเดียวกับอันดับ Mc (campaign-report.ts slotUnits): ยอดที่กรอกใน slot ก่อน (รวม slot ว่างก่อนหน้าของ Mc คนเดียวกัน
 *   แบ่งตามชั่วโมง) ไม่มี = ยอดไลฟ์จากไฟล์ Export แบ่งตามนาที (ซ้อนกันอย่างน้อย 30 นาที · ≈ ประมาณ) ไม่มีทั้งคู่ = ยังไม่มียอด (ไม่นับ)
 */

/** ข้อมูล slot ที่ใช้ (CtxSlot ของ src/lib/campaign-data.ts) */
export type CostSlot = {
  id: number; platform: string; date: string; startMs: number; endMs: number; hours: number; band: Band; mc: string;
  gmv: number | null; camp: CampInfo | null; exp: { gmv: number; hours: number } | null;
};
type Summary = PayData & { details: OwnerDetail[] };

/** ค่าจ้าง + ยอด รวมตาม Mc x ช่อง x ช่วงเวลา x แคมเปญ x แพลตฟอร์ม (หน้าเว็บรวมต่อเองตามมุมที่เลือก) · estHours = ชั่วโมงที่ยอดเป็นค่าประมาณ */
export type CostCell = {
  mc: string; platform: string; band: Band; camp: string; app: "TikTok" | "Shopee";
  slots: number; hours: number; cost: number; gmv: number; estHours: number;
};
export type CostTotals = { slots: number; hours: number; cost: number; gmv: number };
export type McCostApp = CostCell["app"];
export const MC_COST_APPS: McCostApp[] = ["TikTok", "Shopee"];
/** ตัวเลขประกอบแยกแพลตฟอร์ม (หน้าเว็บแยกดู TikTok / Shopee · ผู้ใช้ขอ 2026-11-17) */
export type CostAppPart = { prev: CostTotals; unknown: { slots: number; cost: number }; salaried: number };
export type CostReport = {
  month: string; prevMonth: string;
  /** เดือนที่ยังไม่จบ: วันนี้ (เดือนก่อนนับถึงวันที่เดียวกัน) · เดือนที่จบแล้ว = null */
  upTo: string | null;
  cells: CostCell[];
  prev: CostTotals;
  /** คิวที่ไลฟ์แล้วแต่ยังไม่มียอด (ยังไม่กรอก GMV และยังไม่มีไฟล์ Export ของช่วงนั้น) — ไม่นับในตัวเลข */
  unknown: { slots: number; cost: number };
  /** คิวของ Mc ประจำที่ไม่นับ */
  salaried: number;
  /** prev / unknown / salaried แยก TikTok / Shopee (cells แยกด้วย app อยู่แล้ว) */
  byApp: Record<McCostApp, CostAppPart>;
};

/** มุมที่แยกดูได้ (หน้าเว็บ / ไฟล์ส่งออก / สไลด์ใช้ชุดเดียวกัน) */
export const MC_COST_DIMS = [["band", "ช่วงเวลา"], ["platform", "ช่อง"], ["mc", "Mc"], ["camp", "แคมเปญ"], ["app", "แพลตฟอร์ม"]] as const;
export type McCostDim = (typeof MC_COST_DIMS)[number][0];
const BAND_TIME: Record<string, string> = { เช้า: "07–11", บ่าย: "11–15", เย็น: "15–19", ไพรม์: "19–23", ดึก: "23–07" };
export type McCostRow = { key: string; label: string; slots: number; hours: number; cost: number; gmv: number; estHours: number };

/** รวมค่าจ้าง + ยอดตามมุมที่เลือก · ช่วงเวลาเรียงตามเวลา · อย่างอื่นเรียงตามค่าจ้าง (งบไปที่ไหนมากที่สุด) */
export function mcCostRows(cells: CostCell[], dim: McCostDim): McCostRow[] {
  const m = new Map<string, McCostRow>();
  for (const c of cells) {
    const key = c[dim];
    const r = m.get(key) ?? { key, label: dim === "band" ? `${key} ${BAND_TIME[key] ?? ""}` : key, slots: 0, hours: 0, cost: 0, gmv: 0, estHours: 0 };
    r.slots += c.slots; r.hours += c.hours; r.cost += c.cost; r.gmv += c.gmv; r.estHours += c.estHours;
    m.set(key, r);
  }
  const rows = [...m.values()];
  return dim === "band" ? rows.sort((a, b) => BANDS.indexOf(a.key as never) - BANDS.indexOf(b.key as never)) : rows.sort((a, b) => b.cost - a.cost);
}

export function costCells(summary: Summary, slots: CostSlot[], { now, upToDay }: { now: number; upToDay?: number }) {
  const salariedNames = new Set(summary.mc.filter((p) => p.salaried).map((p) => p.name));
  const keyOf = (name: string, platform: string, startMs: number) => `${name}|${platform.trim().toLowerCase()}|${startMs}`;
  const detailOf = new Map(summary.details.filter((d) => d.type === "Mc" && !d.cancelled).map((d) => [keyOf(d.name, d.platform, d.startMs), d]));
  const done = slots.filter((s) => s.startMs <= now && (upToDay === undefined || Number(s.date.slice(8)) <= upToDay));

  // ยอดต่อคิว: ที่กรอก (กระจายให้ slot ว่างก่อนหน้าที่ยอดรวมอยู่ด้วยตามชั่วโมง) → ไฟล์ Export
  const extra = new Map<number, CostSlot[]>();
  const byId = new Map(done.map((s) => [s.id, s]));
  for (const [emptyId, by] of gmvCoverage(done.map((s) => ({ id: s.id, platform: s.platform, startMs: s.startMs, endMs: s.endMs, gmv: s.gmv, who: s.mc })))) {
    const e = byId.get(emptyId);
    if (e) extra.set(by.id, [...(extra.get(by.id) ?? []), e]);
  }
  const gmvOf = new Map<number, { gmv: number; est: boolean }>();
  for (const s of done) {
    if (s.gmv === null) continue;
    const unit = [s, ...(extra.get(s.id) ?? [])];
    const h = unit.reduce((a, u) => a + u.hours, 0);
    for (const u of unit) gmvOf.set(u.id, { gmv: h ? (s.gmv * u.hours) / h : 0, est: false });
  }
  for (const s of done) if (!gmvOf.has(s.id) && s.exp && s.exp.hours >= 0.5) gmvOf.set(s.id, { gmv: s.exp.gmv, est: true });

  const cells = new Map<string, CostCell>();
  const part = (): CostAppPart & { totals: CostTotals } => ({
    totals: { slots: 0, hours: 0, cost: 0, gmv: 0 }, prev: { slots: 0, hours: 0, cost: 0, gmv: 0 }, unknown: { slots: 0, cost: 0 }, salaried: 0,
  });
  const all = part();
  const byApp: Record<McCostApp, ReturnType<typeof part>> = { TikTok: part(), Shopee: part() };
  for (const s of done) {
    if (salariedNames.has(s.mc)) {
      all.salaried++; byApp[isShopeePlatform(s.platform) ? "Shopee" : "TikTok"].salaried++;
      continue;
    }
    // ไม่อยู่ในสรุปรายเดือน (บัญชีทดสอบ / ยังไม่ยืนยัน) = ไม่นับ
    const d = detailOf.get(keyOf(s.mc, s.platform, s.startMs));
    if (!d) continue;
    const app: McCostApp = d.shopee ? "Shopee" : "TikTok";
    const cost = slotPay(d.hours, d.lateMinutes, d.bonusMinutes, itemRate(summary, "Mc", d));
    const g = gmvOf.get(s.id);
    if (!g) {
      for (const p of [all, byApp[app]]) { p.unknown.slots++; p.unknown.cost += cost; }
      continue;
    }
    const cell = { mc: s.mc, platform: s.platform, band: s.band, camp: s.camp ? instLabel(s.camp) : "วันปกติ", app };
    const k = Object.values(cell).join("|");
    const c = cells.get(k) ?? { ...cell, slots: 0, hours: 0, cost: 0, gmv: 0, estHours: 0 };
    c.slots++; c.hours += d.hours; c.cost += cost; c.gmv += g.gmv;
    if (g.est) c.estHours += d.hours;
    cells.set(k, c);
    for (const p of [all, byApp[app]]) { p.totals.slots++; p.totals.hours += d.hours; p.totals.cost += cost; p.totals.gmv += g.gmv; }
  }
  return { cells: [...cells.values()], totals: all.totals, unknown: all.unknown, salaried: all.salaried, byApp };
}
