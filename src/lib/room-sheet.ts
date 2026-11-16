import { isShopeePlatform, platformRaw } from "@/lib/platform";

// ตารางห้องไลฟ์ (ผู้ใช้ขอ 2026-11-16): แท็บ "Live <เดือน> <ปี> (เว็บ)" ในชีตตารางไลฟ์ของแอดมินประจำ
//   หน้าตาเหมือนแท็บ "Live Nov 2026" ที่ทีมทำมือ: แถวหัว = ชั่วโมง 05:00 ถึง 05:00 วันถัดไป
//   วันละ 3 ห้อง ห้องละ 3 แถว (ช่อง + Mc / เวลาเริ่ม-จบ / แอดมิน) · วันอาทิตย์ช่องวันสีเหลือง
//   ห้อง 1 = GLORY MALL, ห้อง 2 = Skin Expert, ห้อง 3 = Cherry Glory · ช่องอื่นของ TikTok = แถว "อื่นๆ"
//   ไม่รวม Shopee (ผู้ใช้เลือก) และแพลนของ Agency (ใช้สตูดิโอของตัวเอง)
//   ส่วนนี้เป็นฟังก์ชันล้วน (ทดสอบได้) · อ่าน DB + เขียนชีตอยู่ที่ src/lib/room-sheet-sync.ts

/** คิวไลฟ์ 1 คิว (จับคู่ Mc + Admin ของช่อง + วัน + เวลาเดียวกันแล้ว) */
export type RoomSlot = {
  platform: string;
  /** วันไลฟ์ตาม slot (YYYY-MM-DD) */
  date: string;
  /** HH:MM */
  start: string;
  end: string;
  /** ชื่อ Mc (ไม่มี / ยังว่าง = null) */
  mc: string | null;
  admins: string[];
  campaign: string;
};

export type RoomCell = {
  text: string;
  bg: string;
  fg?: string;
  bold?: boolean;
  size?: number;
  /** ฟอนต์หัวตาราง / วัน / ห้อง (ช่องคิวใช้ Arial แบบในชีตเดิม) */
  prompt?: boolean;
  wrap?: boolean;
  border?: boolean;
};

/** ช่วงที่รวมเซลล์ (end ไม่นับ) */
export type RoomMerge = { r0: number; r1: number; c0: number; c1: number };

export type RoomSheet = {
  title: string;
  rows: (RoomCell | null)[][];
  merges: RoomMerge[];
  /** ความสูงแต่ละแถว (px) */
  heights: number[];
  colCount: number;
  /** จำนวนคิวที่ลงตาราง */
  placed: number;
  /** คิวที่ลงไม่ได้ (เวลาทับคิวอื่นในห้องเดียวกันจนไม่มีช่องว่าง) */
  skipped: string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
/** คอลัมน์แรกของชั่วโมง (D) · ชั่วโมงแรก 05:00 · 25 คอลัมน์ = 05:00 ถึง 06:00 วันถัดไป แบบชีตเดิม */
export const HOUR_COL = 3;
const FIRST_HOUR = 5;
const HOUR_COLS = 25;
/** A..AC (ชีตเดิมมีคอลัมน์ AC ว่างต่อท้าย) */
export const ROOM_COLS = HOUR_COL + HOUR_COLS + 1;
const DAY_START = FIRST_HOUR * 60;

const DARK = "#302502", CREAM = "#fff2cc", PRIME = "#cc4125", WHITE = "#ffffff";
const TIME_BG = "#ff9900", ADMIN_BG = "#9fc5e8", CEO_BG = "#ff0000";
/** ชั่วโมงไพรม์ไทม์ (หัวคอลัมน์สีแดง) 10:00–14:00 และ 18:00–22:00 */
const isPrime = (h: number) => (h >= 10 && h <= 13) || (h >= 18 && h <= 21);

type Room = { label: string; head: { bg: string; fg?: string }; slot: { bg: string; fg?: string }; match: (p: string) => boolean };
const lower = (p: string) => platformRaw(String(p ?? "").trim()).toLowerCase();
const ROOMS: Room[] = [
  { label: "ห้อง 1", head: { bg: "#ead1dc" }, slot: { bg: "#d5a6bd" }, match: (p) => lower(p) === "glory mall" },
  { label: "ห้อง 2", head: { bg: "#57bb8a", fg: WHITE }, slot: { bg: "#57bb8a" }, match: (p) => lower(p) === "skin expert" },
  { label: "ห้อง 3", head: { bg: "#000000", fg: WHITE }, slot: { bg: "#000000", fg: WHITE }, match: (p) => lower(p) === "cherry glory" },
];
const OTHER: Room = { label: "อื่นๆ", head: { bg: "#d9d9d9" }, slot: { bg: "#efefef" }, match: () => true };

/** ชื่อแท็บของเดือน เช่น "2026-12" -> "Live Dec 2026 (เว็บ)" */
export function roomTabTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `Live ${MONTHS[m - 1]} ${y} (เว็บ)`;
}

