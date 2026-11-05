// แผ่นงาน Agency ในไฟล์ส่งออก Plan Slot Live — หน้าตาเดียวกับตารางที่ทีมใช้คุยกับ Agency
//   หัวคอลัมน์ > แถบดำ (เดือน + ชั่วโมงรวม) > วันละแถว (ช่วงที่ต่อกันรวมเป็นช่วงเดียว) + สถานะ + Campaign

import { canonicalCampaign } from "@/lib/campaign";
import type { Cell, ExportSheet, RowStyle } from "@/lib/export";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dayEn = (d: string) => `${Number(d.slice(8))} ${MONTHS_EN[Number(d.slice(5, 7)) - 1]}`;
const weekdayEn = (d: string) => WEEKDAYS_EN[new Date(`${d}T12:00:00Z`).getUTCDay()];
export const clock = (t: string) => `${Number(t.slice(0, 2))}:${t.slice(3, 5)}`; // "08:00" -> "8:00"
export const hmText = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const lenOf = (s: { start: string; end: string }) => (toMin(s.end) - toMin(s.start) + 1440) % 1440;

/** slot ของวันเดียวกันที่ต่อกัน (จบ = เริ่มของถัดไป) รวมเป็นช่วงเดียว เช่น 08:00–11:00 + 11:00–13:00 = 08:00–13:00 */
export function mergeRanges<T extends { start: string; end: string }>(list: T[], order: (x: T) => number) {
  const out: { start: string; end: string; min: number; slots: T[] }[] = [];
  for (const x of [...list].sort((a, b) => order(a) - order(b))) {
    const last = out.at(-1);
    if (last && last.end === x.start) { last.end = x.end; last.min += lenOf(x); last.slots.push(x); }
    else out.push({ start: x.start, end: x.end, min: lenOf(x), slots: [x] });
  }
  return out;
}

/** ชื่อที่ใช้คุยกับ Agency */
const SHORT: Record<string, string> = { "Mid Month": "MM", "Pay Day": "Payday" };
/** Campaign ของวันนั้น (จาก slot ของเรา เพราะแพลน Agency ไม่ได้เก็บ Campaign) ไม่มีแคมเปญ = Bau */
export function agencyCampaign(campaigns: string[]) {
  const names = [...new Set(campaigns.map(canonicalCampaign).filter(Boolean))];
  return names.map((c) => SHORT[c] ?? c).join(", ") || "Bau";
}

/** campaign = ชื่อจาก agencyCampaign / draft = ยังไม่ได้บันทึก */
export type AgencySheetSlot = { date: string; start: string; end: string; campaign: string; draft: boolean };

// วันไลฟ์ TikTok เริ่ม 07:30 หลังเที่ยงคืนยังนับเป็นวันเดิม
const DAY_START = toMin("07:30");
const orderOf = (s: { start: string }) => (toMin(s.start) - DAY_START + 1440) % 1440;
const MIDNIGHT = 1440 - DAY_START;

const COL = { month: 0, date: 1, day: 2, start: 3, end: 4, hours: 5, total: 6, status: 7, campaign: 8 };
const box = (bg: string, extra: Partial<RowStyle> = {}): RowStyle => ({ bg, border: true, align: "center", ...extra });
const HEAD = box("F3F3F3", { bold: true });
const BAND: RowStyle = { bg: "000000", color: "FFFFFF", bold: true, align: "center" };
const BAND_TOTAL: RowStyle = { ...BAND, color: "FFFF00" };
const ROW = box("FFFFFF");
/** แถวที่ไลฟ์ข้ามเที่ยงคืน */
const LATE = box("FFF2CC");
const STATUS = { Confirmed: box("D4EDBC", { color: "11734B" }), Draft: box("FFE5A0", { color: "473821" }) };

export function agencySheet(name: string, month: string, slots: AgencySheetSlot[]): ExportSheet {
  const total = slots.reduce((m, x) => m + lenOf(x), 0);
  const rows: Cell[][] = [
    ["", "Date", "Day", "Start", "End", "Hours", "Total hrs", "Status", "Campaign"],
    [MONTHS_EN[Number(month.slice(5, 7)) - 1], "", "", "", "", "", { v: total / 60, f: "money" }],
  ];
  const rowStyles: Record<number, RowStyle> = { 0: HEAD, 1: BAND };
  const cellStyles: Record<string, RowStyle> = { [`1:${COL.total}`]: BAND_TOTAL };
  for (const d of [...new Set(slots.map((x) => x.date))].sort()) {
    for (const r of mergeRanges(slots.filter((x) => x.date === d), orderOf)) {
      const i = rows.length;
      const status = r.slots.some((x) => x.draft) ? "Draft" : "Confirmed";
      rows.push(["", dayEn(d), weekdayEn(d), clock(r.start), clock(r.end), hmText(r.min), { v: r.min / 60, f: "money" }, status, r.slots[0].campaign]);
      rowStyles[i] = ROW;
      if (orderOf(r) + r.min > MIDNIGHT) for (let j = COL.day; j <= COL.total; j++) cellStyles[`${i}:${j}`] = LATE;
      cellStyles[`${i}:${COL.status}`] = STATUS[status];
    }
  }
  return { name, rows, header: 1, rowStyles, cellStyles, colWidths: [8, 10, 13, 9, 9, 8, 11, 12, 12] };
}
