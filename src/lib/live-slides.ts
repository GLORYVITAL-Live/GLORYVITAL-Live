// สไลด์นำเสนอผลการเทียบ 2 ช่วง (เดือน / ไตรมาส / YoY / แคมเปญ) -> ไฟล์ PowerPoint (.pptx)
//   สร้างในเบราว์เซอร์ด้วย pptxgenjs (โหลดเฉพาะตอนกด) กราฟเป็นกราฟจริงของ PowerPoint แก้ตัวเลขต่อได้
//   Google Slides = อัปไฟล์เดียวกันไปแปลงที่ /api/export/slides

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type PptxGenJS from "pptxgenjs";
import { analyze } from "@/lib/live-insights";
import { accountLabel, accountsOf, changeOf, fmtMetric, METRICS, metricOf, totalsOf, type LiveSession, type MetricKey, type Totals } from "@/lib/live-stats";

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
  /** เพิ่มหน้ารายไตรมาส (a = ช่วงหลัก, b = ปีก่อน) + QoQ */
  quarters?: { label: string; a: LiveSession[]; b: LiveSession[]; before: LiveSession[]; open: boolean }[];
  /** หน้าวิเคราะห์ใช้คู่นี้แทน (เช่น ยังไม่มีข้อมูลปีก่อน -> เดือนล่าสุดเทียบเดือนก่อน) */
  focus?: { aName: string; bName: string; a: LiveSession[]; b: LiveSession[] };
};

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
    ? `GMV ${o.aName} ${fmt("gmv", val(ta, "gmv"))} (ไม่มีข้อมูล ${o.bName} ให้เทียบ)`
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

