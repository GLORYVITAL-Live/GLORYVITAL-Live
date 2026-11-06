// เทสงบรายเดือนของกลุ่มภายนอกในหน้า Plan Slot Live (bun test)
import { describe, expect, test } from "bun:test";
import { budgetSheet, hasBudget, parseBudget, perHour, validBudget } from "@/lib/agency-budget";
import { buildXlsx } from "@/lib/export";

describe("พิมพ์งบ", () => {
  test("ใส่ลูกน้ำ / ฿ / ช่องว่างได้", () => {
    expect(parseBudget("1,200,000")).toBe(1200000);
    expect(parseBudget("฿ 50000")).toBe(50000);
    expect(parseBudget("1500.50")).toBe(1500.5);
  });
  test("ว่าง / 0 = ไม่ตั้งงบ", () => {
    expect(parseBudget("")).toBeNull();
    expect(parseBudget("  ")).toBeNull();
    expect(parseBudget("0")).toBeNull();
  });
  test("พิมพ์ผิด / ติดลบ / สูงผิดปกติ = NaN", () => {
    expect(parseBudget("abc")).toBeNaN();
    expect(parseBudget("-5000")).toBeNaN();
    expect(parseBudget("100000001")).toBeNaN();
  });
  test("เซิร์ฟเวอร์รับเฉพาะตัวเลขที่ถูกต้อง", () => {
    expect(validBudget(50000)).toBe(true);
    for (const v of [0, -1, NaN, Infinity, "50000", null, undefined, 100000001]) expect(validBudget(v)).toBe(false);
  });
});

describe("งบต่อกลุ่ม", () => {
  test("In house ไม่มีงบ กลุ่มภายนอกมี", () => {
    expect(hasBudget("In house")).toBe(false);
    for (const a of ["TDH", "Infinite", "MCN"]) expect(hasBudget(a)).toBe(true);
  });
  test("งบต่อชั่วโมง", () => {
    expect(perHour(88000, 88)).toBe(1000);
    expect(perHour(null, 88)).toBeNull();
    expect(perHour(88000, 0)).toBeNull();
  });
});

describe("แผ่นงบในไฟล์ส่งออก", () => {
  const row = (label: string, amount: number | null, hours: number) => ({ label, channel: "Shopee", amount, hours });
  test("ไม่ตั้งงบเลย = ไม่มีแผ่น", () => {
    expect(budgetSheet([])).toBeNull();
    expect(budgetSheet([row("MCN", null, 100)])).toBeNull();
  });
  test("แสดงเฉพาะกลุ่มที่ตั้งงบ + แถวรวมนับเฉพาะกลุ่มนั้น", () => {
    const sheet = budgetSheet([row("Agency Infinite", 100000, 100), row("MCN", 60000, 40), row("อื่น", null, 500)])!;
    expect(sheet.name).toBe("งบ Agency");
    expect(sheet.rows.slice(1)).toEqual([
      ["Agency Infinite", "Shopee", { v: 100000, f: "money" }, { v: 100, f: "dec" }, { v: 1000, f: "money" }],
      ["MCN", "Shopee", { v: 60000, f: "money" }, { v: 40, f: "dec" }, { v: 1500, f: "money" }],
      ["รวม", "", { v: 160000, f: "money" }, { v: 140, f: "dec" }, { v: 160000 / 140, f: "money" }],
    ]);
  });
  test("ตั้งงบแล้วแต่ยังไม่มีชั่วโมง = ไม่มีงบต่อชั่วโมง ไม่หารศูนย์ + สร้างไฟล์ได้", () => {
    const sheet = budgetSheet([row("MCN", 60000, 0)])!;
    expect(sheet.rows[1][4]).toBeNull();
    expect(buildXlsx({ title: "t", sheets: [sheet] }).length).toBeGreaterThan(0);
  });
  test("งบที่พิมพ์ผิด (NaN) ไม่ลงไฟล์", () => {
    expect(budgetSheet([row("MCN", NaN, 40)])).toBeNull();
  });
});
