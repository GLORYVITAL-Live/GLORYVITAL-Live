// เทสตรวจคนก่อนใส่ slot / คนเดียวกันซ้อนเวลา / บัญชีทดสอบ (bun test)
import { describe, expect, test } from "bun:test";
import { assignWarnings, blockCount, isTestAccount, samePersonOverlaps } from "@/lib/staff-check";

const h = (n: number) => Date.UTC(2026, 9, 20, n) - 7 * 3600_000; // เวลาไทย 20 ต.ค. 2026 n โมง
const span = (a: number, b: number, label = `${a}-${b}`) => ({ date: "2026-10-20", startMs: h(a), endMs: h(b), label });
const mcLimits = { slotsPerDay: 2, hoursPerDay: 4, blocksPerDay: null, perRequest: 10 };
const adminLimits = { slotsPerDay: 4, hoursPerDay: 8, blocksPerDay: 2, perRequest: 10 };

describe("บัญชีทดสอบ", () => {
  test.each([["ทดสอบ", true], ["Mc ทดสอบ 1", true], ["test", true], ["Test2", true], ["มะนาวtest", true], ["Mc test", true]] as const)(
    "%p = บัญชีทดสอบ", (n, v) => expect(isTestAccount(n)).toBe(v));
  test.each([["มะนาว", false], ["Celestest", false], ["Contest", false], ["", false]] as const)(
    "%p = ไม่ใช่", (n, v) => expect(isTestAccount(n)).toBe(v));
});

describe("เตือนก่อนใส่คนใน slot", () => {
  test("ไม่มีคิวอื่น = ไม่เตือน", () => expect(assignWarnings(span(10, 12), [], mcLimits)).toEqual([]));
  test("เวลาทับกับคิวเดิม (คนละช่อง) = เตือน พร้อมบอกคิว", () => {
    const w = assignWarnings(span(10, 12), [span(11, 13, "Shopee 11:00–13:00")], mcLimits);
    expect(w[0]).toContain("Shopee 11:00–13:00");
  });
  test("คิวต่อกันพอดีไม่นับว่าทับ", () => expect(assignWarnings(span(12, 14), [span(10, 12)], mcLimits)).toEqual([]));
  test("เกินโควต้า slot / ชั่วโมงต่อวัน", () => {
    const w = assignWarnings(span(16, 18), [span(10, 12), span(13, 15)], mcLimits);
    expect(w.some((x) => x.includes("เกินโควต้า 2 slot/วัน"))).toBe(true);
    expect(w.some((x) => x.includes("6 ชม."))).toBe(true);
  });
  test("Admin เสริม: เกินจำนวนช่วงต่อวัน", () => {
    const w = assignWarnings(span(18, 20), [span(9, 11), span(13, 15)], adminLimits);
    expect(w).toEqual(["วันนี้แบ่งเป็น 3 ช่วง (เกิน 2 ช่วง/วัน)"]);
  });
  test("ไม่เช็กโควต้า (Admin ประจำ) = เตือนแค่เวลาทับ", () => {
    expect(assignWarnings(span(16, 18), [span(10, 12), span(13, 15)], null)).toEqual([]);
  });
  test("นับช่วงต่อเนื่อง", () => expect(blockCount([span(9, 11), span(11, 13), span(15, 17)])).toBe(2));
});

describe("คนเดียวกันอยู่ 2 slot เวลาทับกัน", () => {
  const row = (id: number, pid: number | null, platform: string, a: number, b: number) => ({ id, pid, platform, startMs: h(a), endMs: h(b) });
  test("คนเดียวกัน คนละช่อง เวลาทับ = เจอ", () => {
    const g = samePersonOverlaps([row(1, 7, "TikTok", 10, 12), row(2, 7, "Shopee", 11, 13), row(3, 8, "TikTok", 10, 12)]);
    expect(g.map((x) => x.map((r) => r.id))).toEqual([[1, 2]]);
  });
  test("ต่อกันพอดี / คนละคน / ไม่มีคน = ไม่นับ", () => {
    expect(samePersonOverlaps([row(1, 7, "TikTok", 10, 12), row(2, 7, "TikTok", 12, 14), row(3, null, "A", 10, 12), row(4, null, "B", 10, 12)])).toEqual([]);
  });
  test("แถวซ้ำช่อง + เวลาเดียวกันเป๊ะ ไม่นับ (อยู่ในเรื่องแถวซ้ำแล้ว)", () => {
    expect(samePersonOverlaps([row(1, 7, "TikTok", 10, 12), row(2, 7, "TikTok", 10, 12)])).toEqual([]);
  });
  test("ทับต่อกันเป็นสาย = กลุ่มเดียว", () => {
    const g = samePersonOverlaps([row(1, 7, "A", 10, 12), row(2, 7, "B", 11, 13), row(3, 7, "C", 12.5, 14)]);
    expect(g.map((x) => x.length)).toEqual([3]);
  });
});
