import { fail, ok, requireOwner } from "@/lib/api";
import { bkkToday, bookWindow, cutoffDate, getSettings } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import { cleanWindow, rangeText } from "@/lib/window";

// ช่วงเปิดจอง (หน้าเจ้าของ > จัดการ slot)
//   GET  ช่วงเปิดจองของฝั่งที่มีสิทธิ์ + เดือนสุดท้ายที่เปิดจอง
//   PUT  { role, window }  ตั้งช่วงของฝั่งนั้น (Owner ที่มีสิทธิ์ฝั่งนั้น) window = null คือไม่จำกัดเพิ่ม
//        { cutoffMonth }   เดือนสุดท้ายที่เปิดจอง "YYYY-MM" / "" = ไม่จำกัด (ใช้ทั้งสองฝั่ง ต้องมีสิทธิ์ทั้ง Mc และ Admin)

export async function GET() {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const s = await getSettings();
  return ok({
    today: bkkToday(),
    cutoffMonth: s.schedule_cutoff_month ?? "",
    cutoffDate: cutoffDate(s),
    canCutoff: r.scope.full,
    mc: r.scope.mc ? bookWindow(s, "mc") : undefined,
    admin: r.scope.admin ? bookWindow(s, "admin") : undefined,
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

  const role = body?.role as "mc" | "admin";
  if (role !== "mc" && role !== "admin") return fail("ไม่รู้จักบทบาทนี้");
  const label = role === "mc" ? "Mc" : "Admin";
  if (!r.scope[role]) return fail(`บัญชีนี้ไม่มีสิทธิ์ตั้งช่วงเปิดจองของฝั่ง ${label}`, 403);
  if (body.window != null && !cleanWindow(body.window)) return fail("กรุณาใส่วันที่อย่างน้อยหนึ่งช่อง");
  const w = cleanWindow(body.window);
  if (w?.mode === "range" && w.from && w.to && w.from > w.to) return fail("วันเริ่มต้องไม่เกินวันสุดท้าย");

  const { error } = await db.from("settings").update({ [`book_window_${role}`]: w }).eq("id", 1);
  if (error) return fail(error.message, 500);
  const what = !w ? "ไม่จำกัด" : w.mode === "week" ? "สัปดาห์นี้ (อัตโนมัติ)"
    : w.from ? rangeText({ from: w.from, to: w.to }) : `ถึง ${rangeText({ from: w.to!, to: w.to })}`;
  await writeLog(`ตั้งช่วงเปิดจอง ${label}: ${what}`);
  return ok({ message: "บันทึกแล้ว" });
}
