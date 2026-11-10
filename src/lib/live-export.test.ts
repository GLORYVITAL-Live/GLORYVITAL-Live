// เทสไฟล์ส่งออกของหน้า Analytics (bun test): แผ่นส่วนเสริมต้องครบเหมือนหน้าเว็บ
import { describe, expect, test } from "bun:test";
import { compareBook, monthBook, singleBook } from "@/lib/live-export";
import type { LiveSession } from "@/lib/live-stats";

// บัญชี GLORY VITAL (ช่อง GLORY MALL ใน src/lib/platform.ts) = มีกลุ่มผู้ไลฟ์
const live = (d: string, t: string, gmv: number, platform = "TikTok", owner: string | null = null) => ({
  platform, accountId: platform === "TikTok" ? "7126874351866037275" : "2", accountName: platform === "TikTok" ? "GLORY VITAL" : "Shopee", title: "",
  startedAt: new Date(Date.parse(`${d}T${t}:00+07:00`)).toISOString(), durationSec: 3 * 3600,
  gmv, orders: 10, itemsSold: 10, customers: null, viewers: 100, views: 200, engagedViewers: null, avgViewSec: null, comments: null, shares: null, likes: null,
  newFollowers: null, addToCart: null, impressions: 500, clicks: 50, liveOwner: owner,
}) as unknown as LiveSession;

const a = [live("2026-11-05", "09:00", 1000), live("2026-11-05", "20:00", 3000, "TikTok", "TDH"), live("2026-11-06", "12:00", 800, "Shopee")];
const b = [live("2026-10-05", "09:00", 900), live("2026-10-05", "20:00", 2000, "TikTok", "TDH"), live("2026-10-06", "12:00", 1000, "Shopee")];
const filter = { platform: "", account: "", sessions: [...a, ...b] };
const tags = new Map([["Shopee|2026-11-06", { platform: "Shopee" as const, day: "2026-11-06", kind: "dday" as const, label: "11.11" }]]);
const names = (book: { sheets: { name: string }[] }) => book.sheets.map((s) => s.name);

describe("แผ่นส่วนเสริม", () => {
  const month = () => monthBook({
    month: "2026-11", monthLabel: (k) => k, months13: Array.from({ length: 13 }, (_, i) => `${i < 2 ? 2025 : 2026}-${String(((i + 10) % 12) + 1).padStart(2, "0")}`),
    byMonth: new Map([["2026-10", b], ["2026-11", a]]), filter,
    extras: {
      spans: [], owners: true, heat: true, tags, breakdown: { b, aName: "พ.ย.", bName: "ต.ค." },
      agency: [{ name: "แยก Agency รายวัน", first: "วันที่", labels: ["5", "6"], trend: [{ platform: "TikTok", key: "ours", label: "ของเรา", gmv: [1000, null], hours: [3, null], perHour: [333, null] }] }],
    },
  });
  test("รายเดือน: กลุ่มผู้ไลฟ์ / เทียบรายกลุ่ม / รายบัญชี / แยก Agency / ช่วงเวลาขายดี / วันแคมเปญ ก่อนแผ่นไลฟ์", () => {
    const list = names(month());
    for (const n of ["แยกกลุ่มผู้ไลฟ์", "เทียบรายกลุ่ม", "เทียบรายบัญชี", "แยก Agency รายวัน", "ช่วงเวลาขายดี", "วันปกติ vs วันแคมเปญ"]) expect(list).toContain(n);
    expect(list[list.length - 1]).toBe("ไลฟ์");
  });
  test("เทียบรายกลุ่ม: แยก Agency TDH ออกจากของเรา + คอลัมน์ขาที่ทำให้ GMV เปลี่ยน", () => {
    const sheet = month().sheets.find((s) => s.name === "เทียบรายกลุ่ม")!;
    const labels = sheet.rows.map((r) => String(r[0] ?? "").trim());
    expect(labels).toContain("Agency TDH");
    expect(labels).toContain("ของเรา");
    expect(sheet.rows[2]).toContain("ขาที่ทำให้ GMV เปลี่ยนมากสุด");
  });
  test("วันแคมเปญ: มีวัน D-Day ของ Shopee และรายการวันที่มีป้าย", () => {
    const sheet = month().sheets.find((s) => s.name === "วันปกติ vs วันแคมเปญ")!;
    expect(sheet.rows.some((r) => r[0] === "Shopee" && r[1] === "วันแคมเปญ (D-Day)")).toBe(true);
    expect(sheet.rows.some((r) => r[0] === "2026-11-06" && r[2] === "11.11")).toBe(true);
  });
  test("ไม่ส่งส่วนเสริม = แผ่นเดิมเท่านั้น", () => {
    const list = names(compareBook({ title: "t", report: "MoM", aName: "พ.ย.", bName: "ต.ค.", aRange: "", bRange: "", a, b, timeName: "รายวัน", time: [], filter }));
    expect(list).not.toContain("เทียบรายกลุ่ม");
    expect(list).not.toContain("ช่วงเวลาขายดี");
  });
  test("ช่วงเดียว: ตารางรายกลุ่มเป็นค่าของช่วงหลัก ไม่มีคอลัมน์เทียบ", () => {
    const book = singleBook({ title: "t", report: "วัน", aName: "พ.ย.", aRange: "", a, timeName: "รายชั่วโมง", time: [], filter, extras: { spans: [], breakdown: { b: [], aName: "พ.ย.", bName: "" } } });
    const sheet = book.sheets.find((s) => s.name === "เทียบรายกลุ่ม")!;
    expect(sheet.rows[0][0]).toBe("กลุ่ม");
    expect(sheet.rows[0]).not.toContain("ช่วงเทียบ");
  });
});
