// เทสอ่านป้ายวันจากชีตของทีม (bun test) — แถวสมมติตามโครงแท็บจริง
import { describe, expect, test } from "bun:test";
import { parseDayTagRows, sheetDate } from "@/lib/live-days-sheet";

const NOW = Date.UTC(2026, 10, 10, 5); // 10 พ.ย. 2026

describe("วันที่ในชีต", () => {
  test("รูปแบบต่างๆ", () => {
    expect(sheetDate("1 Nov")).toEqual({ day: 1, month: 11, year: null });
    expect(sheetDate("3Jul")).toEqual({ day: 3, month: 7, year: null });
    expect(sheetDate("13 June")).toEqual({ day: 13, month: 6, year: null });
    expect(sheetDate("1 Oct 26")).toEqual({ day: 1, month: 10, year: 2026 });
    expect(sheetDate("1 Admin Live zap")).toBeNull();
    expect(sheetDate("DATE")).toBeNull();
  });
});

describe("แท็บ GLORY TIKTOK (วันที่คอลัมน์ B · หมายเหตุคอลัมน์ H)", () => {
  const row = (b: string, h = "") => ["", b, "7:30", "9:30", "2:00", "2.00", "", h];
  test("ข้ามปี ธ.ค. -> ม.ค. · ปีจากบล็อกล่าสุด · slot ต่อของวันเดียวกันรวมข้อความ · ไม่มีหมายเหตุ = วันปกติ", () => {
    const tags = parseDayTagRows([
      ["Dec", ...row("31 Dec").slice(1)], row(""),
      ["Jan", ...row("1 Jan").slice(1)], row("", "PayDay Campaign"),
      row("2 Jan"),
      ["Nov", ...row("11 Nov", "11.11").slice(1)],
    ], "TikTok", NOW);
    expect(tags.map((t) => `${t.day} ${t.kind}`)).toEqual(["2025-12-31 bau", "2026-01-01 payday", "2026-01-02 bau", "2026-11-11 dday"]);
  });
});

describe("แท็บ GLORY Shopee (วันที่คอลัมน์ A · ป้ายตามแถวหัว)", () => {
  const head = ["DATE", "Time Start", "Time End", "", "Total hrs", "Campaign", "remark"];
  test("หลายส่วนวันเดียวกันเลือกป้ายสำคัญสุด · บล็อกที่หัวไม่มี remark ไม่บันทึก · แถวที่บอกปีใช้เป็นหลัก", () => {
    const tags = parseDayTagRows([
      head, ["infinite"], ["9 Oct", "8:00", "1:00", "17:00", "17.00", "TRUE", "10.10 Teasing"], [],
      ["MCN อร"], ["9 Oct", "6:00", "18:00", "12:00", "12.00", "FALSE", "BAU"], ["", "22:00", "2:00"],
      ["10 Oct 26", "8:00", "2:00", "18:00", "18.00", "TRUE", "10.10"],
      ["DATE", "Time Start", "Time End", "", "Total hrs"], ["Agency Infinite"], ["5 Nov", "6:00", "2:00", "20:00", "20.00"],
    ], "Shopee", NOW);
    expect(tags.map((t) => `${t.day} ${t.kind} ${t.label}`)).toEqual(["2026-10-09 teasing 10.10 Teasing", "2026-10-10 dday 10.10"]);
  });
});
