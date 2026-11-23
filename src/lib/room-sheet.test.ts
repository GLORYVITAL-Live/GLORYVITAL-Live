import { describe, expect, test } from "bun:test";
import {
  HOUR_COL, ROOM_COLS, WEB_ADMIN_FG, adminDayCounts, adminSummaryEdits, buildRoomSheet, footprintCells, keepTeamAdmins, keepTeamCells, pairRoomSlots, roomMonths, roomPlace, roomSheetText, roomTabTitle, webFootprint,
  summaryDate,
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

describe("ชื่อแอดมินที่ทีมพิมพ์เองในตาราง", () => {
  const r = 2;
  /** ข้อความในแท็บตอนนี้ (เหมือนที่ values.get คืนมา) จากตารางที่เว็บเขียน + ชื่อที่ทีมพิมพ์ */
  const sheetOf = (t: ReturnType<typeof buildRoomSheet>, typed: Record<string, string>) => {
    const text = roomSheetText(t.rows).map((row) => [...row]);
    for (const [k, v] of Object.entries(typed)) {
      const [rr, cc] = k.split(",").map(Number);
      while (text.length <= rr) text.push([]);
      while (text[rr].length <= cc) text[rr].push("");
      text[rr][cc] = v;
    }
    return text;
  };
  const none = () => false;

  test("เว็บยังไม่มีชื่อ = เก็บชื่อที่พิมพ์ไว้ · ชื่อจากเว็บเขียนด้วยสีที่แยกได้", () => {
    const t = buildRoomSheet("2026-12", [slot({ date: "2026-12-01", admins: [] }), slot({ date: "2026-12-01", start: "11:30", end: "13:30" })]);
    expect(t.rows[r + 2][colOf(11)]).toMatchObject({ text: "บี", fg: WEB_ADMIN_FG });
    expect(t.rows[r + 2][colOf(9)]?.fg).toBeUndefined();
    const old = sheetOf(t, { [`${r + 2},${colOf(9)}`]: "ปลื้ม" });
    const fresh = buildRoomSheet("2026-12", [slot({ date: "2026-12-01", admins: [] }), slot({ date: "2026-12-01", start: "11:30", end: "13:30" })]);
    expect(keepTeamAdmins(fresh, old, none)).toBe(1);
    expect(fresh.rows[r + 2][colOf(9)]).toMatchObject({ text: "ปลื้ม" });
    expect(fresh.rows[r + 2][colOf(9)]?.fg).toBeUndefined();
    // ไม่มีอะไรเปลี่ยน = ข้อความเท่ากับในแท็บ (ไม่ต้องเขียน)
    expect(JSON.stringify(roomSheetText(fresh.rows))).toBe(JSON.stringify(old));
  });

  test("เว็บมีชื่อแล้ว = ใช้ของเว็บ", () => {
    const t = buildRoomSheet("2026-12", [slot({ date: "2026-12-01", admins: ["ฝน"] })]);
    keepTeamAdmins(t, sheetOf(t, { [`${r + 2},${colOf(9)}`]: "ปลื้ม" }), none);
    expect(t.rows[r + 2][colOf(9)]?.text).toBe("ฝน");
  });

  test("ชื่อที่เว็บเขียนไว้เอง แล้วเว็บไม่มีชื่อแล้ว (แอดมินยกเลิก) = ล้างออก", () => {
    const before = buildRoomSheet("2026-12", [slot({ date: "2026-12-01", admins: ["ฝน"] })]);
    const old = sheetOf(before, {});
    const after = buildRoomSheet("2026-12", [slot({ date: "2026-12-01", admins: [] })]);
    expect(keepTeamAdmins(after, old, (rr, cc) => rr === r + 2 && cc === colOf(9))).toBe(0);
    expect(after.rows[r + 2][colOf(9)]?.text).toBe("");
  });

  test("คิวย้ายเวลา = ชื่อเดิมไม่ตามไป · คิวถูกลบ = ไม่มีช่องให้เก็บ", () => {
    const before = buildRoomSheet("2026-12", [slot({ date: "2026-12-01", admins: [] })]);
    const old = sheetOf(before, { [`${r + 2},${colOf(9)}`]: "ปลื้ม" });
    const moved = buildRoomSheet("2026-12", [slot({ date: "2026-12-01", start: "09:30", end: "12:30", admins: [] })]);
    expect(keepTeamAdmins(moved, old, none)).toBe(0);
    expect(moved.rows[r + 2][colOf(9)]?.text).toBe("");
    const gone = buildRoomSheet("2026-12", []);
    expect(keepTeamAdmins(gone, old, none)).toBe(0);
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

describe("Agency ที่ไลฟ์ในห้องของเรา (TDH = ห้อง 1)", () => {
  test("ลงห้อง 1 · ช่องสีฟ้า Agency TDH · ข้ามเที่ยงคืน = แถววันก่อน · Agency อื่นไม่ลง", () => {
    const slots = pairRoomSlots([], [], [
      { agency: "TDH", platform: "GLORY MALL", live_date: "2026-11-03", start_time: "21:30:00", end_time: "02:30:00" },
      { agency: "TDH", platform: "GLORY MALL", live_date: "2026-11-05", start_time: "01:30:00", end_time: "03:30:00" },
      { agency: "MCN", platform: "Shopee", live_date: "2026-11-03", start_time: "10:00:00", end_time: "12:00:00" },
    ]);
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ agency: "TDH", mc: null, admins: [] });
    const t = buildRoomSheet("2026-11", slots);
    const day = (d: number) => 2 + (d - 1) * 9;
    expect(t.placed).toBe(2);
    expect(t.rows[day(3)][colOf(21)]).toMatchObject({ text: "Agency TDH", bg: "#00ffff" });
    expect(t.merges).toContainEqual({ r0: day(3), r1: day(3) + 1, c0: colOf(21), c1: colOf(21) + 5 });
    expect(t.rows[day(4)][colOf(1)]?.text).toBe("Agency TDH"); // 5 พ.ย. 01:30 = แถวของ 4 พ.ย.
  });

  test("คิว Agency ที่ไลฟ์ต่อกัน = ช่องเดียว (ข้ามเที่ยงคืนได้) · มีช่วงว่างคั่น = แยกช่อง", () => {
    const tdh = (date: string, start: string, end: string) => ({ agency: "TDH", platform: "GLORY MALL", live_date: date, start_time: start, end_time: end });
    const out = pairRoomSlots([], [], [
      tdh("2026-11-03", "19:30", "21:30"), tdh("2026-11-03", "21:30", "23:30"),
      tdh("2026-11-07", "23:30", "01:30"), tdh("2026-11-08", "01:30", "03:30"),
      tdh("2026-11-09", "19:30", "21:30"), tdh("2026-11-09", "22:00", "23:30"),
    ]).map((s) => `${s.date} ${s.start}-${s.end}`);
    expect(out).toEqual(["2026-11-03 19:30-23:30", "2026-11-07 23:30-03:30", "2026-11-09 19:30-21:30", "2026-11-09 22:00-23:30"]);
    const t = buildRoomSheet("2026-11", pairRoomSlots([], [], [tdh("2026-11-03", "19:30", "21:30"), tdh("2026-11-03", "21:30", "23:30")]));
    const r = 2 + 2 * 9;
    expect(t.placed).toBe(1);
    expect(t.rows[r][colOf(19)]).toMatchObject({ text: "Agency TDH", bg: "#00ffff" });
    expect([t.rows[r + 1][colOf(19)]?.text, t.rows[r + 1][colOf(22)]?.text]).toEqual(["19:30", "23:30"]);
  });

  test("Agency + แถว Admin เวลาเดียวกัน = คิวเดียวกัน (แสดงชื่อแอดมิน) · มีแถว Mc = คิวทีมเรา", () => {
    const side = (date: string, name: string): RawSide => ({ platform: "GLORY MALL", live_date: date, start_time: "19:30", end_time: "21:30", is_cancelled: false, confirmed: true, name });
    const out = pairRoomSlots([side("2026-11-06", "เอ")], [side("2026-11-07", "บี")], [
      { agency: "TDH", platform: "GLORY MALL", live_date: "2026-11-07", start_time: "19:30", end_time: "21:30" },
      { agency: "TDH", platform: "GLORY MALL", live_date: "2026-11-06", start_time: "19:30", end_time: "21:30" },
    ]);
    expect(out.find((s) => s.date === "2026-11-07")).toMatchObject({ agency: "TDH", admins: ["บี"], mc: null });
    expect(out.find((s) => s.date === "2026-11-06")).toMatchObject({ mc: "เอ" });
    expect(out.find((s) => s.date === "2026-11-06")!.agency).toBeUndefined();
  });
});

describe("ช่องที่ทีมใส่เองในตาราง (กิจกรรม)", () => {
  const cell = (text: string, filled = true) => ({ text, value: text ? { stringValue: text } : undefined, format: { backgroundColor: { red: 1 } }, filled });
  test("จดตำแหน่งช่องคิว แล้วอ่านกลับได้ (คิวละ 3 แถว × ความกว้าง)", () => {
    const t = buildRoomSheet("2026-11", [slot({})]);
    expect(webFootprint(t)).toBe(`2.${colOf(9)}.2`);
    const cells = footprintCells(webFootprint(t))!;
    expect(cells.size).toBe(6);
    expect(cells.has(`4,${colOf(10)}`)).toBe(true);
    expect(footprintCells("")).toBeNull();
    expect(footprintCells("x.1")).toBeNull();
  });

  test("กิจกรรมนอกช่องคิว = เก็บค่า / รูปแบบ / ช่องรวม · ช่องคิวรอบก่อนที่ย้ายไปแล้ว = ล้าง · คิวมาลงทับ = คิวชนะ", () => {
    const before = buildRoomSheet("2026-11", [slot({}), slot({ start: "13:30", end: "15:30" })]);
    const prev = footprintCells(webFootprint(before));
    // ตอนนี้คิว 13:30 ถูกลบ · ทีมใส่กิจกรรม 16:00–19:00 ห้อง 2 (แถว 5–7) + ข้อความในช่องคิวเก่า 13:30 + ข้อความทับคิว 09:30
    const now = buildRoomSheet("2026-11", [slot({})]);
    const grid: ReturnType<typeof cell>[][] = Array.from({ length: now.rows.length }, () => Array(ROOM_COLS).fill(undefined));
    grid[5][colOf(16)] = cell("กิจกรรม ลอยกระทง");
    grid[6][colOf(16)] = cell("16:00");
    grid[6][colOf(18)] = cell("19:00");
    grid[7][colOf(16)] = cell("", true); // แถวแอดมินว่างแต่ระบายสี
    grid[2][colOf(13)] = cell("TIK TOK GLORY MALL\nMc เอ"); // คิว 13:30 เก่า (เว็บเขียนไว้) = ล้าง
    grid[2][colOf(9)] = cell("ทีมพิมพ์ทับคิว"); // ช่องคิวจริง = คิวชนะ
    const merges = [{ r0: 5, r1: 6, c0: colOf(16), c1: colOf(16) + 3 }, { r0: 2, r1: 3, c0: colOf(13), c1: colOf(13) + 2 }];
    const kept = keepTeamCells(now, grid, merges, prev);
    expect(kept).toBe(4);
    expect(now.rows[5][colOf(16)]).toMatchObject({ text: "กิจกรรม ลอยกระทง", raw: { value: { stringValue: "กิจกรรม ลอยกระทง" } } });
    expect(now.rows[6][colOf(18)]?.text).toBe("19:00");
    expect(now.rows[2][colOf(13)]).toBeNull();
    expect(now.rows[2][colOf(9)]?.text).toBe("TIK TOK GLORY MALL\nMc เอ");
    expect(now.merges).toContainEqual({ r0: 5, r1: 6, c0: colOf(16), c1: colOf(16) + 3 });
    expect(now.merges).not.toContainEqual({ r0: 2, r1: 3, c0: colOf(13), c1: colOf(13) + 2 });
    expect(roomSheetText(now.rows)[5][colOf(16)]).toBe("กิจกรรม ลอยกระทง");
  });
});