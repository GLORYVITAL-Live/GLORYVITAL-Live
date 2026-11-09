// เทสป้ายวันแคมเปญ (bun test)
import { describe, expect, test } from "bun:test";
import { dayKindOf, dayKindStats, pickDayTag, tagKey, type DayTag } from "@/lib/live-days";
import type { LiveSession } from "@/lib/live-stats";

describe("ข้อความในชีต -> ชนิดวัน", () => {
  test("Shopee", () => {
    expect(["BAU", "PAYDAY", "PAYDAY Teasing", "10.10 Teasing", "Extentd day", "Extend Day 4.15", "6.6", "2.2 DDAY", "MM 5.15", "MID MONTH", "MID MONTH DDAY 2.15", "JBP DA", "NPD Ticket"].map(dayKindOf))
      .toEqual(["bau", "payday", "teasing", "teasing", "extend", "extend", "dday", "dday", "dday", "dday", "dday", "other", "other"]);
  });
  test("TikTok", () => {
    expect(["DDay Campaign", "PayDay Campaign", "10.10 cmpaign", "12.12 campaign", "Mega Sale Campaign", "NPD", "Brand Prime Day", "สงกรานต์"].map(dayKindOf))
      .toEqual(["dday", "payday", "dday", "dday", "dday", "other", "other", "other"]);
  });
  test("ไม่ใช่ป้ายวัน = null", () => {
    expect(["KOL", "MINI STU", "สล็อตด่วนช่วงน้ำท่วม", "TDH Off", "", "  "].map(dayKindOf)).toEqual([null, null, null, null, null, null]);
  });
  test("หลายข้อความในวันเดียว: เลือกชนิดที่สำคัญสุด · ไม่มีป้าย = วันปกติ", () => {
    expect(pickDayTag(["BAU", "PAYDAY Teasing", "KOL"])).toEqual({ kind: "teasing", label: "PAYDAY Teasing" });
    expect(pickDayTag(["9.9 Teasing", "9.9"])).toEqual({ kind: "dday", label: "9.9" });
    expect(pickDayTag(["", "KOL"])).toEqual({ kind: "bau", label: "" });
    expect(pickDayTag(["PAYDAY \nTeasing"])).toEqual({ kind: "teasing", label: "PAYDAY Teasing" });
  });
});

describe("เทียบยอดตามชนิดวัน", () => {
  const live = (platform: string, d: string, t: string, min: number, gmv: number) =>
    ({ platform, accountId: "a", startedAt: new Date(Date.parse(`${d}T${t}:00+07:00`)).toISOString(), durationSec: min * 60, gmv }) as unknown as LiveSession;
  const tags = new Map<string, DayTag>([
    [tagKey("Shopee", "2026-10-09"), { platform: "Shopee", day: "2026-10-09", kind: "teasing", label: "10.10 Teasing" }],
    [tagKey("Shopee", "2026-10-10"), { platform: "Shopee", day: "2026-10-10", kind: "dday", label: "10.10" }],
    [tagKey("Shopee", "2026-10-13"), { platform: "Shopee", day: "2026-10-13", kind: "bau", label: "" }],
    [tagKey("Shopee", "2026-10-14"), { platform: "Shopee", day: "2026-10-14", kind: "bau", label: "" }],
  ]);
  test("GMV/วัน ต่อวันที่มีไลฟ์ · GMV/ชม. · วันตามปฏิทินของเวลาเริ่ม · ไม่มีป้าย / แพลตฟอร์มอื่นไม่นับ", () => {
    const { stats, untagged } = dayKindStats([
      live("Shopee", "2026-10-10", "00:00", 120, 60000), live("Shopee", "2026-10-10", "20:00", 240, 40000),
      live("Shopee", "2026-10-13", "10:00", 120, 10000), live("Shopee", "2026-10-14", "10:00", 240, 30000),
      live("Shopee", "2026-10-20", "10:00", 60, 999), live("TikTok", "2026-10-10", "10:00", 60, 5),
    ], tags, "Shopee");
    expect(stats.map((s) => [s.kind, s.days, s.lives, s.gmv, s.perDay, s.perHour])).toEqual([
      ["bau", 2, 2, 40000, 20000, 40000 / 6],
      ["dday", 1, 2, 100000, 100000, 100000 / 6],
    ]);
    expect(untagged).toBe(1);
  });
});
