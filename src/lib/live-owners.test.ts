// เทสแยกยอดไลฟ์ตามกลุ่มจากเวลาในแพลน (bun test)
import { describe, expect, test } from "bun:test";
import { AGENCY_OURS, agencySharesOf, agencyTrend, LIVE_OWNER_OURS, mergePlatforms, ownerShares, ownerSpanOf, splitByOwner } from "@/lib/live-owners";
import type { LiveSession } from "@/lib/live-stats";

const VITAL = "7126874351866037275", SKIN = "7081240278438429722";
const bkk = (d: string, t: string) => Date.parse(`${d}T${t}:00+07:00`);
const plan = (agency: string, platform: string, live_date: string, start_time: string, end_time: string) =>
  ownerSpanOf({ agency, platform, live_date, start_time: `${start_time}:00`, end_time: `${end_time}:00` });
const live = (platform: "TikTok" | "Shopee", accountId: string, d: string, t: string, min: number, gmv: number, orders = 0) => ({
  platform, accountId, accountName: "", title: "", startedAt: new Date(bkk(d, t)).toISOString(), durationSec: min * 60, gmv, orders,
}) as unknown as LiveSession;
const tt = (d: string, t: string, min: number, gmv: number, orders = 0) => live("TikTok", VITAL, d, t, min, gmv, orders);
const sp = (d: string, t: string, min: number, gmv: number) => live("Shopee", "121082485", d, t, min, gmv);

describe("เวลาในแพลน -> เวลาจริง", () => {
  test("เวลาปกติอยู่วันเดิม", () => {
    expect(plan("TDH", "GLORY MALL", "2026-11-03", "19:30", "21:30")).toMatchObject({ startMs: bkk("2026-11-03", "19:30"), endMs: bkk("2026-11-03", "21:30") });
  });
  test("ข้ามเที่ยงคืน: จบวันถัดไป", () => {
    expect(plan("TDH", "GLORY MALL", "2026-11-07", "21:30", "02:30")).toMatchObject({ startMs: bkk("2026-11-07", "21:30"), endMs: bkk("2026-11-08", "02:30") });
  });
  test("เริ่มหลังเที่ยงคืน = เช้าของวันถัดไป (นับเป็นวันไลฟ์เดิม)", () => {
    expect(plan("TDH", "GLORY MALL", "2026-11-10", "01:30", "03:30")).toMatchObject({ startMs: bkk("2026-11-11", "01:30"), endMs: bkk("2026-11-11", "03:30") });
  });
  test("Shopee วันไลฟ์เริ่ม 06:00: 22:00–02:00 ข้ามวัน / 06:00 อยู่วันเดิม", () => {
    expect(plan("MCN", "Shopee", "2026-11-01", "22:00", "02:00")).toMatchObject({ startMs: bkk("2026-11-01", "22:00"), endMs: bkk("2026-11-02", "02:00") });
    expect(plan("MCN", "Shopee", "2026-11-01", "06:00", "09:00").startMs).toBe(bkk("2026-11-01", "06:00"));
  });
});

describe("ไลฟ์ของกลุ่มไหน", () => {
  const tdh = [plan("TDH", "GLORY MALL", "2026-11-03", "19:30", "21:30"), plan("TDH", "GLORY MALL", "2026-11-03", "21:30", "23:30")];
  test("ตรงแพลนพอดี = กลุ่มนั้นทั้งไลฟ์ (ช่วงที่ต่อกันรวมเป็นกลุ่มเดียว)", () => {
    expect(ownerShares(bkk("2026-11-03", "19:30"), 240 * 60, tdh)).toEqual([{ owner: "TDH", share: 1 }]);
  });
  test("นอกแพลน = owner null", () => {
    expect(ownerShares(bkk("2026-11-03", "09:30"), 240 * 60, tdh)).toEqual([{ owner: null, share: 1 }]);
  });
  test("ต่อกันพอดี / คาบเกี่ยวไม่ถึง 10 นาที = ไม่นับ", () => {
    expect(ownerShares(bkk("2026-11-03", "17:29"), 120 * 60, tdh)).toEqual([{ owner: null, share: 1 }]);
    expect(ownerShares(bkk("2026-11-03", "17:30"), 125 * 60, tdh)).toEqual([{ owner: null, share: 1 }]);
    expect(ownerShares(bkk("2026-11-03", "19:26"), 244 * 60, tdh)).toEqual([{ owner: "TDH", share: 1 }]);
  });
  test("คร่อมสองช่วง = แบ่งตามนาที", () => {
    const res = ownerShares(bkk("2026-11-03", "17:30"), 240 * 60, tdh);
    expect(res.find((x) => x.owner === null)?.share).toBe(0.5);
    expect(res.find((x) => x.owner === "TDH")?.share).toBe(0.5);
  });
  test("ไลฟ์ 0 นาที (ยังไลฟ์อยู่ตอน Export) ดูจากเวลาเริ่ม", () => {
    expect(ownerShares(bkk("2026-11-03", "20:00"), 0, tdh)).toEqual([{ owner: "TDH", share: 1 }]);
    expect(ownerShares(bkk("2026-11-03", "10:00"), 0, tdh)).toEqual([{ owner: null, share: 1 }]);
  });
  test("ไลฟ์ 0 นาที เปิดก่อนเวลาแพลนไม่เกิน 10 นาที = กลุ่มของแพลนนั้น · ใกล้หมดแพลนสุดท้ายยังเป็นกลุ่มเดิม", () => {
    expect(ownerShares(bkk("2026-11-03", "19:29"), 0, tdh)).toEqual([{ owner: "TDH", share: 1 }]);
    expect(ownerShares(bkk("2026-11-03", "19:15"), 0, tdh)).toEqual([{ owner: null, share: 1 }]);
    expect(ownerShares(bkk("2026-11-03", "23:25"), 0, tdh)).toEqual([{ owner: "TDH", share: 1 }]);
  });
  test("ไลฟ์สั้นกว่า 20 นาที: นับกลุ่มที่ซ้อนเกินครึ่ง", () => {
    expect(ownerShares(bkk("2026-11-03", "19:25"), 15 * 60, tdh)).toEqual([{ owner: "TDH", share: 1 }]);
  });
});

