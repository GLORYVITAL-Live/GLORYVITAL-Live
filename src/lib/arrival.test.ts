// เทส Admin กด "มาถึงแล้ว" (bun test): นาทีสาย · คิวต่อเนื่องไม่ต้องกด · ค่าในชีตมาก่อน
import { describe, expect, test } from "bun:test";
import { adminLate, arrivalLate, arrivalMissing, continuedIds } from "@/lib/arrival";
import { lateCut } from "@/lib/pay";

const at = (hm: string) => Date.parse(`2026-11-03T${hm}:00+07:00`);
const iso = (hm: string) => new Date(at(hm)).toISOString();

describe("Admin กดมาถึงแล้ว", () => {
  test("นาทีสาย = เวลากด − เวลาเริ่ม · กดก่อนเวลา = 0", () => {
    expect(arrivalLate(at("19:42"), at("19:30"))).toBe(12);
    expect(arrivalLate(at("19:05"), at("19:30"))).toBe(0);
    expect(arrivalLate(at("19:35") + 59_000, at("19:30"))).toBe(5);
  });

  test("ค่าในชีตมาก่อน · ไม่ได้กด / ต่อจากคิวก่อน = ไม่หัก · สายแล้วหักตามกฎเดิม", () => {
    expect(adminLate(20, { at: iso("19:31"), continued: false }, at("19:30"))).toEqual({ lateMinutes: 20, lateFromArrival: false });
    expect(adminLate(null, { at: null, continued: false }, at("19:30"))).toEqual({ lateMinutes: null, lateFromArrival: false });
    expect(adminLate(null, { at: iso("21:40"), continued: true }, at("21:30"))).toEqual({ lateMinutes: null, lateFromArrival: false });
    expect(adminLate(null, { at: iso("19:20"), continued: false }, at("19:30"))).toEqual({ lateMinutes: null, lateFromArrival: false });
    const late = adminLate(null, { at: iso("19:42"), continued: false }, at("19:30"));
    expect(late).toEqual({ lateMinutes: 12, lateFromArrival: true });
    expect(lateCut(late.lateMinutes)).toBeGreaterThan(0);
  });

  test("คิวต่อเนื่องของคนเดียวกันไม่ต้องกดซ้ำ (คนละคน / มีช่องว่าง = ต้องกด)", () => {
    const ids = continuedIds([
      { id: 1, who: 7, startMs: at("19:30"), endMs: at("21:30") },
      { id: 2, who: 7, startMs: at("21:30"), endMs: at("23:30") },
      { id: 3, who: 8, startMs: at("21:30"), endMs: at("23:30") },
      { id: 4, who: 7, startMs: at("23:45"), endMs: at("23:59") },
    ]);
    expect([...ids]).toEqual([2]);
  });

  test("ยังไม่กด: เฉพาะคิวที่เริ่มแล้ว และไม่ได้ต่อจากคิวก่อน", () => {
    expect(arrivalMissing({ at: null, continued: false }, at("19:30"), at("19:40"))).toBe(true);
    expect(arrivalMissing({ at: null, continued: false }, at("19:30"), at("19:00"))).toBe(false);
    expect(arrivalMissing({ at: null, continued: true }, at("21:30"), at("21:40"))).toBe(false);
    expect(arrivalMissing(undefined, at("19:30"), at("19:40"))).toBe(false);
  });
});
