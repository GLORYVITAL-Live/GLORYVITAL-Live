import { after } from "next/server";
import { fail, ok, requireOwner as requireOwnerScope, type Access } from "@/lib/api";
import { VIEW_COL_RE, VIEW_COLS } from "@/lib/auth";
import { bkkToday } from "@/lib/data";
import { parseTierHours } from "@/lib/pay";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncJobs } from "@/lib/sync";
import type { Me } from "@/lib/types";

// จัดการรายชื่อพนักงาน (แทนแท็บ Mc Email / Admin Email / Owner Email / เบอร์โทร MC)
//   GET     รายชื่อทั้งหมด + จำนวนคิวตั้งแต่วันนี้
//   POST    เพิ่มคน
//   PATCH   แก้ชื่อ / อีเมล / เบอร์ / ค่าจ้าง / Commit / Admin เสริม / Mc ประจำ / สิทธิ์ Owner (Mc / Admin / หลักฐานไลฟ์ / Data analytics / Plan Slot Live)
//           / รับอีเมลแจ้งยกเลิกคิว (Owner)
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

const requireOwner = (access: Access = "write") => requireOwnerScope("บัญชีนี้ไม่มีสิทธิ์จัดการพนักงาน", access);
/** สิทธิ์ "ดูได้อย่างเดียว" ของ Owner (บันทึกเฉพาะตอนส่งมา ยังไม่ได้รัน SQL = ไม่แตะ) */
const VIEW_FIELDS = ["can_view_mc", "can_view_admin", "can_view_proofs", "can_view_plan", "analytics_readonly"] as const;
/** รับอีเมลแจ้งเมื่อ Mc / Admin เสริมกดยกเลิกคิว (SQL 20261020000000_notify_cancel) — ไม่ใช่สิทธิ์ ตั้งให้ตัวเองได้ */
const NOTIFY_FIELDS = ["notify_cancel_mc", "notify_cancel_admin"] as const;
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
      // ชั่วโมงพิมพ์เป็นช่วงได้ เช่น "10-20" / "10ถึง20" ใช้เลขตัวแรกเป็นจุดเริ่มของขั้น
      const hoursText = String(t?.hours ?? "").trim();
      const hours = hoursText ? parseTierHours(hoursText) ?? NaN : null;
      const rate = num(t?.rate);
      if (hours === null && rate === null) continue;
      if (hours === null || rate === null) return { error: "Commit แต่ละขั้นต้องกรอกทั้งจำนวนชั่วโมงและค่าจ้าง" };
      if (!Number.isFinite(hours) || hours <= 0) return { error: "ชั่วโมง Commit ต้องมีตัวเลขมากกว่า 0 เช่น 10 หรือ 10-20" };
      if (!Number.isFinite(rate) || rate <= 0) return { error: "ค่าจ้าง Commit ต้องเป็นตัวเลขมากกว่า 0" };
      tiers.push({ hours, rate });
    }
    tiers.sort((a, b) => a.hours - b.hours);
    if (tiers.some((t, i) => i > 0 && t.hours === tiers[i - 1].hours)) return { error: "Commit มีชั่วโมงขั้นต่ำซ้ำกัน" };
    out.commit_tiers = tiers;
  }
  if (role === "admin" && (!partial || "is_extra_admin" in body)) out.is_extra_admin = !!body.is_extra_admin;
  // Mc ประจำ / Admin ประจำ (เงินเดือน) = ไม่คิดค่าจ้างรายชั่วโมง (Mc ประจำ ไม่ต้องแนบหลักฐานไลฟ์ด้วย)
  if (role !== "owner" && (!partial || "is_salaried" in body)) out.is_salaried = !!body.is_salaried;
  if (role === "owner") {
    if (!partial || "can_manage_mc" in body) out.can_manage_mc = body.can_manage_mc !== false;
    if (!partial || "can_manage_admin" in body) out.can_manage_admin = body.can_manage_admin !== false;
    // จัดการหลักฐานไลฟ์ทุก slot (แนบ / แทนที่ / ลบ) ไม่ติ๊ก = ค่าเริ่มต้นปิด
    if (!partial || "can_manage_proofs" in body) out.can_manage_proofs = body.can_manage_proofs === true;
    // เข้าหน้า Data analytics (สถิติไลฟ์) ไม่ติ๊ก = ค่าเริ่มต้นปิด
    if (!partial || "can_view_analytics" in body) out.can_view_analytics = body.can_view_analytics === true;
    // หน้า Plan Slot Live: บันทึกเฉพาะตอนส่งมา (ยังไม่ได้รัน SQL = ไม่แตะคอลัมน์นี้)
    if ("can_plan_slots" in body) out.can_plan_slots = body.can_plan_slots === true;
    // ดูได้อย่างเดียว (SQL 20261018000000_view_only)
    for (const k of VIEW_FIELDS) if (k in body) out[k] = body[k] === true;
    for (const k of NOTIFY_FIELDS) if (k in body) out[k] = body[k] === true;
  }
  return { data: out };
}