describe("แยกยอดตามกลุ่ม", () => {
  const spans = [
    plan("TDH", "GLORY MALL", "2026-11-03", "19:30", "23:30"),
    plan("MCN", "Shopee", "2026-11-01", "06:00", "14:00"),
    plan("Infinite", "Shopee", "2026-11-01", "14:00", "22:00"),
    plan("In house", "Shopee", "2026-11-02", "06:00", "14:00"),
  ];
  test("TikTok: แยกของเรา / TDH ยอดรวมเท่าเดิม", () => {
    const [c] = splitByOwner([tt("2026-11-03", "09:30", 240, 65000, 10), tt("2026-11-03", "19:30", 240, 78000, 20)], spans);
    expect(c).toMatchObject({ channel: "GLORY MALL", label: "GLORY VITAL", lives: 2, sec: 480 * 60, gmv: 143000, splitLives: 0 });
    expect(c.rows.map((r) => [r.label, r.gmv, r.orders, r.lives])).toEqual([["Agency TDH", 78000, 20, 1], ["ของเรา", 65000, 10, 1]]);
  });
  test("Shopee: ไลฟ์คร่อมสองกลุ่มแบ่งตามนาที · นอกแพลน = In house · ยอดรวมเท่าเดิม", () => {
    const [c] = splitByOwner([sp("2026-11-01", "10:00", 480, 100000), sp("2026-11-02", "06:00", 480, 30000), sp("2026-11-03", "06:00", 60, 5000)], spans);
    expect(c.rows.map((r) => [r.label, r.gmv])).toEqual([["MCN", 50000], ["Agency Infinite", 50000], ["In house", 35000]]);
    expect(c).toMatchObject({ lives: 3, splitLives: 1, splitGmv: 100000 });
    expect(c.rows.reduce((a, r) => a + r.gmv, 0)).toBe(c.gmv);
    expect(c.rows.reduce((a, r) => a + r.sec, 0)).toBe(c.sec);
    expect(c.rows.find((r) => r.label === "MCN")!.lives).toBe(1);
  });
  test("Shopee: คร่อมแพลน In house กับนอกแพลน = In house กลุ่มเดียว ไม่นับเป็นไลฟ์คร่อมกลุ่ม", () => {
    const [c] = splitByOwner([sp("2026-11-02", "12:00", 240, 8000)], spans);
    expect(c.rows.map((r) => [r.label, r.gmv, r.lives])).toEqual([["In house", 8000, 1]]);
    expect(c.splitLives).toBe(0);
  });
  test("ช่องที่ไม่มีแพลนกลุ่มไม่แสดง / ไม่มีแพลนเลย = ว่าง", () => {
    expect(splitByOwner([live("TikTok", SKIN, "2026-11-03", "09:30", 120, 1000)], spans)).toEqual([]);
    expect(splitByOwner([tt("2026-11-03", "09:30", 240, 65000)], [])).toEqual([]);
    expect(splitByOwner([live("TikTok", "ไม่รู้จัก", "2026-11-03", "09:30", 120, 1000)], spans)).toEqual([]);
  });
  test("เรียง TikTok ก่อน Shopee", () => {
    const res = splitByOwner([sp("2026-11-01", "07:00", 60, 500000), tt("2026-11-03", "19:30", 240, 100)], spans);
    expect(res.map((c) => c.channel)).toEqual(["GLORY MALL", "Shopee"]);
  });
  test("เดือนที่ช่องยังไม่มีแพลน ไม่นับเป็นนอกแพลน (ดูหลายเดือน)", () => {
    const [c] = splitByOwner([sp("2026-10-15", "07:00", 60, 9000), sp("2026-11-01", "07:00", 60, 500)], spans);
    expect(c).toMatchObject({ channel: "Shopee", lives: 1, gmv: 500 });
    expect(c.rows.map((r) => r.label)).toEqual(["MCN"]);
  });
});

