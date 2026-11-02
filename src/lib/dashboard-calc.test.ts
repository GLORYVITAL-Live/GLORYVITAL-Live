// เทสแดชบอร์ดหน้าแรก (bun test): ตัดช่วง "เดือนนี้ถึงตอนนี้" เทียบเดือนก่อนช่วงเดียวกัน + ค่าจ้างสูตรเดียวกับหน้าสรุป
import { describe, expect, test } from "bun:test";
import { buildDashboard } from "@/lib/dashboard-calc";
import type { OwnerDetail, OwnerPerson, OwnerSummary } from "@/lib/types";

const at = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+07:00`);
const det = (o: Partial<OwnerDetail> & { name: string; date: string; start: string; hours: number }): OwnerDetail => ({
  type: "Mc", end: "", platform: "GLORY MALL", startMs: at(o.date, o.start), status: "", cancelled: false, pair: "",
  lateMinutes: null, bonusMinutes: null, lateFromProof: false, bonusFromProof: false, proof: null, noProof: false,
  gmv: null, gmvCoveredBy: null, campaign: "", ...o,
});
const person = (name: string): OwnerPerson => ({ name, slots: 0, hours: 0, paidHours: 0, lateSlots: 0, bonusMinutes: 0, days: 0, cancelled: 0, commit: null });
const rates: OwnerSummary["rates"] = { mc: { "Mc เอ": 500, "Mc บี": 400 }, admin: { "แอดมิน": 100 }, shopee: { "Mc บี": 300 }, defaultMc: 0, defaultAdmin: 0 };
const proof = { id: 1, startedAt: "", endedAt: "", by: "", driveUrl: null, driveFolderUrl: null };

const cur = {
  rates, mc: [person("Mc เอ"), person("Mc บี")], admin: [person("แอดมิน")],
  details: [
    det({ name: "Mc เอ", date: "2026-11-01", start: "19:00", hours: 2, gmv: 10000, proof }),
    det({ name: "Mc เอ", date: "2026-11-02", start: "09:00", hours: 2 }),
    det({ name: "Mc บี", date: "2026-11-01", start: "13:00", hours: 3, shopee: true, noProof: true }),
    det({ name: "Mc บี", date: "2026-11-02", start: "12:00", hours: 2 }), // ยังไม่ถึงเวลา
    det({ name: "Mc ซี", date: "2026-11-01", start: "10:00", hours: 2, cancelled: true }),
    det({ type: "Admin", name: "แอดมิน", date: "2026-11-01", start: "19:00", hours: 2 }),
  ],
};
const prev = {
  rates, mc: [person("Mc เอ")], admin: [],
  details: [
    det({ name: "Mc เอ", date: "2026-10-01", start: "19:00", hours: 2 }),
    det({ name: "Mc เอ", date: "2026-10-02", start: "09:00", hours: 2 }),
    det({ name: "Mc เอ", date: "2026-10-02", start: "11:00", hours: 2 }), // หลังเวลาเดียวกันของเดือนก่อน
    det({ name: "Mc เอ", date: "2026-10-31", start: "19:00", hours: 2 }),
  ],
};
const base = {
  cur, prev, month: "2026-11", prevMonth: "2026-10", last: "2026-11-30", prevLast: "2026-10-31",
  now: at("2026-11-02", "10:00"), payMc: true, payAdmin: true, sessions: null,
};

describe("แดชบอร์ดหน้าแรก", () => {
  const d = buildDashboard(base);

  test("นับเฉพาะคิวที่เริ่มแล้ว ไม่นับที่ยกเลิก · เดือนก่อนตัดที่วันที่และเวลาเดียวกัน", () => {
    expect(d.hours).toEqual({ cur: 7, prev: 4 });
    expect(d.slots).toEqual({ cur: 3, prev: 2 });
    expect(d.prevUpTo).toBe("2026-10-02");
    expect(d.mcCount).toBe(2);
  });

  test("ค่าจ้างสะสม: เรทรายคน + เรท Shopee + ฝั่ง Admin (สูตรเดียวกับหน้าสรุป)", () => {
    expect(d.pay).toEqual({ cur: 2000 + 900 + 200, prev: 2000, sides: ["mc", "admin"] });
    expect(d.platforms).toEqual([
      { key: "tiktok", slots: 2, hours: 4, mc: 1, pay: 2000, gmv: null },
      { key: "shopee", slots: 1, hours: 3, mc: 1, pay: 900, gmv: null },
    ]);
  });

  test("ไม่เห็นค่าจ้างฝั่งไหน = ไม่นับฝั่งนั้น · ไม่เห็นเลย = null", () => {
    const adminOnly = buildDashboard({ ...base, payMc: false });
    expect(adminOnly.pay).toEqual({ cur: 200, prev: 0, sides: ["admin"] });
    expect(adminOnly.platforms.every((p) => p.pay === null)).toBe(true);
    expect(buildDashboard({ ...base, payMc: false, payAdmin: false }).pay).toBeNull();
  });

  test("Top Mc: เรียงตามชั่วโมง · GMV ที่กรอก · หลักฐานนับเฉพาะคิวที่ต้องแนบ", () => {
    expect(d.topMc).toEqual([
      { name: "Mc เอ", slots: 2, hours: 4, gmv: 10000, proofDone: 1, proofNeed: 2 },
      { name: "Mc บี", slots: 1, hours: 3, gmv: null, proofDone: 0, proofNeed: 0 },
    ]);
  });

  test("รายวันทั้งเดือน รวมคิวที่จองไว้ · เทียบวันที่เดียวกันของเดือนก่อน", () => {
    expect(d.daily).toHaveLength(30);
    expect(d.daily[0]).toEqual({ date: "2026-11-01", hours: 5, planned: false, prev: 2 });
    expect(d.daily[1]).toEqual({ date: "2026-11-02", hours: 4, planned: false, prev: 4 });
    expect(d.daily[2].planned).toBe(true);
  });

  test("GMV จากไฟล์ Export: เดือนก่อนนับถึงเวลาเดียวกับไลฟ์ล่าสุดของเดือนนี้", () => {
    const iso = (date: string, hm: string) => new Date(at(date, hm)).toISOString();
    const s = (date: string, hm: string, gmv: number, platform = "TikTok") => ({ startedAt: iso(date, hm), gmv, platform });
    const withGmv = buildDashboard({
      ...base,
      sessions: {
        cur: [s("2026-11-01", "12:00", 1500, "Shopee"), s("2026-11-01", "19:00", 3500)],
        prev: [s("2026-10-01", "19:00", 3000), s("2026-10-01", "22:00", 1000), s("2026-10-02", "12:00", 2000)],
      },
    });
    expect(withGmv.gmv).toEqual({ cur: 5000, prev: 3000, upTo: "2026-11-01", time: "19:00" });
    expect(withGmv.platforms.map((p) => p.gmv)).toEqual([3500, 1500]);
    expect(buildDashboard({ ...base, sessions: { cur: [], prev: [] } }).gmv).toEqual({ cur: null, prev: null, upTo: null, time: null });
  });

  test("เดือนก่อนสั้นกว่า: วันที่ 31 เทียบทั้งเดือนก่อน", () => {
    const m = buildDashboard({
      ...base, cur: { ...cur, details: [] }, prev: { ...prev, details: [det({ name: "Mc เอ", date: "2026-02-28", start: "23:00", hours: 1 })] },
      month: "2026-03", prevMonth: "2026-02", last: "2026-03-31", prevLast: "2026-02-28", now: at("2026-03-31", "08:00"),
    });
    expect(m.prevUpTo).toBe("2026-02-28");
    expect(m.hours.prev).toBe(1);
    expect(m.daily[30].prev).toBeNull();
  });
});
