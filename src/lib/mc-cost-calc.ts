import { instLabel, type Band, type CampInfo } from "@/lib/campaign";
import { gmvCoverage } from "@/lib/gmv";
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
};

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
  const totals: CostTotals = { slots: 0, hours: 0, cost: 0, gmv: 0 };
  const unknown = { slots: 0, cost: 0 };
  let salaried = 0;
  for (const s of done) {
    if (salariedNames.has(s.mc)) { salaried++; continue; }
    // ไม่อยู่ในสรุปรายเดือน (บัญชีทดสอบ / ยังไม่ยืนยัน) = ไม่นับ
    const d = detailOf.get(keyOf(s.mc, s.platform, s.startMs));
    if (!d) continue;
    const cost = slotPay(d.hours, d.lateMinutes, d.bonusMinutes, itemRate(summary, "Mc", d));
    const g = gmvOf.get(s.id);
    if (!g) { unknown.slots++; unknown.cost += cost; continue; }
    const cell = {
      mc: s.mc, platform: s.platform, band: s.band, camp: s.camp ? instLabel(s.camp) : "วันปกติ", app: d.shopee ? "Shopee" as const : "TikTok" as const,
    };
    const k = Object.values(cell).join("|");
    const c = cells.get(k) ?? { ...cell, slots: 0, hours: 0, cost: 0, gmv: 0, estHours: 0 };
    c.slots++; c.hours += d.hours; c.cost += cost; c.gmv += g.gmv;
    if (g.est) c.estHours += d.hours;
    cells.set(k, c);
    totals.slots++; totals.hours += d.hours; totals.cost += cost; totals.gmv += g.gmv;
  }
  return { cells: [...cells.values()], totals, unknown, salaried };
}
