/**
 * ที่อยู่เว็บจริง (ลิงก์ในอีเมล / แจ้งเตือนเด้ง / หน้าคู่มือ) — ตั้งที่ NEXT_PUBLIC_SITE_URL ของโฮสต์ (Railway)
 *   ไม่ตั้ง = ที่อยู่เดิมบน Vercel · ใส่ตอน build ด้วย (ค่า NEXT_PUBLIC_ ถูกฝังในไฟล์ตอน build)
 */
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://glory-vital-live.vercel.app").replace(/\/+$/, "");
/** ชื่อเว็บไม่มี https:// เช่น "glory-vital-live.up.railway.app" (ข้อความให้คนพิมพ์ / จำ) */
export const SITE_HOST = SITE.replace(/^https?:\/\//, "");
