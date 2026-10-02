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

/** เทียร์ Commit: จองครบ hours ชม./เดือนขึ้นไป -> ทุกชั่วโมงของเดือนคิด rate บาท/ชม. */
export type CommitTier = { hours: number; rate: number };

/** เทียร์ที่ใช้ได้ เรียงตามชั่วโมงน้อยไปมาก (ข้อมูลผิดรูปแบบถูกตัดทิ้ง) */
export function cleanTiers(v: unknown): CommitTier[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => ({ hours: Number(t?.hours), rate: Number(t?.rate) }))
    .filter((t) => Number.isFinite(t.hours) && t.hours > 0 && Number.isFinite(t.rate) && t.rate > 0)
    .sort((a, b) => a.hours - b.hours);
}

/**
 * ค่าจ้างต่อชั่วโมงของเดือน (Commit แบบเทียร์รายคน)
 *   ชั่วโมงที่จองในเดือน (ไม่นับคิวที่ยกเลิก) ถึงเทียร์สูงสุดเท่าไร -> ทุกชั่วโมงของเดือนคิดราคาเทียร์นั้น
 *   ยังไม่ถึงเทียร์แรก / ไม่มี Commit -> baseRate
 *   next = เทียร์ถัดไปที่ยังไม่ถึง (ใช้บอกว่าอีกกี่ชั่วโมง)
 */
export function monthRate(baseRate: number, tiers: CommitTier[] | null | undefined, monthHours: number) {
  const list = cleanTiers(tiers);
  const reached = list.filter((t) => monthHours >= t.hours);
  const tier = reached[reached.length - 1] ?? null;
  return {
    rate: tier ? tier.rate : baseRate,
    hasCommit: list.length > 0,
    tier,
    next: list.find((t) => monthHours < t.hours) ?? null,
    tiers: list,
  };
}

/** ข้อความอธิบายเทียร์ เช่น "ต่ำกว่า 10 ชม. 1,000 / 10+ ชม. 950 / 21+ ชม. 900" */
export function tiersLabel(baseRate: number, tiers: CommitTier[]) {
  const fmt = (n: number) => Math.round(n).toLocaleString("th-TH");
  const list = cleanTiers(tiers);
  if (!list.length) return "";
  return [
    baseRate ? `ต่ำกว่า ${list[0].hours} ชม. ${fmt(baseRate)}` : "",
    ...list.map((t) => `${t.hours}+ ชม. ${fmt(t.rate)}`),
  ].filter(Boolean).join(" / ");
}

/** ชั่วโมงที่ได้เงิน = ชั่วโมง x (1 - ส่วนที่หัก) */
export const paidHours = (hours: number, lateMinutes: number | null | undefined) => hours * (1 - lateCut(lateMinutes));

/**
 * ไลฟ์ชดเชย (ไลฟ์ต่อแทนคนถัดไปที่มาสาย) ใส่ "+นาที" เช่น "+10"
 *   Mc = แท็บ Deal Mc คอลัมน์ L / Admin = แท็บ Admin เสริม คอลัมน์ M (ช่องเดียวกับเวลาสาย มี + นำหน้า = ชดเชย)
 * จ่ายตามค่าจ้าง/ชม. ของเดือนนั้นแบบเทียร์ (ไม่โดนหักมาสาย / ไม่นับเป็นชั่วโมง Commit)
 * เกิน 60 นาที = ชั่วโมงเต็ม + เศษคิดตามเทียร์เดียวกัน (เช่น 75 นาที = 1 ชม. + ¼ ชม.)
 */
export const BONUS_TIERS = [
  { min: 5, max: 15, hours: 0.25, label: "ชดเชย 5 – 15 นาที", share: "¼ ชั่วโมง" },
  { min: 16, max: 30, hours: 0.5, label: "ชดเชย 16 – 30 นาที", share: "½ ชั่วโมง" },
  { min: 31, max: 60, hours: 1, label: "ชดเชย 31 นาที – 1 ชั่วโมง", share: "1 ชั่วโมงเต็ม" },
] as const;

/** นาทีที่ได้เงินจากไลฟ์ชดเชย (หลังคิดเทียร์) เช่น 10 -> 15, 20 -> 30, 45 -> 60, 75 -> 75, 3 -> 0 */
export function bonusPaidMinutes(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return 0;
  const full = Math.floor(minutes / 60), rest = minutes % 60;
  const tier = BONUS_TIERS.find((t) => rest >= t.min && rest <= t.max);
  return full * 60 + (tier ? tier.hours * 60 : 0);
}

/** ชั่วโมงที่ได้เงินของ slot = ชั่วโมงหลังหักมาสาย + ไลฟ์ชดเชย (คิดเทียร์แล้ว) */
export const slotPaidHours = (hours: number, lateMinutes: number | null | undefined, bonusMinutes?: number | null) =>
  paidHours(hours, lateMinutes) + bonusPaidMinutes(bonusMinutes) / 60;

/**
 * อ่านนาทีที่ไลฟ์ชดเชย: "ชดเชย 10" / "ชดเชย10นาที" / "+10" / "+10 นาที" / "+1 ชม." (= 60)
 * หมายเหตุ: ถ้าช่องในชีตเป็นรูปแบบตัวเลข Google Sheets จะแปลง "+10" เป็นเลข 10 (กลายเป็น "สาย 10")
 *   จึงรองรับคำว่า "ชดเชย" ด้วย หรือให้ตั้งคอลัมน์เป็น "ข้อความธรรมดา" ก่อนพิมพ์ "+10"
 */
export function parseBonusMinutes(v: unknown): number | null {
  const m = String(v ?? "").match(/(?:\+|ชดเชย|บวก)\s*\+?\s*(\d+(?:[.,]\d+)?)\s*(ชม|ชั่วโมง|hr|h)?/i);
  if (!m) return null;
  return Math.round(Number(m[1].replace(",", ".")) * (m[2] ? 60 : 1)) || null;
}

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
