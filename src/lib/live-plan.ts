// แพลน vs ไลฟ์จริง รายกลุ่ม (ผู้ใช้ขอ 2026-11-10) — ฟังก์ชันล้วน (เทสได้ ใช้ทั้งหน้าเว็บ / ไฟล์ส่งออก / สไลด์)
//   แพลน = agency_slots (Agency TDH ของ TikTok + แพลน Shopee ทุกกลุ่ม: In house / Infinite / MCN / Vis) — src/lib/live-owners.ts ownerSpanOf
//   ไลฟ์จริง = เวลาไลฟ์ในไฟล์ Export ของช่องเดียวกันที่ซ้อนกับ slot ในแพลน (นาทีที่ซ้อน · ไม่เกินความยาว slot)
//   ตัดสินเฉพาะ slot ที่จบก่อนไลฟ์ล่าสุดในไฟล์ของแพลตฟอร์มนั้น (ยังไม่อัปโหลด = รอไฟล์ ไม่นับว่าไม่ได้ไลฟ์)

import type { LiveSession } from "@/lib/live-stats";
import type { OwnerSpan } from "@/lib/live-owners";
import { isShopeePlatform, platformLabel, slotPlatformOf } from "@/lib/platform";
import { ownerText } from "@/lib/plan-clash";

/** ไลฟ์จริงไม่ถึงสัดส่วนนี้ของ slot = ไม่ได้ไลฟ์ตามแพลน · ถึงแต่ไม่ถึง PLAN_FULL = ไลฟ์ไม่ครบ */
export const PLAN_MISS = 0.5;
export const PLAN_FULL = 0.9;

export type PlanSlotCheck = { channel: string; owner: string; startMs: number; endMs: number; liveSec: number; share: number };
export type PlanGroupCheck = {
  channel: string; channelLabel: string; owner: string; ownerLabel: string;
  /** slot ที่ตัดสินแล้ว / ชั่วโมงในแพลน / ชั่วโมงที่ไลฟ์จริงในเวลาแพลน */
  slots: number; planSec: number; liveSec: number; coverage: number | null;
  missed: PlanSlotCheck[]; partial: PlanSlotCheck[];
  /** slot ที่ยังไม่ถึง / ยังไม่มีไฟล์ Export ของช่วงนั้น */
  pending: number;
};

const key = (c: string) => c.trim().toLowerCase();
const appOf = (channel: string) => (isShopeePlatform(channel) ? "Shopee" : "TikTok");

/**
 * range = ช่วงเวลาของรายงาน (เช่น ทั้งเดือน) — slot ที่เริ่มในช่วงนี้เท่านั้น
 *   now = เวลาปัจจุบัน (slot ที่ยังไม่จบ = รอ)
 */
export function planVsActual(sessions: LiveSession[], spans: OwnerSpan[], range: { fromMs: number; toMs: number }, now = Date.now()): PlanGroupCheck[] {
  // ไลฟ์ล่าสุดในไฟล์ของแต่ละแพลตฟอร์ม (จบไลฟ์) = ข้อมูลถึงเวลานี้
  const lastEnd: Record<string, number> = {};
  const byChannel = new Map<string, { start: number; end: number }[]>();
  for (const s of sessions) {
    const start = Date.parse(s.startedAt), end = start + s.durationSec * 1000;
    lastEnd[s.platform] = Math.max(lastEnd[s.platform] ?? 0, end);
    const ch = slotPlatformOf(s.platform, s.accountId);
    if (!ch) continue;
    byChannel.set(key(ch), [...(byChannel.get(key(ch)) ?? []), { start, end }]);
  }
  const groups = new Map<string, PlanGroupCheck>();
  for (const sp of spans) {
    if (sp.startMs < range.fromMs || sp.startMs >= range.toMs) continue;
    const gk = `${key(sp.channel)}|${sp.owner}`;
    const g = groups.get(gk) ?? {
      channel: sp.channel, channelLabel: platformLabel(sp.channel), owner: sp.owner, ownerLabel: ownerText(sp.owner),
      slots: 0, planSec: 0, liveSec: 0, coverage: null, missed: [], partial: [], pending: 0,
    };
    groups.set(gk, g);
    if (sp.endMs > now || sp.endMs > (lastEnd[appOf(sp.channel)] ?? 0)) { g.pending++; continue; }
    const len = (sp.endMs - sp.startMs) / 1000;
    if (len <= 0) continue;
    // นาทีที่ซ้อน (ไลฟ์หลายไลฟ์ใน slot เดียว รวมกัน ไม่เกินความยาว slot)
    let live = 0;
    for (const l of byChannel.get(key(sp.channel)) ?? []) live += Math.max(0, Math.min(sp.endMs, l.end) - Math.max(sp.startMs, l.start)) / 1000;
    live = Math.min(live, len);
    const check: PlanSlotCheck = { channel: sp.channel, owner: sp.owner, startMs: sp.startMs, endMs: sp.endMs, liveSec: live, share: live / len };
    g.slots++; g.planSec += len; g.liveSec += live;
    if (check.share < PLAN_MISS) g.missed.push(check);
    else if (check.share < PLAN_FULL) g.partial.push(check);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, coverage: g.planSec ? g.liveSec / g.planSec : null }))
    .sort((a, b) => Number(isShopeePlatform(a.channel)) - Number(isShopeePlatform(b.channel)) || b.planSec - a.planSec);
}
