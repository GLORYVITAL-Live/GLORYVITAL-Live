// เทสช่องเดียวกันไลฟ์ทับเวลากันไม่ได้ (bun test)
import { describe, expect, test } from "bun:test";
import { clashes, firstClash, type PlanSpan } from "@/lib/plan-clash";

const s = (start: string, end: string, owner: string | null = null, date = "2026-11-16", platform = "GLORY MALL"): PlanSpan =>
  ({ date, platform, start, end, owner });

describe("ช่องเดียวกันไลฟ์ทับเวลากันไม่ได้", () => {
  test("ของเรา 19:30–21:30 กับ Agency TDH 19:30–21:30 = ทับ (เวลาเดียวกันคนละเจ้าของ)", () => {
    expect(clashes(s("19:30", "21:30"), s("19:30", "21:30", "TDH"))).toBe(true);
  });
  test("ต่อกันพอดี = ไม่ทับ (ของเรา 07:30–21:30 → TDH 21:30–02:30)", () => {
    expect(clashes(s("19:30", "21:30"), s("21:30", "02:30", "TDH"))).toBe(false);
    expect(clashes(s("07:30", "09:30", "TDH"), s("05:30", "07:30"))).toBe(false);
  });
  test("ข้ามเที่ยงคืน: TDH 21:30–02:30 ทับของเรา 23:30–01:30 และ 01:30–03:30", () => {
    expect(clashes(s("21:30", "02:30", "TDH"), s("23:30", "01:30"))).toBe(true);
    expect(clashes(s("21:30", "02:30", "TDH"), s("01:30", "03:30"))).toBe(true);
    expect(clashes(s("21:30", "02:30", "TDH"), s("03:30", "05:30"))).toBe(false);
  });
  test("คนละช่อง / คนละวัน / slot เดียวกันของเจ้าของเดียวกัน = ไม่นับ", () => {
    expect(clashes(s("19:30", "21:30"), s("19:30", "21:30", null, "2026-11-16", "Cherry Glory"))).toBe(false);
    expect(clashes(s("19:30", "21:30"), s("19:30", "21:30", "TDH", "2026-11-17"))).toBe(false);
    expect(clashes(s("19:30", "21:30"), s("19:30", "21:30"))).toBe(false);
  });
  test("Shopee วันไลฟ์เริ่ม 06:00 (22:00–02:00 ไม่ทับ 06:00–09:00)", () => {
    const sp = (start: string, end: string, owner: string) => s(start, end, owner, "2026-11-16", "Shopee");
    expect(clashes(sp("22:00", "02:00", "MCN"), sp("06:00", "09:00", "In house"))).toBe(false);
    expect(clashes(sp("19:00", "22:00", "MCN"), sp("21:00", "23:00", "Infinite"))).toBe(true);
  });
  test("หาตัวที่ทับ", () => {
    const others = [s("07:30", "21:30"), s("21:30", "02:30", "TDH")];
    expect(firstClash(s("20:30", "22:30", "TDH"), others)).toEqual(others[0]);
    expect(firstClash(s("02:30", "05:30", "TDH"), others)).toBeNull();
  });
});