describe("แยก Agency ทีละช่วงสำหรับกราฟ (แท่ง TikTok | แท่ง Shopee)", () => {
  const owned = (t: LiveSession, liveOwner: string): LiveSession => ({ ...t, liveOwner });
  const oct = [owned(tt("2026-10-15", "09:30", 600, 60000), LIVE_OWNER_OURS), owned(tt("2026-10-16", "19:30", 240, 40000), "TDH")];
  const sep = [owned(tt("2026-09-15", "09:30", 120, 10000), LIVE_OWNER_OURS)];
  test("GMV / ชม. / GMV ต่อชม. ต่อช่วง · ช่วงที่กลุ่มไม่มีไลฟ์ = null · ไม่มีไลฟ์ทั้งช่วงก็ยังเรียงตามช่วง", () => {
    const res = agencyTrend([sep, oct, []], []);
    expect(res.map((a) => [a.platform, a.key, a.label])).toEqual([["TikTok", AGENCY_OURS, "ของเรา"], ["TikTok", "TDH", "Agency TDH"]]);
    expect(res[0]).toMatchObject({ gmv: [10000, 60000, null], hours: [2, 10, null], perHour: [5000, 6000, null] });
    expect(res[1]).toMatchObject({ gmv: [null, 40000, null], hours: [null, 4, null], perHour: [null, 10000, null] });
  });
  describe("สองแพลตฟอร์ม", () => {
    const spans = [
      plan("MCN", "Shopee", "2026-11-01", "06:00", "10:00"), plan("In house", "Shopee", "2026-11-01", "10:00", "14:00"),
      plan("Infinite", "Shopee", "2026-11-01", "14:00", "18:00"),
    ];
    const list = [
      owned(tt("2026-11-01", "09:30", 60, 100), LIVE_OWNER_OURS), owned(tt("2026-11-01", "19:30", 60, 200), "TDH"), owned(tt("2026-11-01", "21:30", 60, 300), "MCN"),
      sp("2026-11-01", "06:00", 240, 1000), sp("2026-11-01", "10:00", 240, 2000), sp("2026-11-01", "14:00", 240, 3000), sp("2026-11-01", "20:00", 60, 4000),
      live("TikTok", SKIN, "2026-11-01", "12:00", 60, 5000),
    ];
    test("แยกแท่งตามแพลตฟอร์ม TikTok ก่อน · ในแท่งเรียงคงที่ ทีมเราล่างสุด · ยอดต่อแท่งเท่ายอดจริงของแพลตฟอร์ม", () => {
      const res = agencyTrend([list], spans);
      // ไม่ใช่ Agency = ทีมเรา: TikTok ของเรา = 100 + Skin Expert 5000 · Shopee In house = แพลน In house 2000 + นอกแพลน 4000
      expect(res.map((a) => [a.platform, a.label, a.gmv[0]])).toEqual([
        ["TikTok", "ของเรา", 5100], ["TikTok", "Agency TDH", 200], ["TikTok", "MCN", 300],
        ["Shopee", "In house", 6000], ["Shopee", "MCN", 1000], ["Shopee", "Agency Infinite", 3000],
      ]);
      expect(res.find((a) => a.label === "In house")!.key).toBe(AGENCY_OURS);
      for (const p of ["TikTok", "Shopee"]) {
        expect(res.filter((a) => a.platform === p).reduce((a, x) => a + x.gmv[0]!, 0)).toBe(list.filter((s) => s.platform === p).reduce((a, s) => a + s.gmv, 0));
      }
    });
    test("รวมแพลตฟอร์มสำหรับกราฟเส้น: ของเรา + In house / MCN สองแพลตฟอร์ม = เส้นเดียว · GMV/ชม. คิดจากผลรวม", () => {
      const res = mergePlatforms(agencyTrend([list], spans));
      expect(res.map((a) => [a.label, a.gmv[0]])).toEqual([["ของเรา", 11100], ["Agency TDH", 200], ["MCN", 1300], ["Agency Infinite", 3000]]);
      expect(res.find((a) => a.label === "MCN")).toMatchObject({ hours: [5], perHour: [260] });
    });
  });
  test("Shopee เดือนที่ไม่มีข้อมูลกลุ่มเลย (เช่น ก่อน พ.ย.) = In house ทั้งหมด (ยอดรวมยังครบ)", () => {
    const res = agencyTrend([[sp("2026-10-15", "07:00", 60, 9000)], []], []);
    expect(res).toEqual([{ platform: "Shopee", key: AGENCY_OURS, label: "In house", gmv: [9000, null], hours: [1, null], perHour: [9000, null] }]);
  });
  test("กลุ่มของแต่ละไลฟ์ (ใช้กรองตารางช่วงเวลา): คร่อมแพลนแบ่งตามนาที · ไม่มีข้อมูลกลุ่ม = ทีมเรา", () => {
    const spans = [plan("MCN", "Shopee", "2026-11-01", "06:00", "10:00")];
    const a = sp("2026-11-01", "08:00", 240, 1000), b = live("TikTok", SKIN, "2026-11-01", "12:00", 60, 50), c = owned(tt("2026-10-01", "19:30", 60, 70), "TDH");
    const res = agencySharesOf([a, b, c], spans);
    expect([...res.get(a)!]).toEqual([["MCN", 0.5], [AGENCY_OURS, 0.5]]);
    expect([...res.get(b)!]).toEqual([[AGENCY_OURS, 1]]);
    expect([...res.get(c)!]).toEqual([["TDH", 1]]);
  });
  test("TikTok ช่องที่ไม่มีแพลนกลุ่ม (Cherry, Skin Expert, บัญชีอื่น) = ของเรา", () => {
    const CHERRY = "6723716820899365890";
    const res = agencyTrend([[live("TikTok", CHERRY, "2026-11-01", "19:29", 240, 14015), live("TikTok", SKIN, "2026-11-02", "09:28", 240, 23143), live("TikTok", "ไม่รู้จัก", "2026-11-02", "10:00", 60, 50)]], []);
    expect(res.map((a) => [a.key, a.label, a.gmv[0]])).toEqual([[AGENCY_OURS, "ของเรา", 37208]]);
  });
  test("ไลฟ์ 0 นาที: มี GMV แต่ไม่มี GMV/ชม.", () => {
    const [a] = agencyTrend([[owned(tt("2026-10-15", "09:30", 0, 500), "TDH")]], []);
    expect(a).toMatchObject({ gmv: [500], hours: [0], perHour: [null] });
  });
});

