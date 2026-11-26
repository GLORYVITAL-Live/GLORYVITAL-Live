// สไลด์ + ไฟล์ Excel "สรุป Mc TikTok ทีมเรา" (ผลงาน Mc > สรุป Mc TikTok) — ตัวเลขชุดเดียวกับหน้าเว็บ (src/lib/tiktok-mc-calc.ts)
//   ปก · ค่าจ้าง Mc รายเดือน · GMV + ROI · ชั่วโมงไลฟ์ + ต้นทุนต่อชั่วโมง · % เป้า GMV TikTok · ROI ราย Mc · สรุปรายเดือน
//   กราฟวาดด้วยรูปทรง (shapeBars) = PowerPoint และ Google Slides หน้าตาเดียวกัน

import type PptxGenJS from "pptxgenjs";
import type { ExportBook } from "@/lib/export";
import { fmtMonthLong, fmtMonthShort } from "@/lib/format";
import { SLIDE_C as C, SLIDE_FONT as FONT, SLIDE_H as H, SLIDE_M as M, SLIDE_W as W, finish, newDeck, shapeBars } from "@/lib/live-slides";
import {
  ROI_NOTE, SOURCE_TEXT, achieveOf, baht, costPerHour, gmvPerHour, hrsText, paidHours, peopleByRoi, pctText, roiOf, roiText, sumMonths,
  type TiktokMcMonth, type TiktokMcPeople,
} from "@/lib/tiktok-mc-calc";

const monText = (m: string) => fmtMonthLong.format(new Date(`${m}-01T12:00:00Z`));
const monShort = (m: string) => `${fmtMonthShort.format(new Date(`${m}-01T12:00:00Z`))} ${m.slice(2, 4)}`;
const SALARIED_NOTE = "เดือนที่ใช้ตัวเลขระบบ: ค่าจ้าง Mc ประจำ (เงินเดือน) ยังไม่อยู่ในยอด จนกว่าทีมจะกรอกยอดจริงในชีต Sum 2 · ต้นทุนต่อชั่วโมงจึงหารเฉพาะชั่วโมงที่มีค่าจ้าง";

export type TiktokMcDeckInput = { year: string; months: TiktokMcMonth[]; people: TiktokMcPeople | null; exportedAt: string };

