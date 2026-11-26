import "server-only";
import { tiktokMcTrend } from "@/lib/cost";
import { mcCostReport } from "@/lib/mc-cost";
import { createAdminClient } from "@/lib/supabase/server";
import type { TiktokMcPeople, TiktokMcPerson } from "@/lib/tiktok-mc-calc";
import type { Me } from "@/lib/types";

/**
 * สรุป Mc TikTok ทีมเรา (ผลงาน Mc > สรุป Mc TikTok · ผู้ใช้ขอ 2026-11-26 ให้คนดูแล Mc TikTok (มีบัญชี Owner ฝั่ง Mc) กับเจ้าของดึงสไลด์ได้)
 *   เห็นได้: Owner ที่จัดการฝั่ง Mc ได้ (เห็นค่าจ้าง) และ ดู Analytics ได้ หรือ ติ๊ก "ดูสรุป Mc TikTok" (staff.can_view_tiktok_mc · SQL 20261204000000)
 */
export async function tiktokMcAccess(me: Me) {
  const o = me.owner;
  if (!o?.mc) return false;
  if (o.see.analytics) return true;
  const { data, error } = await createAdminClient().from("staff").select("can_view_tiktok_mc").eq("id", o.id).maybeSingle();
  return !error && data?.can_view_tiktok_mc === true;
}

/** รายเดือนของทั้งปี */
export const tiktokMcMonths = (year: string) => tiktokMcTrend(year);

/** ราย Mc ของเดือนที่เลือก (ค่าจ้างจากระบบ · GMV ต่อคิว เหมือนความคุ้มค่า Mc ในหน้า Cost) */
export async function tiktokMcPeople(month: string): Promise<TiktokMcPeople> {
  const cost = await mcCostReport(month);
  const people = new Map<string, TiktokMcPerson>();
  for (const c of cost.cells.filter((x) => x.app === "TikTok")) {
    const p = people.get(c.mc) ?? { mc: c.mc, slots: 0, hours: 0, cost: 0, gmv: 0, estHours: 0 };
    p.slots += c.slots; p.hours += c.hours; p.cost += c.cost; p.gmv += c.gmv; p.estHours += c.estHours;
    people.set(c.mc, p);
  }
  const part = cost.byApp?.TikTok;
  return {
    month: cost.month, open: cost.upTo !== null,
    people: [...people.values()].map((p) => ({ ...p, hours: Math.round(p.hours * 100) / 100, gmv: Math.round(p.gmv) })),
    salaried: part?.salaried ?? 0, unknown: part?.unknown ?? { slots: 0, cost: 0 },
  };
}
