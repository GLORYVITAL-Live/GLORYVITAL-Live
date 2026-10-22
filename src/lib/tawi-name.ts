// ใบ 50 ทวิ (หนังสือรับรองการหักภาษี ณ ที่จ่าย): อ่านเดือน + ชื่อจริงจากชื่อไฟล์ใน Google Drive — ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ
//   รูปแบบที่เจอ (ตัวอักษรหน้าเลขเอกสารมีทั้ง WT / WTI / WHT)
//     <บริษัท> (สำนักงานใหญ่)_WT2026060032_น.ส.ชื่อ นามสกุล (สำนักงานใหญ่).pdf
//     WTI-20260900067-ชื่อ นามสกุล.pdf
//     WHT นาย ชื่อ นามสกุล.pdf            (ไม่มีเลขเอกสาร = ใช้เดือนจากชื่อโฟลเดอร์)
//   เลขเอกสาร 6 หลักแรก = ปี ค.ศ. + เดือน (YYYYMM)

const pad = (n: number) => String(n).padStart(2, "0");
const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "YYYY-MM" ถูกรูปแบบ (ปี 2000–2099) */
export const isMonthKey = (m: string) => /^20\d\d-(0[1-9]|1[0-2])$/.test(m);

/** "2026-09" -> "ก.ย. 2026" */
export const tawiMonthLabel = (m: string) => (isMonthKey(m) ? `${TH_MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : m);

/** ตัวอักษรหน้าเลขเอกสาร (WT / WTI / WHT / WHT-) + เลขเอกสาร (ถ้ามี) + ตัวคั่น */
const DOC_RE = /(?<![a-z])W\s?H?T\s?I?(?![a-z])[\s\-_]*(\d*)[\s\-_]*/i;

/** เลขเอกสาร -> "YYYY-MM" (ไม่มี / ผิดรูปแบบ = null) */
export function monthFromDocNo(name: string): string | null {
  const m = name.match(/(?<![a-z])W\s?H?T\s?I?[\s\-_]*(20\d\d)(\d\d)\d{2,}/i);
  if (!m) return null;
  const key = `${m[1]}-${m[2]}`;
  return isMonthKey(key) ? key : null;
}

/**
 * ชื่อโฟลเดอร์รายเดือน -> "YYYY-MM" ("09Sep", "04Apr.", "06JUN", "2026-09", "Sep 2026")
 *   ไม่มีปีในชื่อ = ปีปัจจุบัน (เวลาไทย) ถ้าเดือนนั้นยังไม่มาถึง = ปีก่อน · อ่านไม่ได้ = null
 */
export function monthFromFolder(folder: string, now = Date.now()): string | null {
  const s = folder.trim().toLowerCase();
  const year = s.match(/(?:^|\D)(20\d\d)(?!\d)/)?.[1];
  const rest = year ? s.replace(year, " ") : s;
  let month = 0;
  const num = rest.match(/(?:^|\D)(\d{1,2})(?!\d)/);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= 12) month = Number(num[1]);
  else {
    const i = EN_MONTHS.findIndex((m) => rest.includes(m));
    if (i >= 0) month = i + 1;
  }
  if (!month) return null;
  if (year) return `${year}-${pad(month)}`;
  const bkk = new Date(now + 7 * 3600_000);
  const y = bkk.getUTCFullYear(), cur = bkk.getUTCMonth() + 1;
  return `${month > cur ? y - 1 : y}-${pad(month)}`;
}

// คำนำหน้าชื่อ (ยาวก่อนสั้น: "นางสาว" ก่อน "นาง") — มี / ไม่มีจุด / ไม่มีเว้นวรรคหลังคำนำหน้าก็ได้
const TITLES = [
  "ว่าที่ร้อยตรีหญิง", "ว่าที่ร้อยตรี", "ว่าที่ ร.ต.หญิง", "ว่าที่ ร.ต.", "ว่าที่ร.ต.", "นางสาว", "เด็กหญิง", "เด็กชาย",
  "น.ส.", "น.ส", "นส.", "ด.ญ.", "ด.ช.", "นาง", "นาย",
];
const TITLE_RE = new RegExp(`^(?:${TITLES.map((t) => t.replace(/[.]/g, "\\.")).join("|")})\\s*`);
const EN_TITLE_RE = /^(?:mrs|mr|ms|miss|mister)(?:\.\s*|\s+)/i;

/** ตัดคำนำหน้าชื่อ (ซ้อนได้ เช่น "Mr. นาย") */
export function stripTitle(name: string) {
  let s = name.trim(), prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(TITLE_RE, "").replace(EN_TITLE_RE, "").trim();
  }
  return s;
}

/** ทำความสะอาดชื่อที่อ่านได้: ตัดวงเล็บ (สำนักงานใหญ่) / คำนำหน้า / ขีด เลขท้าย / ช่องว่างซ้ำ */
export function cleanRealName(raw: string) {
  const s = raw
    .normalize("NFC")
    .replace(/ํา/g, "ำ") // "ํา" (นิคหิต + า) พิมพ์ต่างกัน = "ำ"
    .replace(/[​-‍﻿]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s\-–.]+|[\s\-–.]+$/g, "")
    .replace(/\s+\d{1,3}$/, ""); // "ชื่อ นามสกุล 2" (ไฟล์ซ้ำ)
  return stripTitle(s).replace(/\s+/g, " ").trim();
}

/**
 * คีย์สำหรับเทียบชื่อ: ตัดคำนำหน้า + ช่องว่าง / จุด / ขีด ทั้งหมด, ตัวพิมพ์เล็ก ("นาย สมชาย  ใจดี" = "สมชายใจดี")
 *   สระ / วรรณยุกต์ตัวเดียวกันที่พิมพ์ซ้อน = ตัวเดียว ("สุุกฤตา" = "สุกฤตา" — ไฟล์ใบ 50 ทวิพิมพ์ซ้อนมา เจ้าตัวกรอกชื่อถูกแต่ไม่ตรง)
 */
export function tawiNameKey(name: string) {
  return cleanRealName(name).normalize("NFC").toLowerCase().replace(/[\s.\-–'’]/g, "")
    .replace(/([ัิ-ฺ็-๎])\1+/g, "$1");
}

export type TawiParsed = { month: string; realName: string; nameKey: string; docNo: boolean };

/**
 * ชื่อไฟล์ + ชื่อโฟลเดอร์เดือน -> เดือน + ชื่อจริง (ไม่ใช่ PDF / อ่านชื่อไม่ได้ / ไม่รู้เดือน = null)
 *   เดือน: เลขเอกสาร WHT ก่อน (ไม่มี = เดือนของโฟลเดอร์ fallbackMonth หรืออ่านจากชื่อโฟลเดอร์)
 */
export function parseTawiFile(fileName: string, folder: string, opts: { now?: number; fallbackMonth?: string | null } = {}): TawiParsed | null {
  const name = fileName.normalize("NFC").trim();
  if (!/\.pdf$/i.test(name)) return null;
  const base = name.replace(/\.pdf$/i, "");
  const docMonth = monthFromDocNo(base);
  const month = docMonth ?? opts.fallbackMonth ?? monthFromFolder(folder, opts.now);
  if (!month || !isMonthKey(month)) return null;

  // ชื่อคน = ส่วนหลังเลขเอกสาร (หรือหลังคำว่า WHT) · ไม่มี = ส่วนท้ายหลัง "_"
  const doc = base.match(DOC_RE);
  let raw = doc ? base.slice(doc.index! + doc[0].length) : base;
  if (!doc && raw.includes("_")) raw = raw.slice(raw.lastIndexOf("_") + 1);
  // เผื่อมีส่วนต่อท้ายด้วย "_" อีก (เช่น _สำเนา) เอาส่วนแรกที่มีตัวอักษร
  if (raw.includes("_")) raw = raw.split("_").find((p) => /[ก-๙a-z]/i.test(cleanRealName(p))) ?? raw;
  const realName = cleanRealName(raw);
  const nameKey = tawiNameKey(realName);
  if (nameKey.length < 2 || !/[ก-๙a-z]/i.test(nameKey)) return null;
  // ผู้รับเงินเป็นนิติบุคคล (บริษัท / หจก.) ไม่ใช่ Mc / Admin รายคน = ข้าม
  if (isCompany(realName)) return null;
  return { month, realName, nameKey, docNo: !!docMonth };
}

/** ชื่อนิติบุคคล */
export const isCompany = (name: string) => /^(บริษัท|บจก\.?|ห้างหุ้นส่วน|หจก\.?)|(จำกัด|\(มหาชน\)|co\.,?\s*ltd\.?|company limited)$/i.test(name.trim());

/** เดือนที่พบบ่อยสุดจากเลขเอกสารในโฟลเดอร์ (ใช้กับไฟล์ที่ไม่มีเลข) ไม่มี = null */
export function dominantMonth(fileNames: string[]) {
  const count = new Map<string, number>();
  for (const n of fileNames) {
    const m = monthFromDocNo(n);
    if (m) count.set(m, (count.get(m) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ---------- ชื่อใกล้เคียง (แนะนำให้ Owner ตอนจับคู่เอง) ----------

/** ความเหมือนของสองคีย์ 0–1 (Dice coefficient จากคู่ตัวอักษร) */
export function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a), gb = grams(b);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * hit) / total;
}

export type TawiCandidate = { id: number; label: string; keys: string[]; nick: string };

/**
 * คนที่น่าจะใช่สำหรับชื่อจริงจากไฟล์ (มากไปน้อย ไม่เกิน limit คน)
 *   keys = คีย์ชื่อจริงที่รู้ (legal_name / ชื่อในเอกสารทำเบิก / ไฟล์ที่เคยจับคู่) · nick = ชื่อในระบบ (ชื่อเล่น / ชื่อจริงบางคน)
 */
export function suggestPeople(realName: string, people: TawiCandidate[], limit = 3) {
  const nameKey = tawiNameKey(realName);
  const first = cleanRealName(realName).split(" ")[0];
  const scored = people.map((p) => {
    let score = Math.max(0, ...p.keys.map((k) => similarity(nameKey, k)));
    // ชื่อในระบบ = ชื่อต้นของชื่อจริง (บางคนลงชื่อจริง) หรือชื่อในระบบยาวพอและอยู่ในชื่อจริง
    const nick = tawiNameKey(p.nick.replace(/^(mc|admin|แอดมิน)\s*/i, ""));
    if (nick.length >= 3 && (nameKey.startsWith(nick) || (nick.length >= 4 && nameKey.includes(nick)))) score = Math.max(score, 0.6);
    else if (nick && first && tawiNameKey(first) === nick) score = Math.max(score, 0.6);
    return { id: p.id, label: p.label, score };
  });
  return scored.filter((s) => s.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, limit);
}
