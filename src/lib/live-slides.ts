// สไลด์นำเสนอผลการเทียบ 2 ช่วง (เดือน / ไตรมาส / YoY / แคมเปญ) -> ไฟล์ PowerPoint (.pptx)
//   สร้างในเบราว์เซอร์ด้วย pptxgenjs (โหลดเฉพาะตอนกด) กราฟเป็นกราฟจริงของ PowerPoint แก้ตัวเลขต่อได้
//   Google Slides = อัปไฟล์เดียวกันไปแปลงที่ /api/export/slides

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type PptxGenJS from "pptxgenjs";
import { analyze } from "@/lib/live-insights";
import { platformSeries, totalSeries } from "@/lib/live-lines";
import { breakdownRows, mainLeg, type BreakdownRow } from "@/lib/live-breakdown";
import { DAY_KINDS, dayKindLabel, dayKindStats, type DayTag } from "@/lib/live-days";
import { HEAT_MIN_SEC, HEAT_WEEKDAY_NAMES, HEAT_WEEKDAYS, heatGrid, heatHour, heatPerHour, heatTop } from "@/lib/live-heat";
import { AGENCY_OURS, mergePlatforms, type AgencyTrend, type ChannelSplit, type OwnerSpan } from "@/lib/live-owners";
import { accountLabel, accountsOf, changeOf, fmtMetric, METRICS, metricOf, totalsOf, type LiveSession, type MetricKey, type Platform, type Totals } from "@/lib/live-stats";
import type { targetReport } from "@/lib/live-targets";

export type CompareDeckInput = {
  report: string; // เช่น "Campaign on Campaign" / "เทียบเดือน (MoM)"
  aName: string;
  bName: string;
  aRange: string;
  bRange: string;
  a: LiveSession[];
  b: LiveSession[];
  timeName: string; // "รายชั่วโมง" / "รายวัน" / "รายเดือน"
  time: { short: string; a: LiveSession[]; b: LiveSession[] }[];
  filterText: string; // เช่น "TikTok · ทุกบัญชี"
  exportedAt: string;
  /** หน้าปกแบบอื่น (ภาพรวมทั้งปี): หัวเล็ก + หัวใหญ่ แทน "report" + "A vs B" */
  cover?: { kicker: string; headline: string };
  /** ช่วงเดียว ไม่เทียบ (เช่น ดูรายวัน): ไม่มีข้อความ "ไม่มีข้อมูลให้เทียบ" (b = []) */
  single?: boolean;
  /** เพิ่มหน้ารายไตรมาส (a = ช่วงหลัก, b = ปีก่อน) + QoQ */
  quarters?: { label: string; a: LiveSession[]; b: LiveSession[]; before: LiveSession[]; open: boolean }[];
  /** หน้าวิเคราะห์ใช้คู่นี้แทน (เช่น ยังไม่มีข้อมูลปีก่อน -> เดือนล่าสุดเทียบเดือนก่อน) */
  focus?: { aName: string; bName: string; a: LiveSession[]; b: LiveSession[] };
  /**
   * กราฟตามเวลาแยกแพลตฟอร์มแม้มีช่วงเทียบ เหมือนหน้ารายเดือนบนเว็บ
   *   ช่วงเทียบใช้กับตัวเลขหลัก / ตาราง / วิเคราะห์ ส่วนกราฟรายวันเป็นแท่งซ้อน + เส้นแยกแพลตฟอร์ม (ไม่มีเส้นรวม)
   */
  platformTime?: boolean;
  /** กราฟแท่งหลายเดือนย้อนหลัง (หน้ารายเดือน = 13 เดือน) */
  months?: { short: string; a: LiveSession[] }[];
  /** หน้าเป้าหมาย GMV (src/lib/live-targets.ts) · names = ชื่อช่องตาม key */
  target?: { report: ReturnType<typeof targetReport>; lastDay: number; names: Map<string, string> };
  /** หน้าแยกตามกลุ่มผู้ไลฟ์ (src/lib/live-owners.ts) */
  owners?: ChannelSplit[];
  /** หน้า GMV แยก Agency (แท่งคู่ TikTok | Shopee ซ้อนตามกลุ่ม เหมือนแท็บ "แยก Agency" บนเว็บ) */
  agency?: AgencyChart[];
  /** หน้าเทียบรายกลุ่มและรายบัญชี (src/lib/live-breakdown.ts) · spans null = มีแค่รายบัญชี */
  breakdown?: { spans: OwnerSpan[] | null };
  /** หน้า "ช่วงเวลาไหนขายดี" (ไลฟ์ของช่วงหลัก · src/lib/live-heat.ts) */
  heat?: { title: string };
  /** หน้า "วันปกติ vs วันแคมเปญ" (src/lib/live-days.ts) */
  dayKinds?: { title: string; tags: Map<string, DayTag> };
};

/** กราฟแยก Agency 1 หน้า · lineTitle = เพิ่มหน้ากราฟเส้น GMV/ชม. เส้นละกลุ่ม */
export type AgencyChart = { title: string; labels: string[]; trend: AgencyTrend[]; lineTitle?: string };

// โทนแบรนด์ (ตรงกับเว็บ): ชมพู = ช่วงหลัก / ฟ้า = ช่วงเทียบ
const C = {
  dark: "3A1628", pink: "C62F6A", pinkOnDark: "F2699F", blue: "5A8FD0", blueOnDark: "8FB0E6",
  tint: "FDE8F0", text: "3A1628", muted: "8C6879", mutedOnDark: "D9B8C7", white: "FFFFFF",
  up: "1C7A4E", down: "C0352B", grid: "F2DCE6",
};
const FONT = "Tahoma"; // มีภาษาไทย ทั้ง PowerPoint และ Google Slides
const W = 13.333, H = 7.5, M = 0.6;

const val = (t: Totals, k: MetricKey) => (t.lives ? metricOf(k).value(t) : null);
const fmt = (k: MetricKey, v: number | null) => fmtMetric(metricOf(k).kind, v);
/** หน่วยของกราฟตามเวลา: "รายชั่วโมง" -> "ชั่วโมง" / "รายวัน" -> "วัน" / "รายเดือน" -> "เดือน" */
const stepWordOf = (timeName: string) => (timeName === "รายชั่วโมง" ? "ชั่วโมง" : timeName === "รายวัน" ? "วัน" : "เดือน");
const pctText = (c: number | null) => (c === null ? "ไม่มีข้อมูลเทียบ" : `${c >= 0 ? "▲" : "▼"} ${Math.abs(c * 100).toFixed(1)}%`);
const pctColor = (c: number | null) => (c === null ? C.muted : Math.abs(c) < 0.0005 ? C.muted : c > 0 ? C.up : C.down);
const keyOf = (s: LiveSession) => `${s.platform}|${s.accountId}`;
// ตัวเลขบนกราฟ: 1.2M / 350K
const COMPACT = '[>=1000000]"฿"#,##0.0,,"M";[>=1000]"฿"#,##0,"K";"฿"#,##0';

/** ข้อสังเกตอัตโนมัติ (ใช้ในหน้าสรุปและข้างกราฟ) */
function insights(o: CompareDeckInput, ta: Totals, tb: Totals) {
  const out: string[] = [];
  const g = changeOf(val(ta, "gmv"), val(tb, "gmv"));
  out.push(g === null
    ? `GMV ${o.aName} ${fmt("gmv", val(ta, "gmv"))}${o.single ? "" : ` (ไม่มีข้อมูล ${o.bName} ให้เทียบ)`}`
    : `GMV ${o.aName} ${fmt("gmv", val(ta, "gmv"))} ${g >= 0 ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(g * 100).toFixed(1)}% จาก ${o.bName}`);
  const changes = METRICS.filter((m) => m.key !== "gmv")
    .map((m) => ({ m, c: changeOf(val(ta, m.key), val(tb, m.key)) }))
    .filter((x): x is { m: (typeof METRICS)[number]; c: number } => x.c !== null);
  const best = changes.slice().sort((x, y) => y.c - x.c)[0];
  const worst = changes.slice().sort((x, y) => x.c - y.c)[0];
  if (best && best.c > 0) out.push(`เพิ่มขึ้นมากสุด: ${best.m.label} ▲ ${(best.c * 100).toFixed(1)}%`);
  if (worst && worst.c < 0) out.push(`ลดลงมากสุด: ${worst.m.label} ▼ ${Math.abs(worst.c * 100).toFixed(1)}%`);
  const acc = accountsOf([...o.a, ...o.b]).map((x) => ({
    name: x.name,
    diff: totalsOf(o.a.filter((s) => keyOf(s) === x.key)).gmv - totalsOf(o.b.filter((s) => keyOf(s) === x.key)).gmv,
  }));
  const up = acc.slice().sort((x, y) => y.diff - x.diff)[0];
  const down = acc.slice().sort((x, y) => x.diff - y.diff)[0];
  if (tb.lives && up && up.diff > 0) out.push(`บัญชีที่ GMV เพิ่มมากสุด: ${up.name} (+${fmt("gmv", up.diff)})`);
  if (tb.lives && down && down.diff < 0) out.push(`บัญชีที่ GMV ลดมากสุด: ${down.name} (−${fmt("gmv", -down.diff)})`);
  const peak = o.time.map((t) => ({ label: t.short, gmv: totalsOf(t.a).gmv })).sort((x, y) => y.gmv - x.gmv)[0];
  if (o.time.length > 1 && peak?.gmv) out.push(`${stepWordOf(o.timeName)}ที่ขายดีสุดของ ${o.aName}: ${peak.label} (${fmt("gmv", peak.gmv)})`);
  return out;
}