/** เดือนที่อัปเดตอัตโนมัติ: เดือนนี้ + เดือนหน้า ตามเวลาไทย */
export function roomMonths(nowMs: number) {
  const d = new Date(nowMs + 7 * 3600_000);
  const key = (y: number, m: number) => `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  return [key(d.getUTCFullYear(), d.getUTCMonth()), key(d.getUTCFullYear(), d.getUTCMonth() + 1)];
}

/** ชื่อแท็บที่ทีมทำมือของเดือนเดียวกัน (ไว้วางแท็บใหม่ต่อจากแท็บนี้) */
export function teamTabTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `Live ${MONTHS[m - 1]} ${y}`;
}

const mins = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const hhmm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** แถวของวันไหน: ก่อน 05:00 = ต่อจากคืนก่อนหน้า (แถวของวันก่อน) · คอลัมน์ = ชั่วโมงที่เริ่ม */
export function roomPlace(s: Pick<RoomSlot, "date" | "start" | "end">) {
  const a = mins(s.start), b = mins(s.end);
  const early = a < DAY_START;
  const len = (b - a + 1440) % 1440 || 1440;
  return {
    day: early ? addDays(s.date, -1) : s.date,
    col: HOUR_COL + Math.floor(((a - DAY_START + 1440) % 1440) / 60),
    /** คิว 2 ชม. = 2 คอลัมน์ (09:30–11:30 อยู่ช่อง 09:00 + 10:00 แบบในชีตเดิม) */
    width: Math.max(1, Math.round(len / 60)),
  };
}

/** ช่องในแถวแรกของคิว: "TIK TOK GLORY MALL\nMc ปิ่น" · คิว CEO = ชื่อแคมเปญตัวใหญ่ (ช่องสีแดงในชีตเดิม) */
function slotTitle(s: RoomSlot) {
  const ceo = /ceo/i.test(s.campaign);
  const head = ceo ? s.campaign.trim().toUpperCase() : `TIK TOK ${platformRaw(s.platform.trim())}`;
  return { ceo, text: `${head}\nMc ${s.mc?.trim() || "(ว่าง)"}` };
}

/**
 * สร้างตารางทั้งเดือน (month = YYYY-MM) จากคิวที่จับคู่แล้ว
 *   คิวของวันอื่น / Shopee ถูกข้าม · ห้องเดียวกันเวลาทับกัน = เลื่อนไปช่องว่างถัดไป (ไม่มีช่อง = skipped)
 */
export function buildRoomSheet(month: string, slots: RoomSlot[]): RoomSheet {
  const [y, m] = month.split("-").map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const inMonth = new Set(dates);

  const list = slots
    .filter((s) => !isShopeePlatform(s.platform))
    .map((s) => ({ s, at: roomPlace(s) }))
    .filter((x) => inMonth.has(x.at.day))
    .sort((a, b) => a.at.day.localeCompare(b.at.day) || a.at.col - b.at.col || a.s.platform.localeCompare(b.s.platform));
  const roomOf = (p: string) => ROOMS.find((r) => r.match(p)) ?? OTHER;
  const rooms = list.some((x) => roomOf(x.s.platform) === OTHER) ? [...ROOMS, OTHER] : ROOMS;
  const perDay = rooms.length * 3;
  const rowCount = 2 + daysIn * perDay;

  const rows: (RoomCell | null)[][] = Array.from({ length: rowCount }, () => Array<RoomCell | null>(ROOM_COLS).fill(null));
  const merges: RoomMerge[] = [];
  const heights = Array<number>(rowCount).fill(21);
  const merge = (r0: number, r1: number, c0: number, c1: number) => {
    if (r1 - r0 > 1 || c1 - c0 > 1) merges.push({ r0, r1, c0, c1 });
  };

  // หัวตาราง 2 แถว: ชั่วโมงเริ่ม / ชั่วโมงจบ
  heights[0] = heights[1] = 30;
  rows[0][0] = { text: "", bg: DARK, prompt: true, bold: true, size: 15 };
  merge(0, 2, 0, 2);
  rows[0][2] = { text: "ห้อง", bg: DARK, fg: WHITE, prompt: true, bold: true, size: 15 };
  merge(0, 2, 2, 3);
  for (let i = 0; i < HOUR_COLS; i++) {
    const h = FIRST_HOUR + i;
    const prime = isPrime(h % 24);
    const style = { bg: prime ? PRIME : CREAM, ...(prime ? { fg: WHITE } : {}), prompt: true, bold: true, size: 13 };
    rows[0][HOUR_COL + i] = { text: hhmm(h), ...style };
    rows[1][HOUR_COL + i] = { text: hhmm(h + 1), ...style };
  }
  rows[0][ROOM_COLS - 1] = rows[1][ROOM_COLS - 1] = { text: "", bg: CREAM };

  // วัน / ห้อง
  const dayRow = new Map<string, number>();
  dates.forEach((date, i) => {
    const r0 = 2 + i * perDay;
    dayRow.set(date, r0);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const label = { prompt: true, bold: true, size: 12, border: true };
    rows[r0][0] = { text: DAYS[dow], bg: dow === 0 ? CREAM : WHITE, ...label };
    merge(r0, r0 + perDay, 0, 1);
    const [yy, mm, dd] = date.split("-").map(Number);
    rows[r0][1] = { text: `${dd}/${mm}/${yy}`, bg: WHITE, ...label };
    merge(r0, r0 + perDay, 1, 2);
    rooms.forEach((room, k) => {
      const rr = r0 + k * 3;
      rows[rr][2] = { text: room.label, bg: room.head.bg, ...(room.head.fg ? { fg: room.head.fg } : {}), ...label };
      merge(rr, rr + 3, 2, 3);
      heights[rr] = 40;
    });
  });

  // คิว
  const used = new Map<string, Set<number>>();
  const skipped: string[] = [];
  let placed = 0;
  const lastCol = HOUR_COL + HOUR_COLS;
  for (const { s, at } of list) {
    const k = rooms.indexOf(roomOf(s.platform));
    const r = dayRow.get(at.day)! + k * 3;
    const taken = used.get(`${at.day}|${k}`) ?? new Set<number>();
    used.set(`${at.day}|${k}`, taken);
    // ช่องแรกที่ว่างตั้งแต่ชั่วโมงที่เริ่ม แล้วกว้างได้จนถึงช่องที่มีคิวแล้ว
    let c0 = at.col;
    while (c0 < lastCol && taken.has(c0)) c0++;
    if (c0 >= lastCol) {
      skipped.push(`${s.date} ${s.start}–${s.end} ${s.platform}`);
      continue;
    }
    let w = 1;
    while (w < at.width && c0 + w < lastCol && !taken.has(c0 + w)) w++;
    for (let c = c0; c < c0 + w; c++) taken.add(c);

    const { ceo, text } = slotTitle(s);
    const color = ceo ? { bg: CEO_BG, fg: WHITE } : { bg: rooms[k].slot.bg, ...(rooms[k].slot.fg ? { fg: rooms[k].slot.fg } : {}) };
    rows[r][c0] = { text, ...color, wrap: true, border: true, size: rooms[k] === ROOMS[2] && !ceo ? 11 : 10 };
    merge(r, r + 1, c0, c0 + w);
    for (let c = c0; c < c0 + w; c++) rows[r + 1][c] = { text: "", bg: TIME_BG, border: true };
    if (w === 1) rows[r + 1][c0] = { text: `${s.start}–${s.end}`, bg: TIME_BG, border: true };
    else {
      rows[r + 1][c0] = { text: s.start, bg: TIME_BG, border: true };
      rows[r + 1][c0 + w - 1] = { text: s.end, bg: TIME_BG, border: true };
    }
    rows[r + 2][c0] = { text: s.admins.filter(Boolean).join(" / "), bg: ADMIN_BG, border: true };
    merge(r + 2, r + 3, c0, c0 + w);
    placed++;
  }

  return { title: roomTabTitle(month), rows, merges, heights, colCount: ROOM_COLS, placed, skipped };
}

/** ข้อความทั้งตาราง (ตัดช่องว่างท้ายแถว / แถวว่างท้ายตาราง แบบที่ Sheets API คืนมา) ไว้เทียบว่าต้องเขียนใหม่ไหม */
export function roomSheetText(rows: (RoomCell | null)[][]) {
  const out = rows.map((row) => {
    const t = row.map((c) => c?.text ?? "");
    while (t.length && t[t.length - 1] === "") t.pop();
    return t;
  });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

/** จับคู่ Mc + Admin ของ slot เดียวกัน (ช่อง + วัน + เวลาเริ่ม + เวลาจบ) แบบหน้า Plan Slot Live */
export type RawSide = {
  platform: string; live_date: string; start_time: string; end_time: string;
  is_cancelled: boolean; confirmed: boolean | null; name: string | null; campaign?: string | null;
};

/**
 * คิวที่ลงตาราง: ฝั่ง Mc มีแถวและไม่ได้แคน (ไม่มีแถว Mc = ดูฝั่ง Admin ที่ยังนับ)
 *   ชื่อ Mc / Admin แสดงเฉพาะแถวที่ยังนับ (ไม่แคน + ไม่ได้ติ๊กไม่นับ) แบบเดียวกับการนับชั่วโมงทั้งเว็บ
 */
export function pairRoomSlots(mc: RawSide[], admin: RawSide[]): RoomSlot[] {
  const hm = (t: string) => t.slice(0, 5);
  const key = (x: RawSide) => `${x.platform}|${x.live_date}|${hm(x.start_time)}|${hm(x.end_time)}`;
  const counts = (x: RawSide) => !x.is_cancelled && x.confirmed !== false;
  const map = new Map<string, { base: RawSide; mcRows: RawSide[]; adminRows: RawSide[] }>();
  const at = (x: RawSide) => {
    const k = key(x);
    const v = map.get(k) ?? { base: x, mcRows: [], adminRows: [] };
    map.set(k, v);
    return v;
  };
  for (const x of mc) at(x).mcRows.push(x);
  for (const x of admin) at(x).adminRows.push(x);
  const out: RoomSlot[] = [];
  for (const { base, mcRows, adminRows } of map.values()) {
    const live = mcRows.length ? mcRows.some((x) => !x.is_cancelled) : adminRows.some(counts);
    if (!live) continue;
    const mcName = mcRows.find((x) => counts(x) && x.name)?.name ?? null;
    out.push({
      platform: base.platform, date: base.live_date, start: hm(base.start_time), end: hm(base.end_time),
      mc: mcName, admins: [...new Set(adminRows.filter((x) => counts(x) && x.name).map((x) => x.name!))],
      campaign: mcRows.find((x) => !x.is_cancelled)?.campaign ?? "",
    });
  }
  return out;
}
