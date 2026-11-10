// อ่านป้ายวันจากชีตของทีม (ผู้ใช้ขอ 2026-11-10: ซิงก์อัตโนมัติทุกวัน) — ฟังก์ชันล้วน (เทสได้) ตัวซิงก์อยู่ที่ src/lib/live-days-sync.ts
//   แท็บ "GLORY TIKTOK": วันที่คอลัมน์ B ("1 Nov") · หมายเหตุคอลัมน์ H · ไม่มีแถวหัว
//   แท็บ "GLORY Shopee " (มีวรรคท้าย · แท็บซ่อน "GLORY Shopee" เป็นของเก่า ไม่อ่าน): วันที่คอลัมน์ A · แถวหัว DATE | ... | Campaign | remark
//     ป้ายอยู่คอลัมน์ remark (บางเดือนอยู่คอลัมน์ Campaign) · บล็อกที่หัวไม่มี Campaign / remark (เช่น All Hr พ.ย.–ธ.ค. 2026) = ไม่มีป้าย ไม่บันทึกวันนั้น
//   แถวที่ไม่มีวันที่ = slot ต่อของวันก่อนหน้า · วันเดียวกันหลายส่วน (Infinite / MCN / In house) รวมข้อความแล้วเลือกป้ายที่สำคัญสุด (pickDayTag)
//   ปี: ชีตไม่มีปี (ยกเว้นบางแถว เช่น "1 Oct 26") — เดือนย้อนกลับเกิน 6 เดือน (ธ.ค. -> ม.ค.) = ขึ้นปีใหม่ · ปีจริงจากแถวที่มีปี หรือบล็อกล่าสุดไม่เกินเดือนหน้า

import { pickDayTag, type DayTag } from "@/lib/live-days";
import type { Platform } from "@/lib/live-stats";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = /^(\d{1,2})\s*([A-Za-z]{3,9})\.?(?:\s+(\d{2}|\d{4}))?$/;

/** "1 Nov" / "3Jul" / "13 June" / "1 Oct 26" -> { day, month (1–12), year? } · ไม่ใช่วันที่ = null */
export function sheetDate(v: unknown): { day: number; month: number; year: number | null } | null {
  const m = String(v ?? "").replace(/\s+/g, " ").trim().match(DATE_RE);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  const day = Number(m[1]);
  if (!month || day < 1 || day > 31) return null;
  return { day, month, year: m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null };
}

const cell = (row: unknown[] | undefined, i: number) => String(row?.[i] ?? "").replace(/\s+/g, " ").trim();
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * แถวของแท็บ (ค่าตามที่แสดงในชีต) -> ป้ายของแต่ละวันที่มีในชีต
 *   now = ใช้หาปีเมื่อไม่มีแถวที่บอกปี (บล็อกล่าสุดอยู่ไม่เกินเดือนหน้าของวันนี้)
 */
export function parseDayTagRows(rows: unknown[][], platform: Platform, now = Date.now()): DayTag[] {
  const shopee = platform === "Shopee";
  const dateCol = shopee ? 0 : 1;
  // TikTok = คอลัมน์ H เสมอ · Shopee = ตามแถวหัวล่าสุด (ก่อนเจอแถวหัว = ไม่มีป้าย)
  let remarkCols: number[] = shopee ? [] : [7];
  let rel = 0, prevMonth = 0, anchor: number | null = null;
  type Day = { rel: number; month: number; day: number; remarks: string[] };
  const days: Day[] = [];
  let cur: Day | null = null;
  for (const row of rows) {
    if (shopee && /^date$/i.test(cell(row, 0))) {
      const head = (row ?? []).map((c) => String(c ?? "").trim().toLowerCase());
      remarkCols = head.flatMap((h, i) => (/^(campaign|remark)$/.test(h) ? [i] : []));
      cur = null;
      continue;
    }
    const d = sheetDate(cell(row, dateCol));
    if (d) {
      // เดือนย้อนกลับเกิน 6 เดือน = ปีถัดไป (ย้อนนิดหน่อย = ส่วนที่แทรกไว้ผิดลำดับ ปีเดิม)
      if (prevMonth && d.month < prevMonth - 6) rel++;
      prevMonth = d.month;
      if (d.year !== null && anchor === null) anchor = d.year - rel;
      cur = remarkCols.length ? { rel, month: d.month, day: d.day, remarks: [] } : null;
      if (cur) days.push(cur);
    }
    if (cur) for (const i of remarkCols) { const v = cell(row, i); if (v) cur.remarks.push(v); }
  }
  if (!days.length) return [];
  if (anchor === null) {
    // บล็อกล่าสุด (ปีสัมพัทธ์มากสุด) อยู่ไม่เกินเดือนหน้าของวันนี้
    const bkk = new Date(now + 7 * 3600_000);
    const top = Math.max(...days.map((x) => x.rel));
    const lastMonth = Math.max(...days.filter((x) => x.rel === top).map((x) => x.month));
    const year = lastMonth <= bkk.getUTCMonth() + 2 ? bkk.getUTCFullYear() : bkk.getUTCFullYear() - 1;
    anchor = year - top;
  }
  const byDay = new Map<string, string[]>();
  for (const x of days) {
    const key = `${anchor + x.rel}-${pad(x.month)}-${pad(x.day)}`;
    byDay.set(key, [...(byDay.get(key) ?? []), ...x.remarks]);
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, remarks]) => ({ platform, day, ...pickDayTag(remarks) }));
}