/** ตัวเลขย่อบนกราฟ: ฿25.8M / ฿931K / ฿0 */
const compactBaht = (v: number) => compact(v);
function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `฿${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1_000) return `฿${Math.round(v / 1_000)}K`;
  return `฿${Math.round(v)}`;
}

/** สเกลแกนตั้งแบบเลขสวย เริ่มที่ 0 (4–5 เส้น) */
function niceTicks(max: number) {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

/** ตำนานของกราฟที่วาดด้วยรูปทรง: กว้างตามชื่อ (ชื่อช่วงยาว เช่น "พฤหัสบดี 5 พ.ย. 2026" ไม่ตัดบรรทัด) · line = ขีดแทนสี่เหลี่ยม */
function shapeLegend(pres: PptxGenJS, s: PptxGenJS.Slide, box: { x: number; y: number; w: number }, series: { name: string; color: string }[], line = false) {
  const nameW = (name: string) => Math.min(3.6, 0.1 * name.length + 0.25);
  const total = series.reduce((a, sr) => a + 0.34 + nameW(sr.name), 0);
  let lx = box.x + Math.max(0, (box.w - total) / 2);
  for (const sr of series) {
    if (line) s.addShape(pres.ShapeType.line, { x: lx, y: box.y + 0.16, w: 0.24, h: 0, line: { color: sr.color, width: 2.25 } });
    else s.addShape(pres.ShapeType.rect, { x: lx + 0.08, y: box.y + 0.08, w: 0.16, h: 0.16, fill: { color: sr.color }, line: { color: sr.color } });
    s.addText(sr.name, { x: lx + 0.3, y: box.y, w: nameW(sr.name), h: 0.32, fontSize: 12, color: C.text, valign: "middle", fontFace: FONT, margin: 0, isTextBox: true, wrap: false });
    lx += 0.34 + nameW(sr.name);
  }
}

/** กราฟแท่งวาดด้วยรูปทรง (คมชัดทุกขนาด แปลงเป็น Google Slides ได้ตรงทุกจุด) */
function shapeBars(pres: PptxGenJS, s: PptxGenJS.Slide, o: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  box: { x: number; y: number; w: number; h: number };
  showValue: boolean;
  /** ชุดที่เน้น (ตัวเลขตัวหนา) ไม่ใส่ = ชุดแรก */
  emphasis?: number;
  /** แท่งซ้อน: ความสูงรวม = ยอดรวม ตัวเลขบนแท่งเป็นยอดรวม */
  stacked?: boolean;
  /** รูปแบบตัวเลขบนแกน / แท่ง (ไม่ใส่ = บาทย่อ ฿1.2M) */
  format?: (v: number) => string;
  /** false = ไม่วาดตำนาน (หลายกราฟในหน้าเดียว ใช้ตำนานร่วม) */
  legend?: boolean;
  /** false = ไม่ใส่ % ที่เปลี่ยนเหนือคู่แท่ง (2 ชุดไม่ใช่ช่วงที่เทียบกัน เช่น TikTok / Shopee) */
  change?: boolean;
}) {
  const { x, y, w, h } = o.box;
  const em = o.emphasis ?? 0;
  const compact = o.format ?? compactBaht;
  const text = (t: string, opts: PptxGenJS.TextPropsOptions) => s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, ...opts });
  if (o.legend !== false) shapeLegend(pres, s, { x, y, w }, o.series);
  // เผื่อที่ด้านบน 25% ให้ตัวเลขบนแท่ง + % ที่เปลี่ยน ไม่ชนขอบ
  const totalAt = (i: number) => o.series.reduce((a, sr) => a + (sr.values[i] ?? 0), 0);
  const max = o.stacked ? Math.max(0, ...o.labels.map((_, i) => totalAt(i))) : Math.max(0, ...o.series.flatMap((sr) => sr.values));
  const ticks = niceTicks(max * 1.25);
  const top = ticks[ticks.length - 1] || 1;
  const px = x + 0.85, pw = w - 0.9, py = y + 0.5, ph = h - 0.5 - 0.45;
  const yOf = (v: number) => py + ph - (v / top) * ph;
  for (const t of ticks) {
    s.addShape(pres.ShapeType.line, { x: px, y: yOf(t), w: pw, h: 0, line: { color: t ? C.grid : C.muted, width: t ? 0.75 : 1 } });
    text(compact(t), { x: x, y: yOf(t) - 0.13, w: 0.78, h: 0.26, fontSize: 11, color: C.muted, align: "right", valign: "middle" });
  }
  const n = o.labels.length, k = o.stacked ? 1 : o.series.length;
  const gw = pw / Math.max(1, n);
  const bw = Math.min(1.0, (gw * 0.76) / k);
  const every = Math.max(1, Math.ceil(n / Math.floor(pw / 0.55)));
  // ขนาดตัวเลขตามความกว้างแท่ง (ป้ายกว้างเท่าแท่ง ไม่ชนแท่งข้าง ๆ) เช่น "฿44.1M" ~6 ตัว
  const valueSize = bw >= 0.95 ? 14 : bw >= 0.75 ? 12 : bw >= 0.55 ? 10 : 9;
  o.labels.forEach((label, i) => {
    const gx = px + i * gw + (gw - bw * k) / 2;
    if (i % every === 0) text(label, { x: px + i * gw, y: py + ph + 0.08, w: gw, h: 0.32, fontSize: n > 12 ? 10 : 12, color: C.text, align: "center", valign: "top", fit: "shrink" });
    if (o.stacked) {
      let base = 0;
      for (const sr of o.series) {
        const v = sr.values[i] ?? 0;
        if (v > 0) s.addShape(pres.ShapeType.rect, { x: gx, y: yOf(base + v), w: bw - 0.03, h: (v / top) * ph, fill: { color: sr.color }, line: { color: sr.color, width: 0 } });
        base += v;
      }
      if (o.showValue && base > 0) text(compact(base), { x: gx - 0.15, y: yOf(base) - 0.3, w: bw + 0.27, h: 0.28, fontSize: valueSize, bold: true, color: C.text, align: "center", valign: "bottom" });
      return;
    }
    let peak = 0;
    o.series.forEach((sr, j) => {
      const v = sr.values[i] ?? 0;
      peak = Math.max(peak, v);
      if (v > 0) {
        s.addShape(pres.ShapeType.rect, { x: gx + j * bw, y: yOf(v), w: bw - 0.03, h: (v / top) * ph, fill: { color: sr.color }, line: { color: sr.color, width: 0 } });
      }
      if (o.showValue && v > 0) {
        text(compact(v), {
          x: gx + j * bw - 0.02, y: yOf(v) - 0.3, w: bw + 0.01, h: 0.28, fontSize: valueSize, bold: j === em,
          color: j === em ? C.text : C.muted, align: "center", valign: "bottom",
        });
      }
    });
    // % ที่เปลี่ยน (ชุดแรก เทียบ ชุดที่สอง) เหนือคู่แท่ง
    const [a, b] = [o.series[0]?.values[i] ?? 0, o.series[1]?.values[i] ?? 0];
    const c = k === 2 && o.change !== false ? changeOf(a, b || null) : null;
    if (o.showValue && c !== null) {
      text(pctText(c), {
        x: px + i * gw, y: yOf(peak) - 0.7, w: gw, h: 0.32, fontSize: Math.max(valueSize, gw >= 1.1 ? 12 : 10), bold: true,
        color: pctColor(c), align: "center", valign: "bottom",
      });
    }
  });
}

type ChartTarget = "pptx" | "gslides";
type ChartBox = { x: number; y: number; w: number; h: number };
type LineSeries = { name: string; color: string; values: (number | null)[] };

/** สีตามแพลตฟอร์ม (เหมือนเว็บ) */
const PLATFORM_COLOR: Record<string, string> = { TikTok: C.pink, Shopee: C.blue };
/** GMV / ค่าต่างๆ ของแต่ละกลุ่มแยกแพลตฟอร์ม พร้อมสี */
const platformLines = (groups: LiveSession[][], metric: MetricKey): LineSeries[] =>
  platformSeries(groups, metric).map((x) => ({ name: x.platform, color: PLATFORM_COLOR[x.platform], values: x.values }));
/**
 * เส้นแนวโน้มช่วงเดียว: แยกแพลตฟอร์ม + เส้นรวม เหมือนหน้าเว็บ (src/components/LiveStats.tsx trendLines)
 *   เหลือแพลตฟอร์มเดียว = เส้นรวมคือเส้นเดียวกัน · ค่าที่รวมไม่ได้ (CO) ไม่มีเส้นรวม · รายชั่วโมงไม่มีเส้นรวม (แต่ละชั่วโมงมักมีแพลตฟอร์มเดียว)
 */
function platformTrend(groups: LiveSession[][], metric: MetricKey, withTotal: boolean): LineSeries[] {
  const lines = platformLines(groups, metric);
  const total = totalSeries(groups, metric);
  return withTotal && lines.length > 1 && total.some((v) => v !== null) ? [...lines, { name: "รวม", color: C.text, values: total }] : lines;
}

/**
 * กราฟเส้น: ลากเชื่อมทุกจุดที่มีค่า ข้ามช่วงที่ไม่มีค่า (เหมือนเว็บ) จุด = ค่าจริง
 *   PowerPoint = กราฟจริงแก้ตัวเลขได้ / Google Slides = วาดด้วยรูปทรง (Google แปลงกราฟจริงเป็นรูปเบลอ)
 */
function lineChart(pres: PptxGenJS, s: PptxGenJS.Slide, target: ChartTarget, o: {
  title: string; labels: string[]; series: LineSeries[]; box: ChartBox;
  /** รูปแบบตัวเลข (ไม่ใส่ = บาทย่อ) · code = รูปแบบของ PowerPoint · fn = ของ Google Slides */
  format?: { code: string; fn: (v: number) => string };
}) {
  const points = o.series.reduce((a, sr) => a + sr.values.filter((v) => v !== null).length, 0);
  // จุดไม่เยอะ = ใส่ตัวเลขได้ไม่รก
  const showValue = points <= 16;
  const code = o.format?.code ?? COMPACT;
  const compact = o.format?.fn ?? compactBaht;
  if (target === "pptx") {
    s.addChart(pres.ChartType.line, o.series.map((sr) => ({ name: sr.name, labels: o.labels, values: sr.values as number[] })), {
      ...o.box, chartColors: o.series.map((sr) => sr.color), lineSize: 2.25, lineDataSymbol: "circle", lineDataSymbolSize: 7, displayBlanksAs: "span",
      showLegend: o.series.length > 1, legendPos: "t", legendFontSize: 12, legendFontFace: FONT, legendColor: C.text, showTitle: false, altText: o.title,
      showValue, dataLabelPosition: "t", dataLabelFormatCode: code, dataLabelFontSize: 11, dataLabelFontFace: FONT, dataLabelColor: C.text,
      valAxisMinVal: 0, valAxisLabelFormatCode: code, valAxisLabelFontSize: 11, valAxisLabelFontFace: FONT, valAxisLabelColor: C.muted,
      catAxisLabelFontSize: 11, catAxisLabelFontFace: FONT, catAxisLabelColor: C.text, valGridLine: { color: C.grid, size: 0.75 }, catGridLine: { style: "none" },
    });
    return;
  }
  const { x, y, w, h } = o.box;
  const text = (t: string, opts: PptxGenJS.TextPropsOptions) => s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, ...opts });
  if (o.series.length > 1) shapeLegend(pres, s, { x, y, w }, o.series, true);
  const max = Math.max(0, ...o.series.flatMap((sr) => sr.values.map((v) => v ?? 0)));
  const ticks = niceTicks(max * 1.15);
  const top = ticks[ticks.length - 1] || 1;
  const px = x + 0.85, pw = w - 0.9, py = y + 0.5, ph = h - 0.5 - 0.45;
  const n = o.labels.length, gw = pw / Math.max(1, n);
  const xOf = (i: number) => px + (i + 0.5) * gw, yOf = (v: number) => py + ph - (v / top) * ph;
  for (const t of ticks) {
    s.addShape(pres.ShapeType.line, { x: px, y: yOf(t), w: pw, h: 0, line: { color: t ? C.grid : C.muted, width: t ? 0.75 : 1 } });
    text(compact(t), { x, y: yOf(t) - 0.13, w: 0.78, h: 0.26, fontSize: 11, color: C.muted, align: "right", valign: "middle" });
  }
  const every = Math.max(1, Math.ceil(n / Math.floor(pw / 0.55)));
  o.labels.forEach((label, i) => {
    if (i % every === 0) text(label, { x: px + i * gw, y: py + ph + 0.08, w: gw, h: 0.32, fontSize: n > 12 ? 10 : 12, color: C.text, align: "center", valign: "top", fit: "shrink" });
  });
  // วาดจากเส้นท้าย เส้นแรกอยู่บนสุด (เส้นรวมไม่บังสีแพลตฟอร์ม เหมือนเว็บ)
  for (const sr of [...o.series].reverse()) {
    const pts = sr.values.flatMap((v, i) => (v === null ? [] : [{ i, v }]));
    pts.slice(1).forEach((b, k) => {
      const a = pts[k], y1 = yOf(a.v), y2 = yOf(b.v);
      s.addShape(pres.ShapeType.line, { x: xOf(a.i), y: Math.min(y1, y2), w: xOf(b.i) - xOf(a.i), h: Math.abs(y2 - y1), flipV: y2 < y1, line: { color: sr.color, width: 2.25 } });
    });
    for (const p of pts) {
      s.addShape(pres.ShapeType.ellipse, { x: xOf(p.i) - 0.05, y: yOf(p.v) - 0.05, w: 0.1, h: 0.1, fill: { color: sr.color }, line: { color: C.white, width: 0.75 } });
      if (showValue) text(compact(p.v), { x: xOf(p.i) - 0.5, y: yOf(p.v) - 0.34, w: 1, h: 0.26, fontSize: 11, color: C.text, align: "center", valign: "bottom" });
    }
  }
}

/** หน้ากราฟเส้นเต็มหน้า · มีช่วงที่ไม่มีค่า = บอกไว้ว่าเส้นตรงนั้นลากข้าม */
function addTrendSlide(pres: PptxGenJS, target: ChartTarget, title: string, labels: string[], series: LineSeries[]) {
  if (!series.some((sr) => sr.values.some((v) => v !== null))) return;
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText(title, { placeholder: "title" });
  lineChart(pres, s, target, { title, labels, series, box: { x: M, y: 1.4, w: W - 2 * M, h: 5.2 } });
  const gap = series.some((sr) => {
    const on = sr.values.flatMap((v, i) => (v === null ? [] : [i]));
    return on.length > 1 && on[on.length - 1] - on[0] + 1 > on.length;
  });
  const star = labels.some((l) => l.endsWith("*"));
  const note = [gap ? "จุด = มีข้อมูลจริง · ช่วงที่ไม่มีไลฟ์เส้นจะลากเชื่อมข้ามไป" : "", star ? "* ยังไม่จบเดือน" : ""].filter(Boolean).join(" · ");
  if (note) s.addText(note, { x: M, y: 6.65, w: 9, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
}

/**
 * กราฟแท่งแยกสีตามแพลตฟอร์ม (เหมือนเว็บ): หลายแพลตฟอร์ม = แท่งซ้อน ความสูงรวมคือยอดรวม · แพลตฟอร์มเดียว = สีของแพลตฟอร์มนั้น
 *   PowerPoint = กราฟจริง (ตัวเลขอยู่กลางแต่ละส่วน) / Google Slides = วาดด้วยรูปทรง (ตัวเลขเป็นยอดรวมบนแท่ง)
 */
function platformBars(pres: PptxGenJS, s: PptxGenJS.Slide, target: ChartTarget, o: { title: string; labels: string[]; groups: LiveSession[][]; box: ChartBox; showValue: boolean }) {
  const series = platformLines(o.groups, "gmv");
  if (!series.length) return;
  const stacked = series.length > 1;
  if (target === "gslides") {
    shapeBars(pres, s, { labels: o.labels, series: series.map((sr) => ({ ...sr, values: sr.values.map((v) => v ?? 0) })), box: o.box, showValue: o.showValue, stacked: true });
    return;
  }
  const valueSize = o.labels.length <= 4 ? 14 : o.labels.length <= 8 ? 12 : 10;
  // กลุ่มที่ไม่มียอด = ช่องว่าง ไม่ใช่ 0 (ไม่งั้นมีป้าย ฿0 ซ้อนบนแท่ง เช่น บัญชี TikTok ในชุด Shopee)
  s.addChart(pres.ChartType.bar, series.map((sr) => ({ name: sr.name, labels: o.labels, values: sr.values.map((v) => v || null) as number[] })), {
    ...o.box, barDir: "col", barGrouping: stacked ? "stacked" : "clustered", barGapWidthPct: 60, chartColors: series.map((sr) => sr.color),
    showLegend: stacked, legendPos: "t", legendFontSize: 12, legendFontFace: FONT, legendColor: C.text, showTitle: false, altText: o.title,
    // แท่งซ้อนใส่ป้ายนอกแท่งไม่ได้ (PowerPoint ฟ้องไฟล์เสีย)
    showValue: o.showValue, dataLabelPosition: stacked ? "ctr" : "outEnd", dataLabelFormatCode: COMPACT, dataLabelFontSize: valueSize,
    dataLabelFontBold: true, dataLabelFontFace: FONT, dataLabelColor: stacked ? C.white : C.text,
    valAxisMinVal: 0, valAxisLabelFormatCode: COMPACT, valAxisLabelFontSize: 11, valAxisLabelFontFace: FONT, valAxisLabelColor: C.muted,
    catAxisLabelFontSize: 11, catAxisLabelFontFace: FONT, catAxisLabelColor: C.text,
    valGridLine: { color: C.grid, size: 0.75 }, catGridLine: { style: "none" },
  });
}

/** สไลด์ว่าง 16:9 + แม่แบบหน้าเนื้อหา "CONTENT" (หัวข้อซ้ายบน + ท้ายหน้า = footer / เลขหน้า) */
async function newDeck(title: string, footer: string) {
  const { default: Pptx } = await import("pptxgenjs");
  const pres: PptxGenJS = new Pptx();
  pres.layout = "LAYOUT_WIDE";
  pres.title = title;
  pres.author = "GLORY VITAL Live analytics";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
  pres.defineSlideMaster({
    title: "CONTENT",
    background: { color: C.white },
    objects: [
      { text: { text: footer, options: { x: M, y: H - 0.45, w: 9, h: 0.3, fontSize: 10, color: C.muted, fontFace: FONT, margin: 0 } } },
      { placeholder: { options: { name: "title", type: "title", x: M, y: 0.4, w: W - 2 * M, h: 0.8, fontSize: 30, bold: true, color: C.text, fontFace: FONT, margin: 0, valign: "middle", align: "left" }, text: "" } },
    ],
    slideNumber: { x: W - M - 0.6, y: H - 0.45, w: 0.6, h: 0.3, fontSize: 10, color: C.muted, fontFace: FONT, align: "right" },
  });
  return pres;
}

/** เขียนไฟล์ .pptx (+ แก้ฟอนต์ไทยในธีม) */
async function finish(pres: PptxGenJS) {
  const data = (await pres.write({ outputType: "uint8array", compression: true })) as Uint8Array;
  return new Blob([thaiThemeFont(data) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

/** หน้าวิเคราะห์: ลดลง / ทำได้ดี (ซ้าย) + ข้อเสนอแนะ (ขวา) */
function addAnalysisSlide(pres: PptxGenJS, analysis: ReturnType<typeof analyze>, title: string) {
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText(title, { placeholder: "title" });
  const list = (items: string[], mark: string, color: string) => items.length
    ? items.flatMap((t, i) => [
      { text: `${mark} `, options: { color, bold: true } },
      { text: t, options: { color: C.text, breakLine: i < items.length - 1 } },
    ])
    : [{ text: "ไม่มี", options: { color: C.muted } }];
  s.addText("ลดลง / ต้องจับตา", { x: M, y: 1.45, w: 5.9, h: 0.4, fontSize: 17, bold: true, color: C.down, fontFace: FONT, margin: 0, isTextBox: true });
  s.addText(list(analysis.drops, "▼", C.down), { x: M, y: 1.9, w: 5.9, h: 2.55, fontSize: 13, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 6, fit: "shrink", isTextBox: true });
  s.addText("ทำได้ดี", { x: M, y: 4.6, w: 5.9, h: 0.4, fontSize: 17, bold: true, color: C.up, fontFace: FONT, margin: 0, isTextBox: true });
  s.addText(list(analysis.wins, "▲", C.up), { x: M, y: 5.05, w: 5.9, h: 1.75, fontSize: 13, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 6, fit: "shrink", isTextBox: true });
  s.addShape(pres.ShapeType.roundRect, { x: 6.85, y: 1.4, w: W - M - 6.85, h: 5.45, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
  s.addText("ข้อเสนอแนะ", { x: 7.1, y: 1.6, w: 5.4, h: 0.4, fontSize: 17, bold: true, color: C.pink, fontFace: FONT, margin: 0, isTextBox: true });
  s.addText(analysis.suggestions.map((t, i) => ({ text: t, options: { bullet: { type: "number" as const }, breakLine: i < analysis.suggestions.length - 1 } })),
    { x: 7.1, y: 2.1, w: 5.4, h: 4.6, fontSize: 13, color: C.text, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 8, fit: "shrink", isTextBox: true });
  s.addNotes("วิเคราะห์อัตโนมัติจากตัวเลขจริง: นับเฉพาะที่เปลี่ยนเกิน 5% / ข้อเสนอแนะผูกกับสาเหตุที่พบ (ชั่วโมงไลฟ์ GMV/ชม. CTR CO ยอดต่อออเดอร์ Viewers บัญชี ช่วงเวลา)");
}

/** หน้า "อะไรทำให้ GMV เปลี่ยน": ผลจากชั่วโมงไลฟ์ / ยอดต่อชั่วโมง (ซ้าย) + กรวยการขายแต่ละแพลตฟอร์ม (ขวา) */
function addDriversSlide(pres: PptxGenJS, analysis: ReturnType<typeof analyze>, ta: Totals, tb: Totals, aName: string, bName: string, title: string) {
  if (!analysis.drivers) return;
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText(title, { placeholder: "title" });
  const d = analysis.drivers;
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${fmt("gmv", Math.abs(v))}`;
  const ha = ta.durationSec / 3600, hb = tb.durationSec / 3600;
  const cards: [string, number, string][] = [
    ["GMV เปลี่ยนทั้งหมด", d.delta, `${fmt("gmv", ta.gmv)} vs ${fmt("gmv", tb.gmv)}`],
    ["มาจากชั่วโมงไลฟ์", d.hoursEffect, `${ha.toFixed(1)} vs ${hb.toFixed(1)} ชม.`],
    ["มาจากยอดต่อชั่วโมง", d.rateEffect, `${fmt("gmvPerHour", val(ta, "gmvPerHour"))} vs ${fmt("gmvPerHour", val(tb, "gmvPerHour"))} ต่อชม.`],
  ];
  cards.forEach(([label, v, sub], i) => {
    const y = 1.45 + i * 1.78;
    s.addShape(pres.ShapeType.roundRect, { x: M, y, w: 4.5, h: 1.55, fill: { color: i ? C.white : C.tint }, line: { color: i ? C.grid : C.tint, width: 1 }, rectRadius: 0.12 });
    s.addText(label, { x: M + 0.25, y: y + 0.15, w: 4.0, h: 0.35, fontSize: 13, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(signed(v), { x: M + 0.25, y: y + 0.5, w: 4.0, h: 0.6, fontSize: 26, bold: true, color: v >= 0 ? C.up : C.down, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
    s.addText(sub, { x: M + 0.25, y: y + 1.1, w: 4.0, h: 0.32, fontSize: 12, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
  });
  const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
  const rows: PptxGenJS.TableRow[] = [[head("ขั้นการขาย", "left"), head(aName), head(bName), head("เปลี่ยน")]];
  for (const f of analysis.funnels) {
    rows.push([{ text: f.platform, options: { bold: true, fill: { color: C.tint }, colspan: 4, align: "left" } }]);
    for (const st of f.steps) {
      const c = changeOf(st.a, st.b);
      const show = (v: number | null) => (v === null ? "-" : st.kind === "pct" ? `${(v * 100).toFixed(2)}%` : fmtMetric(st.kind, v));
      rows.push([
        { text: st.label, options: { align: "left" } },
        { text: show(st.a), options: { align: "right", bold: true } },
        { text: show(st.b), options: { align: "right", color: C.muted } },
        { text: c === null ? "-" : pctText(c), options: { align: "right", bold: true, color: pctColor(c) } },
      ]);
    }
  }
  s.addTable(rows, {
    x: 5.45, y: 1.45, w: W - M - 5.45, colW: [2.75, 1.55, 1.55, 1.433], fontSize: 12, fontFace: FONT, color: C.text,
    rowH: Math.min(0.4, 5.3 / rows.length), border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.1, 0, 0.1],
  });
  s.addNotes("GMV ที่เปลี่ยน = (ชั่วโมงไลฟ์ที่เปลี่ยน × GMV/ชม. ของช่วงเทียบ) + (ชั่วโมงไลฟ์ช่วงนี้ × GMV/ชม. ที่เปลี่ยน)");
}

/** หน้า Top 5 ไลฟ์ (ตาม GMV) + สัดส่วนยอดของ 5 ไลฟ์นี้ */
/** การ์ดในหน้า "ยอดต่อชั่วโมง": ค่าหลัก + % เทียบ + แท่งเทียบทุกช่วง */
type PerHourCard = {
  key: MetricKey;
  value: number | null;
  deltas: { label: string; text: string; color: string }[];
  bars: { name: string; value: number | null; main: boolean }[];
};
const PER_HOUR_KEYS: MetricKey[] = ["gmvPerHour", "viewersPerHour", "impressionsPerHour"];

/** หน้า "ยอดต่อชั่วโมง": GMV / Viewers / Impressions ต่อชั่วโมงไลฟ์ (3 การ์ดใหญ่) */
function addPerHourSlide(pres: PptxGenJS, title: string, cards: PerHourCard[]) {
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText(title, { placeholder: "title" });
  const gap = 0.35, cw = (W - 2 * M - 2 * gap) / 3, y0 = 1.45, ch = 4.95;
  cards.forEach((c, i) => {
    const x = M + i * (cw + gap), m = metricOf(c.key);
    s.addShape(pres.ShapeType.roundRect, { x, y: y0, w: cw, h: ch, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
    s.addText(m.label, { x: x + 0.3, y: y0 + 0.25, w: cw - 0.6, h: 0.45, fontSize: 18, bold: true, color: C.text, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(m.note ? `เฉพาะ ${m.note}` : "ทุกแพลตฟอร์ม", { x: x + 0.3, y: y0 + 0.7, w: cw - 0.6, h: 0.3, fontSize: 12, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
    const big = fmt(c.key, c.value);
    s.addText(big, { x: x + 0.3, y: y0 + 1.05, w: cw - 0.6, h: 0.8, fontSize: big.length > 12 ? 28 : 36, bold: true, color: C.pink, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
    if (c.deltas.length) {
      s.addText(c.deltas.flatMap((d, j) => [
        { text: `${d.label}  `, options: { color: C.muted } },
        { text: d.text, options: { bold: true, color: d.color, breakLine: j < c.deltas.length - 1 } },
      ]), { x: x + 0.3, y: y0 + 1.9, w: cw - 0.6, h: 0.85, fontSize: 15, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 2, fit: "shrink", isTextBox: true });
    }
    // แท่งเทียบ: ชื่อสั้น (เช่น ก.ค.) = ชื่อซ้ายแท่ง / ชื่อยาว (เช่น วันที่เต็ม) = ชื่อบนแท่ง ไม่เกิน 3 แท่ง
    const bars = c.bars.filter((b) => b.value !== null);
    if (bars.length > 1) {
      const inline = bars.every((b) => b.name.length <= 9);
      const list = inline ? bars.slice(0, 8) : bars.slice(0, 3);
      const top = y0 + 2.85, area = ch - 2.85 - 0.25;
      const rowH = Math.min(inline ? 0.42 : 0.62, area / list.length);
      const max = Math.max(...list.map((b) => b.value!), 1);
      const nameW = inline ? 0.95 : 0, valW = 1.15;
      const barX = x + 0.3 + nameW, barMax = cw - 0.6 - nameW - valW - 0.08;
      list.forEach((b, j) => {
        const y = top + j * rowH;
        const color = b.main ? C.pink : C.blue;
        if (inline) {
          s.addText(b.name, { x: x + 0.3, y, w: nameW - 0.05, h: rowH, fontSize: 11, bold: b.main, color: C.text, fontFace: FONT, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
        } else {
          s.addText(b.name, { x: x + 0.3, y, w: cw - 0.6, h: 0.26, fontSize: 11, bold: b.main, color: C.text, fontFace: FONT, margin: 0, valign: "bottom", fit: "shrink", isTextBox: true });
        }
        const by = inline ? y + rowH * 0.22 : y + 0.3, bh = inline ? rowH * 0.56 : 0.24;
        s.addShape(pres.ShapeType.rect, { x: barX, y: by, w: Math.max(0.03, (barMax * Math.max(0, b.value!)) / max), h: bh, fill: { color }, line: { color } });
        s.addText(fmtMetric(metricOf(c.key).kind, b.value, true), {
          x: barX + barMax + 0.08, y: by - 0.06, w: valW, h: bh + 0.12, fontSize: 11, bold: b.main, color: C.text, fontFace: FONT, margin: 0, align: "right", valign: "middle", isTextBox: true,
        });
      });
    }
  });
  s.addText("ต่อชั่วโมง = ยอดรวม ÷ ชั่วโมงไลฟ์ · Impressions / ชม. คิดจากชั่วโมงไลฟ์ของ TikTok เท่านั้น (Shopee ไม่มี Impressions)", {
    x: M, y: 6.55, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true,
  });
}

/** หน้าเป้าหมาย GMV: % achieve เดือน / ถึงวันล่าสุด (แถบ + ทำได้ / เป้า) + ยอดที่เหลือต่อวัน + แยกช่อง */
function addTargetSlide(pres: PptxGenJS, title: string, t: NonNullable<CompareDeckInput["target"]>) {
  const { report: r, lastDay, names } = t;
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText(title, { placeholder: "title" });
  const pctOf = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
  const baht = (v: number) => fmt("gmv", v);
  const tiles = [
    { label: `% Achieve เดือน${r.toDate ? " (เทียบเป้าทั้งเดือน)" : ""}`, pct: r.pct, target: r.monthly, note: "", color: C.muted },
    ...(r.toDate ? [{
      label: `% Achieve ถึงวันที่ ${lastDay}`, pct: r.toDate.pct, target: r.toDate.target,
      note: r.toDate.gap >= 0 ? `เกินเป้าถึงวันนี้ ${baht(r.toDate.gap)}` : `ขาดจากเป้าถึงวันนี้ ${baht(-r.toDate.gap)}`,
      color: r.toDate.gap >= 0 ? C.up : C.down,
    }] : []),
  ];
  const gap = 0.35, w = (W - 2 * M - gap * (tiles.length - 1)) / tiles.length, y0 = 1.4, h = 2.25;
  tiles.forEach((tile, i) => {
    const x = M + i * (w + gap), inner = w - 0.6;
    s.addShape(pres.ShapeType.roundRect, { x, y: y0, w, h, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
    s.addText(tile.label, { x: x + 0.3, y: y0 + 0.15, w: inner, h: 0.35, fontSize: 13, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(pctOf(tile.pct), { x: x + 0.3, y: y0 + 0.5, w: inner, h: 0.65, fontSize: 32, bold: true, color: C.pink, fontFace: FONT, margin: 0, isTextBox: true });
    s.addShape(pres.ShapeType.rect, { x: x + 0.3, y: y0 + 1.2, w: inner, h: 0.12, fill: { color: C.white }, line: { color: C.white } });
    if (tile.pct) s.addShape(pres.ShapeType.rect, { x: x + 0.3, y: y0 + 1.2, w: Math.max(0.03, inner * Math.min(1, tile.pct)), h: 0.12, fill: { color: C.pink }, line: { color: C.pink } });
    s.addText(`${baht(r.gmv)} / เป้า ${baht(tile.target)}`, { x: x + 0.3, y: y0 + 1.4, w: inner, h: 0.32, fontSize: 13, color: C.text, fontFace: FONT, margin: 0, isTextBox: true });
    if (tile.note) s.addText(tile.note, { x: x + 0.3, y: y0 + 1.72, w: inner, h: 0.32, fontSize: 13, bold: true, color: tile.color, fontFace: FONT, margin: 0, isTextBox: true });
  });
  if (r.perDayLeft !== null) {
    s.addText(`เหลืออีก ${baht(r.remaining)} ใน ${r.daysLeft} วัน · เฉลี่ยวันละ ${baht(r.perDayLeft)}`, { x: M, y: 3.75, w: W - 2 * M, h: 0.35, fontSize: 14, color: C.text, fontFace: FONT, margin: 0, isTextBox: true });
  }
  const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
  const rows = r.accounts.slice(0, 6);
  if (rows.length) {
    s.addTable([
      [head("ช่อง", "left"), head("เป้าเดือน"), head("ทำได้"), head("% Achieve"), ...(r.toDate ? [head(`ถึงวันที่ ${lastDay}`)] : [])],
      ...rows.map((a): PptxGenJS.TableRow => [
        { text: names.get(a.key) ?? a.key.split("|").slice(1).join("|"), options: { align: "left" } },
        { text: baht(a.monthly), options: { align: "right" } },
        { text: baht(a.gmv), options: { align: "right", bold: true } },
        { text: pctOf(a.pct), options: { align: "right", bold: true } },
        ...(r.toDate ? [{ text: pctOf(a.toDatePct), options: { align: "right" as const } }] : []),
      ]),
    ], {
      x: M, y: 4.2, w: W - 2 * M, colW: r.toDate ? [4.533, 1.95, 1.95, 1.7, 2] : [5.133, 2.4, 2.4, 2.2], fontSize: 13, fontFace: FONT, color: C.text, rowH: 0.36,
      border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.1, 0, 0.1],
    });
  }
}

/**
 * หน้าแยกตามกลุ่มผู้ไลฟ์: แถบสัดส่วน GMV ของแต่ละช่อง (บน · เหมือนเว็บ) + ตาราง (ล่าง)
 *   เทียบเวลาไลฟ์ในไฟล์กับเวลาในแพลน (เฉพาะช่องที่มีแพลนกลุ่ม)
 */
function addOwnersSlide(pres: PptxGenJS, channels: ChannelSplit[]) {
  if (!channels.length) return;
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText("GMV แยกตามกลุ่มผู้ไลฟ์", { placeholder: "title" });
  // แถบสัดส่วน: ช่องละคอลัมน์ (ไม่เกิน 2 ช่องต่อแถว) · ชื่อ + % ใต้แถบ (ไม่ใช้สีอย่างเดียว)
  const shown = channels.slice(0, 2);
  const colW = (W - 2 * M - 0.5 * (shown.length - 1)) / shown.length;
  shown.forEach((c, i) => {
    const x = M + i * (colW + 0.5), y = 1.3;
    const parts = c.rows.filter((r) => r.gmv > 0);
    s.addText([{ text: c.label, options: { bold: true, color: C.text } }, { text: `   GMV ${fmt("gmv", c.gmv)}`, options: { color: C.muted } }],
      { x, y, w: colW, h: 0.3, fontSize: 13, fontFace: FONT, margin: 0, valign: "middle", isTextBox: true });
    let bx = x;
    const gapW = 0.03, usable = colW - gapW * Math.max(0, parts.length - 1);
    for (const r of parts) {
      const bw = Math.max(0.02, (usable * r.gmv) / (c.gmv || 1));
      const color = agencyHex(!r.owner || r.owner === "In house" ? AGENCY_OURS : r.owner);
      s.addShape(pres.ShapeType.rect, { x: bx, y: y + 0.36, w: bw, h: 0.24, fill: { color }, line: { color, width: 0 } });
      bx += bw + gapW;
    }
    s.addText(parts.flatMap((r, j) => [
      { text: "■ ", options: { color: agencyHex(!r.owner || r.owner === "In house" ? AGENCY_OURS : r.owner) } },
      { text: `${r.label.replace(/^Agency /, "")} `, options: { color: C.muted } },
      { text: `${c.gmv ? ((r.gmv / c.gmv) * 100).toFixed(1) : "0"}%${j < parts.length - 1 ? "  " : ""}`, options: { bold: true, color: C.text } },
    ]), { x, y: y + 0.66, w: colW, h: 0.3, fontSize: parts.length > 3 ? 10 : 11, fontFace: FONT, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
  });
  const tableY = 2.45;
  const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
  const line = (label: string, lives: number, sec: number, gmv: number, share: string, top: boolean): PptxGenJS.TableRow => {
    const base = top ? { bold: true, fill: { color: C.tint } } : {};
    return [
      { text: top ? label : `   ${label}`, options: { ...base, align: "left" } },
      { text: lives.toLocaleString("th-TH"), options: { ...base, align: "right" } },
      { text: (sec / 3600).toFixed(1), options: { ...base, align: "right" } },
      { text: fmt("gmv", gmv), options: { ...base, align: "right", bold: true } },
      { text: share, options: { ...base, align: "right" } },
      { text: fmt("gmvPerHour", sec ? gmv / (sec / 3600) : null), options: { ...base, align: "right" } },
    ];
  };
  const rows: PptxGenJS.TableRow[] = [
    [head("กลุ่ม", "left"), head("ไลฟ์"), head("ชม."), head("GMV"), head("สัดส่วน"), head("GMV/ชม.")],
    ...channels.flatMap((c) => [
      line(c.label, c.lives, c.sec, c.gmv, "100%", true),
      ...c.rows.map((r) => line(r.label, r.lives, r.sec, r.gmv, c.gmv ? `${((r.gmv / c.gmv) * 100).toFixed(1)}%` : "-", false)),
    ]),
  ];
  s.addTable(rows, {
    x: M, y: tableY, w: W - 2 * M, colW: [4.533, 1.2, 1.2, 2.2, 1.4, 1.6], fontSize: rows.length > 12 ? 11 : 13, fontFace: FONT, color: C.text, rowH: Math.min(0.4, (6.4 - tableY) / rows.length),
    border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.1, 0, 0.1],
  });
  const splitLives = channels.reduce((a, c) => a + c.splitLives, 0), splitGmv = channels.reduce((a, c) => a + c.splitGmv, 0);
  s.addText(`เทียบเวลาไลฟ์ในไฟล์กับเวลาในหน้าแพลน${splitLives ? ` · มี ${splitLives} ไลฟ์คร่อมหลายกลุ่ม (รวม ${fmt("gmv", splitGmv)}) แบ่งยอดตามนาที เป็นตัวเลขประมาณ` : ""}`, {
    x: M, y: 6.5, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true,
  });
}

/** สีกลุ่ม (เหมือนเว็บ: ทีมเรา / Agency ใช้สีเดียวกับหน้า Cost · กลุ่มที่ยังไม่มีสี = เทา) */
const AGENCY_HEX: Record<string, string> = { ours: "EB6834", TDH: "6250D6", MCN: "1BAF7A", Infinite: C.blue };
const agencyHex = (key: string) => AGENCY_HEX[key] ?? C.muted;

/**
 * หน้า GMV แยก Agency: แท่งคู่ TikTok | Shopee แต่ละแท่งซ้อนตามกลุ่ม + ตาราง GMV รวมของแต่ละกลุ่มในช่วงนี้ (ขวา)
 *   วาดด้วยรูปทรงทั้ง PowerPoint และ Google Slides (กราฟจริงของ PowerPoint ทำแท่งคู่ที่ซ้อนในกราฟเดียวไม่ได้)
 *   ไม่มีไลฟ์เลย = ไม่มีหน้านี้ · lineTitle = ต่อด้วยหน้ากราฟเส้น GMV/ชม. (รวมแพลตฟอร์ม เหมือนเว็บ)
 */
function addAgencySlides(pres: PptxGenJS, target: ChartTarget, charts: AgencyChart[] | undefined) {
  for (const c of charts ?? []) {
    if (!c.trend.some((t) => t.gmv.some((v) => v !== null))) continue;
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(c.title, { placeholder: "title" });
    const text = (t: string, opts: PptxGenJS.TextPropsOptions) => s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, ...opts });
    const platforms = [...new Set(c.trend.map((t) => t.platform))];
    const stacks = platforms.map((p) => c.trend.filter((t) => t.platform === p));
    // ตำนานแยกตามแท่ง: บอกว่าแท่งซ้าย / ขวาคือแพลตฟอร์มไหน
    stacks.forEach((st, i) => {
      const y = 1.3 + i * 0.36;
      text(`${platforms[i]}${platforms.length > 1 ? (i === 0 ? " (แท่งซ้าย)" : " (แท่งขวา)") : ""}`, { x: M, y, w: 1.9, h: 0.32, fontSize: 12, bold: true, color: C.text, valign: "middle" });
      shapeLegend(pres, s, { x: M + 1.9, y, w: 0 }, st.map((t) => ({ name: t.label, color: agencyHex(t.key) })));
    });

    // กราฟ (ซ้าย)
    const x = M, y = 1.4 + platforms.length * 0.36, w = 8.4, h = 6.35 - y;
    const n = c.labels.length, k = stacks.length;
    const totalOf = (st: AgencyTrend[], i: number) => st.reduce((a, t) => a + (t.gmv[i] ?? 0), 0);
    const showValue = n <= 6;
    const ticks = niceTicks(Math.max(0, ...c.labels.flatMap((_, i) => stacks.map((st) => totalOf(st, i)))) * (showValue ? 1.15 : 1.02));
    const top = ticks[ticks.length - 1] || 1;
    const px = x + 0.85, pw = w - 0.9, ph = h - 0.45;
    const yOf = (v: number) => y + ph - (v / top) * ph;
    for (const t of ticks) {
      s.addShape(pres.ShapeType.line, { x: px, y: yOf(t), w: pw, h: 0, line: { color: t ? C.grid : C.muted, width: t ? 0.75 : 1 } });
      text(compact(t), { x, y: yOf(t) - 0.13, w: 0.78, h: 0.26, fontSize: 11, color: C.muted, align: "right", valign: "middle" });
    }
    const gw = pw / Math.max(1, n), bw = Math.min(0.9, (gw * 0.8) / k);
    const every = Math.max(1, Math.ceil(n / Math.floor(pw / 0.55)));
    const valueSize = bw >= 0.75 ? 12 : bw >= 0.55 ? 10 : 9;
    c.labels.forEach((label, i) => {
      const gx = px + i * gw + (gw - bw * k) / 2;
      if (i % every === 0) text(label, { x: px + i * gw, y: y + ph + 0.08, w: gw, h: 0.32, fontSize: n > 12 ? 10 : 12, color: C.text, align: "center", valign: "top", fit: "shrink" });
      stacks.forEach((st, j) => {
        let base = 0;
        for (const t of st) {
          const v = t.gmv[i] ?? 0;
          const color = agencyHex(t.key);
          if (v > 0) s.addShape(pres.ShapeType.rect, { x: gx + j * bw, y: yOf(base + v), w: bw - 0.03, h: (v / top) * ph, fill: { color }, line: { color, width: 0 } });
          base += v;
        }
        if (showValue && base > 0) text(compact(base), { x: gx + j * bw - 0.15, y: yOf(base) - 0.3, w: bw + 0.27, h: 0.28, fontSize: valueSize, bold: true, color: C.text, align: "center", valign: "bottom" });
      });
    });

    // ตาราง GMV รวมทั้งช่วงของแต่ละกลุ่ม (ขวา) · สัดส่วน = ของแพลตฟอร์มนั้น
    const sum = (t: AgencyTrend) => t.gmv.reduce<number>((a, v) => a + (v ?? 0), 0);
    const head = (t: string, align: "left" | "right" = "right") => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
    const rows: PptxGenJS.TableRow[] = [[head("กลุ่ม", "left"), head("GMV"), head("สัดส่วน")]];
    stacks.forEach((st, i) => {
      const total = st.reduce((a, t) => a + sum(t), 0);
      const band = { bold: true, fill: { color: C.tint } };
      rows.push([{ text: platforms[i], options: { ...band, align: "left" } }, { text: fmt("gmv", total), options: { ...band, align: "right" } }, { text: "100%", options: { ...band, align: "right" } }]);
      for (const t of st) {
        rows.push([
          { text: `■ ${t.label}`, options: { align: "left", color: agencyHex(t.key) } },
          { text: fmt("gmv", sum(t)), options: { align: "right" } },
          { text: total ? `${((sum(t) / total) * 100).toFixed(1)}%` : "-", options: { align: "right" } },
        ]);
      }
    });
    s.addTable(rows, {
      x: M + 8.7, y: 1.4, w: W - 2 * M - 8.7, colW: [1.53, 1.2, 0.8], fontSize: 11, fontFace: FONT, color: C.text, rowH: Math.min(0.4, 4.9 / rows.length),
      border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.06, 0, 0.06],
    });
    const note = [
      "ไลฟ์ที่ไม่ใช่ Agency = ทีมเรา: TikTok = ของเรา (รวม Cherry, Skin Expert) · Shopee = In house",
      c.labels.some((l) => l.endsWith("*")) ? "* ยังไม่จบเดือน" : "",
    ].filter(Boolean).join(" · ");
    if (note) text(note, { x: M, y: 6.6, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted, fit: "shrink" });

    if (c.lineTitle) {
      addTrendSlide(pres, target, c.lineTitle, c.labels, mergePlatforms(c.trend).map((t) => ({ name: t.label, color: agencyHex(t.key), values: t.perHour })));
    }
  }
}

/** ตัวชี้วัดของหน้าเทียบรายกลุ่ม / รายบัญชี (เหมือนดรอปดาวน์บนเว็บ) */
const BREAKDOWN_KEYS: MetricKey[] = ["gmv", "gmvPerHour", "ctr", "co", "impressions", "viewers", "orders"];
/** ตัวเลขย่อตามชนิดตัวชี้วัด (แกน / ป้ายบนแท่ง) */
const compactOf = (k: MetricKey) => (v: number) => {
  const kind = metricOf(k).kind;
  return kind === "baht" ? compact(v) : kind === "pct" ? `${(v * 100).toFixed(v && v < 0.1 ? 1 : 0)}%` : fmtMetric(kind === "hours" ? "int" : kind, v, true);
};

/**
 * เทียบรายกลุ่มและรายบัญชี (เหมือนส่วน "เทียบรายกลุ่มและรายบัญชี" บนเว็บ · src/lib/live-breakdown.ts)
 *   กราฟ GMV และ GMV/ชม. แยกกลุ่ม: TikTok ซ้าย | Shopee ขวา แท่งคู่ ช่วงหลัก (ชมพู) vs ช่วงเทียบ (ฟ้า) · ยอดรวมแพลตฟอร์มที่หัวฝั่ง
 *   ตารางทุกตัวชี้วัด (GMV, GMV/ชม., CTR, CO, Impressions, Viewers, ออเดอร์) + ขาที่ทำให้ GMV เปลี่ยนมากสุด: แยกกลุ่ม / แยกบัญชี
 *   ช่วงเทียบไม่มีไลฟ์ = แท่งเดียว ตารางเป็นค่าของช่วงหลัก
 */
function addBreakdownSlides(pres: PptxGenJS, o: { a: LiveSession[]; b: LiveSession[]; aName: string; bName: string; spans: OwnerSpan[] | null }) {
  const { groups, accounts } = breakdownRows(o.a, o.b, o.spans);
  if (!groups.length) return;
  const single = !o.b.length;
  const v = (t: Totals, k: MetricKey) => (t.lives ? metricOf(k).value(t) : null);
  const platforms = groups.filter((r) => r.level === "platform");
  const groupRows = groups.filter((r) => r.level === "group");
  const short = (r: BreakdownRow) => { const t = r.label.replace(/^Agency /, ""); return t.length > 12 ? `${t.slice(0, 11)}…` : t; };
  const vsText = single ? o.aName : `${o.aName} vs ${o.bName}`;

  // กราฟแยกกลุ่ม (ไม่มีแพลนกลุ่ม = ข้าม · รายบัญชีมีกราฟ GMV แยกตามบัญชีแล้ว)
  if (groupRows.length) {
    for (const k of ["gmv", "gmvPerHour"] as MetricKey[]) {
      const m = metricOf(k);
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(`${m.label} แยกกลุ่ม: ${vsText}`, { placeholder: "title" });
      const series = (rows: BreakdownRow[]) => [
        { name: o.aName, color: C.pink, values: rows.map((r) => v(r.a, k) ?? 0) },
        ...(single ? [] : [{ name: o.bName, color: C.blue, values: rows.map((r) => v(r.b, k) ?? 0) }]),
      ];
      shapeLegend(pres, s, { x: M, y: 1.25, w: W - 2 * M }, series([]));
      const colW = (W - 2 * M - 0.4 * (platforms.length - 1)) / platforms.length;
      platforms.forEach((p, i) => {
        const rows = groupRows.filter((r) => r.platform === p.platform);
        const x = M + i * (colW + 0.4);
        const cur = v(p.a, k), prev = v(p.b, k), c = changeOf(cur, prev);
        s.addText([
          { text: `${p.platform}  `, options: { bold: true, color: C.text, fontSize: 16 } },
          { text: `${m.label} รวม ${fmt(k, cur)}${single ? "" : ` vs ${fmt(k, prev)}  `}`, options: { color: C.muted } },
          ...(single ? [] : [{ text: pctText(c), options: { bold: true, color: pctColor(c) } }]),
        ], { x, y: 1.65, w: colW, h: 0.4, fontSize: 12, fontFace: FONT, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
        if (rows.length) shapeBars(pres, s, { labels: rows.map(short), series: series(rows), box: { x, y: 1.75, w: colW, h: 4.75 }, showValue: true, format: compactOf(k), legend: false });
      });
      s.addText("กลุ่มที่ไม่ใช่ Agency = ทีมเรา: TikTok = ของเรา (รวม Cherry, Skin Expert) · Shopee = In house · ไลฟ์ที่คร่อมหลายกลุ่มแบ่งตัวเลขตามนาที", {
        x: M, y: 6.6, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true,
      });
    }
  }

  // ตารางทุกตัวชี้วัด: ค่า (บรรทัดบน) + % ที่เปลี่ยน (บรรทัดล่าง) · แถวรวมแพลตฟอร์มระบายสี
  const table = (title: string, rows: BreakdownRow[]) => {
    if (!rows.length) return;
    const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
    const MAX = 13;
    for (let start = 0; start < rows.length; start += MAX) {
      const part = rows.slice(start, start + MAX);
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(`${single ? title.replace(/^เทียบ/, "") : title}: ${vsText}${start ? " (ต่อ)" : ""}`, { placeholder: "title" });
      const body = part.map((r): PptxGenJS.TableRow => {
        const band = r.level === "platform" ? { bold: true, fill: { color: C.tint } } : {};
        const leg = single ? null : mainLeg(r.a, r.b);
        return [
          { text: r.level === "group" ? `   ${r.label}` : r.level === "account" && r.label !== r.platform ? `${r.label} (${r.platform})` : r.label, options: { ...band, align: "left" } },
          ...BREAKDOWN_KEYS.map((k) => {
            const a = v(r.a, k), c = changeOf(a, v(r.b, k));
            return {
              text: single ? fmt(k, a) : [
                { text: fmt(k, a), options: { bold: true, breakLine: true } },
                { text: c === null ? "-" : pctText(c), options: { color: pctColor(c), fontSize: 9 } },
              ],
              options: { ...band, align: "right" as const },
            };
          }),
          ...(single ? [] : [{ text: leg ? `${leg.label} ${pctText(leg.change)}` : "-", options: { ...band, align: "left" as const, color: leg ? (leg.gmv < 0 ? C.down : C.up) : C.muted, bold: !!leg && leg.gmv < 0 } }]),
        ];
      });
      s.addTable([
        [head(title.includes("บัญชี") ? "บัญชี" : "กลุ่ม", "left"), ...BREAKDOWN_KEYS.map((k) => head(metricOf(k).label)), ...(single ? [] : [head("ขาที่ทำให้ GMV เปลี่ยนมากสุด", "left")])],
        ...body,
      ], {
        x: M, y: 1.4, w: W - 2 * M, colW: single ? [2.733, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.3] : [2.2, 1.18, 1.18, 0.95, 0.95, 1.18, 1.1, 1.0, 2.373],
        fontSize: 10, fontFace: FONT, color: C.text, rowH: Math.min(single ? 0.36 : 0.44, 5.05 / (part.length + 1)),
        border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.06, 0, 0.06],
      });
      s.addText(single
        ? `ยังไม่มีข้อมูลไลฟ์ ${o.bName} จึงแสดงเฉพาะ ${o.aName} · Impressions / CTR มีเฉพาะ TikTok · CO: TikTok ÷ คลิก · Shopee ÷ Viewers`
        : `บรรทัดล่าง = % เทียบ ${o.bName} · GMV = ชั่วโมงไลฟ์ × Viewers/ชม. × GMV/Viewer ขาที่ลดมากสุดคือจุดที่ควรแก้ก่อน · Impressions / CTR มีเฉพาะ TikTok`, {
        x: M, y: 6.6, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true,
      });
    }
  };
  if (groupRows.length) table("เทียบรายกลุ่ม ทุกตัวชี้วัด", groups);
  table("เทียบรายบัญชี ทุกตัวชี้วัด", accounts);
}

/** สีช่องในหน้าช่วงเวลาขายดี: ชมพูไล่ระดับจากพื้นอ่อน (12%) ถึงชมพูเต็ม · ช่องตัวอย่างน้อย = จางลง */
function heatFill(p: number, faded: boolean) {
  const mix = (a: string, b: string, t: number) => {
    const c = (i: number) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0");
    return `${c(0)}${c(2)}${c(4)}`.toUpperCase();
  };
  const full = mix(C.white, C.pink, 0.12 + 0.88 * p);
  return faded ? mix(full, C.white, 0.55) : full;
}

/**
 * ช่วงเวลาไหนขายดี (เหมือนเว็บ · src/lib/live-heat.ts): ตาราง ชั่วโมง × วันในสัปดาห์ ค่า = GMV/ชม. (เข้ม = สูง) + 5 อันดับขายดี (ขวา)
 *   แสดงเฉพาะชั่วโมงที่มีไลฟ์ · ช่องที่ไลฟ์รวมไม่ถึง 2 ชม. สีจาง ไม่จัดอันดับ
 */
function addHeatSlide(pres: PptxGenJS, title: string, sessions: LiveSession[]) {
  if (!sessions.length) return;
  const grid = heatGrid(sessions.map((x) => ({ startedAt: x.startedAt, durationSec: x.durationSec, gmv: x.gmv })));
  const enough = (c: { sec: number }) => c.sec >= HEAT_MIN_SEC;
  const max = Math.max(0, ...grid.flat().filter(enough).map((c) => heatPerHour(c) ?? 0));
  const top = heatTop(grid, heatPerHour, 5);
  const rank = new Map(top.slice(0, 3).map((x, i) => [`${x.day}|${x.hour}`, i + 1]));
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => grid.some((col) => heatPerHour(col[h]) !== null));
  if (!hours.length) return;
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText(title, { placeholder: "title" });
  const head = (text: string) => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align: "center" as const } });
  const rows: PptxGenJS.TableRow[] = [
    [head("เวลา"), ...HEAT_WEEKDAYS.map(head)],
    ...hours.map((h): PptxGenJS.TableRow => [
      { text: heatHour(h), options: { align: "right", color: C.muted } },
      ...grid.map((col, d) => {
        const c = col[h], val = heatPerHour(c), r = rank.get(`${d}|${h}`);
        if (val === null) return { text: "", options: { fill: { color: "FAF5F7" } } };
        const p = max ? Math.min(1, val / max) : 0;
        return {
          text: `${r ? `#${r} ` : ""}${compact(val)}`,
          options: { align: "center" as const, bold: !!r, fill: { color: heatFill(p, !enough(c)) }, color: p >= 0.55 && enough(c) ? C.white : C.text },
        };
      }),
    ]),
  ];
  s.addTable(rows, {
    x: M, y: 1.3, w: 8.3, colW: [0.86, ...HEAT_WEEKDAYS.map(() => 1.063)], fontSize: hours.length > 18 ? 8 : 9, fontFace: FONT, color: C.text,
    rowH: Math.min(0.3, 5.25 / rows.length), border: { type: "solid", pt: 0.5, color: C.white }, valign: "middle", margin: [0, 0.04, 0, 0.04],
  });
  s.addShape(pres.ShapeType.roundRect, { x: 9.2, y: 1.3, w: W - M - 9.2, h: 5.2, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
  s.addText("ขายดีสุด (GMV/ชม.)", { x: 9.4, y: 1.45, w: 3.3, h: 0.4, fontSize: 16, bold: true, color: C.text, fontFace: FONT, margin: 0, isTextBox: true });
  s.addText(top.length ? top.flatMap((x, i) => [
    { text: `${i + 1}. ${HEAT_WEEKDAY_NAMES[x.day]} ${heatHour(x.hour)}–${heatHour(x.hour + 1)}`, options: { bold: true, breakLine: true } },
    { text: `${fmt("gmv", x.v)}/ชม. · ไลฟ์รวม ${(x.cell.sec / 3600).toFixed(1)} ชม.`, options: { color: C.muted, breakLine: i < top.length - 1 } },
  ]) : [{ text: "ยังไม่มีช่วงเวลาที่ไลฟ์รวมถึง 2 ชม.", options: { color: C.muted } }],
  { x: 9.4, y: 1.9, w: 3.3, h: 4.45, fontSize: 13, color: C.text, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 6, fit: "shrink", isTextBox: true });
  s.addText("ไฟล์ Export ไม่มียอดรายชั่วโมง จึงกระจาย GMV ของแต่ละไลฟ์เท่าๆ กันตามเวลาไลฟ์ (ประมาณ) · ไลฟ์หลังเที่ยงคืนนับเป็นคืนของวันก่อน · ช่องสีจาง = ไลฟ์รวมไม่ถึง 2 ชม. · #1–3 = อันดับ", {
    x: M, y: 6.6, w: W - 2 * M, h: 0.3, fontSize: 10, italic: true, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true,
  });
}

/**
 * วันปกติ vs วันแคมเปญ (เหมือนเว็บ · src/lib/live-days.ts): กราฟ GMV ต่อวันแยกชนิดวัน (แท่งละแพลตฟอร์ม) + ตารางของแต่ละแพลตฟอร์ม
 *   (วัน · GMV/วัน · เทียบวันปกติ · GMV/ชม. · เทียบวันปกติ) · วันที่ยังไม่มีป้ายไม่นับ
 */
function addDayKindSlide(pres: PptxGenJS, title: string, sessions: LiveSession[], tags: Map<string, DayTag>) {
  const per = (["TikTok", "Shopee"] as Platform[]).map((p) => ({ p, ...dayKindStats(sessions, tags, p) })).filter((x) => x.stats.length);
  if (!per.length) return;
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText(title, { placeholder: "title" });
  const kinds = DAY_KINDS.filter((k) => per.some((x) => x.stats.some((st) => st.kind === k.kind)));
  shapeBars(pres, s, {
    labels: kinds.map((k) => k.label.replace(/ \(.*\)$/, "")),
    series: per.map((x) => ({ name: `${x.p} GMV ต่อวัน`, color: PLATFORM_COLOR[x.p], values: kinds.map((k) => x.stats.find((st) => st.kind === k.kind)?.perDay ?? 0) })),
    box: { x: M, y: 1.3, w: W - 2 * M, h: 2.85 }, showValue: true, change: false,
  });
  const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
  const times = (val: number | null, base: number | null) => (val === null || !base ? "-" : `×${(val / base).toFixed(2)}`);
  const tw = (W - 2 * M - 0.3 * (per.length - 1)) / per.length;
  per.forEach((x, i) => {
    const bau = x.stats.find((st) => st.kind === "bau");
    const rows: PptxGenJS.TableRow[] = [
      [head(x.p, "left"), head("วัน"), head("GMV/วัน"), head("เทียบปกติ"), head("GMV/ชม."), head("เทียบปกติ")],
      ...x.stats.map((st): PptxGenJS.TableRow => [
        { text: dayKindLabel(st.kind), options: { align: "left" } },
        { text: String(st.days), options: { align: "right" } },
        { text: fmt("gmv", st.perDay), options: { align: "right" } },
        { text: st.kind === "bau" ? "-" : times(st.perDay, bau?.perDay ?? null), options: { align: "right", bold: true } },
        { text: fmt("gmv", st.perHour), options: { align: "right" } },
        { text: st.kind === "bau" ? "-" : times(st.perHour, bau?.perHour ?? null), options: { align: "right", bold: true } },
      ]),
    ];
    const r = tw / 6.05;
    s.addTable(rows, {
      x: M + i * (tw + 0.3), y: 4.3, w: tw, colW: [1.75, 0.5, 1.05, 0.85, 1.05, 0.85].map((c) => c * r), fontSize: 10, fontFace: FONT, color: C.text,
      rowH: Math.min(0.3, 2.2 / rows.length), border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.05, 0, 0.05],
    });
  });
  const untagged = per.reduce((a, x) => a + x.untagged, 0);
  s.addText(`ป้ายวันจากชีตของทีม · วัน = วันที่มีไลฟ์ นับตามเวลาเริ่มไลฟ์${untagged ? ` · ${untagged.toLocaleString("th-TH")} ไลฟ์อยู่ในวันที่ยังไม่มีป้าย จึงไม่นับ` : ""}`, {
    x: M, y: 6.6, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true,
  });
}

function addTop5Slide(pres: PptxGenJS, lives: LiveSession[], name: string) {
  if (!lives.length) return;
  const s = pres.addSlide({ masterName: "CONTENT" });
  s.addText(`Top 5 ไลฟ์ ${name} (ตาม GMV)`, { placeholder: "title" });
  const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
  const when = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
  const top = lives.slice().sort((x, y) => y.gmv - x.gmv).slice(0, 5);
  s.addTable([
    [head("#", "left"), head("เริ่มไลฟ์", "left"), head("บัญชี", "left"), head("ชั่วโมง"), head("GMV"), head("ออเดอร์"), head("Viewers")],
    ...top.map((x, i): PptxGenJS.TableRow => [
      { text: String(i + 1), options: { align: "left", bold: true, color: C.pink } },
      { text: when.format(new Date(x.startedAt)), options: { align: "left" } },
      { text: accountLabel({ platform: x.platform, name: x.accountName }), options: { align: "left" } },
      { text: (x.durationSec / 3600).toFixed(1), options: { align: "right" } },
      { text: fmt("gmv", x.gmv), options: { align: "right", bold: true } },
      { text: x.orders.toLocaleString("th-TH"), options: { align: "right" } },
      { text: x.viewers.toLocaleString("th-TH"), options: { align: "right" } },
    ]),
  ], {
    x: M, y: 1.45, w: W - 2 * M, colW: [0.6, 2.4, 2.733, 1.3, 2.0, 1.5, 1.6], fontSize: 13, fontFace: FONT, color: C.text, rowH: 0.55,
    border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.1, 0, 0.1],
  });
  const total = totalsOf(lives).gmv;
  const share = total ? top.reduce((sum, x) => sum + x.gmv, 0) / total : 0;
  s.addText(`5 ไลฟ์นี้ทำ GMV ${(share * 100).toFixed(1)}% ของทั้ง ${name} (${lives.length} ไลฟ์)`,
    { x: M, y: 5.1, w: W - 2 * M, h: 0.5, fontSize: 14, italic: true, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
}

export async function buildCompareDeck(o: CompareDeckInput, target: "pptx" | "gslides" = "pptx"): Promise<Blob> {
  const pres = await newDeck(o.single ? `${o.report}: ${o.aName}` : `${o.report}: ${o.aName} vs ${o.bName}`, `GLORY VITAL · ${o.report}: ${o.aName}${o.b.length ? ` vs ${o.bName}` : ""}`);

  const ta = totalsOf(o.a), tb = totalsOf(o.b);
  const hasB = tb.lives > 0;
  const notes = insights(o, ta, tb);
  const f = o.focus;
  const analysis = f
    ? analyze({ aName: f.aName, bName: f.bName, a: f.a, b: f.b, time: [], stepWord: "วัน" })
    : analyze({ aName: o.aName, bName: o.bName, a: o.a, b: o.b, time: o.time, stepWord: stepWordOf(o.timeName), single: o.single });
  const gmvChange = changeOf(val(ta, "gmv"), val(tb, "gmv"));
  // เฉลี่ยต่อเดือน (ใช้แทน % เทียบ เมื่อไม่มีข้อมูลช่วงเทียบ)
  const activeMonths = o.timeName === "รายเดือน" ? o.time.filter((t) => t.a.length).length : 0;

  // 1) หน้าปก
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    s.addText("GLORY VITAL  ·  LIVE ANALYTICS", { x: M, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.pinkOnDark, charSpacing: 3, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(o.cover?.kicker ?? o.report, { x: M, y: 1.7, w: 7.6, h: 0.6, fontSize: 22, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(o.cover?.headline ?? `${o.aName} vs ${o.bName}`, { x: M, y: 2.3, w: 7.6, h: 1.6, fontSize: 44, bold: true, color: C.white, fontFace: FONT, margin: 0, valign: "top", fit: "shrink", isTextBox: true });
    ([[o.aName, o.aRange, C.pinkOnDark], ...(hasB ? [[o.bName, o.bRange, C.blueOnDark]] : [])] as [string, string, string][]).forEach(([name, range, color], i) => {
      const y = 4.25 + i * 0.55;
      s.addShape(pres.ShapeType.ellipse, { x: M, y: y + 0.12, w: 0.18, h: 0.18, fill: { color }, line: { color } });
      s.addText([{ text: `${name}  `, options: { bold: true, color: C.white } }, { text: range, options: { color: C.mutedOnDark } }],
        { x: M + 0.35, y, w: 7.2, h: 0.42, fontSize: 15, fontFace: FONT, margin: 0, valign: "middle", isTextBox: true });
    });
    s.addText(`${o.filterText}  ·  ส่งออกเมื่อ ${o.exportedAt}`, { x: M, y: H - 0.9, w: 8, h: 0.35, fontSize: 11, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    // ตัวเลขเด่น: GMV เปลี่ยนไปกี่ %
    s.addShape(pres.ShapeType.roundRect, { x: 8.75, y: 1.7, w: 4.0, h: 3.6, fill: { color: "4A2236" }, line: { color: "4A2236" }, rectRadius: 0.15 });
    s.addText("GMV", { x: 9.05, y: 1.95, w: 3.4, h: 0.4, fontSize: 16, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(fmt("gmv", val(ta, "gmv")), { x: 9.05, y: 2.4, w: 3.4, h: 0.7, fontSize: 30, bold: true, color: C.white, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
    if (gmvChange === null && activeMonths) {
      // ไม่มีช่วงเทียบ: แสดงเฉลี่ยต่อเดือน + จำนวนไลฟ์
      s.addText("เฉลี่ยต่อเดือน", { x: 9.05, y: 3.25, w: 3.4, h: 0.35, fontSize: 14, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
      s.addText(fmt("gmv", ta.gmv / activeMonths), { x: 9.05, y: 3.6, w: 3.4, h: 0.6, fontSize: 26, bold: true, color: C.pinkOnDark, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
      s.addText(`${ta.lives.toLocaleString("th-TH")} ไลฟ์ · ${(ta.durationSec / 3600).toLocaleString("th-TH", { maximumFractionDigits: 0 })} ชม.`, { x: 9.05, y: 4.3, w: 3.4, h: 0.6, fontSize: 13, color: C.mutedOnDark, fontFace: FONT, margin: 0, valign: "top", isTextBox: true });
    } else {
      s.addText(gmvChange === null ? "ไม่มีข้อมูลเทียบ" : pctText(gmvChange), {
        x: 9.05, y: 3.2, w: 3.4, h: 1.0, fontSize: gmvChange === null ? 20 : 44, bold: true, fontFace: FONT, margin: 0, isTextBox: true,
        color: gmvChange === null ? C.mutedOnDark : gmvChange >= 0 ? "7EE0A8" : "FF9A90",
      });
      s.addText(`เทียบ ${o.bName} ${fmt("gmv", val(tb, "gmv"))}`, { x: 9.05, y: 4.3, w: 3.4, h: 0.6, fontSize: 13, color: C.mutedOnDark, fontFace: FONT, margin: 0, valign: "top", isTextBox: true });
    }
  }

  // 2) ตัวเลขหลัก 8 การ์ด
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(hasB ? `ตัวเลขหลัก: ${o.aName} เทียบ ${o.bName}` : `ตัวเลขหลัก: ${o.aName}`, { placeholder: "title" });
    const keys: MetricKey[] = ["gmv", "orders", "viewers", "gmvPerHour", "duration", "lives", "ctr", "co"];
    const cw = (W - 2 * M - 3 * 0.3) / 4, ch = 2.45;
    keys.forEach((k, i) => {
      const x = M + (i % 4) * (cw + 0.3), y = 1.5 + Math.floor(i / 4) * (ch + 0.3);
      const m = metricOf(k), va = val(ta, k), vb = val(tb, k), c = changeOf(va, vb);
      // CO รวมสองแพลตฟอร์มคำนวณไม่ได้ (สูตรต่างกัน)
      const mixedCo = k === "co" && ta.coBase === null;
      s.addShape(pres.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
      s.addText(m.note ? `${m.label} · ${m.note}` : m.label, { x: x + 0.25, y: y + 0.2, w: cw - 0.5, h: 0.4, fontSize: 12, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
      // ตัวเลขยาวลดขนาด ไม่ให้ตัดบรรทัด (เช่น ฿222,128,756)
      const big = fmt(k, va);
      s.addText(big, { x: x + 0.25, y: y + 0.6, w: cw - 0.5, h: 0.7, fontSize: big.length > 13 ? 18 : big.length > 10 ? 22 : 26, bold: true, color: C.text, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
      // ไม่มีช่วงเทียบ: แสดงเฉลี่ยต่อเดือนแทน (เฉพาะค่าที่บวกกันได้)
      if (!hasB && activeMonths > 1 && va !== null && ["gmv", "orders", "viewers", "duration", "lives"].includes(k)) {
        s.addText(`เฉลี่ย ${fmt(k, va / activeMonths)} / เดือน`, { x: x + 0.25, y: y + 1.45, w: cw - 0.5, h: 0.4, fontSize: 13, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
      }
      if (mixedCo || hasB) {
        s.addText(mixedCo ? "ดูแยก TikTok / Shopee" : pctText(c), { x: x + 0.25, y: y + 1.35, w: cw - 0.5, h: 0.4, fontSize: mixedCo ? 13 : 15, bold: !mixedCo, color: mixedCo ? C.muted : pctColor(c), fontFace: FONT, margin: 0, isTextBox: true });
      }
      if (hasB) s.addText(`${o.bName}: ${fmt(k, vb)}`, { x: x + 0.25, y: y + 1.8, w: cw - 0.5, h: 0.4, fontSize: 12, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
    });
  }

  // 2.2) เป้าหมาย GMV (หน้ารายเดือน)
  if (o.target) addTargetSlide(pres, `เป้าหมาย GMV ${o.aName}`, o.target);

  // 2.5) ยอดต่อชั่วโมง: GMV / Viewers / Impressions ต่อชั่วโมงไลฟ์
  addPerHourSlide(pres, hasB ? `ยอดต่อชั่วโมง: ${o.aName} เทียบ ${o.bName}` : `ยอดต่อชั่วโมง: ${o.aName}`, PER_HOUR_KEYS.map((k) => {
    const va = val(ta, k), vb = val(tb, k), c = changeOf(va, vb);
    return {
      key: k, value: va,
      deltas: hasB ? [{ label: `vs ${o.bName}`, text: pctText(c), color: pctColor(c) }] : [],
      bars: hasB ? [{ name: o.aName, value: va, main: true }, { name: o.bName, value: vb, main: false }] : [],
    };
  }));

  // 3) ทุกตัวชี้วัด (ตาราง) + ข้อสังเกต
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("ทุกตัวชี้วัด", { placeholder: "title" });
    const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
    const rows: PptxGenJS.TableRow[] = [hasB
      ? [head("ตัวชี้วัด", "left"), head(o.aName), head(o.bName), head("เปลี่ยน")]
      : [head("ตัวชี้วัด", "left"), head(o.aName)]];
    for (const m of METRICS) {
      const va = val(ta, m.key), vb = val(tb, m.key), c = changeOf(va, vb);
      rows.push([
        { text: m.label, options: { align: "left" } },
        { text: fmt(m.key, va), options: { align: "right", bold: true } },
        ...(hasB ? [
          { text: fmt(m.key, vb), options: { align: "right" as const, color: C.muted } },
          { text: c === null ? "-" : pctText(c), options: { align: "right" as const, bold: true, color: pctColor(c) } },
        ] : []),
      ]);
    }
    s.addTable(rows, {
      x: M, y: 1.45, w: 7.9, colW: hasB ? [2.5, 1.9, 1.9, 1.6] : [4.4, 3.5], fontSize: 13, fontFace: FONT, color: C.text, rowH: 0.37,
      border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.1, 0, 0.1],
    });
    s.addShape(pres.ShapeType.roundRect, { x: 8.9, y: 1.45, w: W - M - 8.9, h: 4.75, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
    s.addText("ข้อสังเกต", { x: 9.15, y: 1.65, w: 3.3, h: 0.45, fontSize: 18, bold: true, color: C.text, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(notes.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < notes.length - 1 } })),
      { x: 9.15, y: 2.15, w: 3.35, h: 3.9, fontSize: 13, color: C.text, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 8, fit: "shrink", isTextBox: true });
  }

  // 4) อะไรทำให้ GMV เปลี่ยน: แยกผลจากชั่วโมงไลฟ์ / ยอดต่อชั่วโมง + กรวยการขายแต่ละแพลตฟอร์ม
  addDriversSlide(pres, analysis, ta, tb, o.aName, o.bName, "อะไรทำให้ GMV เปลี่ยน");

  /**
   * กราฟแท่งเทียบ 2 ชุด
   *   PowerPoint = กราฟจริง (แก้ตัวเลขได้) / Google Slides = วาดด้วยรูปทรง (Google แปลงกราฟเป็นรูปเบลอ ตัวเลขยาว ชื่อแกนหาย)
   */
  const barChart = (s: PptxGenJS.Slide, title: string, labels: string[], va: number[], vb: number[], box: { x: number; y: number; w: number; h: number }, showValue = true) => {
    // ไม่มีข้อมูลช่วงเทียบ = แท่งชุดเดียว
    const single = !hasB;
    if (target === "pptx") {
      s.addChart(pres.ChartType.bar, single ? [{ name: o.aName, labels, values: va }] : [{ name: o.aName, labels, values: va }, { name: o.bName, labels, values: vb }], {
        ...box, barDir: "col", barGrouping: "clustered", barGapWidthPct: 60,
        chartColors: single ? [C.pink, C.pink] : [C.pink, C.blue],
        showLegend: !single, legendPos: "t", legendFontSize: 12, legendFontFace: FONT, legendColor: C.text,
        showTitle: false, altText: title,
        showValue, dataLabelPosition: "outEnd", dataLabelFormatCode: COMPACT, dataLabelFontSize: labels.length <= 4 ? 14 : labels.length <= 8 ? 12 : 10,
        dataLabelFontBold: true, dataLabelFontFace: FONT, dataLabelColor: C.text,
        valAxisMinVal: 0, valAxisLabelFormatCode: COMPACT, valAxisLabelFontSize: 11, valAxisLabelFontFace: FONT, valAxisLabelColor: C.muted,
        catAxisLabelFontSize: 11, catAxisLabelFontFace: FONT, catAxisLabelColor: C.text,
        valGridLine: { color: C.grid, size: 0.75 }, catGridLine: { style: "none" },
      });
      return;
    }
    shapeBars(pres, s, {
      labels, box, showValue,
      series: single ? [{ name: o.aName, color: C.pink, values: va }] : [{ name: o.aName, color: C.pink, values: va }, { name: o.bName, color: C.blue, values: vb }],
    });
  };

  // 5) GMV แยกตามบัญชี (กราฟ) + ข้อความเด่น
  const accounts = accountsOf([...o.a, ...o.b]);
  if (accounts.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV แยกตามบัญชี", { placeholder: "title" });
    const gmvOf = (list: LiveSession[], key: string) => totalsOf(list.filter((x) => keyOf(x) === key)).gmv;
    const box = { x: M, y: 1.4, w: 8.6, h: 5.3 };
    // เทียบ 2 ช่วง: สีบอกช่วงเวลา · ช่วงเดียว: สีบอกแพลตฟอร์ม (เหมือนเว็บ)
    if (hasB) barChart(s, "GMV แยกตามบัญชี", accounts.map((a) => a.name), accounts.map((a) => gmvOf(o.a, a.key)), accounts.map((a) => gmvOf(o.b, a.key)), box);
    else platformBars(pres, s, target, { title: "GMV แยกตามบัญชี", labels: accounts.map((a) => a.name), groups: accounts.map((a) => o.a.filter((x) => keyOf(x) === a.key)), box, showValue: true });
    const rows = accounts
      .map((a) => ({ a, cur: gmvOf(o.a, a.key), prev: gmvOf(o.b, a.key) }))
      .sort((x, y) => y.cur - x.cur);
    s.addText("สัดส่วน GMV", { x: 9.6, y: 1.5, w: 3.1, h: 0.45, fontSize: 18, bold: true, color: C.text, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(rows.slice(0, 6).flatMap((r, i) => {
      const c = changeOf(r.cur, r.prev || null);
      return [
        { text: r.a.name, options: { bold: true, breakLine: true } },
        { text: `${ta.gmv ? ((r.cur / ta.gmv) * 100).toFixed(1) : "0"}% ของ GMV  `, options: { color: C.muted } },
        { text: c === null ? "" : pctText(c), options: { bold: true, color: pctColor(c), breakLine: i < Math.min(rows.length, 6) - 1 } },
      ];
    }), { x: 9.6, y: 2.0, w: 3.15, h: 4.6, fontSize: 13, color: C.text, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 6, fit: "shrink", isTextBox: true });
  }

  // 6) GMV ตามเวลา (วัน/เดือนที่ 1, 2, ...)
  if (o.time.length > 1) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`GMV ${o.timeName}`, { placeholder: "title" });
    const labels = o.time.map((t) => t.short);
    const box = { x: M, y: 1.4, w: W - 2 * M, h: 5.3 };
    const byPeriod = hasB && !o.platformTime;
    if (byPeriod) barChart(s, `GMV ${o.timeName}`, labels, o.time.map((t) => totalsOf(t.a).gmv), o.time.map((t) => totalsOf(t.b).gmv), box, o.time.length <= 12);
    else platformBars(pres, s, target, { title: `GMV ${o.timeName}`, labels, groups: o.time.map((t) => t.a), box, showValue: o.time.length <= 12 });
    if (labels.some((l) => l.endsWith("*"))) {
      s.addText("* เดือนที่ยังไม่จบ (ยอดยังไม่ครบเดือน)", { x: M, y: 6.75, w: 6, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
    }
    s.addNotes(byPeriod ? `${stepWordOf(o.timeName)}ที่ 1 ของ ${o.aName} เทียบกับ${stepWordOf(o.timeName)}ที่ 1 ของ ${o.bName} (ชื่อบนแกนเป็นของ ${o.aName})` : `${o.aName} แยกสีตามแพลตฟอร์ม`);

    // 6.2) กราฟเส้นแนวโน้ม: เทียบ 2 ช่วง = เส้นละช่วง · ช่วงเดียว = แยกแพลตฟอร์ม + เส้นรวม · รายเดือน = แยกแพลตฟอร์ม (เหมือนเว็บ)
    for (const metric of ["gmv", "gmvPerHour"] as const) {
      const series = byPeriod
        ? [
          { name: o.aName, color: C.pink, values: totalSeries(o.time.map((t) => t.a), metric) },
          { name: o.bName, color: C.blue, values: totalSeries(o.time.map((t) => t.b), metric) },
        ]
        : platformTrend(o.time.map((t) => t.a), metric, o.timeName !== "รายชั่วโมง" && !o.platformTime);
      addTrendSlide(pres, target, `${metricOf(metric).label} แนวโน้ม${o.timeName}`, labels, series);
    }
  }

  // 6.3) กราฟแท่งหลายเดือนย้อนหลัง (หน้ารายเดือน = 13 เดือน)
  if (o.months && o.months.length > 1) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    const title = `GMV รายเดือน (${o.months.length} เดือน)`;
    s.addText(title, { placeholder: "title" });
    platformBars(pres, s, target, { title, labels: o.months.map((m) => m.short), groups: o.months.map((m) => m.a), box: { x: M, y: 1.4, w: W - 2 * M, h: 5.25 }, showValue: true });
    if (o.months.some((m) => m.short.endsWith("*"))) {
      s.addText("* เดือนที่ยังไม่จบ (ยอดยังไม่ครบเดือน)", { x: M, y: 6.7, w: 6, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
    }
  }

  // 6.5) รายไตรมาส (ภาพรวมทั้งปี): กราฟ GMV ต่อไตรมาส + QoQ ใต้กราฟ
  if (o.quarters?.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV รายไตรมาส", { placeholder: "title" });
    const qs = o.quarters;
    const box = { x: M, y: 1.4, w: W - 2 * M, h: 4.7 };
    if (hasB) barChart(s, "GMV รายไตรมาส", qs.map((q) => q.label), qs.map((q) => totalsOf(q.a).gmv), qs.map((q) => totalsOf(q.b).gmv), box);
    else platformBars(pres, s, target, { title: "GMV รายไตรมาส", labels: qs.map((q) => q.label), groups: qs.map((q) => q.a), box, showValue: true });
    // QoQ = เทียบไตรมาสก่อนหน้า (ไตรมาสที่ยังไม่จบไม่คิด %)
    const qoq = qs.map((q) => {
      const c = q.open ? null : changeOf(q.a.length ? totalsOf(q.a).gmv : null, q.before.length ? totalsOf(q.before).gmv : null);
      return [
        { text: `${q.label}  `, options: { bold: true, color: C.text } },
        { text: q.open ? "รอจบไตรมาส" : c === null ? "ไม่มีข้อมูลเทียบ" : pctText(c), options: { bold: c !== null, color: q.open ? C.muted : pctColor(c) } },
        { text: "      ", options: {} },
      ];
    }).flat();
    s.addText([{ text: "QoQ (เทียบไตรมาสก่อนหน้า):  ", options: { color: C.muted } }, ...qoq],
      { x: M, y: 6.2, w: W - 2 * M, h: 0.4, fontSize: 14, fontFace: FONT, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
    if (qs.some((q) => q.label.endsWith("*"))) {
      s.addText("* ไตรมาสที่ยังไม่จบ หรือมีไม่ครบ 3 เดือนในช่วงที่เลือก", { x: M, y: 6.6, w: 7, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
    }
    s.addNotes(hasB ? `แท่งชมพู = ${o.aName} / แท่งฟ้า = ${o.bName} (% เหนือแท่ง = YoY)` : `ยังไม่มีข้อมูล ${o.bName} ให้เทียบ YoY`);
  }

  // 7) ตารางแยกตามบัญชี
  if (accounts.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("สรุปแยกตามบัญชี", { placeholder: "title" });
    const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
    const line = (name: string, platform: string, a: LiveSession[], b: LiveSession[], total = false): PptxGenJS.TableRow => {
      const t = totalsOf(a), p = totalsOf(b), c = changeOf(t.lives ? t.gmv : null, p.lives ? p.gmv : null);
      const base = total ? { bold: true, fill: { color: C.tint } } : {};
      return [
        { text: name, options: { ...base, align: "left" } },
        { text: platform, options: { ...base, align: "left", color: C.muted } },
        { text: String(t.lives), options: { ...base, align: "right" } },
        { text: fmt("gmv", t.lives ? t.gmv : null), options: { ...base, align: "right", bold: true } },
        ...(hasB ? [
          { text: fmt("gmv", p.lives ? p.gmv : null), options: { ...base, align: "right" as const, color: C.muted } },
          { text: c === null ? "-" : pctText(c), options: { ...base, align: "right" as const, bold: true, color: pctColor(c) } },
        ] : []),
        { text: fmt("gmvPerHour", val(t, "gmvPerHour")), options: { ...base, align: "right" } },
        { text: fmt("co", val(t, "co")), options: { ...base, align: "right" } },
      ];
    };
    const rows: PptxGenJS.TableRow[] = [
      [head("บัญชี", "left"), head("แพลตฟอร์ม", "left"), head("ไลฟ์"), head(`GMV ${o.aName}`), ...(hasB ? [head(`GMV ${o.bName}`), head("เปลี่ยน")] : []), head("GMV/ชม."), head("CO")],
      ...accounts.slice(0, 9).map((a) => line(a.name, a.platform, o.a.filter((x) => keyOf(x) === a.key), o.b.filter((x) => keyOf(x) === a.key))),
      line("รวม", "", o.a, o.b, true),
    ];
    s.addTable(rows, {
      x: M, y: 1.45, w: W - 2 * M, colW: hasB ? [2.9, 1.2, 0.9, 1.9, 1.9, 1.3, 1.0, 1.033] : [3.8, 1.6, 1.2, 2.4, 1.5, 1.633], fontSize: 12, fontFace: FONT, color: C.text, rowH: 0.45,
      border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.1, 0, 0.1],
    });
  }

  // 7.5) แยกตามกลุ่มผู้ไลฟ์ (หน้ารายเดือน) + เทียบรายกลุ่ม / รายบัญชี + กราฟแยก Agency
  if (o.owners) addOwnersSlide(pres, o.owners);
  if (o.breakdown) addBreakdownSlides(pres, { a: o.a, b: o.b, aName: o.aName, bName: o.bName, spans: o.breakdown.spans });
  addAgencySlides(pres, target, o.agency);

  // 7.7) ช่วงเวลาไหนขายดี + วันปกติ vs วันแคมเปญ (เหมือนหน้ารายเดือน / ทั้งปีบนเว็บ)
  if (o.heat) addHeatSlide(pres, o.heat.title, o.a);
  if (o.dayKinds) addDayKindSlide(pres, o.dayKinds.title, o.a, o.dayKinds.tags);

  // 8) Top 5 ไลฟ์ของช่วงหลัก
  addTop5Slide(pres, o.a, o.aName);

  // 9) วิเคราะห์: อะไรดรอป / ทำได้ดี / ข้อเสนอแนะ
  addAnalysisSlide(pres, analysis, f ? `วิเคราะห์และข้อเสนอแนะ: ${f.aName} เทียบ ${f.bName}` : "วิเคราะห์และข้อเสนอแนะ");

  // 10) สรุป
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    s.addText("สรุป", { x: M, y: 0.6, w: 8, h: 0.9, fontSize: 36, bold: true, color: C.white, fontFace: FONT, margin: 0, isTextBox: true });
    const next = analysis.suggestions.slice(0, 3);
    s.addText([
      ...notes.slice(0, 4).map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
      { text: "สิ่งที่ควรทำต่อ", options: { bold: true, color: C.pinkOnDark, breakLine: true, paraSpaceBefore: 10 } },
      ...next.map((t, i) => ({ text: t, options: { bullet: { type: "number" as const }, breakLine: i < next.length - 1 } })),
    ], { x: M, y: 1.7, w: W - 2 * M, h: 4.8, fontSize: 17, color: C.white, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 10, fit: "shrink", isTextBox: true });
    s.addText(`${o.report}: ${o.aName} (${o.aRange})${hasB ? ` vs ${o.bName} (${o.bRange})` : ""} · ${o.filterText}`,
      { x: M, y: H - 0.9, w: W - 2 * M, h: 0.4, fontSize: 11, color: C.mutedOnDark, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
  }

  return finish(pres);
}

// ---------- เทียบหลายเดือน ----------

export type MultiDeckInput = {
  rangeText: string; // เช่น "ก.ค.–ก.ย. 2026"
  keys: string[]; // เดือนในช่วง "YYYY-MM"
  focus: string; // เดือนหลัก
  label: (k: string) => string; // ชื่อสั้น เช่น "ก.ย." / "ต.ค.*"
  longLabel: (k: string) => string; // เช่น "กันยายน 2026"
  byMonth: Map<string, LiveSession[]>;
  now: string; // เดือนปัจจุบัน (ยังไม่จบ = ไม่นับเป็นเดือนสูงสุด/ต่ำสุด)
  filterText: string;
  exportedAt: string;
  /** โหมดช่วงวันเดียวกันหลายเดือน: รายวันของแต่ละเดือน (labels = "วันที่ 19" · byDay = เดือน -> ไลฟ์ของแต่ละวัน) */
  daily?: { labels: string[]; byDay: Map<string, LiveSession[][]> };
  /** หน้า GMV แยก Agency (เหมือนแท็บ "แยก Agency" บนเว็บ) */
  agency?: AgencyChart[];
};

/** ลำดับตัวชี้วัดของตารางเทียบหลายเดือน (เหมือนหน้าเว็บ / ไฟล์ส่งออก) */
const MULTI_KEYS: MetricKey[] = ["gmv", "duration", "gmvPerHour", "orders", "viewers", "viewersPerHour", "views", "impressions", "impressionsPerHour", "ctr", "co", "lives"];

/** +12.7% / +1.14pp (อัตรา = ผลต่าง pp) */
function deltaText(kind: (typeof METRICS)[number]["kind"], a: number | null, b: number | null) {
  if (a === null || b === null) return { text: "-", color: C.muted };
  const v = kind === "pct" ? (a - b) * 100 : changeOf(a, b);
  if (v === null) return { text: "-", color: C.muted };
  const flat = Math.abs(v) < (kind === "pct" ? 0.005 : 0.0005);
  return { text: kind === "pct" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}pp` : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`, color: flat ? C.muted : v > 0 ? C.up : C.down };
}

/**
 * สไลด์เทียบหลายเดือน: ปก / ตารางเทียบ (ทุกแพลตฟอร์ม + แยก TikTok / Shopee) / กราฟแท่ง + กราฟเส้นรายเดือน (+ รายวันของแต่ละเดือน) / ตารางบัญชี / วิเคราะห์ / สรุป
 *   ตาราง = ค่าทุกเดือน + เดือนหลัก vs เดือนอื่นทีละเดือน (แบบตารางที่ทีมใช้)
 */
export async function buildMultiDeck(o: MultiDeckInput, target: "pptx" | "gslides" = "pptx"): Promise<Blob> {
  const pres = await newDeck(`เทียบหลายเดือน ${o.rangeText}`, `GLORY VITAL · เทียบหลายเดือน ${o.rangeText} · เดือนหลัก ${o.longLabel(o.focus)}`);
  const list = (k: string) => o.byMonth.get(k) ?? [];
  const others = o.keys.filter((k) => k !== o.focus);
  const all = o.keys.flatMap(list);
  const valueAt = (k: string, mk: MetricKey, sel?: (s: LiveSession) => boolean) => {
    const t = totalsOf(sel ? list(k).filter(sel) : list(k));
    return t.lives ? metricOf(mk).value(t) : null;
  };
  const complete = o.keys.filter((k) => k !== o.now && list(k).length);
  const pick = (dir: 1 | -1) => complete.reduce<string | null>((b, k) => (b === null || dir * ((valueAt(k, "gmv") ?? 0) - (valueAt(b, "gmv") ?? 0)) > 0 ? k : b), null);
  const best = pick(1), worst = pick(-1);
  const gmvFocus = valueAt(o.focus, "gmv");
  // เดือนที่ใช้เทียบในหน้าวิเคราะห์: เดือนก่อนเดือนหลัก (ถ้าเดือนหลักเป็นเดือนแรก = เดือนถัดไป)
  const idx = o.keys.indexOf(o.focus);
  const pair = idx > 0 ? o.keys[idx - 1] : o.keys[idx + 1];

  // 1) ปก
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    s.addText("GLORY VITAL  ·  LIVE ANALYTICS", { x: M, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.pinkOnDark, charSpacing: 3, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText("เทียบหลายเดือน", { x: M, y: 1.7, w: 7.6, h: 0.6, fontSize: 22, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(o.rangeText, { x: M, y: 2.3, w: 7.6, h: 1.4, fontSize: 44, bold: true, color: C.white, fontFace: FONT, margin: 0, valign: "top", fit: "shrink", isTextBox: true });
    s.addText([
      { text: "เดือนหลัก  ", options: { color: C.mutedOnDark } }, { text: o.longLabel(o.focus), options: { bold: true, color: C.white, breakLine: true } },
      { text: "เทียบกับ  ", options: { color: C.mutedOnDark } }, { text: others.map(o.longLabel).join(", "), options: { color: C.white } },
    ], { x: M, y: 4.1, w: 7.6, h: 1.0, fontSize: 15, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 6, fit: "shrink", isTextBox: true });
    s.addText(`${o.filterText}  ·  ส่งออกเมื่อ ${o.exportedAt}`, { x: M, y: H - 0.9, w: 8, h: 0.35, fontSize: 11, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addShape(pres.ShapeType.roundRect, { x: 8.75, y: 1.7, w: 4.0, h: 3.6, fill: { color: "4A2236" }, line: { color: "4A2236" }, rectRadius: 0.15 });
    s.addText(`GMV ${o.label(o.focus)}`, { x: 9.05, y: 1.95, w: 3.4, h: 0.4, fontSize: 16, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(fmt("gmv", gmvFocus), { x: 9.05, y: 2.4, w: 3.4, h: 0.7, fontSize: 30, bold: true, color: C.white, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
    s.addText(others.flatMap((k, i) => {
      const d = deltaText("baht", gmvFocus, valueAt(k, "gmv"));
      return [
        { text: `vs ${o.label(k)}  `, options: { color: C.mutedOnDark } },
        { text: d.text, options: { bold: true, color: d.color === C.up ? "7EE0A8" : d.color === C.down ? "FF9A90" : C.mutedOnDark, breakLine: i < others.length - 1 } },
      ];
    }), { x: 9.05, y: 3.25, w: 3.4, h: 1.85, fontSize: 18, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 4, fit: "shrink", isTextBox: true });
  }

  // 2) ตัวเลขหลัก: ค่าของเดือนหลัก + เทียบทีละเดือน (เดือนล่าสุดก่อน ไม่เกิน 3 เดือน)
  const tf = totalsOf(list(o.focus));
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`ตัวเลขหลัก: ${o.longLabel(o.focus)}`, { placeholder: "title" });
    const keys: MetricKey[] = ["gmv", "orders", "viewers", "gmvPerHour", "duration", "lives", "ctr", "co"];
    const vs = others.slice().reverse().slice(0, 3);
    const cw = (W - 2 * M - 3 * 0.3) / 4, ch = 2.45;
    keys.forEach((k, i) => {
      const x = M + (i % 4) * (cw + 0.3), y = 1.5 + Math.floor(i / 4) * (ch + 0.3);
      const m = metricOf(k), v = val(tf, k);
      s.addShape(pres.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
      s.addText(m.note ? `${m.label} · ${m.note}` : m.label, { x: x + 0.25, y: y + 0.2, w: cw - 0.5, h: 0.4, fontSize: 12, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
      const big = fmt(k, v);
      s.addText(big, { x: x + 0.25, y: y + 0.6, w: cw - 0.5, h: 0.7, fontSize: big.length > 13 ? 18 : big.length > 10 ? 22 : 26, bold: true, color: C.text, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
      if (k === "co" && tf.coBase === null) {
        s.addText("ดูแยก TikTok / Shopee", { x: x + 0.25, y: y + 1.4, w: cw - 0.5, h: 0.35, fontSize: 13, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
        return;
      }
      s.addText(vs.flatMap((other, j) => {
        const d = deltaText(m.kind, v, valueAt(other, k));
        return [
          { text: `vs ${o.label(other)}  `, options: { color: C.muted } },
          { text: d.text, options: { bold: true, color: d.color, breakLine: j < vs.length - 1 } },
        ];
      }), { x: x + 0.25, y: y + 1.35, w: cw - 0.5, h: 0.95, fontSize: 14, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 2, fit: "shrink", isTextBox: true });
    });
  }

  // 2.5) ยอดต่อชั่วโมง: ค่าของเดือนหลัก + เทียบทีละเดือน + แท่งทุกเดือน
  {
    const vs = others.slice().reverse().slice(0, 3);
    addPerHourSlide(pres, `ยอดต่อชั่วโมง: ${o.longLabel(o.focus)}`, PER_HOUR_KEYS.map((k) => {
      const m = metricOf(k), v = valueAt(o.focus, k);
      return {
        key: k, value: v,
        deltas: vs.map((other) => ({ label: `vs ${o.label(other)}`, ...deltaText(m.kind, v, valueAt(other, k)) })),
        bars: o.keys.map((key) => ({ name: o.label(key), value: valueAt(key, k), main: key === o.focus })),
      };
    }));
  }

  // 3) ตารางเทียบ: ทุกแพลตฟอร์ม + แยกแพลตฟอร์ม (CO รวมสองแพลตฟอร์มคำนวณไม่ได้)
  const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.dark }, align } });
  const table = (title: string, sel?: (s: LiveSession) => boolean, note?: string) => {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(title, { placeholder: "title" });
    const rows: PptxGenJS.TableRow[] = [[
      head("Total", "left"), ...o.keys.map((k) => head(o.label(k))), ...others.map((k) => head(`${o.label(o.focus)} vs ${o.label(k)}`)),
    ]];
    for (const mk of MULTI_KEYS) {
      const m = metricOf(mk);
      rows.push([
        { text: m.label, options: { align: "left", bold: true } },
        ...o.keys.map((k) => ({ text: fmt(mk, valueAt(k, mk, sel)), options: { align: "right" as const, bold: k === o.focus } })),
        ...others.map((k) => {
          const d = deltaText(m.kind, valueAt(o.focus, mk, sel), valueAt(k, mk, sel));
          return { text: d.text, options: { align: "right" as const, bold: true, color: d.color, fill: { color: C.tint } } };
        }),
      ]);
    }
    const cols = 1 + o.keys.length + others.length;
    const first = 2.3, rest = (W - 2 * M - first) / (cols - 1);
    s.addTable(rows, {
      x: M, y: 1.4, w: W - 2 * M, colW: [first, ...Array(cols - 1).fill(rest)], fontSize: cols > 9 ? 10 : cols > 6 ? 12 : 14,
      fontFace: FONT, color: C.text, rowH: 0.37, border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
    });
    s.addText(note ?? "CTR / CO เทียบเป็น pp (ผลต่างของ %) · ค่าอื่นเป็น % ที่เปลี่ยน · ตัวหนา = เดือนหลัก", { x: M, y: 6.4, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
  };
  const platforms = (["TikTok", "Shopee"] as const).filter((p) => all.some((s) => s.platform === p));
  table(`เทียบทุกตัวชี้วัด: ${o.rangeText}`, undefined, platforms.length > 1
    ? "CTR / CO เทียบเป็น pp · ค่าอื่นเป็น % · CO รวมสองแพลตฟอร์มไม่คำนวณ (ดูหน้าแยก TikTok / Shopee)"
    : undefined);
  if (platforms.length > 1) for (const p of platforms) table(`${p}: ${o.rangeText}`, (s) => s.platform === p);

  // 4) อะไรทำให้ GMV เปลี่ยน: เดือนหลักเทียบเดือนก่อนหน้า
  const analysis = pair ? analyze({ aName: o.longLabel(o.focus), bName: o.longLabel(pair), a: list(o.focus), b: list(pair), time: [], stepWord: "วัน" }) : null;
  if (analysis && pair) addDriversSlide(pres, analysis, tf, totalsOf(list(pair)), o.label(o.focus), o.label(pair), `อะไรทำให้ GMV เปลี่ยน: ${o.label(o.focus)} เทียบ ${o.label(pair)}`);

  // 5) กราฟ GMV แยกตามบัญชี (ไม่เกิน 4 เดือน): ชมพู = เดือนหลัก / ฟ้าไล่ระดับ = เดือนอื่น (อ่อน = เก่า)
  const accounts = accountsOf(all);
  if (accounts.length && o.keys.length <= 4) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV แยกตามบัญชี", { placeholder: "title" });
    const blues = ["B7D3F6", "86B6EF", "5598E7"].slice(-others.length);
    const colorOf = (k: string) => (k === o.focus ? C.pink : blues[others.indexOf(k)] ?? C.blue);
    const labels = accounts.map((a) => a.name);
    const values = (k: string) => accounts.map((a) => valueAt(k, "gmv", (x) => keyOf(x) === a.key) ?? 0);
    const box = { x: M, y: 1.4, w: 8.6, h: 5.3 };
    if (target === "pptx") {
      s.addChart(pres.ChartType.bar, o.keys.map((k) => ({ name: o.label(k), labels, values: values(k) })), {
        ...box, barDir: "col", barGrouping: "clustered", barGapWidthPct: 50, chartColors: o.keys.map(colorOf),
        showLegend: true, legendPos: "t", legendFontSize: 12, legendFontFace: FONT, legendColor: C.text, showTitle: false, altText: "GMV แยกตามบัญชี",
        showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: COMPACT, dataLabelFontSize: 10, dataLabelFontBold: true, dataLabelFontFace: FONT, dataLabelColor: C.text,
        valAxisMinVal: 0, valAxisLabelFormatCode: COMPACT, valAxisLabelFontSize: 11, valAxisLabelFontFace: FONT, valAxisLabelColor: C.muted,
        catAxisLabelFontSize: 11, catAxisLabelFontFace: FONT, catAxisLabelColor: C.text, valGridLine: { color: C.grid, size: 0.75 }, catGridLine: { style: "none" },
      });
    } else {
      shapeBars(pres, s, { labels, box, showValue: true, emphasis: o.keys.indexOf(o.focus), series: o.keys.map((k) => ({ name: o.label(k), color: colorOf(k), values: values(k) })) });
    }
    const share = accounts
      .map((a) => ({ a, v: valueAt(o.focus, "gmv", (x) => keyOf(x) === a.key) ?? 0 }))
      .sort((x, y) => y.v - x.v).slice(0, 6);
    s.addText(`สัดส่วน GMV ${o.label(o.focus)}`, { x: 9.6, y: 1.5, w: 3.1, h: 0.45, fontSize: 18, bold: true, color: C.text, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(share.flatMap((r, i) => {
      const prev = pair ? valueAt(pair, "gmv", (x) => keyOf(x) === r.a.key) : null;
      const d = deltaText("baht", r.v || null, prev);
      return [
        { text: r.a.name, options: { bold: true, breakLine: true } },
        { text: `${tf.gmv ? ((r.v / tf.gmv) * 100).toFixed(1) : "0"}% ของ GMV  `, options: { color: C.muted } },
        { text: pair && d.text !== "-" ? `vs ${o.label(pair)} ${d.text}` : "", options: { bold: true, color: d.color, breakLine: i < share.length - 1 } },
      ];
    }), { x: 9.6, y: 2.0, w: 3.15, h: 4.6, fontSize: 13, color: C.text, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 6, fit: "shrink", isTextBox: true });
  }

  // 6) กราฟ GMV รายเดือน (MoM ใต้กราฟ)
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV รายเดือน", { placeholder: "title" });
    platformBars(pres, s, target, { title: "GMV รายเดือน", labels: o.keys.map(o.label), groups: o.keys.map(list), box: { x: M, y: 1.4, w: W - 2 * M, h: 4.9 }, showValue: true });
    const mom = o.keys.slice(1).map((k, i) => {
      const d = deltaText("baht", valueAt(k, "gmv"), valueAt(o.keys[i], "gmv"));
      return [{ text: `${o.label(k)} vs ${o.label(o.keys[i])}  `, options: { color: C.muted } }, { text: `${d.text}      `, options: { bold: true, color: d.color } }];
    }).flat();
    s.addText([{ text: "MoM:  ", options: { bold: true, color: C.text } }, ...mom], { x: M, y: 6.35, w: W - 2 * M, h: 0.4, fontSize: 13, fontFace: FONT, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
    s.addNotes(best ? `เดือนที่ GMV สูงสุด: ${o.longLabel(best)} ${fmt("gmv", valueAt(best, "gmv"))}` : "");
  }

  // 6.2) กราฟเส้นแนวโน้มรายเดือน: แยกแพลตฟอร์ม + เส้นรวม (เหมือนเว็บ) · มีเดือนเดียวไม่มีเส้นให้ดู
  if (o.keys.length > 1) {
    for (const metric of ["gmv", "gmvPerHour"] as const) {
      addTrendSlide(pres, target, `${metricOf(metric).label} แนวโน้มรายเดือน`, o.keys.map(o.label), platformTrend(o.keys.map(list), metric, true));
    }
  }

  // 6.3) รายวันของแต่ละเดือน (โหมดช่วงวันเดียวกันหลายเดือน): แท่งวันละกลุ่ม + เส้นเดือนละเส้น
  if (o.daily && o.daily.labels.length > 1) {
    const { byDay } = o.daily;
    const dayLabels = o.daily.labels.map((l) => l.replace("วันที่ ", ""));
    const blues = ["B7D3F6", "86B6EF", "5598E7"].slice(-others.length);
    const colorOf = (k: string) => (k === o.focus ? C.pink : blues[others.indexOf(k)] ?? C.blue);
    const days = (k: string) => byDay.get(k) ?? [];
    const lines = (metric: MetricKey) => o.keys.map((k) => ({ name: o.label(k), color: colorOf(k), values: totalSeries(days(k), metric) }));
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV รายวันของแต่ละเดือน", { placeholder: "title" });
    const box = { x: M, y: 1.4, w: W - 2 * M, h: 5.3 };
    const bars = lines("gmv").map((x) => ({ ...x, values: x.values.map((v) => v ?? 0) }));
    if (target === "pptx") {
      s.addChart(pres.ChartType.bar, bars.map((x) => ({ name: x.name, labels: dayLabels, values: x.values })), {
        ...box, barDir: "col", barGrouping: "clustered", barGapWidthPct: 50, chartColors: bars.map((x) => x.color),
        showLegend: true, legendPos: "t", legendFontSize: 12, legendFontFace: FONT, legendColor: C.text, showTitle: false, altText: "GMV รายวันของแต่ละเดือน",
        showValue: dayLabels.length <= 7, dataLabelPosition: "outEnd", dataLabelFormatCode: COMPACT, dataLabelFontSize: 10, dataLabelFontFace: FONT, dataLabelColor: C.text,
        valAxisMinVal: 0, valAxisLabelFormatCode: COMPACT, valAxisLabelFontSize: 11, valAxisLabelFontFace: FONT, valAxisLabelColor: C.muted,
        catAxisLabelFontSize: 11, catAxisLabelFontFace: FONT, catAxisLabelColor: C.text, valGridLine: { color: C.grid, size: 0.75 }, catGridLine: { style: "none" },
      });
    } else {
      shapeBars(pres, s, { labels: dayLabels, series: bars, box, showValue: dayLabels.length <= 7, emphasis: o.keys.indexOf(o.focus) });
    }
    addTrendSlide(pres, target, "GMV แนวโน้มรายวันของแต่ละเดือน", dayLabels, lines("gmv"));
    addTrendSlide(pres, target, "GMV / ชม. แนวโน้มรายวันของแต่ละเดือน", dayLabels, lines("gmvPerHour"));
  }

  // 6.5) GMV แยก Agency (แท่งคู่ TikTok | Shopee ซ้อนตามกลุ่ม) + GMV/ชม. เส้นละกลุ่ม
  addAgencySlides(pres, target, o.agency);

  // 7) สรุปแยกตามบัญชี: GMV ทุกเดือน + เดือนหลัก vs เดือนอื่น + ไลฟ์ / GMV ต่อชม. / CO ของเดือนหลัก (ไม่เกิน 4 เดือน)
  if (accounts.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("สรุปแยกตามบัญชี", { placeholder: "title" });
    const detail = o.keys.length <= 4;
    const rows: PptxGenJS.TableRow[] = [[
      head("บัญชี", "left"), ...o.keys.map((k) => head(`GMV ${o.label(k)}`)), ...others.map((k) => head(`${o.label(o.focus)} vs ${o.label(k)}`)),
      ...(detail ? [head(`ไลฟ์ ${o.label(o.focus)}`), head("GMV/ชม."), head("CO")] : []),
    ]];
    const line = (label: string, sel: ((x: LiveSession) => boolean) | undefined, total: boolean): PptxGenJS.TableRow => {
      const base = total ? { fill: { color: C.tint } } : {};
      const t = totalsOf(sel ? list(o.focus).filter(sel) : list(o.focus));
      return [
        { text: label, options: { ...base, align: "left", bold: true } },
        ...o.keys.map((k) => ({ text: fmt("gmv", valueAt(k, "gmv", sel)), options: { ...base, align: "right" as const, bold: k === o.focus || total } })),
        ...others.map((k) => {
          const d = deltaText("baht", valueAt(o.focus, "gmv", sel), valueAt(k, "gmv", sel));
          return { text: d.text, options: { align: "right" as const, bold: true, color: d.color, fill: { color: C.tint } } };
        }),
        ...(detail ? [
          { text: t.lives ? String(t.lives) : "-", options: { ...base, align: "right" as const } },
          { text: fmt("gmvPerHour", val(t, "gmvPerHour")), options: { ...base, align: "right" as const } },
          { text: fmt("co", val(t, "co")), options: { ...base, align: "right" as const } },
        ] : []),
      ];
    };
    rows.push(...accounts.slice(0, 9).map((a) => line(accountLabel(a), (x) => keyOf(x) === a.key, false)), line("รวม", undefined, true));
    const cols = rows[0].length;
    const first = 2.8, rest = (W - 2 * M - first) / (cols - 1);
    s.addTable(rows, {
      x: M, y: 1.4, w: W - 2 * M, colW: [first, ...Array(cols - 1).fill(rest)], fontSize: cols > 10 ? 10 : cols > 7 ? 11 : 13,
      fontFace: FONT, color: C.text, rowH: 0.48, border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
    });
  }

  // 8) Top 5 ไลฟ์ของเดือนหลัก
  addTop5Slide(pres, list(o.focus), o.longLabel(o.focus));

  // 9) วิเคราะห์: เดือนหลักเทียบเดือนก่อนหน้า
  if (analysis && pair) addAnalysisSlide(pres, analysis, `วิเคราะห์: ${o.longLabel(o.focus)} เทียบ ${o.longLabel(pair)}`);

  // 10) สรุป
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    s.addText("สรุป", { x: M, y: 0.6, w: 8, h: 0.9, fontSize: 36, bold: true, color: C.white, fontFace: FONT, margin: 0, isTextBox: true });
    const facts = [
      best ? `GMV สูงสุด: ${o.longLabel(best)} ${fmt("gmv", valueAt(best, "gmv"))}` : null,
      worst && worst !== best ? `GMV ต่ำสุด: ${o.longLabel(worst)} ${fmt("gmv", valueAt(worst, "gmv"))}` : null,
      ...others.map((k) => `GMV ${o.label(o.focus)} vs ${o.label(k)}: ${deltaText("baht", gmvFocus, valueAt(k, "gmv")).text}`),
      complete.length ? `GMV เฉลี่ยต่อเดือน (${complete.length} เดือนที่จบแล้ว): ${fmt("gmv", complete.reduce((sum, k) => sum + (valueAt(k, "gmv") ?? 0), 0) / complete.length)}` : null,
    ].filter((x): x is string => !!x);
    const next = analysis?.suggestions.slice(0, 3) ?? [];
    s.addText([
      ...facts.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
      ...(next.length ? [{ text: "สิ่งที่ควรทำต่อ", options: { bold: true, color: C.pinkOnDark, breakLine: true, paraSpaceBefore: 10 } }] : []),
      ...next.map((t, i) => ({ text: t, options: { bullet: { type: "number" as const }, breakLine: i < next.length - 1 } })),
    ], { x: M, y: 1.7, w: W - 2 * M, h: 4.8, fontSize: 17, color: C.white, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 10, fit: "shrink", isTextBox: true });
    s.addText(`เทียบหลายเดือน ${o.rangeText} · ${o.filterText}`, { x: M, y: H - 0.9, w: W - 2 * M, h: 0.4, fontSize: 11, color: C.mutedOnDark, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
  }

  return finish(pres);
}

/**
 * ธีมของ pptxgenjs ใช้ฟอนต์ไทย Angsana New / Cordia New (ตัวเล็กมาก) และกราฟตั้งฟอนต์ให้แค่ตัวอังกฤษ
 * -> ป้ายภาษาไทยในกราฟตัวเล็กผิดปกติ: แก้ฟอนต์ไทย (Thai / cs) ในธีมเป็น Tahoma
 */
function thaiThemeFont(pptx: Uint8Array) {
  const files = unzipSync(pptx);
  for (const name of Object.keys(files)) {
    if (!/^ppt\/theme\/theme\d+\.xml$/.test(name)) continue;
    const xml = strFromU8(files[name])
      .replace(/<a:font script="Thai" typeface="[^"]*"\/>/g, `<a:font script="Thai" typeface="${FONT}"/>`)
      .replace(/<a:cs typeface=""\/>/g, `<a:cs typeface="${FONT}"/>`);
    files[name] = strToU8(xml);
  }
  return zipSync(files, { level: 6 });
}

// ใช้ร่วมกับสไลด์อื่น (src/lib/campaign-slides.ts)
export { C as SLIDE_C, FONT as SLIDE_FONT, W as SLIDE_W, H as SLIDE_H, M as SLIDE_M, newDeck, finish, shapeBars, pctText, pctColor, lineChart };
