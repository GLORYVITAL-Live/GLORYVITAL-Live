// เทส Forecast ในแท็บ Sum 2: วันล็อค / ชั่วโมงจากแพลน / ช่องที่ต้องเขียน / ชุดที่ล็อค (bun test)
//   ตัวเลขทั้งหมดเป็นตัวเลขสมมติ (repo เป็น public ไม่ใส่เรท / ยอดจริงของทีม)
import { describe, expect, test } from "bun:test";
import {
  bkkMonth, colLetter, forecastEntriesOf, forecastHours, forecastTotal, forecastWrites, lockAt, lockDue, rateInFormula, sheetForecastHours, withLockedForecasts,
} from "@/lib/cost-forecast";
import { parseCostSheet } from "@/lib/cost-sheet";

const bkk = (s: string) => Date.parse(`${s}+07:00`);

/** โครงแท็บ Sum 2 ย่อ: คอลัมน์ B/C = ธ.ค. (Actual/Forecast) · D/E = พ.ย. */
function sheet(dec: Record<string, unknown> = {}) {
  const v: unknown[][] = [], f: unknown[][] = [];
  const row = (label: string, c: unknown = "", e: unknown = "", cf: unknown = c, ef: unknown = e) => {
    v.push([label, "", c, "", e]);
    f.push([label, "", cf, "", ef]);
  };
  const head = (name: string) => {
    row("", "Forecast", "Forecast");
    v.push([name, "Dec 2026", "Dec 2026", "Nov 2026", "Nov 2026"]);
    f.push([name, 46358, 46358, 46327, 46327]);
    v[v.length - 2][1] = "Actual"; v[v.length - 2][3] = "Actual";
  };
  // THB (แถว 1–21)
  head("THB");
  row("Shopee");
  row("  In-house ", "0", "100,000", dec.C_inhouse ?? 0, "=500*E25"); // แถว 4
  row("  Infinit ", "0", "50,000", dec.C_inf ?? "=1000*C26", "=1000*E26");
  row("MCN", "0", "40,000", dec.C_mcn ?? "=500*C27", "=500*E27");
  row(" Vis Shopee", "0", "0", 0, 0);
  row("Total");
  row("Tiktok");
  row("  In-house Fulltime", "0", "0", 0, 0);
  row("  In-house partime", "0", "300,000", "=700*C32", "=700*E32");
  row("  TuesdayHouse ", "0", "100,000", "=2000*C33", "=2000*E33");
  row("  MCN", "0", "0", 0, 0);
  row("Total");
  row("Admin Tiktok");
  row("  In-house partime", "0", "30,000", "=150*C38", "=150*E38");
  row("Total");
  while (v.length < 21) row("");
  // HR (แถว 22 เป็นต้นไป)
  head("HR");
  row("Shopee");
  row("  In-house ", "0", "200", dec.C25 ?? 0, 200); // แถว 25
  row("  Infinit ", "0", "50", 0, 50);
  row("MCN", "0", "80", 0, 80);
  row(" Vis Shopee", "", "", "", "");
  row("Total");
  row("Tiktok");
  row("  In-house Fulltime", "0", "100", 0, 100); // แถว 31
  row("  In-house partime", "0", "430", 0, "=530-E31");
  row("  TuesdayHouse ", "0", "50", 0, 50);
  row("  MCN", "0", "0", 0, 0);
  row("Total");
  row("Admin Tiktok");
  row("  In-house Fulltime", "300", "300", 300, 300);
  return { values: v, formulas: f };
}

const hours = forecastHours(
  [
    ...Array.from({ length: 30 }, () => ({ platform: "Shopee", shopeeTab: true, start: "10:00", end: "20:00", salaried: false })), // 300
    ...Array.from({ length: 50 }, () => ({ platform: "GLORY MALL", shopeeTab: false, start: "22:00", end: "00:00", salaried: true })), // 100 (ข้ามเที่ยงคืน)
    ...Array.from({ length: 250 }, () => ({ platform: "GLORY MALL", shopeeTab: false, start: "09:30", end: "11:30", salaried: false })), // 500
  ],
  [
    { agency: "In house", platform: "Shopee", start: "00:00", end: "10:00" }, // ทีมเรา ไม่นับซ้ำ
    { agency: "Infinite", platform: "Shopee", start: "06:00", end: "12:00" },
    { agency: "MCN", platform: "Shopee", start: "12:00", end: "16:00" },
    { agency: "Vis", platform: "Shopee", start: "16:00", end: "18:00" },
    { agency: "TDH", platform: "GLORY MALL", start: "18:00", end: "21:00" },
  ],
);

