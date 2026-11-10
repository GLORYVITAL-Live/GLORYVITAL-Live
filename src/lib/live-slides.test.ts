// เทสไฟล์สไลด์ (bun test): ต้องมีกราฟแท่ง + กราฟเส้นครบ ทั้ง PowerPoint (กราฟจริง) และ Google Slides (วาดด้วยรูปทรง)
import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { AGENCY_OURS, type AgencyTrend } from "@/lib/live-owners";
import { buildCompareDeck, buildMultiDeck, type AgencyChart, type CompareDeckInput } from "@/lib/live-slides";
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

describe("รายเดือน", () => {
  const days = [1, 2, 3].map((d) => {
    const dd = `2026-11-0${d}`, pp = `2026-10-0${d}`;
    return {
      short: String(d),
      a: [live(dd, "09:00", 1000 * d), live(dd, "12:00", 500 * d, "Shopee")],
      b: [live(pp, "09:00", 900 * d), live(pp, "12:00", 450 * d, "Shopee")],
    };
  });
  const month: CompareDeckInput = {
    report: "รายเดือน", aName: "พฤศจิกายน 2026", bName: "ต.ค. 1–3", aRange: "1–3 พ.ย.", bRange: "ต.ค. 1–3",
    a: days.flatMap((t) => t.a), b: days.flatMap((t) => t.b), timeName: "รายวัน", time: days, filterText: "ทั้งหมด", exportedAt: "6 พ.ย. 2026",
    platformTime: true,
    months: [{ short: "ต.ค.", a: days.flatMap((t) => t.b) }, { short: "พ.ย.*", a: days.flatMap((t) => t.a) }],
    target: {
      lastDay: 3, names: new Map([["TikTok|1", "GLORY VITAL"]]),
      report: {
        monthly: 30000, gmv: 6000, pct: 0.2, toDate: { target: 3000, pct: 2, gap: 3000 }, remaining: 24000, daysLeft: 27, perDayLeft: 888, days: [],
        accounts: [{ key: "TikTok|1", monthly: 30000, gmv: 6000, pct: 0.2, toDatePct: 2 }],
      },
    },
    owners: [{
      channel: "GLORY MALL", label: "GLORY VITAL", lives: 3, sec: 10800, gmv: 6000, splitLives: 1, splitGmv: 100,
      rows: [{ owner: null, label: "ของเรา", lives: 2, sec: 7200, gmv: 4000, orders: 10 }, { owner: "TDH", label: "Agency TDH", lives: 1, sec: 3600, gmv: 2000, orders: 5 }],
    }],
  };
  test("มีช่วงเทียบ แต่กราฟรายวันยังเป็นแท่งซ้อน + เส้นแยกแพลตฟอร์ม ไม่มีเส้นรวม (เหมือนเว็บ)", async () => {
    const { charts } = await open(await buildCompareDeck(month));
    expect(barCharts(charts).some((c) => c.includes('<c:grouping val="stacked"/>'))).toBe(true);
    const lines = lineCharts(charts);
    expect(lines).toHaveLength(2);
    expect(seriesNames(lines[0])).toEqual(["TikTok", "Shopee"]);
  });
  test("มีครบ: เป้าหมาย / แท่ง 13 เดือน / กลุ่มผู้ไลฟ์ · ทั้ง PowerPoint และ Google Slides", async () => {
    for (const target of ["pptx", "gslides"] as const) {
      const { slides } = await open(await buildCompareDeck(month, target));
      expect(titled(slides, "เป้าหมาย GMV พฤศจิกายน 2026")).toBe(true);
      expect(titled(slides, "GMV รายเดือน (2 เดือน)")).toBe(true);
      expect(titled(slides, "GMV แยกตามกลุ่มผู้ไลฟ์")).toBe(true);
      expect(titled(slides, "Agency TDH")).toBe(true);
    }
  });
  test("ไม่มีเป้า / ไม่มีแพลนกลุ่ม = ไม่มีหน้านั้น", async () => {
    const { slides } = await open(await buildCompareDeck({ ...month, target: undefined, owners: [] }));
    expect(titled(slides, "เป้าหมาย GMV")).toBe(false);
    expect(titled(slides, "แยกตามกลุ่มผู้ไลฟ์")).toBe(false);
  });
});

