// ทีมไลฟ์ของ Mc / Admin (staff.live_platform — SQL 20261031000000_live_platform) ใช้ได้ทั้ง server และ browser
//   tiktok = ค่าเริ่มต้น (ทุกคนเดิม) · shopee = ไม่เห็น / จองคิวไลฟ์ TikTok ไม่ได้ (คิวในระบบตอนนี้เป็นบัญชี TikTok ทั้งหมด)
//   ไม่แตะ DB (เทสได้)
import type { Me } from "@/lib/types";

export type LiveTeam = "tiktok" | "shopee";

/** ค่าจากฐานข้อมูล -> ทีม (ว่าง / ค่าอื่น / ยังไม่ได้รัน SQL = tiktok เหมือนคนเดิมทุกคน) */
export const liveTeamOf = (v: unknown): LiveTeam => (String(v ?? "").trim().toLowerCase() === "shopee" ? "shopee" : "tiktok");

/** error ของ Supabase ที่บอกว่ายังไม่มีคอลัมน์ live_platform (ยังไม่ได้รัน SQL) */
export const LIVE_PLATFORM_RE = /live_platform/;

/** ตัดคนทีม Shopee ออก (คนที่เหลือ = จอง / รับแจ้งเตือน slot ว่างของคิว TikTok ได้) */
export const tiktokOnly = <T extends { live_platform?: unknown }>(rows: T[]) => rows.filter((p) => liveTeamOf(p.live_platform) === "tiktok");

/** บทบาท Mc / Admin ของบัญชีนี้เป็นทีม Shopee หรือไม่ (Owner ที่เปิดดูหน้าจองแบบ preview = ไม่ใช่) */
export const isShopeeRole = (me: Me | null, role: string | null) =>
  (role === "mc" || role === "admin") && me?.[role]?.platform === "shopee";

/**
 * select พร้อมคอลัมน์ live_platform (ยังไม่ได้รัน SQL = select แบบเดิม ทุกคนถือเป็น tiktok)
 *   run(extra) — extra = ", live_platform" หรือ ""
 */
export async function withLiveTeam<T>(run: (extra: string) => PromiseLike<{ data: T; error: { message: string } | null }>) {
  const res = await run(", live_platform");
  return res.error && LIVE_PLATFORM_RE.test(res.error.message) ? run("") : res;
}