/** กราฟแท่งวาดด้วยรูปทรง (คมชัดทุกขนาด แปลงเป็น Google Slides ได้ตรงทุกจุด) */
function shapeBars(pres: PptxGenJS, s: PptxGenJS.Slide, o: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  box: { x: number; y: number; w: number; h: number };
  showValue: boolean;
  /** ชุดที่เน้น (ตัวเลขตัวหนา) ไม่ใส่ = ชุดแรก */
  emphasis?: number;
}) {
  const { x, y, w, h } = o.box;
  const em = o.emphasis ?? 0;
  const text = (t: string, opts: PptxGenJS.TextPropsOptions) => s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, ...opts });
  // ตำนานด้านบน
  let lx = x + w / 2 - o.series.length * 0.8;
  for (const sr of o.series) {
    s.addShape(pres.ShapeType.rect, { x: lx, y: y + 0.08, w: 0.16, h: 0.16, fill: { color: sr.color }, line: { color: sr.color } });
    text(sr.name, { x: lx + 0.22, y: y, w: 1.3, h: 0.32, fontSize: 12, color: C.text, valign: "middle" });
    lx += 1.6;
  }
  // เผื่อที่ด้านบน 25% ให้ตัวเลขบนแท่ง + % ที่เปลี่ยน ไม่ชนขอบ
  const max = Math.max(0, ...o.series.flatMap((sr) => sr.values));
  const ticks = niceTicks(max * 1.25);
  const top = ticks[ticks.length - 1] || 1;
  const px = x + 0.85, pw = w - 0.9, py = y + 0.5, ph = h - 0.5 - 0.45;
  const yOf = (v: number) => py + ph - (v / top) * ph;
  for (const t of ticks) {
    s.addShape(pres.ShapeType.line, { x: px, y: yOf(t), w: pw, h: 0, line: { color: t ? C.grid : C.muted, width: t ? 0.75 : 1 } });
    text(compact(t), { x: x, y: yOf(t) - 0.13, w: 0.78, h: 0.26, fontSize: 11, color: C.muted, align: "right", valign: "middle" });
  }
  const n = o.labels.length, k = o.series.length;
  const gw = pw / Math.max(1, n);
  const bw = Math.min(1.0, (gw * 0.76) / k);
  const every = Math.max(1, Math.ceil(n / Math.floor(pw / 0.55)));
  // ขนาดตัวเลขตามความกว้างแท่ง (ป้ายกว้างเท่าแท่ง ไม่ชนแท่งข้าง ๆ) เช่น "฿44.1M" ~6 ตัว
  const valueSize = bw >= 0.95 ? 14 : bw >= 0.75 ? 12 : bw >= 0.55 ? 10 : 9;
  o.labels.forEach((label, i) => {
    const gx = px + i * gw + (gw - bw * k) / 2;
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
    const c = k === 2 ? changeOf(a, b || null) : null;
    if (o.showValue && c !== null) {
      text(pctText(c), {
        x: px + i * gw, y: yOf(peak) - 0.7, w: gw, h: 0.32, fontSize: Math.max(valueSize, gw >= 1.1 ? 12 : 10), bold: true,
        color: pctColor(c), align: "center", valign: "bottom",
      });
    }
    if (i % every === 0) text(label, { x: px + i * gw, y: py + ph + 0.08, w: gw, h: 0.32, fontSize: n > 12 ? 10 : 12, color: C.text, align: "center", valign: "top", fit: "shrink" });
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
  const pres = await newDeck(`${o.report}: ${o.aName} vs ${o.bName}`, `GLORY VITAL · ${o.report}: ${o.aName}${o.b.length ? ` vs ${o.bName}` : ""}`);

  const ta = totalsOf(o.a), tb = totalsOf(o.b);
  const hasB = tb.lives > 0;
  const notes = insights(o, ta, tb);
  const f = o.focus;
  const analysis = f
    ? analyze({ aName: f.aName, bName: f.bName, a: f.a, b: f.b, time: [], stepWord: "วัน" })
    : analyze({ aName: o.aName, bName: o.bName, a: o.a, b: o.b, time: o.time, stepWord: stepWordOf(o.timeName) });
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
    barChart(s, "GMV แยกตามบัญชี", accounts.map((a) => a.name), accounts.map((a) => gmvOf(o.a, a.key)), accounts.map((a) => gmvOf(o.b, a.key)),
      { x: M, y: 1.4, w: 8.6, h: 5.3 });
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
    barChart(s, `GMV ${o.timeName}`, labels, o.time.map((t) => totalsOf(t.a).gmv), o.time.map((t) => totalsOf(t.b).gmv),
      { x: M, y: 1.4, w: W - 2 * M, h: 5.3 }, o.time.length <= 12);
    if (labels.some((l) => l.endsWith("*"))) {
      s.addText("* เดือนที่ยังไม่จบ (ยอดยังไม่ครบเดือน)", { x: M, y: 6.75, w: 6, h: 0.3, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
    }
    s.addNotes(`${stepWordOf(o.timeName)}ที่ 1 ของ ${o.aName} เทียบกับ${stepWordOf(o.timeName)}ที่ 1 ของ ${o.bName} (ชื่อบนแกนเป็นของ ${o.aName})`);
  }

  // 6.5) รายไตรมาส (ภาพรวมทั้งปี): กราฟ GMV ต่อไตรมาส + QoQ ใต้กราฟ
  if (o.quarters?.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV รายไตรมาส", { placeholder: "title" });
    const qs = o.quarters;
    barChart(s, "GMV รายไตรมาส", qs.map((q) => q.label), qs.map((q) => totalsOf(q.a).gmv), qs.map((q) => totalsOf(q.b).gmv), { x: M, y: 1.4, w: W - 2 * M, h: 4.7 });
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
    s.addText(`${o.report}: ${o.aName} (${o.aRange}) vs ${o.bName} (${o.bRange}) · ${o.filterText}`,
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
 * สไลด์เทียบหลายเดือน: ปก / ตารางเทียบ (ทุกแพลตฟอร์ม + แยก TikTok / Shopee) / กราฟ GMV รายเดือน / ตารางบัญชี / วิเคราะห์ / สรุป
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
    const labels = o.keys.map(o.label), values = o.keys.map((k) => valueAt(k, "gmv") ?? 0);
    if (target === "pptx") {
      s.addChart(pres.ChartType.bar, [{ name: "GMV", labels, values }], {
        x: M, y: 1.4, w: W - 2 * M, h: 4.9, barDir: "col", barGapWidthPct: 60, chartColors: [C.pink, C.pink], showLegend: false, showTitle: false, altText: "GMV รายเดือน",
        showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: COMPACT, dataLabelFontSize: o.keys.length <= 6 ? 14 : 11, dataLabelFontBold: true, dataLabelFontFace: FONT, dataLabelColor: C.text,
        valAxisMinVal: 0, valAxisLabelFormatCode: COMPACT, valAxisLabelFontSize: 11, valAxisLabelFontFace: FONT, valAxisLabelColor: C.muted,
        catAxisLabelFontSize: 12, catAxisLabelFontFace: FONT, catAxisLabelColor: C.text, valGridLine: { color: C.grid, size: 0.75 }, catGridLine: { style: "none" },
      });
    } else {
      shapeBars(pres, s, { labels, series: [{ name: "GMV", color: C.pink, values }], box: { x: M, y: 1.4, w: W - 2 * M, h: 4.9 }, showValue: true });
    }
    const mom = o.keys.slice(1).map((k, i) => {
      const d = deltaText("baht", valueAt(k, "gmv"), valueAt(o.keys[i], "gmv"));
      return [{ text: `${o.label(k)} vs ${o.label(o.keys[i])}  `, options: { color: C.muted } }, { text: `${d.text}      `, options: { bold: true, color: d.color } }];
    }).flat();
    s.addText([{ text: "MoM:  ", options: { bold: true, color: C.text } }, ...mom], { x: M, y: 6.35, w: W - 2 * M, h: 0.4, fontSize: 13, fontFace: FONT, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
    s.addNotes(best ? `เดือนที่ GMV สูงสุด: ${o.longLabel(best)} ${fmt("gmv", valueAt(best, "gmv"))}` : "");
  }

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
