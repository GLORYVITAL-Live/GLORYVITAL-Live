/**
 * กฎหักเงินมาสาย (ใช้ร่วมกันทั้งหน้ากฎการทำงาน / ตารางของฉัน / สรุปของเจ้าของ)
 * เวลาสายบันทึกในชีต: Mc = แท็บ Deal Mc คอลัมน์ L (Remark) / Admin = แท็บ Admin เสริม คอลัมน์ M
 */
export const LATE_TIERS = [
  { max: 5, cut: 0, label: "สายไม่เกิน 5 นาที" },
  { max: 30, cut: 0.3, label: "สาย 5 – 30 นาที" },
  { max: 60, cut: 0.5, label: "สายเกิน 30 นาที ถึง 1 ชั่วโมง" },
  { max: Infinity, cut: 1, label: "สายเกิน 1 ชั่วโมง" },
] as const;

/** สัดส่วนที่หัก (0–1) จากจำนวนนาทีที่สาย */
export function lateCut(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return 0;
  return LATE_TIERS.find((t) => minutes <= t.max)!.cut;
}

/** ชั่วโมงที่ได้เงิน = ชั่วโมง x (1 - ส่วนที่หัก) */
export const paidHours = (hours: number, lateMinutes: number | null | undefined) => hours * (1 - lateCut(lateMinutes));

/**
 * อ่านจำนวนนาทีที่สายจากช่องในชีต
 *   ตัวเลขล้วน "12" / "12 นาที" / "สาย 12" / "สาย 12 นาที" / "มาช้า 12 นาที" / "สาย 1 ชม." (= 60 นาที)
 *   ข้อความอื่น (หมายเหตุทั่วไป) = null ไม่หักเงิน
 */
export function parseLateMinutes(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const num = (x: string) => Number(x.replace(",", "."));
  let m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:นาที|น\.?|min|m)?$/i);
  if (m) return Math.round(num(m[1])) || null;
  // ต้องมีคำว่า "สาย" หรือ "ช้า" นำหน้า กันหมายเหตุอื่นที่มีตัวเลข (เช่น "เลื่อนเวลา 30 นาที") ถูกนับเป็นสาย
  m = s.match(/(?:สาย|ช้า)\s*(\d+(?:[.,]\d+)?)\s*(ชม|ชั่วโมง|hr|h)?/i);
  if (m) return Math.round(num(m[1]) * (m[2] ? 60 : 1)) || null;
  return null;
}
