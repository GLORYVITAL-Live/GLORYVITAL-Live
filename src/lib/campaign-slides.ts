// สไลด์นำเสนอ: (1) ติดตามแคมเปญทีละรอบ + Mc × แคมเปญ (2) อันดับ Mc ของเดือน
//   สร้างในเบราว์เซอร์ด้วย pptxgenjs (ตาราง / รูปทรง / ข้อความล้วน ไม่ใช้กราฟของ PowerPoint จึงเหมือนกันทั้ง PowerPoint และ Google Slides)

import type PptxGenJS from "pptxgenjs";
import { BANDS, instLabel, windowText, type CampInstance, type CampaignReport } from "@/lib/campaign";
import type { Fit, McCampaign } from "@/lib/campaign-fit";
import { finish, newDeck, SLIDE_C as C, SLIDE_FONT as FONT, SLIDE_H as H, SLIDE_M as M, SLIDE_W as W } from "@/lib/live-slides";
import type { ExpectRow, McRank } from "@/lib/mc-rank";
import { MIN_RANK_HOURS } from "@/lib/mc-rank";

const GOOD_FILL = "E3F4EA", BAD_FILL = "FBE5E2", WARM_FILL = "FFF1D6", GREAT_FILL = "CDEBD8", GREY_FILL = "F3EDF0";

