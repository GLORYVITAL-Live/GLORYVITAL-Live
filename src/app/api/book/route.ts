import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { processSyncJobs } from "@/lib/sync";
import { getSettings, writeLogs } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

// Mc จองคิว / Admin เสริมรับคิว — แทน action "book" / "adminAssign"
// ชื่อคนที่จองมาจากบัญชีที่ login เท่านั้น หน้าเว็บส่งชื่อมาเองไม่ได้
export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const role = body?.role;
  const raw: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

  const settings = await getSettings();
  if (!ids.length) return fail("ยังไม่ได้เลือก slot");
  if (ids.length > settings.max_per_request) return fail(`เลือกได้ไม่เกิน ${settings.max_per_request} slot ต่อครั้ง`);

  const db = createAdminClient();
  let results: ActionResult[];
  let log: { role: string; name: string; action: string; slot_table: string };

  if (role === "mc") {
    if (!r.me.mc) return fail("บัญชีนี้ไม่มีสิทธิ์จองคิว Mc", 403);
    const { data, error } = await db.rpc("book_mc_slots", { p_mc_id: r.me.mc.id, p_slot_ids: ids });
    if (error) return fail("เกิดข้อผิดพลาด: " + error.message, 500);
    results = data;
    log = { role: "Mc", name: `Mc ${r.me.mc.name}`, action: "จองคิว", slot_table: "mc_slots" };
  } else if (role === "admin") {
    if (!r.me.admin) return fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้า Admin", 403);
    if (!r.me.admin.isExtra) return fail("รับคิวผ่านเว็บได้เฉพาะ Admin เสริม", 403);
    const { data, error } = await db.rpc("assign_admin_slots", { p_admin_id: r.me.admin.id, p_slot_ids: ids });
    if (error) return fail("เกิดข้อผิดพลาด: " + error.message, 500);
    results = data;
    log = { role: "Admin", name: r.me.admin.name, action: "รับคิว Admin", slot_table: "admin_slots" };
  } else {
    return fail("ไม่รู้จักบทบาทนี้");
  }

  after(async () => {
    await writeLogs(results.map((x) => ({
      email: r.me.email, ...log, slot_id: x.id, result: x.success ? "สำเร็จ" : x.message,
    })));
    if (results.some((x) => x.success)) await processSyncJobs();
  });
  return ok({ results });
}
