// เทสสไลด์หน้า Cost / ROI (bun test): ครบเหมือนหน้าเว็บ ทั้ง PowerPoint และ Google Slides
import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { costTotals, type CostPoint, type CostReport, type CostRow } from "@/lib/cost-calc";
import { buildCostDeck, type CostDeckInput } from "@/lib/cost-slides";

async function slidesOf(blob: Blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => strFromU8(files[n]));
}
const titled = (slides: string[], text: string) => slides.some((s) => s.includes(text));

const row = (o: Partial<CostRow>): CostRow => ({
  app: "TikTok", owner: null, label: "ของเรา", mc: 0, admin: 0, travel: 0, agency: 0, rate: null, planHours: 0, full: 0, gmv: null, sources: {}, forecast: 0, ...o,
});
const rows = [
  row({ mc: 10_000, admin: 3_000, travel: 500, full: 13_500, gmv: 200_000 }),
  row({ owner: "TDH", label: "Agency TDH", agency: 8_000, rate: 1_000, planHours: 8, full: 8_000, gmv: 90_000 }),
  row({ app: "Shopee", owner: "In house", label: "In house", mc: 6_000, full: 6_000, gmv: 120_000 }),
];
const prevRows = [
  row({ mc: 9_000, admin: 2_500, full: 11_500, gmv: 150_000 }),
  row({ owner: "TDH", label: "Agency TDH", agency: 6_000, rate: 1_000, planHours: 6, full: 6_000, gmv: 60_000 }),
  row({ app: "Shopee", owner: "In house", label: "In house", mc: 5_000, full: 5_000, gmv: 100_000 }),
];
const ALL = { mc: true, admin: true, agency: true, gmv: true };
const report = (see = ALL): CostReport => ({
  month: "2026-11", prevMonth: "2026-10", upTo: null, see, rows, prevRows, totals: costTotals(rows), prev: costTotals(prevRows),
  salaried: 0, unrated: 2, agencies: [{ agency: "TDH", label: "Agency TDH", rate: 1_000, hours: 8 }, { agency: "MCN", label: "Agency MCN", rate: null, hours: 4 }],
  sheet: { ready: false, error: null },
});
const trend: CostPoint[] = [
  { ...costTotals(prevRows), month: "2026-10", open: false, rows: prevRows },
  { ...costTotals(rows), month: "2026-11", open: false, rows },
];
const input = (see = ALL): CostDeckInput => ({
  report: report(see), trend, mc: null, monthName: "พฤศจิกายน 2026", prevName: "ต.ค.", cutText: "ทั้งเดือน",
  shortMonth: (k) => (k.endsWith("-10") ? "ต.ค." : "พ.ย."), monthLabel: (k) => k, exportedAt: "12 พ.ย. 2026",
});

describe("สไลด์ Cost / ROI: ลายทแยง + เส้นเฉลี่ย", () => {
  test("Cost รายเดือน: เดือนที่ยังไม่จบ = ลายทแยง · เส้นประ = เฉลี่ยของเดือนที่จบแล้ว (เหมือนเว็บ)", async () => {
    const months: CostPoint[] = [
      { ...costTotals(prevRows), month: "2026-09", open: false, rows: prevRows },
      { ...costTotals(prevRows), month: "2026-10", open: false, rows: prevRows },
      { ...costTotals(rows), month: "2026-11", open: true, rows },
    ];
    const slides = await slidesOf(await buildCostDeck({ ...input(), trend: months, shortMonth: (k) => k.slice(5) }));
    const page = slides.find((s) => s.includes("Cost รายเดือน ปี 2026"))!;
    // เดือนที่จบแล้ว 2 เดือน เดือนละ ฿22,500 (Mc 9,000 + Admin 2,500 + Agency 6,000 + Shopee 5,000) · ไม่นับเดือนที่ยังไม่จบ
    expect(page).toContain("เฉลี่ยเดือนที่จบแล้ว ฿22,500");
    expect(page).toContain('<a:prstDash val="dash"/>');
    expect(page).toContain("ลายทแยง = ยังไม่จบเดือน / มี Forecast");
  });
});

describe("สไลด์ Cost / ROI", () => {
  test("เหมือนเว็บ: เส้นในการ์ด · MoM ครบ 4 ตัวชี้วัด + ตาราง Cost / GMV / ROI · เรท Agency · คำเตือน", async () => {
    for (const target of ["pptx", "gslides"] as const) {
      const slides = await slidesOf(await buildCostDeck(input(), target));
      const kpi = slides.find((s) => s.includes("ตัวเลขหลัก พฤศจิกายน 2026"))!;
      expect(kpi).toContain("เส้นในการ์ด = ยอดรายเดือน ต.ค.–พ.ย.");
      expect((kpi.match(/prst="line"/g) ?? []).length).toBeGreaterThanOrEqual(6 * 2); // 6 การ์ด × (ฐาน + เส้น)
      const charts = slides.filter((s) => s.includes("เทียบ MoM แยกกลุ่ม:")).join("");
      expect(titled(slides, "เทียบ MoM แยกกลุ่ม: Cost / GMV<")).toBe(true);
      expect(titled(slides, "เทียบ MoM แยกกลุ่ม: ROI / Cost ต่อ GMV<")).toBe(true);
      for (const label of ["Cost", "GMV", "ROI (GMV ÷ Cost)", "Cost ต่อ GMV (ต่ำ = ดี)"]) expect(charts).toContain(`>${label}<`);
      const table = slides.find((s) => s.includes("เทียบ MoM (ตาราง): พ.ย. vs ต.ค."))!;
      expect(table).toContain("ROI ต.ค.");
      expect(table).toContain("GMV พ.ย.");
      const rates = slides.find((s) => s.includes("เรท Agency พฤศจิกายน 2026"))!;
      expect(rates).toContain("ยังไม่ตั้งเรท");
      expect(rates).toContain("฿8,000");
      expect(titled(slides, "มี 2 คิวที่ยังไม่ได้ตั้งค่าจ้าง")).toBe(true);
      expect(titled(slides, "ประมาณการ")).toBe(true); // คอลัมน์ในตารางแยกกลุ่มทั้งปี
    }
  });
  test("ไม่เห็น GMV / งบ Agency = MoM มีแค่ Cost และไม่มีหน้าเรท", async () => {
    const slides = await slidesOf(await buildCostDeck(input({ mc: true, admin: true, agency: false, gmv: false })));
    expect(slides.filter((s) => s.includes("เทียบ MoM แยกกลุ่ม:"))).toHaveLength(1);
    expect(titled(slides, "เทียบ MoM แยกกลุ่ม: Cost<")).toBe(true);
    expect(titled(slides, ">ROI (GMV ÷ Cost)<")).toBe(false);
    expect(titled(slides, "เรท Agency")).toBe(false);
  });
});
