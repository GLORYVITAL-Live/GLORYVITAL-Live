import { after } from "next/server";
import { fail, ok, requireOwner } from "@/lib/api";
import { bkkToday } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import { processSyncJobs } from "@/lib/sync";

// รวมรายชื่อซ้ำ (เช่น ลงชื่อสองครั้ง / สะกดต่างกันในชีต) — POST { sourceId, targetId, dryRun }
//   ย้ายคิวทั้งหมดของ source ไปให้ target (ชีตเขียนชื่อใหม่ให้ผ่าน trigger + ปฏิทินของคิวข้างหน้า)
//   target ไม่มีอีเมล / เบอร์ = ใช้ของ source · รายชื่อ "ให้จองก่อน" ในช่วงเปิดจอง เปลี่ยนเป็น target · แล้วลบ source
//   dryRun = ตรวจก่อน: จะย้ายกี่คิว / ชนเวลากับคิวเดิมของ target กี่คิว

const TABLE = { mc: { table: "mc_slots", col: "mc_id" }, admin: { table: "admin_slots", col: "admin_id" } } as const;
type Person = { id: number; role: string; name: string; email: string | null; phone: string | null };
type Slot = { id: number; live_date: string; starts_at: string; ends_at: string; is_cancelled: boolean };

async function slotsOf(table: string, col: string, personId: number) {
  const db = createAdminClient();
  const out: Slot[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("id, live_date, starts_at, ends_at, is_cancelled").eq(col, personId).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Slot[]));
    if (!data || data.length < 1000) return out;
  }
}

export async function POST(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const sourceId = Number(body?.sourceId), targetId = Number(body?.targetId);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId === targetId) return fail("เลือกรายชื่อที่จะรวมให้ถูกต้อง");

  const db = createAdminClient();
  const { data: rows, error } = await db.from("staff").select("id, role, name, email, phone").in("id", [sourceId, targetId]);
  if (error) return fail(error.message, 500);
  const source = (rows ?? []).find((p) => p.id === sourceId) as Person | undefined;
  const target = (rows ?? []).find((p) => p.id === targetId) as Person | undefined;
  if (!source || !target) return fail("ไม่พบรายชื่อ (อาจถูกลบไปแล้ว)", 404);
  if (source.role !== target.role || (source.role !== "mc" && source.role !== "admin")) return fail("รวมได้เฉพาะ Mc กับ Mc หรือ Admin กับ Admin");
  const role = source.role as "mc" | "admin";
  if (!(role === "mc" ? r.scope.mc : r.scope.admin)) return fail(`บัญชีนี้ไม่มีสิทธิ์จัดการฝั่ง ${role === "mc" ? "Mc" : "Admin"}`, 403);
  const label = (p: Person) => (role === "mc" ? `Mc ${p.name}` : p.name);

  const { table, col } = TABLE[role];
  const today = bkkToday();
  const [src, tgt] = await Promise.all([slotsOf(table, col, sourceId), slotsOf(table, col, targetId)]);
  const upcoming = src.filter((s) => s.live_date >= today && !s.is_cancelled);
  const tgtUpcoming = tgt.filter((s) => s.live_date >= today && !s.is_cancelled);
  const overlaps = (a: Slot, b: Slot) => Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);
  const conflicts = upcoming.filter((s) => tgtUpcoming.some((t) => overlaps(s, t))).length;
  const moveEmail = !target.email && !!source.email;
  const movePhone = !target.phone && !!source.phone;
  const summary = {
    source: label(source), target: label(target), total: src.length, upcoming: upcoming.length, conflicts,
    moveEmail: moveEmail ? source.email : null, movePhone: movePhone ? source.phone : null,
  };
  if (body?.dryRun) return ok({ summary });

  // 1) อีเมล / เบอร์ (อีเมลห้ามซ้ำ: ล้างของ source ก่อน)
  if (moveEmail) {
    const a = await db.from("staff").update({ email: null }).eq("id", sourceId);
    if (a.error) return fail(a.error.message, 500);
    const b = await db.from("staff").update({ email: source.email }).eq("id", targetId);
    if (b.error) return fail(b.error.message, 500);
  }
  if (movePhone) await db.from("staff").update({ phone: source.phone }).eq("id", targetId);

  // 2) ย้ายคิวทั้งหมด (trigger จดงานเขียนชื่อใหม่ลงชีตให้) + ปฏิทินของคิวข้างหน้า
  const moved = await db.from(table).update({ [col]: targetId }).eq(col, sourceId);
  if (moved.error) return fail(`ย้ายคิวไม่สำเร็จ: ${moved.error.message}`, 500);
  if (upcoming.length) {
    for (let i = 0; i < upcoming.length; i += 500) {
      await db.from("calendar_jobs").insert(upcoming.slice(i, i + 500).map((s) => ({ slot_table: table, slot_id: s.id })));
    }
  }

  // 3) รายชื่อ "ให้จองก่อน" ในช่วงเปิดจอง
  const key = `book_window_${role}`;
  const { data: st } = await db.from("settings").select(key).eq("id", 1).maybeSingle();
  const w = (st as Record<string, { only?: unknown[] } | null> | null)?.[key];
  if (w && Array.isArray(w.only) && w.only.map(Number).includes(sourceId)) {
    const only = [...new Set(w.only.map(Number).map((n) => (n === sourceId ? targetId : n)))];
    await db.from("settings").update({ [key]: { ...w, only } }).eq("id", 1);
  }

  // 4) ลบรายชื่อซ้ำ
  const del = await db.from("staff").delete().eq("id", sourceId);
  await db.from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name ?? "",
    action: `รวมรายชื่อ ${role === "mc" ? "Mc" : "Admin"} "${source.name}" เข้ากับ "${target.name}" (ย้าย ${src.length} คิว)`,
    result: del.error ? `ย้ายคิวแล้ว แต่ลบรายชื่อเดิมไม่สำเร็จ: ${del.error.message}` : "สำเร็จ",
  });
  after(() => processSyncJobs().then(() => undefined));
  if (del.error) return fail(`ย้ายคิวไป ${label(target)} แล้ว แต่ลบ ${label(source)} ไม่สำเร็จ: ${del.error.message}`, 500);
  return ok({ summary, message: `รวม ${label(source)} เข้ากับ ${label(target)} แล้ว (ย้าย ${src.length} คิว)` });
}
