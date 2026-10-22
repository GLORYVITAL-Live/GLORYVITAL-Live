import "server-only";
import { fail, requireMe } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me, PayDocsView } from "@/lib/types";

/**
 * เอกสารทำเบิก (ตาราง pay_docs + bucket "pay-docs") — SQL 20261022000000_pay_docs
 *   1 อีเมล = 1 ชุด · ดูได้เฉพาะเจ้าตัว + Owner ที่ติ๊กสิทธิ์ดูเอกสารฝั่งนั้น (หน้าพนักงาน — payDocsScope)
 */

type Db = ReturnType<typeof createAdminClient>;
export const PAY_DOCS_BUCKET = "pay-docs";
export const PAY_DOCS_SQL = "ต้องรัน SQL 20261022000000_pay_docs ใน Supabase ก่อน";
/** error จาก DB ที่แปลว่ายังไม่ได้รัน SQL (ไม่มีตาราง / คอลัมน์) */
export const noPayDocsSql = (msg: string) => /pay_docs|can_view_pay_docs|schema cache|does not exist/i.test(msg);
/** ตอบ error จาก loadPayDocs — ยังไม่ได้รัน SQL = 409 (ไม่ส่งอีเมลแจ้ง error ทุกครั้งที่ Mc / Admin เปิดหน้า) */
export const payDocsFail = (msg: string) => fail(msg, msg === PAY_DOCS_SQL ? 409 : 500);

export type PayDocsRow = {
  email: string; full_name: string; id_card_no: string; address: string; bank: string; account_no: string; account_name: string;
  id_card_path: string; bank_book_path: string; drive_file_ids: string[]; drive_folders: Partial<Record<"mc" | "admin", string>>;
  drive_error: string | null; drive_synced_at: string | null; updated_at: string;
};

export const viewOf = (r: PayDocsRow): PayDocsView => ({
  fullName: r.full_name, idCardNo: r.id_card_no, address: r.address, bank: r.bank, accountNo: r.account_no, accountName: r.account_name,
  idCardPdf: r.id_card_path.endsWith(".pdf"), bankBookPdf: r.bank_book_path.endsWith(".pdf"), updatedAt: r.updated_at,
});

/** เอกสารของอีเมลนี้ (ไม่มี = null) error = ยังไม่ได้รัน SQL หรือ DB ขัดข้อง */
export async function loadPayDocs(db: Db, email: string) {
  const { data, error } = await db.from("pay_docs").select("*").eq("email", email).maybeSingle();
  return { row: (data as PayDocsRow | null) ?? null, error: error ? (noPayDocsSql(error.message) ? PAY_DOCS_SQL : error.message) : null };
}

/** ฝั่งที่ดูเอกสารได้ (Mc / Admin) */
export type DocsScope = { mc: boolean; admin: boolean };
export const NO_DOCS: DocsScope = { mc: false, admin: false };
export const docsCan = (scope: DocsScope, role: string) => (role === "mc" ? scope.mc : role === "admin" ? scope.admin : false);

/**
 * ฝั่งที่ Owner คนนี้ดูเอกสารทำเบิก / ใบ 50 ทวิ / เอกสารรับเงินได้
 *   staff.can_view_pay_docs = ฝั่ง Mc · can_view_pay_docs_admin = ฝั่ง Admin (SQL 20261106000000_pay_docs_admin)
 *   ยังไม่ได้รัน SQL ฝั่ง Admin = can_view_pay_docs ครอบทั้งสองฝั่งแบบเดิม
 */
export async function payDocsScope(me: Me): Promise<DocsScope> {
  if (!me.owner) return NO_DOCS;
  const db = createAdminClient();
  const { data, error } = await db.from("staff").select("can_view_pay_docs, can_view_pay_docs_admin").eq("id", me.owner.id).maybeSingle();
  if (!error) return { mc: data?.can_view_pay_docs === true, admin: data?.can_view_pay_docs_admin === true };
  const { data: old, error: oldErr } = await db.from("staff").select("can_view_pay_docs").eq("id", me.owner.id).maybeSingle();
  const all = !oldErr && old?.can_view_pay_docs === true;
  return { mc: all, admin: all };
}

