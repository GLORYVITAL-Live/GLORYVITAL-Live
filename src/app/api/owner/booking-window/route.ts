import { after } from "next/server";
import { fail, ok, requireOwner } from "@/lib/api";
import { notifyWindowOpened } from "@/lib/notifications";
import { bkkToday, bookWindow, bookingLimits, cutoffDate, getSettings, type BookSide } from "@/lib/data";
import { quotaOn } from "@/lib/mc-quota-db";
import { shopeeCrew, tiktokOnly, withLiveTeam } from "@/lib/live-team";
import { createAdminClient } from "@/lib/supabase/server";
import { cleanWindow, isDate, rangeText, type Period } from "@/lib/window";

// ช่วงเปิดจอง (หน้าเจ้าของ > จัดการ slot)
//   GET  ช่วงเปิดจองของฝั่งที่มีสิทธิ์ + รายชื่อคนที่เลือกให้จองก่อนได้ + เดือนสุดท้ายที่เปิดจอง
//        + gates = ข้อจำกัดการจองอื่นที่เปิดอยู่ (สิทธิ์จอง Mc ต่อเดือน · บังคับดูคลิปเทรนนิ่ง) แสดงใต้ช่วงเปิดจอง
//        + หน้าจองคิว Shopee (ฝั่ง Mc): ช่วงเปิดจอง + โควต้าต่อวันของ Shopee
//   PUT  { role, window }  ตั้งช่วง / รายชื่อจองก่อน ของฝั่งนั้น (mc / admin / shopee — Owner ที่มีสิทธิ์ฝั่งนั้น) window = null คือไม่จำกัด
//        { shopeeLimits: { slots, hours } }  โควต้าต่อวันของคิว Shopee (Owner ที่จัดการ Mc ได้)
//        { cutoffMonth }   เดือนสุดท้ายที่เปิดจอง "YYYY-MM" / "" = ไม่จำกัด (ใช้ทุกฝั่ง ต้องมีสิทธิ์ทั้ง Mc และ Admin)

const LABEL: Record<BookSide, string> = { mc: "Mc", admin: "Admin", shopee: "Mc Shopee" };

/** คนที่จองผ่านเว็บได้ของฝั่งนั้น (Admin = เฉพาะ Admin เสริม · Mc ตามทีมไลฟ์ของคิว TikTok / Shopee) */
async function people(side: BookSide) {
  type Row = { id: number; name: string; live_platform?: string | null };
  const role = side === "admin" ? "admin" : "mc";
  const { data, error } = await withLiveTeam((extra) => {
    let q = createAdminClient().from("staff").select(`id, name${extra}`).eq("role", role);
    if (role === "admin") q = q.eq("is_extra_admin", true);
    return q.order("name").overrideTypes<Row[], { merge: false }>();
  });
  if (error) throw error;
  return (side === "shopee" ? shopeeCrew(data ?? []) : tiktokOnly(data ?? [])).map((p) => ({ id: Number(p.id), name: String(p.name) }));
}

