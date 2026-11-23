import { isShopeePlatform, platformRaw } from "@/lib/platform";

// ตารางห้องไลฟ์ (ผู้ใช้ขอ 2026-11-16): แท็บ "Live <เดือน> <ปี> (เว็บ)" ในชีตตารางไลฟ์ของแอดมินประจำ
//   หน้าตาเหมือนแท็บ "Live Nov 2026" ที่ทีมทำมือ: แถวหัว = ชั่วโมง 05:00 ถึง 05:00 วันถัดไป
//   วันละ 3 ห้อง ห้องละ 3 แถว (ช่อง + Mc / เวลาเริ่ม-จบ / แอดมิน) · วันอาทิตย์ช่องวันสีเหลือง
//   ห้อง 1 = GLORY MALL, ห้อง 2 = Skin Expert, ห้อง 3 = Cherry Glory · ช่องอื่นของ TikTok = แถว "อื่นๆ"
//   ไม่รวม Shopee (ผู้ใช้เลือก) และแพลนของ Agency ที่ใช้สตูดิโอของตัวเอง
//   ช่องที่ทีมใส่เองนอกช่องคิว (กิจกรรม ฯลฯ) เว็บเก็บไว้ (keepTeamCells)
//     ยกเว้น Agency TDH: ไลฟ์ที่ห้อง 1 ลงตารางด้วย (ผู้ใช้ขอ 2026-11-20) ช่องสีฟ้า "Agency TDH" (แบบรูปที่ผู้ใช้ส่ง)
//     คิวของ Agency ที่ไลฟ์ต่อกัน (เช่น 19:30–21:30 + 21:30–23:30) รวมเป็นช่องเดียว 19:30–23:30
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
  /** คิวของ Agency ที่ไลฟ์ในห้องของเรา (เช่น "TDH") · ไม่มี = คิวของทีมเรา */
  agency?: string;
};

/** Agency ที่ไลฟ์ในห้องของเรา -> ห้อง (ลำดับใน ROOMS · 0 = ห้อง 1) · Agency อื่นใช้สตูดิโอของตัวเอง ไม่ลงตาราง */
export const ROOM_AGENCIES: Record<string, number> = { TDH: 0 };

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
  /** ช่องที่ทีมใส่เอง (กิจกรรม ฯลฯ): เขียนค่า + รูปแบบเดิมกลับตามที่อ่านจากชีต (keepTeamCells) */
  raw?: { value?: unknown; format?: unknown };
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
  /** ช่องแอดมินของแต่ละคิว (แถว + คอลัมน์ c0 ถึงก่อน c1) · web = เว็บมีชื่อแอดมินของคิวนี้ */
  adminCells: { r: number; c0: number; c1: number; web: boolean }[];
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
/** ช่องคิวของ Agency (สีฟ้าแบบที่ทีมใช้) */
const AGENCY_BG = "#00ffff";
/**
 * สีตัวอักษรของชื่อแอดมินที่เว็บเขียน: ดำเกือบสนิท (ตาเปล่าแยกไม่ออก) ไว้แยกจากชื่อที่ทีมพิมพ์เอง
 *   ทีมพิมพ์ในช่องว่าง = ได้สีดำปกติ → เว็บเก็บไว้ไม่ลบ · สีนี้ = ชื่อจากเว็บ → เว็บไม่มีชื่อแล้ว (แอดมินยกเลิก) = ล้างออก
 */