export async function buildTiktokMcDeck(o: TiktokMcDeckInput): Promise<Blob> {
  const ms = o.months;
  const ytd = sumMonths(ms);
  const span = ms.length ? `${monShort(ms[0].month)}–${monShort(ms[ms.length - 1].month)}` : "";
  const pres = await newDeck(`สรุป Mc TikTok ปี ${o.year}`, `GLORY VITAL · สรุป Mc TikTok ทีมเรา · ปี ${o.year}`);
  const text = (s: PptxGenJS.Slide, t: string | PptxGenJS.TextProps[], opts: PptxGenJS.TextPropsOptions) =>
    s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, ...opts });
  const labels = ms.map((m) => monShort(m.month));
  const hatched = ms.map((m) => m.open);
  const note = (s: PptxGenJS.Slide, t: string) => text(s, t, { x: M, y: 6.55, w: W - 2 * M, h: 0.3, fontSize: 10, italic: true, color: C.muted, fit: "shrink" });
  const systemMonths = ms.filter((m) => m.source === "system" && m.salariedHours > 0);

  // 1) ปก
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    text(s, "GLORY VITAL  ·  สรุป Mc TikTok ทีมเรา", { x: M, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.pinkOnDark, charSpacing: 3 });
    text(s, `ปี ${o.year}`, { x: M, y: 1.7, w: 7.6, h: 1.2, fontSize: 48, bold: true, color: C.white });
    text(s, `${span}${ytd.open ? " (เดือนล่าสุดยังไม่จบ)" : ""}`, { x: M, y: 2.95, w: 7.6, h: 0.6, fontSize: 22, color: C.mutedOnDark });
    text(s, `ส่งออกเมื่อ ${o.exportedAt}`, { x: M, y: H - 0.9, w: 8, h: 0.35, fontSize: 11, color: C.mutedOnDark });
    s.addShape(pres.ShapeType.roundRect, { x: 8.55, y: 1.3, w: 4.2, h: 4.7, fill: { color: "4A2236" }, line: { color: "4A2236" }, rectRadius: 0.15 });
    const rows: [string, string][] = [
      ["ค่าจ้าง Mc รวม", baht(ytd.cost)], ["GMV ของเรา", baht(ytd.gmv)], ["ROI", roiText(roiOf(ytd.gmv, ytd.cost))],
      ["ชั่วโมงไลฟ์", hrsText(Math.round(ytd.hours))], ["ต้นทุนต่อชั่วโมง", baht(costPerHour(ytd))], ["% เป้า GMV TikTok", pctText(achieveOf(ytd))],
    ];
    text(s, rows.flatMap(([k, v], i) => [
      { text: `${k}\n`, options: { color: C.mutedOnDark, fontSize: 12 } },
      { text: v, options: { color: C.white, bold: true, fontSize: 20, breakLine: i < rows.length - 1 } },
    ]), { x: 8.85, y: 1.5, w: 3.6, h: 4.3, valign: "top", paraSpaceAfter: 6, fit: "shrink" });
  }

  // 2) ค่าจ้าง Mc รายเดือน (ภาพรวมทั้งปี)
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`ค่าจ้าง Mc ทีมเรา รายเดือน ปี ${o.year}`, { placeholder: "title" });
    shapeBars(pres, s, { labels, box: { x: M, y: 1.3, w: W - 2 * M, h: 4.4 }, showValue: true, hatched, legend: false, series: [{ name: "ค่าจ้าง Mc", color: C.pink, values: ms.map((m) => m.cost) }] });
    const closed = ms.filter((m) => !m.open);
    text(s, [
      { text: "รวมทั้งปี  ", options: { color: C.muted } }, { text: baht(ytd.cost), options: { bold: true } },
      { text: "     เฉลี่ยต่อเดือน (เดือนที่จบแล้ว)  ", options: { color: C.muted } },
      { text: baht(closed.length ? closed.reduce((a, m) => a + m.cost, 0) / closed.length : null), options: { bold: true } },
    ], { x: M, y: 5.8, w: W - 2 * M, h: 0.4, fontSize: 15, color: C.text });
    note(s, `แท่งลายทแยง = เดือนที่ยังไม่จบ (นับถึงไลฟ์ล่าสุด) · ที่มา: ${ms.map((m) => `${monShort(m.month)} ${m.source === "sheet" ? "ชีต" : m.source === "forecast" ? "Forecast" : "ระบบ"}`).join(", ")}`);
  }

  // 3) GMV ของเรา + ROI
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV ของเรา และ ROI รายเดือน", { placeholder: "title" });
    text(s, "GMV ของเรา (ไม่รวมช่วงไลฟ์ของ Agency)", { x: M, y: 1.2, w: 8, h: 0.32, fontSize: 14, bold: true, color: C.text });
    shapeBars(pres, s, { labels, box: { x: M, y: 1.2, w: W - 2 * M, h: 2.75 }, showValue: true, hatched, legend: false, series: [{ name: "GMV", color: C.pink, values: ms.map((m) => m.gmv ?? 0) }] });
    text(s, "ROI (GMV ÷ ค่าจ้าง Mc)", { x: M, y: 4.05, w: 8, h: 0.32, fontSize: 14, bold: true, color: C.text });
    shapeBars(pres, s, {
      labels, box: { x: M, y: 4.05, w: W - 2 * M, h: 2.4 }, showValue: true, hatched, legend: false, format: (v) => (v ? `${v.toFixed(v >= 10 ? 0 : 1)} เท่า` : "0"),
      series: [{ name: "ROI", color: C.blue, values: ms.map((m) => roiOf(m.gmv, m.cost) ?? 0) }],
    });
    note(s, `${ROI_NOTE} · ทั้งปี ${roiText(roiOf(ytd.gmv, ytd.cost))}`);
  }

  // 4) ชั่วโมงไลฟ์ + ต้นทุนต่อชั่วโมง
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("ชั่วโมงไลฟ์ และต้นทุนต่อชั่วโมง", { placeholder: "title" });
    text(s, "ชั่วโมงไลฟ์ Mc ทีมเรา", { x: M, y: 1.2, w: 8, h: 0.32, fontSize: 14, bold: true, color: C.text });
    shapeBars(pres, s, {
      labels, box: { x: M, y: 1.2, w: W - 2 * M, h: 2.75 }, showValue: true, hatched, legend: false, format: (v) => `${Math.round(v)} ชม.`,
      series: [{ name: "ชั่วโมง", color: C.blue, values: ms.map((m) => m.hours) }],
    });
    text(s, "ต้นทุนต่อชั่วโมง (ค่าจ้าง Mc ÷ ชั่วโมงที่มีค่าจ้าง)", { x: M, y: 4.05, w: 8, h: 0.32, fontSize: 14, bold: true, color: C.text });
    shapeBars(pres, s, {
      labels, box: { x: M, y: 4.05, w: W - 2 * M, h: 2.4 }, showValue: true, hatched, legend: false,
      series: [{ name: "บาท/ชม.", color: C.pink, values: ms.map((m) => costPerHour(m) ?? 0) }],
    });
    note(s, `ทั้งปี ${hrsText(Math.round(ytd.hours))} · ${baht(costPerHour(ytd))}/ชม. · GMV ${baht(gmvPerHour(ytd))}/ชม.${systemMonths.length ? ` · ${SALARIED_NOTE}` : ""}`);
  }

  // 5) % เป้า GMV TikTok
  if (ms.some((m) => m.target)) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("% เป้า GMV ช่อง TikTok", { placeholder: "title" });
    shapeBars(pres, s, {
      labels, box: { x: M, y: 1.3, w: W - 2 * M, h: 3.6 }, showValue: true, hatched, legend: false, format: (v) => `${Math.round(v * 100)}%`,
      avg: { value: 1, label: "เป้า 100%" }, series: [{ name: "% เป้า", color: C.pink, values: ms.map((m) => achieveOf(m) ?? 0) }],
    });
    const head = (t: string) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.dark }, align: "right" as const } });
    const withT = ms.filter((m) => m.target);
    s.addTable([
      [{ text: "", options: { fill: { color: C.dark } } }, ...withT.map((m) => head(monShort(m.month))), head("รวม")],
      [{ text: "เป้า", options: { bold: true } }, ...withT.map((m) => ({ text: compact(m.target), options: { align: "right" as const } })), { text: compact(ytd.target), options: { align: "right" as const, bold: true } }],
      [{ text: "ทำได้", options: { bold: true } }, ...withT.map((m) => ({ text: compact(m.targetGmv), options: { align: "right" as const } })), { text: compact(ytd.targetGmv), options: { align: "right" as const, bold: true } }],
    ], {
      x: M, y: 5.05, w: W - 2 * M, fontSize: withT.length > 9 ? 10 : 12, fontFace: FONT, color: C.text, rowH: 0.3,
      border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.05, 0, 0.05],
    });
    note(s, "% เป้า = GMV ทั้งช่อง TikTok (รวมช่วงของ Agency) ของช่องที่ตั้งเป้า ÷ เป้ารวม · ตั้งเป้าที่ Analytics > ภาพรวม · แท่งลายทแยง = เดือนที่ยังไม่จบ");
  }

  // 6) ROI ราย Mc
  if (o.people?.people.length) {
    const list = peopleByRoi(o.people.people);
    const PER = 13;
    const head = (t: string, align: "left" | "right" = "right") => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.dark }, align } });
    for (let i = 0; i < list.length; i += PER) {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(`ROI ราย Mc · ${monText(o.people.month)}${o.people.open ? " (ยังไม่จบ)" : ""}${list.length > PER ? ` (${i / PER + 1}/${Math.ceil(list.length / PER)})` : ""}`, { placeholder: "title" });
      const rows: PptxGenJS.TableRow[] = [[head("อันดับ", "left"), head("Mc", "left"), head("คิว"), head("ชั่วโมง"), head("ค่าจ้าง"), head("GMV"), head("ROI"), head("GMV/ชม.")]];
      list.slice(i, i + PER).forEach((p, j) => {
        const rank = i + j + 1, roi = roiOf(p.gmv, p.cost);
        const color = rank <= 3 ? C.up : rank > list.length - 3 && list.length > 6 ? C.down : C.text;
        rows.push([
          { text: String(rank), options: { color } }, { text: p.mc, options: { bold: rank <= 3 } },
          { text: String(p.slots), options: { align: "right" } }, { text: hrsText(p.hours), options: { align: "right" } },
          { text: baht(p.cost), options: { align: "right" } }, { text: baht(p.gmv), options: { align: "right" } },
          { text: roiText(roi), options: { align: "right", bold: true, color } }, { text: baht(p.hours ? p.gmv / p.hours : null), options: { align: "right" } },
        ]);
      });
      s.addTable(rows, {
        x: M, y: 1.3, w: W - 2 * M, colW: [0.9, 2.6, 0.8, 1.3, 1.6, 1.8, 1.5, W - 2 * M - 10.5], fontSize: 12,
        fontFace: FONT, color: C.text, rowH: 0.33, border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
      });
      note(s, `ค่าจ้างจากระบบ (ต่อคิว) · GMV = ยอดที่กรอกใน slot / ประมาณจากไฟล์ Export · ไม่รวม Mc ประจำ ${o.people.salaried} คิว (ไม่มีค่าจ้างรายชั่วโมง)${o.people.unknown.slots ? ` · ยังไม่มียอด ${o.people.unknown.slots} คิว` : ""} · เขียว = 3 อันดับแรก / แดง = 3 อันดับท้าย`);
    }
  }

  // 7) สรุปรายเดือน
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`สรุปรายเดือน ปี ${o.year}`, { placeholder: "title" });
    const head = (t: string, align: "left" | "right" = "right") => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.dark }, align } });
    const line = (label: string, m: TiktokMcMonth, bold = false): PptxGenJS.TableRow => [
      { text: label, options: { bold } }, { text: baht(m.cost), options: { align: "right", bold } }, { text: baht(m.gmv), options: { align: "right", bold } },
      { text: roiText(roiOf(m.gmv, m.cost)), options: { align: "right", bold } }, { text: hrsText(Math.round(m.hours)), options: { align: "right", bold } },
      { text: baht(costPerHour(m)), options: { align: "right", bold } }, { text: baht(gmvPerHour(m)), options: { align: "right", bold } },
      { text: pctText(achieveOf(m)), options: { align: "right", bold } },
    ];
    s.addTable([
      [head("เดือน", "left"), head("ค่าจ้าง Mc"), head("GMV ของเรา"), head("ROI"), head("ชั่วโมง"), head("บาท/ชม."), head("GMV/ชม."), head("% เป้า")],
      ...ms.map((m) => line(`${monShort(m.month)}${m.open ? " *" : ""}`, m)),
      line("รวม", ytd, true),
    ], {
      x: M, y: 1.3, w: W - 2 * M, colW: [1.5, 1.8, 2.0, 1.4, 1.4, 1.3, 1.5, W - 2 * M - 10.9], fontSize: ms.length > 10 ? 11 : 12,
      fontFace: FONT, color: C.text, rowH: 0.32, border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
    });
    note(s, `* ยังไม่จบเดือน · ${ROI_NOTE}${systemMonths.length ? ` · ${SALARIED_NOTE}` : ""}`);
  }
  return finish(pres);
}

