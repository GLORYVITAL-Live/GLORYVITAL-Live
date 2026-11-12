// เทสตารางช่วงเวลาไหนขายดี (bun test)
import { describe, expect, test } from "bun:test";
import {
  HEAT_MIN_SEC, heatGrid, heatHour, heatImpressionsPerHour, heatOrdersPerHour, heatPerHour, heatSecOf, heatTop, heatValue, heatViewersPerHour,
} from "@/lib/live-heat";

const at = (d: string, t: string) => new Date(Date.parse(`${d}T${t}:00+07:00`)).toISOString();
// 2026-11-06 = ศุกร์ (วัน 4) · 2026-11-07 = เสาร์
const live = (d: string, t: string, min: number, gmv: number, weight?: number, viewers?: number) => ({ startedAt: at(d, t), durationSec: min * 60, gmv, weight, viewers });

describe("ช่วงเวลาไหนขายดี", () => {
  test("GMV กระจายตามนาทีที่อยู่ในแต่ละชั่วโมง · ชั่วโมงไลฟ์ตามจริง", () => {
    const g = heatGrid([live("2026-11-06", "19:30", 90, 3000)]);
    const c19 = g[4][13], c20 = g[4][14]; // 19:00 = แถว 13, 20:00 = แถว 14
    expect(c19).toEqual({ gmv: 1000, orders: 0, viewers: 0, impressions: 0, sec: 1800, impSec: 0, lives: 1 });
    expect(c20).toEqual({ gmv: 2000, orders: 0, viewers: 0, impressions: 0, sec: 3600, impSec: 0, lives: 1 });
    expect(heatPerHour(c20)).toBe(2000);
    expect(heatHour(13)).toBe("19:00");
  });
  test("หลังเที่ยงคืนนับเป็นคืนของวันก่อน (ตี 1 เสาร์ = ศุกร์ 01:00)", () => {
    const g = heatGrid([live("2026-11-06", "23:00", 120, 1200)]);
    expect(g[4][17].gmv).toBe(600); // ศุกร์ 23:00
    expect(g[4][18].gmv).toBe(600); // ศุกร์ 00:00 (เช้ามืดวันเสาร์ตามปฏิทิน)
    expect(g[5][18].gmv).toBe(0);
    expect(heatHour(18)).toBe("00:00");
  });
  test("ไลฟ์ 0 นาที: GMV ลงช่องเวลาเริ่ม ไม่มีชั่วโมง · weight = นับบางส่วน", () => {
    const g = heatGrid([live("2026-11-06", "10:15", 0, 500), live("2026-11-06", "10:00", 60, 1000, 0.25)]);
    expect(g[4][4]).toEqual({ gmv: 750, orders: 0, viewers: 0, impressions: 0, sec: 900, impSec: 0, lives: 2 });
    expect(heatGrid([live("2026-11-06", "10:00", 60, 1000, 0)])[4][4].lives).toBe(0);
  });
  test("อันดับขายดี: เฉพาะช่องที่ไลฟ์รวมถึง 2 ชม. (ช่องตัวอย่างน้อยไม่จัดอันดับ)", () => {
    const g = heatGrid([
      live("2026-11-06", "20:00", 60, 9000), // ศุกร์ 20:00 แค่ 1 ชม.
      live("2026-11-07", "20:00", 60, 4000), live("2026-11-14", "20:00", 60, 4000), // เสาร์ 20:00 รวม 2 ชม.
      live("2026-11-02", "10:00", 60, 1000), live("2026-11-09", "10:00", 60, 1000),
    ]);
    const top = heatTop(g, heatPerHour, 3);
    expect(top.map((x) => [x.day, x.hour, x.v])).toEqual([[5, 14, 4000], [0, 4, 1000]]);
    expect(g[4][14].sec).toBeLessThan(HEAT_MIN_SEC);
  });
  test("Viewers กระจายตามนาทีแบบเดียวกับ GMV · Viewers/ชม. · weight นับบางส่วน", () => {
    const g = heatGrid([live("2026-11-06", "19:30", 90, 3000, undefined, 900), live("2026-11-06", "20:00", 60, 0, 0.5, 400)]);
    const c19 = g[4][13], c20 = g[4][14];
    expect(c19.viewers).toBe(300);
    expect(c20.viewers).toBe(600 + 200); // 600 จากไลฟ์แรก + ครึ่งหนึ่งของไลฟ์ที่สอง
    expect(heatViewersPerHour(c19)).toBe(600); // 300 คนในครึ่งชั่วโมง
    expect(heatValue("viewers", c20)).toBe(800);
    expect(heatValue("viewersPerHour", g[0][0])).toBeNull(); // ไม่มีไลฟ์
    expect(heatValue("perHour", c20)).toBe(heatPerHour(c20));
  });
  test("อันดับคนดูเยอะ: Viewers/ชม. เฉพาะช่องที่ไลฟ์รวมถึง 2 ชม.", () => {
    const g = heatGrid([
      live("2026-11-07", "20:00", 60, 100, undefined, 5000), live("2026-11-14", "20:00", 60, 100, undefined, 3000), // เสาร์ 20:00 รวม 2 ชม.
      live("2026-11-06", "21:00", 60, 9000, undefined, 99000), // ศุกร์ 21:00 แค่ 1 ชม. ไม่จัดอันดับ
    ]);
    expect(heatTop(g, heatViewersPerHour, 3).map((x) => [x.day, x.hour, x.v])).toEqual([[5, 14, 4000]]);
  });
  test("ออเดอร์ กระจายตามนาที · ออเดอร์/ชม.", () => {
    const g = heatGrid([{ startedAt: at("2026-11-06", "19:30"), durationSec: 90 * 60, gmv: 0, orders: 30 }]);
    expect(g[4][13].orders).toBe(10);
    expect(g[4][14].orders).toBe(20);
    expect(heatOrdersPerHour(g[4][13])).toBe(20); // 10 ออเดอร์ในครึ่งชั่วโมง
    expect(heatValue("orders", g[4][14])).toBe(20);
  });
  test("Impressions มีเฉพาะ TikTok: ต่อชั่วโมงหารด้วยชั่วโมงไลฟ์ TikTok เท่านั้น (Shopee ไม่ดึงค่าลง)", () => {
    const g = heatGrid([
      { startedAt: at("2026-11-06", "20:00"), durationSec: 3600, gmv: 0, impressions: 6000 }, // TikTok 1 ชม.
      { startedAt: at("2026-11-06", "20:00"), durationSec: 3600, gmv: 0, impressions: null }, // Shopee 1 ชม. ไม่มี Impressions
    ]);
    const c = g[4][14];
    expect([c.sec, c.impSec, c.impressions]).toEqual([7200, 3600, 6000]);
    expect(heatImpressionsPerHour(c)).toBe(6000); // ไม่ใช่ 3000
    expect(heatSecOf("impressionsPerHour", c)).toBe(3600);
    expect(heatSecOf("perHour", c)).toBe(7200);
    // อันดับ Impressions ใช้ชั่วโมง TikTok ตัดสิน (1 ชม. < 2 ชม. = ไม่จัดอันดับ แม้ชั่วโมงรวมถึง 2 ชม.)
    expect(heatTop(g, heatImpressionsPerHour, 3, (x) => heatSecOf("impressionsPerHour", x))).toEqual([]);
  });
});
