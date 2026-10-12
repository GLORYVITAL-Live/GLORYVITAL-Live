import { describe, expect, test } from "bun:test";
import { ceoInsights, formatOf, planSheet, targetText } from "@/lib/ceo-insights";
import type { CeoDay } from "@/lib/ceo-report";
import type { LiveSession } from "@/lib/live-stats";
import type { CeoSession } from "@/lib/types";

// ไลฟ์ TikTok 1 ไลฟ์ (ยอด / ชั่วโมง) ของวันนั้น
const live = (date: string, gmv: number, hours = 10): LiveSession => ({
  platform: "TikTok", accountId: "1", accountName: "GLORY VITAL", title: "", startedAt: `${date}T03:00:00.000Z`,
  durationSec: hours * 3600, gmv, orders: Math.round(gmv / 500), itemsSold: 0, customers: null, viewers: 1000, views: 2000,
  engagedViewers: null, avgViewSec: null, comments: null, shares: null, likes: null, newFollowers: null, addToCart: null,
  impressions: 50000, clicks: 1500,
});
const session = (date: string, gmv: number, ctr: number, co: number, extra: Partial<CeoSession> = {}): CeoSession => ({
  date, title: "", timeRange: "", durationHr: 2, gmv, orders: 100, viewers: null, views: 1000, peakViewers: null, peakTime: "",
  impressions: 100000, ctr, co, ...extra,
});
const cday = (date: string, label: string, dayGmv: number, beforeGmv: number, s: CeoSession | null): CeoDay => ({
  event: { date, label, times: [{ platform: "GLORY VITAL", start: "11:30", end: "13:30" }], accounts: ["TikTok|1"] },
  day: [live(date, dayGmv)], before: [live(date, beforeGmv)], session: s,
});

test("formatOf: แยกรูปแบบจากชื่อแคมเปญ", () => {
  expect(formatOf("CEO LIVE x KOL")).toBe("CEO x KOL");
  expect(formatOf("CEO PHONE IN")).toBe("CEO Phone in");
  expect(formatOf("CEO BIRTH DAY")).toBe("CEO Birthday");
  expect(formatOf("3.3 x CEO LIVE")).toBe("CEO ในวันแคมเปญ");
  expect(formatOf("Live marathon x CEO LIVE")).toBe("CEO ในวันแคมเปญ");
  expect(formatOf("CEO Live")).toBe("CEO Live ปกติ");
});

describe("ceoInsights", () => {
  const days = [
    cday("2026-03-03", "CEO Live", 300_000, 100_000, session("2026-03-03", 60_000, 0.4, 0.02, { peakViewers: 300, peakTime: "11.59/258" })),
    cday("2026-05-23", "CEO Live", 200_000, 100_000, session("2026-05-23", 40_000, 0.1, 0.09)),
    cday("2026-06-23", "CEO LIVE x KOL", 500_000, 100_000, session("2026-06-23", 80_000, 0.2, 0.05)),
    cday("2026-08-25", "CEO Live", 150_000, 100_000, null),
  ];
  const r = ceoInsights(days, { next: { date: "2026-10-15", label: "CEO PHONE IN", times: [], accounts: [] } });

  test("สิ่งที่เห็น: ยอดรวมเทียบวันก่อน + ดีสุด / น้อยสุด + แยกรูปแบบ", () => {
    expect(r.findings[0]).toContain("+187.5%"); // (300+200+500+150) / 400 - 1
    expect(r.findings[0]).toContain("4 จาก 4 ครั้ง");
    expect(r.findings[1]).toContain("23 มิ.ย.");
    expect(r.findings.some((t) => t.includes("CEO x KOL +400.0% (1 ครั้ง)"))).toBe(true);
    expect(r.findings.some((t) => t.includes("11:59 น."))).toBe(true);
  });

  test("ข้อเสนอแนะ: รูปแบบที่มีครั้งเดียว = ให้ลองซ้ำ / คลิกเยอะซื้อน้อย / ซื้อดีคลิกน้อย / ข้อมูลขาด / ครั้งถัดไป", () => {
    const all = r.actions.join("\n");
    expect(all).toContain("มีข้อมูลครั้งเดียว ลองจัดซ้ำ");
    expect(all).toContain("3 มี.ค. 26: คนคลิกเยอะแต่ซื้อน้อย");
    expect(all).toContain("23 พ.ค. 26: คนเห็นแล้วซื้อดีแต่คลิกน้อย");
    expect(all).toContain("ยังขาด 25 ส.ค. 26");
    expect(all).toContain("ครั้งถัดไป 15 ต.ค. 26 CEO PHONE IN");
  });

  test("เป้า: GMV เทียบวันก่อนใช้ยอดรวมเทียบยอดรวม ไม่ใช่ค่าเฉลี่ยของ %", () => {
    const up = r.targets.find((t) => t.label === "GMV เทียบวันก่อน")!;
    expect(up.avg).toBeCloseTo(1.875);
    expect(up.best).toBeCloseTo(4);
    expect(targetText(up, up.avg)).toBe("+187.5%");
    const gmv = r.targets.find((t) => t.label === "GMV รอบ CEO")!;
    expect(gmv.avg).toBe(60_000);
    expect(gmv.bestDay).toBe("23 มิ.ย. 26");
  });

  test("แผ่นส่งออก มีครบ 3 ส่วน", () => {
    const sheet = planSheet(r);
    const text = sheet.rows.map((row) => row.join(" ")).join("\n");
    expect(text).toContain("สิ่งที่เห็นจากข้อมูล");
    expect(text).toContain("ข้อเสนอแนะครั้งถัดไป");
    expect(text).toContain("เป้าครั้งถัดไป");
  });
});

test("ไม่มีข้อมูล = ไม่มีแผน", () => {
  expect(ceoInsights([])).toEqual({ findings: [], actions: [], targets: [] });
});
