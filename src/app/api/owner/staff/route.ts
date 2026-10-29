import { after } from "next/server";
import { fail, ok, requireOwner as requireOwnerScope, type Access } from "@/lib/api";
import { VIEW_COL_RE, VIEW_COLS } from "@/lib/auth";
import { missingCalendarCounts } from "@/lib/calendar";
import { bkkToday } from "@/lib/data";
import { monthKey } from "@/lib/format";
import { notifyNewSlots, notifySlotChanges } from "@/lib/notifications";
import { parseTierHours } from "@/lib/pay";
import { lockBeforeRateChange } from "@/lib/pay-months";
import { LIVE_PLATFORM_RE, liveTeamOf, type LiveTeam } from "@/lib/live-team";
import { docsCan, payDocsScope, payDocsStatus } from "@/lib/pay-docs-db";
import { staffChangeText } from "@/lib/staff-history";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncJobs } from "@/lib/sync";
import type { Me } from "@/lib/types";

// จัดการรายชื่อพนักงาน (แทนแท็บ Mc Email / Admin Email / Owner Email / เบอร์โทร MC)
//   GET     รายชื่อทั้งหมด + จำนวนคิวตั้งแต่วันนี้
//   POST    เพิ่มคน
//   PATCH   แก้ชื่อ / อีเมล / เบอร์ / ค่าจ้าง / Commit / Admin เสริม / Mc ประจำ / สิทธิ์ Owner (Mc / Admin / หลักฐานไลฟ์ / Data analytics / Plan Slot Live)
//           / รับอีเมลแจ้งยกเลิกคิว (Owner) / ทีม Shopee (Mc / Admin) / กำหนดสิทธิ์จอง Mc (Owner)
//           เปลี่ยนเรท: rate_from = เดือนที่เริ่มใช้ (เดือนก่อนหน้าล็อกเรทเดิม — src/lib/pay-months.ts)
//           { action: "release", id } = ปล่อยคิวข้างหน้าที่ยังไม่เริ่มของคนนี้ให้คนอื่นจอง
//   DELETE  ลบคน (เฉพาะคนที่ไม่เคยมีคิว · Mc / Admin = เฉพาะ Owner ที่ตั้ง can_delete_staff ด้วย SQL)
// สิทธิ์: Owner ที่ติ๊ก Mc จัดการรายชื่อ Mc ได้ / ติ๊ก Admin จัดการรายชื่อ Admin ได้
//         รายชื่อและสิทธิ์ของ Owner / รายชื่อ Marketing จัดการได้เฉพาะ Owner ที่ติ๊กทั้งคู่ (แก้สิทธิ์ตัวเองไม่ได้)
// Marketing (SQL 20261021000000_marketing) = ชื่อ / อีเมล / เบอร์ เท่านั้น เห็นแค่หน้า CEO Live

// borrower = บัญชีทีมอื่นในบริษัท เห็นแค่หน้าขอยืมอุปกรณ์ (SQL 20261110000000_equipment_loans)
type Role = "mc" | "admin" | "owner" | "marketing" | "borrower";
const ROLES: Role[] = ["mc", "admin", "owner", "marketing", "borrower"];
/** Mc / Admin = มีคิว ค่าจ้าง ปฏิทิน (Owner / Marketing ไม่มี) */
const isCrew = (role: Role): role is "mc" | "admin" => role === "mc" || role === "admin";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TABLE: Record<"mc" | "admin", { table: "mc_slots" | "admin_slots"; col: string }> = {
  mc: { table: "mc_slots", col: "mc_id" },
  admin: { table: "admin_slots", col: "admin_id" },
};
const ROLE_LABEL: Record<Role, string> = { mc: "Mc", admin: "Admin", owner: "Owner", marketing: "Marketing", borrower: "ทีมอื่น" };

const requireOwner = (access: Access = "write") => requireOwnerScope("บัญชีนี้ไม่มีสิทธิ์จัดการพนักงาน", access);
/** สิทธิ์ "ดูได้อย่างเดียว" ของ Owner (บันทึกเฉพาะตอนส่งมา ยังไม่ได้รัน SQL = ไม่แตะ) */
const VIEW_FIELDS = ["can_view_mc", "can_view_admin", "can_view_proofs", "can_view_plan", "analytics_readonly"] as const;
/** รับอีเมลแจ้งเมื่อ Mc / Admin เสริมกดยกเลิกคิว (SQL 20261020000000_notify_cancel) — ไม่ใช่สิทธิ์ ตั้งให้ตัวเองได้ */
const NOTIFY_FIELDS = ["notify_cancel_mc", "notify_cancel_admin"] as const;
type Scope = { mc: boolean; admin: boolean; full: boolean };
const canRole = (scope: Scope, role: Role) => (isCrew(role) ? scope[role] : scope.full);
const noRole = (role: Role) =>
  fail(isCrew(role) ? `บัญชีนี้ไม่มีสิทธิ์จัดการรายชื่อ ${ROLE_LABEL[role]}` : `จัดการรายชื่อ ${ROLE_LABEL[role]} ได้เฉพาะ Owner ที่มีสิทธิ์ทั้ง Mc และ Admin`, 403);

