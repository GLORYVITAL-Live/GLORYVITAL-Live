// เทสส่วนต่างหลังปิดงวด (bun test)
import { describe, expect, test } from "bun:test";
import { periodChanges, type PeriodSnapshot } from "@/lib/period-diff";
import type { OwnerPerson } from "@/lib/types";

const person = (name: string, x: Partial<OwnerPerson> = {}): OwnerPerson => ({
  name, slots: 10, hours: 20, paidHours: 20, lateSlots: 0, bonusMinutes: 0, days: 5, cancelled: 0, commit: null, ...x,
});
const snap = (people: OwnerPerson[], rates: Record<string, number> = {}, defaultRate = 0): PeriodSnapshot => ({ people, details: [], rates, defaultRate });

describe("ส่วนต่างหลังปิดงวด", () => {
  test("ไม่มีอะไรเปลี่ยน = ว่าง", () => {
    expect(periodChanges(snap([person("มะนาว")], { มะนาว: 700 }), snap([person("มะนาว")], { มะนาว: 700 }))).toEqual([]);
  });
  test("แก้ชีตย้อนหลัง: slot / ชม. เพิ่ม", () => {
    expect(periodChanges(snap([person("มะนาว")]), snap([person("มะนาว", { slots: 11, paidHours: 22 })]))).toEqual([
      { name: "มะนาว", items: [{ label: "slot", before: "10", after: "11" }, { label: "ชม. ที่ได้เงิน", before: "20", after: "22" }] },
    ]);
  });
  test("เปลี่ยนค่าจ้าง (รวมค่าเริ่มต้น)", () => {
    const [c] = periodChanges(snap([person("ปัน")], {}, 600), snap([person("ปัน")], { ปัน: 650 }, 600));
    expect(c.items).toEqual([{ label: "ค่าจ้าง/ชม.", before: "600", after: "650" }]);
  });
  test("คนใหม่ / คนที่หายไป", () => {
    const out = periodChanges(snap([person("เก่า")]), snap([person("ใหม่", { slots: 2, paidHours: 4 })]));
    expect(out).toContainEqual({ name: "เก่า", items: [{ label: "คิว", before: "10 slot (20 ชม.)", after: "ไม่มีแล้ว" }] });
    expect(out).toContainEqual({ name: "ใหม่", items: [{ label: "คิว", before: "ไม่มี", after: "2 slot (4 ชม.)" }] });
  });
  test("เปลี่ยนเป็นพนักงานประจำ = ค่าจ้าง/ชม. เป็น 0 ด้วย", () => {
    const [c] = periodChanges(snap([person("เตย")], { เตย: 500 }), snap([person("เตย", { salaried: true })], { เตย: 500 }));
    expect(c.items.map((i) => i.label)).toEqual(["ค่าจ้าง/ชม.", "พนักงานประจำ"]);
  });
});
