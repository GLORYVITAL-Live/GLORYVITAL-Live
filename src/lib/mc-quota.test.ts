// เทสสิทธิ์จองคิวของ Mc ต่อเดือนตามแร็งค์ (bun test)
import { describe, expect, test } from "bun:test";
import { autoQuota, prevMonth, quotaBlock, settleDate, totalQuota } from "@/lib/mc-quota";

describe("สิทธิ์อัตโนมัติตามแร็งค์", () => {
  test("A: 110% = 15 ไล่ขึ้นถึง 130% = 25 (เกินกว่านั้นไม่เพิ่ม)", () => {
    expect(autoQuota("A", 1.1)).toBe(15);
    expect(autoQuota("A", 1.2)).toBe(20);
    expect(autoQuota("A", 1.3)).toBe(25);
    expect(autoQuota("A", 1.6)).toBe(25);
  });
  test("B: 95% = 7 ไล่ขึ้นถึง 110% = 15", () => {
    expect(autoQuota("B", 0.95)).toBe(7);
    expect(autoQuota("B", 1.025)).toBe(11);
    expect(autoQuota("B", 1.0999)).toBe(15);
  });
  test("C / ยังไม่มีอันดับ = 6", () => {
    expect(autoQuota("C", 0.8)).toBe(6);
    expect(autoQuota(null, null)).toBe(6);
    expect(autoQuota("A", null)).toBe(6);
  });
  test("คะแนนมากขึ้น สิทธิ์ไม่ลด (ต่อเนื่องจาก B ไป A)", () => {
    let last = 0;
    for (let s = 0.95; s <= 1.4; s += 0.005) {
      const q = autoQuota(s >= 1.1 ? "A" : "B", s);
      expect(q).toBeGreaterThanOrEqual(last);
      last = q;
    }
  });
  test("สิทธิ์รวม = อัตโนมัติ + เพิ่มพิเศษ ไม่ต่ำกว่า 0", () => {
    expect(totalQuota(6, 3)).toBe(9);
    expect(totalQuota(6, -10)).toBe(0);
  });
});

describe("เดือน", () => {
  test("เดือนก่อน (ข้ามปี)", () => {
    expect(prevMonth("2026-11")).toBe("2026-10");
    expect(prevMonth("2027-01")).toBe("2026-12");
  });
  test("ล็อกแร็งค์ = เดือนก่อนจบ + 3 วัน", () => {
    expect(settleDate("2026-11")).toBe("2026-11-04");
    expect(settleDate("2027-01")).toBe("2027-01-04");
  });
});

describe("หน้าจอง: ครบสิทธิ์ของเดือน", () => {
  const q = { month: "2026-11", max: 7, used: 5, tier: "B" as const, settled: false };
  test("ยังเหลือ = เลือกได้", () => {
    expect(quotaBlock(q, 0)).toBe("");
    expect(quotaBlock(q, 1)).toBe("");
  });
  test("จองแล้ว + เลือกอยู่ ครบสิทธิ์ = เลือกเพิ่มไม่ได้", () => {
    expect(quotaBlock(q, 2)).toBe("ครบสิทธิ์จองของเดือนนี้แล้ว (7 slot · แร็งค์ B)");
    expect(quotaBlock({ ...q, used: 9 }, 0)).not.toBe("");
  });
  test("ไม่จำกัด (ไม่มีสิทธิ์ของเดือนนั้น)", () => expect(quotaBlock(undefined, 50)).toBe(""));
});