const money = (n: number) => Math.round(n).toLocaleString("th-TH");
const hrs = (n: number) => (Math.round(n * 10) / 10).toLocaleString("th-TH");
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const xText = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(2)} เท่า`);
const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

type Slide = PptxGenJS.Slide;
const text = (s: Slide, t: string | PptxGenJS.TextProps[], o: PptxGenJS.TextPropsOptions) => s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, ...o });
const head = (t: string, align: "left" | "right" | "center" = "right", fill = C.pink) => ({ text: t, options: { bold: true, color: C.white, fill: { color: fill }, align } });
const tableOpts = (colW: number[], extra: Partial<PptxGenJS.TableProps> = {}): PptxGenJS.TableProps => ({
  x: M, y: 1.4, w: colW.reduce((a, b) => a + b, 0), colW, fontSize: 12, fontFace: FONT, color: C.text, rowH: 0.37,
  border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08], ...extra,
});

/** ดัชนี (ยอดจริง ÷ ที่คาดหวัง) -> สีพื้น: ≥105% เขียว / < 95% แดง */
const idxFill = (v: number | null | undefined) => (v == null ? undefined : v >= 1.05 ? GOOD_FILL : v < 0.95 ? BAD_FILL : undefined);
const idxColor = (v: number | null | undefined) => (v == null ? C.muted : v >= 0.995 ? C.up : C.down);
const liftFill = (v: number | null | undefined) => (v == null ? undefined : v >= 2 ? GREAT_FILL : v >= 1.3 ? GOOD_FILL : v >= 1 ? WARM_FILL : BAD_FILL);
const FIT_FILL: Record<Fit, string> = { "เหมาะขึ้นแคมเปญ": GOOD_FILL, "ปกติ": GREY_FILL, "ควรทบทวน": BAD_FILL, "ข้อมูลน้อย": GREY_FILL, "ขัดกัน": WARM_FILL };
const FIT_COLOR: Record<Fit, string> = { "เหมาะขึ้นแคมเปญ": C.up, "ปกติ": C.muted, "ควรทบทวน": C.down, "ข้อมูลน้อย": C.muted, "ขัดกัน": "8A4413" };

/** หน้าปก (พื้นเข้ม) + การ์ดตัวเลขเด่นด้านขวา */
function cover(pres: PptxGenJS, o: { kicker: string; title: string; headline: string; lines: [string, string][]; foot: string; card: { label: string; big: string; lines: { text: string; color?: string }[] } }) {
  const s = pres.addSlide();
  s.background = { color: C.dark };
  text(s, o.kicker, { x: M, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.pinkOnDark, charSpacing: 3 });
  text(s, o.title, { x: M, y: 1.7, w: 7.6, h: 0.6, fontSize: 22, color: C.mutedOnDark });
  text(s, o.headline, { x: M, y: 2.3, w: 7.6, h: 1.4, fontSize: 40, bold: true, color: C.white, valign: "top", fit: "shrink" });
  text(s, o.lines.flatMap(([k, v], i) => [
    { text: `${k}  `, options: { color: C.mutedOnDark } },
    { text: v, options: { color: C.white, bold: true, breakLine: i < o.lines.length - 1 } },
  ]), { x: M, y: 4.1, w: 7.6, h: 1.1, fontSize: 15, valign: "top", paraSpaceAfter: 6, fit: "shrink" });
  text(s, o.foot, { x: M, y: H - 0.9, w: 8, h: 0.35, fontSize: 11, color: C.mutedOnDark });
  s.addShape(pres.ShapeType.roundRect, { x: 8.75, y: 1.7, w: 4.0, h: 3.6, fill: { color: "4A2236" }, line: { color: "4A2236" }, rectRadius: 0.15 });
  text(s, o.card.label, { x: 9.05, y: 1.95, w: 3.4, h: 0.4, fontSize: 16, color: C.mutedOnDark });
  text(s, o.card.big, { x: 9.05, y: 2.4, w: 3.4, h: 0.8, fontSize: 34, bold: true, color: C.white, fit: "shrink" });
  text(s, o.card.lines.map((l, i) => ({ text: l.text, options: { color: l.color ?? C.mutedOnDark, breakLine: i < o.card.lines.length - 1 } })),
    { x: 9.05, y: 3.35, w: 3.4, h: 1.8, fontSize: 15, valign: "top", paraSpaceAfter: 4, fit: "shrink" });
}

/** การ์ดข้อความ + หัวข้อ (ใช้กับหน้าข้อสังเกต / ข้อเสนอแนะ) */
function bulletCard(pres: PptxGenJS, s: Slide, o: { x: number; y: number; w: number; h: number; title: string; items: string[]; accent?: string }) {
  s.addShape(pres.ShapeType.roundRect, { x: o.x, y: o.y, w: o.w, h: o.h, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
  text(s, o.title, { x: o.x + 0.3, y: o.y + 0.22, w: o.w - 0.6, h: 0.45, fontSize: 18, bold: true, color: o.accent ?? C.text });
  text(s, o.items.length ? o.items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < o.items.length - 1 } })) : "ยังไม่มีข้อมูลพอสรุป",
    { x: o.x + 0.3, y: o.y + 0.8, w: o.w - 0.6, h: o.h - 1.0, fontSize: 13, color: C.text, valign: "top", paraSpaceAfter: 8, fit: "shrink" });
}

// ---------- ข้อสังเกต / ข้อเสนอแนะอัตโนมัติ ----------

export function campaignInsights(r: CampaignReport, mcs: McCampaign[]) {
  const facts: string[] = [], actions: string[] = [];
  const done = r.instances.filter((i) => i.status !== "upcoming" && i.lift != null && i.hours >= 20);
  if (done.length) {
    const best = done.reduce((a, b) => (b.lift! > a.lift! ? b : a));
    const worst = done.reduce((a, b) => (b.lift! < a.lift! ? b : a));
    facts.push(`${instLabel(best)} ดันยอดสูงสุด ${xText(best.lift)} ของวันปกติ`);
    if (worst.key !== best.key) facts.push(`${instLabel(worst)} ดันยอดต่ำสุด ${xText(worst.lift)}`);
    const latest = [...done].sort((a, b) => b.start.localeCompare(a.start))[0];
    if (latest.prevLift && latest.lift) {
      const ch = latest.lift / latest.prevLift - 1;
      facts.push(`${instLabel(latest)}${latest.status === "live" ? " (ยังไม่จบ)" : ""} ${ch >= 0 ? "ดีกว่า" : "ต่ำกว่า"} ${latest.prevLabel} ${Math.abs(ch * 100).toFixed(0)}% (${xText(latest.lift)} เทียบ ${xText(latest.prevLift)})`);
    }
  }
  // ผลต่อช่อง: ถ่วงด้วยชั่วโมง
  const byPlatform = new Map<string, { w: number; h: number }>();
  for (const i of done) for (const p of i.platforms) {
    if (p.lift == null || p.hours < 8) continue;
    const x = byPlatform.get(p.platform) ?? { w: 0, h: 0 };
    x.w += p.lift * p.hours; x.h += p.hours;
    byPlatform.set(p.platform, x);
  }
  const plat = [...byPlatform].map(([p, x]) => ({ p, lift: x.w / x.h })).sort((a, b) => b.lift - a.lift);
  if (plat.length) {
    facts.push(`ช่องที่ได้ผลจากแคมเปญสูงสุด: ${plat[0].p} (เฉลี่ย ${xText(plat[0].lift)})`);
    actions.push(`จัด Mc กลุ่ม "เหมาะขึ้นแคมเปญ" ใน slot ของ ${plat[0].p} ก่อน เพราะช่องนี้ดันยอดได้มากที่สุด`);
    for (const x of plat.filter((y) => y.lift < 1)) {
      facts.push(`${x.p} ดันยอดเฉลี่ย ${xText(x.lift)} ต่ำกว่าวันปกติ แคมเปญแทบไม่ช่วยช่องนี้`);
      actions.push(`ทบทวนโปรโมชัน / การจัด slot ของ ${x.p} ช่วงแคมเปญ (ผลต่ำทุกรอบ ไม่ใช่ปัญหาของ Mc คนเดียว)`);
    }
  }
  const names = (f: Fit) => mcs.filter((m) => m.fit === f).sort((a, b) => (b.campaign.index ?? 0) - (a.campaign.index ?? 0)).map((m) => m.mc);
  const good = names("เหมาะขึ้นแคมเปญ"), review = names("ควรทบทวน"), conflict = names("ขัดกัน");
  if (good.length) facts.push(`เหมาะขึ้นแคมเปญ (ดัชนี ≥ 105% ไลฟ์ ≥ 20 ชม.): ${good.slice(0, 8).join(", ")}`);
  if (review.length) {
    facts.push(`ควรทบทวน (ดัชนี < 95% ไลฟ์ ≥ 20 ชม.): ${review.join(", ")}`);
    actions.push(`${review.slice(0, 4).join(", ")}: ลองจัดไลฟ์วันปกติหรือช่อง/ช่วงเวลาอื่น แล้วดูผลอีก 1–2 รอบก่อนสรุป`);
  }
  if (conflict.length) actions.push(`${conflict.join(", ")}: ยอดที่กรอกกับยอดประมาณชี้คนละทาง ต้องกรอกยอดเพิ่มก่อนตัดสิน`);
  const hE = r.cells.filter((c) => c.key).reduce((a, c) => a + c.hE, 0), hAll = r.cells.filter((c) => c.key).reduce((a, c) => a + c.hE + c.hX, 0);
  const next = r.instances.filter((i) => i.status === "upcoming" && i.big).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
  if (hAll && hE / hAll < 0.3) {
    actions.push(`ยอดที่กรอกใน slot มีเพียง ${Math.round((hE / hAll) * 100)}% ของชั่วโมงแคมเปญ ที่เหลือประมาณจากไฟล์ Export กรอกยอดทุก slot ในรอบถัดไป${next.length ? ` (${next.map((i) => `${i.label} ${windowText(i.start, i.end)}`).join(" · ")})` : ""} เพื่อให้ป้ายสรุปแม่นขึ้น`);
  }
  return { facts, actions };
}

// ---------- สไลด์ Campaign ----------

export type CampaignDeckInput = {
  rangeText: string; exportedAt: string;
  report: CampaignReport;
  mcs: McCampaign[];
  /** คอลัมน์ของตาราง Mc × แคมเปญ (รอบที่มียอด เรียงเก่า -> ใหม่) */
  cols: CampInstance[];
};

export async function buildCampaignDeck(o: CampaignDeckInput): Promise<Blob> {
  const { report: r, mcs } = o;
  const pres = await newDeck(`Campaign ${o.rangeText}`, `GLORY VITAL · ติดตามแคมเปญ ${o.rangeText}`);
  const withData = r.instances.filter((i) => i.status !== "upcoming" && i.hours > 0);
  const asc = [...withData].sort((a, b) => a.start.localeCompare(b.start));
  const top = withData.reduce<CampInstance | null>((b, i) => (i.lift != null && (b === null || i.lift > (b.lift ?? 0)) ? i : b), null);
  const totalGmv = withData.reduce((a, i) => a + i.gmv, 0), totalHours = withData.reduce((a, i) => a + i.hours, 0);
  const ins = campaignInsights(r, mcs);

  // 1) ปก
  cover(pres, {
    kicker: "GLORY VITAL  ·  CAMPAIGN ANALYTICS", title: "ติดตามแคมเปญรายรอบ", headline: o.rangeText,
    lines: [["แคมเปญที่มีข้อมูล", `${withData.length} รอบ`], ["Mc ที่ติดตาม", `${mcs.length} คน`]],
    foot: `GMV จากไฟล์ Export ใน slot ของ Mc  ·  ส่งออกเมื่อ ${o.exportedAt}`,
    card: top
      ? { label: "ดันยอดสูงสุด", big: xText(top.lift), lines: [{ text: instLabel(top), color: C.white }, { text: windowText(top.start, top.end) }, { text: `GMV ${"฿" + money(top.gmv)}` }] }
      : { label: "ดันยอดสูงสุด", big: "–", lines: [{ text: "ยังไม่มียอดจากไฟล์ Export" }] },
  });

  // 2) ตัวเลขหลัก
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("ตัวเลขหลัก", { placeholder: "title" });
    const cards: [string, string, string][] = [
      ["แคมเปญที่มีข้อมูล", `${withData.length} รอบ`, `${withData.filter((i) => i.big).length} รอบหลัก · ${withData.filter((i) => !i.big).length} รอบแยก`],
      ["GMV ใน slot ของ Mc", `฿${money(totalGmv)}`, `${hrs(totalHours)} ชม. ช่วงแคมเปญ`],
      ["GMV/ชม. เฉลี่ย", totalHours ? `฿${money(totalGmv / totalHours)}` : "–", r.normal.length ? `วันปกติ ${r.normal.map((n) => `${n.platform} ฿${money(n.rate ?? 0)}`).join(" · ")}` : ""],
      ["ดันยอดสูงสุด", top ? xText(top.lift) : "–", top ? instLabel(top) : ""],
    ];
    const gap = 0.3, cw = (W - 2 * M - gap) / 2, ch = 2.2;
    cards.forEach(([label, big, sub], i) => {
      const x = M + (i % 2) * (cw + gap), y = 1.5 + Math.floor(i / 2) * (ch + gap);
      s.addShape(pres.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: C.tint }, line: { color: C.tint }, rectRadius: 0.12 });
      text(s, label, { x: x + 0.3, y: y + 0.25, w: cw - 0.6, h: 0.4, fontSize: 14, color: C.muted });
      text(s, big, { x: x + 0.3, y: y + 0.7, w: cw - 0.6, h: 0.9, fontSize: big.length > 12 ? 30 : 40, bold: true, color: C.pink, fit: "shrink" });
      text(s, sub, { x: x + 0.3, y: y + 1.6, w: cw - 0.6, h: 0.45, fontSize: 12, color: C.muted, fit: "shrink" });
    });
  }

  // 3) ปฏิทินแคมเปญ (ตาราง)
  chunk([...withData].sort((a, b) => b.start.localeCompare(a.start)), 10).forEach((page, pi, pages) => {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(pages.length > 1 ? `ปฏิทินแคมเปญ (${pi + 1}/${pages.length})` : "ปฏิทินแคมเปญ", { placeholder: "title" });
    const rows: PptxGenJS.TableRow[] = [[head("แคมเปญ", "left"), head("ช่วงวัน", "left"), head("GMV"), head("GMV/ชม."), head("ดันยอด"), head("เทียบรอบก่อน")]];
    for (const i of page) {
      const ch = i.lift != null && i.prevLift ? i.lift / i.prevLift - 1 : null;
      rows.push([
        { text: `${instLabel(i)}${i.big ? "" : " (แยก)"}${i.status === "live" ? " · กำลังดำเนินอยู่" : ""}${i.tags.length ? ` + ${i.tags.join(", ")}` : ""}`, options: { align: "left", bold: true } },
        { text: windowText(i.start, i.end), options: { align: "left" } },
        { text: `฿${money(i.gmv)}`, options: { align: "right" } },
        { text: i.rate == null ? "–" : `฿${money(i.rate)}`, options: { align: "right" } },
        { text: xText(i.lift), options: { align: "right", bold: true, fill: liftFill(i.lift) ? { color: liftFill(i.lift)! } : undefined } },
        { text: ch == null ? "–" : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(1)}% vs ${i.prevLabel}`, options: { align: "right", color: ch == null ? C.muted : ch >= 0 ? C.up : C.down } },
      ]);
    }
    s.addTable(rows, tableOpts([3.9, 1.6, 1.7, 1.3, 1.3, 2.3], { fontSize: 11 }));
    text(s, "ดันยอด = GMV ÷ ยอดที่ slot เดียวกันควรได้ถ้าเป็นวันปกติ (ช่องและช่วงเวลาเดียวกัน) · GMV = ยอดจากไฟล์ Export ที่ตกใน slot ของ Mc · แคมเปญแยก = ไม่อยู่ในช่วงแคมเปญหลัก",
      { x: M, y: 6.45, w: W - 2 * M, h: 0.4, fontSize: 11, italic: true, color: C.muted, fit: "shrink" });
  });

  // 4) ดันยอดกี่เท่า (แท่งแนวนอน)
  if (asc.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("แคมเปญไหนดันยอดได้มากที่สุด", { placeholder: "title" });
    const list = asc.slice(-12);
    const max = Math.max(1.2, ...list.map((i) => i.lift ?? 0)) * 1.12;
    const labelW = 3.6, barX = M + labelW + 0.1, barW = 6.6, y0 = 1.65, rowH = Math.min(0.42, 4.5 / list.length);
    const xOf = (v: number) => barX + (v / max) * barW;
    s.addShape(pres.ShapeType.line, { x: xOf(1), y: y0 - 0.1, w: 0, h: rowH * list.length + 0.1, line: { color: C.muted, width: 1.25, dashType: "dash" } });
    text(s, "วันปกติ = 1 เท่า", { x: xOf(1) - 0.9, y: y0 - 0.38, w: 1.8, h: 0.25, fontSize: 11, color: C.muted, align: "center" });
    list.forEach((i, k) => {
      const y = y0 + k * rowH, lift = i.lift ?? 0;
      text(s, `${instLabel(i)}${i.status === "live" ? " *" : ""}  ${windowText(i.start, i.end)}`, { x: M, y, w: labelW, h: rowH, fontSize: 12, color: C.text, valign: "middle", fit: "shrink", bold: i === top });
      s.addShape(pres.ShapeType.rect, { x: barX, y: y + rowH * 0.18, w: Math.max(0.03, xOf(lift) - barX), h: rowH * 0.64, fill: { color: i.big ? C.pink : C.blue }, line: { color: i.big ? C.pink : C.blue } });
      text(s, i.lift == null ? "–" : `${lift.toFixed(2)} เท่า`, { x: xOf(lift) + 0.1, y, w: 1.4, h: rowH, fontSize: 12, bold: true, color: C.text, valign: "middle" });
    });
    text(s, "ชมพู = แคมเปญหลัก · ฟ้า = แคมเปญแยก · * = ยังไม่จบรอบ (ตัวเลขนับถึงปัจจุบัน)", { x: M, y: 6.45, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
  }

  // 5) แยกตามช่อง
  {
    const platforms = [...new Set(asc.flatMap((i) => i.platforms.map((p) => p.platform)))];
    if (asc.length && platforms.length) {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText("ดันยอดแยกตามช่อง (เท่าของวันปกติ)", { placeholder: "title" });
      const rows: PptxGenJS.TableRow[] = [[head("แคมเปญ", "left"), ...platforms.map((p) => head(p, "center"))]];
      for (const i of [...asc].reverse().slice(0, 12)) {
        rows.push([
          { text: `${instLabel(i)} (${windowText(i.start, i.end)})`, options: { align: "left", bold: true } },
          ...platforms.map((p) => {
            const row = i.platforms.find((x) => x.platform === p);
            const f = liftFill(row?.lift);
            return { text: row?.lift == null ? "–" : row.lift.toFixed(2), options: { align: "center" as const, bold: true, fill: f ? { color: f } : undefined } };
          }),
        ]);
      }
      const first = 4.2, rest = (W - 2 * M - first) / platforms.length;
      s.addTable(rows, tableOpts([first, ...platforms.map(() => rest)]));
      text(s, "สีเข้ม = ดันยอด ≥ 2 เท่า · เขียวอ่อน ≥ 1.3 · เหลือง 1.0–1.3 · แดง < 1 (ต่ำกว่าวันปกติ) · – = ไม่มียอดเทียบ", { x: M, y: 6.45, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
    }
  }

  // 6) Mc × แคมเปญ
  {
    const cols = o.cols.slice(-6);
    const list = mcs.filter((m) => m.campaign.hours >= 12).sort((a, b) => (b.campaign.index ?? 0) - (a.campaign.index ?? 0));
    chunk(list, 11).slice(0, 3).forEach((page, pi, pages) => {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(pages.length > 1 ? `Mc × แคมเปญ (${pi + 1}/${pages.length})` : "Mc × แคมเปญ", { placeholder: "title" });
      const rows: PptxGenJS.TableRow[] = [[head("Mc", "left", C.dark), ...cols.map((c) => head(instLabel(c), "center", C.dark)), head("รวม", "center", C.dark), head("วันปกติ", "center", C.dark), head("สรุป", "center", C.dark)]];
      for (const m of page) {
        rows.push([
          { text: m.mc, options: { align: "left", bold: true } },
          ...cols.map((c) => {
            const a = m.perKey.get(c.key);
            if (!a || a.ratio === null) return { text: "–", options: { align: "center" as const, color: C.muted } };
            const f = a.hours >= 4 ? idxFill(a.ratio) : undefined;
            return { text: `${pct(a.ratio)}${a.exact < 0.7 ? " ≈" : ""}`, options: { align: "center" as const, color: a.hours < 4 ? C.muted : idxColor(a.ratio), fill: f ? { color: f } : undefined } };
          }),
          { text: `${pct(m.campaign.index)} (${hrs(m.campaign.hours)} ชม.)`, options: { align: "center", bold: true, color: idxColor(m.campaign.index), fill: idxFill(m.campaign.index) ? { color: idxFill(m.campaign.index)! } : undefined } },
          { text: pct(m.normal.index), options: { align: "center", color: idxColor(m.normal.index) } },
          { text: `${m.campaign.exact < 0.3 && m.fit !== "ข้อมูลน้อย" ? "≈ " : ""}${m.fit}`, options: { align: "center", bold: true, color: FIT_COLOR[m.fit], fill: { color: FIT_FILL[m.fit] } } },
        ]);
      }
      const first = 1.7, tail = [1.75, 1.0, 1.75];
      const mid = (W - 2 * M - first - tail.reduce((a, b) => a + b, 0)) / Math.max(1, cols.length);
      s.addTable(rows, tableOpts([first, ...cols.map(() => mid), ...tail], { fontSize: 11 }));
      text(s, "ดัชนี = ยอดจริง ÷ ค่าที่คาดหวังของ slot (ช่อง · แคมเปญ · ช่วงเวลา) · เขียว ≥ 105% แดง < 95% · ≈ = ประมาณจากไฟล์ Export (ยอดที่กรอกใน slot น้อยกว่า 70% ของชั่วโมง) · แสดงเฉพาะ Mc ที่ไลฟ์แคมเปญ ≥ 12 ชม.",
        { x: M, y: 6.45, w: W - 2 * M, h: 0.4, fontSize: 11, italic: true, color: C.muted, fit: "shrink" });
    });
  }

  // 7) ใครเหมาะขึ้นแคมเปญ
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("ใครเหมาะขึ้นแคมเปญ", { placeholder: "title" });
    const groups: { fit: Fit; title: string; color: string; fill: string }[] = [
      { fit: "เหมาะขึ้นแคมเปญ", title: "เหมาะขึ้นแคมเปญ", color: C.up, fill: GOOD_FILL },
      { fit: "ควรทบทวน", title: "ควรทบทวน", color: C.down, fill: BAD_FILL },
      { fit: "ปกติ", title: "ปกติ", color: C.muted, fill: GREY_FILL },
    ];
    const gap = 0.3, cw = (W - 2 * M - 2 * gap) / 3;
    groups.forEach((g, i) => {
      const x = M + i * (cw + gap), list = mcs.filter((m) => m.fit === g.fit).sort((a, b) => (b.campaign.index ?? 0) - (a.campaign.index ?? 0));
      s.addShape(pres.ShapeType.roundRect, { x, y: 1.5, w: cw, h: 4.7, fill: { color: g.fill }, line: { color: g.fill }, rectRadius: 0.12 });
      text(s, `${g.title}  (${list.length})`, { x: x + 0.25, y: 1.7, w: cw - 0.5, h: 0.45, fontSize: 18, bold: true, color: g.color });
      text(s, list.length ? list.slice(0, 9).map((m, k) => ({ text: `${m.mc}  ${pct(m.campaign.index)}  ·  ${hrs(m.campaign.hours)} ชม.${m.campaign.exact < 0.3 ? " ≈" : ""}`, options: { breakLine: k < Math.min(9, list.length) - 1 } })) : "ไม่มี",
        { x: x + 0.25, y: 2.3, w: cw - 0.5, h: 3.7, fontSize: 13, color: C.text, valign: "top", paraSpaceAfter: 6, fit: "shrink" });
    });
    const little = mcs.filter((m) => m.fit === "ข้อมูลน้อย" || m.fit === "ขัดกัน").length;
    text(s, `ข้อมูลน้อย / ขัดกัน ${little} คน (ไม่แสดง) · เกณฑ์: เหมาะ = ดัชนี ≥ 105% และไลฟ์แคมเปญ ≥ 20 ชม. · ควรทบทวน = < 95% และ ≥ 20 ชม. · ≈ = ส่วนใหญ่ประมาณจากไฟล์ Export`,
      { x: M, y: 6.4, w: W - 2 * M, h: 0.45, fontSize: 11, italic: true, color: C.muted, fit: "shrink" });
  }

  // 8) ข้อสังเกต + ข้อเสนอแนะ
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("ข้อสังเกตและข้อเสนอแนะ", { placeholder: "title" });
    const w = (W - 2 * M - 0.3) / 2;
    bulletCard(pres, s, { x: M, y: 1.45, w, h: 4.9, title: "ข้อสังเกต", items: ins.facts });
    bulletCard(pres, s, { x: M + w + 0.3, y: 1.45, w, h: 4.9, title: "ข้อเสนอแนะ", items: ins.actions, accent: C.pink });
  }

  // 9) วิธีคิด
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("วิธีคิดและข้อจำกัด", { placeholder: "title" });
    bulletCard(pres, s, {
      x: M, y: 1.45, w: W - 2 * M, h: 4.9, title: "อ่านตัวเลขอย่างไร",
      items: [
        "แคมเปญหลัก = Pay Day / วันเลขเบิ้ล / Prime Day / Mid Month · slot ที่ติดแท็กอื่น (เช่น CEO Live) แต่อยู่ในช่วงแคมเปญหลัก นับรวมเข้าแคมเปญหลักนั้น ไม่อยู่ในช่วงไหนจะ track แยก",
        "GMV แคมเปญ = ยอดจากไฟล์ Export ที่ตกใน slot ของ Mc (ไม่รวมช่วงที่ไม่มี Mc) · ดันยอด = GMV ÷ ยอดที่ slot เดียวกันควรได้ถ้าเป็นวันปกติ (ช่องและช่วงเวลาเดียวกัน)",
        "ดัชนีของ Mc = ยอดจริง ÷ ค่าที่คาดหวังของ slot (ช่อง · แคมเปญ · ช่วงเวลา เช้า/บ่าย/เย็น/ไพรม์/ดึก) ดึงเข้าหา 100% ตามชั่วโมงเพื่อลดผลของดวง · ใช้ยอดที่กรอกใน slot ก่อน ไม่มีใช้ยอดไลฟ์ที่แบ่งตามนาที (≈)",
        "ตัวเลข ≈ ไม่แยกว่า Mc คนไหนทำยอดในไลฟ์ที่ต่อกันหลายคน (ทุกคนในไลฟ์เดียวกันได้ยอดต่อชั่วโมงเท่ากัน) จึงใช้เป็นแนวโน้ม ตัดสินใจจริงควรดูยอดที่กรอกใน slot",
        "ยังไม่มีข้อมูลงบโฆษณาและสินค้าที่ขายในแต่ละ slot ผลจึงเป็นผลลัพธ์ GMV ไม่ใช่ฝีมือ Mc อย่างเดียว · ไฟล์ Export รายไลฟ์มีตั้งแต่ ส.ค. 2026",
      ],
    });
  }
  return finish(pres);
}

