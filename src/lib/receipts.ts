// เอกสารยืนยันการรับเงิน (สลิป / ใบสำคัญรับเงินที่เซ็นแล้ว) รายเดือน — ฟังก์ชันล้วน (เทสได้ ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ)
//   ตั้งแต่เดือนที่ตั้งไว้ (settings.receipt_required_from) เจ้าตัวต้องส่งเอกสารของเดือนนั้นก่อน ถึงดาวน์โหลดใบ 50 ทวิเดือนนั้นได้
//   ส่งแล้วดาวน์โหลดได้ทันที · Owner กด "ไม่ผ่าน" = ล็อกใบเดือนนั้นอีกครั้งจนกว่าจะส่งใหม่
import type { ReceiptState } from "@/lib/types";

/** ไฟล์ใหญ่สุด — Vercel รับคำขอได้ไม่เกิน ~4.5 MB จึงตั้ง 4 MB (รูปย่อในเครื่องก่อนส่ง ปกติไม่ถึง 1 MB) */
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const RECEIPT_REASON_MAX = 300;
/** ส่งย้อนหลังได้กี่เดือน (เดือนที่มีใบ 50 ทวิจับคู่แล้วส่งได้เสมอ) */
export const RECEIPT_BACK_MONTHS = 18;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (m: unknown): m is string => typeof m === "string" && MONTH_RE.test(m);
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** เดือนปัจจุบันตามเวลาไทย "YYYY-MM" */
export const bkkMonth = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 7);
/** เลื่อนเดือน "YYYY-MM" ไป n เดือน */
export function shiftMonth(m: string, n: number) {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** เดือนเริ่มบังคับจากค่าตั้ง (ว่าง / ผิดรูปแบบ = ไม่บังคับ) */
export const cleanRequiredFrom = (v: unknown) => (isMonth(typeof v === "string" ? v.trim() : v) ? String(v).trim() : null);

/**
 * สถานะเอกสารรับเงินของเดือนนี้
 *   requiredFrom = เดือนเริ่มบังคับที่ใช้จริง (null = ไม่บังคับ: ยังไม่ได้รัน SQL / ไม่ได้ตั้งโฟลเดอร์ / ไม่ได้ตั้งเดือน)
 *   none = ไม่ต้องส่ง · ok = ส่งแล้ว · missing = ยังไม่ส่ง · rejected = Owner ตีกลับ
 */
export function receiptState(month: string, requiredFrom: string | null, row?: { status: string } | null): ReceiptState {
  if (!requiredFrom || !isMonth(month) || month < requiredFrom) return "none";
  if (!row) return "missing";
  return row.status === "rejected" ? "rejected" : "ok";
}

/** ส่งเอกสารของเดือนนี้ได้ไหม: เดือนที่มีใบ 50 ทวิจับคู่แล้ว / เดือนปัจจุบันย้อนไปไม่เกิน 18 เดือน (ไม่รับเดือนอนาคต) */
export function receiptMonthOk(month: unknown, tawiMonths: string[], now = Date.now()) {
  if (!isMonth(month)) return false;
  if (tawiMonths.includes(month)) return true;
  const cur = bkkMonth(now);
  return month <= cur && month >= shiftMonth(cur, -RECEIPT_BACK_MONTHS);
}

/**
 * ลงโฟลเดอร์ Mc หรือ Admin: บทบาทของรายชื่อที่ใบ 50 ทวิเดือนนั้นจับคู่ไว้ (ชัดเจนบทบาทเดียว)
 *   ไม่ชัด (ไม่มีใบ / ใบอยู่ทั้งสองบทบาท) = Mc ถ้ามีรายชื่อ Mc ไม่งั้น Admin
 */
export function receiptRole(roles: ("mc" | "admin")[], tawiRoles: ("mc" | "admin")[]): "mc" | "admin" {
  const t = [...new Set(tawiRoles)];
  if (t.length === 1) return t[0];
  return roles.includes("mc") || !roles.includes("admin") ? "mc" : "admin";
}

/** "2026-10" -> โฟลเดอร์ปี "2026" + เดือน "10 October" (ตามโครงโฟลเดอร์ที่ทีมบัญชีใช้อยู่) */
export function receiptFolders(month: string) {
  return { year: month.slice(0, 4), month: `${month.slice(5)} ${EN_MONTHS[Number(month.slice(5)) - 1]}` };
}

export const receiptExt = (mime: string) =>
  mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

/** ชื่อไฟล์ใน Drive: "Mc ปลื้ม - 2026-09.pdf" (ตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้) */
export function receiptFileName(label: string, month: string, mime: string) {
  const clean = label.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "ไม่มีชื่อ";
  return `${clean} - ${month}.${receiptExt(mime)}`;
}

/** ชนิดไฟล์จริงจากไบต์แรก (ไม่เชื่อนามสกุล / ชนิดที่เบราว์เซอร์บอก) ไม่รู้จัก = "" */
export function sniffType(b: Uint8Array) {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  return "";
}

/** เหตุผลที่ไม่ผ่าน: ตัดช่องว่าง จำกัดความยาว (ว่าง = "") */
export const cleanReason = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, RECEIPT_REASON_MAX);
