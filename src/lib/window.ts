/**
 * ช่วงเปิดจอง (แยก Mc / Admin เก็บใน settings.book_window_mc / book_window_admin)
 * ช่วง (Period):
 *   mode "off"    = ไม่จำกัดเพิ่ม (จองได้ตั้งแต่วันนี้ถึงสิ้น "เดือนสุดท้ายที่เปิดจอง")
 *   mode "week"   = สัปดาห์นี้เท่านั้น (จันทร์–อาทิตย์ เลื่อนอัตโนมัติทุกวันจันทร์)
 *   mode "range"  = ช่วงวันที่กำหนดเอง (from / to ว่างได้ข้างเดียว)
 *   mode "closed" = ปิดจอง (ไม่เห็น slot เลย)
 * BookWindow = ช่วงของคนทั่วไป + only (staff id ที่ให้จองก่อน) + early (ช่วงของคนใน only)
 * ช่วงที่จองได้จริง = ช่วงนี้ ตัดด้วย "วันนี้" และ "เดือนสุดท้ายที่เปิดจอง" อีกชั้น (ยกเว้นช่วงที่ใส่วันสุดท้ายเอง ดู bookRange)
 * วันที่ทั้งหมดเป็นข้อความ YYYY-MM-DD ตามเวลาไทย
 */
export type WindowMode = "off" | "week" | "range" | "closed";
export type Period = { mode: WindowMode; from: string | null; to: string | null };
export type BookWindow = Period & { only: number[]; early: Period | null };
export type BookRange = { from: string; to: string | null; empty: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => iso(day(d) + n * 86400_000);
/** วันจันทร์ของสัปดาห์ */
export const weekStart = (d: string) => addDays(d, -((new Date(day(d)).getUTCDay() + 6) % 7));
/** วันอาทิตย์ของสัปดาห์ */
export const weekEnd = (d: string) => addDays(weekStart(d), 6);
export const monthEnd = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return iso(Date.UTC(y, m, 0));
};

export const isDate = (x: unknown): x is string => typeof x === "string" && DATE.test(x);

const OFF: Period = { mode: "off", from: null, to: null };

/** ช่วงที่เก็บไว้ -> ช่วงที่ใช้ได้ (range ที่ไม่มีวันเลย = ไม่จำกัด) */
export function cleanPeriod(v: unknown): Period {
  const o = (v ?? {}) as { mode?: unknown; from?: unknown; to?: unknown };
  const m = o.mode;
  const mode: WindowMode = m === "week" || m === "range" || m === "closed" ? m : "off";
  const from = mode === "range" && isDate(o.from) ? o.from : null;
  const to = mode === "range" && isDate(o.to) ? o.to : null;
  if (mode === "range" && !from && !to) return { ...OFF };
  return { mode, from, to };
}

/** ข้อมูลที่เก็บไว้ -> กฎที่ใช้ได้ (ไม่จำกัดอะไรเลย = null) */
export function cleanWindow(v: unknown): BookWindow | null {
  const o = (v ?? {}) as { only?: unknown; early?: unknown };
  const ids: unknown[] = Array.isArray(o.only) ? o.only : [];
  const only = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  let general = cleanPeriod(v);
  let early: Period | null = null;
  if (only.length) {
    if ("early" in o) {
      early = cleanPeriod(o.early);
    } else {
      // ข้อมูลรุ่นแรก (ยังไม่มีช่วงแยก): คนในรายชื่อใช้ช่วงที่ตั้งไว้ คนอื่นปิดจอง
      early = general;
      general = { mode: "closed", from: null, to: null };
    }
  }
  if (general.mode === "off" && !only.length) return null;
  return { ...general, only, early };
}

/** ช่วงที่ใช้กับคนนี้ (staff id) — คนในรายชื่อจองก่อนใช้ early / คนอื่น (และ Owner ที่เปิดดู) ใช้ช่วงทั่วไป */
export function periodFor(w: BookWindow | null, personId?: number | null): Period {
  if (!w) return OFF;
  if (personId != null && w.early && w.only.includes(personId)) return w.early;
  return { mode: w.mode, from: w.from, to: w.to };
}

/**
 * ช่วงที่จองได้จริงวันนี้ (cutoff = วันสุดท้ายของเดือนที่เปิดจอง / null = ไม่จำกัด)
 *   "กำหนดช่วงวัน" ที่ใส่วันสุดท้ายเอง = ใช้วันนั้นเลย (เปิดเกินเดือนที่เปิดจองได้ เช่น ให้บางคนจองเดือนหน้าก่อน)
 *   ไม่จำกัด / สัปดาห์นี้ / ไม่ใส่วันสุดท้าย = ถึงสิ้นเดือนที่เปิดจองอย่างมาก
 */
export function bookRange(p: Period | null, today: string, cutoff: string | null): BookRange {
  const d = !p || p.mode === "off" || p.mode === "closed" ? { from: null, to: null }
    : p.mode === "week" ? { from: weekStart(today), to: weekEnd(today) } : p;
  const from = d.from && d.from > today ? d.from : today;
  const to = p?.mode === "range" && d.to ? d.to : [d.to, cutoff].filter((x): x is string => !!x).sort()[0] ?? null;
  return { from, to, empty: p?.mode === "closed" || (!!to && to < from) };
}

/** "3 ต.ค." / "3 ต.ค. 2026" */
export function fmtDay(d: string, year = false) {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    day: "numeric", month: "short", year: year ? "numeric" : undefined, timeZone: "UTC",
  }).format(new Date(day(d)));
}

/** "3 – 15 ต.ค. 2026" / "ตั้งแต่ 3 ต.ค. 2026" */
export function rangeText(r: { from: string; to: string | null }) {
  if (!r.to) return `ตั้งแต่ ${fmtDay(r.from, true)}`;
  if (r.from === r.to) return fmtDay(r.to, true);
  return `${fmtDay(r.from, r.from.slice(0, 4) !== r.to.slice(0, 4))} – ${fmtDay(r.to, true)}`;
}

/** ข้อความแจ้งบนหน้าจองเมื่อมีการตั้งช่วงเปิดจอง */
export function windowNotice(p: Period, r: BookRange) {
  if (r.empty) return "ตอนนี้ยังไม่เปิดจอง รอทีมงานเปิดรอบถัดไป";
  if (p.mode === "week" && r.to) {
    return `เปิดจองเฉพาะสัปดาห์นี้ (ถึงวันอาทิตย์ที่ ${fmtDay(r.to)}) สัปดาห์ถัดไปเปิดให้จองทุกวันจันทร์`;
  }
  return `เปิดจองเฉพาะวันที่ ${rangeText(r)} เท่านั้น`;
}

/** ปุ่มลัดตั้งช่วงวัน (เจ้าของเลือกแล้วแก้ต่อได้) */
export function windowPresets(today: string) {
  const sun = weekEnd(today);
  const mid = `${today.slice(0, 8)}15`;
  const nextMonth = addDays(monthEnd(today), 1);
  return [
    { label: "สัปดาห์นี้", from: today, to: sun },
    { label: "สัปดาห์หน้า", from: addDays(sun, 1), to: addDays(sun, 7) },
    { label: "ถึงกลางเดือน", from: today, to: today <= mid ? mid : `${nextMonth.slice(0, 8)}15` },
    { label: "ถึงสิ้นเดือน", from: today, to: monthEnd(today) },
    { label: "เดือนหน้าทั้งเดือน", from: nextMonth, to: monthEnd(nextMonth) },
  ];
}
