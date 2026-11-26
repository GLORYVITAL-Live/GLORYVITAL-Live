import { describe, expect, test } from "bun:test";
import { achieveOf, costPerHour, gmvPerHour, peopleByRoi, roiOf, sumMonths, type TiktokMcMonth } from "@/lib/tiktok-mc-calc";

const m = (o: Partial<TiktokMcMonth>): TiktokMcMonth => ({
  month: "2026-10", open: false, cost: 0, source: "sheet", gmv: null, hours: 0, salariedHours: 0, slots: 0, target: null, targetGmv: null, ...o,
});

describe("สรุป Mc TikTok", () => {
  test("ROI = GMV ÷ ค่าจ้าง Mc · ไม่มี GMV / ค่าจ้าง = null", () => {
    expect(roiOf(2_000_000, 100_000)).toBe(20);
    expect(roiOf(null, 100_000)).toBeNull();
    expect(roiOf(5000, 0)).toBeNull();
  });
  test("ต้นทุนต่อชั่วโมง: ยอดจากชีตรวม Mc ประจำ · ตัวเลขระบบหารเฉพาะชั่วโมงที่มีค่าจ้าง", () => {
    expect(costPerHour(m({ cost: 60_000, hours: 120, salariedHours: 20, source: "sheet" }))).toBe(500);
    expect(costPerHour(m({ cost: 60_000, hours: 120, salariedHours: 20, source: "system" }))).toBe(600);
    expect(costPerHour(m({ cost: 0, hours: 10 }))).toBeNull();
    expect(gmvPerHour(m({ gmv: 1_200_000, hours: 120 }))).toBe(10_000);
  });
  test("% เป้า = GMV ช่องที่ตั้งเป้า ÷ เป้า · ไม่ตั้งเป้า = null", () => {
    expect(achieveOf(m({ target: 10_000_000, targetGmv: 7_500_000 }))).toBe(0.75);
    expect(achieveOf(m({ target: null, targetGmv: 7_500_000 }))).toBeNull();
  });
  test("รวมทั้งปี: เดือนที่ไม่ตั้งเป้าไม่นับในเป้า · ชั่วโมง Mc ประจำนับเฉพาะเดือนที่ใช้ตัวเลขระบบ", () => {
    const y = sumMonths([
      m({ month: "2026-09", cost: 100, gmv: 2000, hours: 10, salariedHours: 4, slots: 5, target: 3000, targetGmv: 2500, source: "sheet" }),
      m({ month: "2026-10", cost: 200, gmv: 3000, hours: 20, salariedHours: 6, slots: 9, source: "system" }),
      m({ month: "2026-11", cost: 50, gmv: null, hours: 5, slots: 2, target: 1000, targetGmv: 500, source: "system", open: true }),
    ]);
    expect(y).toMatchObject({ cost: 350, gmv: 5000, hours: 35, salariedHours: 6, slots: 16, target: 4000, targetGmv: 3000, open: true, source: "system" });
    expect(costPerHour(y)).toBe(350 / 29);
  });
  test("ราย Mc เรียงตาม ROI · ไม่มีค่าจ้างไว้ท้าย", () => {
    const list = peopleByRoi([
      { mc: "A", slots: 1, hours: 2, cost: 1000, gmv: 10_000, estHours: 0 },
      { mc: "B", slots: 1, hours: 2, cost: 0, gmv: 50_000, estHours: 0 },
      { mc: "C", slots: 1, hours: 2, cost: 1000, gmv: 30_000, estHours: 0 },
    ]);
    expect(list.map((p) => p.mc)).toEqual(["C", "A", "B"]);
  });
});
