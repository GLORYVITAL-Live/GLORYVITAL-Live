// เทสข้อความประวัติการแก้พนักงาน (bun test)
import { expect, test } from "bun:test";
import { staffChangeText } from "@/lib/staff-history";

test("ค่าจ้างเปลี่ยน", () => expect(staffChangeText({ hourly_rate: 700 }, { hourly_rate: 750 })).toBe("ค่าจ้าง 700 บาท/ชม. → 750 บาท/ชม."));
test("ค่าจ้างเป็นค่าเริ่มต้น", () => expect(staffChangeText({ hourly_rate: 700 }, { hourly_rate: null })).toBe("ค่าจ้าง 700 บาท/ชม. → ค่าเริ่มต้น"));
test("ไม่เปลี่ยน = ว่าง", () => expect(staffChangeText({ hourly_rate: 700, is_salaried: false, phone: "08" }, { hourly_rate: 700, is_salaried: false, phone: "08" })).toBe(""));
test("null กับ false ถือว่าเท่ากัน", () => expect(staffChangeText({ can_view_mc: null }, { can_view_mc: false })).toBe(""));
test("หลายอย่าง", () => expect(staffChangeText({ is_salaried: false, name: "มะนาว" }, { is_salaried: true, name: "มะนาว2" }))
  .toBe("พนักงานประจำ ปิด → เปิด · ชื่อ มะนาว → มะนาว2"));
test("Commit", () => expect(staffChangeText({ commit_tiers: [] }, { commit_tiers: [{ hours: 10, rate: 950 }] })).toContain("Commit ไม่มี →"));
