// เทสเส้นรายวันของแต่ละแพลตฟอร์ม (bun test)
import { describe, expect, test } from "bun:test";
import { dailyByPlatform } from "@/lib/live-lines";
import type { LiveSession } from "@/lib/live-stats";

const live = (d: string, t: string, min: number, gmv: number, platform = "TikTok") => ({
  platform, accountId: "1", accountName: "", title: "", startedAt: new Date(Date.parse(`${d}T${t}:00+07:00`)).toISOString(), durationSec: min * 60,
  gmv, orders: 0, itemsSold: 0, customers: null, viewers: 0, views: null, engagedViewers: null, avgViewSec: null, comments: null, shares: null, likes: null,
  newFollowers: null, addToCart: null, impressions: null, clicks: null,
}) as unknown as LiveSession;

describe("เส้นรายวัน", () => {
  test("มีทุกวันของเดือน: ก.พ. 28 วัน / พ.ย. 30 วัน", () => {
    expect(dailyByPlatform([], "2026-02", "gmv").days.length).toBe(28);
    expect(dailyByPlatform([], "2026-11", "gmv").days.length).toBe(30);
  });
  test("รวมยอดวันเดียวกัน + แยกแพลตฟอร์ม + TikTok มาก่อนเสมอ", () => {
    const { series } = dailyByPlatform([
      live("2026-11-02", "09:00", 60, 500, "Shopee"), live("2026-11-01", "09:00", 60, 100), live("2026-11-01", "17:00", 60, 200),
    ], "2026-11", "gmv");
    expect(series.map((s) => s.platform)).toEqual(["TikTok", "Shopee"]);
    expect(series[0].values.slice(0, 2)).toEqual([300, null]);
    expect(series[1].values.slice(0, 2)).toEqual([null, 500]);
  });
  test("ตัวชี้วัดต่อชั่วโมงคิดจากยอดรวมของวัน ไม่ใช่เฉลี่ยรายไลฟ์", () => {
    const { series } = dailyByPlatform([live("2026-11-01", "09:00", 60, 1000), live("2026-11-01", "17:00", 180, 2000)], "2026-11", "gmvPerHour");
    expect(series[0].values[0]).toBe(750);
  });
  test("วันที่ไม่มีค่า = null / ไลฟ์ 0 นาทีไม่มี GMV ต่อชั่วโมง", () => {
    const { series } = dailyByPlatform([live("2026-11-01", "09:00", 60, 1000), live("2026-11-03", "06:00", 0, 500)], "2026-11", "gmvPerHour");
    expect(series[0].values.slice(0, 3)).toEqual([1000, null, null]);
  });
  test("ไม่แสดงแพลตฟอร์มที่ไม่มีค่าเลย (เช่น Impressions ของ Shopee)", () => {
    const { series } = dailyByPlatform([live("2026-11-01", "09:00", 60, 1000, "Shopee")], "2026-11", "impressions");
    expect(series).toEqual([]);
  });
  test("ยึดวันตามเวลาไทย: 00:30 ไทยคือวันใหม่", () => {
    const { series } = dailyByPlatform([live("2026-11-02", "00:30", 60, 700)], "2026-11", "gmv");
    expect(series[0].values[1]).toBe(700);
  });
});
