import { fail, ok, requireMe, requireOwner } from "@/lib/api";
import { getSettings } from "@/lib/data";
import { defaultRules, splitRules } from "@/lib/rules";
import { createAdminClient } from "@/lib/supabase/server";

// กฎการทำงาน ส่วน "อื่นๆ" (?role=mc | admin)
//   GET  ทุกคนที่ login แล้ว: รายการข้อ (ยังไม่เคยแก้ = ข้อความเริ่มต้น)
//   PUT  Owner ที่มีสิทธิ์ฝั่งนั้น: { role, text } หนึ่งบรรทัด = หนึ่งข้อ / ว่าง = กลับไปใช้ข้อความเริ่มต้น

type RuleRole = "mc" | "admin";
const MAX_LEN = 4000;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const role = new URL(request.url).searchParams.get("role");
  if (role !== "mc" && role !== "admin") return fail("ไม่รู้จักบทบาทนี้");
  const s = await getSettings();
  const saved = splitRules(role === "mc" ? s.rules_mc : s.rules_admin);
  return ok({
    role,
    items: saved.length ? saved : defaultRules(role, Number(s.cancel_min_hours) || 6),
    custom: saved.length > 0,
    defaults: defaultRules(role, Number(s.cancel_min_hours) || 6),
  });
}

export async function PUT(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์แก้กฎการทำงาน");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const role = body?.role as RuleRole;
  if (role !== "mc" && role !== "admin") return fail("ไม่รู้จักบทบาทนี้");
  if (!r.scope[role]) return fail(`บัญชีนี้ไม่มีสิทธิ์แก้กฎของฝั่ง ${role === "mc" ? "Mc" : "Admin"}`, 403);
  const items = splitRules(typeof body?.text === "string" ? body.text : "");
  const text = items.join("\n");
  if (text.length > MAX_LEN) return fail(`ข้อความยาวเกินไป (ไม่เกิน ${MAX_LEN} ตัวอักษร)`);

  const { error } = await createAdminClient().from("settings")
    .update({ [role === "mc" ? "rules_mc" : "rules_admin"]: text || null }).eq("id", 1);
  if (error) return fail(error.message, 500);
  await createAdminClient().from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name ?? "",
    action: `แก้กฎการทำงาน ${role === "mc" ? "Mc" : "Admin"}${text ? "" : " (คืนค่าเริ่มต้น)"}`, result: "สำเร็จ",
  });
  return ok({ message: text ? "บันทึกแล้ว" : "กลับไปใช้ข้อความเริ่มต้นแล้ว" });
}
