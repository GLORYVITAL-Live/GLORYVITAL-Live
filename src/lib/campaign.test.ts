// เทสชื่อแคมเปญ + GMV ต่อ slot (bun test)
import { describe, expect, test } from "bun:test";
import { assignCampaigns, canonicalCampaign, standardCampaigns } from "@/lib/campaign";
import { computeGmv, downstreamGmv, evalGmv, gmvBeforeMap, gmvCoverage, parseGmv, type GmvSlot } from "@/lib/gmv";
import { isStandby } from "@/lib/campaign";

test("isStandby: Remark สแตนด์บาย / สำรอง / สแปร์ = ไม่นับเป็นผลงาน Mc (หมายเหตุอื่นที่ทีมใช้ไม่โดน)", () => {
  for (const t of ["สแตนด์บาย CEO", "สแตนบาย", "Standby เผื่อ CEO ลงก่อนเวลา", "สำรอง", "สแปลไว้", "spare"]) expect(isStandby(t)).toBe(true);
  for (const t of ["", "แคน", "เพิ่มสล็อต", "เลท 20นาที", "หัก20% สาย", "โยกไป MCN", "agency", null]) expect(isStandby(t)).toBe(false);
});

describe("ชื่อแคมเปญมาตรฐาน", () => {
  test.each([
    ["10.1", "10.10"], ["10.10", "10.10"], ["3.30000000000001", "3.3"], ["9.9", "9.9"], ["'10.10", "10.10"],
    ["payday", "Pay Day"], ["PAY DAY", "Pay Day"], ["prime days", "Prime Day"], ["midmonth", "Mid Month"], ["ceo live", "CEO Live"],
    ["3.3 x CEO LIVE", "3.3 x CEO LIVE"], ["  ", ""],
  ] as const)("%p -> %p", (raw, name) => expect(canonicalCampaign(raw)).toBe(name));
  test("ตัวเลือกของเดือน ต.ค.", () => expect(standardCampaigns("2026-10")[0]).toBe("10.10"));
});

describe("แคมเปญของแต่ละ slot", () => {
  const map = assignCampaigns([
    { id: 1, date: "2026-10-07", campaign: "10.10" },
    { id: 2, date: "2026-10-10", campaign: "10.1" },
    { id: 3, date: "2026-10-08", campaign: "CEO Live" }, // อยู่ในช่วง 10.10 = นับเข้า 10.10
    { id: 4, date: "2026-10-20", campaign: "CEO Live" }, // นอกช่วงแคมเปญหลัก = แคมเปญของตัวเอง
    { id: 5, date: "2026-10-12", campaign: "" },
  ]);
  test("วันเลขเบิ้ลที่สะกดต่างกันเป็นรอบเดียวกัน", () => {
    expect(map.get(1)?.label).toBe("10.10");
    expect(map.get(2)?.key).toBe(map.get(1)?.key);
  });
  test("แท็กอื่นในช่วงแคมเปญหลัก นับเข้าแคมเปญหลัก", () => {
    expect(map.get(3)?.label).toBe("10.10");
    expect(map.get(3)?.isCeo).toBe(true);
  });
  test("แท็กนอกช่วงแคมเปญหลัก แยกเป็นของตัวเอง / ไม่มีชื่อ = ไม่มีแคมเปญ", () => {
    expect(map.get(4)?.label).toBe("CEO Live");
    expect(map.has(5)).toBe(false);
  });
});