/** ประวัติ (booking_logs) staffId = ผูกกับรายชื่อนั้น (slot_table "staff") ใช้แสดงประวัติการแก้ในหน้าต่างของคนนั้น */
async function log(me: Me, action: string, staffId?: number) {
  await createAdminClient().from("booking_logs").insert({
    email: me.email, role: "Owner", name: me.owner?.name ?? "", action, result: "สำเร็จ",
    ...(staffId ? { slot_table: "staff", slot_id: staffId } : {}),
  });
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
  if (role === "marketing") return { data: out };
  // ทีมอื่น: ชื่อ / อีเมล / เบอร์ + ชื่อทีม / แผนก
  if (role === "borrower") {
    if (!partial || "team_name" in body) out.team_name = String(body.team_name ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
    return { data: out };
  }
  if (!partial || "hourly_rate" in body) {
    const raw = String(body.hourly_rate ?? "").replace(/[,\s฿]/g, "");
    const rate = raw === "" ? null : Number(raw);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) return { error: "ค่าจ้างต้องเป็นตัวเลข" };
    out.hourly_rate = rate;
  }
  // ค่าจ้าง Shopee/ชม. (Mc · SQL 20261116000000_shopee_rate) ว่าง = ใช้เรทเดียวกับ TikTok · บันทึกเฉพาะตอนส่งมา
  if (role === "mc" && "shopee_rate" in body) {
    const raw = String(body.shopee_rate ?? "").replace(/[,\s฿]/g, "");
    const rate = raw === "" ? null : Number(raw);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) return { error: "ค่าจ้าง Shopee ต้องเป็นตัวเลข" };
    out.shopee_rate = rate || null;
  }
  // จ่ายค่าตัวผ่าน Mc อีกคน (Mc ในเครือ · SQL 20261117000000_pay_to) ว่าง = จ่ายให้ตัวเอง · บันทึกเฉพาะตอนส่งมา (ตรวจรายชื่อตอนบันทึก)
  if (role === "mc" && "pay_to_id" in body) {
    const v = body.pay_to_id === null || body.pay_to_id === "" ? null : Number(body.pay_to_id);
    if (v !== null && !(Number.isInteger(v) && v > 0)) return { error: "เลือก Mc ที่รับเงินแทนไม่ถูกต้อง" };
    out.pay_to_id = v;
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
  // หน้าอุปกรณ์โปรดักชั่น (SQL 20261025000000_equipment): บันทึกเฉพาะตอนส่งมา
  if (role === "admin" && "can_manage_equipment" in body) out.can_manage_equipment = body.can_manage_equipment === true;
  // บรีฟการแต่งตัว (เทรนนิ่ง > เฟรมไลฟ์ · SQL 20261113000000_live_frames): บันทึกเฉพาะตอนส่งมา
  if (role === "admin" && "can_manage_briefs" in body) out.can_manage_briefs = body.can_manage_briefs === true;
  // ทีมไลฟ์ tiktok / shopee (SQL 20261031000000_live_platform): บันทึกเฉพาะตอนส่งมา
  if (isCrew(role) && "live_platform" in body) out.live_platform = liveTeamOf(body.live_platform);
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
    // ดูเอกสาร (ทำเบิก / ใบ 50 ทวิ / รับเงิน) ฝั่ง Mc / ฝั่ง Admin: บันทึกเฉพาะตอนส่งมา (ตั้งได้เฉพาะคนที่มีสิทธิ์ฝั่งนั้น — ตรวจใน POST / PATCH)
    for (const k of DOC_FIELDS) if (k in body) out[k] = body[k] === true;
    // กำหนดสิทธิ์จอง Mc ต่อเดือน (SQL 20261107000000_mc_quota): บันทึกเฉพาะตอนส่งมา (ตั้งได้เฉพาะ Owner ที่จัดการได้ทั้งคู่ — ตรวจใน POST / PATCH)
    if ("can_manage_quota" in body) out.can_manage_quota = body.can_manage_quota === true;
  }
  return { data: out };
}

