import { describe, expect, test } from "bun:test";
import {
  HOUR_COL, ROOM_COLS, adminDayCounts, adminSummaryEdits, buildRoomSheet, pairRoomSlots, roomMonths, roomPlace, roomSheetText, roomTabTitle, summaryDate,
  type RawSide, type RoomSlot,
} from "@/lib/room-sheet";

const slot = (x: Partial<RoomSlot>): RoomSlot => ({
  platform: "GLORY MALL", date: "2026-11-01", start: "09:30", end: "11:30", mc: "เอ", admins: ["บี"], campaign: "", ...x,
});
/** คอลัมน์ของชั่วโมง (D = 05:00) */
const colOf = (h: number) => HOUR_COL + ((h - 5 + 24) % 24);

describe("ตารางห้องไลฟ์ (แท็บ Live <เดือน> (เว็บ))", () => {
  test("ชื่อแท็บ + เดือนที่อัปเดตอัตโนมัติ (เวลาไทย ข้ามปี)", () => {
    expect(roomTabTitle("2026-12")).toBe("Live Dec 2026 (เว็บ)");
    expect(roomMonths(Date.parse("2026-12-31T17:30:00Z"))).toEqual(["2027-01", "2027-02"]);
    expect(roomMonths(Date.parse("2026-12-15T03:00:00Z"))).toEqual(["2026-12", "2027-01"]);
  });

  test("ตำแหน่ง: คิว 2 ชม. = 2 คอลัมน์เริ่มที่ชั่วโมงที่เริ่ม · ก่อนตี 5 = แถวของวันก่อน", () => {
    expect(roomPlace({ date: "2026-11-02", start: "09:30", end: "11:30" })).toEqual({ day: "2026-11-02", col: colOf(9), width: 2 });
    expect(roomPlace({ date: "2026-11-02", start: "22:00", end: "02:00" })).toEqual({ day: "2026-11-02", col: colOf(22), width: 4 });
    expect(roomPlace({ date: "2026-11-02", start: "00:30", end: "02:30" })).toEqual({ day: "2026-11-01", col: colOf(0), width: 2 });
  });

  test("หัวตาราง + วัน + ห้อง แบบชีตเดิม", () => {
    const t = buildRoomSheet("2026-11", []);
    expect(t.colCount).toBe(ROOM_COLS);
    expect(t.rows.length).toBe(2 + 30 * 9);
    expect(t.rows[0][2]?.text).toBe("ห้อง");
    expect(t.rows[0][HOUR_COL]?.text).toBe("05:00");
    expect(t.rows[1][HOUR_COL]?.text).toBe("06:00");
    expect(t.rows[0][colOf(10)]?.bg).toBe("#cc4125");
    expect(t.rows[0][colOf(9)]?.bg).toBe("#fff2cc");
    // 1 พ.ย. 2026 = วันอาทิตย์ (เหลือง) · 2 พ.ย. = จันทร์
    expect(t.rows[2][0]).toMatchObject({ text: "อาทิตย์", bg: "#fff2cc" });
    expect(t.rows[2][1]?.text).toBe("1/11/2026");
    expect(t.rows[11][0]).toMatchObject({ text: "จันทร์", bg: "#ffffff" });
    expect([t.rows[2][2]?.text, t.rows[5][2]?.text, t.rows[8][2]?.text]).toEqual(["ห้อง 1", "ห้อง 2", "ห้อง 3"]);
    expect(t.merges).toContainEqual({ r0: 2, r1: 11, c0: 0, c1: 1 });
  });

  test("คิว: ห้องตามช่อง · ช่อง + Mc / เวลา / แอดมิน · CEO = แดง · Shopee ไม่ลง", () => {
    const t = buildRoomSheet("2026-11", [
      slot({}),
      slot({ start: "11:30", end: "13:30", campaign: "Ceo Live Phone in", admins: ["บี", "ซี"] }),
      slot({ platform: "Cherry Glory", start: "19:30", end: "21:30", mc: null, admins: [] }),
      slot({ platform: "Skin Expert", date: "2026-11-02" }),
      slot({ platform: "Shopee", start: "06:00", end: "09:00" }),
    ]);
    expect(t.placed).toBe(4);
    const r = 2;
    expect(t.rows[r][colOf(9)]).toMatchObject({ text: "TIK TOK GLORY MALL\nMc เอ", bg: "#d5a6bd" });
    expect(t.merges).toContainEqual({ r0: r, r1: r + 1, c0: colOf(9), c1: colOf(9) + 2 });
    expect(t.rows[r + 1][colOf(9)]?.text).toBe("09:30");
    expect(t.rows[r + 1][colOf(10)]?.text).toBe("11:30");
    expect(t.rows[r + 2][colOf(9)]?.text).toBe("บี");
    expect(t.rows[r][colOf(11)]).toMatchObject({ text: "CEO LIVE PHONE IN\nMc เอ", bg: "#ff0000", fg: "#ffffff" });
    expect(t.rows[r + 2][colOf(11)]?.text).toBe("บี / ซี");
    expect(t.rows[r + 6][colOf(19)]).toMatchObject({ text: "TIK TOK Cherry Glory\nMc (ว่าง)", bg: "#000000" });
    expect(t.rows[11 + 3][colOf(9)]?.text).toBe("TIK TOK Skin Expert\nMc เอ");
    // Shopee 06:00 ไม่ลง
    expect(t.rows[r][colOf(6)]).toBeNull();
  });

  test("ช่องอื่นของ TikTok = แถว อื่นๆ · เวลาทับในห้องเดียวกัน = เลื่อนไปช่องว่าง / ลงไม่ได้", () => {
    const t = buildRoomSheet("2026-11", [
      slot({ platform: "Glory Shop" }),
      slot({ start: "09:00", end: "11:00" }),
      slot({ start: "10:00", end: "12:00", mc: "ดี" }),
      slot({ start: "03:00", end: "05:00", date: "2026-11-01" }),
    ]);
    expect(t.rows.length).toBe(2 + 30 * 12);
    expect(t.rows[2 + 9][2]?.text).toBe("อื่นๆ");
    expect(t.rows[2 + 9][colOf(9)]?.text).toBe("TIK TOK Glory Shop\nMc เอ");
    // 09:00 ได้ช่อง 9–10 · 10:00 เลื่อนไป 11 (กว้างได้ 2 ช่องถึง 12)
    expect(t.rows[2][colOf(11)]?.text).toBe("TIK TOK GLORY MALL\nMc ดี");
    expect(t.rows[3][colOf(11)]?.text).toBe("10:00");
    // ตี 3 วันที่ 1 = แถวของ 31 ต.ค. (นอกเดือน) ไม่ลง
    expect(t.placed).toBe(3);
  });

  test("ข้อความไว้เทียบกับชีต: ตัดช่องว่างท้ายแถว + แถวว่างท้ายตาราง", () => {
    expect(roomSheetText([[{ text: "a", bg: "" }, null], [null, { text: "", bg: "" }]])).toEqual([["a"]]);
    expect(roomSheetText([[null, { text: "b", bg: "" }]])).toEqual([["", "b"]]);
  });
});

