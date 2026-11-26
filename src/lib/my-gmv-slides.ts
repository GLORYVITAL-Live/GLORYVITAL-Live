// สไลด์ + ไฟล์ Excel "ยอดขายของฉัน" ของ Mc ประจำ (ตารางของฉัน > ยอดขายของฉัน) — ตัวเลขชุดเดียวกับหน้าเว็บ (src/lib/my-gmv.ts)
//   สไลด์: ปก · สรุปเดือน · GMV + ชั่วโมงไลฟ์ รายเดือน · GMV/ชม. รายเดือน · รวมรายไตรมาส · รวมรายปี · GMV รายวัน · ช่วงเวลา + วันแคมเปญ
//          · Top 5 ของเดือน · Top 5 รวมทุกเดือน · รายการคิว
//   กราฟวาดด้วยรูปทรง (shapeBars) = PowerPoint และ Google Slides หน้าตาเดียวกัน

import type PptxGenJS from "pptxgenjs";
import type { ExportBook, ExportSheet } from "@/lib/export";
import { changeOf } from "@/lib/live-stats";
import { SLIDE_C as C, SLIDE_FONT as FONT, SLIDE_H as H, SLIDE_M as M, SLIDE_W as W, finish, newDeck, pctColor, pctText, shapeBars } from "@/lib/live-slides";
import {
  SOURCE_NOTE as sourceNote, SPLIT_NOTE as splitNote, baht, dayText, hrs, inMonth, monShort, monText, monthSeries, prevNote, rateOf, slotGmv, slotRate, slotTime,
  quarterSeries, statusText, summary, topSlots, yearSeries,
  type MyGmvData, type MyGmvPeriod, type MyGmvSlot,
} from "@/lib/my-gmv";

