import { fail, ok, requireOwner } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/server";

// ประวัติการแก้รายชื่อนี้ (?id=) — เพิ่ม / แก้ค่าจ้าง Commit สิทธิ์ ข้อมูลติดต่อ / รวมรายชื่อ (ใหม่ก่อน ไม่เกิน 50 รายการ)
//   เฉพาะ Owner ที่จัดการฝั่งนั้นได้ (Owner / Marketing = จัดการได้ทั้ง Mc และ Admin) · ประวัติก่อนมีระบบนี้หาจากชื่อในข้อความ
export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูประวัติพนักงาน");
  if ("res" in r) return r.res;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่พบรายชื่อนี้");
  const db = createAdminClient();
  const { data: p } = await db.from("staff").select("role, name").eq("id", id).maybeSingle();
  if (!p) return fail("ไม่พบรายชื่อนี้");
  const allowed = p.role === "mc" ? r.scope.mc : p.role === "admin" ? r.scope.admin : r.scope.full;
  if (!allowed) return fail("บัญชีนี้ไม่มีสิทธิ์ดูประวัติของรายชื่อนี้", 403);

  const cols = "id, at, name, action";
  const [linked, legacy] = await Promise.all([
    db.from("booking_logs").select(cols).eq("slot_table", "staff").eq("slot_id", id).order("id", { ascending: false }).limit(50),
    // ก่อนมีระบบนี้: บันทึกแค่ชื่อ เช่น แก้พนักงาน mc "มะนาว": hourly_rate
    db.from("booking_logs").select(cols).is("slot_table", null).ilike("action", `%พนักงาน ${p.role} "${p.name}"%`).order("id", { ascending: false }).limit(50),
  ]);
  if (linked.error) return fail(linked.error.message, 500);
  const items = [...(linked.data ?? []), ...(legacy.data ?? [])]
    .sort((a, b) => b.id - a.id).slice(0, 50)
    .map((x) => ({ at: x.at as string, by: (x.name as string) || "", action: x.action as string }));
  return ok({ items });
}