/** มีสิทธิ์อย่างน้อย 1 อย่าง (จัดการได้ หรือ ดูได้) */
const hasAnyPerm = (pick: (k: string) => unknown) =>
  ["can_manage_mc", "can_manage_admin", "can_manage_proofs", "can_view_analytics", "can_plan_slots", "can_view_mc", "can_view_admin", "can_view_proofs", "can_view_plan"]
    .some((k) => pick(k) === true);

/**
 * select + คอลัมน์สิทธิ์ใหม่ (ยังไม่ได้รัน SQL = ไม่มีคอลัมน์นั้น ใช้แบบเดิม)
 *   20261018000000_view_only = สิทธิ์ดูได้อย่างเดียว / 20261017000000_plan_slots = can_plan_slots
 */
async function withPlanCol<T>(run: (extra: string) => PromiseLike<{ data: T; error: { message: string } | null }>) {
  let res = await run(`, can_plan_slots, ${VIEW_COLS}, ${NOTIFY_FIELDS.join(", ")}`);
  if (res.error && /notify_cancel/.test(res.error.message)) res = await run(`, can_plan_slots, ${VIEW_COLS}`);
  if (res.error && VIEW_COL_RE.test(res.error.message)) res = await run(", can_plan_slots");
  return res.error && /can_plan_slots/.test(res.error.message) ? run("") : res;
}
const needViewSql = (msg: string) =>
  /notify_cancel/.test(msg) ? "ต้องรัน SQL 20261020000000_notify_cancel ใน Supabase ก่อน ถึงจะตั้งรับอีเมลแจ้งยกเลิกได้"
    : VIEW_COL_RE.test(msg) ? "ต้องรัน SQL 20261018000000_view_only ใน Supabase ก่อน ถึงจะตั้งสิทธิ์แบบดูได้อย่างเดียวได้" : msg;
const noPlanGrant = () => fail("ติ๊ก / เอาสิทธิ์ Plan Slot Live ออกได้เฉพาะคนที่มีสิทธิ์นี้", 403);

const dupMessage = (msg: string) =>
  /staff_role_email_key/.test(msg) ? "อีเมลนี้มีคนในบทบาทเดียวกันใช้อยู่แล้ว"
    : /staff_role_name_key|duplicate key/.test(msg) ? "ชื่อนี้มีอยู่แล้วในบทบาทเดียวกัน" : msg;

// ---------- GET ----------

