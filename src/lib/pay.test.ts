// เทสกฎคิดเงิน (bun test) — ถ้าแก้กฎใน pay.ts แล้วเทสพัง = ตัวเลขเงินเปลี่ยน ต้องตั้งใจเปลี่ยนจริง
import { describe, expect, test } from "bun:test";
import {
  bonusPaidMinutes, cleanTiers, lateCut, monthRate, paidHours, parseBonusMinutes, parseLateMinutes, parseTierHours,
  checkInOf, monthsToLock, platformRates, resolveLateBonus, slotPaidHours, slotPay, sumPay,
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

describe("เรท Shopee แยกรายคน", () => {
  const tiers = [{ hours: 10, rate: 700 }];
  test("ไม่ตั้งเรท Shopee = ใช้เรทเดียวกับ TikTok และ Commit นับทุกชั่วโมง (เหมือนเดิม)", () => {
    expect(platformRates(750, tiers, null, 6, 6)).toMatchObject({ split: false, rate: 700, shopeeRate: 700, commitHours: 12 });
    expect(platformRates(500, [], 0, 0, 20)).toMatchObject({ split: false, rate: 500, shopeeRate: 500 });
  });
  test("ตั้งเรท Shopee = ไลฟ์ Shopee คิดเรทคงที่ · Commit นับเฉพาะชั่วโมง TikTok", () => {
    expect(platformRates(750, tiers, 500, 6, 6)).toMatchObject({ split: true, rate: 750, shopeeRate: 500, commitHours: 6 });
    expect(platformRates(750, tiers, 500, 12, 30)).toMatchObject({ rate: 700, shopeeRate: 500 });
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

describe("ปัดเงินทีละคิวแล้วรวม (ทุกหน้าใช้สูตรเดียวกับไฟล์เบิก)", () => {
  test("คิวเดียว = ปัดเป็นบาท", () => {
    expect(slotPay(2, null, null, 333)).toBe(666);
    expect(slotPay(1.5, 10, null, 333)).toBe(350); // 1.05 ชม. x 333 = 349.65
    expect(slotPay(2, null, null, 0)).toBe(0);
  });
  test("ยอดรวม = ผลรวมของคิวที่ปัดแล้ว (ไม่ใช่ปัดจากชั่วโมงรวม)", () => {
    const items = [1.5, 1.5, 1.5].map((hours) => ({ hours, lateMinutes: 10, bonusMinutes: null }));
    expect(sumPay(items, 333)).toBe(350 * 3); // ปัดจากชั่วโมงรวม 3.15 x 333 = 1048.95 -> 1049 (ต่าง 1 บาท)
  });
  test("ชั่วโมงเศษยาวปัด 2 ตำแหน่งก่อน (ตรงกับไฟล์เบิกเดิม)", () => {
    expect(slotPay(5 / 3, null, null, 600)).toBe(Math.round(1.67 * 600));
  });
});

describe("เวลาเข้างานจริงจากหมายเหตุ (เข้า HH:MM)", () => {
  const at = (d: string, t: string) => Date.parse(`${d}T${t}:00+07:00`);
  const s0 = at("2026-10-19", "09:30"), s1 = at("2026-10-19", "11:30");
  test.each([
    ["เข้า 10:00", 1.5], ["เข้า10.00", 1.5], ["Admin เสริม เข้า 10:00", 1.5], ["เข้างาน 11:00", 0.5], ["เข้า 9:30", 2],
  ] as const)("%p ใน slot 09:30–11:30 = %p ชม.", (remark, hours) => {
    expect(checkInOf(remark, s0, s1)).toMatchObject({ bad: false, hours });
  });
  test("ไม่มีคำว่า เข้า + ตัวเลข = ไม่ใช้ (จ่ายตามปกติ)", () => {
    expect(checkInOf("", s0, s1)).toBeNull();
    expect(checkInOf(null, s0, s1)).toBeNull();
    expect(checkInOf("Admin เสริม", s0, s1)).toBeNull();
    expect(checkInOf("เข้าช้า ติดรถ", s0, s1)).toBeNull();
  });
  test("เวลานอกช่วง slot / อ่านไม่ได้ = ใช้ไม่ได้ (เตือน)", () => {
    expect(checkInOf("เข้า 9:00", s0, s1)).toMatchObject({ bad: true, reason: "เวลาเข้าอยู่นอกช่วง slot" });
    expect(checkInOf("เข้า 11:30", s0, s1)).toMatchObject({ bad: true });
    expect(checkInOf("เข้า 12:15", s0, s1)).toMatchObject({ bad: true });
    expect(checkInOf("เข้า 10", s0, s1)).toMatchObject({ bad: true, reason: "อ่านเวลาไม่ได้ (ใช้รูปแบบ เข้า 10:00)" });
    expect(checkInOf("เข้า 25:00", s0, s1)).toMatchObject({ bad: true });
  });
  test("slot ข้ามเที่ยงคืน: เวลาเข้าหลังเที่ยงคืนนับเป็นวันถัดไป", () => {
    const n0 = at("2026-10-19", "23:00"), n1 = at("2026-10-20", "01:00");
    expect(checkInOf("เข้า 0:30", n0, n1)).toMatchObject({ bad: false, hours: 0.5, time: "00:30" });
    expect(checkInOf("เข้า 23:45", n0, n1)).toMatchObject({ bad: false, hours: 1.25 });
    expect(checkInOf("เข้า 9:45", n0, n1)).toMatchObject({ bad: true });
  });
  test("slot เช้าที่เริ่มหลังเที่ยงคืน (00:30–02:30) เข้า 1:00 = 1.5 ชม.", () => {
    expect(checkInOf("เข้า 1:00", at("2026-10-20", "00:30"), at("2026-10-20", "02:30"))).toMatchObject({ bad: false, hours: 1.5 });
  });
  test("ข้อความเวลาเข้าไม่ถูกอ่านเป็นนาทีสาย / ชดเชย (Mc ใช้ช่องเดียวกัน)", () => {
    expect(parseLateMinutes("เข้า 10:00")).toBeNull();
    expect(parseBonusMinutes("เข้า 10:00")).toBeNull();
    expect(parseLateMinutes("เข้า10.00")).toBeNull();
  });
});

describe("เปลี่ยนเรท: เดือนที่ล็อกเรทเดิมไว้", () => {
  test("มีผลเดือนหน้า เดือนนี้ยังไม่มีคิว = ล็อกเดือนนี้ด้วย", () => {
    expect(monthsToLock([], "2026-12", "2026-11")).toEqual(["2026-11"]);
  });
  test("รวมเดือนเก่าที่มีคิว ไม่เอาเดือนตั้งแต่ที่มีผล", () => {
    expect(monthsToLock(["2026-09", "2026-11", "2026-12", "2027-01"], "2026-12", "2026-11")).toEqual(["2026-09", "2026-11"]);
  });
  test("มีผลเดือนนี้ = ล็อกแค่เดือนเก่าที่มีคิว", () => {
    expect(monthsToLock(["2026-10"], "2026-11", "2026-11")).toEqual(["2026-10"]);
  });
  test("มีผลย้อนหลัง (เดือนก่อน) = ไม่ล็อกเดือนนี้", () => {
    expect(monthsToLock(["2026-08", "2026-10"], "2026-10", "2026-11")).toEqual(["2026-08"]);
  });
  test("ข้ามปี", () => {
    expect(monthsToLock([], "2027-01", "2026-12")).toEqual(["2026-12"]);
  });
});
