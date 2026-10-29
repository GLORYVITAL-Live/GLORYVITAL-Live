// ทีมไลฟ์ของ Mc / Admin (staff.live_platform — SQL 20261031000000_live_platform / 20261114000000_shopee_slots) ใช้ได้ทั้ง server และ browser
//   tiktok = ค่าเริ่มต้น (ทุกคนเดิม) · shopee = เห็น / จองเฉพาะคิว Shopee · both = TikTok + Shopee (จองได้ทั้งสองหน้า)
//   คิว Shopee = slot ของแท็บ "ลงตาราง MC Shopee" (mc_slots.sheet_tab = 'shopee') มีแต่ฝั่ง Mc
//   ไม่แตะ DB (เทสได้)
import type { Me } from "@/lib/types";

export type LiveTeam = "tiktok" | "shopee" | "both";
/** หน้าจองของ Mc: คิว TikTok (แท็บ Deal Mc) / คิว Shopee (แท็บ MC Shopee) */
export type Board = "tiktok" | "shopee";

/** ค่าจากฐานข้อมูล -> ทีม (ว่าง / ค่าอื่น / ยังไม่ได้รัน SQL = tiktok เหมือนคนเดิมทุกคน) */
export const liveTeamOf = (v: unknown): LiveTeam => {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "shopee" || t === "both" ? t : "tiktok";
};

/** จอง / รับแจ้งเตือน slot ว่างของคิว TikTok ได้ */
export const canTiktok = (team: unknown) => liveTeamOf(team) !== "shopee";
/** จอง / รับแจ้งเตือน slot ว่างของคิว Shopee ได้ */
export const canShopee = (team: unknown) => liveTeamOf(team) !== "tiktok";
/** ทีมนี้ใช้หน้าจองนี้ได้ไหม */
export const onBoard = (team: unknown, board: Board) => (board === "shopee" ? canShopee(team) : canTiktok(team));

/** ป้ายทีมไลฟ์ */
export const liveTeamLabel = (team: unknown) => {
  const t = liveTeamOf(team);
  return t === "both" ? "TikTok + Shopee" : t === "shopee" ? "Shopee" : "TikTok";
};

/** error ของ Supabase ที่บอกว่ายังไม่มีคอลัมน์ live_platform (ยังไม่ได้รัน SQL) */
export const LIVE_PLATFORM_RE = /live_platform/;

/** ตัดคนทีม Shopee อย่างเดียวออก (คนที่เหลือ = จอง / รับแจ้งเตือน slot ว่างของคิว TikTok ได้) */
export const tiktokOnly = <T extends { live_platform?: unknown }>(rows: T[]) => rows.filter((p) => canTiktok(p.live_platform));
/** คนที่จอง / รับแจ้งเตือน slot ว่างของคิว Shopee ได้ (ทีม Shopee + TikTok + Shopee) */
export const shopeeCrew = <T extends { live_platform?: unknown }>(rows: T[]) => rows.filter((p) => canShopee(p.live_platform));

/**
 * หน้าจองที่บทบาทนี้ใช้ได้ (ตามลำดับที่แสดง)
 *   Mc: ตามทีม · Owner ที่เปิดดูแบบ preview (ไม่ได้เป็น Mc เอง) เห็นทั้งสองหน้า
 *   Admin: มีแต่คิว TikTok (Shopee ไม่มีแถว Admin) — Admin ทีม Shopee อย่างเดียว = ไม่มีหน้าจอง
 */
export function boardsOf(me: Me | null, role: string | null): Board[] {
  if (role === "mc") return me?.mc ? (["tiktok", "shopee"] as const).filter((b) => onBoard(me.mc!.platform, b)) : ["tiktok", "shopee"];
  if (role === "admin") return me?.admin && !canTiktok(me.admin.platform) ? [] : ["tiktok"];
  return [];
}

/**
 * select พร้อมคอลัมน์ live_platform (ยังไม่ได้รัน SQL = select แบบเดิม ทุกคนถือเป็น tiktok)
 *   run(extra) — extra = ", live_platform" หรือ ""
 */
export async function withLiveTeam<T>(run: (extra: string) => PromiseLike<{ data: T; error: { message: string } | null }>) {
  const res = await run(", live_platform");
  return res.error && LIVE_PLATFORM_RE.test(res.error.message) ? run("") : res;
}
