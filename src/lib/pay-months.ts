import "server-only";
import { fmtDayMonth, monthLabel, money, parseKey, todayKey } from "@/lib/format";
import { notifyMany, type Note } from "@/lib/notifications";
import { cleanTiers, monthsToLock } from "@/lib/pay";
import type { MonthRate } from "@/lib/pay-rates";
import { receiptGaps } from "@/lib/receipts-db";
import { createAdminClient } from "@/lib/supabase/server";
import type { PaymentView } from "@/lib/types";

/**
 * ค่าจ้างรายเดือนที่ซิงค์กัน — SQL 20261111000000_pay_sync
 *   pay_month_rates = เรทที่ล็อกไว้ของเดือนนั้น (ไม่มี = เรทปัจจุบันใน staff เหมือนเดิม)
 *     ล็อกเมื่อ: Owner เปลี่ยนเรท (เดือนก่อนเดือนที่มีผล ล็อกเรทเดิม) · บันทึกการโอน (ล็อกเรทของเดือนที่โอน)
 *     ใช้ที่: สรุปรายเดือนของเจ้าของ / ไฟล์เบิก (src/lib/data.ts ownerSummary) + ตารางของฉัน (/api/my)
 *   pay_payments = การโอนรายคนรายเดือน (หลายครั้งได้ · ยกเลิก = voided_at เก็บไว้เป็นประวัติ) → แจ้งเตือนคนที่ได้รับ
 *   ยังไม่ได้รัน SQL = อ่านได้ว่าง (คิดแบบเดิม) · บันทึกโอน = บอกให้รัน SQL
 */

export const PAY_SYNC_SQL = "ต้องรัน SQL 20261111000000_pay_sync ใน Supabase ก่อน";
const noSql = (msg: string) => /pay_month_rates|pay_payments|schema cache|does not exist/i.test(msg);
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type StaffPay = { id: number; role: string; hourly_rate: number | string | null; commit_tiers: unknown; is_salaried: boolean | null };

/** เรท Shopee ที่ตั้งไว้ตอนนี้ (Mc · ไม่ตั้ง / ยังไม่ได้รัน SQL 20261116000000_shopee_rate = null) */
async function currentShopeeRate(s: StaffPay) {
  if (s.role !== "mc") return null;
  const { data, error } = await createAdminClient().from("staff").select("shopee_rate").eq("id", s.id).maybeSingle();
  return !error && Number(data?.shopee_rate) > 0 ? Number(data!.shopee_rate) : null;
}

/** เรทของคนนี้ตอนนี้ (ไม่ได้ตั้งรายคน = ค่าเริ่มต้นของฝั่งนั้น) — ไม่ใช้ src/lib/data.ts (data.ts เรียกไฟล์นี้) */
async function currentRate(s: StaffPay): Promise<MonthRate> {
  const { data: settings } = await createAdminClient().from("settings").select("default_mc_rate, default_admin_rate").eq("id", 1).maybeSingle();
  const def = Number(s.role === "mc" ? settings?.default_mc_rate : settings?.default_admin_rate) || 0;
  return { rate: Number(s.hourly_rate) || def, tiers: cleanTiers(s.commit_tiers), salaried: !!s.is_salaried, shopeeRate: await currentShopeeRate(s) };
}

/** ล็อกเรทของเดือนเหล่านี้ (เดือนที่ล็อกไว้แล้วไม่ทับ · ยังไม่ได้รัน SQL shopee_rate = ล็อกแบบเดิม ไม่มีเรท Shopee) */
async function lockMonths(staffId: number, months: string[], r: MonthRate) {
  if (!months.length) return;
  const rows = (withShopee: boolean) => months.map((month) => ({
    staff_id: staffId, month, hourly_rate: r.rate, commit_tiers: r.tiers, is_salaried: r.salaried, ...(withShopee ? { shopee_rate: r.shopeeRate } : {}),
  }));
  const upsert = (withShopee: boolean) => createAdminClient().from("pay_month_rates")
    .upsert(rows(withShopee), { onConflict: "staff_id,month", ignoreDuplicates: true });
  let { error } = await upsert(true);
  if (error && /shopee_rate/.test(error.message)) ({ error } = await upsert(false));
  if (error) throw new Error(noSql(error.message) ? PAY_SYNC_SQL : error.message);
}

