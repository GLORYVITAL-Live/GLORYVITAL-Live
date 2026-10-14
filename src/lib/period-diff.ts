// ปิดงวด: ตัวเลขของฝั่งหนึ่ง (snapshot) + ส่วนต่างรายคนของข้อมูลจริงเทียบตอนปิด — ไม่แตะ DB (เทสได้)
import { num } from "@/lib/format";
import type { OwnerDetail, OwnerPerson, OwnerSummary, PeriodChange } from "@/lib/types";

export type Side = "mc" | "admin";
export type PeriodSnapshot = { people: OwnerPerson[]; details: OwnerDetail[]; rates: Record<string, number>; defaultRate: number };
const TYPE: Record<Side, "Mc" | "Admin"> = { mc: "Mc", admin: "Admin" };

/** ตัวเลขของฝั่งนี้จากสรุปรายเดือน (เก็บตอนปิด / ใช้เทียบส่วนต่าง) */
export const snapshotOf = (s: Pick<OwnerSummary, "mc" | "admin" | "details" | "rates">, side: Side): PeriodSnapshot => ({
  people: s[side],
  details: s.details.filter((d) => d.type === TYPE[side]),
  rates: s.rates[side],
  defaultRate: side === "mc" ? s.rates.defaultMc : s.rates.defaultAdmin,
});

/** ส่วนต่างรายคน: ข้อมูลตอนนี้ (live) เทียบตัวเลขตอนปิด (closed) — ไม่ต่าง = ไม่อยู่ในรายการ */
export function periodChanges(closed: PeriodSnapshot, live: PeriodSnapshot): PeriodChange[] {
  const rate = (s: PeriodSnapshot, p: OwnerPerson) => (p.salaried ? 0 : s.rates[p.name] || s.defaultRate || 0);
  const queue = (p: OwnerPerson | undefined, none: string) => (p ? `${p.slots} slot (${num(p.paidHours)} ชม.)` : none);
  const names = [...new Set([...closed.people.map((p) => p.name), ...live.people.map((p) => p.name)])];
  const out: PeriodChange[] = [];
  for (const name of names) {
    const a = closed.people.find((p) => p.name === name), b = live.people.find((p) => p.name === name);
    if (!a || !b) {
      out.push({ name, items: [{ label: "คิว", before: queue(a, "ไม่มี"), after: queue(b, "ไม่มีแล้ว") }] });
      continue;
    }
    const items: PeriodChange["items"] = [];
    const cmp = (label: string, x: number, y: number, fmt: (n: number) => string = num) => {
      if (Math.abs(x - y) > 0.001) items.push({ label, before: fmt(x), after: fmt(y) });
    };
    cmp("slot", a.slots, b.slots, String);
    cmp("ชม. ที่ได้เงิน", a.paidHours, b.paidHours);
    cmp("ยกเลิก", a.cancelled, b.cancelled, String);
    cmp("ไลฟ์ชดเชย (นาที)", a.bonusMinutes, b.bonusMinutes, String);
    cmp("ค่าจ้าง/ชม.", rate(closed, a), rate(live, b));
    if (!!a.salaried !== !!b.salaried) items.push({ label: "พนักงานประจำ", before: a.salaried ? "ใช่" : "ไม่ใช่", after: b.salaried ? "ใช่" : "ไม่ใช่" });
    if (items.length) out.push({ name, items });
  }
  return out;
}
