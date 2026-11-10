// เทสหน้า Cost (bun test): ตัวเลขเดียวกับสรุปรายเดือน · จุดตัด · งบกลุ่มภายนอก · GMV ตามเวลาในแพลน · สิทธิ์
import { describe, expect, test } from "bun:test";
import { costBook, costCut, costRatio, costRows, costTotals, rowCost, yearRows, type CostReport, type CostSee } from "@/lib/cost-calc";
import { ownerSpanOf } from "@/lib/live-owners";
import type { LiveSession } from "@/lib/live-stats";
import { payOfItems } from "@/lib/owner-pay";
import type { OwnerDetail } from "@/lib/types";

const at = (d: string, t: string) => Date.parse(`${d}T${t}:00+07:00`);
const CUT = at("2026-11-10", "12:00");
const ALL: CostSee = { mc: true, admin: true, agency: true, gmv: true };

const detail = (type: "Mc" | "Admin", name: string, d: string, hours: number, more: Partial<OwnerDetail> = {}) => ({
  type, name, date: d, start: "09:00", end: "11:00", platform: "GLORY MALL", hours, startMs: at(d, "09:00"), status: "", cancelled: false, pair: "",
  lateMinutes: null, bonusMinutes: null, lateFromProof: false, bonusFromProof: false, proof: null, noProof: false, gmv: null, gmvCoveredBy: null, campaign: "", ...more,
}) as OwnerDetail;

const summaryOf = (details: OwnerDetail[]) => ({
  rates: { mc: { "Mc เอ": 100 }, admin: { แอน: 50 }, shopee: { "Mc เอ": 200 }, defaultMc: 0, defaultAdmin: 0 },
  mc: [{ name: "Mc เอ", salaried: false }, { name: "Mc ประจำ", salaried: true }, { name: "Mc ใหม่", salaried: false }],
  admin: [{ name: "แอน", salaried: false }],
  details,
}) as never;

const live = (d: string, t: string, gmv: number, platform = "TikTok", accountId = "7126874351866037275", min = 60) => ({
  platform, accountId, accountName: "", title: "", startedAt: new Date(at(d, t)).toISOString(), durationSec: min * 60,
  gmv, orders: 0, itemsSold: 0, customers: null, viewers: 0, views: null, engagedViewers: null, avgViewSec: null, comments: null, shares: null, likes: null,
  newFollowers: null, addToCart: null, impressions: null, clicks: null,
}) as unknown as LiveSession;

const plan = (agency: string, date: string, start: string, end: string, platform = "GLORY MALL") => ({ agency, platform, date, start, end });
const spanRow = (x: ReturnType<typeof plan>) => ownerSpanOf({ agency: x.agency, platform: x.platform, live_date: x.date, start_time: x.start, end_time: x.end });
const run = (over: Partial<Parameters<typeof costRows>[0]> = {}) => costRows({
  summary: summaryOf([]), plan: [], rates: new Map(), sessions: null, spans: [], cut: CUT, see: ALL, ...over,
});

