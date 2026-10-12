import { fail, ok, requireAnalytics, requireCeoLive } from "@/lib/api";
import { ceoLiveData, cleanTracked, noTrackedTable, toTrackedRow } from "@/lib/ceo-live";
import { createAdminClient } from "@/lib/supabase/server";
import type { CeoSession } from "@/lib/types";

// หน้า CEO Live (บัญชี Marketing / Owner ที่เข้า Data analytics ได้) — รายละเอียดใน lib/ceo-live.ts
//   GET     วัน CEO Live + ไลฟ์ทั้งวันของวันนั้นและวันก่อน + ข้อมูลรอบ CEO (ข้อมูลวันอื่นไม่ออกจากเซิร์ฟเวอร์)
//   POST    { sessions } บันทึกข้อมูลรอบ CEO ที่ track แยก (วันเดิม = แทนที่) — Owner ที่จัดการ Data analytics ได้
//   DELETE  { date } ลบข้อมูลรอบ CEO ของวันนั้น

const NEED_SQL = "ต้องรัน SQL 20261021000000_marketing ใน Supabase ก่อน ถึงจะบันทึกข้อมูลรอบ CEO ได้";

export async function GET() {
  const r = await requireCeoLive();
  if ("res" in r) return r.res;
  try {
    return ok(await ceoLiveData(!!r.me.owner?.analytics));
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}

export async function POST(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์อัปโหลดข้อมูลรอบ CEO");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const list = Array.isArray(body?.sessions) ? body.sessions : [];
  if (!list.length) return fail("ไม่มีข้อมูลรอบ CEO ให้บันทึก");
  if (list.length > 400) return fail("ส่งได้ครั้งละไม่เกิน 400 วัน");
  const clean = list.map(cleanTracked);
  const bad = clean.findIndex((s: CeoSession | null) => !s);
  if (bad >= 0) return fail(`ข้อมูลลำดับที่ ${bad + 1} ไม่มีวันที่ หรือวันที่ไม่ถูกต้อง`);
  const by = r.me.owner?.name || r.me.email;
  const db = createAdminClient();
  const { error } = await db.from("ceo_sessions").upsert((clean as CeoSession[]).map((s) => toTrackedRow(s, by)), { onConflict: "live_date" });
  if (error) return fail(noTrackedTable(error.message) ? NEED_SQL : error.message, noTrackedTable(error.message) ? 400 : 500);
  await db.from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name ?? "",
    action: `บันทึกข้อมูลรอบ CEO Live ${clean.length} วัน (${(clean as CeoSession[]).map((s) => s.date).join(", ")})`, result: "สำเร็จ",
  });
  return ok({ saved: clean.length });
}

export async function DELETE(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ลบข้อมูลรอบ CEO");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const date = String(body?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("ระบุวันที่ให้ถูกต้อง");
  const db = createAdminClient();
  const { error } = await db.from("ceo_sessions").delete().eq("live_date", date);
  if (error) return fail(error.message, 500);
  await db.from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name ?? "", action: `ลบข้อมูลรอบ CEO Live วันที่ ${date}`, result: "สำเร็จ",
  });
  return ok({ deleted: date });
}
