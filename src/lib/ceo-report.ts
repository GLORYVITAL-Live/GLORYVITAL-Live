import type { Cell, ExportBook, RowStyle } from "@/lib/export";
import { changeOf, fmtMetric, metricOf, totalsOf, type LiveSession, type MetricKey, type Totals } from "@/lib/live-stats";
import type { CeoEvent, CeoSession } from "@/lib/types";

// ภาพรวม CEO Live หลายวัน (หน้าเว็บ / ไฟล์ส่งออก / สไลด์ ใช้ตัวเลขชุดเดียวกัน) แบบตารางที่ทีม track:
//   ก่อน CEO Live (ทั้งวันของวันก่อน) | รอบ CEO Live (ข้อมูลที่ track แยก) | วัน CEO Live (ทั้งวัน)
//   ยอดทั้งวันคิดจากไฟล์ Export ตามขอบเขต: TikTok ทุกบัญชี / ช่องที่ CEO ไลฟ์ / ทุกบัญชี

export type CeoScope = "tiktok" | "ceo" | "all";
export const CEO_SCOPES: [CeoScope, string][] = [["tiktok", "TikTok ทุกบัญชี"], ["ceo", "ช่อง CEO"], ["all", "ทุกบัญชี"]];
export const scopeText = (scope: CeoScope, e?: CeoEvent) =>
  scope === "tiktok" ? "TikTok ทุกบัญชี" : scope === "all" ? "ทุกบัญชี (TikTok + Shopee)" : `ช่องที่ CEO ไลฟ์${e ? ` (${ceoChannel(e)})` : ""}`;

/** ชื่อช่องที่ CEO ไลฟ์ (จากชื่อช่องใน slot) */
export const ceoChannel = (e: CeoEvent) => [...new Set(e.times.map((t) => t.platform))].join(" + ") || "GLORY VITAL";
/** วันไลฟ์ตามเวลาไทย (นับตามเวลาเริ่มไลฟ์) */
export const bkkDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);
export const shiftDay = (d: string, by: number) => new Date(Date.parse(`${d}T00:00:00Z`) + by * 86400_000).toISOString().slice(0, 10);
const keyOf = (s: LiveSession) => `${s.platform}|${s.accountId}`;

const fmtShort = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", timeZone: "UTC" });
/** "9 ต.ค. 26" (year = false: "9 ต.ค." สำหรับป้ายกราฟ) */
export const shortDay = (d: string, year = true) => `${fmtShort.format(new Date(`${d}T12:00:00Z`))}${year ? ` ${d.slice(2, 4)}` : ""}`;

export function inScope(scope: CeoScope, e: CeoEvent) {
  return (s: LiveSession) => (scope === "all" ? true : scope === "tiktok" ? s.platform === "TikTok" : e.accounts.includes(keyOf(s)));
}

/** วัน CEO Live หนึ่งวัน: ไลฟ์ทั้งวัน / วันก่อน (ตามขอบเขต) + รอบ CEO ที่ track */
export type CeoDay = {
  event: CeoEvent;
  day: LiveSession[];
  before: LiveSession[];
  session: CeoSession | null;
};

export function ceoDays(events: CeoEvent[], sessions: LiveSession[], tracked: CeoSession[], scope: CeoScope): CeoDay[] {
  const byDay = new Map<string, LiveSession[]>();
  for (const s of sessions) byDay.set(bkkDay(s.startedAt), [...(byDay.get(bkkDay(s.startedAt)) ?? []), s]);
  const trackedBy = new Map(tracked.map((t) => [t.date, t]));
  return events.map((event) => {
    const sel = inScope(scope, event);
    return {
      event,
      day: (byDay.get(event.date) ?? []).filter(sel),
      before: (byDay.get(shiftDay(event.date, -1)) ?? []).filter(sel),
      session: trackedBy.get(event.date) ?? null,
    };
  });
}

type Kind = "baht" | "int" | "hours" | "pct" | "text";
export type CeoRow = { label: string; kind: Kind; values: (number | string | null)[]; avg: number | string | null; delta?: boolean };
export type CeoBlock = { key: "before" | "session" | "day"; title: string; rows: CeoRow[] };

