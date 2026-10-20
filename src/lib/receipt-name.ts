// เอกสารรับเงินใน Google Drive: อ่านชื่อคนจากชื่อไฟล์ / ชื่อโฟลเดอร์ + ตัดสินจับคู่กับรายชื่อ — ฟังก์ชันล้วน (เทสได้)
//   รูปแบบไฟล์เก่าที่ทีมบัญชีอัปเอง (ชื่อเล่น ไม่มีชื่อจริง):
//     "Julyเอกสารรับเงิน Mc ชื่อเล่น" · "Sep อกสารรับเงิน Mcชื่อเล่น.jpg" · "Juneเอกสารเซ็นรับเงินMc ชื่อเล่น(shopee).jpg"
//     "Aug เอกสารรับเงิน Admin ชื่อเล่น" · "...MCN ชื่อเล่น" · "...Mc ชื่อเล่น tiktok.jpg"
//   รูปแบบที่เว็บสร้าง: โฟลเดอร์คน "Mc ชื่อเล่น (ชื่อ นามสกุล)" > "เอกสารรับเงิน 2026-10.pdf" · แบบแรก "Mc ชื่อเล่น - 2026-10.pdf"
import { isCompany, similarity, tawiNameKey } from "@/lib/tawi-name";

export type Role = "mc" | "admin";

/** วงเล็บ / คำท้ายที่เป็นชื่อแพลตฟอร์ม (ไม่ใช่ชื่อคน) */
const PLATFORM_RE = /^(shopee|tiktok|tik tok|lazada|facebook|fb|line|youtube|instagram|ig)$/i;
const EXT_RE = /\.(jpe?g|png|pdf|webp|heic|heif|gif)$/i;
const EN_MONTH_RE = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)(?![a-z])\.?/i;
const TH_MONTH_RE = /^(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)/;
// "เอกสารรับเงิน" รวมที่พิมพ์ตกหล่น ("อกสารรับเงิน" / "เอกสารรรับเงิน") + "เอกสารเซ็นรับเงิน" / "ใบสำคัญรับเงิน"
const DOC_RE = /เ?อกสาร\s*(?:เซ็น\s*)?ร+ับ\s*เงิน|ใบสำคัญรับเงิน|ใบรับเงิน/;
// บทบาทหน้าชื่อ: "Mc" / "MC" / "MCN" / "Admin" / "แอดมิน" (ตามด้วยช่องว่างหรือตัวไทยได้ — ห้ามตามด้วยอังกฤษ เช่น "Mcdonald")
const ROLE_RE = /^(mcn|mc|admin|แอดมิน)(?![a-z])\s*/i;

export type ReceiptName = {
  /** "YYYY-MM" ที่อยู่ในชื่อ (แบบที่เว็บตั้ง) ไม่มี = null */
  month: string | null;
  /** บทบาทจากคำหน้าชื่อ (ไม่มี = null ใช้โฟลเดอร์ Mc / Admin แทน) */
  role: Role | null;
  /** ชื่อเล่น / ชื่อที่เขียนไว้ (ไม่มีคำนำหน้าบทบาท) */
  nick: string;
  /** ชื่อจริงในวงเล็บ (แบบโฟลเดอร์ที่เว็บสร้าง) */
  realName: string | null;
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * ชื่อไฟล์ / ชื่อโฟลเดอร์ -> บทบาท + ชื่อเล่น + ชื่อจริง (ถ้ามี) · ไม่มีชื่อคน = nick "" และ realName null
 *   ใบแจ้งหนี้บริษัท = null
 */
export function parseReceiptName(raw: string): ReceiptName | null {
  let s = squash(raw.normalize("NFC").replace(/ํา/g, "ำ").replace(/[​-‍﻿]/g, "").replace(EXT_RE, ""));
  // ตัวอักษรขยะหน้าชื่อ (เช่น วรรณยุกต์ที่พิมพ์เกิน)
  s = s.replace(/^[^\p{L}\p{N}]+/u, "");
  if (!s || isCompany(s.split(/[_]/)[0]) || /^(บริษัท|บจก)/.test(s)) return null;

  let month: string | null = null;
  s = s.replace(/[\s\-–_]*(20\d\d)-(0[1-9]|1[0-2])(?!\d)[\s\-–_]*/, (_m, y: string, m: string) => {
    month = `${y}-${m}`;
    return " ";
  });
  s = squash(s).replace(EN_MONTH_RE, "").replace(TH_MONTH_RE, "");
  s = squash(s.replace(DOC_RE, " "));

  let role: Role | null = null;
  const r = s.match(ROLE_RE);
  if (r) {
    role = /^admin|แอดมิน/i.test(r[1]) ? "admin" : "mc";
    s = s.slice(r[0].length);
  }

  // วงเล็บ: ชื่อแพลตฟอร์ม = ตัดทิ้ง · อย่างอื่นที่มีตัวอักษร = ชื่อจริง (แบบโฟลเดอร์ที่เว็บสร้าง)
  let realName: string | null = null;
  s = s.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const t = squash(inner);
    if (!realName && !PLATFORM_RE.test(t) && /[\p{L}]{2,}/u.test(t)) realName = t;
    return " ";
  });
  const nick = squash(s).split(" ").filter((w) => !PLATFORM_RE.test(w)).join(" ").replace(/^[\s\-–_.,]+|[\s\-–_.,]+$/g, "");
  return { month, role, nick, realName };
}

