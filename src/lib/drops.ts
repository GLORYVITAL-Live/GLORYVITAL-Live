import type { DropRow } from "@/lib/types";

/**
 * คิวหลุดของ Mc + ใครรับต่อ (ผู้ใช้ขอ 2026-11-17: "Metric บอกการเอฟคิวเพิ่มจากในเว็บ เวลาที่มีคิวหลุดของ Mc")
 *   ดูจากประวัติในเว็บ (booking_logs) ของแต่ละคิว:
 *     หลุด = Mc กดยกเลิกคิวเอง / Owner เอาคนออก (หน้าจัดการ slot) / เอาชื่อ Mc ออก (Plan Slot Live)
 *     รับต่อ = Mc จองคิวในเว็บ (web) / Owner กำหนดคน หรือใส่ชื่อในชีต (owner)
 *   ผลดูจากคนที่ถือคิวอยู่ตอนนี้: ยกเลิกแล้วจองคืนเอง = ไม่นับว่าหลุด · คิวไม่มีคน / ถูกแคน = open
 *   ส่วนนี้เป็นฟังก์ชันล้วน (ทดสอบได้) · โหลดข้อมูลอยู่ที่ src/lib/drops-db.ts
 */

export type DropLog = { id: number; at: string; role: string; email: string | null; action: string; slotId: number };
export type DropSlot = {
  id: number; date: string; start: string; end: string; platform: string; shopee: boolean; cancelled: boolean;
  /** คนที่ถือคิวอยู่ตอนนี้ ("Mc ชื่อ") + อีเมล (ไม่มีคน = null) */
  holder: string | null; holderEmail: string | null;
};

const isRelease = (l: DropLog) =>
  (l.role === "Mc" && /^ยกเลิกคิว/.test(l.action)) || /^(แก้ slot: เอาคนออก|Plan Slot Live: เอาชื่อ Mc ออก)/.test(l.action);
const isMcTake = (l: DropLog) => l.role === "Mc" && /^จองคิว/.test(l.action);
const isOwnerTake = (l: DropLog) => /^(แก้ slot: กำหนดคน|Plan Slot Live: ลงชื่อ Mc ประจำ)/.test(l.action);
const low = (e: string | null) => (e ? e.trim().toLowerCase() : null);

/** nameOf = อีเมล -> "Mc ชื่อ" (ไว้บอกว่าใครปล่อยคิว) */
export function slotDrops(slots: DropSlot[], logs: DropLog[], nameOf: (email: string) => string | null): DropRow[] {
  const bySlot = new Map<number, DropLog[]>();
  for (const l of logs) bySlot.set(l.slotId, [...(bySlot.get(l.slotId) ?? []), l]);
  const out: DropRow[] = [];
  for (const s of slots) {
    const ev = (bySlot.get(s.id) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
    // รอบล่าสุดที่หลุด: ใครปล่อย + มีคนรับต่อด้วยวิธีไหน
    let dropped = false, dropper: string | null = null, holder: string | null = null;
    let take: DropLog | null = null;
    for (const e of ev) {
      if (isRelease(e)) {
        dropped = true;
        dropper = e.role === "Mc" ? low(e.email) : holder;
        holder = null; take = null;
      } else if (isMcTake(e) || isOwnerTake(e)) {
        holder = isMcTake(e) ? low(e.email) : null;
        if (dropped) take = e;
      }
    }
    if (!dropped) continue;
    const cur = s.cancelled ? null : s.holder;
    const curEmail = low(s.holderEmail);
    // ยกเลิกแล้วจองคืนเอง = ไม่ได้หลุดจริง
    if (cur && dropper && curEmail === dropper) continue;
    const from = dropper ? nameOf(dropper) : null;
    const base = { date: s.date, start: s.start, end: s.end, platform: s.platform, shopee: s.shopee, from };
    if (!cur) out.push({ ...base, outcome: "open", by: null });
    else if (take && isMcTake(take) && curEmail && low(take.email) === curEmail) out.push({ ...base, outcome: "web", by: cur });
    else out.push({ ...base, outcome: "owner", by: cur });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
