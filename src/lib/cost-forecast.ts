// Forecast ค่าใช้จ่ายเดือนหน้าในแท็บ "Sum 2" (ชีตของทีม) — ฟังก์ชันล้วน (เทสได้ · src/lib/cost-forecast-sync.ts อ่าน / เขียนชีต)
//   ผู้ใช้ขอ 2026-11-19: Forecast ของเดือน M ล็อคไม่เกินสิ้นวันที่ 20 ของเดือนก่อนหน้า (เช่น ธ.ค. ล็อคสิ้นวันที่ 20 พ.ย.)
//     หลังล็อค เว็บไม่แตะคอลัมน์ Forecast ของเดือนนั้นอีก แพลนที่เปลี่ยนทีหลังไปอยู่ใน Actual
//   ก่อนล็อค เว็บอัปเดตคอลัมน์ Forecast ตามแพลนทุกวัน: ตาราง HR = ชั่วโมง · ตาราง THB = สูตร เรท × ชั่วโมง
//     Agency ใช้เรทในเว็บ (หน้า Cost / ROI) · In-house ใช้เรทเดิมในสูตรของชีต (ผู้ใช้เลือก)
//     แถว Admin / Total / Target / Plan vs Target ไม่แตะ (สูตร / ตัวเลขของทีม)
//   ล็อคแล้วเก็บตัวเลขชุดนั้นในเว็บ (ตาราง cost_forecasts) หน้า Cost ใช้ชุดที่ล็อคแทนตัวเลขในชีต

import { hasBudget } from "@/lib/agency-budget";
import { sheetMonth, type CostSheetEntry } from "@/lib/cost-sheet";
import { isShopeePlatform } from "@/lib/platform";

export const FORECAST_LOCK_DAY = 20;
const DAY = 86400_000;

/** "YYYY-MM" เลื่อนทีละเดือน */
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** เดือนตามเวลาไทย (by = เลื่อนกี่เดือน) */
export const bkkMonth = (now: number, by = 0) => shiftMonth(new Date(now + 7 * 3600_000).toISOString().slice(0, 7), by);

/** Forecast ของเดือนนี้ล็อคตอนไหน (ms): สิ้นวันที่ 20 ของเดือนก่อนหน้า เวลาไทย */
export const lockAt = (month: string) => Date.parse(`${shiftMonth(month, -1)}-${FORECAST_LOCK_DAY}T00:00:00+07:00`) + DAY;
/** ถึงเวลาล็อคแล้ว (เว็บไม่อัปเดตจากแพลนอีก) */
export const lockDue = (month: string, now: number) => now >= lockAt(month);

// ---------- ชั่วโมงจากแพลน ----------

