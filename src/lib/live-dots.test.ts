// เทสจุดของกราฟ "แต่ละไลฟ์" (bun test)
import { describe, expect, test } from "bun:test";
import { hasStartTimes, liveDots, startOffset, startTickLabel } from "@/lib/live-dots";
import type { LiveSession } from "@/lib/live-stats";

const live = (d: string, t: string, min: number, gmv: number, platform = "TikTok") => ({
  platform, accountId: "1", accountName: "", title: "", startedAt: new Date(Date.parse(`${d}T${t}:00+07:00`)).toISOString(), durationSec: min * 60,
  gmv, orders: 0, itemsSold: 0, customers: null, viewers: 0, views: null, engagedViewers: null, avgViewSec: null, comments: null, shares: null, likes: null,
  newFollowers: null, addToCart: null, impressions: null, clicks: null,
}) as unknown as LiveSession;

describe("แกนเวลาเริ่ม", () => {
  test("นับจาก 05:00 ไลฟ์หลังเที่ยงคืนอยู่ท้ายแกน", () => {
    expect(startOffset(live("2026-11-03", "06:00", 60, 0).startedAt)).toBe(1);
    expect(startOffset(live("2026-11-03", "19:30", 60, 0).startedAt)).toBe(14.5);
    expect(startOffset(live("2026-11-03", "00:00", 60, 0).startedAt)).toBe(19);
    expect(startOffset(live("2026-11-03", "04:30", 60, 0).startedAt)).toBe(23.5);
  });
  test("ไลฟ์ที่เปิดก่อน 06:00 ไม่กี่นาทีอยู่ต้นแกน ไม่ไปท้ายแกน", () => {
    expect(startOffset(live("2026-11-03", "05:54", 60, 0).startedAt)).toBeCloseTo(0.9);
  });
  test("ป้ายแกน", () => {
    expect(startTickLabel(1)).toBe("06:00");
    expect(startTickLabel(19)).toBe("00:00");
    expect(startTickLabel(22)).toBe("03:00");
  });
  test("เดือนก่อน ส.ค. 2026 ไม่มีเวลาเริ่มจริง", () => {
    expect(hasStartTimes("2026-07")).toBe(false);
    expect(hasStartTimes("2026-08")).toBe(true);
    expect(hasStartTimes("2026-11")).toBe(true);
  });
});

describe("จุดของแต่ละไลฟ์", () => {
  const list = [live("2026-11-03", "19:30", 240, 80000), live("2026-11-03", "09:30", 120, 60000, "Shopee"), live("2026-11-06", "06:00", 0, 39932)];
  test("แกนเวลาเริ่ม: เรียงตามเวลา + GMV/ชม. ของไลฟ์นั้น + ข้ามไลฟ์ 0 นาที", () => {
    const { dots, skipped } = liveDots(list, "gmvPerHour", "start");
    expect(dots.map((d) => [d.x, d.y])).toEqual([[4.5, 30000], [14.5, 20000]]);
    expect(skipped).toBe(1);
  });
  test("แกนเวลาเริ่ม + GMV: ไลฟ์ 0 นาทีมียอดก็แสดงได้", () => {
    const { dots, skipped } = liveDots(list, "gmv", "start");
    expect(dots.map((d) => [d.x, d.y])).toEqual([[1, 39932], [4.5, 60000], [14.5, 80000]]);
    expect(skipped).toBe(0);
  });
  test("แกนความยาว: เป็นชั่วโมง + ข้ามไลฟ์ 0 นาทีเสมอ", () => {
    const { dots, skipped } = liveDots(list, "gmv", "length");
    expect(dots.map((d) => [d.x, d.y])).toEqual([[2, 60000], [4, 80000]]);
    expect(skipped).toBe(1);
  });
  test("ไม่มีไลฟ์ = ว่าง", () => {
    expect(liveDots([], "gmv", "start")).toEqual({ dots: [], skipped: 0 });
  });
});
