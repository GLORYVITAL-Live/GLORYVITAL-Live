// ข้อมูลส่งออกของหน้าสถิติไลฟ์ (ภาพรวมรายเดือน / ทั้งปี / เทียบช่วง / แคมเปญ) -> ExportBook
//   ทุกไฟล์มีแผ่น "ข้อมูล" (ช่วงเวลา ตัวกรอง นิยามตัวชี้วัด) ตัวเลขเป็นตัวเลขจริง คำนวณต่อใน Excel / Google Sheet ได้

import type { Cell, ExportBook, ExportSheet, RowStyle } from "@/lib/export";
import { accountLabel, accountsOf, bkkParts, changeOf, crewKey, METRICS, totalsOf, type LiveCrew, type LiveSession, type Totals } from "@/lib/live-stats";

type Kind = (typeof METRICS)[number]["kind"];

const num = (kind: Kind, v: number | null): Cell =>
  v === null || !Number.isFinite(v) ? null
    : { v, f: kind === "pct" ? "pct" : kind === "baht" ? "money" : kind === "hours" ? "dec" : "int" };
const metricCells = (t: Totals): Cell[] => METRICS.map((m) => (t.lives ? num(m.kind, m.value(t)) : null));
const pct = (cur: number | null, prev: number | null): Cell => {
  const c = changeOf(cur, prev);
  return c === null ? null : { v: c, f: "pct" };
};
const METRIC_HEADERS = METRICS.map((m) => m.label);
const pad = (n: number) => String(n).padStart(2, "0");
export const bkkStamp = (iso: string) => {
  const p = bkkParts(iso);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
};
const keyOf = (s: LiveSession) => `${s.platform}|${s.accountId}`;

export type ExportFilter = { platform: string; account: string; sessions: LiveSession[] };
/** ใครไลฟ์ / แคมเปญ ของแต่ละไลฟ์ (key = crewKey) null = โหลดไม่สำเร็จ / ไม่ระบุ = ไม่ใส่คอลัมน์ */
export type CrewMap = Record<string, LiveCrew> | null;

/** ข้อความตัวกรองที่ใช้อยู่ (แพลตฟอร์ม / บัญชี) */
export function filterText(f: ExportFilter) {
  const acc = f.account ? accountsOf(f.sessions).find((a) => a.key === f.account) : null;
  return [f.platform || "ทุกแพลตฟอร์ม", acc ? accountLabel(acc) : "ทุกบัญชี"];
}

/** แผ่น "ข้อมูล": รายงานอะไร ช่วงไหน กรองอะไร + นิยามตัวชี้วัด */
function infoSheet(lines: [string, string][], f: ExportFilter): ExportSheet {
  const [platform, account] = filterText(f);
  return {
    name: "ข้อมูล",
    rows: [
      ["หัวข้อ", "รายละเอียด"],
      ...lines,
      ["แพลตฟอร์ม", platform],
      ["บัญชี", account],
      ["ส่งออกเมื่อ", bkkStamp(new Date().toISOString())],
      [],
      ["นิยามตัวชี้วัด", ""],
      ["GMV", "TikTok = LIVE-attributed GMV · Shopee = ยอดขายคำสั่งซื้อที่ยืนยันแล้ว"],
      ["ออเดอร์", "TikTok = Orders Paid · Shopee = คำสั่งซื้อที่ยืนยันแล้ว"],
      ["Impressions / ชม.", "Product Impressions ÷ ชั่วโมงไลฟ์ (เฉพาะไลฟ์ TikTok · Shopee ไม่มี Impressions)"],
      ["CTR", "Product Clicks ÷ Product Impressions (TikTok)"],
      ["CO", "TikTok = ออเดอร์ ÷ Product Clicks · Shopee = ออเดอร์ ÷ Viewers (รวมสองแพลตฟอร์มไม่คำนวณ)"],
      ["หมายเหตุ", "ไลฟ์นับตามเวลาเริ่มไลฟ์ (เวลาไทย) · ค่าที่เป็นอัตราคำนวณจากยอดรวม"],
      ["Mc / Admin / Campaign (แผ่นไลฟ์)", "จับคู่ไลฟ์กับ slot ของช่องเดียวกันที่เวลาซ้อนกันอย่างน้อย 10 นาที · ไลฟ์ยาวหลาย slot = หลายชื่อพร้อมช่วงเวลา · ไลฟ์ที่นำเข้าจากชีตรายวันไม่มีเวลาเริ่มจริง จับคู่ไม่ได้"],
    ],
  };
}

