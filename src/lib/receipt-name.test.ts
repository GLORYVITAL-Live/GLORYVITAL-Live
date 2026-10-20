// เทสอ่านชื่อไฟล์เอกสารรับเงินใน Drive + จับคู่กับรายชื่อ (bun test) — ชื่อในเทสเป็นชื่อสมมติ (รูปแบบตามไฟล์จริง)
import { describe, expect, test } from "bun:test";
import {
  isWebFileOf, matchReceiptFile, nickKey, parseReceiptFile, parseReceiptName, receiptFolderMonth, receiptPersonFolder,
  receiptRealName, receiptWebFileName, roleFolder, suggestReceiptPeople, type ReceiptCandidate,
} from "@/lib/receipt-name";

const name = (s: string) => {
  const p = parseReceiptName(s);
  return p && { role: p.role, nick: p.nick, realName: p.realName, month: p.month };
};

describe("อ่านชื่อไฟล์ที่ทีมบัญชีอัปเอง", () => {
  test("เดือนหน้าคำ + Mc / Admin + ชื่อเล่น (มี / ไม่มีนามสกุลไฟล์ / ไม่มีเว้นวรรค)", () => {
    expect(name("Julyเอกสารรับเงิน Mc มะลิ")).toEqual({ role: "mc", nick: "มะลิ", realName: null, month: null });
    expect(name("July เอกสารรับเงิน Admin ส้มโอ")).toEqual({ role: "admin", nick: "ส้มโอ", realName: null, month: null });
    expect(name("JuneเอกสารรับเงินAdmin ส้มโอ.jpg")?.nick).toBe("ส้มโอ");
    expect(name("Aug เอกสารรับเงินMc  กุ้ง.jpg")?.nick).toBe("กุ้ง");
    expect(name("Sep อกสารรับเงิน Mcส้มโอ.jpg")).toMatchObject({ role: "mc", nick: "ส้มโอ" });
    expect(name("Aug เอกสารรับเงิน Mc Lily")).toMatchObject({ role: "mc", nick: "Lily" });
  });
  test("พิมพ์ตกหล่น / เกิน: อกสาร / รรับ / วรรณยุกต์หน้าชื่อ / เว้นวรรคซ้ำ / เซ็นรับเงิน", () => {
    expect(name("July เอกสารรรับเงิน Mc กุ้ง")?.nick).toBe("กุ้ง");
    expect(name("๋July เอกสารรับเงิน Mc กุ้ง")?.nick).toBe("กุ้ง");
    expect(name("Aug  เอกสารรับเงิน Mc มะลิ2")?.nick).toBe("มะลิ2");
    expect(name("Juneเอกสารเซ็นรับเงินMcมะลิ2.jpg")?.nick).toBe("มะลิ2");
    expect(name("Juneเอกสารเซ็นรับเงิน Mc มะลิ")?.nick).toBe("มะลิ");
  });
  test("ชื่อแพลตฟอร์ม (วงเล็บ / คำท้าย) ไม่ใช่ชื่อคน · MCN = Mc", () => {
    expect(name("Juneเอกสารเซ็นรับเงินMc มะลิ(shopee).jpg")).toMatchObject({ nick: "มะลิ", realName: null });
    expect(name("Juneเอกสารเซ็นรับเงินMc มะลิ (Shopee).JPG")).toMatchObject({ nick: "มะลิ", realName: null });
    expect(name("Juneเอกสารเซ็นรับเงินMCN มะลิ(shopee).jpg")).toMatchObject({ role: "mc", nick: "มะลิ" });
    expect(name("Juneเอกสารเซ็นรับเงินMc มะลิ tiktok.jpg")?.nick).toBe("มะลิ");
  });
  test("ใบแจ้งหนี้บริษัท = null", () => {
    expect(parseReceiptName("บริษัท ตัวอย่าง จำกัด_RE202607160001_บริษัท ลูกค้า จำกัด_ค่าบริการ.pdf")).toBeNull();
  });
  test("ชื่อ Mc ที่ขึ้นต้นด้วย mc ภาษาอังกฤษ ไม่ตัดผิด", () => {
    expect(name("July เอกสารรับเงิน Mcdonald")).toMatchObject({ role: null, nick: "Mcdonald" });
  });
});

