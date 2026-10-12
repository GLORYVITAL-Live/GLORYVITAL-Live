// สไลด์ CEO Live หลายวัน -> PowerPoint (.pptx) / Google Slides (กราฟวาดด้วยรูปทรง ใช้ได้ทั้งสองแบบ)
//   ปก · GMV วัน CEO เทียบวันก่อน · GMV รอบ CEO · ตาราง 3 ส่วน (แบบชีตที่ทีมใช้) · สรุป

import type PptxGenJS from "pptxgenjs";
import { ceoBlocks, ceoSummary, fmtCell, scopeText, shortDay, shiftDay, type CeoDay, type CeoScope } from "@/lib/ceo-report";
import { fmtMetric, totalsOf } from "@/lib/live-stats";
import { SLIDE_C as C, SLIDE_FONT as FONT, SLIDE_H as H, SLIDE_M as M, SLIDE_W as W, finish, newDeck, pctColor, pctText, shapeBars } from "@/lib/live-slides";

/** target ไม่ได้ใช้แยก (กราฟวาดด้วยรูปทรงทั้งสองแบบ) รับไว้ให้ตรงกับ SlidesMenu */
export async function buildCeoDeck(o: { days: CeoDay[]; scope: CeoScope; rangeText: string; exportedAt: string }): Promise<Blob> {
  // ซ้ายไปขวา = เก่าไปใหม่ (แบบชีตที่ทีมใช้)
  const days = [...o.days].sort((a, b) => a.event.date.localeCompare(b.event.date));
  const where = scopeText(o.scope, days[0]?.event);
  const pres = await newDeck(`CEO Live ${o.rangeText}`, `GLORY VITAL · CEO Live ${o.rangeText} · ยอดทั้งวัน: ${where}`);
  const sum = ceoSummary(days);
  const text = (s: PptxGenJS.Slide, t: string | PptxGenJS.TextProps[], opts: PptxGenJS.TextPropsOptions) =>
    s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, ...opts });

  // 1) ปก
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    text(s, "GLORY VITAL  ·  CEO LIVE", { x: M, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.pinkOnDark, charSpacing: 3 });
    text(s, "ภาพรวม CEO Live", { x: M, y: 1.7, w: 7.6, h: 0.6, fontSize: 22, color: C.mutedOnDark });
    text(s, o.rangeText, { x: M, y: 2.3, w: 7.6, h: 1.4, fontSize: 40, bold: true, color: C.white, valign: "top", fit: "shrink" });
    text(s, [
      { text: "จำนวนครั้ง  ", options: { color: C.mutedOnDark } }, { text: `${days.length} ครั้ง`, options: { bold: true, color: C.white, breakLine: true } },
      { text: "ยอดทั้งวันนับ  ", options: { color: C.mutedOnDark } }, { text: where, options: { color: C.white } },
    ], { x: M, y: 4.1, w: 7.6, h: 1.0, fontSize: 15, valign: "top", paraSpaceAfter: 6, fit: "shrink" });
    text(s, `ส่งออกเมื่อ ${o.exportedAt}`, { x: M, y: H - 0.9, w: 8, h: 0.35, fontSize: 11, color: C.mutedOnDark });
    s.addShape(pres.ShapeType.roundRect, { x: 8.75, y: 1.7, w: 4.0, h: 3.6, fill: { color: "4A2236" }, line: { color: "4A2236" }, rectRadius: 0.15 });
    text(s, "GMV วัน CEO เทียบวันก่อน", { x: 9.05, y: 1.95, w: 3.4, h: 0.4, fontSize: 15, color: C.mutedOnDark });
    const up = sum.avgUplift;
    text(s, pctText(up), { x: 9.05, y: 2.4, w: 3.4, h: 0.7, fontSize: 30, bold: true, color: up === null ? C.white : up >= 0 ? "7EE0A8" : "FF9A90", fit: "shrink" });
    text(s, [
      { text: "รวมทุกครั้ง (ยอดรวมวัน CEO ÷ ยอดรวมวันก่อน)", options: { color: C.mutedOnDark, breakLine: true } },
      { text: "GMV รอบ CEO รวม  ", options: { color: C.mutedOnDark } }, { text: fmtMetric("baht", sum.sessionGmv), options: { bold: true, color: C.white } },
    ], { x: 9.05, y: 3.3, w: 3.4, h: 1.8, fontSize: 13, valign: "top", paraSpaceAfter: 8, fit: "shrink" });
  }

  const labels = days.map((d) => shortDay(d.event.date, false));
  // 2) GMV ทั้งวัน: วัน CEO เทียบวันก่อน (% เหนือคู่แท่ง)
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV ทั้งวัน: วัน CEO Live เทียบวันก่อน", { placeholder: "title" });
    shapeBars(pres, s, {
      labels, box: { x: M, y: 1.4, w: W - 2 * M, h: 4.9 }, showValue: days.length <= 12,
      series: [
        { name: "วัน CEO Live", color: C.pink, values: days.map((d) => totalsOf(d.day).gmv) },
        { name: "วันก่อน", color: C.blue, values: days.map((d) => totalsOf(d.before).gmv) },
      ],
    });
    text(s, `ยอดทั้งวัน (00:00–24:00) นับ ${where} · ไลฟ์นับตามเวลาเริ่มไลฟ์`, { x: M, y: 6.45, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
  }

  // 3) GMV รอบ CEO (ข้อมูลที่ track) + สัดส่วนต่อทั้งวัน
  const tracked = days.filter((d) => d.session?.gmv != null);
  if (tracked.length) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    s.addText("GMV รอบ CEO Live (ช่วงที่ CEO ไลฟ์)", { placeholder: "title" });
    shapeBars(pres, s, {
      labels: tracked.map((d) => shortDay(d.event.date)), box: { x: M, y: 1.4, w: 8.6, h: 4.9 }, showValue: true,
      series: [{ name: "รอบ CEO", color: C.pink, values: tracked.map((d) => d.session!.gmv ?? 0) }],
    });
    text(s, "สัดส่วนต่อ GMV ทั้งวัน", { x: 9.6, y: 1.5, w: 3.1, h: 0.45, fontSize: 18, bold: true, color: C.text });
    text(s, tracked.flatMap((d, i) => {
      const day = totalsOf(d.day).gmv;
      return [
        { text: `${shortDay(d.event.date)}  `, options: { bold: true } },
        { text: day ? `${((d.session!.gmv! / day) * 100).toFixed(1)}%` : "-", options: { color: C.pink, bold: true, breakLine: i < tracked.length - 1 } },
      ];
    }), { x: 9.6, y: 2.0, w: 3.15, h: 4.6, fontSize: 14, color: C.text, valign: "top", paraSpaceAfter: 6, fit: "shrink" });
  }

  // 4) ตาราง 3 ส่วน (ไม่เกิน 7 วันต่อหน้า)
  const blocks = ceoBlocks(days, o.scope);
  const head = (t: string, align: "left" | "right" = "right") => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.dark }, align } });
  for (const b of blocks) {
    if (b.key === "session" && !tracked.length) continue;
    for (let i = 0; i < days.length; i += 7) {
      const idx = days.slice(i, i + 7).map((_, j) => i + j);
      const last = i + 7 >= days.length;
      const s = pres.addSlide({ masterName: "CONTENT" });
      s.addText(b.title.split(":")[0] + (days.length > 7 ? ` (${Math.floor(i / 7) + 1})` : ""), { placeholder: "title" });
      const rows: PptxGenJS.TableRow[] = [[
        head(b.key === "before" ? "วันก่อน" : "วัน CEO", "left"),
        ...idx.map((k) => head(shortDay(b.key === "before" ? shiftDay(days[k].event.date, -1) : days[k].event.date))),
        ...(last ? [head("เฉลี่ย")] : []),
      ]];
      for (const r of b.rows) {
        rows.push([
          { text: r.label, options: { align: "left", bold: true } },
          ...idx.map((k) => {
            const v = r.values[k];
            return { text: fmtCell(r.kind, v, r.delta), options: { align: "right" as const, color: r.delta && typeof v === "number" ? pctColor(v) : C.text, bold: !!r.delta } };
          }),
          ...(last ? [{ text: fmtCell(r.kind, r.avg, r.delta), options: { align: "right" as const, bold: true, fill: { color: C.tint } } }] : []),
        ]);
      }
      const cols = 1 + idx.length + (last ? 1 : 0);
      const first = 2.6, rest = (W - 2 * M - first) / (cols - 1);
      s.addTable(rows, {
        x: M, y: 1.35, w: W - 2 * M, colW: [first, ...Array(cols - 1).fill(rest)], fontSize: cols > 7 ? 11 : 13,
        fontFace: FONT, color: C.text, rowH: b.rows.length > 11 ? 0.34 : 0.38, border: { type: "solid", pt: 0.5, color: C.grid }, valign: "middle", margin: [0, 0.08, 0, 0.08],
      });
      text(s, b.title, { x: M, y: 6.55, w: W - 2 * M, h: 0.3, fontSize: 11, italic: true, color: C.muted });
    }
  }

  // 5) สรุป
  {
    const s = pres.addSlide();
    s.background = { color: C.dark };
    text(s, "สรุป", { x: M, y: 0.6, w: W - 2 * M, h: 0.8, fontSize: 30, bold: true, color: C.white });
    const lines = [
      sum.avgUplift === null ? "ยังไม่มีข้อมูลวันก่อนให้เทียบ" : `รวมทุกครั้ง GMV วัน CEO Live ${sum.avgUplift >= 0 ? "สูงกว่า" : "ต่ำกว่า"}วันก่อน ${Math.abs(sum.avgUplift * 100).toFixed(1)}%`,
      ...(sum.best ? [`เพิ่มมากสุด: ${shortDay(sum.best.d.event.date)} ${sum.best.d.event.label} (${pctText(sum.best.c)})`] : []),
      ...(sum.worst && sum.worst !== sum.best ? [`เพิ่มน้อยสุด: ${shortDay(sum.worst.d.event.date)} ${sum.worst.d.event.label} (${pctText(sum.worst.c)})`] : []),
      ...(tracked.length ? [`GMV รอบ CEO รวม ${fmtMetric("baht", sum.sessionGmv)} จาก ${tracked.length} ครั้งที่มีข้อมูล`] : ["ยังไม่มีข้อมูลรอบ CEO (อัปโหลดได้ที่หน้า CEO Live)"]),
    ];
    text(s, lines.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < lines.length - 1 } })),
      { x: M, y: 1.7, w: W - 2 * M, h: 4.6, fontSize: 18, color: C.white, valign: "top", paraSpaceAfter: 12, fit: "shrink" });
    text(s, `ยอดทั้งวันนับ ${where} · รอบ CEO = ข้อมูลที่ทีม track แยก`, { x: M, y: H - 0.9, w: W - 2 * M, h: 0.4, fontSize: 11, color: C.mutedOnDark });
  }
  return finish(pres);
}
