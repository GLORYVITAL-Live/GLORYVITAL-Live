import "server-only";
import { cleanTiers, type CommitTier } from "@/lib/pay";
import { createAdminClient } from "@/lib/supabase/server";

// เรทที่ล็อกไว้รายเดือน (ตาราง pay_month_rates — ล็อก / ปลดล็อกที่ src/lib/pay-months.ts)
//   แยกไฟล์ให้ src/lib/data.ts เรียกได้โดยไม่วนกลับ (pay-months ใช้แจ้งเตือน ซึ่งเรียก data.ts)
//   shopeeRate = เรท Shopee ที่ล็อกไว้ (SQL 20261116000000_shopee_rate · null = ไม่ได้ตั้งแยก ใช้เรทเดียวกับ TikTok)
//   travel = ค่ารถ Admin ที่ล็อกไว้ (SQL 20261119000000_admin_travel · null = ไม่ได้ค่ารถ / ล็อกก่อนมีค่ารถ)

export type MonthRate = { rate: number; tiers: CommitTier[]; salaried: boolean; shopeeRate: number | null; travel: number | null };

/** คอลัมน์ที่เพิ่มทีหลัง (ยังไม่ได้รัน SQL ของคอลัมน์ไหน = อ่าน / ล็อกโดยไม่มีคอลัมน์นั้น) */
export const LATER_RATE_COLS = ["shopee_rate", "travel_allowance"] as const;

/** เรทที่ล็อกไว้ของเดือนนี้ Map<staff_id, เรท> (ยังไม่ได้รัน SQL = ว่าง · ยังไม่ได้รัน SQL shopee_rate / ค่ารถ = ไม่มีค่านั้น) */
export async function lockedRates(month: string, staffIds?: number[]) {
  const out = new Map<number, MonthRate>();
  const read = (cols: readonly string[]) => {
    let q = createAdminClient().from("pay_month_rates").select(["staff_id, hourly_rate, commit_tiers, is_salaried", ...cols].join(", ")).eq("month", month);
    if (staffIds) q = q.in("staff_id", staffIds);
    return q.overrideTypes<Record<string, unknown>[], { merge: false }>();
  };
  let cols: readonly string[] = LATER_RATE_COLS;
  let { data, error } = await read(cols);
  for (let missing = cols.find((c) => error?.message.includes(c)); missing; missing = cols.find((c) => error?.message.includes(c))) {
    cols = cols.filter((c) => c !== missing);
    ({ data, error } = await read(cols));
  }
  if (error) return out;
  const pos = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
  for (const r of data ?? []) {
    out.set(Number(r.staff_id), {
      rate: Number(r.hourly_rate) || 0, tiers: cleanTiers(r.commit_tiers), salaried: !!r.is_salaried,
      shopeeRate: pos(r.shopee_rate), travel: pos(r.travel_allowance),
    });
  }
  return out;
}
