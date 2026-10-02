import { google } from "googleapis";
import { googleAuth } from "@/lib/google";
import { parseBonusMinutes, parseLateMinutes } from "@/lib/pay";

/**
 * โครงสร้างชีต "LIVE GLORY 2026" + ตัวแปลงค่า (ใช้ร่วมกันระหว่างซิงค์สองทางและสคริปต์)
 *
 * ค่าที่อ่านมาเป็นแบบ UNFORMATTED + SERIAL_NUMBER:
 *   วันที่ = จำนวนวันนับจาก 30 ธ.ค. 1899, เวลา = เศษส่วนของวัน, checkbox = true/false
 */

export const SHEET_ID = process.env.SHEET_ID || "1r17--dnbXyVk416Zc3mGwUb-aDw3OCxelOC25NJW7Xo";

export const TABS = { mc: "ลงตาราง Deal Mc", admin: "ลงตาราง Admin เสริม" } as const;
export type TabKey = keyof typeof TABS;
export const TABLE_OF: Record<TabKey, "mc_slots" | "admin_slots"> = { mc: "mc_slots", admin: "admin_slots" };
export const TAB_OF = { mc_slots: "mc", admin_slots: "admin" } as const;

/**
 * คอลัมน์ (เริ่ม 0 = A) — V เก็บรหัส slot ในระบบใหม่ (ระบบเขียนเอง ห้ามแก้)
 * late = ช่องที่ทีมบันทึกเวลามาสาย (Mc ใช้ช่อง Remark (L) / Admin ใช้คอลัมน์ M) ระบบอ่านอย่างเดียว
 * ช่องเดียวกันใช้บันทึกไลฟ์ชดเชยด้วย ถ้ามี + นำหน้า เช่น "+10" (ดู parseBonusMinutes)
 */
export const COLS = {
  mc: { no: 0, platform: 1, date: 2, start: 3, end: 4, hourF: 5, hourG: 6, campaign: 7, person: 8, confirm: 9, status: 10, remark: 11, late: 11, id: 21 },
  admin: { no: 0, platform: 1, date: 2, start: 3, end: 4, hourF: 5, hourG: 6, person: 7, confirm: 8, remark: 9, status: 10, late: 12, id: 21 },
} as const;
export const LAST_COL = "V";

export type Cell = string | number | boolean | null | undefined;
export type Row = Cell[];

export const str = (v: Cell) => String(v ?? "").trim();
export const normalizeMcName = (v: Cell) => str(v).replace(/^mc\s*/i, "").trim();

const EPOCH = Date.UTC(1899, 11, 30);
export function serialDate(v: Cell) {
  if (typeof v !== "number" || v < 1) return null;
  return new Date(EPOCH + Math.floor(v) * 86400_000).toISOString().slice(0, 10);
}
export function serialTime(v: Cell) {
  if (typeof v !== "number") return null;
  const mins = Math.round((v - Math.floor(v)) * 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
export const dateSerial = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - EPOCH) / 86400_000);
export const timeSerial = (t: string) => (Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))) / 1440;
export const confirmedOf = (v: Cell) => (v === true || v === "TRUE" ? true : v === false || v === "FALSE" ? false : null);

/** ชั่วโมงของ slot (รองรับข้ามเที่ยงคืน) */
export function hoursOf(start: string, end: string) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (((m(end) - m(start)) + 1440) % 1440 || 1440) / 60;
}

/** แถวในชีตที่แปลงแล้ว (null = ไม่ใช่แถว slot เช่น หัวตาราง/หัวเดือน/ยังกรอกไม่ครบ) */
export type SheetSlot = {
  platform: string;
  live_date: string;
  start_time: string;
  end_time: string;
  campaign: string;
  person: string; // Mc: ไม่มีคำว่า "Mc" นำหน้า
  confirmed: boolean | null;
  status: string;
  remark: string;
  late: number | null; // นาทีที่มาสาย
  bonus: number | null; // นาทีที่ไลฟ์ชดเชย ("+10" ในช่องเวลาสาย: Deal Mc คอลัมน์ L / Admin เสริม คอลัมน์ M)
  id: number | null;
};

export function parseRow(tab: TabKey, r: Row): SheetSlot | null {
  const c = COLS[tab];
  const live_date = serialDate(r[c.date]);
  const start_time = serialTime(r[c.start]);
  const end_time = serialTime(r[c.end]);
  if (!live_date || !start_time || !end_time || start_time === end_time) return null;
  const idNum = Number(str(r[c.id]));
  return {
    platform: str(r[c.platform]),
    live_date, start_time, end_time,
    campaign: tab === "mc" ? str(r[COLS.mc.campaign]) : "",
    person: tab === "mc" ? normalizeMcName(r[c.person]) : str(r[c.person]),
    confirmed: confirmedOf(r[c.confirm]),
    status: str(r[c.status]),
    remark: str(r[c.remark]),
    late: parseLateMinutes(r[c.late]),
    bonus: parseBonusMinutes(r[c.late]), // ช่องเดียวกับเวลาสาย: มี + นำหน้า = ไลฟ์ชดเชย
    id: Number.isInteger(idNum) && idNum > 0 ? idNum : null,
  };
}

export function sheetsApi() {
  const auth = googleAuth();
  if (!auth) throw new Error("ยังไม่ได้เชื่อมบัญชี Google (bun run google:auth)");
  return google.sheets({ version: "v4", auth });
}

/** อ่านทั้งแท็บ A1:V (แถว 1 = index 0) */
export async function readTab(tab: TabKey): Promise<Row[]> {
  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${TABS[tab]}'!A1:${LAST_COL}`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  return (res.data.values ?? []) as Row[];
}

let _sheetIds: Record<string, number> | null = null;
/** sheetId (ตัวเลข) ของแต่ละแท็บ ใช้กับคำสั่งแทรก/ลบแถว */
export async function sheetIdOf(tab: TabKey) {
  if (!_sheetIds) {
    const meta = await sheetsApi().spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties(title,sheetId)" });
    _sheetIds = Object.fromEntries((meta.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId ?? 0]));
  }
  const id = _sheetIds[TABS[tab]];
  if (id === undefined) throw new Error(`ไม่พบแท็บ "${TABS[tab]}"`);
  return id;
}

/** เลขคอลัมน์ (0 = A) -> ตัวอักษร */
export const colLetter = (i: number) => String.fromCharCode(65 + i);