/** คีย์ชื่อเล่นสำหรับเทียบ: ตัด "Mc" / "Admin" หน้าชื่อ + ช่องว่าง / จุด / ขีด, ตัวพิมพ์เล็ก ("Mc  ปลื้ม" = "ปลื้ม") */
export function nickKey(name: string) {
  const s = squash(name.normalize("NFC").replace(/ํา/g, "ำ")).replace(ROLE_RE, "");
  return s.toLowerCase().replace(/[\s.\-–_'’]/g, "");
}

/** คีย์ของไฟล์ที่ใช้จำการจับคู่: ชื่อเล่น (n:) ก่อน ไม่มีชื่อเล่น = ชื่อจริง (r:) */
export function receiptNameKey(p: Pick<ReceiptName, "nick" | "realName">) {
  if (p.nick && nickKey(p.nick)) return `n:${nickKey(p.nick)}`;
  return p.realName ? `r:${tawiNameKey(p.realName)}` : "";
}

/**
 * ไฟล์ใน Drive -> เดือน + บทบาท + ชื่อ (อ่านไม่ได้ = null)
 *   ชื่อไฟล์ไม่มีชื่อคน (เช่น "เอกสารรับเงิน 2026-10.pdf" ในโฟลเดอร์คน) = ใช้ชื่อโฟลเดอร์ย่อยแทน
 *   เดือน: "YYYY-MM" ในชื่อไฟล์ก่อน ไม่มี = เดือนของโฟลเดอร์ · บทบาท: คำหน้าชื่อก่อน ไม่มี = โฟลเดอร์ Mc / Admin
 */
export function parseReceiptFile(fileName: string, ctx: { month: string; role: Role; subfolder?: string | null }) {
  const own = parseReceiptName(fileName);
  if (!own) return null; // ใบแจ้งหนี้บริษัท
  const fromFolder = ctx.subfolder ? parseReceiptName(ctx.subfolder) : null;
  // ไฟล์ที่ไม่มีชื่อคนเลย (เหลือแต่คำว่าเอกสาร / เดือน) ใช้ชื่อโฟลเดอร์ย่อย
  const p = own.nick || own.realName ? own : fromFolder;
  if (!p || !(p.nick || p.realName)) return null;
  const key = receiptNameKey(p);
  if (key.length < 3) return null;
  return {
    month: own.month ?? ctx.month, role: p.role ?? ctx.role, nick: p.nick,
    realName: p.realName ?? (p === own ? fromFolder?.realName : null) ?? null, key,
  };
}

/** "2026" + "09 September" / "9 Sep" / "September" -> "2026-09" (อ่านไม่ได้ = null) */
export function receiptFolderMonth(year: string, folder: string) {
  if (!/^20\d\d$/.test(year.trim())) return null;
  const s = folder.trim().toLowerCase();
  const num = s.match(/^(\d{1,2})(?!\d)/);
  let m = num ? Number(num[1]) : 0;
  if (!m) {
    const en = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    m = en.findIndex((x) => s.startsWith(x)) + 1;
  }
  return m >= 1 && m <= 12 ? `${year.trim()}-${String(m).padStart(2, "0")}` : null;
}

/** ชื่อโฟลเดอร์ Mc / Admin -> บทบาท (อย่างอื่น = null) */
export const roleFolder = (name: string): Role | null =>
  /^mc$/i.test(name.trim()) ? "mc" : /^admin$/i.test(name.trim()) ? "admin" : null;

// ---------- จับคู่กับรายชื่อ ----------

/**
 * รายชื่อ 1 แถว: person = คน (อีเมล — เป็นทั้ง Mc และ Admin = คนเดียวกัน)
 *   realKeys = คีย์ชื่อจริงที่ยืนยันแล้ว (legal_name / ชื่อในเอกสารทำเบิก / ใบ 50 ทวิที่จับคู่แล้ว)
 */
export type ReceiptCandidate = { id: number; role: Role; person: string; nick: string; label: string; realKeys: string[] };
export type ReceiptFileKey = { role: Role; key: string; nick: string; realName: string | null };

/** เลือกแถวของคนเดียว: บทบาทตรงก่อน */
function pickOne(list: ReceiptCandidate[], role: Role) {
  const people = new Set(list.map((c) => c.person));
  if (people.size !== 1) return null;
  return (list.find((c) => c.role === role) ?? list[0]).id;
}

/**
 * จับคู่อัตโนมัติ (ชัดเจนคนเดียวเท่านั้น — ไม่ชัด = null รอ Owner)
 *   1. ชื่อนี้ (บทบาทเดียวกัน) ที่ Owner เคยจับคู่ไว้ (remembered: "role:key" -> staff id)
 *   2. ชื่อจริงตรงกับชื่อจริงที่รู้ของคนเดียว
 *   3. ชื่อเล่นตรงกับชื่อในระบบ: บทบาทเดียวกันก่อน ไม่มี = บทบาทอื่น
 */
export function matchReceiptFile(f: ReceiptFileKey, people: ReceiptCandidate[], remembered: Map<string, number>): number | null {
  const mem = remembered.get(`${f.role}:${f.key}`);
  if (mem && people.some((p) => p.id === mem)) return mem;

  const real = [f.realName, f.nick].filter((x): x is string => !!x).map(tawiNameKey).filter((k) => k.length >= 4);
  if (real.length) {
    const hits = people.filter((p) => p.realKeys.some((k) => real.includes(k)));
    if (new Set(hits.map((p) => p.person)).size > 1) return null; // ชื่อจริงซ้ำหลายคน = ไม่เดา
    if (hits.length) return pickOne(hits, f.role);
  }

  const nk = nickKey(f.nick);
  if (nk.length < 1) return null;
  const same = people.filter((p) => nickKey(p.nick) === nk);
  const inRole = same.filter((p) => p.role === f.role);
  return pickOne(inRole.length ? inRole : same, f.role);
}

/** คนที่น่าจะใช่ (แนะนำให้ Owner — มากไปน้อย ไม่เกิน limit) */
export function suggestReceiptPeople(f: ReceiptFileKey, people: ReceiptCandidate[], limit = 3) {
  const nk = nickKey(f.nick);
  const rk = f.realName ? tawiNameKey(f.realName) : "";
  const scored = people.map((p) => {
    const pn = nickKey(p.nick);
    let score = Math.max(similarity(nk, pn), rk ? Math.max(0, ...p.realKeys.map((k) => similarity(rk, k))) : 0);
    // ชื่อเล่นสั้นที่ขึ้นต้นเหมือนกัน ("มาย" กับ "มายด์")
    if (nk && pn && Math.min(nk.length, pn.length) >= 2 && (nk.startsWith(pn) || pn.startsWith(nk))) score = Math.max(score, 0.6);
    if (score > 0 && p.role === f.role) score += 0.05;
    return { id: p.id, score };
  });
  return scored.filter((s) => s.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * ชื่อโฟลเดอร์คนสำหรับไฟล์ที่ส่งผ่านเว็บ: "Mc ปลื้ม (ชื่อ นามสกุล)" — ไม่รู้ชื่อจริง = "Mc ปลื้ม"
 *   ตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้ / วงเล็บในชื่อ (กันอ่านชื่อจริงผิด)
 */
export function receiptPersonFolder(label: string, realName: string | null) {
  const clean = (s: string) => squash(s.replace(/[\\/:*?"<>|()\r\n\t]+/g, " ")).slice(0, 80);
  const base = clean(label) || "ไม่มีชื่อ";
  const real = realName ? clean(realName) : "";
  return real && tawiNameKey(real) !== tawiNameKey(base) ? `${base} (${real})` : base;
}

/**
 * ชื่อจริงสำหรับโฟลเดอร์คน: ชื่อในใบ 50 ทวิเดือนนั้นที่ทีมงานจับคู่ให้คนนี้ (ใบที่เจ้าตัวยืนยันชื่อแล้วก่อน) -> staff.legal_name -> ไม่รู้ = null
 *   (ไม่ใช้ชื่อที่เจ้าตัวพิมพ์ — ระบบไม่เก็บชื่อที่พิมพ์ เก็บแค่คีย์ของใบที่ตรง)
 */
export function receiptRealName(
  month: string, docs: { month: string; real_name: string | null; name_key: string }[], verifiedKeys: string[], legalName: string | null,
) {
  const mine = docs.filter((d) => d.month === month && d.real_name?.trim());
  const pick = mine.find((d) => verifiedKeys.includes(d.name_key)) ?? mine[0];
  return pick?.real_name?.trim() || legalName?.trim() || null;
}

/** ชื่อไฟล์ที่ส่งผ่านเว็บ (ในโฟลเดอร์คน): "เอกสารรับเงิน 2026-10.pdf" */
export const receiptWebFileName = (month: string, ext: string) => `เอกสารรับเงิน ${month}.${ext}`;
/** ไฟล์ในโฟลเดอร์คนที่เป็นของเดือนนี้ (ส่งใหม่ = ไฟล์เหล่านี้ลงถังขยะ) */
export const isWebFileOf = (name: string, month: string) => name.normalize("NFC").startsWith(`เอกสารรับเงิน ${month}.`);
