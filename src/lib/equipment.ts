// อุปกรณ์โปรดักชั่น: ตรวจข้อมูลจากฟอร์ม — ใช้ทั้งฝั่งเว็บและเซิร์ฟเวอร์ (เทสได้)
import { EQUIPMENT_STATUSES, type EquipmentStatus } from "@/lib/types";

export type EquipmentInput = {
  code: string; name: string; category: string; quantity: number; status: EquipmentStatus; location: string;
  brand: string; model: string; serial: string; purchaseDate: string | null; price: number | null; note: string;
};

const text = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

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
      purchaseDate: d || null, price, note: String(raw.note ?? "").trim().slice(0, 1000),
    },
  };
}
