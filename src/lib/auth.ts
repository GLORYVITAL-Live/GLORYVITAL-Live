import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

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

  const { data: rows, error } = await createAdminClient()
    .from("staff")
    .select("id, role, name, is_extra_admin, can_manage_mc, can_manage_admin, can_manage_proofs, can_view_analytics")
    .eq("email", email);
  if (error) throw error;

  const me: Me = { email, mc: null, admin: null, owner: null };
  for (const r of rows ?? []) {
    if (r.role === "mc") me.mc = { id: r.id, name: r.name };
    if (r.role === "admin") me.admin = { id: r.id, name: r.name, isExtra: r.is_extra_admin };
    if (r.role === "owner") {
      me.owner = {
        id: r.id, name: r.name, mc: r.can_manage_mc !== false, admin: r.can_manage_admin !== false,
        proofs: r.can_manage_proofs === true,
        analytics: r.can_view_analytics === true,
      };
    }
  }
  return me;
}

export function isRegistered(me: Me) {
  return !!(me.mc || me.admin || me.owner);
}
