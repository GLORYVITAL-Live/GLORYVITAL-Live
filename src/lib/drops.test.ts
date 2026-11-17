import { describe, expect, test } from "bun:test";
import { slotDrops, type DropLog, type DropSlot } from "@/lib/drops";

const slot = (id: number, holder: string | null, x: Partial<DropSlot> = {}): DropSlot => ({
  id, date: "2026-11-10", start: "21:30", end: "23:30", platform: "GLORY MALL", shopee: false, cancelled: false,
  holder: holder ? `Mc ${holder}` : null, holderEmail: holder ? `${holder}@x.com` : null, ...x,
});
let seq = 0;
const log = (slotId: number, role: string, action: string, who: string | null, at: string): DropLog => ({
  id: ++seq, at: `2026-11-0${at}`, role, email: who ? `${who}@x.com` : null, action, slotId,
});
const names = (e: string) => `Mc ${e.split("@")[0]}`;

describe("คิวหลุด + ใครรับต่อ", () => {
  test("Mc ยกเลิก → Mc อีกคนจองในเว็บ = web · ปล่อยโดยคนเดิม", () => {
    const out = slotDrops([slot(1, "บี")], [
      log(1, "Mc", "จองคิว", "เอ", "1T01:00"), log(1, "Mc", "ยกเลิกคิว", "เอ", "2T01:00"), log(1, "Mc", "จองคิว", "บี", "2T01:05"),
    ], names);
    expect(out).toEqual([{ date: "2026-11-10", start: "21:30", end: "23:30", platform: "GLORY MALL", shopee: false, outcome: "web", by: "Mc บี", from: "Mc เอ" }]);
  });

  test("Owner เอาคนออก → Owner กำหนดคน = owner · ยังไม่มีคน / คิวถูกแคน = open", () => {
    const out = slotDrops([slot(2, "ซี"), slot(3, null), slot(4, "ดี", { cancelled: true })], [
      log(2, "Owner", "แก้ slot: เอาคนออก", "own", "3T01:00"), log(2, "Owner", "แก้ slot: กำหนดคน", "own", "3T02:00"),
      log(3, "Mc", "ยกเลิกคิว", "อี", "3T01:00"),
      log(4, "Owner", "Plan Slot Live: เอาชื่อ Mc ออก", "own", "3T01:00"),
    ], names);
    expect(out.map((d) => [d.outcome, d.by, d.from])).toEqual([["owner", "Mc ซี", null], ["open", null, "Mc อี"], ["open", null, null]]);
  });

  test("ยกเลิกแล้วจองคืนเอง = ไม่นับ · ไม่มีประวัติหลุด = ไม่นับ · ชื่อในชีตแทน (ไม่มีบันทึกการรับ) = owner", () => {
    const out = slotDrops([slot(5, "เอ"), slot(6, "เอ"), slot(7, "เอฟ")], [
      log(5, "Mc", "ยกเลิกคิว", "เอ", "4T01:00"), log(5, "Mc", "จองคิว", "เอ", "4T01:01"),
      log(6, "Mc", "จองคิว", "เอ", "4T01:00"),
      log(7, "Mc", "ยกเลิกคิว", "จี", "4T01:00"),
    ], names);
    expect(out.map((d) => [d.outcome, d.by])).toEqual([["owner", "Mc เอฟ"]]);
  });
});
