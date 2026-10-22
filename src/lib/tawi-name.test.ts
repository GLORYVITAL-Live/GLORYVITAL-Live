// เทสอ่านชื่อไฟล์ใบ 50 ทวิ (bun test) — ชื่อในเทสเป็นชื่อสมมติ
import { describe, expect, test } from "bun:test";
import {
  cleanRealName, dominantMonth, isCompany, monthFromDocNo, monthFromFolder, parseTawiFile, similarity, stripTitle, suggestPeople,
  tawiMonthLabel, tawiNameKey,
} from "@/lib/tawi-name";

// 19 ต.ค. 2026 เวลาไทย
const NOW = Date.UTC(2026, 9, 19, 3);
const CO = "บริษัท ทดสอบ เทรดดิ้ง จำกัด (สำนักงานใหญ่)";

describe("อ่านชื่อไฟล์", () => {
  test("แบบบริษัท_เลขเอกสาร_ชื่อ: คำนำหน้าติดชื่อ", () => {
    expect(parseTawiFile(`${CO}_WT2026060032_น.ส.สมใจ ใจดี (สำนักงานใหญ่).pdf`, "06JUN", { now: NOW }))
      .toEqual({ month: "2026-06", realName: "สมใจ ใจดี", nameKey: "สมใจใจดี", docNo: true });
  });
  test("แบบบริษัท: นางสาว + ช่องว่างซ้ำ / นาย / ไฟล์ซ้ำ (1)", () => {
    expect(parseTawiFile(`${CO}_WT2026050011_นางสาว สมใจ  ใจดี (สำนักงานใหญ่).pdf`, "05May", { now: NOW })?.realName).toBe("สมใจ ใจดี");
    expect(parseTawiFile(`${CO}_WT2026050012_นายสมชาย รักงาน (สำนักงานใหญ่).pdf`, "05May", { now: NOW })?.realName).toBe("สมชาย รักงาน");
    expect(parseTawiFile(`${CO}_WT2026050013_นางสาวมะลิ หอมดี (สำนักงานใหญ่) (1).pdf`, "05May", { now: NOW })?.realName).toBe("มะลิ หอมดี");
    expect(parseTawiFile(`${CO}_WT2026050014_น.ส สมใจ ใจดี (สำนักงานใหญ่).pdf`, "05May", { now: NOW })?.realName).toBe("สมใจ ใจดี");
  });
  test("แบบ WHT-เลข-ชื่อ (ตัวอักษร WTI / WHT)", () => {
    expect(parseTawiFile("WTI-20260900067-สมใจ ใจดี.pdf", "09Sep", { now: NOW }))
      .toEqual({ month: "2026-09", realName: "สมใจ ใจดี", nameKey: "สมใจใจดี", docNo: true });
    expect(parseTawiFile("WHT-20260900068-นาย สมชาย รักงาน.PDF", "09Sep", { now: NOW })?.month).toBe("2026-09");
  });
  test("แบบ WHT ชื่อ (ไม่มีเลข) = เดือนจากโฟลเดอร์", () => {
    expect(parseTawiFile("WHT นาย สมชาย รักงาน.pdf", "08AUG", { now: NOW }))
      .toEqual({ month: "2026-08", realName: "สมชาย รักงาน", nameKey: "สมชายรักงาน", docNo: false });
    expect(parseTawiFile("WHT น.ส.มะลิ หอมดี (2).pdf", "08AUG", { now: NOW })?.realName).toBe("มะลิ หอมดี");
    expect(parseTawiFile("WHT น.สมะลิ หอมดี.pdf", "08AUG", { now: NOW })?.realName).toBe("มะลิ หอมดี");
    // เดือนที่พบบ่อยจากไฟล์อื่นในโฟลเดอร์มาก่อน
    expect(parseTawiFile("WHT นาย สมชาย รักงาน.pdf", "08AUG", { now: NOW, fallbackMonth: "2025-08" })?.month).toBe("2025-08");
  });
  test("ข้าม: ไม่ใช่ PDF / ผู้รับเป็นบริษัท / ไม่มีชื่อ", () => {
    expect(parseTawiFile("202603 WHT ABC DEF.zip", "03Mar", { now: NOW })).toBeNull();
    expect(parseTawiFile(`${CO}_WT2026070001_บริษัท ตัวอย่าง มีเดีย จำกัด (สำนักงานใหญ่).pdf`, "07JUL", { now: NOW })).toBeNull();
    expect(parseTawiFile("WHT บจก.ตัวอย่าง มีเดีย.pdf", "08AUG", { now: NOW })).toBeNull();
    expect(parseTawiFile("WHT-20260900067-.pdf", "09Sep", { now: NOW })).toBeNull();
  });
  test("ชื่อภาษาอังกฤษ + Mr. / Ms.", () => {
    expect(parseTawiFile("WTI-20260900070-Mr. John Smith.pdf", "09Sep", { now: NOW })?.realName).toBe("John Smith");
    expect(parseTawiFile("WTI-20260900071-Ms.Jane Doe.pdf", "09Sep", { now: NOW })?.nameKey).toBe("janedoe");
  });
});

