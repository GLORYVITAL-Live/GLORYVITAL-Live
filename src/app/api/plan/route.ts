import { after } from "next/server";
import { fail, monthRange, ok, requirePlanner } from "@/lib/api";
import { deleteSheetRows } from "@/lib/sheet-sync";
import { processSyncJobs } from "@/lib/sync";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

// หน้า Plan Slot Live: แพลน slot ทั้งเดือน แล้วเขียนลงชีตทั้งแท็บ "ลงตาราง Deal Mc" และ "ลงตาราง Admin เสริม"
//   GET    ?month=YYYY-MM  slot ที่มีอยู่แล้วทั้งเดือน (จับคู่ Mc + Admin) + แพลตฟอร์ม / แคมเปญที่เคยใช้
//   POST   { create: [{ date, platform, start, end, campaign }], campaigns: [{ mcId, campaign }] }
//          สร้าง slot (ทั้งฝั่ง Mc + Admin ข้ามที่มีอยู่แล้ว) + แก้ Campaign ของ slot เดิม
//   DELETE { slots: [{ mcId?, adminId? }] }  ลบ slot ที่ยังว่าง (ไม่มีคน + ไม่มี event ในปฏิทิน)
// สิทธิ์: Owner ที่ติ๊ก "Plan Slot Live" เท่านั้น (เขียนได้ทั้งสองแท็บ)

export const maxDuration = 60;

type Table = "mc_slots" | "admin_slots";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_CREATE = 1500;
const MAX_DELETE = 500;

const hm = (t: string) => t.slice(0, 5);
const keyOf = (x: { platform: string; live_date: string; start_time: string; end_time: string }) =>
  `${x.platform}|${x.live_date}|${hm(x.start_time)}|${hm(x.end_time)}`;
const cleanCampaign = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 100);

async function log(me: Me, action: string, table: Table, ids: number[]) {
  const db = createAdminClient();
  for (let i = 0; i < ids.length; i += 500) {
    await db.from("booking_logs").insert(ids.slice(i, i + 500).map((id) => ({
      email: me.email, role: "Owner", name: me.owner?.name ?? "", action, slot_table: table, slot_id: id, result: "สำเร็จ",
    })));
  }
}

/** อ่านทุกแถวของคำสั่ง select (ทีละ 1000) */
async function all<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// ---------- GET ----------

type SlotRow = {
  id: number; platform: string; live_date: string; start_time: string; end_time: string;
  is_cancelled: boolean; calendar_event_id: string | null; person: { name: string } | null;
};

export async function GET(request: Request) {
  const r = await requirePlanner();
  if ("res" in r) return r.res;
  const { key: month, first, last } = monthRange(new URL(request.url).searchParams.get("month"));
  const db = createAdminClient();
  const cols = "id, platform, live_date, start_time, end_time, is_cancelled, calendar_event_id";
  const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);

  try {
    const [mc, admin, recent] = await Promise.all([
      all<SlotRow & { mc_id: number | null; campaign: string }>((a, b) => db.from("mc_slots")
        .select(`${cols}, mc_id, campaign, person:staff!mc_id(name)`).gte("live_date", first).lte("live_date", last).order("id").range(a, b)),
      all<SlotRow & { admin_id: number | null; needs_extra_admin: boolean }>((a, b) => db.from("admin_slots")
        .select(`${cols}, admin_id, needs_extra_admin, person:staff!admin_id(name)`).gte("live_date", first).lte("live_date", last).order("id").range(a, b)),
      all<{ platform: string; campaign: string }>((a, b) => db.from("mc_slots")
        .select("platform, campaign").gte("live_date", since).order("id").range(a, b)),
    ]);

    // จับคู่ Mc + Admin ของ slot เดียวกันด้วย แพลตฟอร์ม + วัน + เวลาเริ่ม + เวลาจบ
    type Plan = {
      key: string; date: string; platform: string; start: string; end: string; campaign: string;
      mc: { id: number; name: string; cancelled: boolean; free: boolean } | null;
      admin: { id: number; name: string; cancelled: boolean; free: boolean; extra: boolean } | null;
    };
    const rows = new Map<string, Plan>();
    const base = (x: SlotRow): Plan => ({
      key: keyOf(x), date: x.live_date, platform: x.platform, start: hm(x.start_time), end: hm(x.end_time), campaign: "", mc: null, admin: null,
    });
    for (const x of mc) {
      const row = rows.get(keyOf(x)) ?? base(x);
      if (!row.mc) {
        row.mc = { id: x.id, name: x.person?.name ?? "", cancelled: x.is_cancelled, free: !x.mc_id && !x.calendar_event_id };
        row.campaign = x.campaign ?? "";
      }
      rows.set(row.key, row);
    }
    for (const x of admin) {
      const row = rows.get(keyOf(x)) ?? base(x);
      if (!row.admin) {
        row.admin = {
          id: x.id, name: x.person?.name ?? "", cancelled: x.is_cancelled, free: !x.admin_id && !x.calendar_event_id, extra: x.needs_extra_admin,
        };
      }
      rows.set(row.key, row);
    }

    const count = (list: string[]) => {
      const m = new Map<string, number>();
      for (const v of list) if (v) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    };
    return ok({
      month,
      slots: [...rows.values()].sort((a, b) =>
        a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform) || a.start.localeCompare(b.start)),
      // ใช้บ่อยก่อน
      platforms: count([...recent.map((x) => x.platform), ...[...rows.values()].map((x) => x.platform)]),
      campaigns: count(recent.map((x) => x.campaign)).slice(0, 30),
    });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}