/**
 * รายการไลฟ์ทีละไลฟ์ + ใครไลฟ์ (Mc / Admin) / Campaign / slot ที่ตรงกัน (จับคู่กับ slot ตามเวลา)
 *   crew = undefined: ไม่มีคอลัมน์คนไลฟ์ / null: โหลดไม่สำเร็จ (คอลัมน์ว่าง + หมายเหตุ)
 */
function sessionSheet(name: string, list: LiveSession[], crew?: CrewMap): ExportSheet {
  const withCrew = crew !== undefined;
  const crewCells = (s: LiveSession): Cell[] => {
    if (!withCrew) return [];
    const c = crew?.[crewKey(s)];
    return [c?.mc ?? "", c?.admin ?? "", c?.campaign ?? "", c?.slots ?? "", crew === null ? "โหลดข้อมูล slot ไม่สำเร็จ" : c?.note ?? "ไม่พบ slot"];
  };
  return {
    name,
    rows: [
      [
        "เริ่มไลฟ์ (เวลาไทย)", "แพลตฟอร์ม", "บัญชี", "ชื่อไลฟ์",
        ...(withCrew ? ["Mc", "Admin", "Campaign", "slot ที่ตรงกัน", "หมายเหตุ (จับคู่ slot)"] : []),
        "ชั่วโมง", "GMV", "ออเดอร์", "ชิ้นที่ขาย", "Viewers", "Views", "Product Impressions", "Impressions / ชม.", "Product Clicks", "CTR", "CO",
      ],
      ...list.map((s): Cell[] => {
        const coBase = s.platform === "TikTok" ? s.clicks : s.viewers;
        return [
          bkkStamp(s.startedAt), s.platform, s.accountName, s.title, ...crewCells(s),
          { v: s.durationSec / 3600, f: "dec" }, { v: s.gmv, f: "money" }, s.orders, s.itemsSold, s.viewers, s.views, s.impressions,
          s.impressions !== null && s.durationSec ? { v: s.impressions / (s.durationSec / 3600), f: "int" } : null, s.clicks,
          s.impressions ? { v: (s.clicks ?? 0) / s.impressions, f: "pct" } : null,
          coBase ? { v: s.orders / coBase, f: "pct" } : null,
        ];
      }),
    ],
  };
}

/** แยกตามบัญชี (ช่วงเดียว) + GMV เทียบช่วงก่อน */
function accountSheet(cur: LiveSession[], prev: LiveSession[], prevLabel: string): ExportSheet {
  const accounts = accountsOf([...cur, ...prev]);
  const row = (label: string, platform: string, a: LiveSession[], b: LiveSession[]): Cell[] => {
    const t = totalsOf(a), p = totalsOf(b);
    return [label, platform, ...metricCells(t), p.lives ? { v: p.gmv, f: "money" } : null, pct(t.lives ? t.gmv : null, p.lives ? p.gmv : null)];
  };
  return {
    name: "แยกบัญชี",
    rows: [
      ["บัญชี", "แพลตฟอร์ม", ...METRIC_HEADERS, `GMV ${prevLabel}`, `GMV เปลี่ยน`],
      ...accounts.map((a) => row(a.name, a.platform, cur.filter((s) => keyOf(s) === a.key), prev.filter((s) => keyOf(s) === a.key))),
      row("รวม", "", cur, prev),
    ],
  };
}

/**
 * เทียบ 2 ช่วงทีละกลุ่ม (วัน / ไตรมาส / บัญชี): หัวตาราง 2 ชั้น อ่านง่าย
 *   แถว 1 = ช่วงหลัก / ช่วงเทียบ คืออะไร · แถว 2 = ชื่อตัวชี้วัด (ระบายสีสลับทีละกลุ่ม) · แถว 3 = ช่วงหลัก | ช่วงเทียบ | เปลี่ยน
 *   (เดิมหัวคอลัมน์ยาว "GMV 19–22 ต.ค. 2026 (4 วัน)" ซ้ำทุกคอลัมน์ อ่านภาพรวมยาก)
 *   ตัวชี้วัดเรียงแบบตารางที่ทีมใช้ (GMV, ชั่วโมง, GMV/ชม., ออเดอร์, Viewers ...) · CTR / CO เปลี่ยนเป็น pp · ช่องเปลี่ยน: บวก = เขียว / ลบ = แดง
 *   total = แถว "รวม" ท้ายตาราง (ตัวหนา)
 */
