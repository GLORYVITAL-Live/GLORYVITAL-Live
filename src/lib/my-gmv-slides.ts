// สไลด์ + ไฟล์ Excel "ยอดขายของฉัน" ของ Mc ประจำ (ตารางของฉัน > ยอดขายของฉัน) — ตัวเลขชุดเดียวกับหน้าเว็บ (src/lib/my-gmv.ts)
//   สไลด์: ปก · สรุปเดือน · GMV รายเดือน · GMV/ชม. รายเดือน · GMV รายวัน · ช่วงเวลา + วันแคมเปญ · Top 5 · รายการคิว
//   กราฟวาดด้วยรูปทรง (shapeBars) = PowerPoint และ Google Slides หน้าตาเดียวกัน

import type PptxGenJS from "pptxgenjs";
import type { ExportBook, ExportSheet } from "@/lib/export";
import { changeOf } from "@/lib/live-stats";
import { SLIDE_C as C, SLIDE_FONT as FONT, SLIDE_H as H, SLIDE_M as M, SLIDE_W as W, finish, newDeck, pctColor, pctText, shapeBars } from "@/lib/live-slides";
import {
  SOURCE_NOTE as sourceNote, SPLIT_NOTE as splitNote, baht, dayText, hrs, inMonth, monShort, monText, monthSeries, prevNote, rateOf, slotGmv, slotRate, slotTime,
  statusText, summary,
  type MyGmvData, type MyGmvSlot,
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
    text(s, "GLORY VITAL  ·  ยอดขายของฉัน", { x: M, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.pinkOnDark, charSpacing: 3 });
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
    const charts: [string, number[]][] = [
      ["GMV รายเดือน", months.map((m) => m.gmv)],
      ["GMV ต่อชั่วโมง รายเดือน", months.map((m) => rateOf(m) ?? 0)],
    ];
    for (const [title, values] of charts) {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(title, { placeholder: "title" });
      shapeBars(pres, s, { labels, box: { x: M, y: 1.4, w: W - 2 * M, h: 4.9 }, showValue: true, hatched, series: [{ name: d.name, color: C.pink, values }] });
      text(s, `แท่งลายทแยง = เดือนที่ยังไม่จบ · ${sourceNote}`, { x: M, y: 6.45, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
    }
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
  const head = (t: string, align: "left" | "right" = "left") => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.dark }, align } });
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
      x: M, y, w: W - 2 * M, colW: [1.9, 1.6, 1.9, 1.9, 1.9, 1.5, W - 2 * M - 10.7], fontSize: size,
      fontFace: FONT, color: C.text, rowH: size >= 14 ? 0.5 : 0.27, border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
    });
  };
  if (sum.top.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(`Top ${sum.top.length} คิวยอดสูงสุด`, { placeholder: "title" });
    table(s, sum.top, 1.5, 14, true);
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
      ["เดือน", "คิวที่นับยอด", "ชั่วโมงที่มียอด", "GMV", "GMV ต่อชั่วโมง", "ส่วนที่ประมาณจาก Export", "หมายเหตุ"],
      ...months.map((m) => [monText(m.month), m.slots, { v: m.hours, f: "dec" as const }, money(m.gmv), money(rateOf(m)), money(m.estimated), m.partial ? "ยังไม่จบเดือน" : ""]),
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
  return { title: `${d.name} ยอดขาย ${monText(month)}`, sheets: [monthly, slots, groups] };
}
