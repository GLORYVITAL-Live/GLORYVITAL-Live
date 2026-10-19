// ตรวจคนก่อนใส่ slot / คนเดียวกันซ้อนเวลา / บัญชีทดสอบ — ไม่แตะ DB ใช้ได้ทั้ง server และ browser (เทสได้)
import type { BookingLimits } from "@/lib/types";

/**
 * บัญชีทดสอบ: ชื่อมีคำว่า "ทดสอบ" หรือคำที่ขึ้นต้นด้วย "test" (เช่น "test", "Mc Test2", "มะนาวtest")
 *   ไม่นับในสรุปรายเดือน / ไฟล์เบิก และติดป้าย "บัญชีทดสอบ" ในหน้าพนักงาน
 *   ไม่จับคำที่มี test อยู่กลางคำ (เช่น "Celestest") กันชื่อจริงหลุดจากไฟล์เบิก
 */
export const isTestAccount = (name: string | null | undefined) => /ทดสอบ|(^|[^a-z])test/i.test(String(name ?? ""));

export type Span = { date: string; startMs: number; endMs: number; label?: string };

/** เวลาทับกัน (จบ = เริ่มของอีกคิว ไม่นับว่าทับ) */
export const overlaps = (a: Pick<Span, "startMs" | "endMs">, b: Pick<Span, "startMs" | "endMs">) => a.startMs < b.endMs && a.endMs > b.startMs;

/** จำนวนช่วงต่อเนื่อง (slot ที่เวลาจบ = เวลาเริ่มของอีก slot นับเป็นช่วงเดียวกัน) */
export function blockCount(list: Pick<Span, "startMs" | "endMs">[]) {
  const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
  return sorted.filter((x, i) => i === 0 || sorted[i - 1].endMs !== x.startMs).length;
}

const hoursText = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

/**
 * เตือนก่อน Owner ใส่คนใน slot (ไม่บล็อก — Owner ยืนยันแล้วบันทึกต่อได้)
 *   target = slot ที่จะใส่ · others = คิวอื่นของคนนั้น (ไม่ยกเลิก ไม่รวม slot นี้)
 *   limits = โควต้าต่อวัน (ตัวเลขเดียวกับหน้าจอง) · null = ไม่เช็กโควต้า (เช่น Admin ประจำ)
 */
export function assignWarnings(target: Span, others: Span[], limits: BookingLimits | null): string[] {
  const out: string[] = [];
  const clash = others.filter((o) => overlaps(target, o));
  if (clash.length) out.push(`เวลาทับกับคิวเดิมของคนนี้: ${clash.map((c) => c.label ?? "").filter(Boolean).join(", ") || `${clash.length} คิว`}`);
  if (!limits) return out;
  const sameDay = others.filter((o) => o.date === target.date);
  const n = sameDay.length + 1;
  const hours = [...sameDay, target].reduce((a, x) => a + (x.endMs - x.startMs) / 3600_000, 0);
  if (n > limits.slotsPerDay) out.push(`วันนี้จะมี ${n} slot (เกินโควต้า ${limits.slotsPerDay} slot/วัน)`);
  if (hours > limits.hoursPerDay + 1e-9) out.push(`วันนี้จะมี ${hoursText(hours)} ชม. (เกินโควต้า ${limits.hoursPerDay} ชม./วัน)`);
  if (limits.blocksPerDay) {
    const blocks = blockCount([...sameDay, target]);
    if (blocks > limits.blocksPerDay) out.push(`วันนี้แบ่งเป็น ${blocks} ช่วง (เกิน ${limits.blocksPerDay} ช่วง/วัน)`);
  }
  return out;
}

/**
 * คนเดียวกันอยู่ 2 slot ขึ้นไปที่เวลาทับกัน (คนละช่อง หรือช่องเดียวกันคนละเวลา)
 *   คืนเป็นกลุ่ม (คิวที่ทับต่อกันเป็นกลุ่มเดียว) · แถวซ้ำที่ช่อง + เวลาเดียวกันเป๊ะ ไม่นับ (เป็นเรื่อง "แถวซ้ำ" อีกข้อ)
 */
export function samePersonOverlaps<T extends { pid: number | null; platform: string; startMs: number; endMs: number }>(rows: T[]): T[][] {
  const byPerson = new Map<number, T[]>();
  for (const r of rows) if (r.pid) byPerson.set(r.pid, [...(byPerson.get(r.pid) ?? []), r]);
  const out: T[][] = [];
  for (const list of byPerson.values()) {
    const sorted = [...list].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    let group: T[] = [], end = -Infinity;
    const flush = () => {
      if (new Set(group.map((g) => `${g.platform}|${g.startMs}|${g.endMs}`)).size > 1) out.push(group);
    };
    for (const r of sorted) {
      if (group.length && r.startMs < end) {
        group.push(r);
        end = Math.max(end, r.endMs);
      } else {
        flush();
        group = [r];
        end = r.endMs;
      }
    }
    flush();
  }
  return out.sort((a, b) => a[0].startMs - b[0].startMs);
}
