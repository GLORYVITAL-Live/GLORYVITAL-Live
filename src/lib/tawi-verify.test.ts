// เทสยืนยันตัวตนก่อนดาวน์โหลดใบ 50 ทวิ (bun test) — ชื่อในเทสเป็นชื่อสมมติ
import { describe, expect, test } from "bun:test";
import { TAWI_VERIFY_MAX_FAILS, checkTawiVerify, failsToday, tawiAccess, tawiVerifyState } from "@/lib/tawi-verify";

// 19 ต.ค. 2026 10:00 เวลาไทย
const NOW = Date.UTC(2026, 9, 19, 3);
const TODAY = new Date(NOW - 3600_000).toISOString();
const YESTERDAY = new Date(NOW - 24 * 3600_000).toISOString();
const KEY = "สมใจใจดี";
const base = { docKeys: [KEY], verifiedKeys: [] as string[], dayFails: 0, failedAt: null as string | null, now: NOW };

describe("ยืนยันชื่อ", () => {
  test("ตรง (คำนำหน้า / ช่องว่างต่างกันได้) = ok + จำคีย์", () => {
    expect(checkTawiVerify({ ...base, name: "นางสาว สมใจ  ใจดี" })).toEqual({ status: "ok", key: KEY, keys: [KEY] });
    expect(checkTawiVerify({ ...base, name: "น.ส.สมใจ ใจดี" }).status).toBe("ok");
  });
  test("ตัวสะกดต่าง / ชื่อคนอื่น = mismatch นับครั้ง", () => {
    expect(checkTawiVerify({ ...base, name: "สมใจ ใจดีย์" })).toEqual({ status: "mismatch", failsToday: 1, left: TAWI_VERIFY_MAX_FAILS - 1 });
    expect(checkTawiVerify({ ...base, name: "มะลิ หอมดี", dayFails: 2, failedAt: TODAY })).toEqual({ status: "mismatch", failsToday: 3, left: 2 });
  });
  test("กรอกไม่ครบ = invalid (ไม่นับ)", () => {
    expect(checkTawiVerify({ ...base, name: "" }).status).toBe("invalid");
    expect(checkTawiVerify({ ...base, name: "นาย ก" }).status).toBe("invalid");
    expect(checkTawiVerify({ ...base, name: "1234 5678" }).status).toBe("invalid");
  });
  test("ผิดครบ 5 ครั้งวันนี้ = locked แม้ครั้งนี้กรอกถูก · เมื่อวาน = เริ่มนับใหม่", () => {
    expect(checkTawiVerify({ ...base, name: "สมใจ ใจดี", dayFails: TAWI_VERIFY_MAX_FAILS, failedAt: TODAY }).status).toBe("locked");
    expect(checkTawiVerify({ ...base, name: "สมใจ ใจดี", dayFails: TAWI_VERIFY_MAX_FAILS, failedAt: YESTERDAY }).status).toBe("ok");
    expect(checkTawiVerify({ ...base, name: "x ใจร้าย", dayFails: TAWI_VERIFY_MAX_FAILS, failedAt: YESTERDAY }))
      .toEqual({ status: "mismatch", failsToday: 1, left: 4 });
  });
  test("ใบใหม่ชื่อต่าง: ต้องยืนยันชื่อนั้น (กรอกชื่อเดิม = ไม่ตรง)", () => {
    const next = { ...base, docKeys: [KEY, "สมใจใจดีย์"], verifiedKeys: [KEY] };
    expect(checkTawiVerify({ ...next, name: "สมใจ ใจดี" }).status).toBe("mismatch");
    expect(checkTawiVerify({ ...next, name: "สมใจ ใจดีย์" })).toEqual({ status: "ok", key: "สมใจใจดีย์", keys: [KEY, "สมใจใจดีย์"] });
  });
  test("ยืนยันครบแล้ว / ไม่มีใบ = nothing", () => {
    expect(checkTawiVerify({ ...base, verifiedKeys: [KEY], name: "สมใจ ใจดี" }).status).toBe("nothing");
    expect(checkTawiVerify({ ...base, docKeys: [], name: "สมใจ ใจดี" }).status).toBe("nothing");
  });
  test("นับครั้งรายวันตามเวลาไทย", () => {
    expect(failsToday(3, TODAY, NOW)).toBe(3);
    expect(failsToday(3, YESTERDAY, NOW)).toBe(0);
    expect(failsToday(3, null, NOW)).toBe(0);
    // 23:30 เวลาไทยของเมื่อวาน (16:30 UTC) = คนละวันกับ 10:00 วันนี้
    expect(failsToday(3, new Date(Date.UTC(2026, 9, 18, 16, 30)).toISOString(), NOW)).toBe(0);
    // 00:30 เวลาไทยของวันนี้ (17:30 UTC เมื่อวาน) = วันเดียวกัน
    expect(failsToday(3, new Date(Date.UTC(2026, 9, 18, 17, 30)).toISOString(), NOW)).toBe(3);
  });
});

describe("สถานะในหน้า Owner", () => {
  test("ยืนยันแล้ว / รอ / กรอกไม่ตรง", () => {
    expect(tawiVerifyState({ keys: [KEY], fails: 0, failedAt: null }, KEY)).toEqual({ status: "ok", fails: 0, failedAt: null });
    expect(tawiVerifyState({ keys: [], fails: 0, failedAt: null }, KEY).status).toBe("wait");
    expect(tawiVerifyState({ keys: [], fails: 2, failedAt: TODAY }, KEY)).toEqual({ status: "fail", fails: 2, failedAt: TODAY });
    // ใบใหม่ชื่อต่างจากที่ยืนยันไว้ = รอยืนยันใบนั้น
    expect(tawiVerifyState({ keys: ["สมใจใจดีย์"], fails: 0, failedAt: null }, KEY).status).toBe("wait");
  });
});

describe("ดาวน์โหลดได้ไหม", () => {
  const doc = { docKey: KEY };
  test("เจ้าของที่ยืนยันชื่อของใบนี้แล้ว = ok", () => {
    expect(tawiAccess({ ...doc, viewer: false, mine: true, verifiedKeys: [KEY] })).toBe("ok");
  });
  test("เจ้าของที่ยังไม่ยืนยัน / ยืนยันชื่ออื่น (ใบใหม่ชื่อต่าง) = verify", () => {
    expect(tawiAccess({ ...doc, viewer: false, mine: true, verifiedKeys: [] })).toBe("verify");
    expect(tawiAccess({ ...doc, viewer: false, mine: true, verifiedKeys: ["สมใจใจดีย์"] })).toBe("verify");
    expect(tawiAccess({ docKey: "", viewer: false, mine: true, verifiedKeys: [""] })).toBe("verify");
  });
  test("ไม่ใช่ใบของตัวเอง (ย้าย / ยกเลิกการจับคู่แล้ว) = forbidden แม้เคยยืนยันชื่อนี้", () => {
    expect(tawiAccess({ ...doc, viewer: false, mine: false, verifiedKeys: [KEY] })).toBe("forbidden");
  });
  test("ยังไม่ได้รัน SQL = เจ้าตัวโหลดไม่ได้ · Owner ที่ดูเอกสารได้ = เปิดได้เสมอ", () => {
    expect(tawiAccess({ ...doc, viewer: false, mine: true, verifiedKeys: null })).toBe("updating");
    expect(tawiAccess({ ...doc, viewer: true, mine: false, verifiedKeys: null })).toBe("ok");
    expect(tawiAccess({ ...doc, viewer: true, mine: true, verifiedKeys: [] })).toBe("ok");
  });
});