describe("ไลฟ์ที่บันทึกกลุ่มไว้แล้ว", () => {
  const owned = (t: LiveSession, liveOwner: string): LiveSession => ({ ...t, liveOwner });
  const spans = [plan("TDH", "GLORY MALL", "2026-11-03", "19:30", "23:30")];
  test("ไม่มีแพลนทั้งเดือนก็แยกได้ · เวลาเริ่มไม่จริง (00:0x) ไม่มีผล", () => {
    const [c] = splitByOwner([owned(tt("2026-06-10", "00:00", 240, 37000, 5), "TDH"), owned(tt("2026-06-10", "00:01", 120, 30000, 3), LIVE_OWNER_OURS)], []);
    expect(c).toMatchObject({ channel: "GLORY MALL", lives: 2, gmv: 67000, splitLives: 0 });
    expect(c.rows.map((r) => [r.owner, r.label, r.gmv, r.sec])).toEqual([["TDH", "Agency TDH", 37000, 14400], [null, "ของเรา", 30000, 7200]]);
  });
  test("ค่าที่บันทึกชนะแพลน: อยู่ในเวลา TDH แต่ยืนยันว่าเป็นของเรา", () => {
    const [c] = splitByOwner([owned(tt("2026-11-03", "19:30", 240, 78000), LIVE_OWNER_OURS)], spans);
    expect(c.rows.map((r) => [r.label, r.gmv])).toEqual([["ของเรา", 78000]]);
  });
  test("กลุ่มอื่น (MCN) แสดงชื่อกลุ่ม", () => {
    const [c] = splitByOwner([owned(tt("2026-04-13", "00:00", 240, 50000), "MCN")], []);
    expect(c.rows.map((r) => r.label)).toEqual(["MCN"]);
  });
  test("ยังไม่ได้บันทึก = เทียบแพลนตามเดิม · รวมหลายเดือนได้", () => {
    const [c] = splitByOwner([owned(tt("2026-10-20", "19:30", 240, 1000), "TDH"), tt("2026-11-03", "19:30", 240, 2000), tt("2026-11-03", "09:30", 240, 4000)], spans);
    expect(c).toMatchObject({ lives: 3, gmv: 7000 });
    expect(c.rows.map((r) => [r.label, r.gmv])).toEqual([["ของเรา", 4000], ["Agency TDH", 3000]]);
  });
});