describe("ทีมเรา", () => {
  test("ยอดเท่าสรุปรายเดือน: Mc / Admin / ค่ารถแยกกัน รวมแล้วเท่า payOfItems", () => {
    const list = [detail("Mc", "Mc เอ", "2026-11-01", 2), detail("Admin", "แอน", "2026-11-01", 4, { travel: 80 })];
    const s = summaryOf(list);
    const [r] = run({ summary: s }).rows;
    expect(r).toMatchObject({ app: "TikTok", owner: null, label: "ของเรา", mc: 200, admin: 200, travel: 80 });
    expect(rowCost(r)).toBe(payOfItems(s, "Mc", [list[0]]) + payOfItems(s, "Admin", [list[1]]));
  });
  test("คิว Shopee ไปอยู่แถว In house ของ Shopee + คิดเรท Shopee", () => {
    const { rows } = run({ summary: summaryOf([detail("Mc", "Mc เอ", "2026-11-01", 2, { shopee: true, platform: "Shopee" })]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app: "Shopee", owner: "In house", label: "In house", mc: 400 });
  });
  test("คิวที่ยังไม่ถึงจุดตัด: ไม่นับในยอด แต่อยู่ในทั้งเดือน", () => {
    const [r] = run({ summary: summaryOf([detail("Mc", "Mc เอ", "2026-11-01", 2), detail("Mc", "Mc เอ", "2026-11-20", 3)]) }).rows;
    expect(r.mc).toBe(200);
    expect(r.full).toBe(500);
  });
  test("คิวที่ยกเลิกไม่นับ", () => {
    expect(run({ summary: summaryOf([detail("Mc", "Mc เอ", "2026-11-01", 2, { cancelled: true })]) }).rows).toEqual([]);
  });
  test("Mc ประจำไม่อยู่ในยอด นับจำนวนคิวไว้แจ้ง · ยังไม่ตั้งค่าจ้างก็นับแยก", () => {
    const res = run({ summary: summaryOf([detail("Mc", "Mc ประจำ", "2026-11-01", 2), detail("Mc", "Mc ใหม่", "2026-11-02", 2), detail("Mc", "Mc ใหม่", "2026-11-20", 2)]) });
    expect(res.salaried).toBe(1);
    expect(res.unrated).toBe(1); // คิวที่ยังไม่ถึงจุดตัดไม่นับ
    expect(res.rows).toEqual([]);
  });
});

describe("กลุ่มภายนอก", () => {
  test("งบ = เรท × ชั่วโมงในแพลน · ถึงจุดตัด vs ทั้งเดือน", () => {
    const [r] = run({
      plan: [plan("TDH", "2026-11-01", "19:30", "23:30"), plan("TDH", "2026-11-20", "19:30", "23:30")],
      rates: new Map([["TDH", 2300]]),
    }).rows;
    expect(r).toMatchObject({ app: "TikTok", owner: "TDH", label: "Agency TDH", rate: 2300, planHours: 8, agency: 9200, full: 18400 });
  });
  test("slot ข้ามเที่ยงคืนนับชั่วโมงถูก", () => {
    const [r] = run({ plan: [plan("TDH", "2026-11-01", "21:30", "02:30")], rates: new Map([["TDH", 1000]]) }).rows;
    expect(r.planHours).toBe(5);
    expect(r.agency).toBe(5000);
  });
  test("ยังไม่ตั้งเรท: ไม่มีงบ แต่ยังเห็นแถวและชั่วโมง", () => {
    const [r] = run({ plan: [plan("MCN", "2026-11-01", "10:00", "12:00", "Shopee")] }).rows;
    expect(r).toMatchObject({ app: "Shopee", owner: "MCN", label: "MCN", rate: null, planHours: 2, agency: 0, full: 0 });
  });
  test("In house ไม่มีงบแบบกลุ่มภายนอก (ค่าใช้จ่ายมาจากค่าจ้าง Mc Shopee)", () => {
    expect(run({ plan: [plan("In house", "2026-11-01", "10:00", "12:00", "Shopee")], rates: new Map([["In house", 999]]) }).rows).toEqual([]);
  });
});

describe("GMV", () => {
  const tdh = plan("TDH", "2026-11-01", "19:30", "23:30");
  const infinite = plan("Infinite", "2026-11-01", "10:00", "12:00", "Shopee");
  test("TikTok: ตรงเวลา Agency = ของกลุ่มนั้น ที่เหลือ (รวมช่องอื่น) = ของเรา", () => {
    const { rows } = run({
      plan: [tdh], spans: [spanRow(tdh)], rates: new Map([["TDH", 1000]]),
      sessions: [live("2026-11-01", "20:00", 700), live("2026-11-01", "09:00", 300), live("2026-11-01", "09:00", 50, "TikTok", "7081240278438429722")],
    });
    expect(rows.find((r) => r.owner === "TDH")?.gmv).toBeCloseTo(700);
    expect(rows.find((r) => !r.owner)?.gmv).toBeCloseTo(350);
  });
  test("Shopee: ไม่ใช่ Agency = In house (ทั้งในแพลน In house และนอกแพลน) ไม่มีแถวไม่อยู่ในแพลน", () => {
    const inHouse = plan("In house", "2026-11-01", "06:00", "10:00", "Shopee");
    const { rows } = run({
      plan: [infinite, inHouse], spans: [spanRow(infinite), spanRow(inHouse)], rates: new Map([["Infinite", 900]]),
      sessions: [live("2026-11-01", "10:30", 500, "Shopee", "x"), live("2026-11-01", "15:00", 200, "Shopee", "x"), live("2026-11-01", "07:00", 100, "Shopee", "x")],
    });
    expect(rows.map((r) => [r.label, r.gmv])).toEqual([["In house", 300], ["Agency Infinite", 500]]);
  });
  test("Vis (KOL): ไม่มีงบ (แพลนไม่สร้างแถวงบ) แต่ GMV ช่วงของ Vis เป็นแถวของตัวเอง", () => {
    const vis = plan("Vis", "2026-11-01", "18:00", "22:00", "Shopee");
    const { rows } = run({
      plan: [vis], spans: [spanRow(vis)], rates: new Map([["Vis", 999]]),
      sessions: [live("2026-11-01", "19:00", 800, "Shopee", "x"), live("2026-11-01", "10:00", 100, "Shopee", "x")],
    });
    expect(rows.map((r) => [r.label, r.gmv, rowCost(r), r.rate])).toEqual([["In house", 100, 0, null], ["Vis (KOL)", 800, 0, null]]);
  });
  test("Shopee เดือนที่ยังไม่มีแพลนกลุ่ม: ยอดทั้งหมด = In house", () => {
    const { rows } = run({ sessions: [live("2026-11-01", "15:00", 200, "Shopee", "x")] });
    expect(rows.map((r) => [r.app, r.label, r.gmv])).toEqual([["Shopee", "In house", 200]]);
  });
  test("ไลฟ์หลังจุดตัดไม่นับ", () => {
    const { rows } = run({ sessions: [live("2026-11-01", "09:00", 100), live("2026-11-20", "09:00", 900)] });
    expect(rows[0].gmv).toBe(100);
  });
  test("ลำดับแถว: TikTok ของเรา > กลุ่มภายนอก > Shopee In house > กลุ่มภายนอก", () => {
    const { rows } = run({
      summary: summaryOf([detail("Mc", "Mc เอ", "2026-11-01", 2), detail("Mc", "Mc เอ", "2026-11-01", 2, { shopee: true, platform: "Shopee" })]),
      plan: [infinite, tdh], rates: new Map([["TDH", 1000], ["Infinite", 900]]),
    });
    expect(rows.map((r) => `${r.app} ${r.label}`)).toEqual(["TikTok ของเรา", "TikTok Agency TDH", "Shopee In house", "Shopee Agency Infinite"]);
  });
});

describe("สิทธิ์", () => {
  const s = summaryOf([detail("Mc", "Mc เอ", "2026-11-01", 2), detail("Admin", "แอน", "2026-11-01", 2, { travel: 80 })]);
  const tdh = plan("TDH", "2026-11-01", "19:30", "23:30");
  test("ไม่มีสิทธิ์ฝั่ง Admin: ไม่มีค่าจ้าง Admin และค่ารถ", () => {
    expect(run({ summary: s, see: { ...ALL, admin: false } }).rows[0]).toMatchObject({ mc: 200, admin: 0, travel: 0 });
  });
  test("ไม่มีสิทธิ์แพลน: ไม่เห็นแถวกลุ่มภายนอก แต่ GMV ของกลุ่มนั้นไม่ปนมาที่ของเรา", () => {
    const { rows } = run({
      plan: [tdh], spans: [spanRow(tdh)], rates: new Map([["TDH", 1000]]), see: { ...ALL, agency: false },
      sessions: [live("2026-11-01", "20:00", 700), live("2026-11-01", "09:00", 300)],
    });
    expect(rows.map((r) => r.label)).toEqual(["ของเรา"]);
    expect(rows[0].gmv).toBeCloseTo(300);
  });
});

describe("ตัวเลขจากชีตของทีม", () => {
  const entry = (app: "TikTok" | "Shopee", owner: string | null, kind: "mc" | "admin" | "travel" | "agency", actual: number | null, forecast: number | null, actualHours: number | null = null, forecastHours: number | null = null) =>
    ({ app, owner, kind, actual, forecast, actualHours, forecastHours });
  const mc = detail("Mc", "Mc เอ", "2026-11-01", 2), mcLater = detail("Mc", "Mc เอ", "2026-11-20", 3);
  const find = (rows: ReturnType<typeof run>["rows"], owner: string | null, app = "TikTok") => rows.find((r) => r.owner === owner && r.app === app)!;

  test("Actual ชนะตัวเลขระบบ แม้ไม่เท่ากัน", () => {
    const { rows } = run({ summary: summaryOf([mc]), cut: Infinity, sheet: [entry("TikTok", null, "mc", 999, 800)] });
    expect(find(rows, null)).toMatchObject({ mc: 999, full: 999, sources: { mc: "sheet" }, forecast: 0 });
  });
  test("ไม่มี Actual แต่ระบบมีตัวเลข = ใช้ระบบ ไม่ใช้ Forecast", () => {
    const { rows } = run({ summary: summaryOf([mc]), cut: Infinity, sheet: [entry("TikTok", null, "mc", null, 800)] });
    expect(find(rows, null)).toMatchObject({ mc: 200, sources: {}, forecast: 0 });
  });
  test("ไม่มีทั้ง Actual และระบบ (เดือนจบแล้ว) = ใช้ Forecast ติดป้าย นับแยกไว้", () => {
    const { rows } = run({ cut: Infinity, sheet: [entry("TikTok", "TDH", "agency", null, 2000, 6, 10)] });
    expect(find(rows, "TDH")).toMatchObject({ agency: 2000, full: 2000, sources: { agency: "forecast" }, forecast: 2000, rate: 200, planHours: 10 });
    expect(costTotals(rows).forecast).toBe(2000);
  });
  test("กลุ่มที่ระบบไม่มีเลย สร้างแถวให้จาก Actual พร้อมเรทจากชั่วโมง", () => {
    const { rows } = run({ cut: Infinity, sheet: [entry("Shopee", "Infinite", "agency", 1000, 900, 4, 3), entry("Shopee", "In house", "mc", 500, null)] });
    expect(find(rows, "Infinite", "Shopee")).toMatchObject({ agency: 1000, rate: 250, planHours: 4, sources: { agency: "sheet" } });
    expect(find(rows, "In house", "Shopee")).toMatchObject({ mc: 500 });
  });
  test("เดือนที่ยังไม่จบ: Forecast เป็นยอดทั้งเดือน ไม่ปนยอดถึงวันนี้ ลงเฉพาะช่องทั้งเดือน", () => {
    const { rows } = run({ sheet: [entry("Shopee", "In house", "mc", null, 5000)] });
    expect(find(rows, "In house", "Shopee")).toMatchObject({ mc: 0, full: 5000, forecast: 0 });
    expect(costTotals(rows).cost).toBe(0);
  });
  test("เดือนที่ยังไม่จบ: แผนในระบบชนะ Forecast", () => {
    const { rows } = run({ summary: summaryOf([mc, mcLater]), sheet: [entry("TikTok", null, "mc", null, 9000)] });
    expect(find(rows, null)).toMatchObject({ mc: 200, full: 500 });
  });
  test("Actual ของ Admin แทนยอดระบบ · ค่ารถที่ระบบคิดไม่นับซ้ำ เว้นแต่ชีตกรอกค่าเดินทาง", () => {
    const admin = detail("Admin", "แอน", "2026-11-01", 4, { travel: 80 });
    const blank = run({ summary: summaryOf([admin]), cut: Infinity, sheet: [entry("TikTok", null, "admin", 700, null)] }).rows;
    expect(find(blank, null)).toMatchObject({ admin: 700, travel: 0 });
    const filled = run({ summary: summaryOf([admin]), cut: Infinity, sheet: [entry("TikTok", null, "admin", 700, null), entry("TikTok", null, "travel", 60, null)] }).rows;
    expect(find(filled, null)).toMatchObject({ admin: 700, travel: 60 });
    expect(rowCost(find(filled, null))).toBe(760);
  });
  test("ใช้ยอดจริงทั้ง Mc และ Admin = ไม่เตือนคิวที่ยังไม่ตั้งค่าจ้าง", () => {
    const summary = summaryOf([detail("Mc", "Mc ใหม่", "2026-11-02", 2)]);
    expect(run({ summary, cut: Infinity }).unrated).toBe(1);
    expect(run({ summary, cut: Infinity, sheet: [entry("TikTok", null, "mc", 100, null), entry("TikTok", null, "admin", 50, null)] }).unrated).toBe(0);
  });
  test("สิทธิ์: ไม่เห็นงบ = ไม่เห็นแถวกลุ่มภายนอกจากชีต · ไม่เห็น Admin = ไม่เห็นยอด Admin / ค่าเดินทาง", () => {
    const sheet = [entry("TikTok", "TDH", "agency", 1000, null), entry("TikTok", null, "admin", 700, null), entry("TikTok", null, "travel", 60, null), entry("TikTok", null, "mc", 300, null)];
    const { rows } = run({ cut: Infinity, sheet, see: { ...ALL, agency: false, admin: false } });
    expect(rows.map((r) => r.label)).toEqual(["ของเรา"]);
    expect(rows[0]).toMatchObject({ mc: 300, admin: 0, travel: 0 });
  });
  test("ไม่มียอดเลย ไม่สร้างแถวเปล่า", () => {
    expect(run({ cut: Infinity, sheet: [entry("Shopee", "Vis Shopee", "agency", null, null, 21, null)] }).rows).toEqual([]);
  });
  test("รวมทั้งปีต่อกลุ่ม: เดือนละที่มา รวมเงิน + ประมาณการ เรียงเหมือนเดิม", () => {
    const a = run({ cut: Infinity, sheet: [entry("TikTok", "TDH", "agency", 1000, null, 4, null), entry("TikTok", null, "mc", 300, null)] }).rows;
    const b = run({ cut: Infinity, sheet: [entry("TikTok", "TDH", "agency", null, 2000, null, 10), entry("TikTok", null, "mc", 400, null)] }).rows;
    const year = yearRows([{ ...costTotals(a), month: "2026-01", open: false, rows: a }, { ...costTotals(b), month: "2026-02", open: false, rows: b }]);
    expect(year.map((r) => r.label)).toEqual(["ของเรา", "Agency TDH"]);
    expect(year[0].mc).toBe(700);
    expect(year[1]).toMatchObject({ agency: 3000, forecast: 2000 });
  });
});

describe("จุดตัด", () => {
  const now = at("2026-11-06", "16:00");
  test("เดือนที่จบแล้ว = ทั้งเดือน", () => {
    expect(costCut(now, "2026-10-31", null)).toBe(Infinity);
  });
  test("เดือนนี้: ไลฟ์ล่าสุดในไฟล์ · ไม่มีไฟล์ = ตอนนี้", () => {
    expect(costCut(now, "2026-11-30", [{ startedAt: new Date(at("2026-11-05", "23:30")).toISOString() }])).toBe(at("2026-11-05", "23:30"));
    expect(costCut(now, "2026-11-30", [])).toBe(now);
    expect(costCut(now, "2026-11-30", null)).toBe(now);
  });
});

describe("ยอดรวม + ไฟล์ส่งออก", () => {
  const rows = costRows({
    summary: summaryOf([detail("Mc", "Mc เอ", "2026-11-01", 2)]), plan: [plan("TDH", "2026-11-01", "19:30", "23:30"), plan("MCN", "2026-11-01", "10:00", "12:00", "Shopee")],
    rates: new Map([["TDH", 1000]]), sessions: [live("2026-11-01", "09:00", 1000)], spans: [], cut: CUT, see: ALL,
  }).rows;
  const totals = costTotals(rows);
  test("รวมทุกแถว · ไม่มี GMV เลย = null · Cost/GMV", () => {
    expect(totals).toMatchObject({ mc: 200, agency: 4000, cost: 4200, gmv: 1000 });
    expect(costTotals([]).gmv).toBeNull();
    expect(costRatio(100, 1000)).toBe(0.1);
    expect(costRatio(100, null)).toBeNull();
    expect(costRatio(100, 0)).toBeNull();
  });
  const report = (upTo: number | null): CostReport => ({
    month: "2026-11", prevMonth: "2026-10", upTo, see: ALL, rows, totals, prev: totals, salaried: 0, unrated: 0, agencies: [], sheet: { ready: false, error: null },
  });
  test("แผ่น Cost + งบ Agency เฉพาะกลุ่มที่ตั้งเรท · เดือนจบแล้วไม่มีคอลัมน์ทั้งเดือน", () => {
    const book = costBook(report(null), null);
    expect(book.sheets.map((s) => s.name)).toEqual(["Cost", "งบ Agency"]);
    expect(book.sheets[0].rows[0]).not.toContain("ทั้งเดือนตามแผน");
    expect(book.sheets[1].rows.map((r) => r[0])).toEqual(["กลุ่ม", "Agency TDH", "รวม"]);
  });
  test("เดือนที่ยังไม่จบมีคอลัมน์ทั้งเดือน · มีแนวโน้ม = มีแผ่นแนวโน้ม", () => {
    const book = costBook(report(CUT), [{ ...totals, month: "2026-11", open: true, rows }]);
    expect(book.sheets[0].rows[0]).toContain("ทั้งเดือนตามแผน");
    expect(book.sheets.map((s) => s.name)).toContain("แนวโน้มรายเดือน");
  });
});
