// เทสชื่อไฟล์รูปอุปกรณ์ใน Drive (bun test)
import { expect, test } from "bun:test";
import { equipmentFileName } from "@/lib/equipment";

test("รหัส + ชื่อ", () => expect(equipmentFileName("CM01", "Nanlite FS-150", "a.png")).toBe("CM01_Nanlite FS-150.png"));
test("ไม่มีรหัส", () => expect(equipmentFileName("", "ไมค์ Rode", "a.jpg")).toBe("ไมค์ Rode.jpg"));
test("ตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้", () => expect(equipmentFileName("LT/05", 'ไฟ "หลัก"', "a.webp")).toBe("LT 05_ไฟ หลัก.webp"));
test("ชื่อว่าง", () => expect(equipmentFileName("", "", "x.jpg")).toBe("อุปกรณ์.jpg"));
