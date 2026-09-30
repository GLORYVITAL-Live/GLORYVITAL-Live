import { fail, monthRange, ok, requireMe } from "@/lib/api";
import { getSettings, mySlots } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";

// "ตารางของฉัน" รายเดือน (?role=mc|admin&month=YYYY-MM) — แทน action "mySlots" / "adminMySlots"
// + โปรไฟล์ของตัวเอง และค่าจ้างต่อชั่วโมง (ของคนนี้ ไม่ตั้ง = ค่าเริ่มต้นใน settings เหมือนหน้าสรุปของเจ้าของ)
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const params = new URL(request.url).searchParams;
  const role = params.get("role");
  const { key, first, last } = monthRange(params.get("month"));

  const person = role === "mc" ? r.me.mc : role === "admin" ? r.me.admin : null;
  if (!person) return fail("บัญชีนี้ไม่มีสิทธิ์ดูตารางนี้", 403);

  const [settings, items, staff] = await Promise.all([
    getSettings(),
    mySlots(role as "mc" | "admin", person.id, first, last),
    createAdminClient().from("staff").select("name, email, phone, hourly_rate").eq("id", person.id).single(),
  ]);
  if (staff.error) return fail(staff.error.message, 500);
  const defaultRate = Number(role === "mc" ? settings.default_mc_rate : settings.default_admin_rate) || 0;

  return ok({
    month: key,
    cancelMinHours: Number(settings.cancel_min_hours),
    adminChatUrl: settings.admin_chat_url,
    canCancel: role === "mc" || !!r.me.admin?.isExtra,
    items,
    profile: {
      name: role === "mc" ? `Mc ${staff.data.name}` : staff.data.name,
      email: staff.data.email ?? r.me.email,
      phone: staff.data.phone ?? "",
      rate: Number(staff.data.hourly_rate) || defaultRate,
    },
  });
}
