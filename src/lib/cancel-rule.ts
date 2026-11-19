// ยกเลิกคิวตอนกลางคืน — ฟังก์ชันล้วน (เทสได้ ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ)
//   ช่วง 22:00–08:00 (เวลาไทย) กดยกเลิกผ่านเว็บไม่ได้ ต้องทัก LINE คนดูแลโดยตรง (กลางคืนไม่มีใครเห็นคิวที่ว่างทันที)
//   ยกเว้นคิวที่เพิ่งจอง / รับเองไม่เกิน UNDO_MINUTES นาที (กดพลาด ยกเลิกเองได้ทันที)
//   Mc: คิว TikTok → LINE แอดมินดูแล Mc TikTok · คิว Shopee → LINE แอดมินดูแล Mc Shopee · Admin เสริม → LINE ของ Owner
//   ลิงก์ตั้งที่หน้าเจ้าของ > กฎการทำงาน (settings.cancel_line_* — SQL 20261121000000_night_cancel) ว่าง = ใช้ลิงก์แชทแอดมินเดิม

export const NIGHT_CANCEL = { from: 22, to: 8 } as const;
export const NIGHT_CANCEL_TEXT = `${NIGHT_CANCEL.from}:00–${String(NIGHT_CANCEL.to).padStart(2, "0")}:00`;

/** ตอนนี้อยู่ในช่วงกลางคืน (ยกเลิกผ่านเว็บไม่ได้) ไหม — ดูชั่วโมงตามเวลาไทย */
export function isNightCancel(now = Date.now()) {
  const h = new Date(now + 7 * 3600_000).getUTCHours();
  return h >= NIGHT_CANCEL.from || h < NIGHT_CANCEL.to;
}

/**
 * ยกเลิกคิวที่เพิ่งจอง / รับเอง ได้ภายในกี่นาที แม้เป็นช่วงกลางคืน (กันกดพลาด · ผู้ใช้ขอ 2026-11-19)
 *   กฎ "ก่อนไลฟ์อย่างน้อย N ชม." ยังใช้ตามเดิม
 */
export const UNDO_MINUTES = 15;
/** ชื่อ action ใน booking_logs ตอนจอง / รับคิวเองผ่านเว็บ (ใช้หาเวลาที่เพิ่งจอง) */
export const BOOK_ACTION = { mc: "จองคิว", admin: "รับคิว Admin" } as const;

/** bookedAt (ms) = เวลาที่คนนี้จอง / รับ slot นี้ล่าสุด · ยังไม่เกิน UNDO_MINUTES = ยกเลิกได้แม้กลางคืน */
export function inUndoWindow(bookedAt: number | null | undefined, now = Date.now()) {
  if (!bookedAt) return false;
  const age = now - bookedAt;
  return age >= -60_000 && age < UNDO_MINUTES * 60_000; // เผื่อนาฬิกาเครื่องเพี้ยนเล็กน้อย
}

/** ลิงก์ LINE คนดูแลแต่ละฝ่าย (ว่าง = ยังไม่ได้ตั้ง) */
export type CancelLines = { tiktok: string; shopee: string; admin: string };

/** ลิงก์จาก settings (ยังไม่ได้รัน SQL = ว่างทั้งหมด) */
export const cancelLinesOf = (s: { cancel_line_mc_tiktok?: string | null; cancel_line_mc_shopee?: string | null; cancel_line_admin?: string | null }): CancelLines => ({
  tiktok: s.cancel_line_mc_tiktok?.trim() ?? "", shopee: s.cancel_line_mc_shopee?.trim() ?? "", admin: s.cancel_line_admin?.trim() ?? "",
});

/**
 * ทักใครเพื่อยกเลิกคิวนี้: Mc คิว Shopee / Mc คิว TikTok / Admin เสริม (→ Owner)
 *   ยังไม่ได้ตั้งลิงก์ของฝ่ายนั้น = ลิงก์แชทแอดมินเดิม (fallback) · ไม่มีทั้งคู่ = url ว่าง (บอกให้ติดต่อเอง)
 */
export function cancelContact(role: "mc" | "admin", shopee: boolean, lines: Partial<CancelLines> | null | undefined, fallback = "") {
  const key: keyof CancelLines = role === "admin" ? "admin" : shopee ? "shopee" : "tiktok";
  const who = key === "admin" ? "Owner" : key === "shopee" ? "แอดมินดูแล Mc Shopee" : "แอดมินดูแล Mc TikTok";
  return { url: lines?.[key]?.trim() || fallback.trim(), who };
}