/** สิทธิ์ดูเอกสาร: คอลัมน์ -> ฝั่ง (can_view_pay_docs = Mc · can_view_pay_docs_admin = Admin — SQL 20261106000000_pay_docs_admin) */
const DOC_FIELDS = ["can_view_pay_docs", "can_view_pay_docs_admin"] as const;
/** ให้ / เอาสิทธิ์ดูเอกสารออกได้เฉพาะคนที่ดูเอกสารได้ทั้งฝั่ง Mc และ Admin (คนที่ได้ฝั่งเดียวให้ต่อไม่ได้) */
const canGrantDocs = (s: { mc: boolean; admin: boolean }) => s.mc && s.admin;
const noPayDocsGrant = () => fail("ติ๊ก / เอาสิทธิ์ดูเอกสารออกได้เฉพาะคนที่ดูเอกสารได้ทั้งฝั่ง Mc และ Admin", 403);
const docsSql = (msg: string) => /can_view_pay_docs_admin/.test(msg) ? "ต้องรัน SQL 20261106000000_pay_docs_admin ใน Supabase ก่อน ถึงจะตั้งสิทธิ์ดูเอกสารฝั่ง Admin แยกได้"
  : /can_manage_quota/.test(msg) ? "ต้องรัน SQL 20261107000000_mc_quota ใน Supabase ก่อน ถึงจะตั้งสิทธิ์กำหนดสิทธิ์จอง Mc ได้" : msg;

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
  /staff_live_platform_check/.test(msg) ? "ต้องรัน SQL 20261114000000_shopee_slots ใน Supabase ก่อน ถึงจะตั้งทีม TikTok + Shopee ได้"
    : LIVE_PLATFORM_RE.test(msg) ? "ต้องรัน SQL 20261031000000_live_platform ใน Supabase ก่อน ถึงจะตั้งทีม Shopee ได้"
    : /notify_cancel/.test(msg) ? "ต้องรัน SQL 20261020000000_notify_cancel ใน Supabase ก่อน ถึงจะตั้งรับอีเมลแจ้งยกเลิกได้"
    : VIEW_COL_RE.test(msg) ? "ต้องรัน SQL 20261018000000_view_only ใน Supabase ก่อน ถึงจะตั้งสิทธิ์แบบดูได้อย่างเดียวได้" : msg;
const noPlanGrant = () => fail("ติ๊ก / เอาสิทธิ์ Plan Slot Live ออกได้เฉพาะคนที่มีสิทธิ์นี้", 403);

/**
 * ลบรายชื่อ Mc / Admin ได้ไหม — staff.can_delete_staff (SQL 20261112000000_delete_staff · ตั้งด้วย SQL เท่านั้น ไม่มีช่องในหน้าพนักงาน)
 *   Owner ที่ติ๊กจัดการ Mc / Admin ยังลบไม่ได้ · ยังไม่ได้รัน SQL = ไม่มีใครลบได้
 */