export const WEB_ADMIN_FG = "#000001";
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
  const ceo = !s.agency && /ceo/i.test(s.campaign);
  // คิวของ Agency: ช่องเขียนแค่ชื่อ Agency (ไม่มีชื่อช่อง / Mc ของทีมเรา)
  if (s.agency) return { ceo, text: `Agency ${s.agency}` };
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
  // คิวของ Agency ที่ไลฟ์ในห้องของเรา = ห้องที่ตั้งไว้ (TDH = ห้อง 1) · คิวทีมเรา = ห้องตามช่อง
  const roomOf = (s: RoomSlot) => (s.agency && ROOM_AGENCIES[s.agency] !== undefined ? ROOMS[ROOM_AGENCIES[s.agency]] : ROOMS.find((r) => r.match(s.platform)) ?? OTHER);
  const rooms = list.some((x) => roomOf(x.s) === OTHER) ? [...ROOMS, OTHER] : ROOMS;
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
  const adminCells: RoomSheet["adminCells"] = [];
  const used = new Map<string, Set<number>>();
  const skipped: string[] = [];
  let placed = 0;
  const lastCol = HOUR_COL + HOUR_COLS;
  for (const { s, at } of list) {
    const k = rooms.indexOf(roomOf(s));
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
    const color = s.agency ? { bg: AGENCY_BG }
      : ceo ? { bg: CEO_BG, fg: WHITE } : { bg: rooms[k].slot.bg, ...(rooms[k].slot.fg ? { fg: rooms[k].slot.fg } : {}) };
    rows[r][c0] = { text, ...color, wrap: true, border: true, size: rooms[k] === ROOMS[2] && !ceo ? 11 : 10 };
    merge(r, r + 1, c0, c0 + w);
    for (let c = c0; c < c0 + w; c++) rows[r + 1][c] = { text: "", bg: TIME_BG, border: true };
    if (w === 1) rows[r + 1][c0] = { text: `${s.start}–${s.end}`, bg: TIME_BG, border: true };
    else {
      rows[r + 1][c0] = { text: s.start, bg: TIME_BG, border: true };
      rows[r + 1][c0 + w - 1] = { text: s.end, bg: TIME_BG, border: true };
    }
    const admins = s.admins.filter(Boolean).join(" / ");
    rows[r + 2][c0] = { text: admins, bg: ADMIN_BG, border: true, ...(admins ? { fg: WEB_ADMIN_FG } : {}) };
    merge(r + 2, r + 3, c0, c0 + w);
    adminCells.push({ r: r + 2, c0, c1: c0 + w, web: !!admins });
    placed++;
  }

  return { title: roomTabTitle(month), rows, merges, heights, colCount: ROOM_COLS, placed, skipped, adminCells };
}

/**
 * ชื่อแอดมินที่ทีมพิมพ์เองในแท็บ (เว็บ) — ไม่ลบตอนเว็บเขียนตารางใหม่ (ผู้ใช้ขอ 2026-11-18)
 *   เก็บเมื่อ: เว็บยังไม่มีชื่อแอดมินของคิวนั้น + ในแท็บเป็นคิวเดียวกันที่ตำแหน่งเดิม (ช่องเวลาเริ่ม / จบแถวบนตรงกัน)
 *     + ชื่อในแท็บไม่ใช่ชื่อที่เว็บเขียนไว้เอง (webWritten — สี WEB_ADMIN_FG) ซึ่งแปลว่าแอดมินยกเลิกในเว็บแล้ว
 *   คิวย้ายเวลา / ย้ายช่อง = ชื่อเดิมไม่ตามไป · เว็บมีชื่อแล้ว = ใช้ของเว็บ
 *   old = ข้อความในแท็บตอนนี้ (ช่องที่รวมไว้ ข้อความอยู่ช่องซ้ายบน) · คืนจำนวนช่องที่เก็บไว้
 */
export function keepTeamAdmins(built: RoomSheet, old: string[][], webWritten: (r: number, c: number) => boolean) {
  const at = (r: number, c: number) => String(old[r]?.[c] ?? "").trim();
  let kept = 0;
  for (const a of built.adminCells) {
    if (a.web) continue;
    const text = at(a.r, a.c0);
    if (!text || webWritten(a.r, a.c0)) continue;
    const time = built.rows[a.r - 1];
    if ((time[a.c0]?.text ?? "") !== at(a.r - 1, a.c0) || (time[a.c1 - 1]?.text ?? "") !== at(a.r - 1, a.c1 - 1)) continue;
    built.rows[a.r][a.c0] = { ...built.rows[a.r][a.c0]!, text };
    kept++;
  }
  return kept;
}

// ---------- ช่องที่ทีมใส่เองในตาราง (กิจกรรม ฯลฯ · ผู้ใช้ขอ 2026-11-23) ----------
//   เว็บจดตำแหน่งช่องคิวที่วางไว้ (developer metadata ของแท็บ) · ช่องนอกตำแหน่งนั้น (ทั้งรอบก่อนและรอบนี้) ที่มีค่า / สี / เส้นขอบ
//   = ของทีม เก็บค่า + รูปแบบ + ช่องที่รวมไว้ตามเดิม · ช่องของคิวที่ย้ายไป (อยู่ในตำแหน่งรอบก่อน) = ล้างได้ตามปกติ
//   คิวใหม่มาลงทับช่องของทีม = คิวชนะ (ต้องเห็นคิวจริง)