// ---------- POST: สร้าง slot + แก้ Campaign ----------

export async function POST(request: Request) {
  const r = await requirePlanner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const create: { date: string; platform: string; start: string; end: string; campaign: string }[] = [];
  for (const x of Array.isArray(body?.create) ? body.create : []) {
    const platform = String(x?.platform ?? "").trim().slice(0, 60);
    const date = String(x?.date ?? "");
    const start = String(x?.start ?? "");
    const end = String(x?.end ?? "");
    if (!platform) return fail("มี slot ที่ไม่ได้ใส่แพลตฟอร์ม");
    if (!DATE_RE.test(date)) return fail("มี slot ที่วันที่ไม่ถูกต้อง");
    if (!TIME_RE.test(start) || !TIME_RE.test(end) || start === end) return fail(`ช่วงเวลา ${start}–${end} ไม่ถูกต้อง`);
    create.push({ date, platform, start, end, campaign: cleanCampaign(x?.campaign) });
  }
  const campaigns: { mcId: number; campaign: string }[] = [];
  for (const x of Array.isArray(body?.campaigns) ? body.campaigns : []) {
    if (!Number.isInteger(x?.mcId)) return fail("ข้อมูล Campaign ไม่ถูกต้อง");
    campaigns.push({ mcId: x.mcId, campaign: cleanCampaign(x?.campaign) });
  }
  if (!create.length && !campaigns.length) return fail("ยังไม่มีอะไรให้บันทึก");
  if (create.length > MAX_CREATE) return fail(`สร้างได้ครั้งละไม่เกิน ${MAX_CREATE} slot`);
  if (campaigns.length > MAX_CREATE) return fail(`แก้ Campaign ได้ครั้งละไม่เกิน ${MAX_CREATE} slot`);

  const db = createAdminClient();
  try {
    // ข้าม slot ที่มีอยู่แล้ว (แพลตฟอร์ม + วัน + เวลาเดียวกัน) และที่ส่งมาซ้ำกัน แยกแต่ละฝั่ง
    const dates = [...new Set(create.map((x) => x.date))];
    const platforms = [...new Set(create.map((x) => x.platform))];
    const existing = async (table: Table) => {
      if (!create.length) return new Set<string>();
      const rows = await all<{ platform: string; live_date: string; start_time: string; end_time: string }>((a, b) => db.from(table)
        .select("platform, live_date, start_time, end_time").in("platform", platforms).in("live_date", dates).order("id").range(a, b));
      return new Set(rows.map(keyOf));
    };
    const [haveMc, haveAdmin] = await Promise.all([existing("mc_slots"), existing("admin_slots")]);
    const pick = (have: Set<string>) => {
      const seen = new Set(have);
      return create.filter((x) => {
        const k = keyOf({ platform: x.platform, live_date: x.date, start_time: x.start, end_time: x.end });
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    const row = (x: (typeof create)[number]) => ({ live_date: x.date, start_time: x.start, end_time: x.end, platform: x.platform });
    const newMc = pick(haveMc).map((x) => ({ ...row(x), campaign: x.campaign }));
    const newAdmin = pick(haveAdmin).map((x) => ({ ...row(x), remark: "" }));

    const insert = async (table: Table, rows: object[]) => {
      const ids: number[] = [];
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await db.from(table).insert(rows.slice(i, i + 500)).select("id");
        if (error) throw new Error(error.message);
        ids.push(...(data ?? []).map((x) => x.id as number));
      }
      return ids;
    };
    const mcIds = await insert("mc_slots", newMc);
    const adminIds = await insert("admin_slots", newAdmin);

    // แก้ Campaign ของ slot เดิม: รวมตามค่าที่ตั้ง (ยิงครั้งเดียวต่อ Campaign)
    const byCampaign = new Map<string, number[]>();
    for (const c of campaigns) byCampaign.set(c.campaign, [...(byCampaign.get(c.campaign) ?? []), c.mcId]);
    let updated = 0;
    for (const [campaign, ids] of byCampaign) {
      for (let i = 0; i < ids.length; i += 300) {
        const { data, error } = await db.from("mc_slots").update({ campaign }).in("id", ids.slice(i, i + 300)).neq("campaign", campaign).select("id");
        if (error) throw new Error(error.message);
        updated += data?.length ?? 0;
      }
    }

    // หลังตอบผู้ใช้: เขียนชีต (DB trigger จดงานเขียนชีตไว้ให้แล้ว)
    after(async () => {
      await processSyncJobs();
      await log(r.me, "Plan Slot Live: สร้าง slot", "mc_slots", mcIds);
      await log(r.me, "Plan Slot Live: สร้าง slot", "admin_slots", adminIds);
      if (updated) await log(r.me, "Plan Slot Live: แก้ Campaign", "mc_slots", campaigns.map((c) => c.mcId));
    });
    return ok({
      created: mcIds.length, adminCreated: adminIds.length, skipped: create.length - Math.max(mcIds.length, adminIds.length), updated,
    });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}

// ---------- DELETE: ลบ slot ที่ยังว่าง ----------

export async function DELETE(request: Request) {
  const r = await requirePlanner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const ids: Record<Table, number[]> = { mc_slots: [], admin_slots: [] };
  for (const s of Array.isArray(body?.slots) ? body.slots : []) {
    if (Number.isInteger(s?.mcId)) ids.mc_slots.push(s.mcId);
    if (Number.isInteger(s?.adminId)) ids.admin_slots.push(s.adminId);
  }
  if (!ids.mc_slots.length && !ids.admin_slots.length) return fail("ไม่ได้เลือก slot");
  if (ids.mc_slots.length > MAX_DELETE || ids.admin_slots.length > MAX_DELETE) return fail(`ลบได้ครั้งละไม่เกิน ${MAX_DELETE} slot`);

  const db = createAdminClient();
  type Row = { id: number; platform: string; live_date: string; start_time: string; end_time: string; calendar_event_id: string | null } & Record<string, unknown>;
  const removed: Record<Table, Row[]> = { mc_slots: [], admin_slots: [] };
  let kept = 0;
  try {
    for (const table of ["mc_slots", "admin_slots"] as const) {
      if (!ids[table].length) continue;
      const personCol = table === "mc_slots" ? "mc_id" : "admin_id";
      const rows = await all<Row>((a, b) => db.from(table)
        .select(`id, platform, live_date, start_time, end_time, calendar_event_id, ${personCol}`).in("id", ids[table]).order("id").range(a, b));
      // ลบได้เฉพาะ slot ที่ไม่มีคนและไม่มี event ในปฏิทินค้าง (ไม่งั้น event จะค้างในปฏิทิน)
      const free = rows.filter((x) => !x[personCol] && !x.calendar_event_id);
      kept += rows.length - free.length;
      for (let i = 0; i < free.length; i += 300) {
        // ตรวจซ้ำตอนลบ กันมีคนจองเข้ามาระหว่างนั้น
        const { data, error } = await db.from(table).delete()
          .in("id", free.slice(i, i + 300).map((x) => x.id)).is(personCol, null).is("calendar_event_id", null).select("id");
        if (error) throw new Error(error.message);
        const done = new Set((data ?? []).map((x) => x.id as number));
        kept += free.slice(i, i + 300).length - done.size;
        removed[table].push(...free.slice(i, i + 300).filter((x) => done.has(x.id)));
      }
    }
  } catch (err) {
    return fail((err as Error).message, 500);
  }

  after(async () => {
    // ลบแถวของ slot เหล่านี้ในชีตด้วย
    for (const table of ["mc_slots", "admin_slots"] as const) {
      if (!removed[table].length) continue;
      try { await deleteSheetRows(table, removed[table]); } catch (err) { console.warn("ลบแถวในชีตไม่สำเร็จ:", err); }
      await log(r.me, "Plan Slot Live: ลบ slot", table, removed[table].map((x) => x.id));
    }
  });
  return ok({ deleted: Math.max(removed.mc_slots.length, removed.admin_slots.length), kept });
}
