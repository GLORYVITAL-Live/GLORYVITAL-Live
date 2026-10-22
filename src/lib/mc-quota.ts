// สิทธิ์จองคิวของ Mc ต่อเดือน ตามแร็งค์ผลงานเดือนก่อน (src/lib/mc-rank.ts) — ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ (เทสได้)
//   A (≥ 110%) = 15 slot ไล่ขึ้นตามคะแนนถึง 25 slot ที่ 130% ขึ้นไป
//   B (95–110%) = 7 slot ที่ 95% ไล่ขึ้นถึง 15 slot ที่ 110%
//   C (< 95%) / ยังไม่มีอันดับ (ชม. ที่มียอดน้อยกว่า 8 / Mc ใหม่) = 6 slot
//   สิทธิ์รวม = อัตโนมัติ + เพิ่มพิเศษ (Owner ตั้งเอง ติดลบได้ = ลดสิทธิ์) ไม่ต่ำกว่า 0

import { TIER_A, TIER_B, type Tier } from "@/lib/mc-rank";

export const QUOTA_A: [number, number] = [15, 25];
export const QUOTA_B: [number, number] = [7, 15];
export const QUOTA_C = 6;
/** ยังไม่มีอันดับ = เท่า C */
export const QUOTA_NEW = QUOTA_C;
/** คะแนนที่ได้สิทธิ์สูงสุดของ A */
export const SCORE_TOP = 1.3;
/** เดือนก่อนจบแล้วกี่วันถึงล็อกแร็งค์ (เผื่อกรอกยอด GMV ย้อนหลัง) */
export const SETTLE_DAYS = 3;

const scale = (score: number, from: number, to: number, [lo, hi]: [number, number]) =>
  Math.min(hi, Math.max(lo, lo + Math.round(((score - from) / (to - from)) * (hi - lo))));

/** สิทธิ์อัตโนมัติจากระดับ + คะแนน (ยังไม่มีอันดับ = null) */
export function autoQuota(tier: Tier | null, score: number | null): number {
  if (!tier || score === null || !Number.isFinite(score)) return QUOTA_NEW;
  if (tier === "A") return scale(score, TIER_A, SCORE_TOP, QUOTA_A);
  if (tier === "B") return scale(score, TIER_B, TIER_A, QUOTA_B);
  return QUOTA_C;
}

export const totalQuota = (auto: number, extra: number) => Math.max(0, auto + extra);

/** "2026-11" -> "2026-10" */
export function prevMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** วันที่แร็งค์ของเดือนก่อนล็อก (เดือนก่อนจบ + SETTLE_DAYS วัน) "YYYY-MM-DD" */
export function settleDate(month: string) {
  const [y, m] = month.split("-").map(Number);
  // วันที่ 1 ของเดือนนี้ = วันถัดจากสิ้นเดือนก่อน
  return new Date(Date.UTC(y, m - 1, 1 + SETTLE_DAYS)).toISOString().slice(0, 10);
}

/** แร็งค์ + สิทธิ์ของ Mc 1 คนในเดือนหนึ่ง */
export type QuotaRow = {
  staffId: number; name: string; tier: Tier | null; score: number | null; hours: number;
  auto: number; extra: number; total: number; used: number; note: string;
  /** แก้สิทธิ์เพิ่มล่าสุดโดย / เมื่อ */
  updatedBy: string | null; updatedAt: string | null;
};

/** หน้าเจ้าของ > ผลงาน Mc > สิทธิ์จอง */
export type QuotaReport = {
  month: string; source: string;
  /** แร็งค์ล็อกแล้ว (เดือนก่อนจบ + 3 วัน) false = ยังอัปเดตตามผลงานเดือนก่อนอยู่ */
  settled: boolean; settleDate: string;
  computedAt: string | null;
  /** เปิดใช้การจำกัดสิทธิ์จอง */
  on: boolean;
  /** ตั้งสิทธิ์เพิ่ม / คำนวณใหม่ / เปิดปิดได้ */
  canEdit: boolean;
  rows: QuotaRow[];
};

/** สิทธิ์ของ Mc ที่เปิดหน้าจอง (ต่อเดือนที่มี slot ให้จอง) */
export type MyQuota = { month: string; max: number; used: number; tier: Tier | null; settled: boolean };

/** เหตุผลที่เลือก slot เดือนนี้ไม่ได้เพราะครบสิทธิ์ ("" = ยังเลือกได้) chosen = slot ที่เลือกอยู่ของเดือนนั้น */
export function quotaBlock(q: MyQuota | undefined, chosen: number) {
  if (!q || q.used + chosen < q.max) return "";
  return `ครบสิทธิ์จองของเดือนนี้แล้ว (${q.max} slot${q.tier ? ` · แร็งค์ ${q.tier}` : ""})`;
}