export async function GET() {
  const r = await requireOwner(undefined, "read");
  if ("res" in r) return r.res;
  const s = await getSettings();
  const [mcPeople, adminPeople, shopeePeople] = await Promise.all([
    r.scope.mc ? people("mc") : [],
    r.scope.admin ? people("admin") : [],
    r.scope.mc ? people("shopee") : [],
  ]);
  const limits = bookingLimits(s, "shopee");
  return ok({
    today: bkkToday(),
    cutoffMonth: s.schedule_cutoff_month ?? "",
    cutoffDate: cutoffDate(s),
    canCutoff: r.scope.full,
    // ฝั่งที่แก้ช่วงเปิดจองได้ (ดูได้อย่างเดียว = เห็นแต่แก้ไม่ได้)
    canEdit: r.scope.edit,
    mc: r.scope.mc ? bookWindow(s, "mc") : undefined,
    admin: r.scope.admin ? bookWindow(s, "admin") : undefined,
    shopee: r.scope.mc ? bookWindow(s, "shopee") : undefined,
    // โควต้าต่อวันของคิว Shopee (ยังไม่ได้รัน SQL 20261114000000_shopee_slots = ไม่มีคอลัมน์ ใช้ค่าเริ่มต้น)
    shopeeLimits: r.scope.mc ? { slots: limits.slotsPerDay, hours: limits.hoursPerDay, ready: s.shopee_max_slots_per_day !== undefined } : undefined,
    people: { mc: mcPeople, admin: adminPeople, shopee: shopeePeople },
    // quota null = ไม่เห็นฝั่ง Mc (สิทธิ์จองมีแค่ Mc)
    gates: { quota: r.scope.mc ? quotaOn(s) : null, training: s.training_required === true },
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
    const before = await getSettings();
    const { error } = await db.from("settings").update({ schedule_cutoff_month: month || null }).eq("id", 1);
    if (error) return fail(error.message, 500);
    await writeLog(`ตั้งเดือนสุดท้ายที่เปิดจอง: ${month || "ไม่จำกัด"}`);
    // เปิดเดือนเพิ่ม → แจ้ง Mc / Admin เสริม / Mc Shopee ที่มี slot ว่างให้จองเพิ่ม
    after(async () => {
      const now = await getSettings();
      for (const side of ["mc", "admin", "shopee"] as const) await notifyWindowOpened(side, before, now, r.me.email);
    });
    return ok({ message: "บันทึกแล้ว" });
  }

  if (body && "shopeeLimits" in body) {
    if (!r.scope.mc) return fail("บัญชีนี้ไม่มีสิทธิ์ตั้งโควต้าของฝั่ง Mc", 403);
    const slots = Number(body.shopeeLimits?.slots), hours = Number(body.shopeeLimits?.hours);
    if (!Number.isInteger(slots) || slots < 1 || slots > 10) return fail("จำนวน slot ต่อวันต้องเป็น 1–10");
    if (!(hours > 0 && hours <= 24) || Math.round(hours * 2) !== hours * 2) return fail("ชั่วโมงต่อวันต้องเป็น 0.5–24 (ทีละครึ่งชั่วโมง)");
    const { error } = await db.from("settings").update({ shopee_max_slots_per_day: slots, shopee_max_hours_per_day: hours }).eq("id", 1);
    if (error) return fail(/shopee_max/.test(error.message) ? "ต้องรัน SQL 20261114000000_shopee_slots ใน Supabase ก่อน" : error.message, 500);
    await writeLog(`ตั้งโควต้าคิว Shopee: ${slots} slot / ${hours} ชม. ต่อวัน`);
    return ok({ message: "บันทึกแล้ว" });
  }

  const role = body?.role as BookSide;
  if (role !== "mc" && role !== "admin" && role !== "shopee") return fail("ไม่รู้จักบทบาทนี้");
  const label = LABEL[role];
  if (!r.scope[role === "admin" ? "admin" : "mc"]) return fail(`บัญชีนี้ไม่มีสิทธิ์ตั้งช่วงเปิดจองของฝั่ง ${label}`, 403);
  const raw = body.window;
  const hasOnly = Array.isArray(raw?.only) && raw.only.length > 0;
  for (const [p, who] of [[raw, "คนทั่วไป"], [hasOnly ? raw?.early : null, "คนที่จองก่อน"]] as const) {
    if (p?.mode === "range" && !isDate(p.from) && !isDate(p.to)) return fail(`ช่วงของ${who}: กรุณาใส่วันที่อย่างน้อยหนึ่งช่อง`);
  }
  const w = cleanWindow(raw);
  for (const [p, who] of [[w, "คนทั่วไป"], [w?.early, "คนที่จองก่อน"]] as const) {
    if (p && p.mode === "range" && p.from && p.to && p.from > p.to) return fail(`ช่วงของ${who}: วันเริ่มต้องไม่เกินวันสุดท้าย`);
  }

  // รายชื่อจองก่อน: เก็บเฉพาะคนที่มีอยู่จริงในฝั่งนั้น
  let names: string[] = [];
  if (w && w.only.length) {
    const list = await people(role);
    const valid = w.only.filter((id) => list.some((p) => p.id === id));
    if (!valid.length) return fail("ไม่พบรายชื่อที่เลือก ลองรีเฟรชหน้าแล้วเลือกใหม่");
    w.only = valid;
    names = valid.map((id) => list.find((p) => p.id === id)!.name);
  }

  const before = await getSettings();
  const { error } = await db.from("settings").update({ [`book_window_${role}`]: w }).eq("id", 1);
  if (error) return fail(error.message, 500);
  // เปิดช่วงจองเพิ่ม → แจ้งคนที่ได้จองวันเพิ่ม และวันนั้นมี slot ว่าง
  after(async () => notifyWindowOpened(role, before, await getSettings(), r.me.email).then(() => undefined));
  const when = (p: Period | null | undefined) =>
    !p || p.mode === "off" ? "ไม่จำกัดวัน" : p.mode === "closed" ? "ปิดจอง" : p.mode === "week" ? "สัปดาห์นี้ (อัตโนมัติ)"
      : p.from ? rangeText({ from: p.from, to: p.to }) : `ถึง ${rangeText({ from: p.to!, to: p.to })}`;
  const early = names.length ? ` · จองก่อน (${names.join(", ")}): ${when(w?.early)}` : "";
  await writeLog(`ตั้งช่วงเปิดจอง ${label}: ${when(w)}${early}`);
  return ok({ message: "บันทึกแล้ว" });
}
