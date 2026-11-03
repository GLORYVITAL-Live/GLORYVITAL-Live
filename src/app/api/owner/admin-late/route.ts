import { fail, ok, requireOwner } from "@/lib/api";
import { writeAdminLate } from "@/lib/sheet-sync";
import { createAdminClient } from "@/lib/supabase/server";

// เจ้าของใส่สถานะ "มาสาย" ให้ Admin (POST { id: admin_slots.id, minutes: 1–300 | null = ลบ })
//   เขียนลงชีตแท็บ Admin เสริม คอลัมน์ M (ช่องเดียวกับที่ทีมพิมพ์) แล้วอัปเดตฐานข้อมูล → หักเงินตามกฎเดิม (pay.ts lateCut)
//   เฉพาะ Owner ที่จัดการฝั่ง Admin ได้ · บันทึกประวัติไว้ใน booking_logs

export const maxDuration = 60;

export async function POST(request: Request) {
  const r = await requireOwner("บัญชีนี้ใส่สถานะมาสายของ Admin ไม่ได้");
  if ("res" in r) return r.res;
  if (!r.scope.admin) return fail("ใส่สถานะมาสายได้เฉพาะ Owner ที่จัดการฝั่ง Admin", 403);
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; minutes?: unknown };
  const id = Number(body.id);
  const minutes = body.minutes === null || body.minutes === "" || Number(body.minutes) === 0 ? null : Number(body.minutes);
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่รู้จักคิวนี้");
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 300)) return fail("ใส่นาทีที่สายเป็นตัวเลข 1–300");

  const db = createAdminClient();
  const { data: s, error } = await db.from("admin_slots")
    .select("id, platform, live_date, start_time, end_time, is_cancelled, late_minutes, bonus_minutes, admin_id, person:staff!admin_id(name)")
    .eq("id", id).maybeSingle();
  if (error) return fail(error.message, 500);
  if (!s) return fail("ไม่พบคิวนี้ (อาจถูกลบไปแล้ว)", 404);
  if (s.is_cancelled) return fail("คิวนี้ถูกยกเลิกแล้ว");
  const person = (s.person as unknown as { name: string } | null)?.name;
  if (!s.admin_id || !person) return fail("คิวนี้ยังไม่มี Admin");

  try {
    await writeAdminLate(s, minutes, s.bonus_minutes ?? null);
  } catch (err) {
    return fail(`เขียนลงชีตไม่สำเร็จ: ${(err as Error).message}`, 502);
  }
  const { error: upErr } = await db.from("admin_slots").update({ late_minutes: minutes }).eq("id", id);
  if (upErr) return fail(upErr.message, 500);
  await db.from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name || r.me.email,
    action: minutes ? `ใส่สถานะมาสาย: ${person} ${minutes} นาที` : `ลบสถานะมาสาย: ${person}`,
    slot_table: "admin_slots", slot_id: id, platform: s.platform, live_date: s.live_date,
    time_range: `${String(s.start_time).slice(0, 5)}-${String(s.end_time).slice(0, 5)}`, result: "สำเร็จ",
  });
  return ok({ late: minutes, message: minutes ? `บันทึกแล้ว: ${person} สาย ${minutes} นาที` : `ลบสถานะมาสายของ ${person} แล้ว` });
}
