// เทสอ่านแท็บ Sum 2 (bun test): ตัวเลขสมมติทั้งหมด โครงเหมือนชีตจริง
import { describe, expect, test } from "bun:test";
import { parseCostSheet, sheetCoversPay, sheetMonth } from "@/lib/cost-sheet";

const head = (name: string) => [
  ["", "Actual", "Forecast", "Actual", "Forecast"],
  [name, "Nov 2026", "Nov 2026", "June 2026", "June 2026"],
];
const sheet: unknown[][] = [
  [], [],
  ...head("THB"),
  ["Shopee"],
  ["  In-house ", "", "1,000.00", "900.00", "950.00"],
  ["  Infinit ", "0.00", "500.00", "400.00", "450.00"],
  ["MCN", "", "", "300.00", "300.00"],
  [" Vis Shopee", "0", "0", "0.00", "0.00"],
  ["Total", "", "1,500.00", "1,600.00", "1,700.00"],
  ["  Target"],
  ["Tiktok"],
  ["  In-house Fulltime", "", "0.00", "50.00", "0.00"],
  ["  In-house partime", "", "2,000.00", "1,800.00", "1,900.00"],
  ["  TuesdayHouse ", "", "700.00", "", "650.00"],
  ["  MCN", "", "", "120.00", "100.00"],
  ["Total", "", "2,700.00", "1,970.00", "2,650.00"],
  ["Admin Tiktok"],
  ["  In-house partime", "", "300.00", "280.00", "290.00"],
  ["ค่าเดินทาง parttime", "", "", "60", ""],
  ["Total", "", "300.00", "220.00", "290.00"],
  ["Total", "", "4,500.00", "3,790.00", "4,640.00"],
  ...head("HR"),
  ["Shopee"],
  ["  In-house ", "", "100", "90", "95"],
  ["  Infinit ", "", "5", "4", "4.5"],
  ["Tiktok"],
  ["  TuesdayHouse ", "", "7", "6.5", "6"],
  ...head("HR/THB"),
  ["Shopee"],
  ["  Infinit ", "", "100", "100", "100"],
];
const parsed = parseCostSheet(sheet);
const at = (month: string, app: string, owner: string | null, kind: string) => parsed.get(month)!.find((e) => e.app === app && e.owner === owner && e.kind === kind);

describe("ชื่อเดือน", () => {
  test("ชื่อย่อ / ชื่อเต็ม", () => {
    expect(sheetMonth("Nov 2026")).toBe("2026-11");
    expect(sheetMonth("June 2026")).toBe("2026-06");
    expect(sheetMonth("Actual")).toBeNull();
    expect(sheetMonth("")).toBeNull();
  });
});

describe("อ่านตาราง", () => {
  test("แยกเดือน + Actual / Forecast จากหัวตาราง อ่านตัวเลขมีลูกน้ำได้", () => {
    expect(at("2026-06", "Shopee", "In house", "mc")).toMatchObject({ actual: 900, forecast: 950 });
    expect(at("2026-11", "Shopee", "In house", "mc")).toMatchObject({ actual: null, forecast: 1000 });
  });
  test("ชื่อกลุ่มเป็นชื่อเดียวกับหน้า Cost: Infinit -> Infinite, TuesdayHouse -> TDH", () => {
    expect(at("2026-06", "Shopee", "Infinite", "agency")?.actual).toBe(400);
    expect(at("2026-11", "TikTok", "TDH", "agency")?.forecast).toBe(700);
  });
  test("MCN ของ TikTok กับ Shopee แยกกัน", () => {
    expect(at("2026-06", "TikTok", "MCN", "agency")?.actual).toBe(120);
    expect(at("2026-06", "Shopee", "MCN", "agency")?.actual).toBe(300);
  });
  test("0.00 ในช่อง Actual = ยังไม่ได้กรอก", () => {
    expect(at("2026-11", "Shopee", "Infinite", "agency")).toMatchObject({ actual: null, forecast: 500 });
  });
  test("Fulltime รวมกับ partime · แถว Admin แยกจาก Mc · ค่าเดินทางแยกเป็นค่ารถ", () => {
    expect(at("2026-06", "TikTok", null, "mc")?.actual).toBe(1850);
    expect(at("2026-06", "TikTok", null, "admin")?.actual).toBe(280);
    expect(at("2026-06", "TikTok", null, "travel")?.actual).toBe(60);
  });
  test("ไม่เอาแถวรวม / เป้า และกลุ่มที่ไม่มียอดเลย", () => {
    const owners = [...parsed.values()].flat().map((e) => e.owner);
    expect(owners).not.toContain("Total");
    expect(owners).not.toContain("Vis Shopee");
  });
  test("ชั่วโมงมาจากตาราง HR ของกลุ่มเดียวกัน ไม่ปนตาราง HR/THB", () => {
    expect(at("2026-06", "Shopee", "Infinite", "agency")).toMatchObject({ actualHours: 4, forecastHours: 4.5 });
    expect(at("2026-11", "TikTok", "TDH", "agency")).toMatchObject({ forecastHours: 7, actualHours: null });
    expect(at("2026-06", "TikTok", "TDH", "agency")).toMatchObject({ actual: null, forecast: 650, actualHours: 6.5 });
  });
  test("กลุ่มใหม่ที่ไม่รู้จักไม่หายเงียบ", () => {
    const res = parseCostSheet([...sheet.slice(0, 6), ["  Agency ใหม่", "", "", "77", ""], ...sheet.slice(6)]);
    expect(res.get("2026-06")!.find((e) => e.owner === "Agency ใหม่")?.actual).toBe(77);
  });
  test("อ่านค่าที่เป็นตัวเลขจริงได้", () => {
    const res = parseCostSheet([["", "Actual"], ["THB", "Nov 2026"], ["Shopee"], ["In-house", 1234.5]]);
    expect(res.get("2026-11")![0].actual).toBe(1234.5);
  });
  test("เดือนใหม่แทรกคอลัมน์หน้าสุดก็อ่านถูก", () => {
    const res = parseCostSheet([["", "Actual", "Actual"], ["THB", "Dec 2026", "Nov 2026"], ["Shopee"], ["In-house", "11", "22"]]);
    expect(res.get("2026-12")![0].actual).toBe(11);
    expect(res.get("2026-11")![0].actual).toBe(22);
  });
  test("โครงผิด = แจ้ง error", () => {
    expect(() => parseCostSheet([["อะไรก็ไม่รู้"]])).toThrow();
  });
});

describe("ไม่ต้องโหลดสรุปค่าจ้าง", () => {
  test("มี Actual ครบ Mc / Admin / Mc Shopee", () => {
    expect(sheetCoversPay(parsed.get("2026-06"))).toBe(true);
    expect(sheetCoversPay(parsed.get("2026-11"))).toBe(false);
    expect(sheetCoversPay(undefined)).toBe(false);
  });
});
