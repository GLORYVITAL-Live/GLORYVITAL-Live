// เทสการตรวจข้อมูลเอกสารทำเบิก (bun test)
import { describe, expect, test } from "bun:test";
import { cleanPayInfo, formatThaiId, matchDocsFolder, payInfoText, thaiIdValid } from "@/lib/pay-docs";

// เลขตัวอย่าง (ไม่ใช่ของคนจริง): หลักสุดท้ายคำนวณจาก 12 หลักแรก
const ID = "1101700203450";
const base = {
  fullName: "นางสาว ทดสอบ ระบบ", idCardNo: ID, address: "99/1 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กทม. 10110",
  bank: "กสิกรไทย", accountNo: "123-4-56789-0", accountName: "ทดสอบ ระบบ",
};

describe("เลขบัตรประชาชน", () => {
  test("หลักตรวจสอบถูก", () => expect(thaiIdValid(ID)).toBe(true));
  test("หลักตรวจสอบผิด", () => expect(thaiIdValid("1101700203451")).toBe(false));
  test("ไม่ครบ 13 หลัก", () => expect(thaiIdValid("110170020345")).toBe(false));
  test("จัดรูปแบบ", () => expect(formatThaiId(ID)).toBe("1-1017-00203-45-0"));
});

describe("ตรวจฟอร์ม", () => {
  test("ข้อมูลครบ: ตัดขีด / ช่องว่างในเลข", () => {
    const r = cleanPayInfo({ ...base, idCardNo: "1-1017-00203-45-0" });
    expect("info" in r && r.info).toEqual({ ...base, idCardNo: ID, accountNo: "1234567890" });
  });
  test("เลขบัตรผิด", () => expect(cleanPayInfo({ ...base, idCardNo: "1101700203451" })).toEqual({ error: "เลขบัตรประชาชนไม่ถูกต้อง ตรวจอีกครั้ง" }));
  test("เลขบัตรไม่ครบ", () => expect("error" in cleanPayInfo({ ...base, idCardNo: "12345" })).toBe(true));
  test("พาสปอร์ตได้", () => expect("info" in cleanPayInfo({ ...base, idCardNo: "aa1234567" })).toBe(true));
  test("เลขบัญชีสั้นไป", () => expect(cleanPayInfo({ ...base, accountNo: "1234" })).toEqual({ error: "เลขบัญชีต้องเป็นตัวเลข 8–16 หลัก" }));
  test("ไม่ใส่ธนาคาร", () => expect(cleanPayInfo({ ...base, bank: "" })).toEqual({ error: "กรุณาเลือกธนาคาร" }));
  test("ที่อยู่สั้นไป", () => expect("error" in cleanPayInfo({ ...base, address: "กทม." })).toBe(true));
});

describe("จับคู่โฟลเดอร์เอกสารเดิมใน Drive", () => {
  const folders = ["Mc pin", " Mc แข", "Mc พายอาร์", "Mc บีม", "Mc บีมบีม", "Mc มาย", "Mc มายด์", "Mc สุพรีม", "Mc พรีม", "Mc มะนาว", "Mc มะนาว2", "Admin ปัน"]
    .map((name, i) => ({ id: String(i), name }));
  const match = (name: string) => matchDocsFolder(name, folders)?.name ?? null;
  test.each([
    ["Pin", "Mc pin"], ["แข", " Mc แข"], ["พายอา", "Mc พายอาร์"], ["บีม", "Mc บีม"], ["บีมบีม", "Mc บีมบีม"],
    ["มาย", "Mc มาย"], ["มายด์", "Mc มายด์"], ["พรีม", "Mc พรีม"], ["มะนาว", "Mc มะนาว"], ["มะนาว2", "Mc มะนาว2"], ["ปัน", "Admin ปัน"],
  ])("%s -> %s", (name, folder) => expect(match(name)).toBe(folder));
  test.each(["ทดสอบ", "ปิ่น", "มะนาว3", "เจนเสริม", ""])("%p ไม่เจอ", (name) => expect(match(name)).toBeNull());
});

test("ข้อความสรุปใน Drive", () => {
  const r = cleanPayInfo(base);
  if (!("info" in r)) throw new Error(r.error);
  const t = payInfoText(r.info, { name: "Mc ทดสอบ", email: "test@example.com", phone: "0800000000" }, "14 ต.ค. 2569");
  expect(t).toContain("เลขบัตรประชาชน: 1-1017-00203-45-0");
  expect(t).toContain("เลขบัญชี: 1234567890");
  expect(t).toContain("เบอร์โทร: 0800000000");
});
