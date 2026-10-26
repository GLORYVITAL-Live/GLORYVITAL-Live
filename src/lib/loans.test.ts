// เทสขอยืมอุปกรณ์ (bun test)
import { describe, expect, test } from "bun:test";
import { availableQty, canAct, cleanLoanInput, companionsFor, isOverdue, lightRole, peakHeld, shortages, type Hold } from "@/lib/loans";

const H = 3600_000;
const T0 = Date.UTC(2026, 10, 2, 3); // 2 พ.ย. 2026 10:00 เวลาไทย
const hold = (loanId: number, equipmentId: number, quantity: number, startH: number, endH: number): Hold =>
  ({ loanId, equipmentId, quantity, startMs: T0 + startH * H, endMs: T0 + endH * H });

describe("จำนวนที่ถูกกันพร้อมกัน", () => {
  const holds = [hold(1, 7, 2, 0, 24), hold(2, 7, 1, 48, 72), hold(3, 8, 5, 0, 100)];
  test("คำขอที่ไม่ซ้อนกันเอง = นับสูงสุดพร้อมกัน ไม่ใช่รวม", () => {
    expect(peakHeld(holds, 7, T0, T0 + 72 * H)).toBe(2);
  });
  test("ซ้อนกัน = รวมกัน", () => {
    expect(peakHeld([...holds, hold(4, 7, 3, 12, 30)], 7, T0, T0 + 72 * H)).toBe(5);
  });
  test("คืน 10:00 แล้วอีกคนยืม 10:00 = ไม่ซ้อน", () => {
    expect(peakHeld([hold(1, 7, 2, 0, 24), hold(2, 7, 2, 24, 48)], 7, T0, T0 + 48 * H)).toBe(2);
  });
  test("ช่วงที่ไม่ทับ / ไม่นับคำขอตัวเอง", () => {
    expect(peakHeld(holds, 7, T0 + 24 * H, T0 + 48 * H)).toBe(0);
    expect(peakHeld(holds, 7, T0, T0 + 24 * H, 1)).toBe(0);
  });
  test("เหลือให้ยืม", () => {
    expect(availableQty({ id: 7, quantity: 3 }, holds, T0, T0 + 10 * H)).toBe(1);
    expect(availableQty({ id: 7, quantity: 1 }, holds, T0, T0 + 10 * H)).toBe(0);
  });
  test("ขอเกินที่เหลือ", () => {
    const catalog = [{ id: 7, code: "L1", name: "ไฟ LED", category: "ไฟ", quantity: 3, photoUrl: null }];
    expect(shortages([{ equipmentId: 7, quantity: 2 }], catalog, holds, T0, T0 + 10 * H)).toEqual([{ equipmentId: 7, name: "ไฟ LED", want: 2, left: 1 }]);
    expect(shortages([{ equipmentId: 7, quantity: 1 }], catalog, holds, T0, T0 + 10 * H)).toEqual([]);
    expect(shortages([{ equipmentId: 99, quantity: 1 }], catalog, holds, T0, T0 + 10 * H)[0].left).toBe(0);
  });
});

describe("ฟอร์มขอยืม", () => {
  const ok = { location: " ห้องประชุม  ชั้น 3 ", startAt: new Date(T0).toISOString(), endAt: new Date(T0 + 5 * H).toISOString(), items: [{ equipmentId: 7, quantity: 2 }] };
  test("ข้อมูลครบ", () => {
    const r = cleanLoanInput(ok, T0);
    expect("data" in r && r.data.location).toBe("ห้องประชุม ชั้น 3");
    expect("data" in r && r.data.items).toEqual([{ equipmentId: 7, quantity: 2 }]);
  });
  test("อุปกรณ์ซ้ำ = รวมจำนวน", () => {
    const r = cleanLoanInput({ ...ok, items: [{ equipmentId: 7, quantity: 1 }, { equipmentId: 7, quantity: 2 }] }, T0);
    expect("data" in r && r.data.items).toEqual([{ equipmentId: 7, quantity: 3 }]);
  });
  test("ข้อมูลผิด", () => {
    expect(cleanLoanInput({ ...ok, location: " " }, T0)).toEqual({ error: "กรุณาใส่สถานที่ใช้งาน" });
    expect(cleanLoanInput({ ...ok, endAt: ok.startAt }, T0)).toEqual({ error: "วันเวลาคืนต้องหลังวันเวลายืม" });
    expect(cleanLoanInput({ ...ok, items: [] }, T0)).toEqual({ error: "กรุณาเลือกอุปกรณ์ที่จะยืมอย่างน้อย 1 รายการ" });
    expect(cleanLoanInput({ ...ok, items: [{ equipmentId: 7, quantity: 0 }] }, T0)).toEqual({ error: "จำนวนต้องเป็นเลขจำนวนเต็มมากกว่า 0" });
    expect(cleanLoanInput(ok, T0 + 2 * H)).toEqual({ error: "วันเวลายืมผ่านไปแล้ว" });
    expect(cleanLoanInput({ ...ok, endAt: new Date(T0 + 91 * 24 * H).toISOString() }, T0)).toEqual({ error: "ยืมได้ครั้งละไม่เกิน 90 วัน" });
  });
});

