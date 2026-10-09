import "server-only";
import { NextResponse } from "next/server";
import { getMe, isRegistered } from "@/lib/auth";
import type { Me } from "@/lib/types";

export function ok<T extends object>(data: T) {
  return NextResponse.json({ ok: true, ...data });
}

export function fail(message: string, status = 400, extra: object = {}) {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

/** ตรวจ login ก่อนทำงาน ถ้าไม่ผ่านคืน response แจ้ง error ให้ส่งกลับได้ทันที */
export async function requireMe(): Promise<{ me: Me } | { res: NextResponse }> {
  const me = await getMe();
  if (!me) return { res: fail("กรุณาเข้าสู่ระบบด้วย Google ก่อน", 401, { authError: true }) };
  if (!isRegistered(me)) {
    return { res: fail(`อีเมล ${me.email} ยังไม่ได้ลงทะเบียน กรุณาติดต่อแอดมิน`, 403, { authError: true }) };
  }
  return { me };
}

/** read = เปิดดู (ดูได้อย่างเดียว หรือ จัดการได้) / write = แก้ไข (จัดการได้เท่านั้น) ค่าเริ่มต้น = write */
export type Access = "read" | "write";
const READ_ONLY = "บัญชีนี้ดูได้อย่างเดียว แก้ไขไม่ได้ (ให้ Owner ที่มีสิทธิ์จัดการเปลี่ยนให้ในหน้าพนักงาน)";

/**
 * ตรวจว่าเป็น Owner ที่มีสิทธิ์อย่างน้อยหนึ่งฝั่ง คืน scope ของคนนั้น
 *   scope.mc / scope.admin = ฝั่งที่ใช้ได้ตาม access (read = ดูได้ / write = จัดการได้)
 *   edit.mc / edit.admin = จัดการฝั่งนั้นได้ (ดูอย่างเดียว = ไม่เห็นค่าจ้าง) · full = จัดการได้ทั้งคู่ (รายชื่อ/สิทธิ์ Owner)
 */
export async function requireOwner(denied = "บัญชีนี้ไม่มีสิทธิ์ใช้หน้าเจ้าของ", access: Access = "write") {
  const r = await requireMe();
  if ("res" in r) return r;
  const o = r.me.owner;
  if (!o) return { res: fail(denied, 403) };
  const mc = access === "read" ? o.see.mc : o.mc, admin = access === "read" ? o.see.admin : o.admin;
  if (!mc && !admin) {
    return { res: fail(o.see.mc || o.see.admin ? READ_ONLY : "บัญชีนี้ยังไม่ได้รับสิทธิ์ฝั่ง Mc หรือ Admin ติดต่อเจ้าของคนอื่น", 403) };
  }
  return { me: r.me, scope: { mc, admin, full: o.mc && o.admin, edit: { mc: o.mc, admin: o.admin } } };
}

/**
 * Owner ที่ติ๊กสิทธิ์ "เข้าถึง Data analytics" (หน้าสถิติไลฟ์ + API ของหน้านี้)
 *   ไม่ต้องมีสิทธิ์จัดการ Mc / Admin (ติ๊กแค่ Data analytics อย่างเดียวได้) · write = อัปโหลด / ลบ / แก้แคมเปญ
 */
export async function requireAnalytics(denied = "บัญชีนี้ไม่มีสิทธิ์เข้าหน้า Data analytics", access: Access = "write") {
  const r = await requireMe();
  if ("res" in r) return r;
  const o = r.me.owner;
  if (!(access === "read" ? o?.see.analytics : o?.analytics)) {
    return { res: fail(o?.see.analytics ? READ_ONLY : `${denied} ให้ Owner ที่มีสิทธิ์ทั้ง Mc และ Admin ติ๊กสิทธิ์ให้ในหน้าพนักงาน`, 403) };
  }
  return { me: r.me };
}

/**
 * Owner ที่ติ๊กสิทธิ์ "Plan Slot Live" (แพลน slot ทั้งเดือน เขียนทั้งแท็บ Deal Mc + Admin เสริม)
 *   ไม่ต้องมีสิทธิ์จัดการ Mc / Admin · ติ๊กให้คนอื่นได้เฉพาะคนที่มีสิทธิ์นี้ · write = บันทึกแพลน
 */
export async function requirePlanner(denied = "บัญชีนี้ไม่มีสิทธิ์ใช้หน้า Plan Slot Live", access: Access = "write") {
  const r = await requireMe();
  if ("res" in r) return r;
  const o = r.me.owner;
  if (!(access === "read" ? o?.see.plan : o?.plan)) {
    return { res: fail(o?.see.plan ? READ_ONLY : `${denied} ให้คนที่มีสิทธิ์ Plan Slot Live ติ๊กสิทธิ์ให้ในหน้าพนักงาน`, 403) };
  }
  return { me: r.me };
}

/** ตาราง slot นี้อยู่ในสิทธิ์ของ Owner หรือไม่ */
export const canTable = (scope: { mc: boolean; admin: boolean }, table: "mc_slots" | "admin_slots") =>
  table === "mc_slots" ? scope.mc : scope.admin;

/** YYYY-MM -> { first, last } เป็นวันที่ (YYYY-MM-DD) ไม่ระบุ = เดือนปัจจุบันตามเวลาไทย */
export function monthRange(month: string | null) {
  const m = String(month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  const now = new Date(Date.now() + 7 * 3600_000);
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mon = m ? Number(m[2]) : now.getUTCMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, mon, 0)).getUTCDate();
  return { key: `${y}-${pad(mon)}`, first: `${y}-${pad(mon)}-01`, last: `${y}-${pad(mon)}-${pad(lastDay)}` };
}
