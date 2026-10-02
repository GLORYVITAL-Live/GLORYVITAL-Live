import { fail, ok, requireOwner } from "@/lib/api";
import { bkkToday, bookWindow, cutoffDate, getSettings } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import { cleanWindow, isDate, rangeText } from "@/lib/window";

// ช่วงเปิดจอง (หน้าเจ้าของ > จัดการ slot)
//   GET  ช่วงเปิดจองของฝั่งที่มีสิทธิ์ + รายชื่อคนที่เลือกให้จองก่อนได้ + เดือนสุดท้ายที่เปิดจอง
//   PUT  { role, window }  ตั้งช่วง / รายชื่อจองก่อน ของฝั่งนั้น (Owner ที่มีสิทธิ์ฝั่งนั้น) window = null คือไม่จำกัด
//        { cutoffMonth }   เดือนสุดท้ายที่เปิดจอง "YYYY-MM" / "" = ไม่จำกัด (ใช้ทั้งสองฝั่ง ต้องมีสิทธิ์ทั้ง Mc และ Admin)

type Role = "mc" | "admin";

/** คนที่จองผ่านเว็บได้ของฝั่งนั้น (Admin = เฉพาะ Admin เสริม) */
async function people(role: Role) {
  let q = createAdminClient().from("staff").select("id, name").eq("role", role);
  if (role === "admin") q = q.eq("is_extra_admin", true);
  const { data, error } = await q.order("name");
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: Number(p.id), name: String(p.name) }));
}

export async function GET() {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const s = await getSettings();
  const [mcPeople, adminPeople] = await Promise.all([
    r.scope.mc ? people("mc") : [],
    r.scope.admin ? people("admin") : [],
  ]);
  return ok({
    today: bkkToday(),
    cutoffMonth: s.schedule_cutoff_month ?? "",
    cutoffDate: cutoffDate(s),
    canCutoff: r.scope.full,
    mc: r.scope.mc ? bookWindow(s, "mc") : undefined,
    admin: r.scope.admin ? bookWindow(s, "admin") : undefined,
    people: { mc: mcPeople, admin: adminPeople },
  });
}

export async function PUT(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ตั้งช่วงเปิดจอง");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const db = createAdminClient();
  const writeLog = (action: string) => db.from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name ?? "", action, result: "สำเร็จ",
  });

  if (body && "cutoffMonth" in body) {
    if (!r.scope.full) return fail("เดือนสุดท้ายที่เปิดจองใช้ทั้งสองฝั่ง ต้องมีสิทธิ์ทั้ง Mc และ Admin", 403);
    const month = String(body.cutoffMonth ?? "").trim();
    if (month && !/^\d{4}-\d{2}$/.test(month)) return fail("รูปแบบเดือนไม่ถูกต้อง");
    const { error } = await db.from("settings").update({ schedule_cutoff_month: month || null }).eq("id", 1);
    if (error) return fail(error.message, 500);
    await writeLog(`ตั้งเดือนสุดท้ายที่เปิดจอง: ${month || "ไม่จำกัด"}`);
    return ok({ message: "บันทึกแล้ว" });
  }

  const role = body?.role as Role;
  if (role !== "mc" && role !== "admin") return fail("ไม่รู้จักบทบาทนี้");
  const label = role === "mc" ? "Mc" : "Admin";
  if (!r.scope[role]) return fail(`บัญชีนี้ไม่มีสิทธิ์ตั้งช่วงเปิดจองของฝั่ง ${label}`, 403);
  const raw = body.window;
  if (raw?.mode === "range" && !isDate(raw.from) && !isDate(raw.to)) return fail("กรุณาใส่วันที่อย่างน้อยหนึ่งช่อง");
  const w = cleanWindow(raw);
  if (w && w.mode === "range" && w.from && w.to && w.from > w.to) return fail("วันเริ่มต้องไม่เกินวันสุดท้าย");

  // รายชื่อจองก่อน: เก็บเฉพาะคนที่มีอยู่จริงในฝั่งนั้น
  let names: string[] = [];
  if (w?.only.length) {
    const list = await people(role);
    const valid = w.only.filter((id) => list.some((p) => p.id === id));
    if (!valid.length) return fail("ไม่พบรายชื่อที่เลือก ลองรีเฟรชหน้าแล้วเลือกใหม่");
    w.only = valid;
    names = valid.map((id) => list.find((p) => p.id === id)!.name);
  }

  const { error } = await db.from("settings").update({ [`book_window_${role}`]: w }).eq("id", 1);
  if (error) return fail(error.message, 500);
  const when = !w || w.mode === "off" ? "ไม่จำกัดวัน" : w.mode === "week" ? "สัปดาห์นี้ (อัตโนมัติ)"
    : w.from ? rangeText({ from: w.from, to: w.to }) : `ถึง ${rangeText({ from: w.to!, to: w.to })}`;
  await writeLog(`ตั้งช่วงเปิดจอง ${label}: ${when}${names.length ? ` · จองก่อน: ${names.join(", ")}` : ""}`);
  return ok({ message: "บันทึกแล้ว" });
}
