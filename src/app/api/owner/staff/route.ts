import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { bkkToday } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncJobs } from "@/lib/sync";
import type { Me } from "@/lib/types";

// จัดการรายชื่อพนักงาน (แทนแท็บ Mc Email / Admin Email / Owner Email / เบอร์โทร MC)
//   GET     รายชื่อทั้งหมด + จำนวนคิวตั้งแต่วันนี้
//   POST    เพิ่มคน
//   PATCH   แก้ชื่อ / อีเมล / เบอร์ / ค่าจ้าง / Admin เสริม
//   DELETE  ลบคน (เฉพาะคนที่ไม่เคยมีคิว)

type Role = "mc" | "admin" | "owner";
const ROLES: Role[] = ["mc", "admin", "owner"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TABLE: Record<"mc" | "admin", { table: "mc_slots" | "admin_slots"; col: string }> = {
  mc: { table: "mc_slots", col: "mc_id" },
  admin: { table: "admin_slots", col: "admin_id" },
};

async function requireOwner() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!r.me.owner) return { res: fail("บัญชีนี้ไม่มีสิทธิ์จัดการพนักงาน", 403) };
  return r;
}

async function log(me: Me, action: string) {
  await createAdminClient().from("booking_logs").insert({ email: me.email, role: "Owner", name: me.owner?.name ?? "", action, result: "สำเร็จ" });
}

/** ตรวจ/ทำความสะอาดข้อมูลจากฟอร์ม คืน error เป็นข้อความ */
function clean(role: Role, body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || "name" in body) {
    let name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    if (role === "mc") name = name.replace(/^mc\s*/i, "").trim(); // เก็บชื่อ Mc โดยไม่มีคำว่า "Mc"
    if (!name) return { error: "กรุณาใส่ชื่อ" };
    if (name.length > 60) return { error: "ชื่อยาวเกินไป" };
    out.name = name;
  }
  if (!partial || "email" in body) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return { error: "รูปแบบอีเมลไม่ถูกต้อง" };
    out.email = email || null;
  }
  if (!partial || "phone" in body) out.phone = String(body.phone ?? "").trim().slice(0, 30) || null;
  if (!partial || "hourly_rate" in body) {
    const raw = String(body.hourly_rate ?? "").replace(/[,\s฿]/g, "");
    const rate = raw === "" ? null : Number(raw);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) return { error: "ค่าจ้างต้องเป็นตัวเลข" };
    out.hourly_rate = rate;
  }
  if (role === "admin" && (!partial || "is_extra_admin" in body)) out.is_extra_admin = !!body.is_extra_admin;
  return { data: out };
}

const dupMessage = (msg: string) =>
  /staff_role_email_key/.test(msg) ? "อีเมลนี้มีคนในบทบาทเดียวกันใช้อยู่แล้ว"
    : /staff_role_name_key|duplicate key/.test(msg) ? "ชื่อนี้มีอยู่แล้วในบทบาทเดียวกัน" : msg;

// ---------- GET ----------

export async function GET() {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const db = createAdminClient();
  const { data: staff, error } = await db.from("staff")
    .select("id, role, name, email, phone, hourly_rate, is_extra_admin").order("name");
  if (error) return fail(error.message, 500);

  // จำนวนคิวตั้งแต่วันนี้ (ไม่นับที่ยกเลิก)
  const upcoming = new Map<number, number>();
  const today = bkkToday();
  for (const { table, col } of Object.values(TABLE)) {
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await db.from(table).select(col).not(col, "is", null)
        .gte("live_date", today).eq("is_cancelled", false).range(from, from + 999);
      if (e) return fail(e.message, 500);
      for (const row of (data ?? []) as unknown as Record<string, number>[]) upcoming.set(row[col], (upcoming.get(row[col]) ?? 0) + 1);
      if (!data || data.length < 1000) break;
    }
  }
  return ok({
    staff: (staff ?? []).map((s) => ({ ...s, upcoming: upcoming.get(s.id) ?? 0 })),
    meId: r.me.owner?.id ?? null,
  });
}

// ---------- POST ----------