/** ตำแหน่งช่องคิวทั้งหมดของตาราง "แถว.คอลัมน์.กว้าง" (แถวบนของคิว · คิวละ 3 แถว) ไว้จดในชีต */
export const webFootprint = (built: Pick<RoomSheet, "adminCells">) =>
  built.adminCells.map((a) => `${a.r - 2}.${a.c0}.${a.c1 - a.c0}`).join(",");

/** ข้อความตำแหน่ง -> ชุดช่อง "แถว,คอลัมน์" · ว่าง / อ่านไม่ได้ = null (ยังไม่เคยจด) */
export function footprintCells(text: string | null | undefined) {
  if (!text) return null;
  const out = new Set<string>();
  for (const part of text.split(",")) {
    const [r, c0, w] = part.split(".").map(Number);
    if (![r, c0, w].every(Number.isInteger)) return null;
    for (let rr = r; rr < r + 3; rr++) for (let c = c0; c < c0 + w; c++) out.add(`${rr},${c}`);
  }
  return out;
}

/** ช่องในแท็บตอนนี้ (อ่านจากชีต): ข้อความที่แสดง + ค่า / รูปแบบดิบ · filled = มีค่า สีพื้น หรือเส้นขอบ */
export type GridCell = { text: string; value?: unknown; format?: unknown; filled: boolean };

/**
 * เก็บช่องที่ทีมใส่เองในพื้นที่ชั่วโมงของตาราง (แถว 3 ลงไป · คอลัมน์ D ถึงท้ายตาราง) ใส่กลับเข้าตารางที่จะเขียน
 *   prev = ตำแหน่งช่องคิวที่เว็บเขียนรอบก่อน (null = ยังไม่เคยจด → ถือว่าเหมือนรอบนี้)
 *   ช่องที่รวมไว้ของทีม (ไม่ทับช่องคิวรอบก่อน / รอบนี้) = รวมตามเดิม · คืนจำนวนช่องที่เก็บ
 */
export function keepTeamCells(built: RoomSheet, cells: (GridCell | null | undefined)[][], merges: RoomMerge[], prev: Set<string> | null) {
  const now = footprintCells(webFootprint(built)) ?? new Set<string>();
  const web = (r: number, c: number) => now.has(`${r},${c}`) || !!prev?.has(`${r},${c}`);
  const inArea = (r: number, c: number) => r >= 2 && r < built.rows.length && c >= HOUR_COL && c < ROOM_COLS;
  let kept = 0;
  for (let r = 2; r < built.rows.length; r++) {
    for (let c = HOUR_COL; c < ROOM_COLS; c++) {
      const g = cells[r]?.[c];
      if (!g?.filled || web(r, c) || built.rows[r][c]) continue;
      built.rows[r][c] = { text: g.text, bg: "#ffffff", raw: { value: g.value, format: g.format } };
      kept++;
    }
  }
  const have = new Set(built.merges.map((m) => `${m.r0},${m.r1},${m.c0},${m.c1}`));
  for (const m of merges) {
    if (have.has(`${m.r0},${m.r1},${m.c0},${m.c1}`) || !inArea(m.r0, m.c0) || !inArea(m.r1 - 1, m.c1 - 1)) continue;
    let free = true;
    for (let r = m.r0; r < m.r1 && free; r++) for (let c = m.c0; c < m.c1 && free; c++) if (web(r, c) || (built.rows[r][c] && !built.rows[r][c]!.raw)) free = false;
    if (free) built.merges.push({ ...m });
  }
  return kept;
}

// ---------- สรุปวันหยุดแอดมินใต้ตาราง (ทีมทำเอง · ผู้ใช้ขอให้เว็บกรอกจำนวนคิว 2026-11-16) ----------
//   ทีมวางบล็อกรายสัปดาห์ไว้ใต้ตาราง: แถวหัว "Date" | ชื่อแอดมิน... | Adminเสริม แล้วแถววันที่ (MM/DD เช่น 12/01)
//   เว็บกรอกจำนวนคิวของแอดมินคนนั้นในวันนั้น (นับจากคิวที่ลงตารางด้านบน) · Adminเสริม = รวมคิวของแอดมินเสริมทุกคนที่ไม่มีคอลัมน์ของตัวเอง
//   ช่องที่พิมพ์ข้อความไว้ (off / Holiday / Sick leave ฯลฯ) ไม่แตะ · สูตรสรุปของทีมคำนวณต่อเอง
//   ในเว็บยังไม่มีคิวของคนนั้นในวันนั้น = ไม่แตะ (คงตัวเลขที่ทีมพิมพ์ไว้ล่วงหน้า · ผู้ใช้เลือก 2026-11-16)

