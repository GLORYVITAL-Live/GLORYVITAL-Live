// สไลด์หน้า Analytics > Cost / ROI: ตัวเลขเดียวกับหน้าเว็บ (src/components/CostPage.tsx) -> PowerPoint / Google Slides
//   ปก / ตัวเลขหลัก / แยกตามแพลตฟอร์มและกลุ่ม / Cost รายเดือน (แท่งซ้อนตามประเภท) / ROI รายเดือน / ตารางรายเดือน / แยกกลุ่มทั้งปี / ความคุ้มค่า Mc
//   แสดงเฉพาะส่วนที่บัญชีนี้ดูได้ (see) เหมือนหน้าเว็บ

import type PptxGenJS from "pptxgenjs";
import { costRatio, costTotals, roiOf, rowCost, rowSource, yearRows, type CostApp, type CostPoint, type CostReport, type CostRow } from "@/lib/cost-calc";
import { hasBudget } from "@/lib/agency-budget";
import { MC_COST_DIMS, mcCostRows, type CostReport as McCostReport } from "@/lib/mc-cost-calc";
import {
  finish, lineChart, newDeck, pctColor, pctText, shapeBars,
  SLIDE_C as C, SLIDE_FONT as FONT, SLIDE_H as H, SLIDE_M as M, SLIDE_W as W,
} from "@/lib/live-slides";

export type CostDeckInput = {
  report: CostReport;
  trend: CostPoint[] | null;
  /** ความคุ้มค่า Mc ของเดือนนี้ (เห็นค่าจ้าง Mc + ดูสถิติไลฟ์ได้) · null = ไม่มีส่วนนี้ */
  mc: McCostReport | null;
  monthName: string; prevName: string;
  /** "นับถึง 5 พ.ย. 23:30 น." / "ทั้งเดือน ..." */
  cutText: string;
  /** ชื่อเดือนย่อ เช่น "ต.ค." */
  shortMonth: (key: string) => string;
  monthLabel: (key: string) => string;
  exportedAt: string;
};