describe("คำนำหน้า / คีย์ชื่อ", () => {
  test("ตัดคำนำหน้าหลายแบบ", () => {
    for (const t of ["นาย", "นาง", "นางสาว", "น.ส.", "นส.", "Mr.", "Mrs.", "Ms.", "Miss "]) {
      expect(stripTitle(`${t}สมใจ ใจดี`)).toBe("สมใจ ใจดี");
      expect(stripTitle(`${t} สมใจ ใจดี`)).toBe("สมใจ ใจดี");
    }
  });
  test("คีย์เดียวกันไม่ว่าเว้นวรรค / คำนำหน้า / ตัวพิมพ์", () => {
    expect(tawiNameKey("นางสาว สมใจ  ใจดี")).toBe(tawiNameKey("สมใจใจดี"));
    expect(tawiNameKey("Mr. JOHN smith")).toBe("johnsmith");
    // "ํา" (นิคหิต + สระอา) = "ำ"
    expect(tawiNameKey("สํารวย ดี")).toBe(tawiNameKey("สำรวย ดี"));
    // สระ / วรรณยุกต์ที่พิมพ์ซ้อน = ตัวเดียว (ไฟล์ใบ 50 ทวิพิมพ์ "สุุ") · ตัวต่างกันไม่ถูกรวม
    expect(tawiNameKey("น.ส.สุุกฤตา ใจดี")).toBe(tawiNameKey("สุกฤตา ใจดี"));
    expect(tawiNameKey("สมใจ ใจดี้้")).toBe(tawiNameKey("สมใจ ใจดี้"));
    expect(tawiNameKey("สุกฤตา")).not.toBe(tawiNameKey("สูกฤตา"));
  });
  test("cleanRealName ตัดวงเล็บ", () => expect(cleanRealName("น.ส.สมใจ ใจดี (สำนักงานใหญ่)")).toBe("สมใจ ใจดี"));
  test("isCompany", () => {
    expect(isCompany("บริษัท ตัวอย่าง จำกัด")).toBe(true);
    expect(isCompany("หจก.ตัวอย่าง")).toBe(true);
    expect(isCompany("สมใจ ใจดี")).toBe(false);
  });
});

describe("เดือน", () => {
  test("จากเลขเอกสาร", () => {
    expect(monthFromDocNo("WT2026060032")).toBe("2026-06");
    expect(monthFromDocNo("WTI-20260900067")).toBe("2026-09");
    expect(monthFromDocNo("WT2026130032")).toBeNull();
    expect(monthFromDocNo("WHT นาย สมชาย")).toBeNull();
  });
  test("จากชื่อโฟลเดอร์ (ปีปัจจุบัน / เดือนที่ยังไม่ถึง = ปีก่อน)", () => {
    expect(monthFromFolder("02Feb", NOW)).toBe("2026-02");
    expect(monthFromFolder("04Apr.", NOW)).toBe("2026-04");
    expect(monthFromFolder("06JUN", NOW)).toBe("2026-06");
    expect(monthFromFolder("10Oct", NOW)).toBe("2026-10");
    expect(monthFromFolder("12Dec", NOW)).toBe("2025-12");
    expect(monthFromFolder("Nov", NOW)).toBe("2025-11");
    expect(monthFromFolder("2025-03", NOW)).toBe("2025-03");
    expect(monthFromFolder("ไฟล์อื่น", NOW)).toBeNull();
  });
  test("เดือนที่พบบ่อยในโฟลเดอร์", () => {
    expect(dominantMonth(["WT2026060001_a.pdf", "WT2026060002_b.pdf", "WT2026050003_c.pdf", "WHT x.pdf"])).toBe("2026-06");
    expect(dominantMonth(["WHT x.pdf"])).toBeNull();
  });
  test("ป้ายเดือน", () => expect(tawiMonthLabel("2026-09")).toBe("ก.ย. 2026"));
});

describe("แนะนำคนที่น่าจะใช่", () => {
  const people = [
    { id: 1, label: "Mc มะลิ", keys: [tawiNameKey("มะลิ หอมดี")], nick: "มะลิ" },
    { id: 2, label: "Mc ส้ม", keys: [], nick: "ส้ม" },
    { id: 3, label: "สมชาย", keys: [], nick: "สมชาย" },
  ];
  test("ชื่อจริงที่รู้ (สะกดต่างเล็กน้อย)", () => {
    expect(similarity("มะลิหอมดี", "มะลิหอมดี")).toBe(1);
    expect(suggestPeople("มะลิ หอมดีย์", people)[0]?.id).toBe(1);
  });
  test("ชื่อในระบบ = ชื่อต้นของชื่อจริง", () => expect(suggestPeople("สมชาย รักงาน", people).map((s) => s.id)).toEqual([3]));
  test("ไม่ใกล้ใครเลย = ว่าง", () => expect(suggestPeople("วิไล ไกลตา", people)).toEqual([]));
});
