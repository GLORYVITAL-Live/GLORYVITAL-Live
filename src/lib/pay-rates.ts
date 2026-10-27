import "server-only";
import { cleanTiers, type CommitTier } from "@/lib/pay";
import { createAdminClient } from "@/lib/supabase/server";

// เรทที่ล็อกไว้รายเดือน (ตาราง pay_month_rates — ล็อก / ปลดล็อกที่ src/lib/pay-months.ts)
//   แยกไฟล์ให้ src/lib/data.ts เรียกได้โดยไม่วนกลับ (pay-months ใช้แจ้งเตือน ซึ่งเรียก data.ts)

export type MonthRate = { rate: number; tiers: CommitTier[]; salaried: boolean };

/** เรทที่ล็อกไว้ของเดือนนี้ Map<staff_id, เรท> (ยังไม่ได้รัน SQL = ว่าง) */
export async function lockedRates(month: string, staffIds?: number[]) {
  const out = new Map<number, MonthRate>();
  let q = createAdminClient().from("pay_month_rates").select("staff_id, hourly_rate, commit_tiers, is_salaried").eq("month", month);
  if (staffIds) q = q.in("staff_id", staffIds);
  const { data, error } = await q;
  if (error) return out;
  for (const r of data ?? []) {
    out.set(Number(r.staff_id), { rate: Number(r.hourly_rate) || 0, tiers: cleanTiers(r.commit_tiers), salaried: !!r.is_salaried });
  }
  return out;
}
