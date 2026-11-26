import "server-only";
import { loadCampaignContext } from "@/lib/campaign-data";
import { bkkToday } from "@/lib/data";
import { MY_GMV_MONTHS, MY_GMV_START, shiftMonth, toMyGmvSlots, type MyGmvData } from "@/lib/my-gmv";
import { withPlatformLabels } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

/**
 * ยอดขาย (GMV) ของตัวเอง — เปิดให้ Mc ประจำ (staff.is_salaried) เท่านั้น เห็นเฉพาะ slot ของตัวเอง
 *   (ผู้ใช้ขอ 2026-11-26 ให้ Mc ประจำทำสไลด์ส่วนตัวไว้ present · ตอนนั้นมี Mc ประจำคนเดียว)
 */
export async function ownGmvMc(me: Me): Promise<{ id: number; name: string } | null> {
  if (!me.mc) return null;
  const { data } = await createAdminClient().from("staff").select("id, name, is_salaried").eq("id", me.mc.id).maybeSingle();
  return data?.is_salaried === true ? { id: Number(data.id), name: String(data.name) } : null;
}

const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** slot ของ Mc คนนี้ ย้อนหลังไม่เกิน 12 เดือน ถึงสิ้นเดือนนี้ (ค่าเฉลี่ย / การแบ่งยอดจาก Export ใช้ slot ของทุกคนในช่องเดียวกัน) */
export async function myGmvData(mc: { id: number; name: string }): Promise<MyGmvData> {
  const today = bkkToday();
  const cur = today.slice(0, 7);
  const back = shiftMonth(cur, -(MY_GMV_MONTHS - 1));
  const first = back > MY_GMV_START ? back : MY_GMV_START;
  const ctx = await loadCampaignContext(`${first}-01`, lastDayOf(cur));
  const mine = [...ctx.values()].filter((s) => s.mcId === mc.id);
  return { name: `Mc ${mc.name}`, today, first, last: cur, slots: withPlatformLabels(toMyGmvSlots(mine, Date.now())) };
}
