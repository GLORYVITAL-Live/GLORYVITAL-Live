import "server-only";
import { cleanTiers, type CommitTier } from "@/lib/pay";
import { createAdminClient } from "@/lib/supabase/server";

// เรทที่ล็อกไว้รายเดือน (ตาราง pay_month_rates — ล็อก / ปลดล็อกที่ src/lib/pay-months.ts)
//   แยกไฟล์ให้ src/lib/data.ts เรียกได้โดยไม่วนกลับ (pay-months ใช้แจ้งเตือน ซึ่งเรียก data.ts)
//   shopeeRate = เรท Shopee ที่ล็อกไว้ (SQL 20261116000000_shopee_rate · null = ไม่ได้ตั้งแยก ใช้เรทเดียวกับ TikTok)

export type MonthRate = { rate: number; tiers: CommitTier[]; salaried: boolean; shopeeRate: number | null };

/** เรทที่ล็อกไว้ของเดือนนี้ Map<staff_id, เรท> (ยังไม่ได้รัน SQL = ว่าง · ยังไม่ได้รัน SQL shopee_rate = ไม่มีเรท Shopee) */
export async function lockedRates(month: string, staffIds?: number[]) {
  const out = new Map<number, MonthRate>();
  const read = (cols: string) => {
    let q = createAdminClient().from("pay_month_rates").select(cols).eq("month", month);
    if (staffIds) q = q.in("staff_id", staffIds);
    return q.overrideTypes<Record<string, unknown>[], { merge: false }>();
  };
  const base = "staff_id, hourly_rate, commit_tiers, is_salaried";
  let { data, error } = await read(`${base}, shopee_rate`);
  if (error && /shopee_rate/.test(error.message)) ({ data, error } = await read(base));
  if (error) return out;
  for (const r of data ?? []) {
    out.set(Number(r.staff_id), {
      rate: Number(r.hourly_rate) || 0, tiers: cleanTiers(r.commit_tiers), salaried: !!r.is_salaried,
      shopeeRate: Number(r.shopee_rate) > 0 ? Number(r.shopee_rate) : null,
    });
  }
  return out;
}
