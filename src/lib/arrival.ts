/**
 * Admin กด "มาถึงแล้ว" (admin_slots.arrived_at — SQL 20261118000000_admin_arrival)
 *   นาทีสาย = เวลาที่กด − เวลาเริ่ม slot (กดก่อนเวลา = 0) หักเงินตามกฎเดิม (pay.ts lateCut)
 *   ใช้เมื่อช่องสายในชีต (แท็บ Admin เสริม คอลัมน์ M) ว่าง — แบบเดียวกับ Mc ที่ช่องว่าง = คิดจากหลักฐานไลฟ์
 *   slot ที่ต่อจากคิวก่อนหน้าของคนเดียวกัน (เวลาจบ = เวลาเริ่ม) ไม่ต้องกดซ้ำ ไม่หักสาย
 *   กดได้ตั้งแต่ ARRIVE_EARLY_MS ก่อนเริ่ม ถึงจบ slot
 */

export const ARRIVE_EARLY_MS = 2 * 3600_000;

/** สถานะการกดมาถึงของ slot: at = เวลาที่กด (ISO) · continued = ต่อจากคิวก่อนหน้า (ไม่ต้องกด) */
export type Arrival = { at: string | null; continued: boolean };

export const arrivalLate = (arrivedMs: number, startMs: number) => Math.max(0, Math.floor((arrivedMs - startMs) / 60_000));

/** id ของ slot ที่ต่อจากคิวก่อนหน้าของคนเดียวกัน (ใส่เฉพาะ slot ที่ไม่ถูกยกเลิก) */
export function continuedIds(slots: { id: number; who: number | string; startMs: number; endMs: number }[]) {
  const ends = new Set(slots.map((s) => `${s.who}|${s.endMs}`));
  return new Set(slots.filter((s) => ends.has(`${s.who}|${s.startMs}`)).map((s) => s.id));
}

/** นาทีสายของ slot ของ Admin: ช่องในชีตก่อน · ว่าง = จากเวลาที่กดมาถึง (ต่อจากคิวก่อน / ไม่ได้กด = ไม่หัก) */
export function adminLate(sheetLate: number | null, arrival: Arrival | null, startMs: number) {
  if (sheetLate !== null) return { lateMinutes: sheetLate, lateFromArrival: false };
  if (!arrival?.at || arrival.continued) return { lateMinutes: null, lateFromArrival: false };
  const m = arrivalLate(Date.parse(arrival.at), startMs);
  return { lateMinutes: m || null, lateFromArrival: m > 0 };
}

/** slot นี้ควรกดแล้วแต่ยังไม่ได้กด (เริ่มไปแล้ว · ไม่ต่อจากคิวก่อน · ไม่มีค่าสายในชีต) */
export const arrivalMissing = (arrival: Arrival | undefined, startMs: number, now: number) =>
  !!arrival && !arrival.at && !arrival.continued && startMs <= now;
