/**
 * ช่วงเปิดจอง (แยก Mc / Admin เก็บใน settings.book_window_mc / book_window_admin)
 *   null              = ไม่จำกัดเพิ่ม (จองได้ตั้งแต่วันนี้ถึงสิ้น "เดือนสุดท้ายที่เปิดจอง")
 *   { mode: "week" }  = สัปดาห์นี้เท่านั้น (จันทร์–อาทิตย์ เลื่อนอัตโนมัติทุกวันจันทร์)
 *   { mode: "range" } = ช่วงวันที่กำหนดเอง (from / to ว่างได้ข้างเดียว)
 * ช่วงที่จองได้จริง = ช่วงนี้ ตัดด้วย "วันนี้" และ "เดือนสุดท้ายที่เปิดจอง" อีกชั้น
 * วันที่ทั้งหมดเป็นข้อความ YYYY-MM-DD ตามเวลาไทย
 */
export type BookWindow = { mode: "week" } | { mode: "range"; from: string | null; to: string | null };
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

/** ข้อมูลที่เก็บไว้ -> กฎที่ใช้ได้ (ผิดรูปแบบ = null) */
export function cleanWindow(v: unknown): BookWindow | null {
  const o = v as { mode?: unknown; from?: unknown; to?: unknown } | null;
  if (o?.mode === "week") return { mode: "week" };
  if (o?.mode === "range") {
    const d = (x: unknown) => (typeof x === "string" && DATE.test(x) ? x : null);
    const from = d(o.from), to = d(o.to);
    if (!from && !to) return null;
    return { mode: "range", from, to };
  }
  return null;
}

/** ช่วงที่จองได้จริงวันนี้ (cutoff = วันสุดท้ายของเดือนที่เปิดจอง / null = ไม่จำกัด) */
export function bookRange(w: BookWindow | null, today: string, cutoff: string | null): BookRange {
  const d = !w ? { from: null, to: null } : w.mode === "week" ? { from: weekStart(today), to: weekEnd(today) } : w;
  const from = d.from && d.from > today ? d.from : today;
  const to = [d.to, cutoff].filter((x): x is string => !!x).sort()[0] ?? null;
  return { from, to, empty: !!to && to < from };
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
export function windowNotice(w: BookWindow, r: BookRange) {
  if (r.empty) return "ตอนนี้ยังไม่เปิดจอง รอทีมงานเปิดรอบถัดไป";
  if (w.mode === "week" && r.to) {
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
