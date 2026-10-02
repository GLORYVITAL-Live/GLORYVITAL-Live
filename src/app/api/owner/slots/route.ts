import { after } from "next/server";
import { canTable, fail, ok, requireOwner as requireOwnerScope } from "@/lib/api";
import { deleteSheetRows } from "@/lib/sheet-sync";
import { processSyncJobs } from "@/lib/sync";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

// จัดการ slot สำหรับเจ้าของ (แทนการพิมพ์ในแท็บ "ลงตาราง Deal Mc" / "ลงตาราง Admin เสริม")
//   GET    ?date=YYYY-MM-DD  slot ทั้งหมดของวันนั้น (จับคู่ Mc + Admin) + รายชื่อคน + แพลตฟอร์มที่เคยใช้
//   POST   สร้าง slot หลายวัน x หลายช่วงเวลา (ข้ามที่มีอยู่แล้ว)
//   PATCH  แก้ slot เดียว: คน / สถานะ / เปิดรับ Admin เสริม
//   DELETE ลบ slot ที่ยังไม่มีคน
// ทุกคำสั่งทำได้เฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์ (Mc / Admin)

type Table = "mc_slots" | "admin_slots";
const EXTRA = "Admin เสริม";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_CREATE = 500;

const requireOwner = () => requireOwnerScope("บัญชีนี้ไม่มีสิทธิ์จัดการ slot");
const noScope = (table: Table) => fail(`บัญชีนี้ไม่มีสิทธิ์จัดการฝั่ง ${table === "mc_slots" ? "Mc" : "Admin"}`, 403);

const hm = (t: string) => t.slice(0, 5);

async function log(me: Me, action: string, table: Table, ids: number[], result: string) {
  if (!ids.length) return;
  await createAdminClient().from("booking_logs").insert(ids.map((id) => ({
    email: me.email, role: "Owner", name: me.owner?.name ?? "", action, slot_table: table, slot_id: id, result,
  })));
}

async function queueCalendar(jobs: { slot_table: Table; slot_id: number }[]) {
  if (!jobs.length) return;
  await createAdminClient().from("calendar_jobs").insert(jobs);
}

// หลังตอบผู้ใช้: ลงปฏิทิน + เขียนชีต (DB trigger จดงานเขียนชีตไว้ให้แล้ว)
const syncLater = () => after(() => processSyncJobs().then(() => undefined));

// ---------- GET ----------

export async function GET(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!DATE_RE.test(date)) return fail("วันที่ไม่ถูกต้อง");

  const db = createAdminClient();
  const cols = "id, platform, start_time, end_time, starts_at, ends_at, confirmed, status, is_cancelled, calendar_event_id";
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const [mc, admin, staff, recent] = await Promise.all([
    db.from("mc_slots").select(`${cols}, mc_id, person:staff!mc_id(name)`).eq("live_date", date).order("starts_at"),
    db.from("admin_slots").select(`${cols}, admin_id, remark, needs_extra_admin, person:staff!admin_id(name)`).eq("live_date", date).order("starts_at"),
    db.from("staff").select("id, role, name, email, is_extra_admin").in("role", ["mc", "admin"]).order("name"),
    db.from("mc_slots").select("platform").gte("live_date", since).limit(5000),
  ]);
  for (const x of [mc, admin, staff, recent]) if (x.error) return fail(x.error.message, 500);

  type Row = {
    id: number; platform: string; start_time: string; end_time: string; starts_at: string; ends_at: string;
    confirmed: boolean | null; status: string; is_cancelled: boolean; calendar_event_id: string | null;
    person: { name: string } | null;
  };
  const side = (x: Row, personId: number | null) => ({
    id: x.id, personId, name: x.person?.name ?? "", status: x.status, cancelled: x.is_cancelled,
    confirmed: x.confirmed, onCalendar: !!x.calendar_event_id,
  });

  // จับคู่ Mc + Admin ของ slot เดียวกันด้วย platform + เวลาเริ่ม + เวลาจบ
  const rows = new Map<string, {
    key: string; platform: string; start: string; end: string; startMs: number;
    mc: ReturnType<typeof side> | null;
    admin: (ReturnType<typeof side> & { extra: boolean }) | null;
  }>();
  const keyOf = (x: Row) => `${x.platform}|${Date.parse(x.starts_at)}|${Date.parse(x.ends_at)}`;
  const base = (x: Row) => ({
    key: keyOf(x), platform: x.platform, start: hm(x.start_time), end: hm(x.end_time), startMs: Date.parse(x.starts_at),
    mc: null, admin: null,
  });
  for (const x of (mc.data ?? []) as unknown as (Row & { mc_id: number | null })[]) {
    const k = keyOf(x);
    const row = rows.get(k) ?? base(x);
    if (!row.mc) row.mc = side(x, x.mc_id);
    rows.set(k, row);
  }
  for (const x of (admin.data ?? []) as unknown as (Row & { admin_id: number | null; needs_extra_admin: boolean })[]) {
    const k = keyOf(x);
    const row = rows.get(k) ?? base(x);
    if (!row.admin) row.admin = { ...side(x, x.admin_id), extra: x.needs_extra_admin };
    rows.set(k, row);
  }

  // ซ่อนฝั่งที่ไม่มีสิทธิ์ (slot ที่มีแต่ฝั่งนั้นไม่แสดงเลย)
  const { mc: canMc, admin: canAdmin } = r.scope;
  const visible = [...rows.values()]
    .map((x) => ({ ...x, mc: canMc ? x.mc : null, admin: canAdmin ? x.admin : null }))
    .filter((x) => x.mc || x.admin);

  const platforms = [...new Set((recent.data ?? []).map((p) => p.platform).filter(Boolean))].sort();
  return ok({
    date,
    // เรียงแพลตฟอร์มก่อน แล้วค่อยเวลา (เหมือนในชีต)
    slots: visible.sort((a, b) => a.platform.localeCompare(b.platform) || a.startMs - b.startMs),
    staff: {
      mc: canMc ? (staff.data ?? []).filter((s) => s.role === "mc").map((s) => ({ id: s.id, name: s.name, hasEmail: !!s.email })) : [],
      admin: canAdmin
        ? (staff.data ?? []).filter((s) => s.role === "admin").map((s) => ({ id: s.id, name: s.name, hasEmail: !!s.email, extra: s.is_extra_admin }))
        : [],
    },
    platforms,
  });
}

