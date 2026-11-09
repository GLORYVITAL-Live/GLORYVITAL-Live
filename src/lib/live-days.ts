// ป้ายวัน (วันปกติ / Teasing / วันแคมเปญ / PayDay / Extend / อื่นๆ) ต่อแพลตฟอร์มต่อวัน + เทียบยอดตามชนิดวัน — ฟังก์ชันล้วน (เทสได้)
//   ที่มา: ชีตของทีม (Shopee = คอลัมน์ remark แท็บ "GLORY Shopee " · TikTok = คอลัมน์หมายเหตุ แท็บ "GLORY TIKTOK") เก็บในตาราง live_day_tags
//   วันของไลฟ์ = วันตามปฏิทินของเวลาเริ่มไลฟ์ (แบบเดียวกับกราฟรายวัน) · วันที่ไม่มีป้าย (ไม่มีข้อมูลในชีต) ไม่นับในการเทียบ

import { bkkParts, type LiveSession, type Platform } from "@/lib/live-stats";

export type DayKind = "bau" | "teasing" | "dday" | "payday" | "extend" | "other";
export const DAY_KINDS: { kind: DayKind; label: string }[] = [
  { kind: "bau", label: "วันปกติ" },
  { kind: "teasing", label: "Teasing (ก่อนแคมเปญ)" },
  { kind: "dday", label: "วันแคมเปญ (D-Day)" },
  { kind: "payday", label: "PayDay" },
  { kind: "extend", label: "Extend (หลังแคมเปญ)" },
  { kind: "other", label: "อื่นๆ (JBP / NPD ...)" },
];
export const dayKindLabel = (k: DayKind) => DAY_KINDS.find((x) => x.kind === k)!.label;
export type DayTag = { platform: Platform; day: string; kind: DayKind; label: string };

/**
 * ข้อความในชีต -> ชนิดวัน · null = ไม่ใช่ป้ายวัน (เช่น KOL / MINI STU / หมายเหตุสล็อต)
 *   "PAYDAY Teasing" = Teasing (ดู teasing ก่อน payday) · "6.6" / "10.10 cmpaign" / "MM 5.15" / "MID MONTH" = วันแคมเปญ
 */
export function dayKindOf(remark: string): DayKind | null {
  const r = remark.trim().toLowerCase();
  if (!r) return null;
  if (/teas/.test(r)) return "teasing";
  if (/exten/.test(r)) return "extend";
  if (/pay ?day/.test(r)) return "payday";
  if (/d-?day|^\d{1,2}\.\d{1,2}( c[a-z]*)?$|^mm |mid month|mega sale/.test(r)) return "dday";
  if (r === "bau") return "bau";
  if (/jbp|npd|brand prime|สงกรานต์/.test(r)) return "other";
  return null;
}

const RANK: Record<DayKind, number> = { dday: 5, payday: 4, extend: 3, teasing: 2, other: 1, bau: 0 };

/** ป้ายของวันจากหลายข้อความ (หลายสล็อต / หลายกลุ่มในวันเดียว): เลือกชนิดที่สำคัญสุด · ไม่มีป้ายเลย = วันปกติ */
export function pickDayTag(remarks: string[]): { kind: DayKind; label: string } {
  let best: { kind: DayKind; label: string } = { kind: "bau", label: "" };
  for (const r of remarks) {
    const kind = dayKindOf(r);
    // ข้อความในชีตบางช่องขึ้นบรรทัดใหม่ ("PAYDAY\nTeasing") = รวมเป็นบรรทัดเดียว
    if (kind && (RANK[kind] > RANK[best.kind] || (kind === best.kind && !best.label))) best = { kind, label: kind === "bau" ? "" : r.replace(/\s+/g, " ").trim() };
  }
  return best;
}

/** "YYYY-MM-DD" ตามปฏิทินของเวลาเริ่มไลฟ์ (เวลาไทย) */
export const liveDay = (s: Pick<LiveSession, "startedAt">) => {
  const p = bkkParts(s.startedAt);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};
export const tagKey = (platform: string, day: string) => `${platform}|${day}`;

export type DayKindStat = { kind: DayKind; days: number; lives: number; gmv: number; sec: number; perDay: number | null; perHour: number | null };

/**
 * ยอดของแต่ละชนิดวัน (แพลตฟอร์มเดียว): วัน = วันที่มีไลฟ์ · GMV/วัน = GMV ÷ จำนวนวัน · GMV/ชม. = GMV ÷ ชั่วโมงไลฟ์
 *   ไลฟ์ในวันที่ไม่มีป้าย = ไม่นับ (คืน untagged ไว้บอกผู้ใช้)
 */
export function dayKindStats(sessions: LiveSession[], tags: Map<string, DayTag>, platform: Platform) {
  const acc = new Map<DayKind, { days: Set<string>; lives: number; gmv: number; sec: number }>();
  let untagged = 0;
  for (const s of sessions) {
    if (s.platform !== platform) continue;
    const day = liveDay(s), tag = tags.get(tagKey(platform, day));
    if (!tag) { untagged++; continue; }
    const x = acc.get(tag.kind) ?? { days: new Set<string>(), lives: 0, gmv: 0, sec: 0 };
    acc.set(tag.kind, x);
    x.days.add(day); x.lives++; x.gmv += s.gmv; x.sec += s.durationSec;
  }
  const stats: DayKindStat[] = DAY_KINDS.flatMap(({ kind }) => {
    const x = acc.get(kind);
    return x ? [{ kind, days: x.days.size, lives: x.lives, gmv: x.gmv, sec: x.sec, perDay: x.gmv / x.days.size, perHour: x.sec ? x.gmv / (x.sec / 3600) : null }] : [];
  });
  return { stats, untagged };
}
