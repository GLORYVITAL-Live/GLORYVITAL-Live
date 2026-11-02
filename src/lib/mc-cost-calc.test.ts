// เทสความคุ้มค่า Mc (bun test): ค่าจ้างสูตรเดียวกับสรุปรายเดือน · ไม่นับ Mc ประจำ · ยอดต่อคิว ที่กรอก → Export → ยังไม่มียอด
import { describe, expect, test } from "bun:test";
import { costCells, type CostSlot } from "@/lib/mc-cost-calc";
import type { OwnerDetail, OwnerPerson, OwnerSummary } from "@/lib/types";

const at = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+07:00`);
const slot = (id: number, mc: string, platform: string, date: string, start: string, hours: number, o: Partial<CostSlot> = {}): CostSlot => ({
  id, mc, platform, date, startMs: at(date, start), endMs: at(date, start) + hours * 3600_000, hours,
  band: Number(start.slice(0, 2)) >= 19 ? "ไพรม์" : "บ่าย", gmv: null, camp: null, exp: null, ...o,
});
const detail = (s: CostSlot, shopee = false): OwnerDetail => ({
  type: "Mc", name: s.mc, date: s.date, start: "", end: "", platform: s.platform, hours: s.hours, startMs: s.startMs, status: "", cancelled: false, pair: "",
  lateMinutes: null, bonusMinutes: null, lateFromProof: false, bonusFromProof: false, proof: null, noProof: false, gmv: null, gmvCoveredBy: null, campaign: "",
  ...(shopee ? { shopee: true } : {}),
});
const person = (name: string, salaried = false): OwnerPerson => ({ name, slots: 0, hours: 0, paidHours: 0, lateSlots: 0, bonusMinutes: 0, days: 0, cancelled: 0, commit: null, salaried });

const slots = [
  slot(1, "Mc เอ", "GLORY MALL", "2026-11-01", "19:00", 2), // ยอดรวมอยู่ใน slot ถัดไป
  slot(2, "Mc เอ", "GLORY MALL", "2026-11-01", "21:00", 2, { gmv: 20000 }),
  slot(3, "Mc ซี", "Shopee", "2026-11-01", "13:00", 2, { exp: { gmv: 6000, hours: 2 } }),
  slot(4, "Mc ซี", "Shopee", "2026-11-02", "13:00", 2), // ยังไม่มียอด
  slot(5, "Mc บี", "GLORY MALL", "2026-11-01", "13:00", 2, { gmv: 50000 }), // Mc ประจำ
  slot(6, "Mc เอ", "GLORY MALL", "2026-11-03", "19:00", 2), // ยังไม่ถึง
];
const rates: OwnerSummary["rates"] = { mc: { "Mc เอ": 500, "Mc ซี": 400 }, admin: {}, shopee: { "Mc ซี": 300 }, defaultMc: 0, defaultAdmin: 0 };
const summary = {
  rates, admin: [], mc: [person("Mc เอ"), person("Mc บี", true), person("Mc ซี")],
  details: slots.map((s) => detail(s, s.platform === "Shopee")),
};
const now = at("2026-11-02", "20:00");

describe("ความคุ้มค่า Mc", () => {
  const r = costCells(summary, slots, { now });

  test("ยอดที่กรอกรวม slot ว่างก่อนหน้า · ยอดจาก Export = ประมาณ · เรท Shopee แยก", () => {
    expect(r.cells).toEqual([
      { mc: "Mc เอ", platform: "GLORY MALL", band: "ไพรม์", camp: "วันปกติ", app: "TikTok", slots: 2, hours: 4, cost: 2000, gmv: 20000, estHours: 0 },
      { mc: "Mc ซี", platform: "Shopee", band: "บ่าย", camp: "วันปกติ", app: "Shopee", slots: 1, hours: 2, cost: 600, gmv: 6000, estHours: 2 },
    ]);
    expect(r.totals).toEqual({ slots: 3, hours: 6, cost: 2600, gmv: 26000 });
  });

  test("ไม่นับ Mc ประจำ · คิวที่ยังไม่มียอดแยกไว้ · คิวที่ยังไม่ถึงไม่นับ", () => {
    expect(r.salaried).toBe(1);
    expect(r.unknown).toEqual({ slots: 1, cost: 600 });
  });

  test("เดือนก่อนนับถึงวันที่เดียวกัน", () => {
    const p = costCells(summary, slots, { now, upToDay: 1 });
    expect(p.totals).toEqual({ slots: 3, hours: 6, cost: 2600, gmv: 26000 });
    expect(p.unknown).toEqual({ slots: 0, cost: 0 });
  });
});
