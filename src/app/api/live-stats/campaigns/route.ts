import { fail, ok, requireAnalytics } from "@/lib/api";
import type { Campaign } from "@/lib/live-stats";
import { createAdminClient } from "@/lib/supabase/server";

// แคมเปญของหน้าสถิติไลฟ์ เฉพาะ Owner
//   GET     รายการแคมเปญ (ใหม่สุดก่อน)
//   POST    { id?, name, startsAt, endsAt, compareId }  เพิ่ม / แก้ไข (compareId = null คือเทียบช่วงเดียวกันของเดือนก่อน)
//   DELETE  { id }

const fromRow = (r: Record<string, unknown>): Campaign => ({
  id: Number(r.id),
  name: String(r.name),
  startsAt: new Date(String(r.starts_at)).toISOString(),
  endsAt: new Date(String(r.ends_at)).toISOString(),
  compareId: r.compare_id === null ? null : Number(r.compare_id),
});

export async function GET() {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ดูสถิติไลฟ์");
  if ("res" in r) return r.res;
  const { data, error } = await createAdminClient().from("live_campaigns")
    .select("id, name, starts_at, ends_at, compare_id").order("starts_at", { ascending: false });
  if (error) return fail(error.message, 500);
  return ok({ campaigns: (data ?? []).map(fromRow) });
}

export async function POST(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์แก้แคมเปญ");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const id = body?.id ? Number(body.id) : null;
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const starts = Date.parse(String(body?.startsAt ?? "")), ends = Date.parse(String(body?.endsAt ?? ""));
  const compareId = body?.compareId ? Number(body.compareId) : null;
  if (!name) return fail("กรุณาใส่ชื่อแคมเปญ");
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return fail("กรุณาใส่วันเวลาเริ่มและจบ");
  if (ends <= starts) return fail("เวลาจบต้องหลังเวลาเริ่ม");
  if (ends - starts > 62 * 86400_000) return fail("แคมเปญยาวได้ไม่เกิน 62 วัน");
  if (compareId && compareId === id) return fail("เลือกเทียบกับแคมเปญตัวเองไม่ได้");

  const db = createAdminClient();
  const row = { name, starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(), compare_id: compareId };
  const { data, error } = id
    ? await db.from("live_campaigns").update(row).eq("id", id).select("id").maybeSingle()
    : await db.from("live_campaigns").insert({ ...row, created_by: r.me.owner?.name || r.me.email }).select("id").single();
  if (error) return fail(error.message, 500);
  if (!data) return fail("ไม่พบแคมเปญนี้ อาจถูกลบไปแล้ว", 404);
  return ok({ id: Number(data.id), message: "บันทึกแคมเปญแล้ว" });
}

export async function DELETE(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ลบแคมเปญ");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return fail("ไม่พบแคมเปญ");
  const { error } = await createAdminClient().from("live_campaigns").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ message: "ลบแคมเปญแล้ว" });
}