describe("GMV ต่อ slot (ไลฟ์ต่อกันหลาย slot ยอดในแดชบอร์ดเป็นยอดสะสม)", () => {
  const h = (n: number) => Date.UTC(2026, 9, 10, n) as number;
  const slot = (id: number, from: number, to: number, gmv: number | null, who = "A"): GmvSlot => ({ id, platform: "TikTok", startMs: h(from), endMs: h(to), gmv, who });

  test.each([["123,506 - 60540", 62966], ["฿1,000", 1000], ["", null], ["12a", NaN]] as const)("อ่าน %p -> %p", (t, v) => {
    const r = evalGmv(t);
    if (Number.isNaN(v)) expect(r).toBeNaN(); else expect(r).toBe(v);
  });

  test("ตัวอย่างในคู่มือ: หักยอดสะสมของ slot ก่อนหน้าให้อัตโนมัติ", () => {
    const out = computeGmv([
      { slot: slot(1, 0, 2, null, "A"), input: "60540", auto: true },
      { slot: slot(2, 2, 4, null, "B"), input: "123,506", auto: true },
      { slot: slot(3, 4, 6, null, "C"), input: "205564", auto: true },
    ], []);
    expect(out.map((x) => x.gmv)).toEqual([60540, 62966, 82058]);
    expect(out[2].minus).toBe(123506);
  });

  test("ยอดติดลบ = แจ้งให้แก้ slot ก่อนหน้า (ไม่ใช่ให้เอาติ๊กออก)", () => {
    const [x] = computeGmv([{ slot: slot(2, 2, 4, null), input: "100", auto: true }], [slot(1, 0, 2, 500, "Z")]);
    expect(x.gmv).toBe(-400);
    expect(x.error).toContain("slot ก่อนหน้าน่าจะกรอกยอดสะสม");
  });

  test("ไม่ติ๊กหักยอด แต่ตัวเลขมากกว่ายอดสะสมก่อนหน้า = เตือนว่าอาจนับซ้ำ (ยังบันทึกได้)", () => {
    const [x] = computeGmv([{ slot: slot(2, 2, 4, null), input: "552542", auto: false }], [slot(1, 0, 2, 475382, "Z")]);
    expect(x.gmv).toBe(552542);
    expect(x.error).toBeUndefined();
    expect(x.warning).toContain("นับซ้ำ");
    const [y] = computeGmv([{ slot: slot(2, 2, 4, null), input: "77160", auto: false }], [slot(1, 0, 2, 475382, "Z")]);
    expect(y.warning).toBeUndefined();
  });

  test("แก้ยอด slot ก่อนหน้า -> slot ถัดไปที่หักยอดอัตโนมัติคิดใหม่ตาม (ที่กรอกเองไม่แตะ)", () => {
    const stored = (id: number, from: number, to: number, gmv: number | null, input: string | null, minus: number | null, who: string) =>
      ({ ...slot(id, from, to, gmv, who), input, minus });
    // 1 แก้จาก 410,366 (ยอดสะสม ไม่ได้หัก) เป็น 71,329 แล้ว: 2 = 443,015 − ยอดสะสมใหม่ 410,366 · 3 กรอกเองไม่หัก = ไม่แตะ · 4 หักต่อจาก 3
    const all = [
      stored(0, 0, 2, 339037, "339037", null, "A"),
      stored(1, 2, 4, 71329, "410366", 339037, "B"),
      stored(2, 4, 6, 0, "443015", 443015, "C"), // ค่าเก่าที่หักจากยอดผิด
      stored(3, 6, 8, 32367, "32367", null, "B"),
      stored(4, 8, 10, 0, "552542", 552542, "D"),
    ];
    expect(downstreamGmv([1], all).changes).toEqual([{ id: 2, gmv: 32649, minus: 410366 }, { id: 4, gmv: 77160, minus: 475382 }]);
  });

  const stored = (id: number, from: number, to: number, gmv: number | null, input: string | null, minus: number | null, who: string) =>
    ({ ...slot(id, from, to, gmv, who), input, minus });

  test("กรอกไม่เรียงลำดับ: slot หลังกรอกก่อน (ติ๊กหักยอด ยังไม่มียอดก่อนหน้า) -> เก็บ minus 0 แล้ว slot ก่อนหน้ากรอกทีหลังก็หักให้", () => {
    const [late] = computeGmv([{ slot: slot(2, 2, 4, null, "B"), input: "123506", auto: true }], [slot(1, 0, 2, null, "A")]);
    expect(late.gmv).toBe(123506);
    expect(late.minus).toBe(0); // ไม่ใช่ null ไม่งั้น downstreamGmv ข้าม = ยอดนับซ้ำ
    const all = [stored(1, 0, 2, 60540, "60540", 0, "A"), stored(2, 2, 4, late.gmv, late.input, late.minus, "B")];
    expect(downstreamGmv([1], all).changes).toEqual([{ id: 2, gmv: 62966, minus: 60540 }]);
  });

  test("กรอกเองไม่ติ๊กหักยอด = minus null (slot ก่อนหน้าเปลี่ยนก็ไม่แตะ)", () => {
    const [x] = computeGmv([{ slot: slot(2, 2, 4, null, "B"), input: "5000", auto: false }], []);
    expect(x.minus).toBeNull();
  });

  test("แก้ slot ก่อนหน้าจน slot ถัดไปติดลบ = คงค่าเดิม แต่คืนใน negative ให้แจ้งเตือน", () => {
    const all = [stored(1, 0, 2, 900, "900", 0, "A"), stored(2, 2, 4, 500, "600", 100, "B")];
    const r = downstreamGmv([1], all);
    expect(r.changes).toEqual([]);
    expect(r.negative).toEqual([{ id: 2, gmv: -300, minus: 900 }]);
  });

  test("ติดลบใน slot ที่ไม่มียอดก่อนหน้า = ข้อความว่าติดลบไม่ได้ (ไม่ชี้ไป slot ก่อนหน้า)", () => {
    const [x] = computeGmv([{ slot: slot(1, 0, 2, null), input: "-500", auto: true }], []);
    expect(x.error).toBe("ยอด GMV ติดลบไม่ได้");
  });

  test("ป้ายช่วงยอดที่หัก: slot ก่อนหน้าเป็นช่วงที่ Mc คนเดียวไลฟ์ต่อกัน = นับจาก slot แรกของช่วง", () => {
    const list = [slot(1, 0, 2, null, "A"), slot(2, 2, 4, 900, "A"), slot(3, 4, 6, null, "B")];
    const b = gmvBeforeMap(list).get(3);
    expect(b?.amount).toBe(900);
    expect(b?.fromMs).toBe(h(0));
    expect(b?.toMs).toBe(h(4));
  });

  test.each([["20,245 บาท", 20245], ["฿ 1 000", 1000], ["1,234.5", 1234.5], ["12.50", 12.5]] as const)("อ่าน %p -> %p", (t, v) => {
    expect(parseGmv(t)).toEqual({ value: v });
  });

  test.each(["60.540", "1.234.567", "60540.500"])("จุดตามด้วย 3 หลัก %p = กำกวม ให้พิมพ์ใหม่ (ไม่เดา)", (t) => {
    expect(parseGmv(t).error).toContain("กำกวม");
    expect(computeGmv([{ slot: slot(1, 0, 2, null), input: t, auto: true }], [])[0].error).toContain("กำกวม");
  });

  test("ยอดสูงผิดปกติ = เตือน (ยังบันทึกได้)", () => {
    const [x] = computeGmv([{ slot: slot(1, 0, 2, null), input: "60540000", auto: true }], []);
    expect(x.error).toBeUndefined();
    expect(x.warning).toContain("สูงผิดปกติ");
  });

  test("Mc คนเดียวไลฟ์ต่อกัน กรอกแค่ slot สุดท้าย = slot ก่อนหน้านับว่ารวมอยู่แล้ว", () => {
    const list = [slot(1, 0, 2, 100, "X"), slot(2, 2, 4, null, "A"), slot(3, 4, 6, 900, "A")];
    expect(gmvCoverage(list).get(2)?.id).toBe(3);
    expect(gmvBeforeMap(list).get(3)?.amount).toBe(100); // ข้าม slot ว่างของคนเดียวกัน ไปหักยอดของคนก่อนหน้า
  });
});