export type ForecastSlot = { platform: string; shopeeTab: boolean; start: string; end: string; salaried: boolean };
export type ForecastAgencySlot = { agency: string; platform: string; start: string; end: string };
export type ForecastHours = {
  shopeeInHouse: number; tiktokInHouse: number; tiktokFulltime: number;
  agencies: { agency: string; app: "Shopee" | "TikTok"; hours: number }[];
};

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** ชั่วโมงของช่วงเวลา (ข้ามเที่ยงคืนได้ เช่น 22:00–02:00) */
const hoursOf = (start: string, end: string) => {
  const d = minutesOf(end) - minutesOf(start);
  return (d > 0 ? d : d + 24 * 60) / 60;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ชั่วโมงในแพลนของเดือน: คิวของ Mc ทีมเรา (slot ที่ไม่ถูกยกเลิก รวมที่ยังไม่มีคนจอง) + แพลนของกลุ่มภายนอก
 *   Mc ประจำ (เงินเดือน) = TikTok Fulltime · แพลนกลุ่ม "In house" ไม่นับซ้ำ (เป็นคิวของทีมเราเอง)
 */
export function forecastHours(mc: ForecastSlot[], agency: ForecastAgencySlot[]): ForecastHours {
  let shopeeInHouse = 0, tiktokInHouse = 0, tiktokFulltime = 0;
  for (const s of mc) {
    const h = hoursOf(s.start, s.end);
    if (s.shopeeTab || isShopeePlatform(s.platform)) shopeeInHouse += h;
    else {
      tiktokInHouse += h;
      if (s.salaried) tiktokFulltime += h;
    }
  }
  const groups = new Map<string, { agency: string; app: "Shopee" | "TikTok"; hours: number }>();
  for (const s of agency) {
    if (/^in\s*house$/i.test(s.agency.trim())) continue;
    const app = isShopeePlatform(s.platform) ? "Shopee" : "TikTok";
    const g = groups.get(`${s.agency}|${app}`) ?? { agency: s.agency, app, hours: 0 };
    g.hours += hoursOf(s.start, s.end);
    groups.set(`${s.agency}|${app}`, g);
  }
  return {
    shopeeInHouse: round2(shopeeInHouse), tiktokInHouse: round2(tiktokInHouse), tiktokFulltime: round2(tiktokFulltime),
    agencies: [...groups.values()].map((g) => ({ ...g, hours: round2(g.hours) })).sort((a, b) => a.agency.localeCompare(b.agency)),
  };
}

// ---------- ช่องที่ต้องเขียนในชีต ----------

export type ForecastGrid = {
  /** ค่าที่แสดงในชีต (หัวเดือนเป็นวันที่ ต้องอ่านแบบที่แสดง) */
  values: unknown[][];
  /** สูตร (ช่องที่ไม่มีสูตร = ค่าดิบ) */
  formulas: unknown[][];
};
export type ForecastWrite = { cell: string; value: string | number; label: string };
export type ForecastPlan = { writes: ForecastWrite[]; warnings: string[]; missing: string | null };

const text = (v: unknown) => String(v ?? "").trim();
/** เลขคอลัมน์ (0 = A) -> ตัวอักษร */
export function colLetter(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const a1 = (col: number, row: number) => `${colLetter(col)}${row + 1}`;

/** ชื่อแถวในชีต -> ชื่อกลุ่มในเว็บ (ตาราง agency_slots / agency_rates) */
function agencyOf(label: string) {
  const n = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (n.startsWith("infinit")) return "Infinite";
  if (n.startsWith("tuesday") || n === "tdh") return "TDH";
  if (n.startsWith("mcn")) return "MCN";
  if (n.startsWith("vis")) return "Vis";
  return label.trim();
}

const groupOf = (label: string) => {
  const n = label.toLowerCase().replace(/\s+/g, " ").trim();
  return n === "shopee" ? "shopee" : n === "tiktok" ? "tiktok" : n === "admin tiktok" ? "admin" : null;
};

/** แถวหนึ่งในตาราง -> key ของบรรทัด (แถวรวม / เป้า / Admin = null) */
function lineKey(group: string | null, label: string): { key: string; agency: string | null } | null {
  const n = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (!group || group === "admin" || !n || /^(total|target|plan vs target)/.test(n) || groupOf(label)) return null;
  if (n.startsWith("in-house") || n.startsWith("in house")) {
    if (group === "shopee") return { key: "shopee|inhouse", agency: null };
    return { key: n.includes("full") ? "tiktok|fulltime" : "tiktok|partime", agency: null };
  }
  const agency = agencyOf(label);
  return { key: `${group}|agency|${agency.toLowerCase()}`, agency };
}

/** สูตร "=500*C31" -> 500 (ไม่ใช่รูปแบบนี้ = null) */
export function rateInFormula(v: unknown) {
  const m = text(v).match(/^=\s*(\d+(?:\.\d+)?)\s*\*\s*\$?[A-Z]+\$?\d+\s*$/i);
  return m ? Number(m[1]) : null;
}

/** ช่องว่าง หรือเป็นเลข 0 ที่พิมพ์ไว้ (ไม่ใช่สูตร) */
function blankCell(v: unknown) {
  const t = text(v);
  return t === "" || (!t.startsWith("=") && Number(t.replace(/,/g, "")) === 0);
}

/** ค่าในช่องตอนนี้ตรงกับที่จะเขียนแล้ว (ตัวเลข 100 = "100" · สูตรเทียบตัวอักษรไม่สนช่องว่าง/ตัวพิมพ์) */
function same(cur: unknown, next: string | number) {
  if (typeof next === "number") return text(cur) !== "" && Number(text(cur).replace(/,/g, "")) === next;
  return text(cur).replace(/\s+/g, "").toUpperCase() === next.replace(/\s+/g, "").toUpperCase();
}

/**
 * ช่องที่ต้องเขียนในคอลัมน์ Forecast ของเดือนนี้ (เฉพาะช่องที่ค่าเปลี่ยน)
 *   rates = เรท Agency ของเดือนนี้ในเว็บ · ไม่ได้ตั้ง = ใช้เรทเดิมในสูตรของชีต (เดือนนี้ / เดือนก่อน) + เตือน
 *   missing = ชีตยังไม่มีคอลัมน์ Forecast ของเดือนนี้ (ทีมยังไม่ได้เพิ่ม) → ไม่เขียนอะไร
 */
/** "2026-12" -> "Dec 2026" (ชื่อเดือนแบบในชีต) */
const sheetLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
};

/** โครงแท็บ: แถวหัวตาราง (แถวที่มีชื่อเดือน) · หาตาราง / คอลัมน์ Forecast ของเดือน / บรรทัดในตาราง */
function layout(values: unknown[][]) {
  const headers = values.flatMap((r, i) => ((r ?? []).slice(1).some((c) => sheetMonth(c)) ? [i] : []));
  const tableAt = (name: string) => headers.find((i) => text(values[i]?.[0]).toUpperCase() === name);
  const forecastCol = (i: number, m: string) =>
    (values[i] ?? []).findIndex((c, col) => col > 0 && sheetMonth(c) === m && text(values[i - 1]?.[col]).toLowerCase() === "forecast");
  /** แถวในตาราง (ถึงก่อนหัวตารางถัดไป) พร้อม key ของบรรทัด (ไม่นับแถวรวม / เป้า / Admin) */
  const linesOf = (start: number) => {
    const end = headers.find((h) => h > start) ?? values.length;
    const out: { row: number; label: string; key: string; agency: string | null }[] = [];
    let group: string | null = null;
    for (let r = start + 1; r < end; r++) {
      const name = text(values[r]?.[0]);
      group = groupOf(name) ?? group;
      const line = lineKey(group, name);
      if (line) out.push({ row: r, label: name, ...line });
    }
    return out;
  };
  return { tableAt, forecastCol, linesOf };
}

/** ชั่วโมงไลฟ์รวมใน Forecast ของเดือนนี้ (ตาราง HR · Shopee + TikTok ทุกกลุ่มรวม Vis · ไม่นับ Admin = แถว "Total all" ในชีต) */
export function sheetForecastHours(values: unknown[][], month: string) {
  const { tableAt, forecastCol, linesOf } = layout(values);
  const hr = tableAt("HR");
  const col = hr === undefined ? -1 : forecastCol(hr, month);
  if (hr === undefined || col < 0) return 0;
  const sum = linesOf(hr).reduce((a, l) => {
    const n = Number(text(values[l.row]?.[col]).replace(/,/g, ""));
    return a + (Number.isFinite(n) ? n : 0);
  }, 0);
  return round2(sum);
}

export function forecastWrites(grid: ForecastGrid, month: string, hours: ForecastHours, rates: Map<string, number>): ForecastPlan {
  const { values, formulas } = grid;
  const label = sheetLabel(month);
  const { tableAt, forecastCol, linesOf } = layout(values);
  const thb = tableAt("THB"), hr = tableAt("HR");
  const none = (missing: string): ForecastPlan => ({ writes: [], warnings: [], missing });
  if (thb === undefined || hr === undefined) return none('ไม่พบตาราง THB / HR ในแท็บ "Sum 2"');
  const thbCol = forecastCol(thb, month), hrCol = forecastCol(hr, month);
  if (thbCol < 0 || hrCol < 0) return none(`แท็บ "Sum 2" ยังไม่มีคอลัมน์ Forecast ${label}`);
  const prevThbCol = forecastCol(thb, shiftMonth(month, -1));

  const writes: ForecastWrite[] = [];
  const warnings: string[] = [];
  const put = (col: number, row: number, value: string | number, what: string) => {
    if (!same(formulas[row]?.[col], value)) writes.push({ cell: a1(col, row), value, label: what });
  };

  // ตาราง HR: ชั่วโมง
  const hrLines = linesOf(hr);
  const hrRow = new Map(hrLines.map((l) => [l.key, l.row]));
  /** ชั่วโมงของบรรทัด (ไว้ข้ามสูตรเงินของกลุ่มที่ไม่มีแพลน) */
  const lineHours = new Map<string, number>();
  const used = new Set<string>();
  for (const l of hrLines) {
    const app = l.key.startsWith("shopee") ? "Shopee" : "TikTok";
    if (l.key === "shopee|inhouse") {
      lineHours.set(l.key, hours.shopeeInHouse);
      put(hrCol, l.row, hours.shopeeInHouse, `ชม. ${l.label} (Shopee)`);
    } else if (l.key === "tiktok|fulltime") {
      lineHours.set(l.key, hours.tiktokFulltime);
      put(hrCol, l.row, hours.tiktokFulltime, `ชม. ${l.label}`);
    } else if (l.key === "tiktok|partime") {
      const full = hrRow.get("tiktok|fulltime");
      lineHours.set(l.key, round2(hours.tiktokInHouse - hours.tiktokFulltime));
      put(hrCol, l.row, full === undefined ? round2(hours.tiktokInHouse - hours.tiktokFulltime) : `=${hours.tiktokInHouse}-${a1(hrCol, full)}`, `ชม. ${l.label}`);
    } else if (l.agency) {
      const g = hours.agencies.find((x) => x.app === app && x.agency.toLowerCase() === l.agency!.toLowerCase());
      if (g) used.add(`${g.agency}|${g.app}`);
      lineHours.set(l.key, g?.hours ?? 0);
      put(hrCol, l.row, g?.hours ?? 0, `ชม. ${l.label} (${app})`);
    }
  }
  for (const g of hours.agencies) {
    if (g.hours && !used.has(`${g.agency}|${g.app}`)) warnings.push(`แพลน ${g.agency} (${g.app}) ${g.hours} ชม. ไม่มีแถวในตาราง HR ของชีต จึงไม่ได้ใส่`);
  }

  // ตาราง THB: สูตร เรท × ชั่วโมง
  for (const l of linesOf(thb)) {
    const row = hrRow.get(l.key);
    if (row === undefined || l.key === "tiktok|fulltime") continue; // ไม่มีแถวชั่วโมงคู่กัน / Fulltime = เงินเดือน ระบบไม่มีตัวเลข
    const sheetRate = rateInFormula(formulas[l.row]?.[thbCol]) ?? (prevThbCol >= 0 ? rateInFormula(formulas[l.row]?.[prevThbCol]) : null);
    let rate: number | null;
    if (!l.agency) {
      rate = sheetRate;
      if (rate === null) warnings.push(`ไม่พบเรท In-house ในสูตรของชีต (แถว ${l.label}) จึงไม่ได้ใส่สูตรเงิน`);
    } else {
      if (!hasBudget(l.agency)) continue; // Vis ไม่คิดค่าใช้จ่าย
      // กลุ่มที่ไม่มีแพลนเดือนนี้ และช่องเงินยังว่าง / 0: ไม่ต้องใส่สูตร (ไม่ให้ช่องเปลี่ยนโดยไม่จำเป็น)
      if (!lineHours.get(l.key) && blankCell(formulas[l.row]?.[thbCol])) continue;
      rate = rates.get(l.agency) ?? null;
      if (rate === null) {
        rate = sheetRate;
        warnings.push(rate === null
          ? `ยังไม่ได้ตั้งเรท ${l.agency} ของ${label} ในเว็บ และในชีตไม่มีเรทเดิม จึงไม่ได้ใส่สูตรเงิน`
          : `ยังไม่ได้ตั้งเรท ${l.agency} ของ${label} ในเว็บ ใช้เรทเดิมในชีต ${rate}`);
      }
    }
    if (rate !== null) put(thbCol, l.row, `=${rate}*${a1(hrCol, row)}`, `เงิน ${l.label} (${rate}/ชม.)`);
  }
  return { writes, warnings, missing: null };
}

// ---------- ชุดที่ล็อคแล้ว ----------

export type ForecastEntry = Pick<CostSheetEntry, "app" | "owner" | "kind" | "forecast" | "forecastHours">;
export type LockedForecast = { month: string; entries: ForecastEntry[]; total: number; hours: number; lockedAt: string; lockedBy: string };

/** สถานะ Forecast ของเดือนหนึ่ง (GET /api/cost/forecast) */
export type ForecastStatus = {
  month: string;
  /** ล็อคตอนไหน (ms) / ถึงเวลาแล้ว */
  lockAt: number; due: boolean;
  locked: LockedForecast | null;
  /** ตัวเลขในชีตตอนนี้ · ไม่มี / อ่านไม่ได้ = null (+ error) */
  sheet: { total: number; hours: number } | null;
  /** ครั้งล่าสุดที่เขียนจากแพลน / ล็อค / ปลดล็อค */
  last: { at: string; action: string } | null;
  error: string | null;
};

/** เงินรวมของชุด Forecast (ทุกบรรทัด) */
export const forecastTotal = (entries: ForecastEntry[]) => round2(entries.reduce((a, e) => a + (e.forecast ?? 0), 0));

/** ตัวเลข Forecast ของเดือนนี้จากชีต (เก็บตอนล็อค) */
export const forecastEntriesOf = (entries: CostSheetEntry[] | undefined): ForecastEntry[] =>
  (entries ?? []).filter((e) => e.forecast !== null).map((e) => ({ app: e.app, owner: e.owner, kind: e.kind, forecast: e.forecast, forecastHours: e.forecastHours }));

/** เดือนที่ล็อคแล้ว: ใช้ Forecast ชุดที่ล็อคแทนตัวเลขในชีต (Actual ในชีตใช้ตามเดิม) */
export function withLockedForecasts(months: Map<string, CostSheetEntry[]>, locks: Pick<LockedForecast, "month" | "entries">[]) {
  if (!locks.length) return months;
  const out = new Map(months);
  for (const l of locks) {
    const list: CostSheetEntry[] = (out.get(l.month) ?? []).map((e) => ({ ...e, forecast: null, forecastHours: null }));
    for (const f of l.entries) {
      const i = list.findIndex((e) => e.app === f.app && e.owner === f.owner && e.kind === f.kind);
      if (i >= 0) list[i] = { ...list[i], forecast: f.forecast, forecastHours: f.forecastHours };
      else list.push({ ...f, actual: null, actualHours: null });
    }
    out.set(l.month, list.filter((e) => e.actual !== null || e.forecast !== null));
  }
  return out;
}
