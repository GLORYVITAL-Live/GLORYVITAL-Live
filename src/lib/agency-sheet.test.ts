// เทสแผ่นงาน Agency ในไฟล์ส่งออก Plan Slot Live (bun test)
import { describe, expect, test } from "bun:test";
import { agencyCampaign, agencySheet, agencyStatus, type AgencySheetSlot } from "@/lib/agency-sheet";
import { buildXlsx, cleanBook, styleAt } from "@/lib/export";

const s = (date: string, start: string, end: string, campaign = "Bau", draft = false, adjusted = false): AgencySheetSlot => ({ date, start, end, campaign, draft, adjusted });
const FIRST_ROW = 2; // แถว 0 = หัวคอลัมน์ / แถว 1 = แถบดำ

describe("แผ่นงาน Agency", () => {
  test("ช่วงที่ต่อกันรวมเป็นแถวเดียว + วันเป็นภาษาอังกฤษ + ชั่วโมง 2 แบบ", () => {
    const { rows } = agencySheet("Agency TDH", "2026-11", [s("2026-11-03", "19:30", "21:30"), s("2026-11-03", "21:30", "23:30")]);
    expect(rows.slice(FIRST_ROW)).toEqual([["", "3 Nov", "Tuesday", "19:30", "23:30", "4:00", { v: 4, f: "money" }, "Confirmed", "Bau"]]);
  });
  test("ข้ามเที่ยงคืน: เรียงจากต้นคืนแม้ข้อมูลสลับกัน แล้วรวมเป็นช่วงเดียว", () => {
    const { rows } = agencySheet("Agency TDH", "2026-11", [
      s("2026-11-10", "01:30", "03:30"), s("2026-11-10", "05:30", "07:30"), s("2026-11-10", "23:30", "01:30"), s("2026-11-10", "03:30", "05:30"),
    ]);
    expect(rows.slice(FIRST_ROW)).toEqual([["", "10 Nov", "Tuesday", "23:30", "7:30", "8:00", { v: 8, f: "money" }, "Confirmed", "Bau"]]);
  });
  test("ช่วงที่ไม่ต่อกันในวันเดียว = คนละแถว เรียงตามวันที่", () => {
    const { rows } = agencySheet("Agency TDH", "2026-11", [s("2026-11-04", "19:30", "21:30"), s("2026-11-03", "21:30", "23:30"), s("2026-11-03", "12:00", "14:00")]);
    expect(rows.slice(FIRST_ROW).map((r) => [r[1], r[3], r[4]])).toEqual([["3 Nov", "12:00", "14:00"], ["3 Nov", "21:30", "23:30"], ["4 Nov", "19:30", "21:30"]]);
  });
  test("แถบดำมีเดือน + ชั่วโมงรวมทั้งเดือนสีเหลือง", () => {
    const sheet = agencySheet("Agency TDH", "2026-11", [s("2026-11-03", "19:30", "23:30"), s("2026-11-07", "21:30", "02:30")]);
    expect(sheet.rows[1][0]).toBe("Nov");
    expect(sheet.rows[1][6]).toEqual({ v: 9, f: "money" });
    expect(styleAt(sheet, 1, 0)).toMatchObject({ bg: "000000", color: "FFFFFF" });
    expect(styleAt(sheet, 1, 6)).toMatchObject({ bg: "000000", color: "FFFF00" });
  });
  test("สีครีมเฉพาะแถวที่ไลฟ์เลยเที่ยงคืน ตั้งแต่ช่องวันถึงชั่วโมง", () => {
    const sheet = agencySheet("Agency TDH", "2026-11", [s("2026-11-03", "19:30", "23:30"), s("2026-11-07", "21:30", "02:30"), s("2026-11-08", "22:00", "00:00")]);
    const cream = (row: number) => [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => styleAt(sheet, row, c)?.bg === "FFF2CC");
    expect(cream(FIRST_ROW)).toEqual([]);
    expect(cream(FIRST_ROW + 1)).toEqual([2, 3, 4, 5, 6]);
    expect(cream(FIRST_ROW + 2)).toEqual([]); // จบเที่ยงคืนพอดี ไม่นับว่าข้าม
  });
  test("สถานะ: บันทึกแล้ว = Confirmed / มีส่วนที่ยังเป็นร่าง = Draft", () => {
    const sheet = agencySheet("Agency TDH", "2026-11", [s("2026-11-03", "19:30", "21:30"), s("2026-11-03", "21:30", "23:30", "Bau", true), s("2026-11-04", "19:30", "23:30")]);
    expect(sheet.rows[FIRST_ROW][7]).toBe("Draft");
    expect(sheet.rows[FIRST_ROW + 1][7]).toBe("Confirmed");
    expect(styleAt(sheet, FIRST_ROW, 7)?.bg).toBe("FFE5A0");
    expect(styleAt(sheet, FIRST_ROW + 1, 7)?.bg).toBe("D4EDBC");
  });
  test("Adjusted: ป้ายแดง + ตัวหนาตั้งแต่ช่องวันถึงชั่วโมง / แถวข้ามเที่ยงคืนยังเป็นพื้นครีม", () => {
    const sheet = agencySheet("Agency TDH", "2026-11", [
      s("2026-11-20", "19:30", "23:30", "Bau", false, true), s("2026-11-26", "23:30", "02:30", "Payday", false, true), s("2026-11-27", "21:30", "02:30"),
    ]);
    expect(sheet.rows[FIRST_ROW][7]).toBe("Adjusted");
    expect(styleAt(sheet, FIRST_ROW, 7)).toMatchObject({ bg: "FFCFC9", color: "B10202" });
    const bold = (row: number) => [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => styleAt(sheet, row, c)?.bold);
    expect(bold(FIRST_ROW)).toEqual([2, 3, 4, 5, 6]);
    expect(styleAt(sheet, FIRST_ROW, 3)?.bg).toBe("FFFFFF");
    expect(bold(FIRST_ROW + 1)).toEqual([2, 3, 4, 5, 6]);
    expect(styleAt(sheet, FIRST_ROW + 1, 3)?.bg).toBe("FFF2CC");
    expect(bold(FIRST_ROW + 2)).toEqual([]);
    expect(sheet.rows[FIRST_ROW + 2][7]).toBe("Confirmed");
  });
  test("สถานะมาก่อนหลัง: ตั้ง Adjusted ไว้ชนะร่าง / ร่างชนะ Confirmed", () => {
    expect(agencyStatus(true, true)).toBe("Adjusted");
    expect(agencyStatus(false, true)).toBe("Draft");
    expect(agencyStatus(false, false)).toBe("Confirmed");
  });
  test("สีและหัวตารางผ่านการตรวจฝั่ง Google Sheet + สร้างไฟล์ Excel ได้", () => {
    const sheet = agencySheet("Agency TDH", "2026-11", [s("2026-11-07", "21:30", "02:30", "11.11")]);
    const clean = cleanBook({ title: "t", sheets: [sheet] })!;
    expect(clean.sheets[0]).toMatchObject({ header: 1, colWidths: sheet.colWidths });
    expect(styleAt(clean.sheets[0], FIRST_ROW, 2)?.bg).toBe("FFF2CC");
    expect(styleAt(clean.sheets[0], 1, 6)?.color).toBe("FFFF00");
    expect(buildXlsx({ title: "t", sheets: [sheet] }).length).toBeGreaterThan(0);
  });
});

describe("Campaign ของแผ่น Agency", () => {
  test("ไม่มีแคมเปญ = Bau", () => {
    expect(agencyCampaign([])).toBe("Bau");
    expect(agencyCampaign(["", " "])).toBe("Bau");
  });
  test("ใช้ชื่อย่อแบบที่คุยกับ Agency ส่วนชื่ออื่นคงเดิม", () => {
    expect(agencyCampaign(["Mid Month"])).toBe("MM");
    expect(agencyCampaign(["Pay Day"])).toBe("Payday");
    expect(agencyCampaign(["11.11"])).toBe("11.11");
    expect(agencyCampaign(["Brand Prime Day"])).toBe("Brand Prime Day");
  });
  test("บาง slot ไม่ได้ใส่แคมเปญ = ใช้ชื่อที่มี / หลายชื่อ = แสดงครบไม่ซ้ำ", () => {
    expect(agencyCampaign(["Pay Day", "", "Pay Day"])).toBe("Payday");
    expect(agencyCampaign(["12.12", "CEO Live"])).toBe("12.12, CEO Live");
  });
});
