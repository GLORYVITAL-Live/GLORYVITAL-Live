import "server-only";
import { monthRange } from "@/lib/api";
import { loadCampaignContext } from "@/lib/campaign-data";
import { ownerSummary } from "@/lib/data";
import { monthKey } from "@/lib/format";
import { costCells, type CostReport } from "@/lib/mc-cost-calc";
import { platformLabel } from "@/lib/platform";

/**
 * ความคุ้มค่า Mc ของเดือน (?month=YYYY-MM ไม่ส่ง = เดือนนี้) เทียบเดือนก่อน
 *   เดือนที่ยังไม่จบ: เดือนก่อนนับถึงวันที่เดียวกัน (ตัวเลขรวมเทียบกันได้)
 */
export async function mcCostReport(month: string | null): Promise<CostReport> {
  const now = Date.now(), today = new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
  const cur = monthRange(month), prev = monthRange(monthKey(-1, cur.key));
  const ongoing = cur.first <= today && today <= cur.last;
  const [curSum, prevSum, ctx] = await Promise.all([
    ownerSummary(cur.key, cur.first, cur.last),
    ownerSummary(prev.key, prev.first, prev.last),
    loadCampaignContext(prev.first, cur.last),
  ]);
  const slots = [...ctx.values()];
  const c = costCells(curSum, slots.filter((s) => s.date >= cur.first && s.date <= cur.last), { now });
  const p = costCells(prevSum, slots.filter((s) => s.date >= prev.first && s.date <= prev.last), { now, upToDay: ongoing ? Number(today.slice(8)) : undefined });
  return {
    month: cur.key, prevMonth: prev.key, upTo: ongoing ? today : null,
    // ชื่อช่องที่แสดง (ชีตยังใช้ชื่อเดิม)
    cells: c.cells.map((x) => ({ ...x, platform: platformLabel(x.platform) })),
    prev: p.totals, unknown: c.unknown, salaried: c.salaried,
  };
}