function pairSheet(
  name: string, first: string, aName: string, bName: string, groups: { label: string; a: LiveSession[]; b: LiveSession[] }[],
  total?: { a: LiveSession[]; b: LiveSession[] },
): ExportSheet {
  const metrics = MULTI_ORDER.map((k) => METRICS.find((m) => m.key === k)!);
  const TINT = ["FDE8F0", "EEF1F6"];
  const rowStyles: Record<number, RowStyle> = {};
  const cellStyles: Record<string, RowStyle> = {};
  metrics.forEach((_, i) => {
    for (let j = 0; j < 3; j++) {
      const col = 1 + i * 3 + j;
      cellStyles[`1:${col}`] = { bg: TINT[i % 2], bold: true, align: j === 0 ? "left" : "center" };
      cellStyles[`2:${col}`] = { bg: TINT[i % 2], bold: true, align: "center" };
    }
  });
  cellStyles["1:0"] = { bg: "FFFFFF", bold: true };
  cellStyles["2:0"] = { bg: TINT[0], bold: true };
  const all = [...groups.map((g) => ({ ...g, total: false })), ...(total ? [{ label: "รวม", ...total, total: true }] : [])];
  const body = all.map((g, gi): Cell[] => {
    const ta = totalsOf(g.a), tb = totalsOf(g.b);
    const r = 3 + gi;
    if (g.total) rowStyles[r] = { bg: "FFF7E6", bold: true, border: true };
    return [g.label, ...metrics.flatMap((m, i) => {
      const va = ta.lives ? m.value(ta) : null, vb = tb.lives ? m.value(tb) : null;
      const d = deltaOf(m.kind, va, vb);
      if (d && Math.abs(d.value) >= (m.kind === "pct" ? 0.005 : 0.0005)) {
        cellStyles[`${r}:${1 + i * 3 + 2}`] = d.value > 0
          ? { bg: g.total ? "FFF7E6" : "EAF6EE", color: "1E7B3A", bold: g.total }
          : { bg: g.total ? "FFF7E6" : "FDECEC", color: "B42318", bold: g.total };
      }
      return [num(m.kind, va), num(m.kind, vb), m.kind === "pct" ? d?.text ?? null : d ? { v: d.value, f: "pct" as const } : null];
    })];
  });
  return {
    name,
    header: 2,
    rows: [
      [`ช่วงหลัก = ${aName}   ·   ช่วงเทียบ = ${bName}   ·   เปลี่ยน = ช่วงหลักเทียบช่วงเทียบ (CTR / CO เป็น pp)`],
      ["", ...metrics.flatMap((m) => [m.note && m.note.length <= 8 ? `${m.label} (${m.note})` : m.label, "", ""])],
      [first, ...metrics.flatMap(() => ["ช่วงหลัก", "ช่วงเทียบ", "เปลี่ยน"])],
      ...body,
    ],
    rowStyles,
    cellStyles,
    colWidths: [Math.min(36, Math.max(12, ...all.map((g) => g.label.length + 2), first.length + 2)), ...metrics.flatMap(() => [13, 13, 10])],
  };
}

/**
 * สรุปตัวชี้วัด: ช่วงหลัก + ช่วงเทียบแต่ละช่วง (ค่า + เปลี่ยน %)
 *   A1 = ชื่อแพลตฟอร์ม ("TikTok" / "Shopee" / "รวม") · หัวคอลัมน์เปลี่ยน = "VS" (เทียบช่วงเดียว) หรือ "VS ชื่อช่วง"
 *   ชื่อตัวชี้วัดไม่มีวงเล็บบอกแพลตฟอร์ม เช่น "Views (TikTok)" = "Views"
 */
function summarySheet(name: string, curLabel: string, cur: Totals, compare: { label: string; totals: Totals }[], title = "รวม"): ExportSheet {
  const vs = (label: string) => (compare.length > 1 ? `VS ${label}` : "VS");
  return {
    name,
    rows: [
      [title, curLabel, ...compare.flatMap((c) => [c.label, vs(c.label)])],
      ...METRICS.map((m): Cell[] => {
        const v = cur.lives ? m.value(cur) : null;
        // ไม่ใส่วงเล็บบอกแพลตฟอร์ม (นิยามเต็มอยู่ในแผ่น "ข้อมูล") เหลือแค่สูตร CTR เช่น "CTR (คลิก ÷ Impressions)" / "Views" / "CO"
        const note = m.key === "ctr" ? "คลิก ÷ Impressions" : "";
        return [note ? `${m.label} (${note})` : m.label, num(m.kind, v), ...compare.flatMap((c) => {
          const p = c.totals.lives ? m.value(c.totals) : null;
          return [num(m.kind, p), pct(v, p)];
        })];
      }),
    ],
  };
}