/** ตัวชี้วัดของยอดทั้งวัน (ลำดับตามชีตที่ทีมใช้) */
const DAY_KEYS: MetricKey[] = ["gmv", "gmvPerHour", "duration", "orders", "viewers", "views", "impressions", "ctr", "co"];
const valueOf = (t: Totals, k: MetricKey) => (t.lives ? metricOf(k).value(t) : null);
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sumOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
const ratio = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : a / b);

/** ยอดทั้งวัน: ค่าของแต่ละวัน + เฉลี่ยต่อครั้ง (อัตรา = คิดจากยอดรวมทุกวัน) */
function dayRows(lists: LiveSession[][]): CeoRow[] {
  const totals = lists.map(totalsOf);
  const all = totalsOf(lists.flat());
  const n = lists.filter((l) => l.length).length;
  return DAY_KEYS.map((k) => {
    const m = metricOf(k);
    const values = totals.map((t) => valueOf(t, k));
    const isRate = k === "gmvPerHour" || k === "ctr" || k === "co";
    return { label: m.label, kind: m.kind, values, avg: isRate ? valueOf(all, k) : n ? (sumOf(values) ?? 0) / n : null };
  });
}

export function ceoBlocks(days: CeoDay[], scope: CeoScope): CeoBlock[] {
  const where = scopeText(scope, days[0]?.event);
  const s = days.map((d) => d.session);
  const pick = <K extends keyof CeoSession>(k: K) => s.map((x) => (x ? x[k] : null));
  const gmv = pick("gmv") as (number | null)[], hrs = pick("durationHr") as (number | null)[];
  const dayGmv = days.map((d) => (d.day.length ? totalsOf(d.day).gmv : null));
  const beforeGmv = days.map((d) => (d.before.length ? totalsOf(d.before).gmv : null));
  const num = (label: string, kind: Kind, values: (number | null)[], avg: number | null = mean(values)): CeoRow => ({ label, kind, values, avg });
  const text = (label: string, values: (string | null)[]): CeoRow => ({ label, kind: "text", values: values.map((v) => v || null), avg: null });
  return [
    { key: "before", title: `ก่อน CEO Live: ทั้งวันของวันก่อน · ${where}`, rows: dayRows(days.map((d) => d.before)) },
    {
      key: "session",
      title: "รอบ CEO Live: ช่วงที่ CEO ไลฟ์ (ข้อมูลที่ track แยก)",
      rows: [
        num("GMV", "baht", gmv),
        num("GMV / ชม.", "baht", s.map((x) => ratio(x?.gmv ?? null, x?.durationHr ?? null)), ratio(sumOf(gmv), sumOf(hrs))),
        num("ชั่วโมงไลฟ์", "hours", hrs),
        num("ออเดอร์", "int", pick("orders") as (number | null)[]),
        num("Viewers", "int", pick("viewers") as (number | null)[]),
        num("Views", "int", pick("views") as (number | null)[]),
        num("Peak Viewers", "int", pick("peakViewers") as (number | null)[]),
        text("เวลา Peak", pick("peakTime") as string[]),
        text("ช่วงเวลา", pick("timeRange") as string[]),
        num("Product Impressions", "int", pick("impressions") as (number | null)[]),
        num("CTR", "pct", pick("ctr") as (number | null)[]),
        num("CO", "pct", pick("co") as (number | null)[]),
        num(`GMV รอบ CEO ÷ ทั้งวัน`, "pct", gmv.map((g, i) => ratio(g, dayGmv[i])), ratio(sumOf(gmv.map((g, i) => (dayGmv[i] ? g : null))), sumOf(dayGmv.map((g, i) => (gmv[i] !== null ? g : null))))),
      ],
    },
    {
      key: "day",
      title: `วัน CEO Live: ทั้งวัน · ${where}`,
      rows: [
        ...dayRows(days.map((d) => d.day)),
        { label: "GMV เทียบวันก่อน", kind: "pct", values: dayGmv.map((g, i) => changeOf(g, beforeGmv[i])), avg: changeOf(sumOf(dayGmv), sumOf(beforeGmv)), delta: true },
      ],
    },
  ];
}

