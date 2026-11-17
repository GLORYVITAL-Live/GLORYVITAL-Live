import "server-only";
import { slotDrops, type DropLog, type DropSlot } from "@/lib/drops";
import { isShopeePlatform } from "@/lib/platform";
import { isTestAccount } from "@/lib/staff-check";
import { createAdminClient } from "@/lib/supabase/server";
import type { DropRow } from "@/lib/types";

/** คิวหลุดของ Mc ในช่วงวันไลฟ์ first..last (กติกาอยู่ที่ src/lib/drops.ts) */
export async function loadDrops(first: string, last: string): Promise<DropRow[]> {
  const db = createAdminClient();
  type SlotRow = {
    id: number; platform: string; live_date: string; start_time: string; end_time: string; is_cancelled: boolean;
    sheet_tab: string | null; person: { name: string; email: string | null } | null;
  };
  const slots: SlotRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("mc_slots")
      .select("id, platform, live_date, start_time, end_time, is_cancelled, sheet_tab, person:staff!mc_id(name, email)")
      .gte("live_date", first).lte("live_date", last).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    slots.push(...((data ?? []) as unknown as SlotRow[]));
    if ((data ?? []).length < 1000) break;
  }
  const ids = slots.map((s) => s.id);
  const logs: DropLog[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from("booking_logs").select("id, at, role, email, action, slot_id")
      .eq("slot_table", "mc_slots").eq("result", "สำเร็จ").in("slot_id", ids.slice(i, i + 300)).order("id").limit(5000);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) {
      logs.push({ id: Number(l.id), at: String(l.at), role: String(l.role ?? ""), email: l.email, action: String(l.action ?? ""), slotId: Number(l.slot_id) });
    }
  }
  // อีเมล -> ชื่อ Mc (บอกว่าใครปล่อยคิว)
  const { data: staff } = await db.from("staff").select("name, email").eq("role", "mc").not("email", "is", null);
  const nameOf = new Map((staff ?? []).map((s) => [String(s.email).toLowerCase(), `Mc ${s.name}`]));
  const list: DropSlot[] = slots.map((s) => ({
    id: s.id, date: s.live_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), platform: s.platform,
    shopee: s.sheet_tab === "shopee" || isShopeePlatform(s.platform), cancelled: s.is_cancelled,
    holder: s.person ? `Mc ${s.person.name}` : null, holderEmail: s.person?.email ?? null,
  }));
  return slotDrops(list, logs, (e) => nameOf.get(e) ?? null)
    .filter((d) => !isTestAccount(d.by) && !isTestAccount(d.from));
}
