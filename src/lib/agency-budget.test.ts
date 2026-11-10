// เทสงบของกลุ่มภายนอกในหน้า Plan Slot Live: เรทต่อชั่วโมง × ชั่วโมงในแพลน (bun test)
import { describe, expect, test } from "bun:test";
import { budgetSheet, hasBudget, parseRate, validRate } from "@/lib/agency-budget";
import { buildXlsx } from "@/lib/export";

describe("พิมพ์เรท", () => {
  test("ใส่ลูกน้ำ / ฿ / ช่องว่าง / ทศนิยมได้", () => {
    expect(parseRate("2,000")).toBe(2000);
    expect(parseRate("฿ 2300")).toBe(2300);
    expect(parseRate("1500.50")).toBe(1500.5);
  });
  test("ว่าง / 0 = ไม่ตั้งเรท", () => {
    expect(parseRate("")).toBeNull();
    expect(parseRate("  ")).toBeNull();
    expect(parseRate("0")).toBeNull();
  });
  test("พิมพ์ผิด / ติดลบ / สูงผิดปกติ = NaN", () => {
    expect(parseRate("abc")).toBeNaN();
    expect(parseRate("-2000")).toBeNaN();
    expect(parseRate("1000001")).toBeNaN();
  });
  test("เซิร์ฟเวอร์รับเฉพาะตัวเลขที่ถูกต้อง", () => {
    expect(validRate(2000)).toBe(true);
    for (const v of [0, -1, NaN, Infinity, "2000", null, undefined, 1000001]) expect(validRate(v)).toBe(false);
  });
});

test("In house / Vis (KOL) ไม่มีงบ กลุ่มภายนอกมี", () => {
  expect(hasBudget("In house")).toBe(false);
  expect(hasBudget("Vis")).toBe(false);
  for (const a of ["TDH", "Infinite", "MCN"]) expect(hasBudget(a)).toBe(true);
});

describe("แผ่นงบในไฟล์ส่งออก", () => {
  const row = (label: string, rate: number | null, hours: number) => ({ label, channel: "Shopee", rate, hours });
  test("ไม่ตั้งเรทเลย = ไม่มีแผ่น", () => {
    expect(budgetSheet([])).toBeNull();
    expect(budgetSheet([row("MCN", null, 100)])).toBeNull();
  });
  test("งบ = เรท × ชั่วโมง เฉพาะกลุ่มที่ตั้งเรท + แถวรวมนับเฉพาะกลุ่มนั้น", () => {
    const sheet = budgetSheet([row("Agency Infinite", 2000, 100), row("MCN", 1500, 138), row("อื่น", null, 500)])!;
    expect(sheet.name).toBe("งบ Agency");
    expect(sheet.rows.slice(1)).toEqual([
      ["Agency Infinite", "Shopee", { v: 2000, f: "money" }, { v: 100, f: "dec" }, { v: 200000, f: "money" }],
      ["MCN", "Shopee", { v: 1500, f: "money" }, { v: 138, f: "dec" }, { v: 207000, f: "money" }],
      ["รวม", "", null, { v: 238, f: "dec" }, { v: 407000, f: "money" }],
    ]);
  });
  test("ตั้งเรทแล้วแต่ยังไม่มีชั่วโมง = งบ 0 + สร้างไฟล์ได้", () => {
    const sheet = budgetSheet([row("MCN", 2000, 0)])!;
    expect(sheet.rows[1][4]).toEqual({ v: 0, f: "money" });
    expect(buildXlsx({ title: "t", sheets: [sheet] }).length).toBeGreaterThan(0);
  });
  test("เรทที่พิมพ์ผิด (NaN) ไม่ลงไฟล์", () => {
    expect(budgetSheet([row("MCN", NaN, 40)])).toBeNull();
  });
});