// ---------- POST: สร้าง slot ----------

export async function POST(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const platform = String(body?.platform ?? "").trim();
  const dates: string[] = Array.isArray(body?.dates) ? [...new Set<string>(body.dates.map(String))] : [];
  const times: { start: string; end: string }[] = Array.isArray(body?.times) ? body.times : [];
  const extraAdmin = !!body?.extraAdmin;

  if (!platform) return fail("กรุณาใส่แพลตฟอร์ม");
  if (!dates.length || !dates.every((d) => DATE_RE.test(d))) return fail("กรุณาเลือกวันที่");
  if (!times.length || !times.every((t) => TIME_RE.test(t?.start) && TIME_RE.test(t?.end) && t.start !== t.end)) {
    return fail("ช่วงเวลาไม่ถูกต้อง (รูปแบบ HH:MM และเวลาเริ่มต้องไม่เท่ากับเวลาจบ)");
  }
  if (dates.length * times.length > MAX_CREATE) return fail(`สร้างได้ครั้งละไม่เกิน ${MAX_CREATE} slot`);

  const db = createAdminClient();
  const k = (d: string, s: string, e: string) => `${d}|${hm(s)}|${hm(e)}`;
  const existing = async (table: Table) => {
    const { data, error } = await db.from(table).select("live_date, start_time, end_time")
      .eq("platform", platform).in("live_date", dates);
    if (error) throw error;
    return new Set((data ?? []).map((x) => k(x.live_date, x.start_time, x.end_time)));
  };
  const [haveMc, haveAdmin] = await Promise.all([existing("mc_slots"), existing("admin_slots")]);

  // สร้างเฉพาะฝั่งที่มีสิทธิ์ (Owner ที่มีสิทธิ์ทั้งคู่ได้ทั้ง Mc + Admin เหมือนเดิม)
  const wanted = dates.flatMap((d) => times.map((t) => ({ live_date: d, start_time: t.start, end_time: t.end })));
  const newMc = !r.scope.mc ? [] : wanted.filter((w) => !haveMc.has(k(w.live_date, w.start_time, w.end_time))).map((w) => ({ ...w, platform }));
  const newAdmin = !r.scope.admin ? [] : wanted.filter((w) => !haveAdmin.has(k(w.live_date, w.start_time, w.end_time)))
    .map((w) => ({ ...w, platform, remark: extraAdmin ? EXTRA : "" }));

  const insMc = newMc.length ? await db.from("mc_slots").insert(newMc).select("id") : { data: [], error: null };
  if (insMc.error) return fail(insMc.error.message, 500);
  const insAdmin = newAdmin.length ? await db.from("admin_slots").insert(newAdmin).select("id") : { data: [], error: null };
  if (insAdmin.error) return fail(insAdmin.error.message, 500);

  syncLater();
  after(async () => {
    await log(r.me, "สร้าง slot", "mc_slots", (insMc.data ?? []).map((x) => x.id), "สำเร็จ");
    await log(r.me, "สร้าง slot", "admin_slots", (insAdmin.data ?? []).map((x) => x.id), "สำเร็จ");
  });
  const created = r.scope.mc ? newMc.length : newAdmin.length;
  return ok({ created, skipped: wanted.length - created, adminCreated: newAdmin.length });
}