const PLATFORM_ORDER = ["TikTok", "Shopee"] as const;

/**
 * สรุปแยกแพลตฟอร์ม: แผ่น "TikTok" / "Shopee" (ตัวชี้วัดเดียวกับแผ่นสรุป เฉพาะไลฟ์ของแพลตฟอร์มนั้น)
 *   ทำเฉพาะแพลตฟอร์มที่มีไลฟ์ในช่วงใดช่วงหนึ่ง
 */
function platformSheets(curLabel: string, cur: LiveSession[], compare: { label: string; list: LiveSession[] }[]): ExportSheet[] {
  return PLATFORM_ORDER
    .filter((p) => [cur, ...compare.map((c) => c.list)].some((l) => l.some((s) => s.platform === p)))
    .map((p) => summarySheet(p, curLabel, totalsOf(cur.filter((s) => s.platform === p)),
      compare.map((c) => ({ label: c.label, totals: totalsOf(c.list.filter((s) => s.platform === p)) })), p));
}

// ---------- รายงานแต่ละแบบ ----------

/** ภาพรวมรายเดือน: เดือนนี้ vs เดือนก่อน (MoM) vs ปีก่อน (YoY) + 13 เดือน + แยกบัญชี + รายการไลฟ์ */
export function monthBook(o: {
  month: string; monthLabel: (k: string) => string; months13: string[]; byMonth: Map<string, LiveSession[]>; filter: ExportFilter;
  crew?: CrewMap;
}): ExportBook {
  const { month, monthLabel, months13, byMonth } = o;
  const prevKey = months13[11], yoyKey = months13[0];
  const t = (k: string) => totalsOf(byMonth.get(k) ?? []);
  return {
    title: `GLORY สถิติไลฟ์ ${monthLabel(month)}`,
    sheets: [
      infoSheet([["รายงาน", "ภาพรวมรายเดือน (MoM / YoY)"], ["เดือน", monthLabel(month)], ["MoM เทียบกับ", monthLabel(prevKey)], ["YoY เทียบกับ", monthLabel(yoyKey)]], o.filter),
      summarySheet("สรุป", monthLabel(month), t(month), [{ label: monthLabel(prevKey), totals: t(prevKey) }, { label: monthLabel(yoyKey), totals: t(yoyKey) }]),
      ...platformSheets(monthLabel(month), byMonth.get(month) ?? [], [
        { label: monthLabel(prevKey), list: byMonth.get(prevKey) ?? [] }, { label: monthLabel(yoyKey), list: byMonth.get(yoyKey) ?? [] },
      ]),
      {
        name: "13 เดือน",
        rows: [
          ["เดือน", ...METRIC_HEADERS, "GMV MoM"],
          ...months13.map((k, i): Cell[] => [monthLabel(k), ...metricCells(t(k)), i ? pct(t(k).lives ? t(k).gmv : null, t(months13[i - 1]).lives ? t(months13[i - 1]).gmv : null) : null]),
        ],
      },
      accountSheet(byMonth.get(month) ?? [], byMonth.get(prevKey) ?? [], monthLabel(prevKey)),
      sessionSheet("ไลฟ์", byMonth.get(month) ?? [], o.crew),
    ],
  };
}

