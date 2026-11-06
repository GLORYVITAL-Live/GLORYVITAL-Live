// เทสไฟล์สไลด์ (bun test): ต้องมีกราฟแท่ง + กราฟเส้นครบ ทั้ง PowerPoint (กราฟจริง) และ Google Slides (วาดด้วยรูปทรง)
import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { buildCompareDeck, buildMultiDeck, type CompareDeckInput } from "@/lib/live-slides";
import type { LiveSession } from "@/lib/live-stats";

const live = (d: string, t: string, gmv: number, platform = "TikTok", min = 60) => ({
  platform, accountId: platform === "TikTok" ? "1" : "2", accountName: platform === "TikTok" ? "GLORY" : "Shopee", title: "", startedAt: new Date(Date.parse(`${d}T${t}:00+07:00`)).toISOString(), durationSec: min * 60,
  gmv, orders: 10, itemsSold: 10, customers: null, viewers: 100, views: 200, engagedViewers: null, avgViewSec: null, comments: null, shares: null, likes: null,
  newFollowers: null, addToCart: null, impressions: 500, clicks: 50,
}) as unknown as LiveSession;

/** แตกไฟล์สไลด์: ข้อความแต่ละหน้า + xml ของกราฟจริง */
async function open(blob: Blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const names = Object.keys(files);
  const read = (re: RegExp) => names.filter((n) => re.test(n)).map((n) => strFromU8(files[n]));
  return { slides: read(/^ppt\/slides\/slide\d+\.xml$/), charts: read(/^ppt\/charts\/chart\d+\.xml$/) };
}
const lineCharts = (charts: string[]) => charts.filter((c) => c.includes("<c:lineChart>"));
const barCharts = (charts: string[]) => charts.filter((c) => c.includes("<c:barChart>"));
const titled = (slides: string[], title: string) => slides.some((s) => s.includes(title));
const seriesNames = (chart: string) => [...chart.matchAll(/<c:tx>[\s\S]*?<c:v>(.*?)<\/c:v>/g)].map((m) => m[1]);

const hourly: CompareDeckInput["time"] = Array.from({ length: 24 }, (_, h) => {
  const hh = String(h).padStart(2, "0");
  const a = h === 9 ? [live("2026-11-05", `${hh}:00`, 8000)] : h === 17 ? [live("2026-11-05", `${hh}:00`, 5000, "Shopee")] : h === 22 ? [live("2026-11-05", `${hh}:00`, 3000)] : [];
  const b = h === 9 ? [live("2026-11-04", `${hh}:00`, 6000)] : [];
  return { short: `${hh}:00`, a, b };
});
const base: CompareDeckInput = {
  report: "เทียบวัน", aName: "5 พ.ย.", bName: "4 พ.ย.", aRange: "5 พ.ย. 2026", bRange: "4 พ.ย. 2026",
  a: hourly.flatMap((t) => t.a), b: hourly.flatMap((t) => t.b), timeName: "รายชั่วโมง", time: hourly, filterText: "ทุกบัญชี", exportedAt: "6 พ.ย. 2026",
};

describe("เทียบ 2 ช่วง", () => {
  test("PowerPoint: มีกราฟแท่ง + กราฟเส้น GMV และ GMV/ชม. เส้นละช่วง ลากข้ามชั่วโมงที่ไม่มีไลฟ์", async () => {
    const { slides, charts } = await open(await buildCompareDeck(base));
    expect(barCharts(charts).length).toBeGreaterThanOrEqual(2);
    const lines = lineCharts(charts);
    expect(lines).toHaveLength(2);
    expect(seriesNames(lines[0])).toEqual(["5 พ.ย.", "4 พ.ย."]);
    for (const c of lines) expect(c).toContain('<c:dispBlanksAs val="span"/>');
    expect(titled(slides, "GMV แนวโน้มรายชั่วโมง")).toBe(true);
    expect(titled(slides, "GMV / ชม. แนวโน้มรายชั่วโมง")).toBe(true);
  });
  test("แท่งยังเป็นแท่งคู่ สีบอกช่วงเวลา", async () => {
    const { charts } = await open(await buildCompareDeck(base));
    for (const c of barCharts(charts)) expect(c).toContain('<c:grouping val="clustered"/>');
  });
  test("Google Slides: ไม่มีกราฟจริง วาดด้วยรูปทรงแทน และยังมีหน้ากราฟเส้นครบ", async () => {
    const { slides, charts } = await open(await buildCompareDeck(base, "gslides"));
    expect(charts).toHaveLength(0);
    const page = slides.find((s) => s.includes("GMV แนวโน้มรายชั่วโมง"))!;
    expect(page).toBeTruthy();
    expect((page.match(/prst="ellipse"/g) ?? []).length).toBe(4); // 3 + 1 จุดของจริง
    expect((page.match(/prst="line"/g) ?? []).length).toBeGreaterThan(2);
  });
});

