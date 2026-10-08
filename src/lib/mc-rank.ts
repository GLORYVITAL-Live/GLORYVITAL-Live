import type { OwnerDetail } from "@/lib/types";

/**
 * อันดับ Mc จาก GMV ต่อชั่วโมง เทียบค่าเฉลี่ยของกลุ่มเดียวกัน (ใช้ในหน้าสรุปรายเดือน)
 *
 * กลุ่ม = Campaign ของ slot (ว่าง = วันปกติ) x ช่อง (GLORY MALL / Skin Expert / ...)
 *   ค่าเฉลี่ยของกลุ่ม = GMV รวมของทุก Mc ในกลุ่ม ÷ ชั่วโมงรวม
 *   ดัชนีของ Mc ในกลุ่ม = GMV/ชม. ของ Mc ÷ ค่าเฉลี่ยของกลุ่ม (100% ขึ้นไป = ผ่าน)
 *   กลุ่มที่มี Mc คนเดียว ไม่นับคะแนน (เทียบกับตัวเองได้ 100% เสมอ)
 * ส่วนแคมเปญ / ส่วนวันปกติ = ดัชนีของแต่ละกลุ่มในส่วนนั้น ถ่วงตามชั่วโมงที่ Mc ไลฟ์ในกลุ่ม
 * คะแนนรวม = (ส่วนแคมเปญ + ส่วนวันปกติ) ÷ 2 (ไลฟ์แค่ส่วนเดียว = ใช้ส่วนนั้น)
 * เข้าอันดับเมื่อมีชั่วโมงที่มียอด GMV อย่างน้อย MIN_RANK_HOURS
 *
 * ชั่วโมงที่ใช้ = เฉพาะ slot ที่มี GMV + slot ว่างที่ยอดรวมอยู่ใน slot ถัดไปของ Mc คนเดียวกัน (gmvCoveredBy)
 */

export const MIN_RANK_HOURS = 4;

export type RankGroup = {
  key: string; campaign: string; platform: string;
  gmv: number; hours: number; avg: number; mcs: number;
  /** มี Mc อย่างน้อย 2 คน = ใช้คิดคะแนน */
  scored: boolean;
};
export type RankCell = { group: RankGroup; gmv: number; hours: number; perHour: number; index: number | null };
export type RankPart = { gmv: number; hours: number; perHour: number; index: number | null; cells: RankCell[] };
export type McRank = {
  name: string; gmv: number; hours: number; perHour: number;
  campaign: RankPart | null; normal: RankPart | null;
  score: number | null; ranked: boolean; rank: number | null;
};

const campaignKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function rankMc(details: OwnerDetail[]): { rows: McRank[]; groups: RankGroup[] } {
  const live = details.filter((d) => d.type === "Mc" && !d.cancelled);

  // หน่วยยอด: slot ที่มี GMV + ชั่วโมงของ slot ว่างที่ยอดรวมอยู่ใน slot นี้
  const units = new Map<OwnerDetail, { d: OwnerDetail; hours: number }>();
  for (const d of live) if (d.gmv !== null) units.set(d, { d, hours: d.hours });
  for (const d of live) {
    if (d.gmv !== null || !d.gmvCoveredBy) continue;
    const by = live
      .filter((x) => x.gmv !== null && x.name === d.name && x.platform === d.platform && x.startMs > d.startMs && `${x.start}–${x.end}` === d.gmvCoveredBy)
      .sort((a, b) => a.startMs - b.startMs)[0];
    if (by) units.get(by)!.hours += d.hours;
  }

  // รวมยอดรายกลุ่ม และราย Mc x กลุ่ม
  const groups = new Map<string, RankGroup & { names: Set<string> }>();
  const cells = new Map<string, Map<string, { gmv: number; hours: number }>>(); // name -> groupKey -> ยอด
  for (const { d, hours } of units.values()) {
    if (hours <= 0) continue;
    const key = `${campaignKey(d.campaign)}|${d.platform}`;
    const g = groups.get(key) ?? { key, campaign: d.campaign.trim(), platform: d.platform, gmv: 0, hours: 0, avg: 0, mcs: 0, scored: false, names: new Set<string>() };
    g.gmv += d.gmv!;
    g.hours += hours;
    g.names.add(d.name);
    groups.set(key, g);
    const byName = cells.get(d.name) ?? new Map<string, { gmv: number; hours: number }>();
    const c = byName.get(key) ?? { gmv: 0, hours: 0 };
    c.gmv += d.gmv!;
    c.hours += hours;
    byName.set(key, c);
    cells.set(d.name, byName);
  }
  for (const g of groups.values()) {
    g.avg = g.hours ? g.gmv / g.hours : 0;
    g.mcs = g.names.size;
    g.scored = g.mcs >= 2 && g.avg > 0;
  }

  const part = (list: RankCell[]): RankPart | null => {
    if (!list.length) return null;
    const gmv = list.reduce((a, c) => a + c.gmv, 0), hours = list.reduce((a, c) => a + c.hours, 0);
    const scored = list.filter((c) => c.index !== null);
    const w = scored.reduce((a, c) => a + c.hours, 0);
    return {
      gmv, hours, perHour: hours ? gmv / hours : 0,
      index: w ? scored.reduce((a, c) => a + c.index! * c.hours, 0) / w : null,
      cells: list.sort((a, b) => b.hours - a.hours),
    };
  };

  const names = [...new Set(live.map((d) => d.name))];
  const rows: McRank[] = names.map((name) => {
    const list: RankCell[] = [...(cells.get(name) ?? new Map()).entries()].map(([key, c]) => {
      const group = groups.get(key)!;
      const perHour = c.gmv / c.hours;
      return { group, gmv: c.gmv, hours: c.hours, perHour, index: group.scored ? perHour / group.avg : null };
    });
    const campaign = part(list.filter((c) => c.group.campaign));
    const normal = part(list.filter((c) => !c.group.campaign));
    const parts = [campaign?.index, normal?.index].filter((x): x is number => x != null);
    const gmv = list.reduce((a, c) => a + c.gmv, 0), hours = list.reduce((a, c) => a + c.hours, 0);
    const score = parts.length ? parts.reduce((a, x) => a + x, 0) / parts.length : null;
    return { name, gmv, hours, perHour: hours ? gmv / hours : 0, campaign, normal, score, ranked: score !== null && hours >= MIN_RANK_HOURS, rank: null };
  });

  // อันดับ: คนที่เข้าเกณฑ์เรียงตามคะแนน แล้วต่อด้วยคนที่ข้อมูลน้อย / ยังไม่มียอด
  rows.sort((a, b) => Number(b.ranked) - Number(a.ranked) || (b.score ?? -1) - (a.score ?? -1) || b.gmv - a.gmv);
  rows.forEach((r, i) => { if (r.ranked) r.rank = i + 1; });

  const out: RankGroup[] = [...groups.values()]
    .map((g) => ({ key: g.key, campaign: g.campaign, platform: g.platform, gmv: g.gmv, hours: g.hours, avg: g.avg, mcs: g.mcs, scored: g.scored }))
    .sort((a, b) => Number(!!b.campaign) - Number(!!a.campaign) || a.campaign.localeCompare(b.campaign) || b.gmv - a.gmv);
  return { rows, groups: out };
}