describe("รูปแบบที่เว็บสร้าง", () => {
  test("แบบแรก 'Mc ชื่อ - YYYY-MM.pdf'", () => {
    expect(name("Mc มะลิ - 2026-09.pdf")).toEqual({ role: "mc", nick: "มะลิ", realName: null, month: "2026-09" });
  });
  test("โฟลเดอร์คน 'Mc ชื่อเล่น (ชื่อจริง)'", () => {
    expect(name("Mc มะลิ (สมใจ ใจดี)")).toEqual({ role: "mc", nick: "มะลิ", realName: "สมใจ ใจดี", month: null });
  });
  test("ไฟล์ไม่มีชื่อคน = ใช้ชื่อโฟลเดอร์ย่อย · โฟลเดอร์กลุ่ม (Shopee) ไม่มีชื่อ = อ่านไม่ได้", () => {
    expect(parseReceiptFile("เอกสารรับเงิน 2026-10.pdf", { month: "2026-10", role: "admin", subfolder: "Mc มะลิ (สมใจ ใจดี)" }))
      .toEqual({ month: "2026-10", role: "mc", nick: "มะลิ", realName: "สมใจ ใจดี", key: "n:มะลิ" });
    expect(parseReceiptFile("เอกสารรับเงิน 2026-10.pdf", { month: "2026-10", role: "mc", subfolder: "Shopee" })).toBeNull();
    expect(parseReceiptFile("เอกสารรับเงิน 2026-10.pdf", { month: "2026-10", role: "mc" })).toBeNull();
  });
  test("ไฟล์มีชื่อคน: ใช้ชื่อไฟล์ · บทบาทจากคำหน้าชื่อก่อนโฟลเดอร์ · เดือนจากโฟลเดอร์", () => {
    expect(parseReceiptFile("Sep อกสารรับเงิน Mcส้มโอ.jpg", { month: "2026-09", role: "mc", subfolder: "Shopee" }))
      .toEqual({ month: "2026-09", role: "mc", nick: "ส้มโอ", realName: null, key: "n:ส้มโอ" });
    expect(parseReceiptFile("Julyเอกสารรับเงิน Admin ส้มโอ", { month: "2026-07", role: "mc" })?.role).toBe("admin");
    expect(parseReceiptFile("ส้มโอ.jpg", { month: "2026-07", role: "admin" })?.role).toBe("admin");
  });
  test("ชื่อโฟลเดอร์คน + ชื่อไฟล์", () => {
    expect(receiptPersonFolder("Mc มะลิ", "สมใจ ใจดี")).toBe("Mc มะลิ (สมใจ ใจดี)");
    expect(receiptPersonFolder("Mc มะลิ", null)).toBe("Mc มะลิ");
    expect(receiptPersonFolder("สมใจ", "สมใจ")).toBe("สมใจ");
    expect(receiptPersonFolder("Mc a/b", "ชื่อ (เล่น)")).toBe("Mc a b (ชื่อ เล่น)");
    expect(receiptWebFileName("2026-10", "pdf")).toBe("เอกสารรับเงิน 2026-10.pdf");
    expect(isWebFileOf("เอกสารรับเงิน 2026-10.jpg", "2026-10")).toBe(true);
    expect(isWebFileOf("เอกสารรับเงิน 2026-09.jpg", "2026-10")).toBe(false);
    expect(isWebFileOf("Mc มะลิ - 2026-10.jpg", "2026-10")).toBe(false);
  });
  test("ชื่อจริง: ใบ 50 ทวิเดือนนั้น (ที่ยืนยันแล้วก่อน) -> legal_name -> ไม่รู้", () => {
    const docs = [
      { month: "2026-10", real_name: "สมใจ ใจดี", name_key: "สมใจใจดี" },
      { month: "2026-10", real_name: "สมใจ ใจงาม", name_key: "สมใจใจงาม" },
      { month: "2026-09", real_name: "มาลี ดีใจ", name_key: "มาลีดีใจ" },
    ];
    expect(receiptRealName("2026-10", docs, ["สมใจใจงาม"], null)).toBe("สมใจ ใจงาม");
    expect(receiptRealName("2026-10", docs, [], null)).toBe("สมใจ ใจดี");
    expect(receiptRealName("2026-08", docs, [], " มาลี ดีใจ ")).toBe("มาลี ดีใจ");
    expect(receiptRealName("2026-08", docs, [], null)).toBeNull();
  });
});