/**
 * ก่อนเปลี่ยนเรท / Commit / พนักงานประจำ: เดือนที่มีคิวก่อนเดือน from + เดือนนี้ถึงก่อน from (แม้ยังไม่มีคิว) ล็อกเรทเดิมไว้
 *   ตั้งแต่ from ไปใช้เรทใหม่ (ปลดล็อก)
 *   ยังไม่ได้รัน SQL = ข้าม (เปลี่ยนเรทได้ตามเดิม แต่เดือนเก่าเปลี่ยนตาม)
 */
export async function lockBeforeRateChange(s: StaffPay, from: string) {
  if (!MONTH_RE.test(from) || (s.role !== "mc" && s.role !== "admin")) return;
  try {
    const db = createAdminClient();
    const table = s.role === "mc" ? "mc_slots" : "admin_slots";
    const col = s.role === "mc" ? "mc_id" : "admin_id";
    const months = new Set<string>();
    for (let a = 0; ; a += 1000) {
      const { data, error } = await db.from(table).select("live_date").eq(col, s.id).lt("live_date", `${from}-01`).order("id").range(a, a + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) months.add(String(r.live_date).slice(0, 7));
      if (!data || data.length < 1000) break;
    }
    // เลือก "มีผลเดือนหน้า" แต่เดือนนี้ยังไม่มีคิว = ล็อกเดือนนี้ด้วย (ไม่อย่างนั้นคิวที่จองทีหลังได้เรทใหม่)
    await lockMonths(s.id, monthsToLock(months, from, todayKey().slice(0, 7)), await currentRate(s));
    const { error } = await db.from("pay_month_rates").delete().eq("staff_id", s.id).gte("month", from);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn("ล็อกเรทเดือนเก่าไม่สำเร็จ:", (err as Error).message);
  }
}

/** รายการโอนของเดือนนี้ (ไม่นับที่ยกเลิก) Map<staff_id, รายการ> · ready = รัน SQL แล้ว */
export async function paymentsOf(month: string, staffIds?: number[]) {
  const out = new Map<number, PaymentView[]>();
  let q = createAdminClient().from("pay_payments").select("id, staff_id, amount, paid_on, note, created_by, created_at")
    .eq("month", month).is("voided_at", null).order("paid_on").order("id");
  if (staffIds) q = q.in("staff_id", staffIds);
  const { data, error } = await q;
  if (error) return { ready: false, map: out };
  for (const r of data ?? []) {
    const id = Number(r.staff_id);
    out.set(id, [...(out.get(id) ?? []), {
      id: Number(r.id), amount: Number(r.amount), paidOn: String(r.paid_on), note: String(r.note ?? ""), by: String(r.created_by ?? ""), at: String(r.created_at),
    }]);
  }
  return { ready: true, map: out };
}

/**
 * บันทึกการโอน (คนเดียว หรือหลายคนพร้อมกัน) → ล็อกเรทของเดือนนั้น + แจ้งคนที่ได้รับ (+ เตือนส่งเอกสารรับเงินถ้าเดือนนั้นต้องส่ง)
 *   roles = ฝั่งที่ Owner คนนี้จัดการได้ (คนฝั่งอื่น = error)
 */
