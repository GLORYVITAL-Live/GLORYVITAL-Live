import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { processSyncJobs } from "@/lib/sync";
import { getSettings, writeLogs } from "@/lib/data";
import { notifyCancel } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/server";

// ยกเลิกคิวของตัวเอง ก่อนเวลาไลฟ์อย่างน้อย cancel_min_hours — แทน action "cancel" / "adminCancel"
export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return fail("ข้อมูล slot ไม่ถูกต้อง");

  let table: "mc_slots" | "admin_slots";
  let personId: number;
  let log: { role: string; name: string; action: string };
  let who: string; // ชื่อในรายชื่อ (ใช้ในอีเมลแจ้งเตือน)
  if (body?.role === "mc") {
    if (!r.me.mc) return fail("บัญชีนี้ไม่ใช่ Mc", 403);
    table = "mc_slots";
    personId = r.me.mc.id;
    who = r.me.mc.name;
    log = { role: "Mc", name: `Mc ${r.me.mc.name}`, action: "ยกเลิกคิว" };
  } else if (body?.role === "admin") {
    if (!r.me.admin) return fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้า Admin", 403);
    if (!r.me.admin.isExtra) return fail("Admin ประจำยกเลิกคิวผ่านเว็บไม่ได้ กรุณาติดต่อทีมงาน", 403);
    table = "admin_slots";
    personId = r.me.admin.id;
    who = r.me.admin.name;
    log = { role: "Admin", name: r.me.admin.name, action: "ยกเลิกคิว Admin" };
  } else {
    return fail("ไม่รู้จักบทบาทนี้");
  }

  const { data, error } = await createAdminClient().rpc("cancel_slot", { p_table: table, p_person_id: personId, p_slot_id: id });
  if (error) return fail("เกิดข้อผิดพลาด: " + error.message, 500);
  const res = data as { ok: boolean; message: string };

  const at = new Date();
  after(async () => {
    await writeLogs([{ email: r.me.email, ...log, slot_table: table, slot_id: id, result: res.ok ? "สำเร็จ" : res.message }]);
    if (!res.ok) return;
    // แจ้งเตือนทางอีเมล (kunraroj.d@glorythailand.com) — ส่งไม่ได้ก็ไม่กระทบการยกเลิก
    await Promise.all([
      processSyncJobs(),
      notifyCancel({ role: table === "mc_slots" ? "mc" : "admin", name: who, email: r.me.email, slotId: id, at }),
    ]);
  });
  if (!res.ok) return fail(res.message);
  const settings = await getSettings();
  return ok({ message: res.message, adminChatUrl: settings.admin_chat_url });
}
