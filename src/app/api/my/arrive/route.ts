import { fail, ok, requireMe } from "@/lib/api";
import { ARRIVE_EARLY_MS, arrivalLate, continuedIds } from "@/lib/arrival";
import { platformLabel } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/window";

// Admin กด "มาถึงแล้ว" (src/lib/arrival.ts · SQL 20261118000000_admin_arrival)
//   GET  = คิวที่ต้องกดตอนนี้ (เริ่มภายใน 2 ชม. / กำลังไลฟ์ · คิวแรกของช่วงที่ต่อกัน) → { slot } ไม่มี = null
//   POST { id } = บันทึกเวลาตอนนี้ (เวลาเซิร์ฟเวอร์) · กดแล้วกดซ้ำไม่เปลี่ยนเวลา

const SQL = "ต้องรัน SQL 20261118000000_admin_arrival ใน Supabase ก่อน ถึงจะกดมาถึงแล้วได้";
type Row = { id: number; platform: string; start_time: string; end_time: string; starts_at: string; ends_at: string; arrived_at: string | null };

async function nearSlots(adminId: number, now: number) {
  const today = new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
  const { data, error } = await createAdminClient().from("admin_slots")
    .select("id, platform, start_time, end_time, starts_at, ends_at, arrived_at")
    .eq("admin_id", adminId).eq("is_cancelled", false).or("confirmed.is.null,confirmed.eq.true")
    .gte("live_date", addDays(today, -1)).lte("live_date", addDays(today, 1)).order("starts_at");
  if (error) return { error: /arrived_at/.test(error.message) ? SQL : error.message };
  const rows = (data ?? []) as Row[];
  const cont = continuedIds(rows.map((r) => ({ id: Number(r.id), who: adminId, startMs: Date.parse(r.starts_at), endMs: Date.parse(r.ends_at) })));
  return { rows, cont };
}

const view = (r: Row, rows: Row[], cont: Set<number>) => {
  const startMs = Date.parse(r.starts_at);
  // คิวที่ต่อกันหลังคิวนี้ (กดครั้งเดียวพอ) — บอกเวลาจบของทั้งช่วง
  let end = r;
  for (let next = rows.find((x) => cont.has(Number(x.id)) && x.starts_at === end.ends_at); next; next = rows.find((x) => cont.has(Number(x.id)) && x.starts_at === end.ends_at)) end = next;
  return {
    id: Number(r.id), platform: platformLabel(r.platform), start: r.start_time.slice(0, 5), end: end.end_time.slice(0, 5),
    startMs, endMs: Date.parse(r.ends_at), arrivedAt: r.arrived_at,
    late: r.arrived_at ? arrivalLate(Date.parse(r.arrived_at), startMs) : null,
  };
};

export async function GET() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!r.me.admin) return ok({ slot: null });
  const now = Date.now();
  const s = await nearSlots(r.me.admin.id, now);
  if ("error" in s) return s.error === SQL ? ok({ slot: null, sql: SQL }) : fail(s.error!, 500);
  const cur = s.rows.find((x) => Date.parse(x.ends_at) > now && Date.parse(x.starts_at) - ARRIVE_EARLY_MS <= now && !s.cont.has(Number(x.id)));
  return ok({ slot: cur ? view(cur, s.rows, s.cont) : null });
}

export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!r.me.admin) return fail("ปุ่มมาถึงแล้วใช้ได้เฉพาะ Admin", 403);
  const id = Number(((await request.json().catch(() => ({}))) as { id?: unknown }).id);
  const now = Date.now();
  const s = await nearSlots(r.me.admin.id, now);
  if ("error" in s) return fail(s.error!, s.error === SQL ? 400 : 500);
  const row = s.rows.find((x) => Number(x.id) === id);
  if (!row) return fail("ไม่พบคิวนี้ในตารางของคุณ (อาจถูกยกเลิก / เปลี่ยนคน)", 404);
  if (s.cont.has(id)) return fail("คิวนี้ต่อจากคิวก่อนหน้า ไม่ต้องกดซ้ำ");
  if (now < Date.parse(row.starts_at) - ARRIVE_EARLY_MS) return fail("ยังเร็วเกินไป กดได้ตั้งแต่ 2 ชม. ก่อนเริ่มคิว");
  if (now >= Date.parse(row.ends_at)) return fail("คิวนี้จบไปแล้ว ถ้ามาถึงจริงแจ้งทีมงานให้แก้ในชีต");
  if (!row.arrived_at) {
    const at = new Date(now).toISOString();
    const { data, error } = await createAdminClient().from("admin_slots").update({ arrived_at: at })
      .eq("id", id).is("arrived_at", null).select("arrived_at");
    if (error) return fail(error.message, 500);
    // กดพร้อมกันสองเครื่อง = ใช้เวลาที่บันทึกไว้ก่อน
    row.arrived_at = data?.[0]?.arrived_at ?? (await createAdminClient().from("admin_slots").select("arrived_at").eq("id", id).single()).data?.arrived_at ?? at;
  }
  return ok({ slot: view(row, s.rows, s.cont) });
}