describe("โฟลเดอร์ปี / เดือน / บทบาท", () => {
  test("เดือนจากชื่อโฟลเดอร์", () => {
    expect(receiptFolderMonth("2026", "09 September")).toBe("2026-09");
    expect(receiptFolderMonth("2026", "6 June")).toBe("2026-06");
    expect(receiptFolderMonth("2026", "September")).toBe("2026-09");
    expect(receiptFolderMonth("2026", "อื่นๆ")).toBeNull();
    expect(receiptFolderMonth("เก่า", "09 September")).toBeNull();
  });
  test("Mc / Admin", () => {
    expect(roleFolder("Mc")).toBe("mc");
    expect(roleFolder(" admin ")).toBe("admin");
    expect(roleFolder("Shopee")).toBeNull();
  });
});

describe("จับคู่ไฟล์กับรายชื่อ", () => {
  const c = (id: number, role: "mc" | "admin", person: string, nick: string, realKeys: string[] = []): ReceiptCandidate =>
    ({ id, role, person, nick, label: nick, realKeys });
  const people = [
    c(1, "mc", "e:a", "มะลิ"),
    c(2, "admin", "e:b", "มะลิ"),
    c(3, "mc", "e:c", "ส้ม", ["สมใจใจดี"]),
    c(4, "mc", "s:4", "ส้ม"),
    c(5, "mc", "e:d", "ส้มโอ"),
    c(6, "admin", "e:d", "ส้มโอ"),
    c(7, "admin", "e:e", "Admin กุ้ง"),
  ];
  const f = (role: "mc" | "admin", nick: string, realName: string | null = null) => ({ role, nick, realName, key: `n:${nickKey(nick)}` });
  const none = new Map<string, number>();

  test("ชื่อเล่นตรงคนเดียวในบทบาทเดียวกัน", () => {
    expect(matchReceiptFile(f("mc", "มะลิ"), people, none)).toBe(1);
    expect(matchReceiptFile(f("admin", "มะลิ"), people, none)).toBe(2);
    // ชื่อในระบบมี "Admin" นำหน้า
    expect(matchReceiptFile(f("admin", "กุ้ง"), people, none)).toBe(7);
  });
  test("คนเดียวกันเป็นทั้ง Mc / Admin = เลือกแถวบทบาทเดียวกับไฟล์", () => {
    expect(matchReceiptFile(f("mc", "ส้มโอ"), people, none)).toBe(5);
    expect(matchReceiptFile(f("admin", "ส้มโอ"), people, none)).toBe(6);
  });
  test("ชื่อเล่นซ้ำหลายคน / ไม่มีในระบบ = ไม่เดา", () => {
    expect(matchReceiptFile(f("mc", "ส้ม"), people, none)).toBeNull();
    expect(matchReceiptFile(f("mc", "แตงโม"), people, none)).toBeNull();
  });
  test("ไม่มีในบทบาทนี้ = ดูบทบาทอื่น (คนเดียว)", () => {
    expect(matchReceiptFile(f("admin", "ส้ม"), [c(9, "mc", "e:x", "ส้ม")], none)).toBe(9);
    expect(matchReceiptFile(f("mc", "กุ้ง"), people, none)).toBe(7);
  });
  test("ชื่อจริงตรงคนเดียว ชนะชื่อเล่น · ชื่อจริงซ้ำหลายคน = ไม่เดา", () => {
    expect(matchReceiptFile(f("mc", "ส้ม", "นาย สมใจ ใจดี"), people, none)).toBe(3);
    const dup = [...people, c(8, "mc", "e:f", "อื่น", ["สมใจใจดี"])];
    expect(matchReceiptFile(f("mc", "ส้ม", "สมใจ ใจดี"), dup, none)).toBeNull();
  });
  test("ชื่อที่ Owner เคยเลือก (บทบาท + คีย์) มาก่อน", () => {
    const mem = new Map([["mc:n:ส้ม", 4]]);
    expect(matchReceiptFile(f("mc", "ส้ม"), people, mem)).toBe(4);
    // รายชื่อที่เลือกไว้ถูกลบ = กลับไปเทียบชื่อ
    expect(matchReceiptFile(f("mc", "มะลิ"), people, new Map([["mc:n:มะลิ", 99]]))).toBe(1);
  });
  test("แนะนำชื่อใกล้เคียง (ขึ้นต้นเหมือนกัน / สะกดต่าง)", () => {
    const s = suggestReceiptPeople(f("mc", "ส้มโอะ"), people);
    expect(s[0].id).toBe(5);
    expect(suggestReceiptPeople(f("mc", "แตงโม"), people)).toEqual([]);
  });
});
