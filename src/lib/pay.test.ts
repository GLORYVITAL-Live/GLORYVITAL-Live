// เทสกฎคิดเงิน (bun test) — ถ้าแก้กฎใน pay.ts แล้วเทสพัง = ตัวเลขเงินเปลี่ยน ต้องตั้งใจเปลี่ยนจริง
import { describe, expect, test } from "bun:test";
import {
  bonusPaidMinutes, cleanTiers, lateCut, monthRate, paidHours, parseBonusMinutes, parseLateMinutes, parseTierHours,
  resolveLateBonus, slotPaidHours,
} from "@/lib/pay";

describe("หักเงินมาสาย", () => {
  test.each([
    [null, 0], [0, 0], [5, 0], [6, 0.3], [30, 0.3], [31, 0.5], [60, 0.5], [61, 1], [180, 1],
  ] as const)("สาย %p นาที หัก %p", (min, cut) => expect(lateCut(min)).toBe(cut));

  test("ชั่วโมงที่ได้เงิน = ชั่วโมง x (1 - ส่วนที่หัก)", () => {
    expect(paidHours(2, 10)).toBeCloseTo(1.4);
    expect(paidHours(2, null)).toBe(2);
  });
});

describe("ไลฟ์ชดเชย", () => {
  test.each([[null, 0], [3, 0], [5, 15], [10, 15], [16, 30], [20, 30], [45, 60], [60, 60], [75, 75], [90, 90]] as const)(
    "ชดเชย %p นาที ได้เงิน %p นาที", (min, paid) => expect(bonusPaidMinutes(min)).toBe(paid));

  test("slot 2 ชม. สาย 10 นาที + ชดเชย 20 นาที = 1.4 + 0.5 ชม.", () => {
    expect(slotPaidHours(2, 10, 20)).toBeCloseTo(1.9);
  });
});

describe("ค่าจ้างแบบ Commit เป็นขั้น", () => {
  const tiers = [{ hours: 21, rate: 900 }, { hours: 10, rate: 950 }, { hours: 41, rate: 850 }];
  test("เรียงขั้นตามชั่วโมง และตัดข้อมูลผิดทิ้ง", () => {
    expect(cleanTiers([...tiers, { hours: 0, rate: 1 }, { hours: "x", rate: 2 }, null])).toEqual([
      { hours: 10, rate: 950 }, { hours: 21, rate: 900 }, { hours: 41, rate: 850 },
    ]);
  });
  test.each([[0, 1000], [9.5, 1000], [10, 950], [20, 950], [21, 900], [40.5, 900], [41, 850], [200, 850]] as const)(
    "จอง %p ชม. ทั้งเดือนคิด %p บาท/ชม.", (h, rate) => expect(monthRate(1000, tiers, h).rate).toBe(rate));
  test("บอกขั้นถัดไปที่ยังไม่ถึง", () => {
    expect(monthRate(1000, tiers, 15).next).toEqual({ hours: 21, rate: 900 });
    expect(monthRate(1000, tiers, 50).next).toBeNull();
    expect(monthRate(1000, [], 50)).toMatchObject({ rate: 1000, hasCommit: false });
  });
});

describe("อ่านข้อความจากชีต", () => {
  test.each([["10", 10], ["10-20", 10], ["10 ถึง 20 ชม.", 10], ["41+", 41], ["1,000", 1000], ["", null], ["abc", null]] as const)(
    "ขั้น Commit %p -> %p", (v, h) => expect(parseTierHours(v)).toBe(h));

  test.each([
    ["12", 12], ["12 นาที", 12], ["สาย 15", 15], ["มาช้า 20 นาที", 20], ["สาย 1 ชม.", 60], ["0", 0], [25, 25],
    ["เลื่อนเวลา 30 นาที", null], ["", null], ["ชดเชย 10", null],
  ] as const)("สาย %p -> %p", (v, m) => expect(parseLateMinutes(v)).toBe(m));

  test.each([["+10", 10], ["ชดเชย 10", 10], ["ชดเชย10นาที", 10], ["+1 ชม.", 60], ["ชดเชย 0", 0], ["สาย 10", null], ["10", null]] as const)(
    "ชดเชย %p -> %p", (v, m) => expect(parseBonusMinutes(v)).toBe(m));
});

describe("สาย / ชดเชย: ค่าในชีตก่อน ช่องว่างใช้ค่าจากหลักฐานไลฟ์", () => {
  test("ชีตว่าง = ใช้หลักฐาน", () => {
    expect(resolveLateBonus({ late: null, bonus: null }, { late: 7, bonus: 12 })).toEqual({ lateMinutes: 7, bonusMinutes: 12, lateFromProof: true, bonusFromProof: true });
  });
  test("ชีตใส่ 0 = ไม่นับ แม้หลักฐานจะมี", () => {
    expect(resolveLateBonus({ late: 0, bonus: 0 }, { late: 7, bonus: 12 })).toEqual({ lateMinutes: 0, bonusMinutes: 0, lateFromProof: false, bonusFromProof: false });
  });
});
