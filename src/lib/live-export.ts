// ข้อมูลส่งออกของหน้าสถิติไลฟ์ (ภาพรวมรายเดือน / ทั้งปี / เทียบช่วง / แคมเปญ) -> ExportBook
//   ทุกไฟล์มีแผ่น "ข้อมูล" (ช่วงเวลา ตัวกรอง นิยามตัวชี้วัด) ตัวเลขเป็นตัวเลขจริง คำนวณต่อใน Excel / Google Sheet ได้

import type { Cell, ExportBook, ExportSheet } from "@/lib/export";
import { accountsOf, bkkParts, changeOf, METRICS, totalsOf, type LiveSession, type Totals } from "@/lib/live-stats";

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

/** ข้อความตัวกรองที่ใช้อยู่ (แพลตฟอร์ม / บัญชี) */
function filterText(f: ExportFilter) {
  const acc = f.account ? accountsOf(f.sessions).find((a) => a.key === f.account) : null;
  return [f.platform || "ทุกแพลตฟอร์ม", acc ? `${acc.platform} · ${acc.name}` : "ทุกบัญชี"];
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
      ["CTR", "Product Clicks ÷ Product Impressions (TikTok)"],
      ["CO", "TikTok = ออเดอร์ ÷ Product Clicks · Shopee = ออเดอร์ ÷ Viewers (รวมสองแพลตฟอร์มไม่คำนวณ)"],
      ["หมายเหตุ", "ไลฟ์นับตามเวลาเริ่มไลฟ์ (เวลาไทย) · ค่าที่เป็นอัตราคำนวณจากยอดรวม"],
    ],
  };
}

