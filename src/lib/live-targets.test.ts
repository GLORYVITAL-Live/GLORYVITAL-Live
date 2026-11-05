// เทสเป้า GMV + % achieve (bun test)
import { describe, expect, test } from "bun:test";
import { achieveOf, cleanTarget, dailyOf, monthDays, targetReport, targetsInScope, type LiveTarget } from "@/lib/live-targets";

const target = (o: Partial<LiveTarget> = {}): LiveTarget => ({ platform: "TikTok", accountId: "a", month: "2026-11", monthly: 3_000_000, days: {}, ...o });
const sale = (date: string, gmv: number, accountId = "a", platform = "TikTok") => ({ platform, accountId, startedAt: `${date}T10:00:00+07:00`, gmv });

describe("เป้ารายวัน", () => {
  test("เฉลี่ยเท่ากันทุกวัน", () => {
    const d = dailyOf(target());
    expect(d.size).toBe(30);
    expect(d.get("2026-11-01")).toBe(100_000);
  });
  test("ใส่เองบางวัน = วันที่เหลือเฉลี่ยจากยอดที่เหลือ รวมทุกวันเท่าเป้าเดือน", () => {
    const d = dailyOf(target({ days: { "2026-11-11": 1_550_000 } }));
    expect(d.get("2026-11-11")).toBe(1_550_000);
    expect(d.get("2026-11-12")).toBe(50_000);
    expect([...d.values()].reduce((a, v) => a + v, 0)).toBeCloseTo(3_000_000, 4);
  });
  test("ใส่ 0 เองได้ (วันหยุดไลฟ์) · ใส่เองเกินเป้า = วันอื่นเป็น 0 ไม่ติดลบ", () => {
    expect(dailyOf(target({ days: { "2026-11-02": 0 } })).get("2026-11-02")).toBe(0);
    expect(dailyOf(target({ monthly: 100, days: { "2026-11-02": 500 } })).get("2026-11-03")).toBe(0);
  });
  test("จำนวนวันในเดือน", () => {
    expect(monthDays("2026-02").length).toBe(28);
    expect(monthDays("2028-02").at(-1)).toBe("2028-02-29");
  });
});

describe("% achieve", () => {
  test("ไม่มีเป้า = null", () => {
    expect(achieveOf(100, 0)).toBeNull();
    expect(achieveOf(50, 200)).toBe(0.25);
  });
  test("เดือนที่ยังไม่จบ: เทียบทั้งเดือน + เทียบเป้าถึงวันล่าสุด + ยอดที่เหลือต่อวัน", () => {
    const r = targetReport([target()], [sale("2026-11-01", 150_000), sale("2026-11-02", 130_000)], "2026-11", 2);
    expect(r.monthly).toBe(3_000_000);
    expect(r.gmv).toBe(280_000);
    expect(r.pct).toBeCloseTo(280_000 / 3_000_000);
    expect(r.toDate).toEqual({ target: 200_000, pct: 1.4, gap: 80_000 });
    expect(r.remaining).toBe(2_720_000);
    expect(r.daysLeft).toBe(28);
    expect(r.perDayLeft).toBeCloseTo(2_720_000 / 28);
    expect(r.days[0]).toEqual({ date: "2026-11-01", target: 100_000, gmv: 150_000, pct: 1.5, manual: false });
  });
  test("เกินเป้า = ยอดที่เหลือ 0 · เดือนจบแล้วไม่มีเป้าถึงวันนี้", () => {
    const r = targetReport([target({ monthly: 100 })], [sale("2026-11-05", 500)], "2026-11");
    expect(r.remaining).toBe(0);
    expect(r.toDate).toBeNull();
    expect(r.perDayLeft).toBeNull();
    expect(r.pct).toBe(5);
  });
  test("นับเฉพาะช่องที่ตั้งเป้า และเดือนนี้ (ช่องอื่นไม่ทำให้ % สูงเกินจริง)", () => {
    const r = targetReport([target()], [sale("2026-11-01", 100), sale("2026-11-01", 999, "b"), sale("2026-10-31", 999)], "2026-11");
    expect(r.gmv).toBe(100);
  });
  test("หลายช่อง = รวมเป้า + แยกรายช่อง · วันที่ใส่เองมีป้าย", () => {
    const r = targetReport(
      [target(), target({ platform: "Shopee", accountId: "s", monthly: 6_000_000, days: { "2026-11-11": 1_000_000 } })],
      [sale("2026-11-11", 600_000), sale("2026-11-11", 500_000, "s", "Shopee")], "2026-11",
    );
    expect(r.monthly).toBe(9_000_000);
    const d11 = r.days[10];
    expect(d11.manual).toBe(true);
    expect(d11.target).toBeCloseTo(1_100_000);
    expect(d11.pct).toBeCloseTo(1);
    expect(r.accounts.map((a) => a.gmv)).toEqual([600_000, 500_000]);
  });
  test("เวลาไทย: ไลฟ์ตี 1 นับเป็นวันนั้น (ไม่ใช่วันก่อนตาม UTC)", () => {
    const r = targetReport([target()], [{ platform: "TikTok", accountId: "a", startedAt: "2026-11-02T01:00:00+07:00", gmv: 77 }], "2026-11");
    expect(r.days[1].gmv).toBe(77);
    expect(r.days[0].gmv).toBe(0);
  });
  test("ตัวกรอง: ทั้งหมด / แพลตฟอร์ม / ช่อง", () => {
    const list = [target(), target({ platform: "Shopee", accountId: "s" })];
    expect(targetsInScope(list, "", "").length).toBe(2);
    expect(targetsInScope(list, "Shopee", "").map((t) => t.accountId)).toEqual(["s"]);
    expect(targetsInScope(list, "TikTok", "TikTok|a").length).toBe(1);
  });
});

describe("ตรวจข้อมูลที่กรอก", () => {
  test("ตัดลูกน้ำ · ว่าง = ลบเป้า", () => {
    expect(cleanTarget("2026-11", "ช่อง", "3,000,000", { "2026-11-11": "500,000" })).toEqual({ month: "2026-11", monthly: 3_000_000, days: { "2026-11-11": 500_000 } });
    expect(cleanTarget("2026-11", "ช่อง", "", {})).toEqual({ month: "2026-11", monthly: 0, days: {} });
  });
  test("ข้อมูลผิด", () => {
    expect(cleanTarget("2026-13", "ช่อง", "1", {})).toEqual({ error: "เดือนไม่ถูกต้อง" });
    expect(cleanTarget("2026-11", "ช่อง", "abc", {})).toEqual({ error: "ช่อง: เป้าเดือนต้องเป็นตัวเลข" });
    expect(cleanTarget("2026-11", "ช่อง", "1000", { "2026-12-01": "1" })).toEqual({ error: "ช่อง: วันที่ 2026-12-01 ไม่อยู่ในเดือนนี้" });
    expect(cleanTarget("2026-11", "ช่อง", "", { "2026-11-01": "1" })).toEqual({ error: "ช่อง: ใส่เป้าเดือนก่อน ถึงจะใส่เป้ารายวันได้" });
    expect(cleanTarget("2026-11", "ช่อง", "100", { "2026-11-01": "101" })).toEqual({ error: "ช่อง: เป้ารายวันที่ใส่เองรวมกันเกินเป้าเดือน" });
  });
});
