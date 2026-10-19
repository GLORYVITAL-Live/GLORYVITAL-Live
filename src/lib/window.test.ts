// เทสช่วงเปิดจอง (bun test)
import { describe, expect, test } from "bun:test";
import { bookRange, cleanWindow, periodFor, weekEnd, weekStart, windowEnding, type Period } from "@/lib/window";

const today = "2026-10-09"; // วันศุกร์
const cutoff = "2026-10-31"; // เดือนสุดท้ายที่เปิดจอง = ต.ค.

describe("ช่วงที่จองได้จริง (bookRange)", () => {
  test("ไม่จำกัด = วันนี้ ถึงสิ้นเดือนที่เปิดจอง", () => {
    expect(bookRange({ mode: "off", from: null, to: null }, today, cutoff)).toEqual({ from: today, to: cutoff, empty: false });
  });
  test("ไม่จำกัด + ไม่ได้ตั้งเดือนสุดท้าย = ไม่มีวันจบ", () => {
    expect(bookRange(null, today, null)).toEqual({ from: today, to: null, empty: false });
  });
  test("ปิดจอง = จองไม่ได้", () => {
    expect(bookRange({ mode: "closed", from: null, to: null }, today, cutoff).empty).toBe(true);
  });
  test("สัปดาห์นี้ = จันทร์–อาทิตย์ (เริ่มไม่ก่อนวันนี้)", () => {
    expect(weekStart(today)).toBe("2026-10-05");
    expect(weekEnd(today)).toBe("2026-10-11");
    expect(bookRange({ mode: "week", from: null, to: null }, today, cutoff)).toEqual({ from: today, to: "2026-10-11", empty: false });
  });
  test("สัปดาห์นี้ข้ามเดือน = ตัดที่สิ้นเดือนที่เปิดจอง", () => {
    expect(bookRange({ mode: "week", from: null, to: null }, "2026-10-29", cutoff).to).toBe(cutoff);
  });
  test("กำหนดช่วงวัน ไม่ใส่วันสุดท้าย = ถึงสิ้นเดือนที่เปิดจอง", () => {
    expect(bookRange({ mode: "range", from: "2026-10-20", to: null }, today, cutoff)).toEqual({ from: "2026-10-20", to: cutoff, empty: false });
  });
  test("กำหนดช่วงวันเอง เปิดเกินเดือนที่เปิดจองได้ (ให้บางคนจองเดือนหน้าก่อน)", () => {
    expect(bookRange({ mode: "range", from: "2026-11-01", to: "2026-11-30" }, today, cutoff)).toEqual({ from: "2026-11-01", to: "2026-11-30", empty: false });
  });
  test("ช่วงที่ผ่านไปแล้วทั้งหมด = จองไม่ได้", () => {
    expect(bookRange({ mode: "range", from: "2026-10-01", to: "2026-10-05" }, today, cutoff).empty).toBe(true);
  });
});

describe("เตือนช่วงเปิดจองใกล้หมด (windowEnding)", () => {
  const end = (p: Period, t = today, c: string | null = cutoff) => windowEnding(p, bookRange(p, t, c), t, c);
  test("ช่วงวันที่หมดภายใน 2 วัน = เตือน", () => {
    expect(end({ mode: "range", from: "2026-10-01", to: "2026-10-11" })).toEqual({ ended: false, to: "2026-10-11", daysLeft: 2 });
    expect(end({ mode: "range", from: "2026-10-01", to: "2026-10-09" })).toEqual({ ended: false, to: "2026-10-09", daysLeft: 0 });
  });
  test("ยังเหลือหลายวัน = ไม่เตือน", () => expect(end({ mode: "range", from: "2026-10-01", to: "2026-10-20" })).toBeNull());
  test("หมดแล้ว = เตือนว่าหมด", () => {
    expect(end({ mode: "range", from: "2026-10-01", to: "2026-10-05" })).toMatchObject({ ended: true, to: "2026-10-05" });
  });
  test("ไม่จำกัด: ดูเดือนสุดท้ายที่เปิดจอง", () => {
    expect(end({ mode: "off", from: null, to: null }, "2026-10-30")).toEqual({ ended: false, to: cutoff, daysLeft: 1 });
    expect(end({ mode: "off", from: null, to: null }, "2026-11-02")).toMatchObject({ ended: true, to: cutoff });
    expect(end({ mode: "off", from: null, to: null }, today, null)).toBeNull();
  });
  test("ปิดจองตั้งใจ / สัปดาห์นี้ที่เลื่อนเอง = ไม่เตือน", () => {
    expect(end({ mode: "closed", from: null, to: null })).toBeNull();
    expect(end({ mode: "week", from: null, to: null }, "2026-10-10")).toBeNull();
  });
  test("สัปดาห์นี้ที่ถูกตัดด้วยเดือนสุดท้าย = เตือน", () => {
    expect(end({ mode: "week", from: null, to: null }, "2026-10-29")).toEqual({ ended: false, to: cutoff, daysLeft: 2 });
  });
});

describe("รายชื่อจองก่อน", () => {
  const w = cleanWindow({ mode: "range", from: "2026-10-09", to: "2026-10-31", only: [41, "7", 0, -1, 41], early: { mode: "range", from: "2026-11-01", to: "2026-11-30" } })!;
  test("เก็บเฉพาะรหัสคนที่ถูกต้อง ไม่ซ้ำ", () => expect(w.only).toEqual([41, 7]));
  test("คนในรายชื่อได้ช่วงของตัวเอง คนอื่นได้ช่วงทั่วไป", () => {
    expect(periodFor(w, 41)).toEqual({ mode: "range", from: "2026-11-01", to: "2026-11-30" });
    expect(periodFor(w, 99)).toEqual({ mode: "range", from: "2026-10-09", to: "2026-10-31" });
    expect(periodFor(w, null)).toEqual({ mode: "range", from: "2026-10-09", to: "2026-10-31" });
  });
  test("ข้อมูลรุ่นแรก (ไม่มีช่วงแยก) = คนในรายชื่อใช้ช่วงที่ตั้ง คนอื่นปิดจอง", () => {
    const old = cleanWindow({ mode: "week", only: [5] })!;
    expect(periodFor(old, 5).mode).toBe("week");
    expect(periodFor(old, 6).mode).toBe("closed");
  });
  test("ไม่ได้ตั้งอะไรเลย = ไม่จำกัด", () => expect(cleanWindow({ mode: "off" })).toBeNull());
});
