// เทสตารางเทียบรายกลุ่ม / รายบัญชี + ขาที่ทำให้ GMV เปลี่ยน (bun test)
import { describe, expect, test } from "bun:test";
import { breakdownRows, mainLeg, scaleSession } from "@/lib/live-breakdown";
import { ownerSpanOf } from "@/lib/live-owners";
import { totalsOf, type LiveSession } from "@/lib/live-stats";

const VITAL = "7126874351866037275";
const live = (platform: "TikTok" | "Shopee", accountId: string, d: string, t: string, min: number, gmv: number, viewers = 100, liveOwner: string | null = null) => ({
  platform, accountId, accountName: accountId === VITAL ? "GLORY VITAL" : platform, title: "", startedAt: new Date(Date.parse(`${d}T${t}:00+07:00`)).toISOString(),
  durationSec: min * 60, gmv, orders: 10, itemsSold: 10, customers: null, viewers, views: null, engagedViewers: null, avgViewSec: 30, comments: null, shares: null,
  likes: null, newFollowers: null, addToCart: null, impressions: null, clicks: null, liveOwner,
}) as unknown as LiveSession;

describe("ส่วนของไลฟ์", () => {
  test("คูณตัวเลขที่บวกได้ ค่าเฉลี่ยกับ null คงเดิม", () => {
    const s = scaleSession(live("Shopee", "s", "2026-10-01", "10:00", 60, 1000), 0.25);
    expect([s.gmv, s.durationSec, s.orders, s.viewers, s.avgViewSec, s.clicks]).toEqual([250, 900, 2.5, 25, 30, null]);
  });
});

describe("แถวเทียบ", () => {
  const spans = [ownerSpanOf({ agency: "MCN", platform: "Shopee", live_date: "2026-11-01", start_time: "06:00:00", end_time: "10:00:00" })];
  const a = [live("Shopee", "s", "2026-11-01", "08:00", 240, 1000), live("TikTok", VITAL, "2026-11-01", "20:00", 60, 300, 100, "TDH")];
  const b = [live("Shopee", "s", "2026-10-01", "08:00", 60, 800), live("TikTok", VITAL, "2026-10-01", "20:00", 60, 500, 100, "TDH")];
  test("แพลตฟอร์ม > กลุ่ม (ทีมเราก่อน) · ไลฟ์คร่อมกลุ่มแบ่งตัวเลขตามส่วน · ช่วงเทียบไม่มีแพลน = ทีมเรา", () => {
    const { groups } = breakdownRows(a, b, spans);
    expect(groups.map((r) => [r.level, r.label, r.a.gmv, r.b.gmv])).toEqual([
      ["platform", "TikTok", 300, 500], ["group", "Agency TDH", 300, 500],
      ["platform", "Shopee", 1000, 800], ["group", "In house", 500, 800], ["group", "MCN", 500, 0],
    ]);
    expect(groups.find((r) => r.label === "MCN")!.a.durationSec).toBe(7200);
  });
  test("ไม่มีแพลน = มีแค่แถวแพลตฟอร์ม · บัญชีเรียง GMV ช่วงหลัก", () => {
    const { groups, accounts } = breakdownRows(a, b, null);
    expect(groups.map((r) => r.level)).toEqual(["platform", "platform"]);
    expect(accounts.map((r) => [r.label, r.a.gmv, r.b.gmv])).toEqual([["Shopee", 1000, 800], ["GLORY VITAL", 300, 500]]);
  });
});

describe("ขาที่ทำให้ GMV เปลี่ยน", () => {
  test("GMV ลด: ขาที่ลดมากสุด (ชั่วโมงเท่าเดิม คนดูต่อชม. ลด)", () => {
    const leg = mainLeg(totalsOf([live("Shopee", "s", "2026-11-01", "10:00", 60, 600, 60)]), totalsOf([live("Shopee", "s", "2026-10-01", "10:00", 60, 1000, 100)]));
    expect(leg).toMatchObject({ key: "viewersPerHour", label: "Viewers/ชม." });
    expect(leg!.gmv).toBeCloseTo(-0.4);
  });
  test("GMV เพิ่ม: ขาที่เพิ่มมากสุด · เทียบไม่ได้ = null", () => {
    expect(mainLeg(totalsOf([live("Shopee", "s", "2026-11-01", "10:00", 120, 2000)]), totalsOf([live("Shopee", "s", "2026-10-01", "10:00", 60, 1000)]))?.key).toBe("duration");
    expect(mainLeg(totalsOf([live("Shopee", "s", "2026-11-01", "10:00", 60, 100)]), totalsOf([]))).toBeNull();
  });
});