const baht = (v: number | null) => (v === null ? "-" : `฿${Math.round(v).toLocaleString("th-TH")}`);
const pctOf = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const roiText = (v: number | null) => (v === null ? "-" : `×${v.toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
const changeOf = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : a / b - 1);
/** สีประเภทค่าใช้จ่าย (เหมือนเว็บ --cost-mc / --cost-admin / --cost-agency) */
const COST_HEX = { mc: "EB6834", admin: "1BAF7A", agency: "6250D6" };

/** ที่มาของ Cost ในแถว (สั้น) เหมือนคอลัมน์รายละเอียดบนเว็บ */
function detailOf(r: CostRow) {
  const source = rowSource(r);
  if (r.owner && r.owner !== "In house" && !hasBudget(r.owner)) return ["ไม่คิดค่าใช้จ่าย", source].filter(Boolean).join(" · ");
  if (r.owner && hasBudget(r.owner)) {
    return [r.rate ? `฿${Math.round(r.rate).toLocaleString("th-TH")} × ${Math.round(r.planHours * 10) / 10} ชม.` : r.sources.agency ? "" : `ยังไม่ตั้งเรท · ${Math.round(r.planHours * 10) / 10} ชม.`, source].filter(Boolean).join(" · ");
  }
  const parts = ([[r.mc, "Mc"], [r.admin, "Admin"], [r.travel, "ค่ารถ"]] as const).filter(([v]) => v).map(([v, n]) => `${n} ${baht(v)}`);
  return [parts.join(" · "), source].filter(Boolean).join(" · ") || "ยังไม่มีค่าใช้จ่าย";
}

export async function buildCostDeck(o: CostDeckInput, target: "pptx" | "gslides" = "pptx"): Promise<Blob> {
  const { report, trend } = o;
  const { see, totals, prev } = report;
  const open = report.upTo !== null;
  const pres = await newDeck(`Cost / ROI ${o.monthName}`, `GLORY VITAL · Cost / ROI ${o.monthName}`);
  const head = (text: string, align: "left" | "right" = "right") => ({ text, options: { bold: true, color: C.white, fill: { color: C.pink }, align } });
  const note = (s: PptxGenJS.Slide, text: string) => s.addText(text, { x: M, y: 6.55, w: W - 2 * M, h: 0.35, fontSize: 11, italic: true, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
  const roi = roiOf(totals.gmv, totals.cost), prevRoi = roiOf(prev.gmv, prev.cost);

  // 1) ปก: Cost รวม + ROI
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    s.addText("GLORY VITAL  ·  LIVE ANALYTICS", { x: M, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.pinkOnDark, charSpacing: 3, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText("Cost / ROI", { x: M, y: 1.7, w: 7.6, h: 0.6, fontSize: 22, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(o.monthName, { x: M, y: 2.3, w: 7.6, h: 1.4, fontSize: 44, bold: true, color: C.white, fontFace: FONT, margin: 0, valign: "top", fit: "shrink", isTextBox: true });
    s.addText(o.cutText, { x: M, y: 3.9, w: 7.6, h: 0.5, fontSize: 15, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(`ส่งออกเมื่อ ${o.exportedAt}`, { x: M, y: H - 0.9, w: 8, h: 0.35, fontSize: 11, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addShape(pres.ShapeType.roundRect, { x: 8.75, y: 1.7, w: 4.0, h: 3.6, fill: { color: "4A2236" }, line: { color: "4A2236" }, rectRadius: 0.15 });
    s.addText("Cost รวม", { x: 9.05, y: 1.95, w: 3.4, h: 0.4, fontSize: 16, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    s.addText(baht(totals.cost), { x: 9.05, y: 2.4, w: 3.4, h: 0.7, fontSize: 30, bold: true, color: C.white, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
    if (see.gmv) {
      s.addText("ROI (GMV ÷ Cost)", { x: 9.05, y: 3.25, w: 3.4, h: 0.35, fontSize: 14, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
      s.addText(roiText(roi), { x: 9.05, y: 3.6, w: 3.4, h: 0.7, fontSize: 32, bold: true, color: C.pinkOnDark, fontFace: FONT, margin: 0, isTextBox: true });
      s.addText(roi === null ? "" : `จ่าย ฿1 ได้ยอดขาย ${baht(roi)}`, { x: 9.05, y: 4.35, w: 3.4, h: 0.5, fontSize: 13, color: C.mutedOnDark, fontFace: FONT, margin: 0, isTextBox: true });
    }
  }

  // 2) ตัวเลขหลัก (เหมือนการ์ดบนเว็บ) · Cost ไม่ระบายเขียว/แดง (เพิ่มไม่ได้แปลว่าแย่) · Cost/GMV ลด = ดี
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`ตัวเลขหลัก ${o.monthName} เทียบ ${o.prevName}`, { placeholder: "title" });
    const kpis: { label: string; value: string; c: number | null; tone: "neutral" | "up" | "down"; sub: string }[] = [
      { label: "Cost รวม", value: baht(totals.cost), c: changeOf(totals.cost, prev.cost), tone: "neutral", sub: [open && totals.full !== totals.cost ? `ทั้งเดือนตามแผน ${baht(totals.full)}` : "", totals.forecast ? `ประมาณการ ${baht(totals.forecast)}` : ""].filter(Boolean).join(" · ") },
      ...(see.gmv ? [
        { label: "Cost ต่อ GMV", value: pctOf(costRatio(totals.cost, totals.gmv)), c: changeOf(costRatio(totals.cost, totals.gmv), costRatio(prev.cost, prev.gmv)), tone: "down" as const, sub: totals.gmv === null ? "ยังไม่มีไฟล์ Export" : `GMV ${baht(totals.gmv)}` },
        { label: "ROI (GMV ÷ Cost)", value: roiText(roi), c: changeOf(roi, prevRoi), tone: "up" as const, sub: roi === null ? "" : `จ่าย ฿1 ได้ยอดขาย ${baht(roi)}` },
      ] : []),
      ...(see.mc ? [{ label: "ค่าจ้าง Mc", value: baht(totals.mc), c: changeOf(totals.mc, prev.mc), tone: "neutral" as const, sub: "" }] : []),
      ...(see.admin ? [{ label: "Admin + ค่ารถ", value: baht(totals.admin + totals.travel), c: changeOf(totals.admin + totals.travel, prev.admin + prev.travel), tone: "neutral" as const, sub: totals.travel ? `ค่ารถ ${baht(totals.travel)}` : "" }] : []),
      ...(see.agency ? [{ label: "งบ Agency", value: baht(totals.agency), c: changeOf(totals.agency, prev.agency), tone: "neutral" as const, sub: "" }] : []),
    ];
    const cols = 3, cw = (W - 2 * M - (cols - 1) * 0.3) / cols, ch = 2.35;
    kpis.forEach((k, i) => {
      const x = M + (i % cols) * (cw + 0.3), y = 1.45 + Math.floor(i / cols) * (ch + 0.3);
      s.addShape(pres.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
      s.addText(k.label, { x: x + 0.25, y: y + 0.2, w: cw - 0.5, h: 0.4, fontSize: 13, color: C.muted, fontFace: FONT, margin: 0, isTextBox: true });
      s.addText(k.value, { x: x + 0.25, y: y + 0.6, w: cw - 0.5, h: 0.7, fontSize: 28, bold: true, color: C.text, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
      const flat = k.c !== null && Math.abs(k.c) < 0.0005;
      const color = k.c === null || flat || k.tone === "neutral" ? C.muted : (k.c > 0) === (k.tone === "up") ? C.up : C.down;
      s.addText(k.c === null ? "ไม่มีข้อมูลเทียบ" : `${flat ? "เท่าเดิม" : pctText(k.c)} vs ${o.prevName}`, { x: x + 0.25, y: y + 1.35, w: cw - 0.5, h: 0.4, fontSize: 14, bold: k.c !== null, color, fontFace: FONT, margin: 0, isTextBox: true });
      if (k.sub) s.addText(k.sub, { x: x + 0.25, y: y + 1.8, w: cw - 0.5, h: 0.4, fontSize: 12, color: C.muted, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
    });
    if (totals.agency && !prev.agency) note(s, `${o.prevName} ยังไม่มีงบ Agency ในยอด Cost ที่เทียบกันจึงดูเพิ่มขึ้นมากกว่าจริง`);
  }

  // 3) แยกตามแพลตฟอร์มและกลุ่ม
  if (report.rows.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("แยกตามแพลตฟอร์มและกลุ่ม", { placeholder: "title" });
    const line = (label: string, detail: string, r: { cost: number; gmv: number | null; full: number }, band: boolean): PptxGenJS.TableRow => {
      const base = band ? { bold: true, fill: { color: C.tint } } : {};
      return [
        { text: band ? label : `   ${label}`, options: { ...base, align: "left" } },
        { text: detail, options: { ...base, align: "left", color: C.muted, fontSize: 10 } },
        { text: baht(r.cost), options: { ...base, align: "right", bold: true } },
        ...(see.gmv ? [
          { text: baht(r.gmv), options: { ...base, align: "right" as const } },
          { text: r.cost ? pctOf(costRatio(r.cost, r.gmv)) : "-", options: { ...base, align: "right" as const } },
          { text: roiText(roiOf(r.gmv, r.cost)), options: { ...base, align: "right" as const, bold: true } },
        ] : []),
        ...(open ? [{ text: baht(r.full), options: { ...base, align: "right" as const, color: C.muted } }] : []),
      ];
    };
    const rows: PptxGenJS.TableRow[] = [[
      head("กลุ่ม", "left"), head("ที่มาของ Cost", "left"), head("Cost"), ...(see.gmv ? [head("GMV"), head("Cost/GMV"), head("ROI")] : []), ...(open ? [head("ทั้งเดือนตามแผน")] : []),
    ]];
    for (const app of ["TikTok", "Shopee"] as CostApp[]) {
      const list = report.rows.filter((r) => r.app === app);
      if (!list.length) continue;
      const sub = costTotals(list);
      rows.push(line(app, "", { cost: sub.cost, gmv: sub.gmv, full: sub.full }, true));
      for (const r of list) rows.push(line(r.label, detailOf(r), { cost: rowCost(r), gmv: r.gmv, full: r.full }, false));
    }
    rows.push(line("รวม", "", { cost: totals.cost, gmv: totals.gmv, full: totals.full }, true));
    const widths = [2.6, 3.4, 1.4, ...(see.gmv ? [1.5, 1.1, 1.0] : []), ...(open ? [1.6] : [])];
    const scale = (W - 2 * M) / widths.reduce((a, b) => a + b, 0);
    s.addTable(rows, {
      x: M, y: 1.4, w: W - 2 * M, colW: widths.map((c) => c * scale), fontSize: 12, fontFace: FONT, color: C.text, rowH: Math.min(0.42, 5.0 / rows.length),
      border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
    });
    note(s, "ไม่รวมเงินเดือน Mc / Admin ประจำ · งบ Agency = เรท × ชั่วโมงในแพลน ไม่ใช่ยอดที่จ่ายจริง · GMV แยกตามเวลาในแพลน ไลฟ์ที่คร่อมหลายกลุ่มแบ่งตามนาที (ประมาณ)");
  }

  if (trend?.length) {
    const labels = trend.map((p) => `${o.shortMonth(p.month)}${p.open ? "*" : p.forecast ? "~" : ""}`);
    const year = trend[0].month.slice(0, 4);
    const yearCost = trend.reduce((a, p) => a + p.cost, 0);
    const hasGmv = trend.some((p) => p.gmv !== null), yearGmv = hasGmv ? trend.reduce((a, p) => a + (p.gmv ?? 0), 0) : null;
    const yearForecast = trend.reduce((a, p) => a + p.forecast, 0);
    const legend = `* = ยังไม่จบเดือน · ~ = มีตัวเลขประมาณการ (Forecast)${yearForecast ? ` รวม ${baht(yearForecast)}` : ""}`;

    // 4) Cost รายเดือน: แท่งซ้อนตามประเภท (ความสูง = Cost รวม)
    {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(`Cost รายเดือน ปี ${year}`, { placeholder: "title" });
      s.addText(`รวม ${baht(yearCost)}${see.gmv && yearGmv !== null ? ` · GMV ${baht(yearGmv)} · Cost/GMV ${pctOf(costRatio(yearCost, yearGmv))} · ROI ${roiText(roiOf(yearGmv, yearCost))}` : ""}`,
        { x: M, y: 1.2, w: W - 2 * M, h: 0.35, fontSize: 14, bold: true, color: C.text, fontFace: FONT, margin: 0, isTextBox: true });
      shapeBars(pres, s, {
        labels, box: { x: M, y: 1.55, w: W - 2 * M, h: 4.95 }, showValue: true, stacked: true,
        series: [
          ...(see.mc ? [{ name: "Mc", color: COST_HEX.mc, values: trend.map((p) => p.mc) }] : []),
          ...(see.admin ? [{ name: "Admin + ค่ารถ", color: COST_HEX.admin, values: trend.map((p) => p.admin + p.travel) }] : []),
          ...(see.agency ? [{ name: "Agency", color: COST_HEX.agency, values: trend.map((p) => p.agency) }] : []),
        ],
      });
      note(s, legend);
    }

    // 5) ROI รายเดือน (GMV ÷ Cost)
    const rois = trend.map((p) => roiOf(p.gmv, p.cost));
    if (see.gmv && rois.some((v) => v !== null)) {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(`ROI รายเดือน ปี ${year} (GMV ÷ Cost)`, { placeholder: "title" });
      lineChart(pres, s, target, {
        title: "ROI รายเดือน", labels, series: [{ name: "ROI", color: C.pink, values: rois }], box: { x: M, y: 1.4, w: W - 2 * M, h: 5.05 },
        format: { code: '"×"0.0', fn: (v) => `×${v.toFixed(1)}` },
      });
      note(s, `จ่ายค่าทีมไลฟ์ ฿1 ได้ยอดขายกี่บาท · สูงขึ้น = คุ้มขึ้น · ${legend}`);
    }

    // 6) ตารางรายเดือน (ROI + ROI MoM)
    {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(`Cost รายเดือน ปี ${year} (ตาราง)`, { placeholder: "title" });
      const cols = [
        ...(see.mc ? [["Mc", (p: CostPoint) => p.mc] as const] : []),
        ...(see.admin ? [["Admin + ค่ารถ", (p: CostPoint) => p.admin + p.travel] as const] : []),
        ...(see.agency ? [["Agency", (p: CostPoint) => p.agency] as const] : []),
      ];
      const rows: PptxGenJS.TableRow[] = [[
        head("เดือน", "left"), ...cols.map(([n]) => head(n)), head("Cost รวม"),
        ...(see.gmv ? [head("GMV"), head("Cost/GMV"), head("ROI"), head("ROI MoM")] : []), head("ประมาณการ"),
      ]];
      trend.forEach((p, i) => {
        const c = i ? changeOf(rois[i], rois[i - 1]) : null;
        rows.push([
          { text: `${o.monthLabel(p.month)}${p.open ? " (ยังไม่จบ)" : ""}`, options: { align: "left" } },
          ...cols.map(([, f]) => ({ text: baht(f(p)), options: { align: "right" as const } })),
          { text: baht(p.cost), options: { align: "right", bold: true } },
          ...(see.gmv ? [
            { text: baht(p.gmv), options: { align: "right" as const } },
            { text: pctOf(costRatio(p.cost, p.gmv)), options: { align: "right" as const } },
            { text: roiText(rois[i]), options: { align: "right" as const, bold: true } },
            { text: c === null ? "-" : pctText(c), options: { align: "right" as const, bold: c !== null, color: pctColor(c) } },
          ] : []),
          { text: p.forecast ? baht(p.forecast) : "-", options: { align: "right", color: p.forecast ? C.down : C.muted } },
        ]);
      });
      const band = { bold: true, fill: { color: C.tint } };
      rows.push([
        { text: "รวม", options: { ...band, align: "left" } },
        ...cols.map(([, f]) => ({ text: baht(trend.reduce((a, p) => a + f(p), 0)), options: { ...band, align: "right" as const } })),
        { text: baht(yearCost), options: { ...band, align: "right" } },
        ...(see.gmv ? [
          { text: baht(yearGmv), options: { ...band, align: "right" as const } },
          { text: pctOf(costRatio(yearCost, yearGmv)), options: { ...band, align: "right" as const } },
          { text: roiText(roiOf(yearGmv, yearCost)), options: { ...band, align: "right" as const } },
          { text: "", options: band },
        ] : []),
        { text: yearForecast ? baht(yearForecast) : "-", options: { ...band, align: "right" } },
      ]);
      s.addTable(rows, {
        x: M, y: 1.4, w: W - 2 * M, fontSize: 11, fontFace: FONT, color: C.text, rowH: Math.min(0.36, 5.05 / rows.length),
        border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.06, 0, 0.06],
      });
    }

    // 7) แยกกลุ่มทั้งปี
    const groups = yearRows(trend).filter((r) => rowCost(r));
    if (groups.length) {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(`Cost แยกกลุ่ม ปี ${year}`, { placeholder: "title" });
      shapeBars(pres, s, {
        labels: groups.map((r) => `${r.app === "Shopee" ? "SP" : "TT"} ${r.label}`.slice(0, 16)), box: { x: M, y: 1.35, w: 7.4, h: 5.1 }, showValue: true,
        series: [{ name: "Cost", color: C.pink, values: groups.map(rowCost) }], legend: false,
      });
      s.addTable([
        [head("กลุ่ม", "left"), head("Cost"), head("สัดส่วน"), ...(see.gmv ? [head("ROI")] : [])],
        ...groups.map((r): PptxGenJS.TableRow => [
          { text: `${r.app} · ${r.label}`, options: { align: "left" } },
          { text: baht(rowCost(r)), options: { align: "right", bold: true } },
          { text: pctOf(costRatio(rowCost(r), yearCost)), options: { align: "right" } },
          ...(see.gmv ? [{ text: roiText(roiOf(r.gmv, rowCost(r))), options: { align: "right" as const } }] : []),
        ]),
      ], {
        x: 8.2, y: 1.4, w: W - M - 8.2, colW: see.gmv ? [2.0, 1.15, 0.85, 0.533] : [2.4, 1.3, 0.833], fontSize: 10, fontFace: FONT, color: C.text,
        rowH: Math.min(0.36, 5.0 / (groups.length + 1)), border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.05, 0, 0.05],
      });
      note(s, `TT = TikTok · SP = Shopee · ${legend}`);
    }
  }

  // 8) ความคุ้มค่า Mc: ทุกมุมเหมือนแท็บบนเว็บ (ช่วงเวลา / ช่อง / Mc / แคมเปญ / แพลตฟอร์ม)
  const mc = o.mc;
  if (mc?.cells.length) {
    const total = mc.cells.reduce((a, c) => ({ slots: a.slots + c.slots, hours: a.hours + c.hours, cost: a.cost + c.cost, gmv: a.gmv + c.gmv }), { slots: 0, hours: 0, cost: 0, gmv: 0 });
    const ratio = (a: number, b: number) => (b ? a / b : null);
    const avg = ratio(total.cost, total.gmv);
    for (const [dim, title] of MC_COST_DIMS) {
      const all = mcCostRows(mc.cells, dim);
      const MAX = 13;
      const list = all.slice(0, MAX);
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(`ความคุ้มค่า Mc แยกตาม${title}`, { placeholder: "title" });
      s.addText([
        { text: `ค่าจ้าง Mc ${baht(total.cost)}  ·  GMV ของคิวเหล่านี้ ${baht(total.gmv)}  ·  ค่าจ้างต่อยอดขาย `, options: { color: C.muted } },
        { text: pctOf(avg), options: { bold: true, color: C.text } },
        { text: "  ·  จ่ายค่าจ้าง ฿1 ได้ยอด ", options: { color: C.muted } },
        { text: total.cost ? `฿${(total.gmv / total.cost).toFixed(1)}` : "-", options: { bold: true, color: C.text } },
      ], { x: M, y: 1.2, w: W - 2 * M, h: 0.35, fontSize: 13, fontFace: FONT, margin: 0, fit: "shrink", isTextBox: true });
      s.addTable([
        [head(title, "left"), head("ชม."), head("ค่าจ้าง"), head("GMV"), head("ค่าจ้าง/ชม."), head("GMV/ชม."), head("ค่าจ้าง/ยอด"), head("จ่าย ฿1 ได้ยอด")],
        ...list.map((x): PptxGenJS.TableRow => {
          const p = ratio(x.cost, x.gmv), worse = avg !== null && p !== null && p > avg * 1.25;
          return [
            { text: x.label, options: { align: "left" } },
            { text: (Math.round(x.hours * 100) / 100).toLocaleString("th-TH"), options: { align: "right" } },
            { text: baht(x.cost), options: { align: "right" } },
            { text: `${x.estHours / (x.hours || 1) > 0.5 ? "≈" : ""}${baht(x.gmv)}`, options: { align: "right" } },
            { text: baht(ratio(x.cost, x.hours)), options: { align: "right", color: C.muted } },
            { text: baht(ratio(x.gmv, x.hours)), options: { align: "right", color: C.muted } },
            { text: pctOf(p), options: { align: "right", bold: worse, color: worse ? C.down : C.text } },
            { text: x.cost ? `฿${(x.gmv / x.cost).toFixed(1)}` : "-", options: { align: "right", bold: true } },
          ];
        }),
      ], {
        x: M, y: 1.65, w: W - 2 * M, colW: [3.033, 1.0, 1.45, 1.6, 1.2, 1.3, 1.2, 1.35], fontSize: 11, fontFace: FONT, color: C.text,
        rowH: Math.min(0.36, 4.8 / (list.length + 1)), border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.06, 0, 0.06],
      });
      note(s, `${all.length > MAX ? `แสดง ${MAX} จาก ${all.length} รายการ (เรียงตามค่าจ้าง) ดูครบในไฟล์ส่งออก · ` : ""}ค่าจ้าง/ยอด สีแดง = สูงกว่าค่าเฉลี่ยของเดือนเกิน 25% · ≈ = ยอดส่วนใหญ่ประมาณจากไฟล์ Export · ไม่นับ Mc ประจำ`);
    }
  }

  return finish(pres);
}
