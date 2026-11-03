import { slotPay } from "@/lib/pay";
import type { OwnerDetail, OwnerSummary } from "@/lib/types";

/**
 * ค่าจ้างของคิวในสรุปรายเดือน (ownerSummary) — สูตรเดียวกันทุกที่: หน้าสรุปของเจ้าของ / ไฟล์เบิก / แดชบอร์ดหน้าแรก
 *   data = สรุปรายเดือน (ใช้แค่ rates + รายชื่อ Mc / Admin)
 */
export type PayType = "Mc" | "Admin";
export type PayData = Pick<OwnerSummary, "rates" | "mc" | "admin">;

/** คนนี้เป็น Mc ประจำ / Admin ประจำ (ได้เงินเดือน) */
export const salariedOf = (data: PayData, type: PayType, name: string) =>
  !!(type === "Mc" ? data.mc : data.admin).find((p) => p.name === name)?.salaried;

/** อัตราค่าจ้างต่อชั่วโมง (TikTok / เรทหลัก): รายคน ถ้าไม่มีใช้ค่าเริ่มต้น / พนักงานประจำ (เงินเดือน) = 0 */
export function rateOf(data: PayData, type: PayType, name: string) {
  if (salariedOf(data, type, name)) return 0;
  const own = type === "Mc" ? data.rates.mc : data.rates.admin;
  return own[name] || (type === "Mc" ? data.rates.defaultMc : data.rates.defaultAdmin) || 0;
}

/** ค่าจ้างคิว Shopee ของคนนี้ ที่ต่างจากเรทหลัก (ตั้งค่าจ้าง Shopee แยก) · ไม่มี = 0 */
export const shopeeRateOf = (data: PayData, type: PayType, name: string) =>
  type === "Mc" && !salariedOf(data, type, name) ? data.rates.shopee?.[name] ?? 0 : 0;

/** ค่าจ้าง/ชม. ของคิวนี้: คิว Shopee ของ Mc ที่ตั้งค่าจ้าง Shopee แยก = เรท Shopee · อื่นๆ = เรทหลักของคนนั้น */
export const itemRate = (data: PayData, type: PayType, d: OwnerDetail) =>
  (d.shopee && shopeeRateOf(data, type, d.name)) || rateOf(data, type, d.name);

/** ค่ารถของคิวนี้ (Admin ที่ได้ค่ารถ · คิวเลิก 23:30 วันละครั้ง — คิดที่เซิร์ฟเวอร์) ไม่มี = 0 */
export const travelOf = (d: Pick<OwnerDetail, "travel">) => d.travel ?? 0;

/** ยอดเงินของหลายคิว (ปัดทีละคิวแล้วรวม · คิดตามเรทของแต่ละคิว + ค่ารถ) — สูตรเดียวกับไฟล์เบิก / ตารางของฉัน */
export const payOfItems = (data: PayData, type: PayType, items: OwnerDetail[]) =>
  items.reduce((a, d) => a + slotPay(d.hours, d.lateMinutes, d.bonusMinutes, itemRate(data, type, d)) + travelOf(d), 0);

/** คนนี้มีค่าจ้างรายชั่วโมงไหม (เรทหลัก หรือเรท Shopee) */
export const hasRateOf = (data: PayData, type: PayType, name: string) => rateOf(data, type, name) > 0 || shopeeRateOf(data, type, name) > 0;
