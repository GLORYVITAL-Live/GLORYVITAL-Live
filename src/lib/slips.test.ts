// เทสอ่านชื่อสลิปโอนเงิน + จับคู่กับรายชื่อ (bun test) — จับคู่ผิด = คนอื่นเห็นสลิป (มีเลขบัญชี) ต้องระวัง
import { describe, expect, test } from "bun:test";
import { matchSlip, slipGroupLabel, slipGroupRole, slipPersonKeys, slipRound, slipRoundLabel } from "@/lib/slips";

describe("โฟลเดอร์สลิป", () => {
  test("รอบ = ปี 2 หลัก + เดือน + วัน", () => {
    expect(slipRound("261002")).toEqual({ round: "261002", date: "2026-10-02" });
    expect(slipRound(" 260904 รอบ 2")).toEqual({ round: "260904", date: "2026-09-04" });
    expect(slipRound("261302")).toBeNull();
    expect(slipRound("2610021")).toBeNull();
    expect(slipRound("เก่า")).toBeNull();
  });
  test("ฝั่งจากชื่อกลุ่ม / ชื่อไฟล์", () => {
    expect(slipGroupRole("รายการเบิกสำหรับADMIN LIVESTREAM Tiktok Fee")).toBe("admin");
    expect(slipGroupRole("รายการเบิกสำหรับ MC LIVESTREAM Shopee Fee")).toBe("mc");
    expect(slipGroupRole("ADMINLIVESTREAM Tiktok-Admin ปัน.pdf")).toBe("admin");
    expect(slipGroupRole("รายการเบิกค่าอัดฉีด")).toBeNull();
    expect(slipGroupLabel("รายการเบิกสำหรับ MC LIVESTREAM Shopee Fee \t")).toBe("MC LIVESTREAM Shopee");
    expect(slipRoundLabel("2026-10-02", "261002")).toBe("รอบ 2 ต.ค. 69");
  });
  test("ชื่อคนจากชื่อไฟล์", () => {
    expect(slipPersonKeys("MC LIVESTREAM Tiktok -Mc แนน.pdf")).toEqual(["แนน"]);
    expect(slipPersonKeys("ADMINLIVESTREAM Tiktok-Admin ปัน.pdf")).toEqual(["ปัน"]);
    expect(slipPersonKeys("MC LIVESTREAM Shopee- Mc จูน.pdf")).toEqual(["จูน"]);
    expect(slipPersonKeys("MC LIVESTREAM Tiktok -Mc Pin (1).pdf")).toEqual(["pin"]);
    expect(slipPersonKeys("MC LIVESTREAM Shopee-MCN อร.pdf")).toEqual(["อร", "n อร"]);
  });
});

describe("จับคู่สลิปกับรายชื่อ", () => {
  const staff = [
    { id: 1, role: "mc", name: "แนน" }, { id: 2, role: "mc", name: "แนน2" }, { id: 3, role: "mc", name: "ลูกหยี" },
    { id: 4, role: "admin", name: "เจน", salaried: true }, { id: 5, role: "admin", name: "เจนเสริม" },
    { id: 6, role: "mc", name: "N อร" }, { id: 7, role: "admin", name: "ปัน" }, { id: 8, role: "mc", name: "ปัน" },
    { id: 9, role: "mc", name: "ทดสอบ", test: true },
  ];
  const m = (role: "mc" | "admin", file: string) => matchSlip({ role, keys: slipPersonKeys(file) }, staff);
  test("ชื่อตรงคนเดียว · แนน ไม่ใช่ แนน2 · ฝั่งเดียวกันเท่านั้น", () => {
    expect(m("mc", "MC LIVESTREAM Tiktok -Mc แนน.pdf")).toBe(1);
    expect(m("mc", "MC LIVESTREAM Tiktok -Mc แนน2.pdf")).toBe(2);
    expect(m("admin", "ADMIN LIVESTREAM Tiktok-Admin ปัน.pdf")).toBe(7);
    expect(m("mc", "MC LIVESTREAM Tiktok -Mc ปัน.pdf")).toBe(8);
  });
  test("สระท้ายชื่อหายในชื่อไฟล์ = จับแบบหลวม · MCN อร = N อร", () => {
    expect(m("mc", "MC LIVESTREAM Tiktok -Mc ลูกหย.pdf")).toBe(3);
    expect(m("mc", "MC LIVESTREAM Shopee-MCN อร.pdf")).toBe(6);
  });
  test("พนักงานประจำ / บัญชีทดสอบ / ไม่ตรง = ไม่จับคู่ (ให้ Owner เลือก)", () => {
    expect(m("admin", "ADMIN LIVESTREAM Tiktok-Admin เจน.pdf")).toBeNull();
    expect(m("mc", "MC LIVESTREAM Tiktok -Mc ทดสอบ.pdf")).toBeNull();
    expect(m("mc", "MC LIVESTREAM Tiktok -Mc พายอาร์.pdf")).toBeNull();
    expect(matchSlip({ role: "mc", keys: [] }, staff)).toBeNull();
  });
  test("ชื่อซ้ำสองคน = ไม่จับคู่", () => {
    expect(matchSlip({ role: "mc", keys: ["แนน"] }, [...staff, { id: 10, role: "mc", name: "แนน " }])).toBeNull();
  });
});