// ---------- สไลด์อันดับ Mc (ตามช่วงที่เลือก) ----------

export type RankDeckInput = {
  periodText: string; prevText: string; exportedAt: string;
  /** ช่วงยังไม่จบ (เดือนนี้): ข้อความสถานะ ว่าง = จบแล้ว */
  partialNote: string;
  /** สัดส่วนชั่วโมงที่มาจากยอดที่กรอกใน slot */
  exactShare: number;
  rows: McRank[]; moves: Map<string, number | null>; expect: ExpectRow[];
  excludeCeo: boolean;
};

const moveText = (m: number | null | undefined) => (m === undefined ? "" : m === null ? "ใหม่" : m > 0 ? `▲${m}` : m < 0 ? `▼${-m}` : "–");

export async function buildRankDeck(o: RankDeckInput): Promise<Blob> {
  const pres = await newDeck(`อันดับ Mc ${o.periodText}`, `GLORY VITAL · อันดับ Mc (GMV ต่อชม.) ${o.periodText}${o.partialNote ? " · ชั่วคราว" : ""}`);
  const rows = o.rows.filter((r) => r.hours > 0);
  const ranked = rows.filter((r) => r.ranked);
  const leader = ranked[0];
  const tierCount = (t: "A" | "B" | "C") => ranked.filter((r) => r.tier === t).length;

  cover(pres, {
    kicker: "GLORY VITAL  ·  MC PERFORMANCE", title: o.partialNote ? "อันดับ Mc (ชั่วคราว ยังไม่จบเดือน)" : "อันดับ Mc จาก GMV ต่อชั่วโมง", headline: o.periodText,
    lines: [
      ["Mc ที่จัดอันดับ", `${ranked.length} คน`], ["ระดับ A / B / C", `${tierCount("A")} / ${tierCount("B")} / ${tierCount("C")}`],
      ["ยอดที่กรอกจริง", `${Math.round(o.exactShare * 100)}% ของชั่วโมง (ที่เหลือประมาณจาก Export)`],
      ...(o.partialNote ? [["สถานะ", o.partialNote] as [string, string]] : []),
    ],
    foot: `เทียบค่าที่คาดหวังของ slot (ช่อง · แคมเปญ · ช่วงเวลา)${o.moves.size ? ` · ลูกศร = เทียบอันดับกับ${o.prevText}` : ""}  ·  ส่งออกเมื่อ ${o.exportedAt}`,
    card: leader && leader.score != null
      ? { label: "อันดับ 1", big: leader.name, lines: [{ text: `คะแนน ${pct(leader.score)}`, color: C.white }, { text: `ระดับ ${leader.tier} · ${hrs(leader.hours)} ชม.` }, { text: `ความมั่นใจ${leader.confidence}` }] }
      : { label: "อันดับ 1", big: "–", lines: [{ text: "ยังไม่มี Mc ที่มียอดพอจัดอันดับ" }] },
  });

  // ตารางอันดับ
  chunk(rows, 11).slice(0, 3).forEach((page, pi, pages) => {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText(pages.length > 1 ? `อันดับ Mc (${pi + 1}/${pages.length})` : "อันดับ Mc", { placeholder: "title" });
    const table: PptxGenJS.TableRow[] = [[head("#", "center"), head("Mc", "left"), head("ชม."), head("GMV/ชม."), head("แคมเปญ", "center"), head("วันปกติ", "center"), head("คะแนนรวม", "center"), head("ระดับ", "center"), head("มั่นใจ", "center")]];
    for (const r of page) {
      const f = r.score == null ? undefined : idxFill(r.score);
      table.push([
        { text: r.rank == null ? "–" : `${r.rank}  ${moveText(o.moves.get(r.name))}`, options: { align: "center", bold: true, color: r.ranked ? C.text : C.muted } },
        { text: `${r.name}${r.ranked ? "" : "  (ข้อมูลน้อย)"}${r.exact < 0.3 ? "  ≈" : ""}`, options: { align: "left", bold: true, color: r.ranked ? C.text : C.muted } },
        { text: hrs(r.hours), options: { align: "right" } },
        { text: `฿${money(r.perHour)}`, options: { align: "right" } },
        { text: pct(r.campaign?.index), options: { align: "center", color: idxColor(r.campaign?.index) } },
        { text: pct(r.normal?.index), options: { align: "center", color: idxColor(r.normal?.index) } },
        { text: pct(r.score), options: { align: "center", bold: true, color: idxColor(r.score), fill: f ? { color: f } : undefined } },
        { text: r.tier ?? "–", options: { align: "center", bold: true, color: r.tier === "A" ? C.up : r.tier === "C" ? C.down : C.muted } },
        { text: r.confidence, options: { align: "center", color: C.muted } },
      ]);
    }
    s.addTable(table, tableOpts([1.1, 2.5, 0.9, 1.4, 1.35, 1.35, 1.45, 0.95, 1.13], { fontSize: 11 }));
    text(s, `ดัชนี = ยอดจริง ÷ ค่าที่คาดหวังของ slot · คะแนนรวม = แคมเปญ 50% + วันปกติ 50% · ระดับ A ≥ 110% · B 95–110% · C < 95% · จัดอันดับเมื่อมียอด ≥ ${MIN_RANK_HOURS} ชม. ${o.moves.size ? ` · ▲▼ = เทียบ${o.prevText}` : ""} · ≈ = ประมาณจากไฟล์ Export${o.excludeCeo ? " · ไม่นับ slot ที่มี CEO" : ""}`,
      { x: M, y: 6.45, w: W - 2 * M, h: 0.4, fontSize: 11, italic: true, color: C.muted, fit: "shrink" });
  });

  // ระดับ A / B / C
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("ระดับของ Mc", { placeholder: "title" });
    const defs: { t: "A" | "B" | "C"; title: string; color: string; fill: string }[] = [
      { t: "A", title: "A · เหนือเกณฑ์ (≥ 110%)", color: C.up, fill: GOOD_FILL },
      { t: "B", title: "B · ใกล้เกณฑ์ (95–110%)", color: C.muted, fill: GREY_FILL },
      { t: "C", title: "C · ต่ำกว่าเกณฑ์ (< 95%)", color: C.down, fill: BAD_FILL },
    ];
    const gap = 0.3, cw = (W - 2 * M - 2 * gap) / 3;
    defs.forEach((d, i) => {
      const x = M + i * (cw + gap), list = ranked.filter((r) => r.tier === d.t);
      s.addShape(pres.ShapeType.roundRect, { x, y: 1.5, w: cw, h: 4.7, fill: { color: d.fill }, line: { color: d.fill }, rectRadius: 0.12 });
      text(s, `${d.title}  (${list.length})`, { x: x + 0.25, y: 1.7, w: cw - 0.5, h: 0.45, fontSize: 16, bold: true, color: d.color, fit: "shrink" });
      text(s, list.length ? list.slice(0, 10).map((r, k) => ({ text: `${r.name}  ${pct(r.score)}  ·  ${hrs(r.hours)} ชม.`, options: { breakLine: k < Math.min(10, list.length) - 1 } })) : "ไม่มี",
        { x: x + 0.25, y: 2.3, w: cw - 0.5, h: 3.7, fontSize: 13, color: C.text, valign: "top", paraSpaceAfter: 6, fit: "shrink" });
    });
    text(s, "ระดับเป็นเกณฑ์สัมบูรณ์ (100% = ได้เท่าที่ slot แบบเดียวกันเฉลี่ยทำได้) คะแนนที่ห่างกันไม่ถึง 5% ถือว่าอยู่ระดับเดียวกัน · Mc ที่ข้อมูลน้อยถูกดึงเข้าหา 100%",
      { x: M, y: 6.4, w: W - 2 * M, h: 0.45, fontSize: 11, italic: true, color: C.muted, fit: "shrink" });
  }

  // ค่าที่คาดหวัง
  if (o.expect.length) {
    chunk(o.expect, 12).slice(0, 2).forEach((page, pi, pages) => {
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(pages.length > 1 ? `ค่าที่คาดหวัง GMV/ชม. (${pi + 1}/${pages.length})` : "ค่าที่คาดหวัง GMV/ชม.", { placeholder: "title" });
      const table: PptxGenJS.TableRow[] = [[head("แคมเปญ", "left", C.dark), head("ช่อง", "left", C.dark), head("slot", "right", C.dark), ...BANDS.map((b) => head(b, "right", C.dark))]];
      for (const e of page) {
        table.push([
          { text: e.label, options: { align: "left", bold: true } },
          { text: e.platform, options: { align: "left" } },
          { text: String(e.slots), options: { align: "right" } },
          ...BANDS.map((b) => ({ text: e.rates[b] == null ? "–" : `฿${money(e.rates[b]!)}`, options: { align: "right" as const, color: e.rates[b] == null ? C.muted : C.text } })),
        ]);
      }
      s.addTable(table, tableOpts([2.4, 2.0, 0.9, 1.37, 1.37, 1.37, 1.37, 1.37]));
      text(s, "ค่าที่คาดหวัง = GMV/ชม. เฉลี่ยของ slot แบบเดียวกันจากทุกไลฟ์ในไฟล์ Export ย้อนหลังไม่เกิน 120 วัน · ช่วงเวลา: เช้า 07–11 · บ่าย 11–15 · เย็น 15–19 · ไพรม์ 19–23 · ดึก 23–07 · – = slot น้อยกว่า 6 ใช้กลุ่มกว้างกว่าแทน/เทียบไม่ได้",
        { x: M, y: 6.45, w: W - 2 * M, h: 0.4, fontSize: 11, italic: true, color: C.muted, fit: "shrink" });
    });
  }
  return finish(pres);
}
