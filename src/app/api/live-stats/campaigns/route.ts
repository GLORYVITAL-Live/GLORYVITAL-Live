import { fail, ok, requireAnalytics } from "@/lib/api";
import { assignCampaigns, instLabel, previousInstance, type CampInfo } from "@/lib/campaign";
import type { Campaign } from "@/lib/live-stats";
import { createAdminClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/window";

// แคมเปญของหน้าสถิติไลฟ์ เฉพาะ Owner
//   GET     รายการแคมเปญ (ใหม่สุดก่อน) = จากชื่อ Campaign ใน slot (auto, id ติดลบ) + ที่ตั้งเองในหน้านี้
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
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ดูสถิติไลฟ์", "read");
  if ("res" in r) return r.res;
  const db = createAdminClient();
  const { data, error } = await db.from("live_campaigns")
    .select("id, name, starts_at, ends_at, compare_id").order("starts_at", { ascending: false });
  if (error) return fail(error.message, 500);
  // แคมเปญจากตาราง slot (อ่านชื่อ Campaign ทุกรอบ) — ระบบเดียวกับหน้าเจ้าของ > ผลงาน Mc พลาด = แสดงเฉพาะที่ตั้งเอง
  const auto = await slotCampaigns(db).catch((err) => {
    console.warn("โหลดแคมเปญจากตาราง slot ไม่สำเร็จ:", (err as Error).message);
    return [] as Campaign[];
  });
  const all = [...auto, ...(data ?? []).map(fromRow)].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return ok({ campaigns: all });
}

/** รอบแคมเปญจากชื่อใน slot ตั้งแต่ ก.พ. 2026 (เฉพาะรอบที่เริ่มแล้ว) เทียบกับรอบก่อนของประเภทเดียวกัน (Pay Day กับ Pay Day / วันเลขเบิ้ลกับวันเลขเบิ้ล) */
async function slotCampaigns(db: ReturnType<typeof createAdminClient>): Promise<Campaign[]> {
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const rows: { id: number; live_date: string; campaign: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("mc_slots").select("id, live_date, campaign")
      .eq("is_cancelled", false).gte("live_date", "2026-02-01").not("campaign", "is", null).neq("campaign", "")
      .order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const insts = new Map<string, CampInfo>();
  for (const c of assignCampaigns(rows.map((x) => ({ id: Number(x.id), date: x.live_date, campaign: x.campaign }))).values()) insts.set(c.key, c);
  const list = [...insts.values()].filter((c) => c.start <= today);
  // id ติดลบคงที่ต่อรอบ (วันเริ่ม + ชื่อ) ให้การเลือกที่จำไว้ในเครื่องยังชี้รอบเดิม
  const idOf = (c: CampInfo) => -(Number(c.start.replace(/-/g, "")) * 100 + ([...c.nameKey].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 100));
  const midnight = (d: string) => new Date(`${d}T00:00:00+07:00`).toISOString();
  return list.map((c) => {
    const prev = previousInstance(c, list);
    return {
      id: idOf(c), name: instLabel(c), startsAt: midnight(c.start), endsAt: midnight(addDays(c.end, 1)),
      compareId: prev ? idOf(prev) : null, auto: true,
    };
  });
}

export async function POST(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์แก้แคมเปญ");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const id = body?.id ? Number(body.id) : null;
  if (id !== null && id < 0) return fail("แคมเปญนี้มาจากตาราง slot แก้ชื่อ/ช่วงวันที่หน้า Plan Slot Live");
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const starts = Date.parse(String(body?.startsAt ?? "")), ends = Date.parse(String(body?.endsAt ?? ""));
  // เทียบได้เฉพาะแคมเปญที่ตั้งเอง (แคมเปญจากตาราง slot ไม่ได้อยู่ในตารางนี้)
  const compareId = body?.compareId && Number(body.compareId) > 0 ? Number(body.compareId) : null;
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
  if (id < 0) return fail("แคมเปญนี้มาจากตาราง slot ลบไม่ได้ (เอาชื่อ Campaign ออกที่หน้า Plan Slot Live)");
  const { error } = await createAdminClient().from("live_campaigns").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ message: "ลบแคมเปญแล้ว" });
}
