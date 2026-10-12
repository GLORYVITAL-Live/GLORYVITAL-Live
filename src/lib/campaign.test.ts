// เทสชื่อแคมเปญ + GMV ต่อ slot (bun test)
import { describe, expect, test } from "bun:test";
import { assignCampaigns, canonicalCampaign, standardCampaigns } from "@/lib/campaign";
import { computeGmv, evalGmv, gmvBeforeMap, gmvCoverage, type GmvSlot } from "@/lib/gmv";

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

  test("ยอดติดลบ = แจ้งเตือน", () => {
    const [x] = computeGmv([{ slot: slot(2, 2, 4, null), input: "100", auto: true }], [slot(1, 0, 2, 500, "Z")]);
    expect(x.gmv).toBe(-400);
    expect(x.error).toBeTruthy();
  });

  test("Mc คนเดียวไลฟ์ต่อกัน กรอกแค่ slot สุดท้าย = slot ก่อนหน้านับว่ารวมอยู่แล้ว", () => {
    const list = [slot(1, 0, 2, 100, "X"), slot(2, 2, 4, null, "A"), slot(3, 4, 6, 900, "A")];
    expect(gmvCoverage(list).get(2)?.id).toBe(3);
    expect(gmvBeforeMap(list).get(3)?.amount).toBe(100); // ข้าม slot ว่างของคนเดียวกัน ไปหักยอดของคนก่อนหน้า
  });
});
