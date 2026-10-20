// ยืนยันตัวตนก่อนดาวน์โหลดใบ 50 ทวิ — ฟังก์ชันล้วน (เทสได้ ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ)
//   เจ้าตัวกรอกชื่อ-นามสกุลจริง -> เทียบคีย์ชื่อ (tawiNameKey: ไม่สนคำนำหน้า / ช่องว่าง ตัวสะกดต้องตรง)
//   กับคีย์ชื่อของใบที่ทีมงานจับคู่ให้คนนี้ · ตรง = จำคีย์นั้นไว้ (ใบที่ชื่อต่างไป = ต้องยืนยันใหม่)
//   การกรอกชื่อไม่ทำให้ใบไหนถูกจับคู่ (กันกรอกชื่อเพื่อนแล้วได้ใบของเพื่อน)
import { tawiNameKey } from "@/lib/tawi-name";
import type { ReceiptState, TawiVerifyState } from "@/lib/types";

/** กรอกผิดได้กี่ครั้งต่อวัน (เวลาไทย) — กันเดาชื่อ */
export const TAWI_VERIFY_MAX_FAILS = 5;

const bkkDay = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);

/** จำนวนครั้งที่กรอกผิดของวันนี้ (กรอกผิดครั้งล่าสุดเป็นวันอื่น = 0) */
export function failsToday(dayFails: number | null | undefined, failedAt: string | null | undefined, now = Date.now()) {
  if (!dayFails || !failedAt) return 0;
  const t = Date.parse(failedAt);
  return Number.isFinite(t) && bkkDay(t) === bkkDay(now) ? dayFails : 0;
}

/** receipt = ยังไม่ส่งเอกสารยืนยันการรับเงินของเดือนนี้ · rejected = ส่งแล้วแต่ Owner ตีกลับ (ต้องส่งใหม่) */
export type TawiAccess = "ok" | "verify" | "receipt" | "rejected" | "updating" | "forbidden";

/**
 * เปิด / ดาวน์โหลดใบนี้ได้ไหม (ลำดับ: ยืนยันตัวตน -> ส่งเอกสารรับเงิน -> ดาวน์โหลด)
 *   viewer = Owner ที่ดูเอกสารทำเบิกได้ (เปิดได้เสมอ)
 *   mine = ใบนี้จับคู่กับอีเมลของคนที่ขออยู่ตอนนี้ (staff_id ปัจจุบัน — ย้าย / ยกเลิกแล้ว = ไม่ใช่ของเขา)
 *   verifiedKeys = คีย์ชื่อที่คนนี้ยืนยันแล้ว · null = ยังไม่ได้รัน SQL ยืนยันตัวตน (ไม่ให้เจ้าตัวโหลดไว้ก่อน)
 *   receipt = สถานะเอกสารรับเงินของเดือนของใบนี้ (receiptState) · ไม่ระบุ = ไม่ต้องส่ง
 */
export function tawiAccess(a: {
  viewer: boolean; mine: boolean; docKey: string; verifiedKeys: string[] | null; receipt?: ReceiptState;
}): TawiAccess {
  if (a.viewer) return "ok";
  if (!a.mine) return "forbidden";
  if (a.verifiedKeys === null) return "updating";
  if (!a.docKey || !a.verifiedKeys.includes(a.docKey)) return "verify";
  if (a.receipt === "missing") return "receipt";
  if (a.receipt === "rejected") return "rejected";
  return "ok";
}

/** สถานะยืนยันของใบนี้ (หน้า Owner): ยืนยันชื่อของใบนี้แล้ว = ok · ยังและเคยกรอกไม่ตรง = fail · อื่นๆ = wait */
export function tawiVerifyState(v: { keys: string[]; fails: number; failedAt: string | null }, docKey: string): TawiVerifyState {
  const status = docKey && v.keys.includes(docKey) ? "ok" : v.fails > 0 ? "fail" : "wait";
  return { status, fails: status === "ok" ? 0 : v.fails, failedAt: status === "ok" ? null : v.failedAt };
}

export type TawiVerifyResult =
  | { status: "invalid" } // กรอกไม่ครบ (ไม่นับเป็นครั้งที่ผิด)
  | { status: "nothing" } // ไม่มีใบที่รอยืนยัน
  | { status: "locked" } // ผิดครบจำนวนของวันนี้แล้ว
  | { status: "ok"; key: string; keys: string[] }
  | { status: "mismatch"; failsToday: number; left: number };

/**
 * ตรวจชื่อที่เจ้าตัวกรอก
 *   docKeys = คีย์ชื่อของทุกใบที่จับคู่ให้คนนี้ตอนนี้ · verifiedKeys = คีย์ที่ยืนยันไว้แล้ว
 *   ตรงกับใบที่ยังไม่ยืนยัน = ok (keys = คีย์ที่ยืนยันแล้วทั้งหมดหลังเพิ่ม) · ไม่ตรง = mismatch (นับครั้ง)
 */
export function checkTawiVerify(input: {
  name: unknown; docKeys: string[]; verifiedKeys: string[]; dayFails: number | null; failedAt: string | null; now?: number;
}): TawiVerifyResult {
  const name = String(input.name ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  const key = name.length > 120 ? "" : tawiNameKey(name);
  if (key.length < 4 || !/[ก-๙a-z]/i.test(key)) return { status: "invalid" };
  const pending = new Set(input.docKeys.filter((k) => k && !input.verifiedKeys.includes(k)));
  if (!pending.size) return { status: "nothing" };
  const today = failsToday(input.dayFails, input.failedAt, input.now);
  if (today >= TAWI_VERIFY_MAX_FAILS) return { status: "locked" };
  if (pending.has(key)) return { status: "ok", key, keys: [...new Set([...input.verifiedKeys, key])] };
  return { status: "mismatch", failsToday: today + 1, left: Math.max(0, TAWI_VERIFY_MAX_FAILS - today - 1) };
}