/** ภาพรวมทั้งปี: สรุปปี + YoY / รายเดือนเทียบปีก่อน / รายไตรมาส / แยกบัญชี / รายการไลฟ์ */
export function yearBook(o: {
  aName: string; bName: string; rangeText: string; monthLabel: (k: string) => string; curKeys: string[]; prevKeys: string[];
  /** ไลฟ์รายเดือน (มีเดือนก่อนช่วงด้วย ใช้คิด MoM ของเดือนแรก) */
  byMonth: Map<string, LiveSession[]>; curList: LiveSession[]; prevList: LiveSession[];
  quarters: { label: string; a: LiveSession[]; b: LiveSession[] }[]; filter: ExportFilter;
  crew?: CrewMap;
}): ExportBook {
  const { aName, bName, curKeys, prevKeys, byMonth, monthLabel } = o;
  const t = (k: string) => totalsOf(byMonth.get(k) ?? []);
  const gmv = (key: string) => (t(key).lives ? t(key).gmv : null);
  const before = (k: string) => { const [y, m] = k.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
  return {
    title: `GLORY สถิติไลฟ์ ${aName}`,
    sheets: [
      infoSheet([["รายงาน", "ภาพรวม (YoY / QoQ / MoM)"], ["ช่วง", `${aName} (${o.rangeText})`], ["YoY เทียบกับ", `${bName} ช่วงเดียวกัน`]], o.filter),
      summarySheet("สรุป", aName, totalsOf(o.curList), [{ label: bName, totals: totalsOf(o.prevList) }]),
      {
        name: "รายเดือน",
        rows: [
          ["เดือน", ...METRIC_HEADERS, "GMV ปีก่อน", "GMV YoY", "GMV MoM"],
          ...curKeys.map((k, i): Cell[] => [monthLabel(k), ...metricCells(t(k)), num("baht", gmv(prevKeys[i])), pct(gmv(k), gmv(prevKeys[i])), pct(gmv(k), gmv(before(k)))]),
        ],
      },
      pairSheet("รายไตรมาส", "ไตรมาส", aName, bName, o.quarters, { a: o.curList, b: o.prevList }),
      accountSheet(o.curList, o.prevList, bName),
      sessionSheet("ไลฟ์", o.curList, o.crew),
    ],
  };
}

/** ลำดับตัวชี้วัดของตารางเทียบหลายเดือน (ตามตารางที่ทีมใช้: GMV, Duration, GMV/hr, Order, Viewer, View, Impressions, CTR, CO) */
export const MULTI_ORDER = ["gmv", "duration", "gmvPerHour", "orders", "viewers", "viewersPerHour", "views", "impressions", "impressionsPerHour", "ctr", "co", "lives"] as const;

/** ผลต่าง: อัตรา (CTR / CO) = pp / อื่น ๆ = % เช่น "+1.14pp" / "-12.7%" */
export function deltaOf(kind: Kind, a: number | null, b: number | null) {
  if (a === null || b === null) return null;
  if (kind === "pct") {
    const pp = (a - b) * 100;
    return { value: pp, text: `${pp >= 0 ? "+" : ""}${pp.toFixed(2)}pp` };
  }
  const c = changeOf(a, b);
  return c === null ? null : { value: c, text: `${c >= 0 ? "+" : ""}${(c * 100).toFixed(1)}%` };
}

/**
 * เทียบหลายเดือน: ค่าของทุกเดือน + เดือนหลัก vs เดือนอื่นทีละเดือน (เช่น ก.ย. vs ก.ค. / ก.ย. vs ส.ค.)
 *   อัตรา (CTR / CO) เทียบเป็น pp ค่าอื่นเป็น %
 */
export function multiBook(o: {
  rangeText: string; monthLabel: (k: string) => string; shortLabel: (k: string) => string;
  keys: string[]; focus: string; byMonth: Map<string, LiveSession[]>; filter: ExportFilter;
  crew?: CrewMap;
}): ExportBook {
  const { keys, byMonth, monthLabel, shortLabel, focus } = o;
  const list = (k: string) => byMonth.get(k) ?? [];
  const others = keys.filter((k) => k !== focus);
  const metrics = MULTI_ORDER.map((k) => METRICS.find((m) => m.key === k)!);
  const valueAt = (k: string, m: (typeof METRICS)[number], sel?: (s: LiveSession) => boolean) => {
    const t = totalsOf(sel ? list(k).filter(sel) : list(k));
    return t.lives ? m.value(t) : null;
  };
  const vsHeaders = others.map((k) => `${shortLabel(focus)} vs ${shortLabel(k)}`);
  const row = (label: string, m: (typeof METRICS)[number], sel?: (s: LiveSession) => boolean): Cell[] => [
    label,
    ...keys.map((k) => num(m.kind, valueAt(k, m, sel))),
    ...others.map((k) => {
      const d = deltaOf(m.kind, valueAt(focus, m, sel), valueAt(k, m, sel));
      return m.kind === "pct" ? d?.text ?? null : d ? { v: d.value, f: "pct" as const } : null;
    }),
  ];
  const gmv = METRICS.find((m) => m.key === "gmv")!;
  return {
    title: `GLORY สถิติไลฟ์ เทียบหลายเดือน ${o.rangeText}`,
    sheets: [
      infoSheet([["รายงาน", "เทียบหลายเดือน"], ["ช่วง", o.rangeText], ["เดือนหลัก", `${monthLabel(focus)} เทียบกับทุกเดือนที่เหลือ (CTR / CO เทียบเป็น pp)`]], o.filter),
      { name: "เทียบ", rows: [["Total", ...keys.map(shortLabel), ...vsHeaders], ...metrics.map((m) => row(m.label, m))] },
      ...PLATFORM_ORDER
        .filter((p) => keys.some((k) => list(k).some((s) => s.platform === p)))
        .map((p): ExportSheet => ({
          name: p,
          rows: [[p, ...keys.map(shortLabel), ...vsHeaders], ...metrics.map((m) => row(m.label, m, (s) => s.platform === p))],
        })),
      {
        name: "แยกบัญชี GMV",
        rows: [
          ["บัญชี", ...keys.map(shortLabel), ...vsHeaders],
          ...accountsOf(keys.flatMap(list)).map((a) => row(accountLabel(a), gmv, (s) => keyOf(s) === a.key)),
        ],
      },
      sessionSheet("ไลฟ์", keys.flatMap(list), o.crew),
    ],
  };
}

/** ช่วงเดียว ไม่เทียบ (เช่น ดูรายวัน): สรุป + แยกแพลตฟอร์ม + แยกบัญชี + ตามเวลา + รายการไลฟ์ */
export function singleBook(o: {
  title: string; report: string; aName: string; aRange: string; a: LiveSession[];
  timeName: string; time: { label: string; a: LiveSession[] }[]; filter: ExportFilter; crew?: CrewMap;
}): ExportBook {
  const groupSheet = (name: string, first: string, groups: { label: string; a: LiveSession[] }[]): ExportSheet => ({
    name,
    rows: [[first, ...METRIC_HEADERS], ...groups.map((g): Cell[] => [g.label, ...metricCells(totalsOf(g.a))])],
  });
  const accounts = accountsOf(o.a);
  return {
    title: o.title,
    sheets: [
      infoSheet([["รายงาน", o.report], [`ช่วง ${o.aName}`, o.aRange]], o.filter),
      summarySheet("สรุป", o.aName, totalsOf(o.a), []),
      ...platformSheets(o.aName, o.a, []),
      groupSheet("แยกบัญชี", "บัญชี", [
        ...accounts.map((acc) => ({ label: accountLabel(acc), a: o.a.filter((s) => keyOf(s) === acc.key) })),
        { label: "รวม", a: o.a },
      ]),
      ...(o.time.length > 1 ? [groupSheet(o.timeName, o.timeName, o.time)] : []),
      sessionSheet(`ไลฟ์ ${o.aName}`, o.a, o.crew),
    ],
  };
}

/** เทียบ 2 ช่วง (เดือน / ไตรมาส / แคมเปญ): สรุป + แยกบัญชี + ตามเวลา + รายการไลฟ์ทั้งสองช่วง */
export function compareBook(o: {
  title: string; report: string; aName: string; bName: string; aRange: string; bRange: string;
  a: LiveSession[]; b: LiveSession[]; timeName: string; time: { label: string; a: LiveSession[]; b: LiveSession[] }[]; filter: ExportFilter;
  crew?: CrewMap;
}): ExportBook {
  const accounts = accountsOf([...o.a, ...o.b]);
  return {
    title: o.title,
    sheets: [
      infoSheet([["รายงาน", o.report], [`ช่วง ${o.aName}`, o.aRange], [`เทียบกับ ${o.bName}`, o.bRange]], o.filter),
      summarySheet("สรุปเทียบ", o.aName, totalsOf(o.a), [{ label: o.bName, totals: totalsOf(o.b) }]),
      ...platformSheets(o.aName, o.a, [{ label: o.bName, list: o.b }]),
      pairSheet("แยกบัญชี", "บัญชี", o.aName, o.bName,
        accounts.map((acc) => ({ label: accountLabel(acc), a: o.a.filter((s) => keyOf(s) === acc.key), b: o.b.filter((s) => keyOf(s) === acc.key) })),
        { a: o.a, b: o.b }),
      ...(o.time.length > 1 ? [pairSheet(o.timeName, o.timeName, o.aName, o.bName, o.time, { a: o.a, b: o.b })] : []),
      sessionSheet(`ไลฟ์ ${o.aName}`, o.a, o.crew),
      sessionSheet(`ไลฟ์ ${o.bName}`, o.b, o.crew),
    ],
  };
}
