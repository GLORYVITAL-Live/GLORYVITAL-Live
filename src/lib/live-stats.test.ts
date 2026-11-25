// เทสอ่านไฟล์ Export + ยอดรวม (bun test) — ไฟล์ที่ไม่มีคอลัมน์ชิ้นที่ขาย
import { describe, expect, test } from "bun:test";
import { cleanSession, metricOf, parseRows, totalsOf } from "@/lib/live-stats";

const SHOPEE_HEAD = ["User Id", "ชื่อ Live", "เวลาเริ่มต้น", "ระยะเวลา", "ยอดขาย(คำสั่งซื้อที่ยืนยันแล้ว)", "คำสั่งซื้อ(คำสั่งซื้อที่ยืนยันแล้ว)", "ผู้ชมทั้งหมด"];
const shopeeRow = (start: string, gmv: number, orders: number) => ["121082485", "ไลฟ์", start, "02:00:00", String(gmv), String(orders), "300"];

describe("ไฟล์ Shopee ที่ไม่มีคอลัมน์ชิ้นที่ขาย", () => {
  test("ไม่มีคอลัมน์ = ชิ้นที่ขายไม่รู้ (null ไม่ใช่ 0) + บอกคอลัมน์ที่ขาด", () => {
    const f = parseRows([SHOPEE_HEAD, shopeeRow("24-11-2026 06:01", 25272, 19)]);
    expect(f.platform).toBe("Shopee");
    expect(f.sessions[0].itemsSold).toBeNull();
    expect(f.missing).toEqual(["สินค้าที่ขายได้ (ชิ้นที่ขาย)", "ผู้ชมที่มีส่วนร่วม"]);
  });
  test("มีคอลัมน์ = ใช้ค่าในไฟล์ · ช่องว่าง = 0 · ไม่มีคอลัมน์ที่ขาด", () => {
    const head = [...SHOPEE_HEAD, "สินค้าที่ขายได้(คำสั่งซื้อที่ยืนยันแล้ว)", "ผู้ชมที่มีส่วนร่วม"];
    const f = parseRows([head, [...shopeeRow("24-10-2026 06:00", 20953, 17), "20", "50"], [...shopeeRow("24-10-2026 09:03", 100, 1), "", "10"]]);
    expect(f.sessions.map((s) => s.itemsSold)).toEqual([20, 0]);
    expect(f.missing).toEqual([]);
  });
});

describe("ยอดรวมชิ้นที่ขาย", () => {
  const f = parseRows([[...SHOPEE_HEAD, "สินค้าที่ขายได้(คำสั่งซื้อที่ยืนยันแล้ว)"], [...shopeeRow("24-10-2026 06:00", 20953, 17), "20"], [...shopeeRow("25-10-2026 06:00", 100, 1), "3"]]);
  const known = f.sessions;
  const unknown = parseRows([SHOPEE_HEAD, shopeeRow("24-11-2026 06:01", 25272, 19)]).sessions;
  test("รู้ทุกไลฟ์ = รวมปกติ", () => {
    expect(totalsOf(known).items).toBe(23);
    expect(metricOf("items").value(totalsOf(known))).toBe(23);
  });
  test("มีไลฟ์ที่ไม่รู้ = ไม่มีข้อมูล (ไม่แสดงเป็นยอดที่ลดลง) · ตัวชี้วัดอื่นยังรวมปกติ", () => {
    const t = totalsOf([...known, ...unknown]);
    expect(t.items).toBeNull();
    expect(metricOf("items").value(t)).toBeNull();
    expect(t.orders).toBe(37);
  });
  test("ส่งขึ้นเซิร์ฟเวอร์: null ผ่านการตรวจเป็น null", () => {
    expect(cleanSession(JSON.parse(JSON.stringify(unknown[0])))?.itemsSold).toBeNull();
    expect(cleanSession(JSON.parse(JSON.stringify(known[0])))?.itemsSold).toBe(20);
  });
});