/** ตัวเลขในตาราง (หน้าเว็บ / สไลด์) */
export function fmtCell(kind: Kind, v: number | string | null, delta = false) {
  if (v === null || v === "") return "-";
  if (typeof v === "string") return v;
  if (delta) return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  return fmtMetric(kind === "text" ? "int" : kind, v);
}

const toCell = (r: CeoRow, v: number | string | null): Cell =>
  v === null ? null : typeof v === "string" ? v
    : { v, f: r.kind === "pct" ? "pct" : r.kind === "baht" ? "money" : r.kind === "hours" ? "dec" : "int" };

/** ไฟล์ส่งออก (Excel / Google Sheet): แผ่น "CEO Live" แบบตารางที่ทีมใช้ + แผ่น "ข้อมูล" */
export function ceoBook(days: CeoDay[], scope: CeoScope, o: { rangeText: string; exportedAt: string }): ExportBook {
  const blocks = ceoBlocks(days, scope);
  const rows: Cell[][] = [
    ["CEO Live", ...days.map((d) => shortDay(d.event.date)), "เฉลี่ยต่อครั้ง"],
    ["ชื่อ", ...days.map((d) => d.event.label), ""],
    ["เวลา CEO (slot)", ...days.map((d) => d.event.times.map((t) => `${t.platform} ${t.start}–${t.end}`).join(", ") || "-"), ""],
    ["วันก่อน", ...days.map((d) => shortDay(shiftDay(d.event.date, -1))), ""],
  ];
  const rowStyles: Record<number, RowStyle> = {};
  for (const b of blocks) {
    rows.push([]);
    rowStyles[rows.length] = { bg: "FDE8F0", bold: true, color: "3A1628" };
    rows.push([b.title]);
    for (const r of b.rows) rows.push([r.label, ...r.values.map((v) => toCell(r, v)), toCell(r, r.avg)]);
  }
  return {
    title: `GLORY CEO Live ${o.rangeText}`,
    sheets: [
      { name: "CEO Live", rows, rowStyles, header: 0 },
      {
        name: "ข้อมูล",
        rows: [
          ["หัวข้อ", "รายละเอียด"],
          ["รายงาน", "CEO Live: ก่อน CEO Live / รอบ CEO Live / วัน CEO Live"],
          ["ช่วง", o.rangeText],
          ["ยอดทั้งวันนับ", scopeText(scope)],
          ["ส่งออกเมื่อ", o.exportedAt],
          [],
          ["ก่อน CEO Live", "ไลฟ์ทั้งวัน (00:00–24:00) ของวันก่อนวัน CEO Live จากไฟล์ Export"],
          ["รอบ CEO Live", "ข้อมูลช่วงที่ CEO ไลฟ์ ที่ทีม track แยก (ไฟล์ Export แยกช่วงนี้ไม่ได้ เพราะอยู่ในไลฟ์ยาวไลฟ์เดียว)"],
          ["วัน CEO Live", "ไลฟ์ทั้งวันของวัน CEO Live จากไฟล์ Export · ไลฟ์นับตามเวลาเริ่มไลฟ์ (เวลาไทย)"],
          ["เฉลี่ยต่อครั้ง", "ค่าเฉลี่ยของวันที่มีข้อมูล · GMV / ชม. CTR CO คิดจากยอดรวมทุกวัน"],
          ["CTR / CO (ทั้งวัน)", "CTR = คลิก ÷ Impressions (TikTok) · CO TikTok = ออเดอร์ ÷ คลิก · รวมสองแพลตฟอร์มไม่คำนวณ CO"],
        ],
      },
    ],
  };
}

/** สรุปสั้นสำหรับปก / สไลด์สรุป */
export function ceoSummary(days: CeoDay[]) {
  const withData = days.filter((d) => d.day.length && d.before.length);
  const up = withData.map((d) => ({ d, c: changeOf(totalsOf(d.day).gmv, totalsOf(d.before).gmv)! })).sort((a, b) => b.c - a.c);
  return {
    avgUplift: changeOf(sumOf(withData.map((d) => totalsOf(d.day).gmv)), sumOf(withData.map((d) => totalsOf(d.before).gmv))),
    best: up[0] ?? null,
    worst: up.at(-1) ?? null,
    sessionGmv: sumOf(days.map((d) => d.session?.gmv ?? null)),
  };
}