/** ชื่อไว้จับคู่ (ไม่สนช่องว่าง / ตัวพิมพ์) */
export const nameKey = (s: string) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

/** จำนวนคิวต่อวัน (แถวของตาราง) ต่อแอดมิน: วัน -> ชื่อ (nameKey) -> จำนวน */
export function adminDayCounts(month: string, slots: RoomSlot[]) {
  const out = new Map<string, Map<string, number>>();
  for (const s of slots) {
    if (isShopeePlatform(s.platform)) continue;
    const { day } = roomPlace(s);
    if (!day.startsWith(`${month}-`)) continue;
    const m = out.get(day) ?? new Map<string, number>();
    out.set(day, m);
    for (const a of new Set(s.admins.map(nameKey).filter(Boolean))) m.set(a, (m.get(a) ?? 0) + 1);
  }
  return out;
}

/** "12/01" (เดือน/วัน แบบที่ทีมใช้) หรือ "01/12" (วัน/เดือน) -> YYYY-MM-DD ของเดือนนี้ · เดือนอื่น / ไม่ใช่วันที่ = null */
export function summaryDate(text: string, month: string) {
  const m = String(text ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
  if (!m) return null;
  const [y, mm] = month.split("-").map(Number);
  const a = Number(m[1]), b = Number(m[2]);
  const day = a === mm ? b : b === mm ? a : 0;
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return day >= 1 && day <= last ? `${month}-${String(day).padStart(2, "0")}` : null;
}

export type SummaryEdit = { row: number; col: number; value: number };

/**
 * ช่องที่ต้องกรอกใหม่ในสรุปวันหยุด
 *   grid = ข้อความที่เห็นในแท็บตั้งแต่แถวใต้ตาราง (row ที่คืน = ลำดับใน grid) · extra = ชื่อแอดมินเสริม (nameKey)
 */
export function adminSummaryEdits(grid: string[][], month: string, counts: Map<string, Map<string, number>>, extra: Set<string>): SummaryEdit[] {
  const out: SummaryEdit[] = [];
  const text = (r: number, c: number) => String(grid[r]?.[c] ?? "").trim();
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (text(r, c).toLowerCase() !== "date") continue;
      // คอลัมน์ทางขวาของหัว Date จนเจอช่องว่าง
      const cols: { col: number; key: string; extra: boolean }[] = [];
      for (let k = c + 1; text(r, k); k++) cols.push({ col: k, key: nameKey(text(r, k)), extra: /^admin\s*เสริม$/i.test(text(r, k)) });
      const own = new Set(cols.filter((x) => !x.extra).map((x) => x.key));
      for (let rr = r + 1; rr < grid.length; rr++) {
        const date = summaryDate(text(rr, c), month);
        if (!date) {
          if (/^\d{1,2}\/\d{1,2}/.test(text(rr, c))) continue; // วันที่ของเดือนอื่นในบล็อกเดียวกัน = ข้าม
          break;
        }
        const day = counts.get(date) ?? new Map<string, number>();
        for (const x of cols) {
          const cur = text(rr, x.col);
          if (cur && !/^\d+(\.\d+)?$/.test(cur)) continue; // off / Holiday / Sick leave ฯลฯ ที่ทีมพิมพ์
          const n = x.extra
            ? [...day].filter(([name]) => extra.has(name) && !own.has(name)).reduce((t, [, v]) => t + v, 0)
            : day.get(x.key) ?? 0;
          // ในเว็บยังไม่มีคิว = คงตัวเลขที่ทีมพิมพ์ไว้ (ผู้ใช้เลือก: แพลนล่วงหน้าก่อนแอดมินลงคิว)
          if (n && String(n) !== cur) out.push({ row: rr, col: x.col, value: n });
        }
      }
    }
  }
  return out;
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

/** แพลนของ Agency ที่ไลฟ์ในห้องของเรา (ตาราง agency_slots · เฉพาะกลุ่มใน ROOM_AGENCIES) */
export type RawAgency = { agency: string; platform: string; live_date: string; start_time: string; end_time: string };

