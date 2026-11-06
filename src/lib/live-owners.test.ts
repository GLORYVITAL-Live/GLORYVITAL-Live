// เทสแยกยอดไลฟ์ตามกลุ่มจากเวลาในแพลน (bun test)
import { describe, expect, test } from "bun:test";
import { ownerShares, ownerSpanOf, splitByOwner } from "@/lib/live-owners";
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
  test("Shopee: ไลฟ์คร่อมสองกลุ่มแบ่งตามนาที นอกแพลนไว้ท้าย และยอดรวมเท่าเดิม", () => {
    const [c] = splitByOwner([sp("2026-11-01", "10:00", 480, 100000), sp("2026-11-02", "06:00", 480, 30000), sp("2026-11-03", "06:00", 60, 5000)], spans);
    expect(c.rows.map((r) => [r.label, r.gmv])).toEqual([["MCN", 50000], ["Agency Infinite", 50000], ["In house", 30000], ["ไม่อยู่ในแพลน", 5000]]);
    expect(c).toMatchObject({ lives: 3, splitLives: 1, splitGmv: 100000 });
    expect(c.rows.reduce((a, r) => a + r.gmv, 0)).toBe(c.gmv);
    expect(c.rows.reduce((a, r) => a + r.sec, 0)).toBe(c.sec);
    expect(c.rows.find((r) => r.label === "MCN")!.lives).toBe(1);
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
});