describe("ยืมไฟเป็นชุด", () => {
  let id = 0;
  const item = (code: string, name: string, quantity = 1) => ({ id: ++id, code, name, category: "ไฟ", quantity, photoUrl: null });
  const leones = item("LT01", "leones haven 200bi + สายไฟ leones haven 200bi");
  const leonesStand = item("LT02", "ขา leones haven 200bi");
  const lantern = item("LT03", "Lakrone Lantern 65 Softbox");
  const nanlite = item("LT07", "Nanlite FS-150B + สายไฟ Nanlite FS-150B");
  const godox = item("LT13", "Godox P260C pro");
  const godoxCable = item("LT14", "สายไฟ Godox P260C pro");
  const odigi = item("LT15", "ขาไฟOdigiLife L-2200FP");
  const godoxBox = item("LT22", "Softbox Godox", 3);
  const steel = item("LT30", "(ขาไฟสแตนเลส) Stainless Steel Light Stand");
  const catalog = [leones, leonesStand, lantern, nanlite, godox, godoxCable, odigi, godoxBox, steel];
  const all = () => 1;

  test("แยกหน้าที่จากชื่อ", () => {
    expect([leones, leonesStand, lantern, godoxCable, odigi, steel].map(lightRole)).toEqual(["light", "stand", "softbox", "cable", "stand", "stand"]);
    expect(lightRole({ name: "ขาตั้ง Benro T890", category: "ขาตั้งกล้อง" })).toBeNull();
  });
  test("ขารุ่นเดียวกันก่อน", () => {
    expect(companionsFor(leones, catalog, all).items.map((c) => c.code)).toEqual(["LT02", "LT03"]);
  });
  test("ไฟรุ่นอื่น = ขาทั่วไป ไม่เอาขาของรุ่นอื่น", () => {
    expect(companionsFor(nanlite, catalog, all).items[0].code).toBe("LT15");
  });
  test("Softbox ยี่ห้อเดียวกันก่อน + สายไฟที่แยกรายการ", () => {
    expect(companionsFor(godox, catalog, all).items.map((c) => c.code)).toEqual(["LT15", "LT22", "LT14"]);
  });
  test("ของไม่ว่าง = ข้าม / ไม่มีเลย = บอกว่าขาดอะไร", () => {
    const free = (c: { code: string }) => (["LT02", "LT15"].includes(c.code) ? 0 : 1);
    expect(companionsFor(leones, catalog, free).items[0].code).toBe("LT30");
    const none = companionsFor(leones, catalog, (c) => (lightRole(c) === "softbox" ? 0 : 1));
    expect(none.missing).toEqual(["Softbox"]);
  });
});

describe("สถานะ", () => {
  test("กดได้ตามสถานะ", () => {
    expect(canAct("pending", "approve")).toBe(true);
    expect(canAct("approved", "handover")).toBe(true);
    expect(canAct("borrowed", "return")).toBe(true);
    expect(canAct("borrowed", "cancel")).toBe(false);
    expect(canAct("returned", "approve")).toBe(false);
  });
  test("คืนเลยกำหนด", () => {
    expect(isOverdue({ status: "borrowed", endAt: new Date(T0).toISOString() }, T0 + H)).toBe(true);
    expect(isOverdue({ status: "returned", endAt: new Date(T0).toISOString() }, T0 + H)).toBe(false);
  });
});
