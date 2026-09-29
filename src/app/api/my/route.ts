import { fail, monthRange, ok, requireMe } from "@/lib/api";
import { getSettings, mySlots } from "@/lib/data";

// "ตารางของฉัน" รายเดือน (?role=mc|admin&month=YYYY-MM) — แทน action "mySlots" / "adminMySlots"
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const params = new URL(request.url).searchParams;
  const role = params.get("role");
  const { key, first, last } = monthRange(params.get("month"));

  const person = role === "mc" ? r.me.mc : role === "admin" ? r.me.admin : null;
  if (!person) return fail("บัญชีนี้ไม่มีสิทธิ์ดูตารางนี้", 403);

  const [settings, items] = await Promise.all([getSettings(), mySlots(role as "mc" | "admin", person.id, first, last)]);
  return ok({
    month: key,
    cancelMinHours: Number(settings.cancel_min_hours),
    adminChatUrl: settings.admin_chat_url,
    canCancel: role === "mc" || !!r.me.admin?.isExtra,
    items,
  });
}