export async function GET() {
  // ดูได้อย่างเดียวก็เห็นรายชื่อ (ไม่เห็นค่าจ้าง) / เพิ่ม แก้ ลบ รวม = ต้องจัดการได้
  const r = await requireOwner("read");
  if ("res" in r) return r.res;
  const db = createAdminClient();
  type Row = { id: number; role: string } & Record<string, unknown>;
  const { data: rows, error } = await withPlanCol((extra) => db.from("staff")
    .select(`id, role, name, email, phone, hourly_rate, commit_tiers, is_extra_admin, is_salaried, can_manage_mc, can_manage_admin, can_manage_proofs, can_view_analytics${extra}`)
    .order("name").overrideTypes<Row[], { merge: false }>());
  if (error) return fail(error.message, 500);
  const edit = { mc: r.scope.edit.mc, admin: r.scope.edit.admin, owner: r.scope.full };
  const staff = (rows ?? [])
    .filter((s) => canRole(r.scope, s.role as Role) || s.id === r.me.owner?.id)
    // ฝั่งที่ดูได้อย่างเดียว: ไม่ส่งค่าจ้าง / Commit
    .map((s) => (s.role !== "owner" && !edit[s.role as "mc" | "admin"] ? { ...s, hourly_rate: null, commit_tiers: null } : s));

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
    // บทบาทที่แก้รายชื่อได้ (ดูได้อย่างเดียว = false)
    canEdit: edit,
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
  if (c.error) return fail(c.error);
  if (role === "owner" && !hasAnyPerm((k) => c.data?.[k])) return fail("ตั้งสิทธิ์อย่างน้อย 1 อย่าง");
  // ให้สิทธิ์ Plan Slot Live (จัดการ / ดู) ได้เฉพาะคนที่มีสิทธิ์นี้
  if ((c.data?.can_plan_slots || c.data?.can_view_plan) && !r.me.owner?.plan) return noPlanGrant();

  const { data, error } = await createAdminClient().from("staff").insert({ role, ...c.data }).select("id").single();
  if (error) return fail(needViewSql(dupMessage(error.message)));
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
  type Cur = {
    id: number; role: string; name: string; email: string | null; phone: string | null; can_manage_mc: boolean;
    can_manage_admin: boolean; can_manage_proofs: boolean; can_view_analytics: boolean; can_plan_slots?: boolean;
    can_view_mc?: boolean; can_view_admin?: boolean; can_view_proofs?: boolean; can_view_plan?: boolean; analytics_readonly?: boolean;
  };
  const { data: cur, error: curErr } = await withPlanCol((extra) => db.from("staff")
    .select(`id, role, name, email, phone, can_manage_mc, can_manage_admin, can_manage_proofs, can_view_analytics${extra}`)
    .eq("id", id).maybeSingle().overrideTypes<Cur | null, { merge: false }>());
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
    const curOf = (k: string) => (cur as Record<string, unknown>)[k] ?? false;
    const changed = (k: string) => k in changes && changes[k] !== curOf(k);
    const scopeChanged = ["can_manage_mc", "can_manage_admin", "can_manage_proofs", "can_view_analytics", ...VIEW_FIELDS].some(changed);
    const planChanged = changed("can_plan_slots") || changed("can_view_plan");
    if ((scopeChanged || planChanged) && isMe) return fail("แก้สิทธิ์ของตัวเองไม่ได้ ให้ Owner คนอื่นที่มีสิทธิ์ทั้ง Mc และ Admin แก้ให้");
    if ((scopeChanged || planChanged) && !r.scope.full) return noRole("owner");
    if (planChanged && !r.me.owner?.plan) return noPlanGrant();
    // ต้องมีสิทธิ์อย่างน้อย 1 อย่าง (จัดการได้ หรือ ดูได้ เช่น ดู Data analytics อย่างเดียวได้)
    if (!hasAnyPerm((k) => (k in changes ? changes[k] : curOf(k)))) return fail("ตั้งสิทธิ์อย่างน้อย 1 อย่าง");
    if (isMe) {
      for (const k of ["can_manage_mc", "can_manage_admin", "can_manage_proofs", "can_view_analytics", "can_plan_slots", ...VIEW_FIELDS]) delete changes[k];
    }
  }

  const { error } = await db.from("staff").update(changes).eq("id", id);
  if (error) return fail(needViewSql(dupMessage(error.message)));

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
