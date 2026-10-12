import { shortDay, type CeoDay } from "@/lib/ceo-report";
import type { Cell, ExportSheet, RowStyle } from "@/lib/export";
import { changeOf, fmtMetric, metricOf, totalsOf } from "@/lib/live-stats";
import type { CeoEvent } from "@/lib/types";

// แผนต่อยอด CEO Live (หน้าเว็บ / สไลด์ / ไฟล์ส่งออก) — คิดจากตัวเลขด้วยกฎตายตัว ไม่ใช่ AI
//   findings = สิ่งที่เห็นจากข้อมูล · actions = ข้อเสนอแนะครั้งถัดไป · targets = เป้าครั้งถัดไป (ขั้นต่ำ = เฉลี่ย / ท้าทาย = ดีที่สุด)

export type CeoTarget = { label: string; kind: "baht" | "pct"; avg: number | null; best: number | null; bestDay: string };
export type CeoInsights = { findings: string[]; actions: string[]; targets: CeoTarget[] };

/** รูปแบบ CEO Live จากชื่อแคมเปญ */
export function formatOf(label: string) {
  if (/kol/i.test(label)) return "CEO x KOL";
  if (/phone\s*in/i.test(label)) return "CEO Phone in";
  if (/birth/i.test(label)) return "CEO Birthday";
  if (/\d{1,2}\.\d{1,2}|pay\s*day|mid\s*month|marathon|npd|prime/i.test(label)) return "CEO ในวันแคมเปญ";
  return "CEO Live ปกติ";
}

