// อุปกรณ์โปรดักชั่น: ตรวจข้อมูลจากฟอร์ม — ใช้ทั้งฝั่งเว็บและเซิร์ฟเวอร์ (เทสได้)
import { EQUIPMENT_STATUSES, type EquipmentStatus } from "@/lib/types";

export type EquipmentInput = {
  code: string; name: string; category: string; quantity: number; status: EquipmentStatus; location: string;
  brand: string; model: string; serial: string; purchaseDate: string | null; price: number | null; note: string;
  specs: Record<string, string>;
};

/** สเปคคอมพิวเตอร์ (ช่องที่กรอกได้ เรียงตามที่แสดง) */
export const SPEC_FIELDS: [key: string, label: string, placeholder: string][] = [
  ["cpu", "CPU", "เช่น Intel Core i5-12400"],
  ["ram", "RAM", "เช่น 16GB DDR4"],
  ["storage", "ที่เก็บข้อมูล", "เช่น SSD 512GB + HDD 1TB"],
  ["gpu", "การ์ดจอ", "เช่น RTX 3060 12GB / ออนบอร์ด"],
  ["board", "เมนบอร์ด", "เช่น B660M"],
  ["os", "ระบบปฏิบัติการ", "เช่น Windows 11 Pro"],
  ["other", "อื่นๆ", "เช่น Wi-Fi, การ์ดจับภาพ, พอร์ต"],
];
/** หมวดนี้มีสเปคคอมพิวเตอร์ */
export const isComputer = (category: string) => /คอม|computer|pc|notebook|โน้ตบุ๊ก/i.test(category);
/** สเปคแบบสั้นบนการ์ด เช่น "i5-12400 · 16GB DDR4 · SSD 512GB" */
export const specLine = (specs: Record<string, string>) =>
  SPEC_FIELDS.slice(0, 4).map(([k]) => specs[k]).filter(Boolean).join(" · ");

const text = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** ชื่อไฟล์รูปใน Google Drive เช่น "CM01_Nanlite FS-150.jpg" (ตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้ · นามสกุลตามไฟล์ใน Storage) */
export function equipmentFileName(code: string, name: string, photoPath: string) {
  const ext = photoPath.split(".").pop()?.toLowerCase() || "jpg";
  const base = [code, name].map((s) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join("_");
  return `${base.slice(0, 150) || "อุปกรณ์"}.${ext}`;
}

/** สเปค: เก็บเฉพาะช่องที่รู้จักและมีค่า */
export function cleanSpecs(raw: unknown) {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(SPEC_FIELDS.map(([k]) => [k, text(src[k], 200)]).filter(([, v]) => v));
}

/** ตรวจ + ทำความสะอาด (ราคา: ตัด , ฿ ช่องว่าง · วันที่ YYYY-MM-DD) */
export function cleanEquipment(raw: Record<string, unknown>): { data: EquipmentInput } | { error: string } {
  const name = text(raw.name, 120);
  if (!name) return { error: "กรุณาใส่ชื่ออุปกรณ์" };
  const q = String(raw.quantity ?? "1").replace(/[,\s]/g, "");
  const quantity = q === "" ? 1 : Number(q);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) return { error: "จำนวนต้องเป็นตัวเลขเต็ม 0 ขึ้นไป" };
  const status = (EQUIPMENT_STATUSES as readonly string[]).includes(String(raw.status)) ? (raw.status as EquipmentStatus) : "ใช้งานได้";
  const p = String(raw.price ?? "").replace(/[,\s฿บาท]/g, "");
  const price = p === "" ? null : Number(p);
  if (price !== null && (!Number.isFinite(price) || price < 0)) return { error: "ราคาต้องเป็นตัวเลข" };
  const d = String(raw.purchaseDate ?? "").trim();
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "วันที่ซื้อไม่ถูกต้อง" };
  return {
    data: {
      code: text(raw.code, 40).toUpperCase(), name, category: text(raw.category, 60), quantity, status, location: text(raw.location, 120),
      brand: text(raw.brand, 80), model: text(raw.model, 120), serial: text(raw.serial, 200),
      purchaseDate: d || null, price, note: String(raw.note ?? "").trim().slice(0, 1000), specs: cleanSpecs(raw.specs),
    },
  };
}
