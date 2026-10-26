import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { LIVE_PLATFORM_RE, liveTeamOf } from "@/lib/live-team";
import type { Me } from "@/lib/types";

/** คอลัมน์สิทธิ์ "ดูได้อย่างเดียว" (SQL 20261018000000_view_only) */
export const VIEW_COLS = "can_view_mc, can_view_admin, can_view_proofs, can_view_plan, analytics_readonly";
export const VIEW_COL_RE = /can_view_mc|can_view_admin|can_view_proofs|can_view_plan|analytics_readonly/;

/**
 * ผู้ใช้ที่ login อยู่ + บทบาทจากตาราง staff (อีเมลเดียวมีได้หลายบทบาท)
 * คืน { email, ... } ถ้า login แล้วแต่อีเมลยังไม่ได้ลงทะเบียน ทุกบทบาทจะเป็น null
 * คืน null ถ้ายังไม่ได้ login
 */
export async function getMe(): Promise<Me | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase();
  if (!email) return null;

  const base = "id, role, name, is_extra_admin, can_manage_mc, can_manage_admin, can_manage_proofs, can_view_analytics";
  let live = ", live_platform";
  const query = async (cols: string) => {
    const run = () => createAdminClient().from("staff").select(cols + live).eq("email", email);
    let res = await run();
    // ยังไม่ได้รัน SQL 20261031000000_live_platform: ทุกคนเป็นทีม TikTok ตามเดิม
    if (res.error && LIVE_PLATFORM_RE.test(res.error.message)) { live = ""; res = await run(); }
    return res;
  };
  let { data: rows, error } = await query(`${base}, can_plan_slots, ${VIEW_COLS}`);
  // ยังไม่ได้รัน SQL 20261018000000_view_only / 20261017000000_plan_slots: login ได้ตามเดิม (แค่ยังไม่มีสิทธิ์แบบดูอย่างเดียว / หน้า Plan)
  if (error && VIEW_COL_RE.test(error.message)) ({ data: rows, error } = await query(`${base}, can_plan_slots`));
  if (error && /can_plan_slots/.test(error.message)) ({ data: rows, error } = await query(base));
  if (error) throw error;

  const me: Me = { email, mc: null, admin: null, owner: null, marketing: null, equipment: false };
  type Row = {
    id: number; role: string; name: string; is_extra_admin: boolean; can_manage_mc: boolean | null; can_manage_admin: boolean | null;
    can_manage_proofs: boolean | null; can_view_analytics: boolean | null; can_plan_slots?: boolean | null;
    can_view_mc?: boolean | null; can_view_admin?: boolean | null; can_view_proofs?: boolean | null; can_view_plan?: boolean | null;
    analytics_readonly?: boolean | null; live_platform?: string | null;
  };
  for (const r of (rows ?? []) as unknown as Row[]) {
    if (r.role === "mc") me.mc = { id: r.id, name: r.name, platform: liveTeamOf(r.live_platform) };
    if (r.role === "admin") me.admin = { id: r.id, name: r.name, isExtra: r.is_extra_admin, platform: liveTeamOf(r.live_platform) };
    if (r.role === "marketing") me.marketing = { id: r.id, name: r.name };
    if (r.role === "borrower") me.borrower = { id: r.id, name: r.name, team: "" };
    if (r.role === "owner") {
      // สิทธิ์เดิม = จัดการได้ / can_view_* = ดูได้อย่างเดียว / Data analytics: ติ๊กแล้วดูได้ จัดการได้ถ้าไม่ได้ตั้งเป็นดูอย่างเดียว
      const mc = r.can_manage_mc !== false, admin = r.can_manage_admin !== false, proofs = r.can_manage_proofs === true;
      const analyticsAccess = r.can_view_analytics === true, plan = r.can_plan_slots === true;
      me.owner = {
        id: r.id, name: r.name, mc, admin, proofs, analytics: analyticsAccess && r.analytics_readonly !== true, plan,
        see: {
          mc: mc || r.can_view_mc === true, admin: admin || r.can_view_admin === true, proofs: proofs || r.can_view_proofs === true,
          analytics: analyticsAccess, plan: plan || r.can_view_plan === true,
        },
      };
      if (mc || admin) me.equipment = true; // Owner ที่จัดการ Mc หรือ Admin ได้ ใช้หน้าอุปกรณ์ได้เสมอ
    }
  }
  // Admin ที่ติ๊ก "จัดการอุปกรณ์โปรดักชั่น" (ถามเฉพาะคนที่เป็น Admin · ยังไม่ได้รัน SQL 20261025000000_equipment = ไม่ได้ ไม่กระทบการ login)
  if (me.admin && !me.equipment) {
    const { data: equip } = await createAdminClient().from("staff").select("can_manage_equipment").eq("id", me.admin.id).maybeSingle();
    me.equipment = equip?.can_manage_equipment === true;
  }
  // ทีมอื่น: ชื่อทีม / แผนก (ยังไม่ได้รัน SQL = ว่าง)
  if (me.borrower) {
    const { data: t } = await createAdminClient().from("staff").select("team_name").eq("id", me.borrower.id).maybeSingle();
    me.borrower.team = String(t?.team_name ?? "");
  }
  return me;
}

export function isRegistered(me: Me) {
  return !!(me.mc || me.admin || me.owner || me.marketing || me.borrower);
}

/** คนในทีมไลฟ์ (ไม่ใช่บัญชีทีมอื่นที่มาขอยืมอุปกรณ์อย่างเดียว) — ใช้กับหน้าที่ "ทุกคนที่ลงทะเบียน" เห็น เช่น เทรนนิ่ง */
export const isStaff = (me: Me) => !!(me.mc || me.admin || me.owner || me.marketing);