/** Owner ที่ดูเอกสารของคนอื่นได้อย่างน้อยหนึ่งฝั่ง */
export async function canViewPayDocs(me: Me) {
  const s = await payDocsScope(me);
  return s.mc || s.admin;
}

/**
 * รายชื่อ Mc / Admin (select "*" = คอลัมน์ที่ยังไม่ได้รัน SQL ไม่มีมา ไม่ error)
 *   pay_docs_drive_folder = โฟลเดอร์เอกสารเดิมใน Drive (SQL 20261023000000_pay_docs_drive)
 */
export type CrewRow = {
  id: number; role: "mc" | "admin"; name: string; email: string | null; is_salaried?: boolean;
  pay_docs_required?: boolean; pay_docs_drive_folder?: string | null;
};
export const DRIVE_LINK_SQL = "ต้องรัน SQL 20261023000000_pay_docs_drive ใน Supabase ก่อน";

/** Owner ที่ดูเอกสารได้ + Mc / Admin รายชื่อ id นี้ (ไม่ส่งอีเมลใน URL) */
export async function requirePayDocsViewer(staffId: unknown) {
  const r = await requireMe();
  if ("res" in r) return r;
  const scope = await payDocsScope(r.me);
  if (!scope.mc && !scope.admin) return { res: fail("บัญชีนี้ไม่มีสิทธิ์ดูเอกสารทำเบิก", 403) };
  const id = Number(staffId);
  if (!Number.isInteger(id) || id <= 0) return { res: fail("ไม่พบรายชื่อนี้") };
  const { data } = await createAdminClient().from("staff").select("*").eq("id", id).in("role", ["mc", "admin"]).maybeSingle();
  const person = data as CrewRow | null;
  if (!person || !docsCan(scope, person.role)) return { res: fail(`บัญชีนี้ไม่มีสิทธิ์ดูเอกสารฝั่ง ${person?.role === "admin" ? "Admin" : "Mc"}`, 403) };
  if (!person.email) return { res: fail("รายชื่อนี้ยังไม่มีอีเมล") };
  return { me: r.me, email: person.email, person };
}

/**
 * ป้ายเตือนของอีเมลนี้: onFile = มีเอกสารเดิมใน Drive (ผูกโฟลเดอร์แล้ว)
 *   required = รายชื่อที่เพิ่มหลังเปิดฟีเจอร์ (pay_docs_required) ไม่ใช่พนักงานประจำ และยังไม่มีเอกสารใน Drive
 */
export async function payDocsNeed(db: Db, email: string) {
  const { data, error } = await db.from("staff").select("*").eq("email", email).in("role", ["mc", "admin"]);
  if (error) return { required: false, onFile: false };
  const rows = (data ?? []) as CrewRow[];
  const onFile = rows.some((s) => !!s.pay_docs_drive_folder);
  return { required: !onFile && rows.some((s) => s.pay_docs_required === true && !s.is_salaried), onFile };
}

/** ok = ส่งในเว็บแล้ว · drive = มีเอกสารเดิมใน Drive · missing = ต้องส่งแต่ยังไม่มี */
export type PayDocsState = "ok" | "drive" | "missing";

/** สถานะเอกสารของรายชื่อ Mc / Admin ที่มีอีเมล (หน้าพนักงาน ของ Owner ที่ดูได้) ไม่อยู่ใน map = ไม่ต้องส่ง */
export async function payDocsStatus(db: Db) {
  const [staff, docs] = await Promise.all([
    db.from("staff").select("*").in("role", ["mc", "admin"]).not("email", "is", null),
    db.from("pay_docs").select("email"),
  ]);
  const out = new Map<number, PayDocsState>();
  if (staff.error || docs.error) return out;
  const rows = (staff.data ?? []) as CrewRow[];
  const sent = new Set((docs.data ?? []).map((d) => String(d.email)));
  // เอกสารเป็นของคน (อีเมล): เป็นทั้ง Mc และ Admin ผูกโฟลเดอร์ฝั่งเดียวก็พอ
  const onFile = new Set(rows.filter((s) => s.pay_docs_drive_folder).map((s) => s.email));
  for (const s of rows) {
    if (sent.has(String(s.email))) out.set(s.id, "ok");
    else if (onFile.has(s.email)) out.set(s.id, "drive");
    else if (s.pay_docs_required === true && !s.is_salaried) out.set(s.id, "missing");
  }
  return out;
}
