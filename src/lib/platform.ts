// ชื่อช่องที่แสดง: ในชีต / ฐานข้อมูลยังใช้ชื่อเดิม (เช่น "GLORY MALL") แต่หน้าเว็บ / ไฟล์ส่งออก / สไลด์ แสดงชื่อใหม่ ("GLORY VITAL")
//   ใช้ได้ทั้งฝั่ง server และ browser
//   - ข้อมูลอ่านอย่างเดียว: แปลงตอนส่งจาก API ด้วย withPlatformLabels (หน้าจอง / ตารางของฉัน / หลักฐาน / สรุป / หน้าแรก / ผลงาน Mc)
//   - หน้าที่แก้ slot ได้ (จัดการ slot / Plan Slot Live): ข้างในใช้ชื่อจริง แปลงเฉพาะตอนแสดงด้วย platformLabel
//     และชื่อที่พิมพ์เข้ามาแปลงกลับเป็นชื่อจริงด้วย platformRaw ก่อนบันทึก (ชีตจะได้ไม่มีชื่อปนกัน)

/** ชื่อในชีต (ตัวเล็ก) -> ชื่อที่แสดง */
const LABELS: Record<string, string> = { "glory mall": "GLORY VITAL" };
/** ชื่อที่แสดง (ตัวเล็ก) -> ชื่อในชีต */
const RAWS: Record<string, string> = Object.fromEntries(Object.entries(LABELS).map(([raw, label]) => [label.toLowerCase(), raw.toUpperCase()]));

/** ชื่อช่องที่แสดงในเว็บ / ไฟล์ส่งออก เช่น "GLORY MALL" -> "GLORY VITAL" (ชื่ออื่นคงเดิม) */
export const platformLabel = (p: string) => LABELS[String(p ?? "").trim().toLowerCase()] ?? p;

/** ชื่อที่พิมพ์ในเว็บ -> ชื่อที่เก็บในชีต เช่น "GLORY VITAL" -> "GLORY MALL" (ชื่ออื่นคงเดิม) */
export const platformRaw = (p: string) => RAWS[String(p ?? "").trim().toLowerCase()] ?? p;

/**
 * แปลงชื่อช่องในข้อมูลที่ส่งให้หน้าเว็บ: ข้อความที่เป็นชื่อช่องทั้งข้อความเท่านั้น (ไม่แตะรหัสที่มีชื่อช่องปนอยู่ เช่น "GLORY MALL|2026-10-01|...")
 *   ใช้กับข้อมูลอ่านอย่างเดียว (หน้าเว็บไม่ส่งชื่อช่องกลับมาบันทึก)
 */
export function withPlatformLabels<T>(value: T): T {
  if (typeof value === "string") return platformLabel(value) as T;
  if (Array.isArray(value)) return value.map(withPlatformLabels) as T;
  if (value && typeof value === "object" && (value as object).constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withPlatformLabels(v)])) as T;
  }
  return value;
}