export async function buildMyGmvDeck(d: MyGmvData, month: string, exportedAt: string): Promise<Blob> {
  const sum = summary(d, month);
  const base = sum.prevSame ?? sum.prev;
  const months = monthSeries(d, month).slice(-12);
  const pres = await newDeck(`${d.name} ยอดขาย ${monText(month)}`, `GLORY VITAL · ${d.name} · ยอดขาย ${monText(month)}`);
  const text = (s: PptxGenJS.Slide, t: string | PptxGenJS.TextProps[], opts: PptxGenJS.TextPropsOptions) =>
    s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, ...opts });
  const gmvC = changeOf(sum.cur.gmv, base.gmv || null);
  const rateC = changeOf(rateOf(sum.cur), rateOf(base));
  const note = prevNote(sum);

  // 1) ปก
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    text(s, "GLORY VITAL  ·  ยอดขาย Mc", { x: M, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.pinkOnDark, charSpacing: 3 });
    text(s, d.name, { x: M, y: 1.7, w: 7.6, h: 1.2, fontSize: 44, bold: true, color: C.white, fit: "shrink" });
    text(s, monText(month) + (sum.partial ? ` (ถึงวันที่ ${sum.uptoDay})` : ""), { x: M, y: 2.95, w: 7.6, h: 0.6, fontSize: 22, color: C.mutedOnDark });
    text(s, `ส่งออกเมื่อ ${exportedAt}`, { x: M, y: H - 0.9, w: 8, h: 0.35, fontSize: 11, color: C.mutedOnDark });
    s.addShape(pres.ShapeType.roundRect, { x: 8.75, y: 1.5, w: 4.0, h: 4.2, fill: { color: "4A2236" }, line: { color: "4A2236" }, rectRadius: 0.15 });
    text(s, "GMV", { x: 9.05, y: 1.75, w: 3.4, h: 0.4, fontSize: 15, color: C.mutedOnDark });
    text(s, baht(sum.cur.gmv), { x: 9.05, y: 2.15, w: 3.4, h: 0.75, fontSize: 32, bold: true, color: C.white, fit: "shrink" });
    text(s, [
      { text: pctText(gmvC), options: { bold: true, color: gmvC === null ? C.mutedOnDark : gmvC >= 0 ? "7EE0A8" : "FF9A90", breakLine: true } },
      { text: note, options: { color: C.mutedOnDark, fontSize: 11, breakLine: true } },
      { text: " ", options: { breakLine: true, fontSize: 6 } },
      { text: "GMV ต่อชั่วโมง  ", options: { color: C.mutedOnDark } }, { text: baht(rateOf(sum.cur)), options: { bold: true, color: C.white, breakLine: true } },
      { text: "ชั่วโมงที่มียอด  ", options: { color: C.mutedOnDark } }, { text: hrs(sum.cur.hours), options: { bold: true, color: C.white, breakLine: true } },
      { text: "คิวที่นับยอด  ", options: { color: C.mutedOnDark } }, { text: `${sum.cur.slots} คิว`, options: { bold: true, color: C.white } },
    ], { x: 9.05, y: 3.0, w: 3.4, h: 2.5, fontSize: 14, valign: "top", paraSpaceAfter: 4, fit: "shrink" });
  }

  // 2) สรุปเดือน: การ์ด 4 ใบ
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`สรุป ${monText(month)}`, { placeholder: "title" });
    const cards: { label: string; value: string; change: number | null; sub: string }[] = [
      { label: "GMV", value: baht(sum.cur.gmv), change: gmvC, sub: note },
      { label: "GMV ต่อชั่วโมง", value: baht(rateOf(sum.cur)), change: rateC, sub: note },
      { label: "ชั่วโมงที่มียอด", value: hrs(sum.cur.hours), change: changeOf(sum.cur.hours, base.hours || null), sub: `จากทั้งหมด ${hrs(sum.planned.hours)} ในเดือนนี้` },
      { label: "คิวที่นับยอด", value: `${sum.cur.slots} คิว`, change: changeOf(sum.cur.slots, base.slots || null), sub: sum.upcoming.slots ? `รอไลฟ์อีก ${sum.upcoming.slots} คิว` : "ไลฟ์ครบทุกคิวแล้ว" },
    ];
    const cw = (W - 2 * M - 3 * 0.3) / 4;
    cards.forEach((c, i) => {
      const x = M + i * (cw + 0.3);
      s.addShape(pres.ShapeType.roundRect, { x, y: 1.5, w: cw, h: 2.3, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
      text(s, c.label, { x: x + 0.25, y: 1.7, w: cw - 0.5, h: 0.35, fontSize: 14, color: C.muted });
      text(s, c.value, { x: x + 0.25, y: 2.1, w: cw - 0.5, h: 0.7, fontSize: 28, bold: true, color: C.text, fit: "shrink" });
      text(s, pctText(c.change), { x: x + 0.25, y: 2.85, w: cw - 0.5, h: 0.35, fontSize: 14, bold: true, color: pctColor(c.change) });
      text(s, c.sub, { x: x + 0.25, y: 3.25, w: cw - 0.5, h: 0.4, fontSize: 11, color: C.muted, fit: "shrink" });
    });
    const lines: string[] = [];
    if (sum.cur.estimated > 0) lines.push(`ยอดประมาณจากไฟล์ Export ${baht(sum.cur.estimated)} (${Math.round((sum.cur.estimated / (sum.cur.gmv || 1)) * 100)}% ของ GMV) — คิวที่ไม่ได้กรอกยอดใน slot`);
    if (sum.missing.length) lines.push(`ไลฟ์แล้วแต่ยังไม่มียอด ${sum.missing.length} คิว (ไม่ได้กรอก และยังไม่มีไฟล์ Export) ยังไม่รวมในตัวเลข`);
    if (sum.standby) lines.push(`คิวสแตนด์บาย ${sum.standby} คิว ไม่นับยอด`);
    const best = [...sum.bands].sort((a, b) => (rateOf(b) ?? 0) - (rateOf(a) ?? 0))[0];
    if (best && sum.bands.length > 1) lines.push(`ช่วงที่ขายดีที่สุดต่อชั่วโมง: ${best.label} ${baht(rateOf(best))}/ชม.`);
    if (sum.top[0]) lines.push(`คิวยอดสูงสุด: ${dayText(sum.top[0].date)} ${slotTime(sum.top[0])} ${baht(sum.top[0].gmv)} (${baht(sum.top[0].gmv! / (sum.top[0].gmvHours || 1))}/ชม.)`);
    text(s, lines.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < lines.length - 1 } })),
      { x: M, y: 4.2, w: W - 2 * M, h: 2.4, fontSize: 15, color: C.text, valign: "top", paraSpaceAfter: 8, fit: "shrink" });
  }

  // 3–4) รายเดือน (เดือนที่ยังไม่จบ = ลายทแยง)
  if (months.length > 1) {
    const labels = months.map((m) => monShort(m.month));
    const hatched = months.map((m) => m.partial);
    // GMV (บน) + ชั่วโมงไลฟ์แท่งซ้อน วันแคมเปญ / วันปกติ ตัวเลขบนแท่ง = ชั่วโมงรวม (ล่าง) · ผู้ใช้ขอ 2026-11-26
    {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText("GMV และชั่วโมงไลฟ์ รายเดือน", { placeholder: "title" });
      text(s, "GMV", { x: M, y: 1.2, w: 4, h: 0.32, fontSize: 14, bold: true, color: C.text });
      shapeBars(pres, s, {
        labels, box: { x: M, y: 1.2, w: W - 2 * M, h: 2.75 }, showValue: true, hatched, legend: false,
        series: [{ name: "GMV", color: C.pink, values: months.map((m) => m.gmv) }],
      });
      text(s, "ชั่วโมงไลฟ์ (ตัวเลขบนแท่ง = รวม)", { x: M, y: 4.05, w: 5, h: 0.32, fontSize: 14, bold: true, color: C.text });
      shapeBars(pres, s, {
        labels, box: { x: M, y: 4.05, w: W - 2 * M, h: 2.4 }, showValue: true, hatched, stacked: true,
        format: (v) => `${Math.round(v)} ชม.`,
        series: [
          { name: "วันแคมเปญ", color: C.pink, values: months.map((m) => m.live.campaign) },
          { name: "วันปกติ", color: C.blue, values: months.map((m) => m.live.normal) },
        ],
      });
      text(s, `แท่งลายทแยง = เดือนที่ยังไม่จบ · ชั่วโมงไลฟ์ = ทุกคิวที่ไลฟ์แล้ว (ไม่นับสแตนด์บาย / รอไลฟ์) · ${sourceNote}`,
        { x: M, y: 6.55, w: W - 2 * M, h: 0.3, fontSize: 10, italic: true, color: C.muted, fit: "shrink" });
    }
    {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText("GMV ต่อชั่วโมง รายเดือน", { placeholder: "title" });
      shapeBars(pres, s, {
        labels, box: { x: M, y: 1.4, w: W - 2 * M, h: 4.9 }, showValue: true, hatched,
        series: [{ name: d.name, color: C.pink, values: months.map((m) => rateOf(m) ?? 0) }],
      });
      text(s, `แท่งลายทแยง = เดือนที่ยังไม่จบ · ${sourceNote}`, { x: M, y: 6.45, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
    }
  }

  // รวมรายไตรมาส / รายปี (นับถึงเดือนที่เลือก · ช่วงที่ไม่ครบบอกเดือนที่นับ)
  const head = (t: string, align: "left" | "right" = "left") => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.dark }, align } });
  const chg = (c: number | null) => ({ text: c === null ? "–" : pctText(c), options: { align: "right" as const, bold: c !== null, color: pctColor(c) } });
  const periodRows = (list: MyGmvPeriod[]): PptxGenJS.TableRow[] => [
    [head("ช่วง"), head("คิว", "right"), head("ชั่วโมง", "right"), head("GMV", "right"), head("GMV/ชม.", "right"), head("GMV/ชม. เทียบช่วงก่อน", "right")],
    ...list.map((p) => [
      { text: p.label }, { text: String(p.slots), options: { align: "right" as const } }, { text: hrs(p.hours), options: { align: "right" as const } },
      { text: baht(p.gmv), options: { align: "right" as const, bold: true } }, { text: baht(rateOf(p)), options: { align: "right" as const } }, chg(p.rateChange),
    ]),
  ];
  const tableOpts = (y: number, rows: number): PptxGenJS.TableProps => ({
    x: M, y, w: W - 2 * M, colW: [4.0, 1.1, 1.5, 2.0, 1.7, W - 2 * M - 10.3], fontSize: rows > 5 ? 12 : 13,
    fontFace: FONT, color: C.text, rowH: 0.34, border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
  });
  const dataNote = `ยอดจับคู่กับคิวได้ตั้งแต่ ${monText(d.first)} · ${sourceNote}`;
  const periodNote = `ลายทแยง = ไตรมาสที่ยังไม่ครบ (วงเล็บ = เดือนที่นับ) · ${dataNote}`;
  const quarters = quarterSeries(d, month);
  if (quarters.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`รวมรายไตรมาส (นับถึง${monText(month)})`, { placeholder: "title" });
    shapeBars(pres, s, {
      labels: quarters.map((p) => `${p.key.slice(5)} ${p.key.slice(2, 4)}`), box: { x: M, y: 1.3, w: W - 2 * M, h: 3.0 }, showValue: true, legend: false,
      hatched: quarters.map((p) => p.partial || p.incomplete), series: [{ name: "GMV", color: C.pink, values: quarters.map((p) => p.gmv) }],
    });
    s.addTable(periodRows(quarters), tableOpts(4.45, quarters.length + 1));
    text(s, periodNote, { x: M, y: 6.6, w: W - 2 * M, h: 0.3, fontSize: 10, italic: true, color: C.muted, fit: "shrink" });
  }
  const years = yearSeries(d, month);
  const year = years[years.length - 1];
  if (year) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`รวมรายปี ${year.key}${year.partial || year.incomplete ? ` (${year.from === year.to ? monShort(year.from) : `${monShort(year.from)}–${monShort(year.to)}`})` : ""}`, { placeholder: "title" });
    const inYear = monthSeries(d, month).filter((m) => m.month.startsWith(year.key) && m.gmv > 0);
    const bestMonth = [...inYear].sort((a, b) => b.gmv - a.gmv)[0];
    const bestQ = quarters.filter((q) => q.key.startsWith(year.key) && q.hours > 0).sort((a, b) => (rateOf(b) ?? 0) - (rateOf(a) ?? 0))[0];
    const cards = [
      { label: "GMV รวม", value: baht(year.gmv), sub: `${year.months} เดือน · ${year.slots} คิว` },
      { label: "GMV ต่อชั่วโมง", value: baht(rateOf(year)), sub: year.rateChange === null ? "ปีก่อนไม่มีข้อมูลเทียบ" : `${pctText(year.rateChange)} เทียบปีก่อน` },
      { label: "ชั่วโมงที่มียอด", value: hrs(year.hours), sub: `เฉลี่ย ${hrs(Math.round((year.hours / (inYear.length || 1)) * 10) / 10)} ต่อเดือน` },
      { label: "เฉลี่ยต่อเดือน", value: baht(inYear.length ? year.gmv / inYear.length : null), sub: `จาก ${inYear.length} เดือนที่มียอด` },
    ];
    const cw = (W - 2 * M - 3 * 0.3) / 4;
    cards.forEach((c, i) => {
      const x = M + i * (cw + 0.3);
      s.addShape(pres.ShapeType.roundRect, { x, y: 1.4, w: cw, h: 1.9, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
      text(s, c.label, { x: x + 0.25, y: 1.6, w: cw - 0.5, h: 0.35, fontSize: 14, color: C.muted });
      text(s, c.value, { x: x + 0.25, y: 2.0, w: cw - 0.5, h: 0.7, fontSize: 28, bold: true, color: C.text, fit: "shrink" });
      text(s, c.sub, { x: x + 0.25, y: 2.75, w: cw - 0.5, h: 0.35, fontSize: 12, color: C.muted, fit: "shrink" });
    });
    if (years.length > 1) {
      s.addTable(periodRows(years), tableOpts(3.6, years.length + 1));
    } else {
      const lines = [
        bestMonth ? `เดือนที่ยอดสูงสุด: ${monText(bestMonth.month)} ${baht(bestMonth.gmv)} (${baht(rateOf(bestMonth))}/ชม.)` : "",
        bestQ ? `ไตรมาสที่ GMV ต่อชั่วโมงสูงสุด: ${bestQ.label} ${baht(rateOf(bestQ))}/ชม.` : "",
        year.incomplete ? `ปี ${year.key} นับตั้งแต่ ${monText(year.from)} (ก่อนหน้านั้นยอดยังจับคู่กับคิวไม่ได้)` : "",
        year.partial ? `ยังไม่จบปี: นับถึง${monText(year.to)}${year.to === d.today.slice(0, 7) ? ` (ถึงวันที่ ${Number(d.today.slice(8, 10))})` : ""}` : "",
      ].filter(Boolean);
      text(s, lines.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < lines.length - 1 } })),
        { x: M, y: 3.7, w: W - 2 * M, h: 2.6, fontSize: 15, color: C.text, valign: "top", paraSpaceAfter: 8, fit: "shrink" });
    }
    text(s, years.length > 1 ? `วงเล็บ = เดือนที่นับ (ปีที่ไม่ครบ) · ${dataNote}` : dataNote, { x: M, y: 6.6, w: W - 2 * M, h: 0.3, fontSize: 10, italic: true, color: C.muted, fit: "shrink" });
  }

  // 5) รายวันของเดือน
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`GMV รายวัน ${monText(month)}`, { placeholder: "title" });
    shapeBars(pres, s, {
      labels: sum.days.map((x) => String(Number(x.date.slice(8, 10)))), box: { x: M, y: 1.4, w: W - 2 * M, h: 4.9 }, showValue: false,
      series: [{ name: d.name, color: C.pink, values: sum.days.map((x) => x.gmv) }],
    });
    const liveDays = sum.days.filter((x) => x.gmv > 0);
    text(s, `ไลฟ์ที่มียอด ${liveDays.length} วัน · เฉลี่ย ${baht(liveDays.length ? sum.cur.gmv / liveDays.length : null)} ต่อวัน · ${sourceNote}`,
      { x: M, y: 6.2, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
    text(s, splitNote,
      { x: M, y: 6.45, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
  }

  // 6) ช่วงเวลา + วันแคมเปญ / วันปกติ (GMV ต่อชั่วโมง)
  if (sum.bands.length || sum.kinds.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("ขายดีช่วงไหน (GMV ต่อชั่วโมง)", { placeholder: "title" });
    const half = (W - 2 * M - 0.4) / 2;
    text(s, "ตามช่วงเวลาที่เริ่มไลฟ์", { x: M, y: 1.35, w: half, h: 0.35, fontSize: 15, bold: true, color: C.text });
    shapeBars(pres, s, {
      labels: sum.bands.map((b) => b.label), box: { x: M, y: 1.75, w: half, h: 3.6 }, showValue: true, legend: false,
      series: [{ name: "GMV/ชม.", color: C.pink, values: sum.bands.map((b) => rateOf(b) ?? 0) }],
    });
    text(s, "วันแคมเปญ / วันปกติ", { x: M + half + 0.4, y: 1.35, w: half, h: 0.35, fontSize: 15, bold: true, color: C.text });
    shapeBars(pres, s, {
      labels: sum.kinds.map((k) => k.label), box: { x: M + half + 0.4, y: 1.75, w: half, h: 3.6 }, showValue: true, legend: false,
      series: [{ name: "GMV/ชม.", color: C.blue, values: sum.kinds.map((k) => rateOf(k) ?? 0) }],
    });
    const row = (a: { label: string; gmv: number; hours: number }) => `${a.label} ${baht(a.gmv)} · ${hrs(a.hours)}`;
    text(s, [
      { text: sum.bands.map(row).join("   ·   "), options: { breakLine: true } },
      { text: sum.kinds.map(row).join("   ·   ") + (sum.campaigns.length ? `   (แคมเปญ: ${sum.campaigns.map((c) => c.label).join(", ")})` : "") },
    ], { x: M, y: 5.5, w: W - 2 * M, h: 0.75, fontSize: 12, color: C.muted, valign: "top", paraSpaceAfter: 4, fit: "shrink" });
    text(s, `ช่วงเวลา = เวลาเริ่มคิว · ${splitNote}`, { x: M, y: 6.45, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
  }

  // 7) Top 5 + 8) รายการคิว
  /** unitTime = เวลาเต็มของยอด (ยอดรวมหลายคิว = ตั้งแต่คิวแรก) ใช้กับ Top 5 · รายการคิว = เวลาของคิวนั้น */
  const table = (s: PptxGenJS.Slide, list: MyGmvSlot[], y: number, size: number, unitTime = false) => {
    const rows: PptxGenJS.TableRow[] = [[head("วัน"), head("เวลา"), head("ช่อง"), head("แคมเปญ"), head("GMV", "right"), head("GMV/ชม.", "right"), head("ที่มา")]];
    for (const x of list) {
      rows.push([
        { text: dayText(x.date) }, { text: unitTime ? slotTime(x) : `${x.start}–${x.end}` }, { text: x.platform },
        { text: x.campaign || "วันปกติ", options: { color: x.campaign ? C.pink : C.muted } },
        { text: slotGmv(x), options: { align: "right", bold: x.gmv !== null } }, { text: slotRate(x), options: { align: "right" } },
        { text: statusText(x), options: { color: C.muted } },
      ]);
    }
    s.addTable(rows, {
      x: M, y, w: W - 2 * M, colW: [1.9, 1.6, 1.7, 1.6, 1.9, 1.5, W - 2 * M - 10.2], fontSize: size,
      fontFace: FONT, color: C.text, rowH: size >= 14 ? 0.5 : 0.27, border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
    });
  };
  if (sum.top.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`Top ${sum.top.length} คิวยอดสูงสุด ${monText(month)}`, { placeholder: "title" });
    table(s, sum.top, 1.5, 14, true);
  }
  // Top 5 รวมทุกเดือน (ตั้งแต่เดือนแรกที่มีข้อมูล ถึงเดือนที่เลือก) · ผู้ใช้ขอ 2026-11-26
  const topAll = topSlots(d, month);
  if (topAll.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    const span = d.first === month ? monShort(month) : `${monShort(d.first)}–${monShort(month)}`;
    s.addText(`Top ${topAll.length} คิวยอดสูงสุด รวมทุกเดือน (${span})`, { placeholder: "title" });
    table(s, topAll, 1.5, 14, true);
    text(s, `ยอดที่กรอกรวมหลายคิว = นับเป็นคิวเดียว (เวลาเต็ม) · ${dataNote}`, { x: M, y: 6.45, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted, fit: "shrink" });
  }
  const all = inMonth(d.slots, month).filter((x) => x.status !== "upcoming");
  const PER = 18;
  for (let i = 0; i < all.length; i += PER) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`รายการคิว ${monText(month)}${all.length > PER ? ` (${i / PER + 1}/${Math.ceil(all.length / PER)})` : ""}`, { placeholder: "title" });
    table(s, all.slice(i, i + PER), 1.3, 11);
  }
  return finish(pres);
}

/** ไฟล์ Excel / Google Sheet: รายเดือน · รายคิวของเดือนที่เลือก · ช่วงเวลา / วันแคมเปญ */
export function myGmvBook(d: MyGmvData, month: string): ExportBook {
  const sum = summary(d, month);
  const months = monthSeries(d, month);
  const money = (v: number | null) => ({ v: v === null ? null : Math.round(v), f: "int" as const });
  const monthly: ExportSheet = {
    name: "รายเดือน",
    rows: [
      [
        "เดือน", "คิวที่นับยอด", "ชั่วโมงที่มียอด", "GMV", "GMV ต่อชั่วโมง", "ส่วนที่ประมาณจาก Export",
        "ชั่วโมงไลฟ์ วันแคมเปญ", "ชั่วโมงไลฟ์ วันปกติ", "ชั่วโมงไลฟ์ รวม", "หมายเหตุ",
      ],
      ...months.map((m) => [
        monText(m.month), m.slots, { v: m.hours, f: "dec" as const }, money(m.gmv), money(rateOf(m)), money(m.estimated),
        { v: m.live.campaign, f: "dec" as const }, { v: m.live.normal, f: "dec" as const }, { v: m.live.total, f: "dec" as const }, m.partial ? "ยังไม่จบเดือน" : "",
      ]),
    ],
  };
  const topAll: ExportSheet = {
    name: "Top 5 ทุกเดือน",
    rows: [
      ["อันดับ", "วันที่", "วัน", "เวลา", "ช่อง", "แคมเปญ", "GMV", "ชั่วโมง", "GMV ต่อชั่วโมง", "ที่มาของยอด"],
      ...topSlots(d, month).map((x, i) => [
        i + 1, x.date, dayText(x.date), slotTime(x), x.platform, x.campaign || "วันปกติ", money(x.gmv), { v: x.gmvHours, f: "dec" as const },
        money(x.gmv !== null && x.gmvHours > 0 ? x.gmv / x.gmvHours : null), statusText(x),
      ]),
    ],
  };
  const slots: ExportSheet = {
    name: `รายคิว ${monShort(month)}`,
    rows: [
      ["วันที่", "วัน", "เวลา", "ช่อง", "ช่วงเวลา", "แคมเปญ", "ชั่วโมง", "GMV", "ชั่วโมงที่ยอดนี้ครอบคลุม", "GMV ต่อชั่วโมง", "ที่มาของยอด"],
      ...inMonth(d.slots, month).map((x) => [
        x.date, dayText(x.date), `${x.start}–${x.end}`, x.platform, x.band, x.campaign || "วันปกติ", { v: x.hours, f: "dec" as const },
        money(x.gmv), x.gmv !== null ? { v: x.gmvHours, f: "dec" as const } : null, money(x.gmv !== null && x.gmvHours > 0 ? x.gmv / x.gmvHours : null),
        statusText(x),
      ]),
    ],
  };
  const groups: ExportSheet = {
    name: `ช่วงเวลา ${monShort(month)}`,
    rows: [
      ["กลุ่ม", "คิวที่นับยอด", "ชั่วโมงที่มียอด", "GMV", "GMV ต่อชั่วโมง"],
      ...[...sum.bands, ...sum.kinds, ...sum.campaigns.map((c) => ({ ...c, label: `แคมเปญ ${c.label}` }))]
        .map((a) => [a.label, a.slots, { v: a.hours, f: "dec" as const }, money(a.gmv), money(rateOf(a))]),
    ],
  };
  const pct = (c: number | null) => (c === null ? null : { v: Math.round(c * 10000) / 10000, f: "pct" as const });
  const periods: ExportSheet = {
    name: "ไตรมาส-ปี",
    rows: [
      ["ช่วง (นับถึงเดือนที่เลือก)", "เดือนที่นับ", "คิวที่นับยอด", "ชั่วโมงที่มียอด", "GMV", "GMV ต่อชั่วโมง", "GMV/ชม. เทียบช่วงก่อน", "GMV เทียบช่วงก่อน (เฉพาะช่วงที่ครบ)", "หมายเหตุ"],
      ...[...quarterSeries(d, month), ...yearSeries(d, month)].map((p) => [
        p.label, `${p.months}/${p.size}`, p.slots, { v: p.hours, f: "dec" as const }, money(p.gmv), money(rateOf(p)), pct(p.rateChange), pct(p.gmvChange),
        [p.incomplete ? `ข้อมูลเริ่ม ${monText(p.from)}` : "", p.partial ? "ยังไม่ครบช่วง" : ""].filter(Boolean).join(" · "),
      ]),
    ],
  };
  return { title: `${d.name} ยอดขาย ${monText(month)}`, sheets: [monthly, periods, topAll, slots, groups] };
}
