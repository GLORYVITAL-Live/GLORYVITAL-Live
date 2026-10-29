import "server-only";
import { periodChanges, snapshotOf, type PeriodSnapshot, type Side } from "@/lib/period-diff";
import { isTestAccount } from "@/lib/staff-check";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me, OwnerSummary } from "@/lib/types";

/**
 * ปิดงวดรายเดือน (SQL 20261024000000_pay_periods) แยกฝั่ง Mc / Admin
 *   ปิด = เก็บตัวเลขสรุปของฝั่งนั้น ณ ตอนปิด (snapshot) หน้าสรุปรายเดือน + ไฟล์เบิกใช้ชุดนี้เสมอ
 *   ข้อมูลจริงเปลี่ยนทีหลัง (แก้ชีตย้อนหลัง / เปลี่ยนค่าจ้าง) = แสดงส่วนต่างรายคน ไว้ปรับในงวดถัดไป (period-diff.ts)
 *   ปิด / เปิดได้เฉพาะ Owner ที่ตั้ง staff.can_close_periods (ตั้งด้วย SQL)
 */

export { snapshotOf, type Side };
type Summary = Omit<OwnerSummary, "scope">;
export type PeriodRow = {
  id: number; month: string; side: Side; closed_at: string; closed_by: string; closed_email: string;
  snapshot: PeriodSnapshot; reopened_at: string | null; reopened_by: string | null;
};

export const PERIODS_SQL = "ต้องรัน SQL 20261024000000_pay_periods ใน Supabase ก่อน";
const TYPE: Record<Side, "Mc" | "Admin"> = { mc: "Mc", admin: "Admin" };

/** Owner คนนี้ปิด / เปิดงวดได้ไหม */
export async function canClosePeriods(me: Me) {
  if (!me.owner) return false;
  const { data, error } = await createAdminClient().from("staff").select("can_close_periods").eq("id", me.owner.id).maybeSingle();
  return !error && data?.can_close_periods === true;
}

/** ทุกแถวของเดือนนี้ (ใหม่ก่อน) — ยังไม่ได้รัน SQL = [] */
export async function periodRows(month: string) {
  const { data, error } = await createAdminClient().from("pay_periods").select("*").eq("month", month).order("id", { ascending: false });
  return error ? [] : ((data ?? []) as PeriodRow[]);
}

/**
 * ใช้ตัวเลขตอนปิดแทนข้อมูลจริงของฝั่งที่ปิดงวดแล้ว (แก้ s ตรงๆ) คืนสถานะ / ส่วนต่าง / ประวัติ
 *   sides = ฝั่งที่คนดูมีสิทธิ์เห็น
 */
export async function applyPeriods(s: Summary, month: string, sides: Side[]) {
  const rows = (await periodRows(month)).filter((r) => sides.includes(r.side));
  const periods: NonNullable<OwnerSummary["periods"]> = {};
  const changes: NonNullable<OwnerSummary["changes"]> = {};
  for (const side of sides) {
    const row = rows.find((r) => r.side === side && !r.reopened_at);
    if (!row) continue;
    // บัญชีทดสอบไม่นับในสรุป: ตัดออกจากตัวเลขตอนปิดด้วย (งวดที่ปิดก่อนมีกฎนี้จะไม่ขึ้นเป็นส่วนต่างปลอม)
    const snap: PeriodSnapshot = {
      ...row.snapshot,
      people: row.snapshot.people.filter((p) => !isTestAccount(p.name)),
      details: row.snapshot.details.filter((d) => !isTestAccount(d.name)),
    };
    changes[side] = periodChanges(snap, snapshotOf(s, side));
    periods[side] = { at: row.closed_at, by: row.closed_by };
    s[side] = snap.people;
    s.details = [...s.details.filter((d) => d.type !== TYPE[side]), ...snap.details];
    s.rates[side] = snap.rates;
    if (side === "mc") {
      s.rates.defaultMc = snap.defaultRate;
      s.rates.shopee = snap.shopeeRates ?? {};
    } else s.rates.defaultAdmin = snap.defaultRate;
  }
  const periodLog = rows.map((r) => ({ side: r.side, closedAt: r.closed_at, closedBy: r.closed_by, reopenedAt: r.reopened_at, reopenedBy: r.reopened_by }));
  return { periods, changes, periodLog };
}