export async function POST(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const role = body?.role as Role;
  if (!ROLES.includes(role)) return fail("กรุณาเลือกบทบาท");
  const c = clean(role, body, false);
  if (c.error) return fail(c.error);

  const { data, error } = await createAdminClient().from("staff").insert({ role, ...c.data }).select("id").single();
  if (error) return fail(dupMessage(error.message));
  after(() => log(r.me, `เพิ่มพนักงาน ${role} "${c.data!.name}"`));
  return ok({ id: data.id });
}

// ---------- PATCH ----------

export async function PATCH(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return fail("ไม่พบรายชื่อนี้");

  const db = createAdminClient();
  const { data: cur, error: curErr } = await db.from("staff").select("id, role, name, email, phone").eq("id", id).maybeSingle();
  if (curErr) return fail(curErr.message, 500);
  if (!cur) return fail("ไม่พบรายชื่อนี้");
  const role = cur.role as Role;
  const c = clean(role, body, true);
  if (c.error) return fail(c.error);
  const changes = c.data!;
  if (role === "owner" && id === r.me.owner?.id && "email" in changes && changes.email !== cur.email) {
    return fail("เปลี่ยนอีเมลของตัวเองไม่ได้ (จะเข้าหน้าเจ้าของไม่ได้อีก) ให้ Owner คนอื่นเปลี่ยนให้");
  }

  const { error } = await db.from("staff").update(changes).eq("id", id);
  if (error) return fail(dupMessage(error.message));

  // ผลต่อปฏิทิน / ชีต
  if (role !== "owner") {
    const { table, col } = TABLE[role];
    const renamed = "name" in changes && changes.name !== cur.name;
    const contactChanged = ("email" in changes && changes.email !== cur.email) || ("phone" in changes && changes.phone !== cur.phone);
    if (renamed) {
      // เขียนชื่อใหม่ลงทุกแถวของคนนี้ในชีต (ไม่งั้นแก้ชีตครั้งหน้าจะกลายเป็นคนใหม่ชื่อเดิม)
      const ids = await slotIds(table, col, id, false);
      for (let i = 0; i < ids.length; i += 500) {
        await db.from("sheet_jobs").insert(ids.slice(i, i + 500).map((slot_id) => ({ slot_table: table, slot_id })));
      }
    }
    if (renamed || contactChanged) {
      // ลง/ย้าย event ปฏิทินของคิวข้างหน้า (และอัปเดตหมายเหตุชื่อ/เบอร์ในปฏิทินของคู่ไลฟ์)
      const ids = await slotIds(table, col, id, true);
      if (ids.length) await db.from("calendar_jobs").insert(ids.map((slot_id) => ({ slot_table: table, slot_id })));
    }
    if (renamed || contactChanged) after(() => processSyncJobs().then(() => undefined));
  }
  after(() => log(r.me, `แก้พนักงาน ${role} "${cur.name}": ${Object.keys(changes).join(", ")}`));
  return ok({ message: "บันทึกแล้ว" });
}

/** slot ทั้งหมดของคนนี้ (upcomingOnly = เฉพาะตั้งแต่วันนี้และไม่ยกเลิก) */
async function slotIds(table: string, col: string, personId: number, upcomingOnly: boolean) {
  const db = createAdminClient();
  const out: number[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select("id").eq(col, personId);
    if (upcomingOnly) q = q.gte("live_date", bkkToday()).eq("is_cancelled", false);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []).map((x) => x.id as number));
    if (!data || data.length < 1000) return out;
  }
}

// ---------- DELETE ----------

export async function DELETE(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return fail("ไม่พบรายชื่อนี้");
  if (id === r.me.owner?.id) return fail("ลบตัวเองไม่ได้");

  const db = createAdminClient();
  const { data: cur } = await db.from("staff").select("role, name").eq("id", id).maybeSingle();
  if (!cur) return fail("ไม่พบรายชื่อนี้");
  const { error } = await db.from("staff").delete().eq("id", id);
  if (error) {
    return fail(error.code === "23503"
      ? "คนนี้มีประวัติคิวอยู่ ลบไม่ได้ ถ้าไม่ให้เข้าระบบแล้ว ให้ลบอีเมลออกแทน"
      : error.message);
  }
  after(() => log(r.me, `ลบพนักงาน ${cur.role} "${cur.name}"`));
  return ok({ message: "ลบแล้ว" });
}