// ---------- PATCH: แก้ slot ----------

export async function PATCH(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const table = body?.table as Table;
  const id = Number(body?.id);
  if ((table !== "mc_slots" && table !== "admin_slots") || !Number.isInteger(id)) return fail("ข้อมูล slot ไม่ถูกต้อง");
  if (!canTable(r.scope, table)) return noScope(table);

  const personCol = table === "mc_slots" ? "mc_id" : "admin_id";
  const role = table === "mc_slots" ? "mc" : "admin";
  const changes: Record<string, unknown> = {};
  const what: string[] = [];

  if ("personId" in (body ?? {})) {
    const pid = body.personId === null || body.personId === "" ? null : Number(body.personId);
    if (pid !== null) {
      const { data: p } = await createAdminClient().from("staff").select("id").eq("id", pid).eq("role", role).maybeSingle();
      if (!p) return fail("ไม่พบรายชื่อนี้");
    }
    changes[personCol] = pid;
    changes.confirmed = pid === null ? null : true;
    what.push(pid === null ? "เอาคนออก" : "กำหนดคน");
  }
  if (typeof body?.status === "string") {
    changes.status = body.status.trim().slice(0, 100);
    what.push(`สถานะ "${changes.status}"`);
  }
  if (table === "admin_slots" && typeof body?.extraAdmin === "boolean") {
    changes.remark = body.extraAdmin ? EXTRA : "";
    what.push(body.extraAdmin ? "เปิดรับ Admin เสริม" : "ปิดรับ Admin เสริม");
  }
  if (!what.length) return fail("ไม่มีอะไรเปลี่ยน");

  const { error } = await createAdminClient().from(table).update(changes).eq("id", id);
  if (error) return fail(error.message, 500);

  // มีผลกับปฏิทินเมื่อเปลี่ยนคนหรือสถานะ (เช่น แคน = ลบ event)
  if (personCol in changes || "status" in changes) await queueCalendar([{ slot_table: table, slot_id: id }]);
  syncLater();
  after(() => log(r.me, `แก้ slot: ${what.join(", ")}`, table, [id], "สำเร็จ"));
  return ok({ message: "บันทึกแล้ว" });
}

// ---------- DELETE: ลบ slot ที่ยังว่าง ----------

export async function DELETE(request: Request) {
  const r = await requireOwner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  type SlotRow = { id: number; platform: string; live_date: string; start_time: string; end_time: string };
  const targets: { table: Table; id: number; row?: SlotRow }[] = [];
  if (Number.isInteger(body?.mcId)) targets.push({ table: "mc_slots", id: body.mcId });
  if (Number.isInteger(body?.adminId)) targets.push({ table: "admin_slots", id: body.adminId });
  if (!targets.length) return fail("ไม่ได้เลือก slot");
  const denied = targets.find((t) => !canTable(r.scope, t.table));
  if (denied) return noScope(denied.table);

  const db = createAdminClient();
  // ลบได้เฉพาะ slot ที่ไม่มีคนและไม่มี event ในปฏิทินค้าง (ไม่งั้น event จะค้างในปฏิทิน)
  // เก็บแพลตฟอร์ม/วัน/เวลาไว้ใช้หาแถวในชีตหลังลบ (กันลบแถวคัดลอกที่รหัสซ้ำ)
  for (const t of targets) {
    const personCol = t.table === "mc_slots" ? "mc_id" : "admin_id";
    const { data, error } = await db.from(t.table)
      .select(`id, platform, live_date, start_time, end_time, ${personCol}, calendar_event_id`).eq("id", t.id).maybeSingle();
    if (error) return fail(error.message, 500);
    const row = data as Record<string, unknown> | null;
    if (row && (row[personCol] || row.calendar_event_id)) {
      return fail("slot นี้มีคนอยู่ หรือยังมี event ในปฏิทิน ให้เอาคนออกก่อน แล้วรอ 1 นาทีค่อยลบ");
    }
    if (row) t.row = row as unknown as SlotRow;
  }
  for (const t of targets) {
    const { error } = await db.from(t.table).delete().eq("id", t.id);
    if (error) return fail(error.message, 500);
  }
  after(async () => {
    // ลบแถวของ slot นี้ในชีตด้วย
    for (const t of targets) {
      try { if (t.row) await deleteSheetRows(t.table, [t.row]); } catch (err) { console.warn("ลบแถวในชีตไม่สำเร็จ:", err); }
      await log(r.me, "ลบ slot", t.table, [t.id], "สำเร็จ");
    }
  });
  return ok({ message: "ลบ slot แล้ว" });
}