describe("สรุปวันหยุดแอดมินใต้ตาราง", () => {
  test("วันที่ในบล็อก: เดือน/วัน แบบที่ทีมใช้ · วัน/เดือน · เดือนอื่น = null", () => {
    expect(summaryDate("12/01", "2026-12")).toBe("2026-12-01");
    expect(summaryDate("12/13", "2026-12")).toBe("2026-12-13");
    expect(summaryDate("13/12", "2026-12")).toBe("2026-12-13");
    expect(summaryDate("1/01", "2026-12")).toBeNull();
    expect(summaryDate("12/32", "2026-12")).toBeNull();
    expect(summaryDate("Date", "2026-12")).toBeNull();
  });

  test("นับคิวต่อแอดมินต่อวัน · Adminเสริม = แอดมินเสริมที่ไม่มีคอลัมน์ของตัวเอง · ข้อความของทีมไม่แตะ", () => {
    const slots = [
      slot({ date: "2026-12-01", admins: ["แพรวา"] }),
      slot({ date: "2026-12-01", start: "11:30", end: "13:30", admins: ["แพรวา"] }),
      slot({ date: "2026-12-01", platform: "Cherry Glory", start: "19:30", end: "21:30", admins: ["ภู"] }),
      slot({ date: "2026-12-01", platform: "Skin Expert", admins: ["เตย"] }),
      slot({ date: "2026-12-02", admins: ["เตย"] }),
      slot({ date: "2026-12-02", platform: "Shopee", admins: ["เตย"] }),
    ];
    const counts = adminDayCounts("2026-12", slots);
    const grid = [
      [],
      ["", "", "", "", "", "Date", "แพรวา", "เตย", "สิง", "Adminเสริม"],
      ["", "", "", "", "อังคาร", "12/01", "", "", "off", ""],
      ["", "", "", "", "พุธ", "12/02", "5", "Holiday", "", ""],
      [],
      ["", "", "", "", "total/slot", "", "0", "0", "0", "0"],
    ];
    const edits = adminSummaryEdits(grid, "2026-12", counts, new Set(["ภู", "เตย"]));
    expect(edits).toEqual([
      { row: 2, col: 6, value: 2 },
      { row: 2, col: 7, value: 1 },
      { row: 2, col: 9, value: 1 },
      // 2 ธ.ค.: แพรวาไม่มีคิวในเว็บ = คง 5 ที่ทีมพิมพ์ · เตย "Holiday" ไม่แตะ · Shopee ไม่นับ
    ]);
    // ตัวเลขที่ทีมพิมพ์ไม่ตรงกับคิวในเว็บ = ใช้ของเว็บ
    expect(adminSummaryEdits([grid[1], ["", "", "", "", "", "12/01", "3", "1"]], "2026-12", counts, new Set())).toEqual([{ row: 1, col: 6, value: 2 }]);
    // กรอกแล้วรอบหน้าไม่ต้องกรอกซ้ำ
    const filled = grid.map((r) => [...r]);
    for (const e of edits) filled[e.row][e.col] = String(e.value);
    expect(adminSummaryEdits(filled, "2026-12", counts, new Set(["ภู", "เตย"]))).toEqual([]);
  });
});

