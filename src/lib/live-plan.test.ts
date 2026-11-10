// เทสแพลน vs ไลฟ์จริง (bun test)
import { describe, expect, test } from "bun:test";
import { planVsActual } from "@/lib/live-plan";
import type { LiveSession } from "@/lib/live-stats";

const VITAL = "7126874351866037275"; // ช่อง GLORY MALL (src/lib/platform.ts)
const at = (d: string, t: string) => Date.parse(`${d}T${t}:00+07:00`);
const live = (platform: "TikTok" | "Shopee", d: string, t: string, min: number) => ({
  platform, accountId: platform === "TikTok" ? VITAL : "s", accountName: "", title: "", startedAt: new Date(at(d, t)).toISOString(), durationSec: min * 60,
  gmv: 1000, orders: 1, itemsSold: 1, customers: null, viewers: 10, views: null, engagedViewers: null, avgViewSec: null, comments: null, shares: null,
  likes: null, newFollowers: null, addToCart: null, impressions: null, clicks: null, liveOwner: null,
}) as LiveSession;
const span = (channel: string, owner: string, d: string, s: string, e: string) => ({ channel, owner, startMs: at(d, s), endMs: at(d, e) });
const NOV = { fromMs: at("2026-11-01", "00:00"), toMs: at("2026-12-01", "00:00") };
const NOW = at("2026-11-10", "12:00");

describe("แพลน vs ไลฟ์จริง", () => {
  test("ไลฟ์ครบ / ไม่ครบ / ไม่ได้ไลฟ์ · ชั่วโมงที่ไลฟ์จริงไม่เกินความยาว slot", () => {
    const spans = [
      span("Shopee", "MCN", "2026-11-05", "10:00", "12:00"), // ไลฟ์ 2 ชม. เต็ม (+ เกินเวลา 30 นาที ไม่นับเกิน)
      span("Shopee", "MCN", "2026-11-06", "10:00", "12:00"), // ไลฟ์ 75 นาที = ไม่ครบ
      span("Shopee", "MCN", "2026-11-07", "10:00", "12:00"), // ไม่ได้ไลฟ์
    ];
    const lives = [live("Shopee", "2026-11-05", "09:45", 150), live("Shopee", "2026-11-06", "10:00", 75), live("Shopee", "2026-11-09", "20:00", 60)];
    const [g] = planVsActual(lives, spans, NOV, NOW);
    expect(g.ownerLabel).toBe("MCN");
    expect(g.slots).toBe(3);
    expect(g.planSec).toBe(6 * 3600);
    expect(g.liveSec).toBe(2 * 3600 + 75 * 60);
    expect(g.missed.length).toBe(1);
    expect(g.partial.length).toBe(1);
  });
  test("slot หลังไลฟ์ล่าสุดในไฟล์ / ยังไม่ถึง = รอไฟล์ ไม่นับว่าไม่ได้ไลฟ์ · แยกช่อง TikTok กับ Shopee", () => {
    const spans = [span("GLORY MALL", "TDH", "2026-11-08", "19:30", "21:30"), span("GLORY MALL", "TDH", "2026-11-09", "19:30", "21:30"), span("GLORY MALL", "TDH", "2026-11-20", "19:30", "21:30")];
    const lives = [live("TikTok", "2026-11-08", "19:30", 120), live("Shopee", "2026-11-09", "23:00", 60)];
    const [g] = planVsActual(lives, spans, NOV, NOW);
    expect(g.channelLabel).toBe("GLORY VITAL");
    expect(g.slots).toBe(1);
    expect(g.pending).toBe(2);
    expect(g.coverage).toBe(1);
  });
  test("นอกช่วงรายงานไม่นับ", () => {
    expect(planVsActual([], [span("Shopee", "MCN", "2026-10-31", "10:00", "12:00")], NOV, NOW)).toEqual([]);
  });
});