describe("Forecast Sum 2", () => {
  test("วันล็อค = สิ้นวันที่ 20 ของเดือนก่อนหน้า (เวลาไทย)", () => {
    expect(lockAt("2026-12")).toBe(bkk("2026-11-21T00:00:00"));
    expect(lockAt("2027-01")).toBe(bkk("2026-12-21T00:00:00"));
    expect(lockDue("2026-12", bkk("2026-11-20T23:59:00"))).toBe(false);
    expect(lockDue("2026-12", bkk("2026-11-21T00:00:00"))).toBe(true);
    expect(bkkMonth(bkk("2026-11-30T23:30:00"), 1)).toBe("2026-12");
    expect(bkkMonth(bkk("2026-12-05T10:00:00"), 1)).toBe("2027-01");
  });

  test("ชั่วโมงจากแพลน: Shopee / TikTok / Fulltime / กลุ่มภายนอก (ไม่นับ In house ซ้ำ)", () => {
    expect(hours.shopeeInHouse).toBe(300);
    expect(hours.tiktokInHouse).toBe(600);
    expect(hours.tiktokFulltime).toBe(100);
    expect(hours.agencies).toEqual([
      { agency: "Infinite", app: "Shopee", hours: 6 },
      { agency: "MCN", app: "Shopee", hours: 4 },
      { agency: "TDH", app: "TikTok", hours: 3 },
      { agency: "Vis", app: "Shopee", hours: 2 },
    ]);
  });

  test("ช่องที่เขียน: ชั่วโมง + สูตรเงิน (Agency เรทเว็บ · In-house เรทเดิมในชีต) · ไม่แตะ Admin", () => {
    const plan = forecastWrites(sheet(), "2026-12", hours, new Map([["Infinite", 950], ["MCN", 550], ["TDH", 2000]]));
    expect(plan.missing).toBeNull();
    const w = Object.fromEntries(plan.writes.map((x) => [x.cell, x.value]));
    expect(w).toEqual({
      C25: 300, C26: 6, C27: 4, C28: 2, // Shopee In-house / Infinit / MCN / Vis
      C31: 100, C32: "=600-C31", C33: 3, // TikTok Fulltime / partime / TDH (MCN 0 = เท่าเดิม ไม่เขียน)
      C4: "=500*C25", // In-house ใช้เรท 500 จากสูตรเดือนก่อน
      C5: "=950*C26", C6: "=550*C27", // เรทเว็บแทนเรทเดิมในชีต (TDH 2000 เท่าเดิม ไม่เขียน)
    });
    expect(plan.warnings).toEqual([]);
    expect(colLetter(0)).toBe("A");
    expect(colLetter(26)).toBe("AA");
    expect(rateInFormula("=1000*C26")).toBe(1000);
    expect(rateInFormula("=SUM(C1:C2)")).toBeNull();
  });

  test("ค่าเดิมตรงแล้ว = ไม่เขียน · ไม่ได้ตั้งเรทในเว็บ = ใช้เรทในชีต + เตือน", () => {
    const plan = forecastWrites(sheet({ C25: 300, C_inhouse: "=500*C25" }), "2026-12", hours, new Map());
    const cells = plan.writes.map((x) => x.cell);
    expect(cells).not.toContain("C25");
    expect(cells).not.toContain("C4");
    expect(cells).not.toContain("C5"); // =1000*C26 เดิม
    expect(plan.warnings.some((x) => x.includes("Infinite") && x.includes("1000"))).toBe(true);
  });

  test("ชีตยังไม่มีคอลัมน์ของเดือนนั้น = ไม่เขียน บอกเหตุผล", () => {
    const plan = forecastWrites(sheet(), "2027-01", hours, new Map());
    expect(plan.writes).toEqual([]);
    expect(plan.missing).toContain("Jan 2027");
  });

  test("ชุดที่ล็อค: เก็บจากชีต + หน้า Cost ใช้ชุดที่ล็อคแทนตัวเลขในชีต", () => {
    const rows = [
      ["", "Actual", "Forecast"], ["THB", "Dec 2026", "Dec 2026"], ["Shopee"], ["  In-house", "", "200,000"], ["  Infinit", "", "80,000"],
      ["Tiktok"], ["  In-house partime", "", "300,000"], ["Admin Tiktok"], ["  In-house partime", "", "40,000"],
      ["", "Actual", "Forecast"], ["HR", "Dec 2026", "Dec 2026"], ["Shopee"], ["  In-house", "", "300"], ["  Infinit", "", "50"],
      ["Tiktok"], ["  In-house Fulltime", "", "100"], ["  In-house partime", "", "500"], ["Admin Tiktok"], ["  In-house Fulltime", "", "400"], ["  In-house partime", "", "200"],
    ];
    const months = parseCostSheet(rows);
    const entries = forecastEntriesOf(months.get("2026-12"));
    expect(forecastTotal(entries)).toBe(620000);
    expect(sheetForecastHours(rows, "2026-12")).toBe(950); // ชั่วโมงไม่นับ Admin
    expect(sheetForecastHours(sheet().values, "2026-12")).toBe(0);
    const changed = parseCostSheet(rows.map((r) => (r[0] === "  Infinit" && r[2] === "80,000" ? [r[0], "", "1,000"] : r)));
    const locked = withLockedForecasts(changed, [{ month: "2026-12", entries }]);
    expect(locked.get("2026-12")!.find((e) => e.owner === "Infinite")!.forecast).toBe(80000);
  });
});