export async function addPayments(
  month: string, list: { staffId: number; amount: number }[], paidOn: string, note: string,
  actor: { name: string; email: string }, roles: { mc: boolean; admin: boolean }, notify = true,
) {
  if (!MONTH_RE.test(month)) return { error: "เดือนไม่ถูกต้อง" };
  if (!DATE_RE.test(paidOn) || Number.isNaN(Date.parse(paidOn))) return { error: "วันที่โอนไม่ถูกต้อง" };
  const items = list.map((x) => ({ staffId: Number(x.staffId), amount: Math.round(Number(x.amount) * 100) / 100 }));
  if (!items.length || items.some((x) => !Number.isInteger(x.staffId) || !(x.amount > 0) || x.amount > 10_000_000)) {
    return { error: "จำนวนเงินไม่ถูกต้อง" };
  }
  const db = createAdminClient();
  const { data: staff, error: se } = await db.from("staff").select("id, role, name, email, hourly_rate, commit_tiers, is_salaried")
    .in("id", items.map((x) => x.staffId));
  if (se) return { error: se.message };
  const byId = new Map((staff ?? []).map((s) => [Number(s.id), s]));
  for (const x of items) {
    const s = byId.get(x.staffId);
    if (!s) return { error: "ไม่พบรายชื่อนี้" };
    if (!(s.role === "mc" ? roles.mc : s.role === "admin" ? roles.admin : false)) return { error: `บัญชีนี้บันทึกการโอนของ ${s.name} ไม่ได้` };
  }
  const cleanNote = note.replace(/\s+/g, " ").trim().slice(0, 200);
  const { error } = await db.from("pay_payments").insert(items.map((x) => ({
    staff_id: x.staffId, month, amount: x.amount, paid_on: paidOn, note: cleanNote, created_by: actor.name, created_email: actor.email,
  })));
  if (error) return { error: noSql(error.message) ? PAY_SYNC_SQL : error.message };

  // โอนแล้ว = เรทของเดือนนั้นไม่เปลี่ยนตามการแก้เรทภายหลัง
  for (const x of items) {
    const s = byId.get(x.staffId)! as StaffPay;
    await lockMonths(x.staffId, [month], await currentRate(s)).catch(() => undefined);
  }
  // ลงย้อนหลัง (notify = false) = ไม่แจ้งเตือน
  const people = !notify ? [] : items.flatMap((x) => {
    const s = byId.get(x.staffId)!;
    return s.email ? [{ ...x, email: String(s.email).trim().toLowerCase(), role: s.role as "mc" | "admin" }] : [];
  });
  const gaps = people.length
    ? await receiptGaps(people.map((p) => ({ email: p.email, month }))).catch(() => new Map<string, Set<string>>())
    : new Map<string, Set<string>>();
  const notes: (Note & { email: string })[] = people.map((p) => ({
    email: p.email, kind: "pay", page: p.role,
    title: `โอนค่าจ้างเดือน ${monthLabel(month)} แล้ว`,
    body: [
      `${money(p.amount)} บาท · โอนวันที่ ${fmtDayMonth.format(parseKey(paidOn))}`,
      cleanNote,
      gaps.get(p.email)?.has(month) ? 'อย่าลืมส่งเอกสารรับเงินของเดือนนี้: "ตารางของฉัน" → ใบ 50 ทวิ' : 'ดูยอดจ่ายแล้ว / ค้างจ่าย: กดรูปโปรไฟล์มุมขวาบน → "ตารางของฉัน"',
    ].filter(Boolean).join("\n"),
  }));
  await notifyMany(notes);
  await db.from("booking_logs").insert(items.map((x) => ({
    email: actor.email, role: "Owner", name: actor.name, slot_table: "staff", slot_id: x.staffId, result: "สำเร็จ",
    action: `บันทึกโอนค่าจ้าง ${month} ${money(x.amount)} บาท (โอน ${paidOn})${cleanNote ? ` · ${cleanNote}` : ""}`,
  })));
  return { ok: true, count: items.length };
}

/** ยกเลิกรายการโอน (บันทึกผิด) — เก็บไว้เป็นประวัติ */
export async function voidPayment(id: number, actor: { name: string; email: string }, roles: { mc: boolean; admin: boolean }) {
  const db = createAdminClient();
  const { data: row, error } = await db.from("pay_payments").select("id, staff_id, month, amount, voided_at, staff:staff(role, name)").eq("id", id).maybeSingle();
  if (error) return { error: noSql(error.message) ? PAY_SYNC_SQL : error.message };
  const p = row as unknown as { staff_id: number; month: string; amount: number; voided_at: string | null; staff: { role: string; name: string } | null } | null;
  if (!p || p.voided_at) return { error: "ไม่พบรายการนี้ (อาจยกเลิกไปแล้ว)" };
  if (!(p.staff?.role === "mc" ? roles.mc : p.staff?.role === "admin" ? roles.admin : false)) return { error: "บัญชีนี้แก้รายการโอนของคนนี้ไม่ได้" };
  const { error: ue } = await db.from("pay_payments").update({ voided_at: new Date().toISOString(), voided_by: actor.name }).eq("id", id).is("voided_at", null);
  if (ue) return { error: ue.message };
  await db.from("booking_logs").insert({
    email: actor.email, role: "Owner", name: actor.name, slot_table: "staff", slot_id: p.staff_id, result: "สำเร็จ",
    action: `ยกเลิกรายการโอนค่าจ้าง ${p.month} ${money(Number(p.amount))} บาท`,
  });
  return { ok: true };
}
