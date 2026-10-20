// เทสเอกสารยืนยันการรับเงิน (bun test) — ชื่อในเทสเป็นชื่อสมมติ
import { describe, expect, test } from "bun:test";
import {
  bkkMonth, cleanReason, cleanRequiredFrom, receiptFileName, receiptFolders, receiptMonthOk, receiptRole, receiptState,
  shiftMonth, sniffType, RECEIPT_REASON_MAX,
} from "@/lib/receipts";
import { tawiAccess } from "@/lib/tawi-verify";

// 20 ต.ค. 2026 10:00 เวลาไทย
const NOW = Date.UTC(2026, 9, 20, 3);
const KEY = "สมใจใจดี";

describe("ต้องส่งเอกสารรับเงินไหม", () => {
  test("เดือนก่อนเริ่มบังคับ / ไม่บังคับ = none", () => {
    expect(receiptState("2026-05", "2026-06")).toBe("none");
    expect(receiptState("2026-09", null)).toBe("none");
    expect(receiptState("2026-09", null, { status: "rejected" })).toBe("none");
  });
  test("ตั้งแต่เดือนเริ่ม: ไม่มี = missing · ส่งแล้ว = ok · ไม่ผ่าน = rejected", () => {
    expect(receiptState("2026-06", "2026-06")).toBe("missing");
    expect(receiptState("2026-09", "2026-06", null)).toBe("missing");
    expect(receiptState("2026-09", "2026-06", { status: "ok" })).toBe("ok");
    expect(receiptState("2026-09", "2026-06", { status: "rejected" })).toBe("rejected");
  });
  test("ค่าตั้งเดือนเริ่ม: ว่าง / ผิดรูปแบบ = ไม่บังคับ", () => {
    expect(cleanRequiredFrom("2026-06")).toBe("2026-06");
    expect(cleanRequiredFrom(" 2026-06 ")).toBe("2026-06");
    expect(cleanRequiredFrom("")).toBeNull();
    expect(cleanRequiredFrom(null)).toBeNull();
    expect(cleanRequiredFrom("2026-6")).toBeNull();
    expect(cleanRequiredFrom("2026-13")).toBeNull();
  });
});

describe("ดาวน์โหลดใบ 50 ทวิ + เอกสารรับเงิน", () => {
  const me = { viewer: false, mine: true, docKey: KEY, verifiedKeys: [KEY] };
  test("เดือนก่อนเริ่มบังคับ (none) / ส่งแล้ว = ok", () => {
    expect(tawiAccess({ ...me, receipt: "none" })).toBe("ok");
    expect(tawiAccess({ ...me })).toBe("ok");
    expect(tawiAccess({ ...me, receipt: "ok" })).toBe("ok");
  });
  test("ยังไม่ส่ง = receipt · ไม่ผ่าน = rejected", () => {
    expect(tawiAccess({ ...me, receipt: "missing" })).toBe("receipt");
    expect(tawiAccess({ ...me, receipt: "rejected" })).toBe("rejected");
  });
  test("ยังไม่ยืนยันตัวตน = verify ก่อน (แม้ยังไม่ส่งเอกสาร)", () => {
    expect(tawiAccess({ ...me, verifiedKeys: [], receipt: "missing" })).toBe("verify");
    expect(tawiAccess({ ...me, verifiedKeys: null, receipt: "missing" })).toBe("updating");
  });
  test("Owner ที่ดูเอกสารได้ = เปิดได้เสมอ · ไม่ใช่ของตัวเอง = forbidden", () => {
    expect(tawiAccess({ ...me, viewer: true, receipt: "missing" })).toBe("ok");
    expect(tawiAccess({ ...me, viewer: true, receipt: "rejected" })).toBe("ok");
    expect(tawiAccess({ ...me, mine: false, receipt: "ok" })).toBe("forbidden");
  });
});

describe("เดือนที่ส่งได้", () => {
  test("เดือนปัจจุบัน / ย้อนหลังไม่เกิน 18 เดือน (เวลาไทย)", () => {
    expect(bkkMonth(NOW)).toBe("2026-10");
    // 31 ต.ค. 23:30 UTC = 1 พ.ย. เวลาไทย
    expect(bkkMonth(Date.UTC(2026, 9, 31, 17, 30))).toBe("2026-11");
    expect(receiptMonthOk("2026-10", [], NOW)).toBe(true);
    expect(receiptMonthOk("2025-04", [], NOW)).toBe(true);
    expect(receiptMonthOk("2025-03", [], NOW)).toBe(false);
  });
  test("เดือนอนาคต / ผิดรูปแบบ = ไม่ได้ · เดือนที่มีใบ 50 ทวิ = ได้เสมอ", () => {
    expect(receiptMonthOk("2026-11", [], NOW)).toBe(false);
    expect(receiptMonthOk("2026-1", [], NOW)).toBe(false);
    expect(receiptMonthOk(undefined, [], NOW)).toBe(false);
    expect(receiptMonthOk("2024-01", ["2024-01"], NOW)).toBe(true);
  });
  test("เลื่อนเดือนข้ามปี", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", -18)).toBe("2025-04");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("โฟลเดอร์ / ชื่อไฟล์ใน Drive", () => {
  test("โฟลเดอร์ปี + เดือนแบบ '10 October'", () => {
    expect(receiptFolders("2026-10")).toEqual({ year: "2026", month: "10 October" });
    expect(receiptFolders("2026-06")).toEqual({ year: "2026", month: "06 June" });
  });
  test("ชื่อไฟล์อ่านง่าย + ตัดอักขระต้องห้าม", () => {
    expect(receiptFileName("Mc ปลื้ม", "2026-09", "application/pdf")).toBe("Mc ปลื้ม - 2026-09.pdf");
    expect(receiptFileName("มะลิ", "2026-09", "image/jpeg")).toBe("มะลิ - 2026-09.jpg");
    expect(receiptFileName("Mc a/b:c", "2026-09", "image/png")).toBe("Mc a b c - 2026-09.png");
  });
  test("Mc หรือ Admin: ตามบทบาทที่ใบ 50 ทวิจับคู่ · ไม่ชัด = Mc", () => {
    expect(receiptRole(["mc", "admin"], ["admin"])).toBe("admin");
    expect(receiptRole(["mc", "admin"], ["mc", "admin"])).toBe("mc");
    expect(receiptRole(["mc", "admin"], [])).toBe("mc");
    expect(receiptRole(["admin"], [])).toBe("admin");
    expect(receiptRole(["mc"], [])).toBe("mc");
  });
});

describe("ตรวจไฟล์", () => {
  const bytes = (...xs: (number | string)[]) =>
    new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
  test("ชนิดจากไบต์แรก", () => {
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffType(bytes(0x89, "PNG", 0x0d, 0x0a))).toBe("image/png");
    expect(sniffType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image/webp");
    expect(sniffType(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffType(bytes("<html>"))).toBe("");
    expect(sniffType(new Uint8Array())).toBe("");
  });
  test("เหตุผลไม่ผ่าน: ตัดช่องว่าง / จำกัดความยาว", () => {
    expect(cleanReason("  รูป\nไม่ชัด  ")).toBe("รูป ไม่ชัด");
    expect(cleanReason(null)).toBe("");
    expect(cleanReason("ก".repeat(500)).length).toBe(RECEIPT_REASON_MAX);
  });
});