/** รายการไลฟ์ทีละไลฟ์ */
function sessionSheet(name: string, list: LiveSession[]): ExportSheet {
  return {
    name,
    rows: [
      ["เริ่มไลฟ์ (เวลาไทย)", "แพลตฟอร์ม", "บัญชี", "ชื่อไลฟ์", "ชั่วโมง", "GMV", "ออเดอร์", "ชิ้นที่ขาย", "Viewers", "Views", "Product Impressions", "Product Clicks", "CTR", "CO"],
      ...list.map((s): Cell[] => {
        const coBase = s.platform === "TikTok" ? s.clicks : s.viewers;
        return [
          bkkStamp(s.startedAt), s.platform, s.accountName, s.title,
          { v: s.durationSec / 3600, f: "dec" }, { v: s.gmv, f: "money" }, s.orders, s.itemsSold, s.viewers, s.views, s.impressions, s.clicks,
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

/** เทียบ 2 ช่วงทีละกลุ่ม: ทุกตัวชี้วัด ช่วง A / ช่วง B / เปลี่ยน % */
function pairSheet(name: string, first: string, aName: string, bName: string, groups: { label: string; a: LiveSession[]; b: LiveSession[] }[]): ExportSheet {
  return {
    name,
    rows: [
      [first, ...METRICS.flatMap((m) => [`${m.label} ${aName}`, `${m.label} ${bName}`, `${m.label} เปลี่ยน`])],
      ...groups.map((g): Cell[] => {
        const ta = totalsOf(g.a), tb = totalsOf(g.b);
        return [g.label, ...METRICS.flatMap((m) => {
          const va = ta.lives ? m.value(ta) : null, vb = tb.lives ? m.value(tb) : null;
          return [num(m.kind, va), num(m.kind, vb), pct(va, vb)];
        })];
      }),
    ],
  };
}

/** สรุปตัวชี้วัด: ช่วงหลัก + ช่วงเทียบแต่ละช่วง (ค่า + เปลี่ยน %) */
function summarySheet(name: string, curLabel: string, cur: Totals, compare: { label: string; totals: Totals }[]): ExportSheet {
  return {
    name,
    rows: [
      ["ตัวชี้วัด", curLabel, ...compare.flatMap((c) => [c.label, `เปลี่ยน vs ${c.label}`])],
      ...METRICS.map((m): Cell[] => {
        const v = cur.lives ? m.value(cur) : null;
        return [m.note ? `${m.label} (${m.note})` : m.label, num(m.kind, v), ...compare.flatMap((c) => {
          const p = c.totals.lives ? m.value(c.totals) : null;
          return [num(m.kind, p), pct(v, p)];
        })];
      }),
    ],
  };
}

// ---------- รายงานแต่ละแบบ ----------

/** ภาพรวมรายเดือน: เดือนนี้ vs เดือนก่อน (MoM) vs ปีก่อน (YoY) + 13 เดือน + แยกบัญชี + รายการไลฟ์ */
export function monthBook(o: {
  month: string; monthLabel: (k: string) => string; months13: string[]; byMonth: Map<string, LiveSession[]>; filter: ExportFilter;
}): ExportBook {
  const { month, monthLabel, months13, byMonth } = o;
  const prevKey = months13[11], yoyKey = months13[0];
  const t = (k: string) => totalsOf(byMonth.get(k) ?? []);
  return {
    title: `GLORY สถิติไลฟ์ ${monthLabel(month)}`,
    sheets: [
      infoSheet([["รายงาน", "ภาพรวมรายเดือน (MoM / YoY)"], ["เดือน", monthLabel(month)], ["MoM เทียบกับ", monthLabel(prevKey)], ["YoY เทียบกับ", monthLabel(yoyKey)]], o.filter),
      summarySheet("สรุป", monthLabel(month), t(month), [{ label: monthLabel(prevKey), totals: t(prevKey) }, { label: monthLabel(yoyKey), totals: t(yoyKey) }]),
      {
        name: "13 เดือน",
        rows: [
          ["เดือน", ...METRIC_HEADERS, "GMV MoM"],
          ...months13.map((k, i): Cell[] => [monthLabel(k), ...metricCells(t(k)), i ? pct(t(k).lives ? t(k).gmv : null, t(months13[i - 1]).lives ? t(months13[i - 1]).gmv : null) : null]),
        ],
      },
      accountSheet(byMonth.get(month) ?? [], byMonth.get(prevKey) ?? [], monthLabel(prevKey)),
      sessionSheet("ไลฟ์", byMonth.get(month) ?? []),
    ],
  };
}

/** ภาพรวมทั้งปี: สรุปปี + YoY / รายเดือนเทียบปีก่อน / รายไตรมาส / แยกบัญชี / รายการไลฟ์ */
export function yearBook(o: {
  year: number; rangeText: string; monthLabel: (k: string) => string; curKeys: string[]; prevKeys: string[];
  byMonth: Map<string, LiveSession[]>; curList: LiveSession[]; prevList: LiveSession[]; filter: ExportFilter;
}): ExportBook {
  const { year, curKeys, prevKeys, byMonth, monthLabel } = o;
  const t = (k: string) => totalsOf(byMonth.get(k) ?? []);
  const q = (keys: string[], n: number) => keys.slice(n * 3 - 3, n * 3).flatMap((k) => byMonth.get(k) ?? []);
  return {
    title: `GLORY สถิติไลฟ์ ปี ${year}`,
    sheets: [
      infoSheet([["รายงาน", "ภาพรวมทั้งปี (YoY / QoQ)"], ["ปี", `${year} (${o.rangeText})`], ["YoY เทียบกับ", `${year - 1} ช่วงเดียวกัน`]], o.filter),
      summarySheet("สรุปปี", `${year}`, totalsOf(o.curList), [{ label: `${year - 1}`, totals: totalsOf(o.prevList) }]),
      {
        name: "รายเดือน",
        rows: [
          ["เดือน", ...METRIC_HEADERS, `GMV ${year - 1}`, "GMV YoY", "GMV MoM"],
          ...curKeys.map((k, i): Cell[] => {
            const gmv = (key: string) => (t(key).lives ? t(key).gmv : null);
            return [monthLabel(k), ...metricCells(t(k)), num("baht", gmv(prevKeys[i])), pct(gmv(k), gmv(prevKeys[i])), pct(gmv(k), gmv(i ? curKeys[i - 1] : prevKeys[11]))];
          }),
        ],
      },
      pairSheet("รายไตรมาส", "ไตรมาส", `${year}`, `${year - 1}`, [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, a: q(curKeys, n), b: q(prevKeys, n) }))),
      accountSheet(o.curList, o.prevList, `${year - 1}`),
      sessionSheet("ไลฟ์", o.curList),
    ],
  };
}

/** เทียบ 2 ช่วง (เดือน / ไตรมาส / แคมเปญ): สรุป + แยกบัญชี + ตามเวลา + รายการไลฟ์ทั้งสองช่วง */
export function compareBook(o: {
  title: string; report: string; aName: string; bName: string; aRange: string; bRange: string;
  a: LiveSession[]; b: LiveSession[]; timeName: string; time: { label: string; a: LiveSession[]; b: LiveSession[] }[]; filter: ExportFilter;
}): ExportBook {
  const accounts = accountsOf([...o.a, ...o.b]);
  return {
    title: o.title,
    sheets: [
      infoSheet([["รายงาน", o.report], [`ช่วง ${o.aName}`, o.aRange], [`เทียบกับ ${o.bName}`, o.bRange]], o.filter),
      summarySheet("สรุปเทียบ", o.aName, totalsOf(o.a), [{ label: o.bName, totals: totalsOf(o.b) }]),
      pairSheet("แยกบัญชี", "บัญชี", o.aName, o.bName, [
        ...accounts.map((acc) => ({ label: `${acc.platform} · ${acc.name}`, a: o.a.filter((s) => keyOf(s) === acc.key), b: o.b.filter((s) => keyOf(s) === acc.key) })),
        { label: "รวม", a: o.a, b: o.b },
      ]),
      ...(o.time.length > 1 ? [pairSheet(o.timeName, o.timeName, o.aName, o.bName, o.time)] : []),
      sessionSheet(`ไลฟ์ ${o.aName}`, o.a),
      sessionSheet(`ไลฟ์ ${o.bName}`, o.b),
    ],
  };
}
