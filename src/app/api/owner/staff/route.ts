import { after } from "next/server";
import { fail, ok, requireOwner as requireOwnerScope } from "@/lib/api";
import { bkkToday } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncJobs } from "@/lib/sync";
import type { Me } from "@/lib/types";

// จัดการรายชื่อพนักงาน (แทนแท็บ Mc Email / Admin Email / Owner Email / เบอร์โทร MC)
//   GET     รายชื่อทั้งหมด + จำนวนคิวตั้งแต่วันนี้
//   POST    เพิ่มคน
//   PATCH   แก้ชื่อ / อีเมล / เบอร์ / ค่าจ้าง / Commit / Admin เสริม / สิทธิ์ Owner
//   DELETE  ลบคน (เฉพาะคนที่ไม่เคยมีคิว)
// สิทธิ์: Owner ที่ติ๊ก Mc จัดการรายชื่อ Mc ได้ / ติ๊ก Admin จัดการรายชื่อ Admin ได้
//         รายชื่อและสิทธิ์ของ Owner จัดการได้เฉพาะ Owner ที่ติ๊กทั้งคู่ (แก้สิทธิ์ตัวเองไม่ได้)

type Role = "mc" | "admin" | "owner";
const ROLES: Role[] = ["mc", "admin", "owner"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TABLE: Record<"mc" | "admin", { table: "mc_slots" | "admin_slots"; col: string }> = {
  mc: { table: "mc_slots", col: "mc_id" },
  admin: { table: "admin_slots", col: "admin_id" },
};
const ROLE_LABEL: Record<Role, string> = { mc: "Mc", admin: "Admin", owner: "Owner" };

const requireOwner = () => requireOwnerScope("บัญชีนี้ไม่มีสิทธิ์จัดการพนักงาน");
type Scope = { mc: boolean; admin: boolean; full: boolean };
const canRole = (scope: Scope, role: Role) => (role === "owner" ? scope.full : scope[role]);
const noRole = (role: Role) =>
  fail(role === "owner" ? "จัดการรายชื่อ Owner ได้เฉพาะ Owner ที่มีสิทธิ์ทั้ง Mc และ Admin" : `บัญชีนี้ไม่มีสิทธิ์จัดการรายชื่อ ${ROLE_LABEL[role]}`, 403);

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
  // Commit แบบเทียร์: [{ hours, rate }] จองถึงเทียร์ไหน ทุกชั่วโมงของเดือนคิดราคาเทียร์นั้น (แถวที่ว่างทั้งคู่ถูกข้าม)
  if (role !== "owner" && (!partial || "commit_tiers" in body)) {
    const raw: unknown[] = Array.isArray(body.commit_tiers) ? body.commit_tiers : [];
    const num = (v: unknown) => {
      const s = String(v ?? "").replace(/[,\s฿]/g, "");
      return s === "" ? null : Number(s);
    };
    const tiers: { hours: number; rate: number }[] = [];
    for (const t of raw.slice(0, 10) as { hours?: unknown; rate?: unknown }[]) {
      const hours = num(t?.hours), rate = num(t?.rate);
      if (hours === null && rate === null) continue;
      if (hours === null || rate === null) return { error: "Commit แต่ละขั้นต้องกรอกทั้งจำนวนชั่วโมงและค่าจ้าง" };
      if (!Number.isFinite(hours) || hours <= 0) return { error: "ชั่วโมง Commit ต้องเป็นตัวเลขมากกว่า 0 (ใส่แค่ชั่วโมงขั้นต่ำ เช่น 10 ไม่ใช่ 10-20)" };
      if (!Number.isFinite(rate) || rate <= 0) return { error: "ค่าจ้าง Commit ต้องเป็นตัวเลขมากกว่า 0" };
      tiers.push({ hours, rate });
    }
    tiers.sort((a, b) => a.hours - b.hours);
    if (tiers.some((t, i) => i > 0 && t.hours === tiers[i - 1].hours)) return { error: "Commit มีชั่วโมงขั้นต่ำซ้ำกัน" };
    out.commit_tiers = tiers;
  }
  if (role === "admin" && (!partial || "is_extra_admin" in body)) out.is_extra_admin = !!body.is_extra_admin;
  if (role === "owner") {
    if (!partial || "can_manage_mc" in body) out.can_manage_mc = body.can_manage_mc !== false;
    if (!partial || "can_manage_admin" in body) out.can_manage_admin = body.can_manage_admin !== false;
  }
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
  const { data: rows, error } = await db.from("staff")
    .select("id, role, name, email, phone, hourly_rate, commit_tiers, is_extra_admin, can_manage_mc, can_manage_admin").order("name");
  if (error) return fail(error.message, 500);
  const staff = (rows ?? []).filter((s) => canRole(r.scope, s.role as Role) || s.id === r.me.owner?.id);

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
  if (!canRole(r.scope, role)) return noRole(role);
  const c = clean(role, body, false);
  if (role === "owner" && !c.data?.can_manage_mc && !c.data?.can_manage_admin) return fail("ติ๊กสิทธิ์อย่างน้อย 1 ฝั่ง (Mc หรือ Admin)");
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
  const { data: cur, error: curErr } = await db.from("staff")
    .select("id, role, name, email, phone, can_manage_mc, can_manage_admin").eq("id", id).maybeSingle();
  if (curErr) return fail(curErr.message, 500);
  if (!cur) return fail("ไม่พบรายชื่อนี้");
  const role = cur.role as Role;
  const isMe = role === "owner" && id === r.me.owner?.id;
  if (!canRole(r.scope, role) && !isMe) return noRole(role);
  const c = clean(role, body, true);
  if (c.error) return fail(c.error);
  const changes = c.data!;
  if (isMe && "email" in changes && changes.email !== cur.email) {
    return fail("เปลี่ยนอีเมลของตัวเองไม่ได้ (จะเข้าหน้าเจ้าของไม่ได้อีก) ให้ Owner คนอื่นเปลี่ยนให้");
  }
  if (role === "owner") {
    const scopeChanged = ("can_manage_mc" in changes && changes.can_manage_mc !== cur.can_manage_mc)
      || ("can_manage_admin" in changes && changes.can_manage_admin !== cur.can_manage_admin);
    if (scopeChanged && isMe) return fail("แก้สิทธิ์ของตัวเองไม่ได้ ให้ Owner คนอื่นที่มีสิทธิ์ทั้ง Mc และ Admin แก้ให้");
    if (scopeChanged && !r.scope.full) return noRole("owner");
    const mc = "can_manage_mc" in changes ? changes.can_manage_mc : cur.can_manage_mc;
    const admin = "can_manage_admin" in changes ? changes.can_manage_admin : cur.can_manage_admin;
    if (!mc && !admin) return fail("ติ๊กสิทธิ์อย่างน้อย 1 ฝั่ง (Mc หรือ Admin)");
    if (isMe) { delete changes.can_manage_mc; delete changes.can_manage_admin; }
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
  if (!canRole(r.scope, cur.role as Role)) return noRole(cur.role as Role);
  const { error } = await db.from("staff").delete().eq("id", id);
  if (error) {
    return fail(error.code === "23503"
      ? "คนนี้มีประวัติคิวอยู่ ลบไม่ได้ ถ้าไม่ให้เข้าระบบแล้ว ให้ลบอีเมลออกแทน"
      : error.message);
  }
  after(() => log(r.me, `ลบพนักงาน ${cur.role} "${cur.name}"`));
  return ok({ message: "ลบแล้ว" });
}
