import { describe, expect, test } from "bun:test";
import type { CampInfo } from "@/lib/campaign";
import type { CtxSlot } from "@/lib/campaign-data";
import { monthSeries, summary, toMyGmvSlots } from "@/lib/my-gmv";

const at = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+07:00`);
let id = 0;
function slot(date: string, start: string, end: string, o: Partial<CtxSlot> = {}): CtxSlot {
  const startMs = at(date, start), endMs = at(date, end);
  return {
    id: ++id, platform: "GLORY MALL", date, startMs, endMs, hours: (endMs - startMs) / 3600_000, band: "บ่าย", mc: "Mc ทดสอบ", mcId: 1,
    gmv: null, camp: null, exp: null, expRate: null, normRate: null, standby: false, ...o,
  };
}
const camp = { key: "pay day@2026-11-25", nameKey: "pay day", label: "Pay Day พ.ย.", family: "payday", big: false, start: "2026-11-25", end: "2026-11-27", tag: "" } as unknown as CampInfo;

describe("toMyGmvSlots", () => {
  const now = at("2026-11-26", "16:00");
  const rows = toMyGmvSlots([
    slot("2026-11-26", "11:30", "13:30"), // ว่าง ยอดรวมอยู่ในคิวถัดไป
    slot("2026-11-26", "13:30", "15:30", { gmv: 90_000 }),
    slot("2026-11-25", "11:30", "13:30", { exp: { gmv: 40_000.4, hours: 1.5 } }),
    slot("2026-11-24", "11:30", "13:30", { exp: { gmv: 10_000, hours: 0.2 } }), // ซ้อนไม่ถึง 30 นาที = ไม่มียอด
    slot("2026-11-23", "11:30", "13:30", { gmv: 5_000, standby: true }),
    slot("2026-11-27", "11:30", "13:30"),
  ], now);
  const by = (d: string, s: string) => rows.find((r) => r.date === d && r.start === s)!;

  test("กรอก + slot ว่างก่อนหน้า = ยอดเดียว ชั่วโมงรวม", () => {
    expect(by("2026-11-26", "13:30")).toMatchObject({ status: "entered", gmv: 90_000, gmvHours: 4, from: "11:30", merged: 2 });
    expect(by("2026-11-25", "11:30").merged).toBeUndefined();
    expect(by("2026-11-26", "11:30")).toMatchObject({ status: "covered", gmv: null, coveredBy: "13:30–15:30" });
  });
  test("ยอดที่กรอกรวมหลายคิว แบ่งตามชั่วโมง (แยกช่วงเวลาได้ถูก)", () => {
    const rows2 = toMyGmvSlots([
      slot("2026-11-20", "09:30", "11:30", { band: "เช้า" }),
      slot("2026-11-20", "11:30", "12:30", { gmv: 60_000 }),
    ], now);
    expect(rows2.map((r) => [r.status, r.share])).toEqual([["covered", 40_000], ["entered", 20_000]]);
    const s = summary({ slots: rows2, today: "2026-11-26" }, "2026-11");
    expect(s.bands.map((b) => [b.label, b.gmv, b.hours])).toEqual([["เช้า", 40_000, 2], ["บ่าย", 20_000, 1]]);
    expect(s.cur).toMatchObject({ gmv: 60_000, hours: 3, slots: 2 });
  });
  test("ไม่ได้กรอก = ประมาณจาก Export (ชั่วโมง = ที่ซ้อนจริง)", () => {
    expect(by("2026-11-25", "11:30")).toMatchObject({ status: "estimated", gmv: 40_000, gmvHours: 1.5 });
    expect(by("2026-11-24", "11:30").status).toBe("none");
  });
  test("สแตนด์บาย / ยังไม่ถึงเวลา ไม่นับ", () => {
    expect(by("2026-11-23", "11:30")).toMatchObject({ status: "standby", gmv: null });
    expect(by("2026-11-27", "11:30").status).toBe("upcoming");
  });
  test("เรียงตามเวลา", () => {
    expect(rows.map((r) => r.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-26", "2026-11-27"]);
  });
});

describe("summary", () => {
  const now = at("2026-11-26", "16:00");
  const slots = toMyGmvSlots([
    slot("2026-10-05", "11:30", "13:30", { gmv: 50_000 }),
    slot("2026-10-28", "19:30", "21:30", { gmv: 200_000, band: "ไพรม์" }),
    slot("2026-11-03", "11:30", "13:30", { gmv: 60_000 }),
    slot("2026-11-25", "19:30", "21:30", { gmv: 300_000, band: "ไพรม์", camp }),
    slot("2026-11-26", "11:30", "13:30", { exp: { gmv: 20_000, hours: 2 } }),
    slot("2026-11-24", "11:30", "13:30"),
    slot("2026-11-28", "11:30", "13:30"),
  ], now);
  const d = { slots, today: "2026-11-26", first: "2026-10" };
  const s = summary(d, "2026-11");

  test("ยอดรวมเดือน + ส่วนที่ประมาณ", () => {
    expect(s.cur).toMatchObject({ gmv: 380_000, hours: 6, slots: 3, estimated: 20_000 });
    expect(s.partial).toBe(true);
    expect(s.uptoDay).toBe(26);
  });
  test("เทียบเดือนก่อนถึงวันเดียวกัน (28 ต.ค. ไม่นับ)", () => {
    expect(s.prev.gmv).toBe(250_000);
    expect(s.prevSame?.gmv).toBe(50_000);
  });
  test("ช่วงเวลา / วันแคมเปญ / คิวที่ยังไม่มียอด / รอไลฟ์", () => {
    expect(s.bands.map((b) => [b.label, b.gmv])).toEqual([["บ่าย", 80_000], ["ไพรม์", 300_000]]);
    expect(s.kinds.map((k) => [k.label, k.gmv])).toEqual([["วันปกติ", 80_000], ["วันแคมเปญ", 300_000]]);
    expect(s.campaigns.map((c) => c.label)).toEqual(["Pay Day พ.ย."]);
    expect(s.missing.map((m) => m.date)).toEqual(["2026-11-24"]);
    expect(s.upcoming.slots).toBe(1);
    expect(s.top[0].gmv).toBe(300_000);
    expect(s.days).toHaveLength(30);
    expect(s.days.find((x) => x.date === "2026-11-25")?.gmv).toBe(300_000);
  });
  test("รายเดือน: เดือนที่ยังไม่จบ = partial", () => {
    expect(monthSeries(d, "2026-11").map((m) => [m.month, m.gmv, m.partial])).toEqual([["2026-10", 250_000, false], ["2026-11", 380_000, true]]);
  });
  test("เดือนที่จบแล้ว ไม่มี prevSame", () => {
    expect(summary(d, "2026-10").prevSame).toBeNull();
  });
});