const NO_DELETE = "ลบรายชื่อ Mc / Admin ได้เฉพาะเจ้าของระบบ (ถ้าไม่ให้เข้าระบบแล้ว ให้ลบอีเมลออก หรือปล่อยคิวข้างหน้าแทน)";
async function canDeleteStaff(me: Me) {
  if (!me.owner) return false;
  const { data, error } = await createAdminClient().from("staff").select("can_delete_staff").eq("id", me.owner.id).maybeSingle();
  return !error && data?.can_delete_staff === true;
}

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
  const edit: Record<Role, boolean> = { mc: r.scope.edit.mc, admin: r.scope.edit.admin, owner: r.scope.full, marketing: r.scope.full, borrower: r.scope.full };
  const staff = (rows ?? [])
    .filter((s) => (ROLES.includes(s.role as Role) && canRole(r.scope, s.role as Role)) || s.id === r.me.owner?.id)
    // ฝั่งที่ดูได้อย่างเดียว: ไม่ส่งค่าจ้าง / Commit
    .map((s) => (!edit[s.role as Role] ? { ...s, hourly_rate: null, commit_tiers: null } : s));

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
  // คิวข้างหน้าที่ยังไม่ขึ้นปฏิทิน (ส่วนใหญ่ = ยังไม่แชร์ปฏิทินให้บัญชีระบบ) — ดึงไม่ได้ก็แสดงรายชื่อได้ปกติ
  const noCalendar = await missingCalendarCounts().catch(() => new Map<number, number>());
  // เอกสารทำเบิก: เห็นเฉพาะ Owner ที่ดูเอกสารได้ เฉพาะฝั่งที่ติ๊กไว้ (ยังไม่ได้รัน SQL = ไม่แสดง)
  const docsScope = await payDocsScope(r.me);
  const payDocsViewer = docsScope.mc || docsScope.admin;
  // สิทธิ์หน้าอุปกรณ์ของ Admin (ยังไม่ได้รัน SQL = ไม่มีช่องนี้)
  const { data: equipRows, error: equipErr } = await db.from("staff").select("id, can_manage_equipment").eq("role", "admin");
  const equip = new Map((equipErr ? [] : equipRows ?? []).map((x) => [x.id as number, x.can_manage_equipment === true]));
  // สิทธิ์บรีฟการแต่งตัวของ Admin (ยังไม่ได้รัน SQL = ไม่มีช่องนี้)
  const { data: briefRows, error: briefErr } = await db.from("staff").select("id, can_manage_briefs").eq("role", "admin");
  const briefs = new Map((briefErr ? [] : briefRows ?? []).map((x) => [x.id as number, x.can_manage_briefs === true]));
  // ทีมไลฟ์ของ Mc / Admin (ยังไม่ได้รัน SQL 20261031000000_live_platform = ไม่มีช่องนี้ ทุกคนเป็น TikTok)
  const { data: teamRows, error: teamErr } = await db.from("staff").select("id, live_platform").in("role", ["mc", "admin"]);
  const team = new Map((teamErr ? [] : teamRows ?? []).map((x) => [x.id as number, liveTeamOf(x.live_platform)]));
  // ค่าจ้าง Shopee ของ Mc (ยังไม่ได้รัน SQL 20261116000000_shopee_rate = ไม่มีช่องนี้ · ฝั่ง Mc ดูได้อย่างเดียว = ไม่ส่ง)
  const { data: shopeeRows, error: shopeeErr } = edit.mc
    ? await db.from("staff").select("id, shopee_rate").eq("role", "mc")
    : { data: null, error: { message: "hidden" } };
  const shopeeRate = new Map((shopeeErr ? [] : shopeeRows ?? []).map((x) => [x.id as number, x.shopee_rate === null ? null : Number(x.shopee_rate)]));
  // จ่ายค่าตัวผ่าน Mc อีกคน (ยังไม่ได้รัน SQL 20261117000000_pay_to = ไม่มีช่องนี้)
  const { data: payToRows, error: payToErr } = await db.from("staff").select("id, pay_to_id").eq("role", "mc");
  const payTo = new Map((payToErr ? [] : payToRows ?? []).map((x) => [x.id as number, x.pay_to_id === null ? null : Number(x.pay_to_id)]));
  const payDocs = payDocsViewer ? await payDocsStatus(db) : new Map<number, "ok" | "missing">();
  // Owner คนไหนดูเอกสารฝั่งไหนได้ (บอกเฉพาะคนที่ให้สิทธิ์นี้ได้ = ดูได้ทั้งสองฝั่ง) · ยังไม่ได้รัน SQL ฝั่ง Admin = ไม่มีค่าฝั่ง Admin
  const docRows = !canGrantDocs(docsScope) ? [] : await (async () => {
    const both = await db.from("staff").select("id, can_view_pay_docs, can_view_pay_docs_admin").eq("role", "owner");
    if (!both.error) return both.data ?? [];
    const old = await db.from("staff").select("id, can_view_pay_docs").eq("role", "owner");
    return (old.data ?? []) as { id: number; can_view_pay_docs: boolean; can_view_pay_docs_admin?: boolean }[];
  })();
  // ชื่อทีม / แผนกของบัญชีทีมอื่น (ยังไม่ได้รัน SQL 20261110000000_equipment_loans = ไม่มีช่องนี้)
  const { data: teamNameRows, error: teamNameErr } = await db.from("staff").select("id, team_name").eq("role", "borrower");
  const teamName = new Map((teamNameErr ? [] : teamNameRows ?? []).map((x) => [x.id as number, String(x.team_name ?? "")]));
  // Owner ที่ติ๊ก "กำหนดสิทธิ์จอง Mc" (ยังไม่ได้รัน SQL 20261107000000_mc_quota = ไม่มีช่องนี้)
  const { data: quotaRows, error: quotaErr } = await db.from("staff").select("id, can_manage_quota").eq("role", "owner");
  const quotaMgr = new Map((quotaErr ? [] : quotaRows ?? []).map((x) => [x.id as number, x.can_manage_quota === true]));
  const docViewers = new Map(docRows.map((x) => [x.id as number, {
    can_view_pay_docs: x.can_view_pay_docs === true,
    ...(x.can_view_pay_docs_admin !== undefined ? { can_view_pay_docs_admin: x.can_view_pay_docs_admin === true } : {}),
  }]));
  // เปิดแจ้งเตือนเด้งในมือถือ / เบราว์เซอร์แล้วกี่เครื่อง (ตามอีเมล · ยังไม่ได้รัน SQL notifications = ไม่แสดง)
  const { data: subs, error: subErr } = await db.from("push_subscriptions").select("email");
  const devices = new Map<string, number>();
  for (const s of subErr ? [] : subs ?? []) devices.set(String(s.email), (devices.get(String(s.email)) ?? 0) + 1);
  const pushOf = (email: unknown) => (subErr ? {} : { pushDevices: devices.get(String(email ?? "").trim().toLowerCase()) ?? 0 });
  return ok({
    staff: (staff ?? []).map((s) => ({
      ...s, upcoming: upcoming.get(s.id) ?? 0, ...(isCrew(s.role as Role) ? { calendarMissing: noCalendar.get(s.id) ?? 0 } : {}),
      // สถานะเอกสารทำเบิก: เฉพาะคนฝั่งที่ดูเอกสารได้
      ...(payDocs.has(s.id) && docsCan(docsScope, s.role) ? { payDocs: payDocs.get(s.id) } : {}),
      ...(equip.has(s.id) ? { can_manage_equipment: equip.get(s.id) } : {}),
      ...(briefs.has(s.id) ? { can_manage_briefs: briefs.get(s.id) } : {}),
      ...(team.has(s.id) ? { live_platform: team.get(s.id) } : {}),
      ...(shopeeRate.has(s.id) ? { shopee_rate: shopeeRate.get(s.id) } : {}),
      ...(payTo.has(s.id) ? { pay_to_id: payTo.get(s.id) } : {}),
      ...(quotaMgr.has(s.id) ? { can_manage_quota: quotaMgr.get(s.id) } : {}),
      ...(teamName.has(s.id) ? { team_name: teamName.get(s.id) } : {}),
      ...(docViewers.get(s.id) ?? {}),
      ...(s.email ? pushOf(s.email) : {}),
    })),
    meId: r.me.owner?.id ?? null,
    // บทบาทที่แก้รายชื่อได้ (ดูได้อย่างเดียว = false)
    canEdit: edit,
    payDocsViewer,
    docsScope,
    // ปุ่มลบรายชื่อ Mc / Admin (เฉพาะเจ้าของระบบ)
    canDeleteCrew: await canDeleteStaff(r.me),
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
  // จ่ายค่าตัวผ่าน: ตั้งตอนแก้ไขเท่านั้น (ตรวจรายชื่อคนรับเงินที่ PATCH)
  delete c.data?.pay_to_id;
  if (role === "owner" && !hasAnyPerm((k) => c.data?.[k])) return fail("ตั้งสิทธิ์อย่างน้อย 1 อย่าง");
  // ให้สิทธิ์ Plan Slot Live (จัดการ / ดู) ได้เฉพาะคนที่มีสิทธิ์นี้
  if ((c.data?.can_plan_slots || c.data?.can_view_plan) && !r.me.owner?.plan) return noPlanGrant();
  // สิทธิ์ดูเอกสาร: ติ๊กได้เฉพาะฝั่งที่ตัวเองมีสิทธิ์ · ไม่ติ๊ก = ค่าเริ่มต้นของคอลัมน์ (ปิด — ไม่ต้องส่ง)
  if (c.data && DOC_FIELDS.some((k) => c.data![k])) {
    const mine = await payDocsScope(r.me);
    if (!canGrantDocs(mine)) return noPayDocsGrant();
  }
  for (const k of DOC_FIELDS) if (c.data && !c.data[k]) delete c.data[k];
  if (c.data && !c.data.can_manage_quota) delete c.data.can_manage_quota;
  // TikTok = ค่าเริ่มต้นของคอลัมน์ ไม่ต้องส่ง (ยังไม่ได้รัน SQL ก็เพิ่มคนได้ตามเดิม)
  if (c.data?.live_platform === "tiktok") delete c.data.live_platform;

  const { data, error } = await createAdminClient().from("staff").insert({ role, ...c.data }).select("id").single();
  if (error && role === "marketing" && /staff_role_check|check constraint/.test(error.message)) {
    return fail("ต้องรัน SQL 20261021000000_marketing ใน Supabase ก่อน ถึงจะเพิ่มบัญชี Marketing ได้");
  }
  if (error && role === "borrower" && /staff_role_check|check constraint|team_name/.test(error.message)) {
    return fail("ต้องรัน SQL 20261110000000_equipment_loans ใน Supabase ก่อน ถึงจะเพิ่มบัญชีทีมอื่นได้");
  }
  if (error) return fail(docsSql(needViewSql(dupMessage(error.message))));
  const detail = staffChangeText({}, Object.fromEntries(Object.entries(c.data!).filter(([k]) => ["hourly_rate", "is_salaried", "is_extra_admin", "live_platform"].includes(k))));
  after(() => log(r.me, `เพิ่มพนักงาน ${role} "${c.data!.name}"${detail ? ` (${detail.replace(/ว่าง → |ปิด → |ค่าเริ่มต้น → |TikTok → /g, "")})` : ""}`, data.id));
  return ok({ id: data.id });
}

// ---------- PATCH ----------

export async function PATCH(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return fail("ไม่พบรายชื่อนี้");
  if (body?.action === "release") return releaseUpcoming(r, id);

  const db = createAdminClient();
  type Cur = {
    id: number; role: string; name: string; email: string | null; phone: string | null; can_manage_mc: boolean;
    can_manage_admin: boolean; can_manage_proofs: boolean; can_view_analytics: boolean; can_plan_slots?: boolean;
    can_view_mc?: boolean; can_view_admin?: boolean; can_view_proofs?: boolean; can_view_plan?: boolean; analytics_readonly?: boolean;
  };
  const { data: cur, error: curErr } = await withPlanCol((extra) => db.from("staff")
    .select(`id, role, name, email, phone, hourly_rate, commit_tiers, is_extra_admin, is_salaried, can_manage_mc, can_manage_admin, can_manage_proofs, can_view_analytics${extra}`)
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
    // ดูเอกสาร (แต่ละฝั่ง): แก้ของตัวเองไม่ได้ · ให้ / เอาออกได้เฉพาะคนที่มีสิทธิ์ฝั่งนั้น · ไม่เปลี่ยน = ไม่ส่ง (ไม่บันทึกประวัติ)
    const docKeys = DOC_FIELDS.filter((k) => k in changes);
    if (docKeys.length) {
      const { data: d } = await db.from("staff").select(docKeys.join(", ")).eq("id", id).maybeSingle();
      const mine = await payDocsScope(r.me);
      for (const k of docKeys) {
        const before = (d as Record<string, unknown> | null)?.[k] === true;
        if (changes[k] === before) { delete changes[k]; continue; }
        if (isMe) return fail("แก้สิทธิ์ของตัวเองไม่ได้ ให้ Owner คนอื่นที่มีสิทธิ์ดูเอกสารแก้ให้");
        if (!canGrantDocs(mine)) return noPayDocsGrant();
        (cur as Record<string, unknown>)[k] = before;
      }
    }
    // กำหนดสิทธิ์จอง Mc: แก้ของตัวเองไม่ได้ · ให้ / เอาออกได้เฉพาะ Owner ที่จัดการได้ทั้ง Mc และ Admin · ไม่เปลี่ยน = ไม่ส่ง
    if ("can_manage_quota" in changes) {
      const { data: q, error: qErr } = await db.from("staff").select("can_manage_quota").eq("id", id).maybeSingle();
      const before = !qErr && q?.can_manage_quota === true;
      if (changes.can_manage_quota === before) delete changes.can_manage_quota;
      else {
        if (isMe) return fail("แก้สิทธิ์ของตัวเองไม่ได้ ให้ Owner คนอื่นที่มีสิทธิ์ทั้ง Mc และ Admin แก้ให้");
        if (!r.scope.full) return noRole("owner");
        (cur as Record<string, unknown>).can_manage_quota = before;
      }
    }
  }

  // ทีม / แผนกเดิมของบัญชีทีมอื่น (ไว้บันทึกประวัติ · ไม่เปลี่ยน = ไม่ส่ง)
  if ("team_name" in changes) {
    const { data: t } = await db.from("staff").select("team_name").eq("id", id).maybeSingle();
    const before = String(t?.team_name ?? "");
    if (changes.team_name === before) delete changes.team_name;
    else (cur as Record<string, unknown>).team_name = before;
  }
  // ค่าเดิมของสิทธิ์หน้าอุปกรณ์ (ไว้บันทึกประวัติ — ไม่อยู่ใน cur เพราะคอลัมน์อาจยังไม่มี)
  const equipBefore = "can_manage_equipment" in changes
    ? (await db.from("staff").select("can_manage_equipment").eq("id", id).maybeSingle()).data?.can_manage_equipment
    : undefined;
  const briefsBefore = "can_manage_briefs" in changes
    ? (await db.from("staff").select("can_manage_briefs").eq("id", id).maybeSingle()).data?.can_manage_briefs
    : undefined;
  // ทีมไลฟ์เดิม (ไว้บันทึกประวัติ · ไม่เปลี่ยน = ไม่ส่ง จะได้บันทึกได้แม้ยังไม่ได้รัน SQL ซึ่งทุกคนเป็น TikTok)
  let teamBefore: LiveTeam | undefined;
  if ("live_platform" in changes) {
    const { data: t, error: tErr } = await db.from("staff").select("live_platform").eq("id", id).maybeSingle();
    teamBefore = tErr ? "tiktok" : liveTeamOf(t?.live_platform);
    if (changes.live_platform === teamBefore) delete changes.live_platform;
  }
  // จ่ายค่าตัวผ่าน: คนรับเงินต้องเป็น Mc คนอื่นที่รับเงินเอง (ไม่ซ้อนหลายชั้น) และคนนี้ต้องไม่ได้เป็นคนรับเงินแทนใคร
  let payToBefore: string | undefined, payToAfter: string | undefined;
  if ("pay_to_id" in changes) {
    const { data: me_, error: pErr } = await db.from("staff").select("pay_to_id").eq("id", id).maybeSingle();
    if (pErr) return fail(/pay_to_id/.test(pErr.message) ? "ต้องรัน SQL 20261117000000_pay_to ใน Supabase ก่อน ถึงจะตั้งจ่ายค่าตัวผ่านได้" : pErr.message);
    const before = me_?.pay_to_id === null || me_?.pay_to_id === undefined ? null : Number(me_.pay_to_id);
    const after = changes.pay_to_id as number | null;
    if (after === before) delete changes.pay_to_id;
    else {
      if (after !== null) {
        if (after === id) return fail("เลือกตัวเองไม่ได้");
        const { data: payee } = await db.from("staff").select("id, role, name, pay_to_id").eq("id", after).maybeSingle();
        if (!payee || payee.role !== "mc") return fail("ไม่พบ Mc ที่รับเงินแทน");
        if (payee.pay_to_id) return fail(`Mc ${payee.name} จ่ายค่าตัวผ่านคนอื่นอยู่แล้ว เลือกคนที่รับเงินเองเท่านั้น`);
        const { count } = await db.from("staff").select("id", { count: "exact", head: true }).eq("pay_to_id", id);
        if (count) return fail(`มี Mc ${count} คนจ่ายค่าตัวผ่าน ${cur.name} อยู่ ตั้งให้ ${cur.name} จ่ายผ่านคนอื่นอีกชั้นไม่ได้`);
      }
      const ids = [before, after].filter((x): x is number => !!x);
      const { data: names } = ids.length ? await db.from("staff").select("id, name").in("id", ids) : { data: [] };
      const nameOf = (x: number | null) => (x ? `Mc ${(names ?? []).find((n) => n.id === x)?.name ?? x}` : null);
      payToBefore = nameOf(before) ?? "";
      payToAfter = nameOf(after) ?? "";
    }
  }
  // ค่าจ้าง Shopee เดิม (ไว้ตรวจว่าเปลี่ยน + บันทึกประวัติ · ไม่อยู่ใน cur เพราะคอลัมน์อาจยังไม่มี · ไม่เปลี่ยน = ไม่ส่ง)
  let shopeeBefore: number | null | undefined;
  if ("shopee_rate" in changes) {
    const { data: s, error: sErr } = await db.from("staff").select("shopee_rate").eq("id", id).maybeSingle();
    if (sErr) return fail(/shopee_rate/.test(sErr.message) ? "ต้องรัน SQL 20261116000000_shopee_rate ใน Supabase ก่อน ถึงจะตั้งค่าจ้าง Shopee ได้" : sErr.message);
    shopeeBefore = Number(s?.shopee_rate) || null;
    if ((Number(changes.shopee_rate) || null) === shopeeBefore) delete changes.shopee_rate;
  }
  // เปลี่ยนเรท / Commit / พนักงานประจำ / เรท Shopee: เดือนก่อน "มีผลตั้งแต่" ล็อกเรทเดิมไว้ (สรุป / ไฟล์เบิก / ตารางของฉันของเดือนเก่าไม่เปลี่ยนตาม)
  if (isCrew(role)) {
    const old = cur as unknown as { id: number; role: string; hourly_rate: number | null; commit_tiers: unknown; is_salaried: boolean | null };
    const rateChanged = ("hourly_rate" in changes && (Number(changes.hourly_rate) || null) !== (Number(old.hourly_rate) || null))
      || ("commit_tiers" in changes && JSON.stringify(changes.commit_tiers ?? []) !== JSON.stringify(old.commit_tiers ?? []))
      || ("is_salaried" in changes && !!changes.is_salaried !== !!old.is_salaried)
      || "shopee_rate" in changes;
    if (rateChanged) await lockBeforeRateChange(old, rateFrom(body?.rate_from));
  }
  const { error } = await db.from("staff").update(changes).eq("id", id);
  if (error) {
    if (/can_manage_equipment/.test(error.message)) return fail("ต้องรัน SQL 20261025000000_equipment ใน Supabase ก่อน ถึงจะตั้งสิทธิ์หน้าอุปกรณ์ได้");
    if (/can_manage_briefs/.test(error.message)) return fail("ต้องรัน SQL 20261113000000_live_frames ใน Supabase ก่อน ถึงจะตั้งสิทธิ์บรีฟการแต่งตัวได้");
    if (/team_name/.test(error.message)) return fail("ต้องรัน SQL 20261110000000_equipment_loans ใน Supabase ก่อน");
    return fail(docsSql(needViewSql(dupMessage(error.message))));
  }

  // ผลต่อปฏิทิน / ชีต
  if (isCrew(role)) {
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
  // ประวัติ: เปลี่ยนอะไร จากเท่าไรเป็นเท่าไร (ไม่มีอะไรเปลี่ยนจริง = ไม่บันทึก)
  const diff = staffChangeText(
    { ...cur, can_manage_equipment: equipBefore, can_manage_briefs: briefsBefore, live_platform: teamBefore, shopee_rate: shopeeBefore, pay_to_id: payToBefore },
    "pay_to_id" in changes ? { ...changes, pay_to_id: payToAfter } : changes,
  );
  if (diff) after(() => log(r.me, `แก้พนักงาน ${role} "${cur.name}": ${diff}`, id));
  return ok({ message: "บันทึกแล้ว" });
}

/** เดือนที่เรทใหม่เริ่มใช้: เลือกได้ 2 เดือนก่อน ถึงเดือนหน้า (ไม่ส่ง / นอกช่วง = เดือนนี้) */
function rateFrom(raw: unknown) {
  const now = bkkToday().slice(0, 7);
  const ok = [-2, -1, 0, 1].map((n) => monthKey(n, now));
  return typeof raw === "string" && ok.includes(raw) ? raw : now;
}

/**
 * ปล่อยคิวข้างหน้าของคนนี้ (เช่น เลิกไลฟ์แล้ว / เอาอีเมลออก) — เหมือน Owner เอาคนออกจาก slot ทีละคิว
 *   เฉพาะคิวที่ยังไม่เริ่ม · ลบ event ปฏิทิน + เขียนชีต (trigger) · แจ้งคนเดิม (ถ้ายังมีอีเมล) + คนที่จองแทนได้
 */
async function releaseUpcoming(r: { me: Me; scope: Scope }, id: number) {
  const db = createAdminClient();
  const { data: p } = await db.from("staff").select("id, role, name").eq("id", id).maybeSingle();
  if (!p) return fail("ไม่พบรายชื่อนี้");
  const role = p.role as Role;
  if (!isCrew(role)) return fail("รายชื่อนี้ไม่มีคิว");
  if (!canRole(r.scope, role)) return noRole(role);
  const { table, col } = TABLE[role];
  const now = new Date().toISOString();
  const ids: number[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("id").eq(col, id).eq("is_cancelled", false)
      .gt("starts_at", now).order("id").range(from, from + 999);
    if (error) return fail(error.message, 500);
    ids.push(...(data ?? []).map((x) => Number(x.id)));
    if (!data || data.length < 1000) break;
  }
  if (!ids.length) return ok({ message: "ไม่มีคิวข้างหน้าที่ยังไม่เริ่ม", released: 0 });
  for (let i = 0; i < ids.length; i += 200) {
    // .eq(col, id) กันคิวที่เพิ่งเปลี่ยนคนไปแล้ว
    const { error } = await db.from(table).update({ [col]: null, confirmed: null }).in("id", ids.slice(i, i + 200)).eq(col, id);
    if (error) return fail(error.message, 500);
  }
  await db.from("calendar_jobs").insert(ids.map((slot_id) => ({ slot_table: table, slot_id })));
  after(async () => {
    await processSyncJobs();
    await log(r.me, `ปล่อยคิวข้างหน้าของ ${role === "mc" ? "Mc " : ""}${p.name} ${ids.length} คิว (ให้คนอื่นจอง)`, id);
    await notifySlotChanges(table, ids.map((sid) => ({ id: sid, oldPerson: id, newPerson: null, oldCancelled: false })), r.me.email);
    await notifyNewSlots(role, ids, r.me.email);
  });
  return ok({ message: `ปล่อย ${ids.length} คิวแล้ว slot ว่างให้คนอื่นจอง`, released: ids.length });
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
  // ลบรายชื่อ Mc / Admin: เฉพาะ Owner ที่ตั้ง can_delete_staff (ติ๊กสิทธิ์จัดการ Mc / Admin อย่างเดียวไม่พอ)
  if (isCrew(cur.role as Role) && !(await canDeleteStaff(r.me))) return fail(NO_DELETE, 403);
  const { error } = await db.from("staff").delete().eq("id", id);
  if (error) {
    return fail(error.code === "23503"
      ? "คนนี้มีประวัติคิวอยู่ ลบไม่ได้ ถ้าไม่ให้เข้าระบบแล้ว ให้ลบอีเมลออกแทน"
      : error.message);
  }
  after(() => log(r.me, `ลบพนักงาน ${cur.role} "${cur.name}"`, id));
  return ok({ message: "ลบแล้ว" });
}
