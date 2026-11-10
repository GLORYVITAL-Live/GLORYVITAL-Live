// เทสแจ้งเตือนยอดดรอปรายสัปดาห์ (bun test)
import { describe, expect, test } from "bun:test";
import { dropDigest } from "@/lib/live-drops";
import type { LiveSession } from "@/lib/live-stats";

const VITAL = "7126874351866037275";
const live = (platform: "TikTok" | "Shopee", d: string, gmv: number, min = 120, owner: string | null = null, accountId = platform === "TikTok" ? VITAL : "s", name = platform === "TikTok" ? "GLORY VITAL" : "Shopee") => ({
  platform, accountId, accountName: name, title: "", startedAt: new Date(Date.parse(`${d}T10:00:00+07:00`)).toISOString(), durationSec: min * 60,
  gmv, orders: 10, itemsSold: 10, customers: null, viewers: 1000, views: null, engagedViewers: null, avgViewSec: null, comments: null, shares: null,
  likes: null, newFollowers: null, addToCart: null, impressions: null, clicks: null, liveOwner: owner,
}) as LiveSession;

describe("ยอดดรอปรายสัปดาห์", () => {
  test("กลุ่มที่ GMV ลดเกิน 10% + ขาที่ทำให้ดรอป · ยอดฐานน้อยไม่นับ · เรียงตามยอดที่หาย", () => {
    const b = [live("TikTok", "2026-11-02", 200_000, 120, "TDH"), live("TikTok", "2026-11-02", 100_000, 120, "ours"), live("Shopee", "2026-11-03", 20_000)];
    const a = [live("TikTok", "2026-11-09", 150_000, 60, "TDH"), live("TikTok", "2026-11-09", 98_000, 120, "ours"), live("Shopee", "2026-11-10", 5_000)];
    const r = dropDigest(a, b, [], "3–9 พ.ย.", "27 ต.ค.–2 พ.ย.");
    expect(r.drops.map((d) => d.label)).toEqual(["TikTok · Agency TDH"]); // ของเรา ลด 2% · Shopee ฐาน ฿20,000 ไม่นับ
    expect(r.drops[0].change).toBeCloseTo(-0.25);
    expect(r.drops[0].leg).toContain("ชั่วโมงไลฟ์");
    expect(r.title).toBe("ยอดดรอป 1 จุด · 3–9 พ.ย. เทียบ 27 ต.ค.–2 พ.ย.");
    expect(r.body).toContain("GMV รวม");
  });
  test("กลุ่มที่ช่วงนี้ไม่มีไลฟ์เลย ไม่นับเป็นดรอป แยกบรรทัดไว้", () => {
    const b = [live("TikTok", "2026-11-02", 200_000, 120, "TDH"), live("TikTok", "2026-11-02", 100_000, 120, "ours")];
    const a = [live("TikTok", "2026-11-09", 300_000, 240, "ours")];
    const r = dropDigest(a, b, [], "a", "b");
    expect(r.drops).toEqual([]);
    expect(r.body).toContain("ไม่มีไลฟ์ช่วงนี้ (เวลาอาจย้ายไปกลุ่มอื่น): TikTok · Agency TDH");
  });
  test("ไม่มีอะไรดรอป = ข้อความสรุปเฉยๆ", () => {
    const r = dropDigest([live("Shopee", "2026-11-09", 100_000)], [live("Shopee", "2026-11-02", 95_000)], null, "a", "b");
    expect(r.drops).toEqual([]);
    expect(r.title).toBe("สรุปยอด a เทียบ b");
    expect(r.body).toContain("ไม่มีกลุ่ม / บัญชีที่ GMV ลดเกิน 10%");
  });
});