/**
 * คิวที่ลงตาราง: ฝั่ง Mc มีแถวและไม่ได้แคน (ไม่มีแถว Mc = ดูฝั่ง Admin ที่ยังนับ) + แพลนของ Agency ที่ไลฟ์ในห้องของเรา
 *   ชื่อ Mc / Admin แสดงเฉพาะแถวที่ยังนับ (ไม่แคน + ไม่ได้ติ๊กไม่นับ) แบบเดียวกับการนับชั่วโมงทั้งเว็บ
 *   Agency เวลาเดียวกับแถว Admin = คิวเดียวกัน (แสดงชื่อแอดมินด้วย) · กลุ่มที่ไม่อยู่ใน ROOM_AGENCIES ไม่ลง
 */
export function pairRoomSlots(mc: RawSide[], admin: RawSide[], agency: RawAgency[] = []): RoomSlot[] {
  const hm = (t: string) => t.slice(0, 5);
  const key = (x: Pick<RawSide, "platform" | "live_date" | "start_time" | "end_time">) => `${x.platform}|${x.live_date}|${hm(x.start_time)}|${hm(x.end_time)}`;
  const counts = (x: RawSide) => !x.is_cancelled && x.confirmed !== false;
  type Entry = { base: Pick<RawSide, "platform" | "live_date" | "start_time" | "end_time">; mcRows: RawSide[]; adminRows: RawSide[]; agency: string | null };
  const map = new Map<string, Entry>();
  const at = (x: Entry["base"]) => {
    const k = key(x);
    const v = map.get(k) ?? { base: x, mcRows: [], adminRows: [], agency: null };
    map.set(k, v);
    return v;
  };
  for (const x of mc) at(x).mcRows.push(x);
  for (const x of admin) at(x).adminRows.push(x);
  for (const x of agency) if (ROOM_AGENCIES[x.agency] !== undefined) at(x).agency = x.agency;
  const out: RoomSlot[] = [];
  for (const { base, mcRows, adminRows, agency: group } of map.values()) {
    // คิวทีมเรามาก่อน (มีแถว Mc) · ไม่มีแถว Mc = Agency หรือฝั่ง Admin ที่ยังนับ
    const live = mcRows.length ? mcRows.some((x) => !x.is_cancelled) : !!group || adminRows.some(counts);
    if (!live) continue;
    const mcName = mcRows.find((x) => counts(x) && x.name)?.name ?? null;
    out.push({
      platform: base.platform, date: base.live_date, start: hm(base.start_time), end: hm(base.end_time),
      mc: mcName, admins: [...new Set(adminRows.filter((x) => counts(x) && x.name).map((x) => x.name!))],
      campaign: mcRows.find((x) => !x.is_cancelled)?.campaign ?? "",
      ...(group && !mcRows.length ? { agency: group } : {}),
    });
  }
  return mergeAgencyRuns(out);
}

/**
 * คิวของ Agency ที่ไลฟ์ต่อกัน = ช่องเดียว (แบบที่ทีมทำ เช่น "Agency TDH" 19:30–23:30)
 *   ต่อกัน = กลุ่ม + ช่องเดียวกัน คิวถัดไปเริ่มตอนคิวก่อนจบพอดี (ข้ามเที่ยงคืนได้) + แอดมินชุดเดียวกัน · รวมไม่เกิน 20 ชม.
 */
function mergeAgencyRuns(slots: RoomSlot[]): RoomSlot[] {
  const span = (s: RoomSlot) => {
    const a = Date.parse(`${s.date}T${s.start}:00Z`);
    return { a, b: a + (((mins(s.end) - mins(s.start) + 1440) % 1440) || 1440) * 60_000 };
  };
  const groups = new Map<string, RoomSlot[]>();
  for (const s of slots) if (s.agency) groups.set(`${s.agency}|${s.platform}`, [...(groups.get(`${s.agency}|${s.platform}`) ?? []), s]);
  if (!groups.size) return slots;
  const merged: RoomSlot[] = [];
  for (const list of groups.values()) {
    list.sort((x, y) => span(x).a - span(y).a);
    const runs: { slot: RoomSlot; from: number; to: number }[] = [];
    const admins = (s: RoomSlot) => [...s.admins].sort().join("|");
    for (const s of list) {
      const t = span(s);
      const last = runs[runs.length - 1];
      if (last && t.a === last.to && admins(last.slot) === admins(s) && t.b - last.from <= 20 * 3600_000) {
        last.slot = { ...last.slot, end: s.end };
        last.to = t.b;
      } else runs.push({ slot: { ...s }, from: t.a, to: t.b });
    }
    merged.push(...runs.map((r) => r.slot));
  }
  return [...slots.filter((s) => !s.agency), ...merged];
}