const pct = (v: number | null) => (v === null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const baht = (v: number | null) => fmtMetric("baht", v);
const rate = (v: number | null) => fmtMetric("pct", v);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const day = (d: CeoDay) => `${shortDay(d.event.date)} (${d.event.label})`;

/** ค่าเฉลี่ย + ครั้งที่ดีที่สุดของค่าหนึ่ง (ไม่นับวันที่ไม่มีข้อมูล) · avg = ใช้ค่านี้แทนค่าเฉลี่ย (เช่น % ที่คิดจากยอดรวม) */
function target(label: string, kind: CeoTarget["kind"], days: CeoDay[], pick: (d: CeoDay) => number | null, avg?: number | null): CeoTarget {
  const vals = days.map((d) => ({ d, v: pick(d) })).filter((x): x is { d: CeoDay; v: number } => x.v !== null && Number.isFinite(x.v));
  const best = vals.reduce<{ d: CeoDay; v: number } | null>((b, x) => (!b || x.v > b.v ? x : b), null);
  const mean = vals.length ? sum(vals.map((x) => x.v)) / vals.length : null;
  return { label, kind, avg: avg !== undefined ? avg : mean, best: best?.v ?? null, bestDay: best ? shortDay(best.d.event.date) : "" };
}
/** เวลา Peak ที่ทีมจด เช่น "11.59/258" -> "11:59 น." (อ่านไม่ออก = ข้อความเดิม) */
const peakAt = (t: string) => {
  const m = t.match(/(\d{1,2})[.:](\d{2})/);
  return m ? `${m[1]}:${m[2]} น.` : t;
};

export function ceoInsights(input: CeoDay[], o: { next?: CeoEvent | null } = {}): CeoInsights {
  const days = [...input].sort((a, b) => a.event.date.localeCompare(b.event.date));
  const findings: string[] = [], actions: string[] = [];
  const gmvHr = metricOf("gmvPerHour");

  // 1) GMV ทั้งวันเทียบวันก่อน
  const both = days.filter((d) => d.day.length && d.before.length).map((d) => {
    const a = totalsOf(d.day), b = totalsOf(d.before);
    return { d, a, b, up: changeOf(a.gmv, b.gmv) };
  });
  const avgUp = both.length ? changeOf(sum(both.map((x) => x.a.gmv)), sum(both.map((x) => x.b.gmv))) : null;
  if (both.length) {
    const ups = both.filter((x) => (x.up ?? 0) > 0).length;
    findings.push(`วัน CEO Live มี GMV ทั้งวัน${(avgUp ?? 0) >= 0 ? "สูงกว่า" : "ต่ำกว่า"}วันก่อน ${pct(avgUp)} (ยอดรวม ${both.length} ครั้ง · สูงกว่าวันก่อน ${ups} จาก ${both.length} ครั้ง)`);
    const sorted = [...both].sort((x, y) => (y.up ?? -Infinity) - (x.up ?? -Infinity));
    if (sorted.length > 1) findings.push(`ได้ผลดีสุด ${day(sorted[0].d)} ${pct(sorted[0].up)} · น้อยสุด ${day(sorted.at(-1)!.d)} ${pct(sorted.at(-1)!.up)}`);
  }

  // 2) รูปแบบที่ได้ผลดีสุด (KOL / Phone in / วันแคมเปญ ...)
  const groups = new Map<string, typeof both>();
  for (const x of both) groups.set(formatOf(x.d.event.label), [...(groups.get(formatOf(x.d.event.label)) ?? []), x]);
  const byFormat = [...groups.entries()]
    .map(([name, list]) => ({ name, n: list.length, up: changeOf(sum(list.map((x) => x.a.gmv)), sum(list.map((x) => x.b.gmv))) }))
    .sort((x, y) => (y.up ?? -Infinity) - (x.up ?? -Infinity));
  if (byFormat.length > 1) {
    findings.push(`แยกตามรูปแบบ: ${byFormat.map((g) => `${g.name} ${pct(g.up)} (${g.n} ครั้ง)`).join(" · ")}`);
  }

  // 3) รอบ CEO (ข้อมูลที่ track): ยอดต่อชั่วโมงเทียบทั้งวัน / สัดส่วนต่อทั้งวัน
  const tracked = days.filter((d) => d.session && d.session.gmv !== null);
  const eff = tracked
    .map((d) => {
      const s = d.session!, all = totalsOf(d.day);
      const sHr = s.durationHr ? s.gmv! / s.durationHr : null, dHr = all.lives ? gmvHr.value(all) : null;
      return { d, ratio: sHr !== null && dHr ? sHr / dHr : null, share: all.gmv ? s.gmv! / all.gmv : null };
    });
  const ratios = eff.map((x) => x.ratio).filter((x): x is number => x !== null);
  const shares = eff.map((x) => x.share).filter((x): x is number => x !== null);
  const avgRatio = ratios.length ? sum(ratios) / ratios.length : null;
  const avgShare = shares.length ? sum(shares) / shares.length : null;
  if (avgRatio !== null) findings.push(`ช่วง CEO ทำ GMV ต่อชั่วโมงได้ ${avgRatio.toFixed(1)} เท่าของเฉลี่ยทั้งวัน (${ratios.length} ครั้งที่มีข้อมูลรอบ CEO)`);
  if (avgShare !== null) findings.push(`ยอดช่วง CEO คิดเป็น ${(avgShare * 100).toFixed(0)}% ของ GMV ทั้งวัน — อีก ${(100 - avgShare * 100).toFixed(0)}% มาจากไลฟ์ช่วงอื่นของวันเดียวกัน`);

  // 4) CTR / CO รอบ CEO: คลิกเยอะแต่ซื้อน้อย / ซื้อดีแต่คนเห็นน้อย (ต้องมีอย่างน้อย 3 ครั้ง)
  const rates = tracked.filter((d) => d.session!.ctr !== null && d.session!.co !== null);
  const clickNoBuy: CeoDay[] = [], buyFewSee: CeoDay[] = [];
  if (rates.length >= 3) {
    const mCtr = median(rates.map((d) => d.session!.ctr!))!, mCo = median(rates.map((d) => d.session!.co!))!;
    for (const d of rates) {
      if (d.session!.ctr! > mCtr && d.session!.co! < mCo) clickNoBuy.push(d);
      if (d.session!.co! > mCo && d.session!.ctr! < mCtr) buyFewSee.push(d);
    }
    const bestCo = [...rates].sort((x, y) => y.session!.co! - x.session!.co!)[0];
    findings.push(`รอบ CEO: CTR กลาง ${rate(mCtr)} · CO กลาง ${rate(mCo)} · CO ดีสุด ${day(bestCo)} ${rate(bestCo.session!.co)}`);
  }
  const peak = tracked.filter((d) => d.session!.peakViewers !== null).sort((x, y) => y.session!.peakViewers! - x.session!.peakViewers!)[0];
  if (peak) findings.push(`Peak Viewers สูงสุด ${fmtMetric("int", peak.session!.peakViewers)} คน ${day(peak)}${peak.session!.peakTime ? ` (จดเวลา Peak ${peakAt(peak.session!.peakTime)})` : ""}`);

  // ---------- ข้อเสนอแนะ ----------
  if (avgUp !== null && avgUp >= 0.2) {
    const first = days[0].event.date, last = days.at(-1)!.event.date;
    const months = (+last.slice(0, 4) - +first.slice(0, 4)) * 12 + (+last.slice(5, 7) - +first.slice(5, 7)) + 1;
    const perMonth = days.length / Math.max(1, months);
    actions.push(`จัด CEO Live ต่อเนื่อง ตอนนี้เฉลี่ย ${perMonth.toFixed(1)} ครั้ง/เดือน — โดยรวมยอดทั้งวันสูงกว่าวันก่อน ${pct(avgUp)} ลองเพิ่มความถี่ แล้วดูที่หน้านี้ว่ายังเพิ่มได้ใกล้เคียงเดิมไหม`);
  } else if (avgUp !== null && avgUp < 0.05) {
    actions.push("ยอดทั้งวันยังไม่ค่อยเพิ่มจากวันก่อน — ทบทวนโปร / สินค้าที่ CEO นำเสนอ และการโปรโมตก่อนไลฟ์");
  }
  if (byFormat.length > 1 && byFormat[0].up !== null) {
    const top = byFormat[0], low = byFormat.at(-1)!;
    actions.push(`รูปแบบที่ได้ผลดีสุดคือ "${top.name}" (${pct(top.up)}) — ${top.n < 2 ? "มีข้อมูลครั้งเดียว ลองจัดซ้ำเพื่อยืนยันว่าได้ผลจริง" : "ครั้งถัดไปต่อยอดจากรูปแบบนี้ก่อน"}${low.n >= 2 && low.up !== null && low.up < (top.up ?? 0) ? ` · "${low.name}" ได้ผลน้อยสุด (${pct(low.up)}) ควรปรับโปร / สินค้าก่อนจัดซ้ำ` : ""}`);
  }
  if (avgRatio !== null && avgRatio >= 1.5) {
    const hrs = tracked.map((d) => d.session!.durationHr).filter((x): x is number => x !== null);
    const avgHrs = hrs.length ? sum(hrs) / hrs.length : null;
    actions.push(`ช่วง CEO ทำยอดต่อชั่วโมงสูงกว่าทั้งวัน ${avgRatio.toFixed(1)} เท่า — ลองยืดรอบ CEO${avgHrs ? ` (ตอนนี้เฉลี่ย ${avgHrs.toFixed(1)} ชม.)` : ""} หรือวาง Mc ที่ขายเก่งต่อจาก CEO ทันที เพื่อเก็บคนดูที่ยังค้างอยู่`);
  }
  if (avgShare !== null && avgShare < 0.3 && (avgUp ?? 0) > 0) {
    actions.push("ยอดส่วนใหญ่ของวันมาจากช่วงอื่น (ผลต่อเนื่องจาก CEO) — ให้ Mc รอบถัดไปพูดโปร / ตะกร้าเดียวกับที่ CEO แนะนำ และปักสินค้าตัวเด่นของ CEO ไว้ทั้งวัน");
  }
  if (clickNoBuy.length) {
    actions.push(`${clickNoBuy.map((d) => shortDay(d.event.date)).join(", ")}: คนคลิกเยอะแต่ซื้อน้อย — ทบทวนราคา / ของแถม / ตะกร้าคุ้มในรอบ CEO และเตรียม Q&A ตอบข้อสงสัยที่ทำให้ไม่กดซื้อ`);
  }
  if (buyFewSee.length) {
    actions.push(`${buyFewSee.map((d) => shortDay(d.event.date)).join(", ")}: คนเห็นแล้วซื้อดีแต่คลิกน้อย — เพิ่มการโปรโมตก่อนไลฟ์ (Teaser / แจ้งเตือนไลฟ์ / โฆษณา) เพื่อดัน Impressions และ CTR`);
  }
  if (peak?.session!.peakTime) actions.push(`วางดีล / นาทีทองช่วงที่คนดูพีค (ครั้งที่คนดูมากสุดพีคราว ${peakAt(peak.session!.peakTime)}) และนับถอยหลังก่อนถึงช่วงนั้น`);
  const missing = days.filter((d) => !d.session);
  if (missing.length) {
    actions.push(`บันทึกข้อมูลรอบ CEO ให้ครบทุกครั้ง (ยังขาด ${missing.map((d) => shortDay(d.event.date)).join(", ")}) เพื่อให้เทียบรูปแบบได้แม่นขึ้น`);
  } else if (tracked.some((d) => d.session!.viewers === null || d.session!.peakViewers === null)) {
    actions.push("บันทึก Viewers / Peak Viewers / เวลา ของรอบ CEO ทุกครั้ง (บางครั้งยังว่าง)");
  }
  if (o.next) actions.push(`ครั้งถัดไป ${shortDay(o.next.date)} ${o.next.label}: ตั้งเป้าตามตาราง "เป้าครั้งถัดไป" และกลับมาดูผลเทียบที่หน้านี้หลังอัปโหลดข้อมูล`);

  // ---------- เป้าครั้งถัดไป ----------
  const targets: CeoTarget[] = [
    target("GMV ทั้งวัน", "baht", days, (d) => (d.day.length ? totalsOf(d.day).gmv : null)),
    // ขั้นต่ำ = % จากยอดรวมทุกครั้ง (ค่าเฉลี่ยของ % ถูกดึงขึ้นง่ายจากครั้งที่วันก่อนยอดต่ำมาก)
    target("GMV เทียบวันก่อน", "pct", days, (d) => (d.day.length && d.before.length ? changeOf(totalsOf(d.day).gmv, totalsOf(d.before).gmv) : null), avgUp),
    target("GMV รอบ CEO", "baht", days, (d) => d.session?.gmv ?? null),
    target("GMV / ชม. รอบ CEO", "baht", days, (d) => (d.session?.gmv != null && d.session.durationHr ? d.session.gmv / d.session.durationHr : null)),
    target("CTR รอบ CEO", "pct", days, (d) => d.session?.ctr ?? null),
    target("CO รอบ CEO", "pct", days, (d) => d.session?.co ?? null),
  ].filter((t) => t.avg !== null);

  return { findings, actions, targets };
}

/** ตัวเลขเป้าเป็นข้อความ (GMV = ฿ / อัตรา = %) — "GMV เทียบวันก่อน" แสดง +x% */
export const targetText = (t: CeoTarget, v: number | null) => (t.label.includes("เทียบ") ? pct(v) : t.kind === "baht" ? baht(v) : rate(v));

/** แผ่น "แผนต่อยอด" ในไฟล์ส่งออก (Excel / Google Sheet) */
export function planSheet(plan: CeoInsights): ExportSheet {
  const rows: Cell[][] = [["แผนต่อยอด CEO Live", ""]];
  const rowStyles: Record<number, RowStyle> = {};
  const section = (title: string) => { rows.push([]); rowStyles[rows.length] = { bg: "FDE8F0", bold: true, color: "3A1628" }; rows.push([title, ""]); };
  section("สิ่งที่เห็นจากข้อมูล");
  plan.findings.forEach((t) => rows.push(["•", t]));
  section("ข้อเสนอแนะครั้งถัดไป");
  plan.actions.forEach((t, i) => rows.push([`${i + 1}.`, t]));
  section("เป้าครั้งถัดไป");
  rows.push(["ตัวชี้วัด", "เป้าขั้นต่ำ (เฉลี่ย)", "เป้าท้าทาย (ดีที่สุด)", "ครั้งที่ดีที่สุด"]);
  const num = (t: CeoTarget, v: number | null): Cell => (v === null ? null : { v, f: t.kind === "baht" ? "money" : "pct" });
  plan.targets.forEach((t) => rows.push([t.label, num(t, t.avg), num(t, t.best), t.bestDay]));
  rows.push([], ["หมายเหตุ", "คิดอัตโนมัติจากตัวเลขด้วยกฎตายตัว (ไม่ใช่ AI) · เป้าขั้นต่ำ = ค่าเฉลี่ยของครั้งที่เลือก · GMV เทียบวันก่อน = ยอดรวมเทียบยอดรวม"]);
  return { name: "แผนต่อยอด", rows, rowStyles, header: 0, colWidths: [24, 90, 20, 16] };
}