describe("จับคู่ Mc + Admin", () => {
  const side = (x: Partial<RawSide>): RawSide => ({
    platform: "GLORY MALL", live_date: "2026-11-21", start_time: "19:30:00", end_time: "21:30:00", is_cancelled: false, confirmed: null, name: null, ...x,
  });
  test("ชื่อแสดงเฉพาะฝั่งที่ยังนับ · Mc แคน = ไม่ลง · ไม่มีแถว Mc = ดู Admin", () => {
    const out = pairRoomSlots(
      [
        side({ name: "เอ", campaign: "Ceo Live" }),
        side({ start_time: "21:30:00", end_time: "23:30:00", confirmed: false }),
        side({ live_date: "2026-11-22", is_cancelled: true, name: "ซี" }),
      ],
      [
        side({ name: "บี" }),
        side({ start_time: "21:30:00", end_time: "23:30:00", name: "บี" }),
        side({ live_date: "2026-11-22", name: "บี" }),
        side({ live_date: "2026-11-23", name: "ดี" }),
        side({ live_date: "2026-11-24", name: "อี", is_cancelled: true }),
      ],
    );
    const by = (d: string, s: string) => out.find((x) => x.date === d && x.start === s);
    expect(by("2026-11-21", "19:30")).toMatchObject({ mc: "เอ", admins: ["บี"], campaign: "Ceo Live", end: "21:30" });
    expect(by("2026-11-21", "21:30")).toMatchObject({ mc: null, admins: ["บี"] });
    expect(by("2026-11-22", "19:30")).toBeUndefined();
    expect(by("2026-11-23", "19:30")).toMatchObject({ mc: null, admins: ["ดี"] });
    expect(by("2026-11-24", "19:30")).toBeUndefined();
  });
});