describe("แยก Agency", () => {
  const row = (platform: "TikTok" | "Shopee", key: string, label: string, gmv: (number | null)[]): AgencyTrend => ({
    platform, key, label, gmv, hours: gmv.map((v) => (v === null ? null : 2)), perHour: gmv.map((v) => (v === null ? null : v / 2)),
  });
  const chart: AgencyChart = {
    title: "GMV แยก Agency", labels: ["ต.ค.", "พ.ย."], lineTitle: "GMV/ชม. แยก Agency",
    trend: [
      row("TikTok", AGENCY_OURS, "ของเรา", [5000, 6000]), row("TikTok", "TDH", "Agency TDH", [1000, 2000]),
      row("Shopee", AGENCY_OURS, "In house", [7000, 3000]), row("Shopee", "Infinite", "Agency Infinite", [null, 4000]),
    ],
  };
  const single: CompareDeckInput = { ...base, b: [], bName: "", bRange: "", single: true, time: hourly.map((t) => ({ ...t, b: [] })) };
  test("แท่งคู่ซ้อน (วาดด้วยรูปทรง) + ตารางกลุ่ม + หน้ากราฟเส้น GMV/ชม. · ทั้ง PowerPoint และ Google Slides", async () => {
    for (const target of ["pptx", "gslides"] as const) {
      const { slides } = await open(await buildCompareDeck({ ...single, agency: [chart] }, target));
      const page = slides.find((s) => s.includes(">GMV แยก Agency<"))!;
      expect(page).toBeTruthy();
      expect(page).toContain("TikTok (แท่งซ้าย)");
      expect(page).toContain("Shopee (แท่งขวา)");
      expect(page).toContain("In house");
      expect(page).toContain("฿14,000"); // ตาราง: TikTok รวมทั้งช่วง
      expect((page.match(/prst="rect"/g) ?? []).length).toBeGreaterThanOrEqual(6); // ส่วนของแท่ง 6 ส่วน (+ สี่เหลี่ยมในตำนาน)
      expect(titled(slides, "GMV/ชม. แยก Agency")).toBe(true);
    }
  });
  test("หลายเดือนก็มีหน้านี้ · ไม่มีไลฟ์เลย = ไม่มีหน้า · ไม่มีคำว่าไม่ระบุกลุ่ม", async () => {
    const keys = ["2026-10", "2026-11"];
    const byMonth = new Map(keys.map((k) => [k, [live(`${k}-05`, "09:00", 1000)]]));
    const multi = { rangeText: "ต.ค.–พ.ย. 2026", keys, focus: "2026-11", label: (k: string) => k.slice(5), longLabel: (k: string) => k, byMonth, now: "2026-12", filterText: "ทุกบัญชี", exportedAt: "9 พ.ย. 2026" };
    expect(titled((await open(await buildMultiDeck({ ...multi, agency: [chart] }))).slides, ">GMV แยก Agency<")).toBe(true);
    const empty = { ...chart, trend: [row("Shopee", AGENCY_OURS, "In house", [null, null])] };
    expect(titled((await open(await buildCompareDeck({ ...single, agency: [empty] }))).slides, "แยก Agency")).toBe(false);
    expect(titled((await open(await buildCompareDeck({ ...single, agency: [chart] }))).slides, "ไม่ระบุกลุ่ม")).toBe(false);
  });
});

describe("ส่วนเสริมเหมือนหน้าเว็บ (เทียบรายกลุ่ม / ช่วงเวลาขายดี / วันแคมเปญ)", () => {
  // บัญชี GLORY VITAL (ช่อง GLORY MALL ใน src/lib/platform.ts) = มีกลุ่มผู้ไลฟ์
  const vital = (d: string, t: string, gmv: number, liveOwner: string | null = null) => ({ ...live(d, t, gmv), accountId: "7126874351866037275", liveOwner }) as LiveSession;
  const a = [vital("2026-11-05", "09:00", 1000, "ours"), vital("2026-11-05", "20:00", 3000, "TDH"), live("2026-11-06", "12:00", 800, "Shopee")];
  const b = [vital("2026-10-05", "09:00", 900, "ours"), vital("2026-10-05", "20:00", 2000, "TDH"), live("2026-10-06", "12:00", 1000, "Shopee")];
  const input: CompareDeckInput = { ...base, a, b, aName: "พ.ย.", bName: "ต.ค.", time: [], timeName: "รายวัน" };
  const tags = new Map([["Shopee|2026-11-06", { platform: "Shopee" as const, day: "2026-11-06", kind: "dday" as const, label: "11.11" }], ["TikTok|2026-11-05", { platform: "TikTok" as const, day: "2026-11-05", kind: "bau" as const, label: "" }]]);
  test("มีหน้ากราฟ GMV / GMV/ชม. แยกกลุ่ม + ตารางทุกตัวชี้วัด + ช่วงเวลาขายดี + วันแคมเปญ · ทั้ง PowerPoint และ Google Slides", async () => {
    for (const target of ["pptx", "gslides"] as const) {
      const { slides } = await open(await buildCompareDeck({ ...input, breakdown: { spans: [] }, heat: { title: "ช่วงเวลาไหนขายดี พ.ย." }, dayKinds: { title: "วันปกติ vs วันแคมเปญ พ.ย.", tags } }, target));
      expect(titled(slides, "GMV แยกกลุ่ม: พ.ย. vs ต.ค.")).toBe(true);
      expect(titled(slides, "GMV / ชม. แยกกลุ่ม")).toBe(true);
      expect(titled(slides, "เทียบรายกลุ่ม ทุกตัวชี้วัด")).toBe(true);
      expect(titled(slides, "เทียบรายบัญชี ทุกตัวชี้วัด")).toBe(true);
      expect(titled(slides, "Agency TDH")).toBe(true);
      expect(titled(slides, "ขาที่ทำให้ GMV เปลี่ยนมากสุด")).toBe(true);
      expect(titled(slides, "ช่วงเวลาไหนขายดี พ.ย.")).toBe(true);
      expect(titled(slides, "วันปกติ vs วันแคมเปญ พ.ย.")).toBe(true);
    }
  });
  test("ไม่มีช่วงเทียบ: แท่งเดียว ไม่มีคำว่า vs และไม่มีคอลัมน์ขาที่ทำให้เปลี่ยน", async () => {
    const { slides } = await open(await buildCompareDeck({ ...input, b: [], single: true, breakdown: { spans: [] } }));
    expect(titled(slides, "GMV แยกกลุ่ม: พ.ย.<")).toBe(true);
    expect(titled(slides, "รายกลุ่ม ทุกตัวชี้วัด: พ.ย.")).toBe(true);
    expect(titled(slides, "ขาที่ทำให้ GMV เปลี่ยนมากสุด")).toBe(false);
  });
  test("ไม่ส่งส่วนเสริม = ไม่มีหน้าเหล่านี้", async () => {
    const { slides } = await open(await buildCompareDeck(input));
    expect(titled(slides, "แยกกลุ่ม:")).toBe(false);
    expect(titled(slides, "ช่วงเวลาไหนขายดี")).toBe(false);
    expect(titled(slides, "วันปกติ vs วันแคมเปญ")).toBe(false);
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