describe("ช่วงเดียว (ไม่เทียบ)", () => {
  const single: CompareDeckInput = { ...base, b: [], bName: "", bRange: "", single: true, time: hourly.map((t) => ({ ...t, b: [] })) };
  test("แท่งซ้อนแยกแพลตฟอร์ม · รายชั่วโมงไม่มีเส้นรวม", async () => {
    const { charts } = await open(await buildCompareDeck(single));
    expect(barCharts(charts).some((c) => c.includes('<c:grouping val="stacked"/>'))).toBe(true);
    expect(seriesNames(lineCharts(charts)[0])).toEqual(["TikTok", "Shopee"]);
  });
  test("แท่งซ้อน: บัญชีที่ไม่มียอดในแพลตฟอร์มนั้นเป็นช่องว่าง ไม่ใช่ 0 (ไม่งั้นมีป้าย ฿0 ซ้อนบนแท่ง)", async () => {
    const { charts } = await open(await buildCompareDeck(single));
    const stacked = barCharts(charts).find((c) => c.includes('<c:grouping val="stacked"/>'))!;
    expect(stacked).not.toContain("<c:v>0</c:v>");
  });
  test("รายวัน: มีเส้นรวมด้วย", async () => {
    const time = [1, 2, 3].map((d) => ({ short: `${d} พ.ย.`, a: [live(`2026-11-0${d}`, "09:00", 100 * d), live(`2026-11-0${d}`, "12:00", 50 * d, "Shopee")], b: [] }));
    const { charts } = await open(await buildCompareDeck({ ...single, timeName: "รายวัน", time, a: time.flatMap((t) => t.a) }));
    expect(seriesNames(lineCharts(charts)[0])).toEqual(["TikTok", "Shopee", "รวม"]);
  });
  test("หน้าสรุปไม่มีข้อความ vs ว่างๆ", async () => {
    const { slides } = await open(await buildCompareDeck(single));
    expect(slides.some((s) => s.includes(" vs  ("))).toBe(false);
  });
});

describe("เทียบหลายเดือน", () => {
  const keys = ["2026-09", "2026-10", "2026-11"];
  const byMonth = new Map(keys.map((k) => [k, [live(`${k}-05`, "09:00", 1000), live(`${k}-05`, "12:00", 500, "Shopee"), live(`${k}-06`, "09:00", 700)]]));
  const input = {
    rangeText: "ก.ย.–พ.ย. 2026", keys, focus: "2026-11", label: (k: string) => k.slice(5), longLabel: (k: string) => k, byMonth, now: "2026-12", filterText: "ทุกบัญชี", exportedAt: "6 พ.ย. 2026",
  };
  test("รายเดือน: แท่งซ้อนแพลตฟอร์ม + เส้น GMV และ GMV/ชม. แยกแพลตฟอร์มกับรวม", async () => {
    const { slides, charts } = await open(await buildMultiDeck(input));
    expect(barCharts(charts).some((c) => c.includes('<c:grouping val="stacked"/>'))).toBe(true);
    const lines = lineCharts(charts);
    expect(lines).toHaveLength(2);
    expect(seriesNames(lines[0])).toEqual(["TikTok", "Shopee", "รวม"]);
    expect(titled(slides, "GMV แนวโน้มรายเดือน")).toBe(true);
    expect(titled(slides, "รายวันของแต่ละเดือน")).toBe(false);
  });
  test("ช่วงวันเดียวกันหลายเดือน: มีแท่งและเส้นรายวัน เดือนละเส้น", async () => {
    const byDay = new Map(keys.map((k) => [k, [byMonth.get(k)!.slice(0, 2), byMonth.get(k)!.slice(2)]]));
    const { slides, charts } = await open(await buildMultiDeck({ ...input, daily: { labels: ["วันที่ 5", "วันที่ 6"], byDay } }));
    expect(titled(slides, "GMV รายวันของแต่ละเดือน")).toBe(true);
    const lines = lineCharts(charts);
    expect(lines).toHaveLength(4);
    expect(seriesNames(lines[2])).toEqual(["09", "10", "11"]);
  });
  test("Google Slides: ไม่มีกราฟจริง", async () => {
    const { slides, charts } = await open(await buildMultiDeck(input, "gslides"));
    expect(charts).toHaveLength(0);
    expect(titled(slides, "GMV แนวโน้มรายเดือน")).toBe(true);
  });
});
