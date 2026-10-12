import { describe, expect, test } from "bun:test";
import { hasCeoSheet, parseCeoSheet, parseHeaderDate, parseRate, splitCsv, splitPasted } from "@/lib/ceo-parse";
import { buildXlsx } from "@/lib/export";
import { readXlsxSheets } from "@/lib/live-stats";

// ตารางแบบที่ทีม track ใน Google Sheet (วางทั้งชีต: Before / Session / Ceo Live)
const SHEET = [
  "Before Ceo Live\t2 Mar\t22 May\t8 Oct",
  "GMV\t91,686\t75,833\t661,317.34",
  "Order\t446\t103\t1,592",
  "",
  "Session Ceo Live\t3 Mar ceo live\t23 May ceo durian\t5 Jun durian\t9 Oct CEO Live",
  "GMV\t132,456\t62,183\t41,658\t165,645",
  "GMV / hr\t88,304\t41,455\t41,658\t54,810",
  "Duration/hr.\t1.50\t1.50\t1.00\t2",
  "Order\t201\t91\t55\t482",
  "Viewers\t41,983\t55,716\t\t",
  "Views\t58,190\t108,520\t13,690\t27,284",
  "Peak Viewers\t158\t330\t79\t418",
  "Peak time Viewers\t\t\t\t11.59/258",
  "time\t\t\t\t11.50-13.40",
  "impressions\t629,090\t465,950\t346,400\t556,740",
  "CTR\t24.36%\t44.57%\t14.32%\t28.80%",
  "CO\t7.70%\t1.14%\t5.83%\t8.58%",
  "",
  "Ceo Live\t3 Mar ceo live\t23 May ceo durian\t5 Jun durian\t9 Oct CEO Live",
  "GMV\t1,118,675\t473,731\t585,410\t911,691.57",
].join("\n");

describe("parseHeaderDate", () => {
  test("วัน + เดือนอังกฤษ + ชื่อ", () => {
    expect(parseHeaderDate("3 Mar ceo live", 2026)).toEqual({ date: "2026-03-03", title: "ceo live" });
    expect(parseHeaderDate("23 June ceo x KOL", 2026)).toEqual({ date: "2026-06-23", title: "ceo x KOL" });
    expect(parseHeaderDate("9 Oct", 2026)).toEqual({ date: "2026-10-09", title: "" });
  });
  test("รูปแบบอื่น", () => {
    expect(parseHeaderDate("9 ต.ค. CEO", 2026)?.date).toBe("2026-10-09");
    expect(parseHeaderDate("9/10/2569", 2026)?.date).toBe("2026-10-09");
    expect(parseHeaderDate("2026-10-09", 2025)?.date).toBe("2026-10-09");
    expect(parseHeaderDate("46304", 2026)?.date).toBe("2026-10-09");
    expect(parseHeaderDate("31 Feb", 2026)).toBeNull();
    expect(parseHeaderDate("GMV", 2026)).toBeNull();
  });
});

test("parseRate: % / สัดส่วน / ตัวเลขไม่มี %", () => {
  expect(parseRate("24.36%")).toBeCloseTo(0.2436);
  expect(parseRate("0.2436")).toBeCloseTo(0.2436);
  expect(parseRate("8.58")).toBeCloseTo(0.0858);
  expect(parseRate("")).toBeNull();
});

describe("parseCeoSheet", () => {
  const { sessions, warnings } = parseCeoSheet(splitPasted(SHEET), 2026);
  test("หยิบเฉพาะตาราง Session (ไม่ใช่ Before / Ceo Live)", () => {
    expect(sessions.map((s) => s.date)).toEqual(["2026-03-03", "2026-05-23", "2026-06-05", "2026-10-09"]);
    expect(warnings).toEqual([]);
  });
  test("ตัวเลข / อัตรา / ข้อความ", () => {
    const oct = sessions.find((s) => s.date === "2026-10-09")!;
    expect(oct).toMatchObject({
      title: "CEO Live", gmv: 165645, durationHr: 2, orders: 482, viewers: null, views: 27284,
      peakViewers: 418, peakTime: "11.59/258", timeRange: "11.50-13.40", impressions: 556740,
    });
    expect(oct.ctr).toBeCloseTo(0.288);
    expect(oct.co).toBeCloseTo(0.0858);
    expect(sessions[0]).toMatchObject({ gmv: 132456, durationHr: 1.5, viewers: 41983 });
  });
  test("ไม่มีตาราง Session = แจ้ง error", () => {
    expect(() => parseCeoSheet(splitPasted("GMV\t1\t2"), 2026)).toThrow();
    expect(hasCeoSheet(splitPasted("GMV\t1\t2"), 2026)).toBe(false);
  });
});

test("ไฟล์ .xlsx หลายชีต: ตาราง Session อยู่แท็บที่ 2 (ตัวเลข / % เป็นค่าจริงในไฟล์)", () => {
  const file = buildXlsx({
    title: "CEO track",
    sheets: [
      { name: "สรุป", rows: [["อื่น ๆ", "ไม่เกี่ยว"], ["GMV", 1]] },
      {
        name: "Ceo Live",
        rows: [
          ["Session Ceo Live", "3 Mar ceo live", "9 Oct CEO Live"],
          ["GMV", { v: 132456, f: "int" }, { v: 165645, f: "int" }],
          ["Duration/hr.", { v: 1.5, f: "dec" }, { v: 2, f: "dec" }],
          ["time", "", "11.50-13.40"],
          ["CTR", { v: 0.2436, f: "pct" }, { v: 0.288, f: "pct" }],
        ],
      },
    ],
  });
  const sheets = readXlsxSheets(file);
  expect(sheets.map((s) => s.name)).toEqual(["สรุป", "Ceo Live"]);
  const hit = sheets.find((s) => hasCeoSheet(s.rows, 2026))!;
  expect(hit.name).toBe("Ceo Live");
  const { sessions } = parseCeoSheet(hit.rows, 2026);
  expect(sessions.map((s) => [s.date, s.gmv, s.durationHr, s.timeRange])).toEqual([["2026-03-03", 132456, 1.5, ""], ["2026-10-09", 165645, 2, "11.50-13.40"]]);
  expect(sessions[0].ctr).toBeCloseTo(0.2436);
});

test("ไฟล์ .csv (ช่องที่มีคอมมาอยู่ใน \"...\")", () => {
  const csv = 'Session Ceo Live,3 Mar ceo live,9 Oct CEO Live\r\nGMV,"132,456","165,645"\r\nCTR,24.36%,28.80%\r\n';
  expect(splitCsv(csv).slice(0, 2)).toEqual([["Session Ceo Live", "3 Mar ceo live", "9 Oct CEO Live"], ["GMV", "132,456", "165,645"]]);
  const { sessions } = parseCeoSheet(splitCsv(csv), 2026);
  expect(sessions.map((s) => [s.date, s.gmv])).toEqual([["2026-03-03", 132456], ["2026-10-09", 165645]]);
  expect(sessions[1].ctr).toBeCloseTo(0.288);
});