/** ตัวเลขย่อในตาราง: ฿15.0M / ฿931K */
function compact(v: number | null) {
  if (v === null) return "-";
  if (Math.abs(v) >= 1_000_000) return `฿${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `฿${Math.round(v / 1_000)}K`;
  return `฿${Math.round(v)}`;
}

/** ไฟล์ Excel / Google Sheet: รายเดือน + ราย Mc */
export function tiktokMcBook(o: Omit<TiktokMcDeckInput, "exportedAt">): ExportBook {
  const money = (v: number | null) => ({ v: v === null ? null : Math.round(v), f: "int" as const });
  const dec = (v: number | null) => ({ v: v === null ? null : Math.round(v * 100) / 100, f: "dec" as const });
  const pct = (v: number | null) => ({ v: v === null ? null : Math.round(v * 10000) / 10000, f: "pct" as const });
  const ytd = sumMonths(o.months);
  const row = (label: string, m: TiktokMcMonth, source: string) => [
    label, money(m.cost), money(m.gmv), dec(roiOf(m.gmv, m.cost)), dec(m.hours), dec(paidHours(m)), money(costPerHour(m)), money(gmvPerHour(m)),
    m.slots, money(m.target), money(m.targetGmv), pct(achieveOf(m)), source,
  ];
  return {
    title: `สรุป Mc TikTok ทีมเรา ปี ${o.year}`,
    sheets: [
      {
        name: "รายเดือน",
        rows: [
          ["เดือน", "ค่าจ้าง Mc ของเรา", "GMV ของเรา", "ROI (เท่า)", "ชั่วโมงไลฟ์", "ชั่วโมงที่มีค่าจ้าง", "ต้นทุนต่อชั่วโมง", "GMV ต่อชั่วโมง", "คิว", "เป้า GMV TikTok", "GMV ช่องที่ตั้งเป้า", "% เป้า", "ที่มาค่าจ้าง"],
          ...o.months.map((m) => row(monText(m.month) + (m.open ? " (ยังไม่จบ)" : ""), m, SOURCE_TEXT[m.source])),
          row("รวม", ytd, ""),
          [],
          [ROI_NOTE],
          [SALARIED_NOTE],
        ],
      },
      ...(o.people ? [{
        name: `ราย Mc ${monShort(o.people.month)}`,
        rows: [
          ["อันดับ ROI", "Mc", "คิว", "ชั่วโมง", "ค่าจ้าง", "GMV", "ROI (เท่า)", "GMV ต่อชั่วโมง", "ชั่วโมงที่ยอดเป็นค่าประมาณ"],
          ...peopleByRoi(o.people.people).map((p, i) => [
            i + 1, p.mc, p.slots, dec(p.hours), money(p.cost), money(p.gmv), dec(roiOf(p.gmv, p.cost)), money(p.hours ? p.gmv / p.hours : null), dec(p.estHours),
          ]),
          [],
          [`ไม่รวม Mc ประจำ ${o.people.salaried} คิว · ยังไม่มียอด ${o.people.unknown.slots} คิว`],
        ],
      }] : []),
    ],
  };
}
