// เทสเส้นรายวันของแต่ละแพลตฟอร์ม (bun test)
import { describe, expect, test } from "bun:test";
import { dailyByPlatform, isStackable, platformSeries, totalSeries } from "@/lib/live-lines";
import { METRICS, metricOf, totalsOf, type LiveSession, type MetricKey } from "@/lib/live-stats";

const live = (d: string, t: string, min: number, gmv: number, platform = "TikTok") => ({
  platform, accountId: "1", accountName: "", title: "", startedAt: new Date(Date.parse(`${d}T${t}:00+07:00`)).toISOString(), durationSec: min * 60,
  gmv, orders: 0, itemsSold: 0, customers: null, viewers: 0, views: null, engagedViewers: null, avgViewSec: null, comments: null, shares: null, likes: null,
  newFollowers: null, addToCart: null, impressions: null, clicks: null,
}) as unknown as LiveSession;

describe("แท่งซ้อนแยกแพลตฟอร์ม", () => {
  const all = [
    { ...live("2026-11-01", "09:00", 60, 1000), orders: 10, itemsSold: 12, viewers: 100, views: 200, impressions: 500, clicks: 50 } as LiveSession,
    { ...live("2026-11-01", "17:00", 120, 3000), orders: 20, itemsSold: 25, viewers: 300, views: 400, impressions: 700, clicks: 70 } as LiveSession,
    { ...live("2026-11-01", "06:00", 180, 5000, "Shopee"), orders: 40, itemsSold: 44, viewers: 900 } as LiveSession,
  ];
  test("ตัวชี้วัดที่ซ้อนได้: ส่วนของแต่ละแพลตฟอร์มรวมกัน = ยอดรวมจริงของทั้งกลุ่ม (ไม่งั้นความสูงแท่งโกหก)", () => {
    const stackable = METRICS.map((m) => m.key).filter(isStackable);
    expect(stackable.length).toBeGreaterThan(0);
    for (const key of stackable) {
      const sum = platformSeries([all], key).reduce((a, s) => a + (s.values[0] ?? 0), 0);
      expect(sum).toBeCloseTo(metricOf(key).value(totalsOf(all)) as number);
    }
  });
  test("ค่าต่อหน่วยซ้อนไม่ได้: บวกกันไม่เท่ายอดรวม", () => {
    const perUnit: MetricKey[] = ["gmvPerHour", "viewersPerHour", "impressionsPerHour", "aov", "gmvPerViewer", "ctr", "co"];
    for (const key of perUnit) expect(isStackable(key)).toBe(false);
    const sum = platformSeries([all], "gmvPerHour").reduce((a, s) => a + (s.values[0] ?? 0), 0);
    expect(sum).not.toBeCloseTo(metricOf("gmvPerHour").value(totalsOf(all)) as number);
  });
  test("ตัวชี้วัดทุกตัวถูกจัดเป็นซ้อนได้หรือซ้อนไม่ได้อย่างใดอย่างหนึ่งแบบตั้งใจ", () => {
    expect(METRICS.map((m) => m.key).filter(isStackable).sort()).toEqual(["duration", "gmv", "impressions", "items", "lives", "orders", "viewers", "views"]);
  });
  test("กลุ่มที่ไม่มีไลฟ์ = null · แพลตฟอร์มที่ไม่มีเลยไม่แสดง", () => {
    const res = platformSeries([[live("2026-11-01", "09:00", 60, 100)], []], "gmv");
    expect(res).toEqual([{ platform: "TikTok", values: [100, null] }]);
  });
});

describe("เส้นรวม", () => {
  const tiktok = live("2026-11-01", "09:00", 60, 1000), shopee = live("2026-11-01", "06:00", 180, 5000, "Shopee");
  test("ค่าที่บวกกันได้ = ผลบวกของแต่ละแพลตฟอร์ม", () => {
    expect(totalSeries([[tiktok, shopee]], "gmv")).toEqual([6000]);
  });
  test("ค่าต่อหน่วยคิดจากยอดรวม ไม่ใช่เอาค่าแต่ละแพลตฟอร์มมาบวก", () => {
    expect(totalSeries([[tiktok, shopee]], "gmvPerHour")).toEqual([1500]); // 6,000 ÷ 4 ชม. ไม่ใช่ 1,000 + 1,667
  });
  test("กลุ่มที่ไม่มีไลฟ์ = null", () => {
    expect(totalSeries([[tiktok], []], "gmv")).toEqual([1000, null]);
  });
  test("CO รวมสองแพลตฟอร์มไม่มีค่า แต่ละแพลตฟอร์มยังมีค่าของตัวเอง", () => {
    const a = { ...tiktok, orders: 5, clicks: 50 } as LiveSession, b = { ...shopee, orders: 9, viewers: 90 } as LiveSession;
    expect(totalSeries([[a, b]], "co")).toEqual([null]);
    expect(platformSeries([[a, b]], "co").map((s) => s.values[0])).toEqual([0.1, 0.1]);
  });
});

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
