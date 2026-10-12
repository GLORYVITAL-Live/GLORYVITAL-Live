import type { CeoSession } from "@/lib/types";

// อ่านตาราง "Session Ceo Live" จากชีตที่ track แยก (วางจาก Google Sheet / ไฟล์ Excel)
//   แถวหัว = "Session Ceo Live" | 3 Mar ceo live | 23 May ... (วันที่ + ชื่อ) · แถวต่อมา = ตัวชี้วัด (GMV / Order / CTR ...)
//   วางทั้งชีตได้ (มีตาราง Before / Ceo Live ด้วย) ระบบหยิบเฉพาะตาราง Session — ยอดทั้งวันระบบคิดเองจากไฟล์ Export

const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const pad = (n: number) => String(n).padStart(2, "0");
function isoDate(y: number, m: number, d: number) {
  if (y > 2400) y -= 543; // พ.ศ.
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** หัวคอลัมน์ -> วันที่ + ชื่อ เช่น "3 Mar ceo live" -> 2026-03-03 "ceo live" (ไม่มีปี = ใช้ year) */
export function parseHeaderDate(text: string, year: number): { date: string; title: string } | null {
  const s = text.trim().replace(/\s+/g, " ");
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s*(.*)$/);
  if (m) { const date = isoDate(+m[1], +m[2], +m[3]); return date ? { date, title: m[4] } : null; }
  // วันที่จาก Excel ที่เป็นตัวเลข (นับวันจาก 30 ธ.ค. 1899)
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400_000);
    return { date: d.toISOString().slice(0, 10), title: "" };
  }
  m = s.match(/^(\d{1,2})\s*([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?\b\s*(.*)$/);
  if (m) {
    const mon = EN_MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const date = mon ? isoDate(m[3] ? +m[3] : year, mon, +m[1]) : null;
    return date ? { date, title: m[4] } : null;
  }
  for (let i = 0; i < 12; i++) {
    const th = TH_MONTHS[i].replace(/\./g, "\\.?");
    m = s.match(new RegExp(`^(\\d{1,2})\\s*${th}(?:\\s*(\\d{4}))?\\s*(.*)$`));
    if (m) { const date = isoDate(m[2] ? +m[2] : year, i + 1, +m[1]); return date ? { date, title: m[3] } : null; }
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(.*)$/);
  if (m) { const date = isoDate(m[3] ? +m[3] : year, +m[2], +m[1]); return date ? { date, title: m[4] } : null; }
  return null;
}

/** ตัวเลขในชีต: "132,456" / "฿1,234.5" / "24.36%" -> ตัวเลข (ว่าง / อ่านไม่ได้ = null) */
export function parseNum(text: string) {
  const s = text.replace(/[,\s฿%]/g, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** อัตรา: "24.36%" -> 0.2436 / 0.2436 (ค่าจาก Excel) -> 0.2436 / 24.36 (ไม่มี %) -> 0.2436 */
export function parseRate(text: string) {
  const n = parseNum(text);
  if (n === null) return null;
  return text.includes("%") || n > 1 ? n / 100 : n;
}

type Field = "gmv" | "durationHr" | "orders" | "viewers" | "views" | "peakViewers" | "peakTime" | "timeRange" | "impressions" | "ctr" | "co" | "skip";
/** ชื่อแถว (ตัดช่องว่าง จุด / - ( ) และตัวพิมพ์เล็ก) -> ช่องข้อมูล */
const FIELDS: [RegExp, Field][] = [
  [/^gmv$|^ยอดขาย$/, "gmv"],
  [/^gmv(per)?hr$|^gmvต่อชม$/, "skip"], // คำนวณเอง = GMV ÷ ชั่วโมง
  [/^duration(hr|hrs|hour|hours)?$|^ชั่วโมง(ไลฟ์)?$|^ชม$/, "durationHr"],
  [/^orders?$|^ออเดอร์$/, "orders"],
  [/^viewers?$|^ผู้ชม$/, "viewers"],
  [/^views?$|^ยอดวิว$/, "views"],
  [/^peakviewers?$/, "peakViewers"],
  [/^peaktime(viewers?)?$/, "peakTime"],
  [/^time$|^เวลา$|^ช่วงเวลา$/, "timeRange"],
  [/^(product)?impressions?$/, "impressions"],
  [/^ctr$/, "ctr"],
  [/^co$/, "co"],
];
const labelKey = (s: string) => s.toLowerCase().replace(/[\s./\-()]/g, "");
const fieldOf = (label: string) => FIELDS.find(([re]) => re.test(labelKey(label)))?.[1] ?? null;

const empty = (date: string, title: string): CeoSession => ({
  date, title, timeRange: "", durationHr: null, gmv: null, orders: null, viewers: null, views: null,
  peakViewers: null, peakTime: "", impressions: null, ctr: null, co: null,
});

/** แยกข้อความที่วางจาก Google Sheet / Excel เป็นตาราง (คั่นด้วย Tab) */
export const splitPasted = (text: string) => text.replace(/\r/g, "").split("\n").map((line) => line.split("\t"));

/** ไฟล์ .csv -> ตาราง (รองรับช่องที่มี "..." คอมมา / ขึ้นบรรทัดใหม่ข้างใน) */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let cell = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { rows.at(-1)!.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      rows.at(-1)!.push(cell); cell = ""; rows.push([]);
    } else cell += ch;
  }
  rows.at(-1)!.push(cell);
  return rows;
}

/** มีตาราง Session Ceo Live ในตารางนี้ไหม (ใช้หาแท็บในไฟล์ที่มีหลายชีต) */
export function hasCeoSheet(rows: string[][], year: number) {
  try { return parseCeoSheet(rows, year).sessions.length > 0; } catch { return false; }
}

/**
 * อ่านตาราง Session Ceo Live: คืนรอบ CEO ทีละวัน + คำเตือน (คอลัมน์ / แถวที่อ่านไม่ได้)
 *   year = ปีของหัวคอลัมน์ที่ไม่มีปี (เช่น "3 Mar")
 */
export function parseCeoSheet(input: string[][], year: number): { sessions: CeoSession[]; warnings: string[] } {
  const rows = input.map((r) => r.map((c) => String(c ?? "").trim()));
  const warnings: string[] = [];
  const isEmpty = (r: string[] | undefined) => !r || r.every((c) => !c);
  const datesIn = (r: string[]) => r.slice(1).filter((c) => c && parseHeaderDate(c, year)).length;

  // แถวหัว: ช่องแรกมีคำว่า session + ceo · ไม่เจอ = แถวแรกที่มีวันที่ และแถวถัดไปเป็นตัวชี้วัด
  let h = rows.findIndex((r) => /session/i.test(r[0] ?? "") && /ceo/i.test(r[0] ?? ""));
  if (h < 0) h = rows.findIndex((r, i) => datesIn(r) > 0 && !!fieldOf(rows[i + 1]?.[0] ?? ""));
  if (h < 0) throw new Error("ไม่พบตาราง \"Session Ceo Live\" — คัดลอกตั้งแต่แถวหัว (Session Ceo Live | วันที่ ...) ลงมาถึงแถว CO");

  const cols = rows[h].map((text, j) => {
    if (j === 0 || !text) return null;
    const d = parseHeaderDate(text, year);
    if (!d) warnings.push(`หัวคอลัมน์ "${text}" อ่านวันที่ไม่ได้ (ใช้แบบ "3 Mar" หรือ "3/3/2026") ข้าม`);
    return d;
  });
  const sessions = cols.map((c) => (c ? empty(c.date, c.title.trim()) : null));

  for (let i = h + 1; i < rows.length && !isEmpty(rows[i]); i++) {
    const r = rows[i];
    const field = fieldOf(r[0] ?? "");
    if (!field) {
      if (/ceo|before|session/i.test(r[0] ?? "") || datesIn(r) > 0) break; // ตารางถัดไป
      if (r[0]) warnings.push(`แถว "${r[0]}" ไม่รู้จัก ข้าม`);
      continue;
    }
    if (field === "skip") continue;
    r.forEach((text, j) => {
      const s = sessions[j];
      if (!s || !text) return;
      if (field === "peakTime" || field === "timeRange") s[field] = text;
      else if (field === "ctr" || field === "co") s[field] = parseRate(text);
      else {
        const n = parseNum(text);
        if (n === null) warnings.push(`${s.date} แถว "${r[0]}": "${text}" ไม่ใช่ตัวเลข ข้าม`);
        else s[field] = field === "gmv" || field === "durationHr" ? n : Math.round(n);
      }
    });
  }

  // คอลัมน์ที่ไม่มีตัวเลขเลย = ไม่นับ · วันซ้ำ = ใช้คอลัมน์หลังสุด
  const byDate = new Map<string, CeoSession>();
  for (const s of sessions) {
    if (!s) continue;
    if (s.gmv === null && s.orders === null && s.views === null && s.impressions === null) continue;
    if (byDate.has(s.date)) warnings.push(`วันที่ ${s.date} ซ้ำ ใช้คอลัมน์หลังสุด`);
    byDate.set(s.date, s);
  }
  return { sessions: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), warnings };
}
