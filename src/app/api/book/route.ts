import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { processSyncJobs } from "@/lib/sync";
import { bookingRange, getSettings, personPeriod, writeLogs } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import { rangeText } from "@/lib/window";
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

  if (role === "mc") {
    if (!r.me.mc) return fail("บัญชีนี้ไม่มีสิทธิ์จองคิว Mc", 403);
  } else if (role === "admin") {
    if (!r.me.admin) return fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้า Admin", 403);
    if (!r.me.admin.isExtra) return fail("รับคิวผ่านเว็บได้เฉพาะ Admin เสริม", 403);
  } else {
    return fail("ไม่รู้จักบทบาทนี้");
  }

  const db = createAdminClient();
  const table = role === "mc" ? "mc_slots" : "admin_slots";

  // ช่วงเปิดจองของคนนี้ (เจ้าของตั้งไว้) slot นอกช่วงไม่ส่งไปจอง (กันหน้าเว็บที่ยังไม่รีเฟรช)
  // ส่วนวันที่ผ่านไปแล้ว / เดือนที่เปิดจอง ฐานข้อมูลตรวจอีกชั้นอยู่แล้ว
  let blocked: ActionResult[] = [];
  const personId: number = role === "mc" ? r.me.mc!.id : r.me.admin!.id;
  if (personPeriod(settings, role, personId).mode !== "off") {
    const range = bookingRange(settings, role, personId);
    const { data, error } = await db.from(table).select("id, live_date").in("id", ids);
    if (error) return fail("เกิดข้อผิดพลาด: " + error.message, 500);
    const message = range.empty ? "ตอนนี้ยังไม่เปิดจอง" : `ตอนนี้เปิดจองเฉพาะ ${rangeText(range)}`;
    blocked = (data ?? [])
      .filter((s) => range.empty || s.live_date < range.from || (range.to !== null && s.live_date > range.to))
      .map((s) => ({ id: Number(s.id), success: false, message }));
  }
  const allowed = ids.filter((id) => !blocked.some((b) => b.id === id));

  let results: ActionResult[] = [];
  if (allowed.length) {
    const { data, error } = role === "mc"
      ? await db.rpc("book_mc_slots", { p_mc_id: r.me.mc!.id, p_slot_ids: allowed })
      : await db.rpc("assign_admin_slots", { p_admin_id: r.me.admin!.id, p_slot_ids: allowed });
    if (error) return fail("เกิดข้อผิดพลาด: " + error.message, 500);
    results = data;
  }
  results = [...results, ...blocked];
  const log = role === "mc"
    ? { role: "Mc", name: `Mc ${r.me.mc!.name}`, action: "จองคิว", slot_table: table }
    : { role: "Admin", name: r.me.admin!.name, action: "รับคิว Admin", slot_table: table };

  after(async () => {
    await writeLogs(results.map((x) => ({
      email: r.me.email, ...log, slot_id: x.id, result: x.success ? "สำเร็จ" : x.message,
    })));
    if (results.some((x) => x.success)) await processSyncJobs();
  });
  return ok({ results });
}
