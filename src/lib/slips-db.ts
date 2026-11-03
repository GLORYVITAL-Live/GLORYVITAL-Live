import "server-only";
import { driveClient, driveError } from "@/lib/drive";
import { withSyncLock } from "@/lib/lock";
import { notifyMany } from "@/lib/notifications";
import { allRows, chunks, listIn, type DFile } from "@/lib/receipts-db";
import {
  SLIP_NOTIFY_DAYS, matchSlip, slipFileOk, slipGroupLabel, slipGroupRole, slipPersonKeys, slipRound, slipRoundLabel, type SlipRole,
} from "@/lib/slips";
import { isTestAccount } from "@/lib/staff-check";
import { createAdminClient } from "@/lib/supabase/server";
import type { MySlip, OwnerSlips, SlipScan } from "@/lib/types";

/**
 * สลิปโอนเงินค่าจ้าง (ตาราง pay_slips — SQL 20261120000000_pay_slips) — กติกาอ่านชื่อ / จับคู่อยู่ที่ src/lib/slips.ts
 *   ตรวจโฟลเดอร์ Slip (settings.pay_slip_drive_folder): cron ทุกชั่วโมง + Owner กด "ตรวจสลิปใน Drive"
 *   อ่าน Drive อย่างเดียว (ไม่ย้าย / ไม่เปลี่ยนชื่อ / ไม่ลบไฟล์) · จับคู่แล้วแจ้งเจ้าตัวเฉพาะสลิปที่เพิ่งอัป (ไม่เกิน SLIP_NOTIFY_DAYS วัน)
 *   ไฟล์ส่งผ่านเซิร์ฟเวอร์ (/api/slips/file) ไม่เปิดลิงก์ Drive ให้ใคร
 */

type Db = ReturnType<typeof createAdminClient>;
type SlipRow = {
  id: number; drive_file_id: string; round: string; round_date: string | null; role: SlipRole; grp: string; file_name: string;
  mime: string; size: number; name_key: string; staff_id: number | null; matched_by: "auto" | "owner" | null; file_created_at: string | null;
};
type Seen = Omit<SlipRow, "id" | "staff_id" | "matched_by">;

export const SLIP_SQL = "ต้องรัน SQL 20261120000000_pay_slips ใน Supabase ก่อน";
const FOLDER = "application/vnd.google-apps.folder";
const dbError = (msg: string) => new Error(/pay_slip|schema cache|does not exist/i.test(msg) ? SLIP_SQL : msg);
const status = (msg: string, code: number) => Object.assign(new Error(msg), { status: code });
const label = (s: { role: string; name: string }) => (s.role === "mc" ? `Mc ${s.name}` : s.name);

/** id โฟลเดอร์ Slip (ยังไม่ได้ตั้ง = null · ยังไม่ได้รัน SQL = throw) */
async function slipFolder(db: Db) {
  const { data, error } = await db.from("settings").select("pay_slip_drive_folder").eq("id", 1).maybeSingle();
  if (error) throw dbError(error.message);
  return (data?.pay_slip_drive_folder as string | null | undefined)?.trim() || null;
}

/** อ่านไฟล์ทั้งหมด: Slip > รอบ (261002) > ไฟล์ หรือ โฟลเดอร์กลุ่ม > ไฟล์ — เฉพาะรูป / PDF ที่รู้ฝั่ง (จากชื่อกลุ่ม / ชื่อไฟล์) */
async function readDrive(root: string) {
  const drive = driveClient();
  const rounds = (await listIn(drive, [root], "folders")).flatMap((f) => {
    const r = slipRound(f.name);
    return r ? [{ ...f, ...r }] : [];
  });
  const roundOf = new Map(rounds.map((f) => [f.id, f]));
  const items = rounds.length ? await listIn(drive, rounds.map((f) => f.id), "all") : [];
  const groups = items.filter((x) => x.mime === FOLDER);
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  const grouped = groups.length ? await listIn(drive, groups.map((g) => g.id), "files") : [];
  const seen = new Map<string, Seen>();
  const add = (f: DFile, roundId: string, group: DFile | null) => {
    const round = roundOf.get(roundId);
    const role = (group ? slipGroupRole(group.name) : null) ?? slipGroupRole(f.name);
    if (!round || !role || !slipFileOk(f.mime)) return;
    seen.set(f.id, {
      drive_file_id: f.id, round: round.round, round_date: round.date, role, grp: group ? slipGroupLabel(group.name) : "",
      file_name: f.name, mime: f.mime, size: f.size, name_key: slipPersonKeys(f.name)[0] ?? "", file_created_at: f.created,
    });
  };
  for (const f of items) if (f.mime !== FOLDER) add(f, f.parent, null);
  for (const f of grouped) {
    const g = groupOf.get(f.parent);
    if (g) add(f, g.parent, g);
  }
  return seen;
}

/** จับคู่สลิปที่ยังไม่มีเจ้าของ: ชื่อที่ Owner เคยเลือก (ฝั่ง + ชื่อเดียวกัน) ก่อน แล้วค่อยเทียบชื่อ — คืนจำนวนที่จับคู่ได้ */
async function autoMatch(db: Db) {
  const all = await allRows<SlipRow>((a, b) => db.from("pay_slips").select("*").order("id").range(a, b));
  if (all.error) throw dbError(all.error);
  const { data: staffData, error } = await db.from("staff").select("id, role, name, is_salaried").in("role", ["mc", "admin"]);
  if (error) throw new Error(error.message);
  const staff = (staffData ?? []).map((s) => ({
    id: Number(s.id), role: String(s.role), name: String(s.name), salaried: !!s.is_salaried, test: isTestAccount(String(s.name)),
  }));
  const ids = new Set(staff.map((s) => s.id));
  // "role:key" -> staff id ที่ Owner เลือก (0 = Owner ตั้งว่าไม่ใช่คนในระบบ)
  const mem = new Map<string, number>();
  for (const r of all.rows) if (r.matched_by === "owner" && r.name_key) mem.set(`${r.role}:${r.name_key}`, r.staff_id ?? 0);
  const patches = new Map<string, number[]>(); // "staffId|by" -> ids
  for (const r of all.rows) {
    // matched_by auto + ไม่มีคน = รายชื่อที่จับคู่ไว้ถูกลบ -> จับใหม่
    if (r.staff_id || r.matched_by === "owner") continue;
    const m = r.name_key ? mem.get(`${r.role}:${r.name_key}`) : undefined;
    let staffId: number | null, by: "auto" | "owner";
    if (m !== undefined && (m === 0 || ids.has(m))) { staffId = m || null; by = "owner"; }
    else {
      staffId = matchSlip({ role: r.role, keys: slipPersonKeys(r.file_name) }, staff);
      by = "auto";
      if (!staffId) continue;
    }
    const k = `${staffId ?? ""}|${by}`;
    patches.set(k, [...(patches.get(k) ?? []), r.id]);
  }
  let n = 0;
  const now = new Date().toISOString();
  for (const [k, list] of patches) {
    const [sid, by] = k.split("|");
    for (const part of chunks(list)) {
      const { error: upErr } = await db.from("pay_slips").update({ staff_id: sid ? Number(sid) : null, matched_by: by, updated_at: now })
        .in("id", part).is("staff_id", null);
      if (upErr) throw dbError(upErr.message);
    }
    if (sid) n += list.length;
  }
  return n;
}

/** แจ้งเจ้าของสลิปที่เพิ่งอัป (ไม่เกิน SLIP_NOTIFY_DAYS วัน) — ไฟล์ละครั้ง (dedupe ตาม id ไฟล์) · คืนจำนวนที่แจ้ง */
async function notifyNew(db: Db) {
  const since = new Date(Date.now() - SLIP_NOTIFY_DAYS * 86400_000).toISOString();
  const { data, error } = await db.from("pay_slips").select("drive_file_id, round, round_date, role, grp, staff:staff(email)")
    .not("staff_id", "is", null).gte("file_created_at", since);
  if (error) return 0;
  const rows = (data ?? []) as unknown as (Pick<SlipRow, "drive_file_id" | "round" | "round_date" | "role" | "grp"> & { staff: { email: string | null } | null })[];
  return notifyMany(rows.flatMap((r) => (r.staff?.email?.trim() ? [{
    email: r.staff.email, kind: "pay" as const, page: r.role,
    title: `สลิปโอนเงิน ${slipRoundLabel(r.round_date, r.round)}`,
    body: `${r.grp ? `${r.grp} · ` : ""}ดาวน์โหลดได้ที่ "ตารางของฉัน" (กดรูปโปรไฟล์มุมขวาบน)`,
    dedupe: `slip:${r.drive_file_id}`,
  }] : [])));
}

/**
 * ตรวจโฟลเดอร์ Slip -> บันทึกไฟล์ใหม่ / ชื่อเปลี่ยน / ลบแถวของไฟล์ที่หายไป -> จับคู่ -> แจ้งเจ้าตัว (สลิปที่เพิ่งอัป)
 *   ยังไม่ได้ตั้งโฟลเดอร์ = configured: false · ยังไม่ได้รัน SQL / Drive ขัดข้อง = throw
 */
export async function scanSlips(): Promise<SlipScan> {
  const run = await withSyncLock("slip-scan", async () => {
    const db = createAdminClient();
    const root = await slipFolder(db);
    const empty = { files: 0, added: 0, removed: 0, matched: 0, unmatched: 0, notified: 0 };
    if (!root) return { configured: false, ...empty };
    const existing = await allRows<SlipRow>((a, b) => db.from("pay_slips").select("*").order("id").range(a, b));
    if (existing.error) throw dbError(existing.error);

    // 1. อ่านรายการไฟล์ทั้งหมดก่อน (พลาดกลางทาง = throw ไม่ลบแถวใดๆ)
    let seen: Map<string, Seen>;
    try {
      seen = await readDrive(root);
    } catch (err) {
      throw status(/file not found/i.test((err as Error)?.message ?? "")
        ? "บัญชีระบบเข้าโฟลเดอร์สลิปใน Drive ไม่ได้ (แชร์โฟลเดอร์ให้บัญชีระบบ หรือตรวจ id โฟลเดอร์)"
        : `อ่านไฟล์ใน Google Drive ไม่สำเร็จ: ${driveError(err)}`, 502);
    }
    if (!seen.size && existing.rows.length) throw new Error("ไม่พบไฟล์สลิปใน Drive (ไม่ลบข้อมูลเดิม ตรวจโฟลเดอร์ใน Drive)");

    // 2. เทียบกับที่บันทึกไว้
    const now = new Date().toISOString();
    const byFile = new Map(existing.rows.map((r) => [r.drive_file_id, r]));
    const inserts = [...seen.values()].filter((s) => !byFile.has(s.drive_file_id));
    for (const part of chunks(inserts)) {
      const { error } = await db.from("pay_slips").upsert(part, { onConflict: "drive_file_id", ignoreDuplicates: true });
      if (error) throw dbError(error.message);
    }
    // ชื่อ / รอบ / กลุ่มเปลี่ยน (id ไฟล์เดิม): อ่านใหม่ · ระบบจับคู่ไว้และชื่อคน / ฝั่งเปลี่ยน = จับใหม่ (ที่ Owner เลือกไว้คงเดิม)
    for (const r of existing.rows) {
      const s = seen.get(r.drive_file_id);
      if (!s || (s.file_name === r.file_name && s.round === r.round && s.role === r.role && s.grp === r.grp)) continue;
      const rematch = (s.name_key !== r.name_key || s.role !== r.role) && r.matched_by === "auto";
      const { error } = await db.from("pay_slips").update({ ...s, updated_at: now, ...(rematch ? { staff_id: null, matched_by: null } : {}) }).eq("id", r.id);
      if (error) throw dbError(error.message);
    }
    // ไฟล์ที่ถูกลบ / ย้ายออก = ลบแถว (เจ้าตัวไม่เห็นสลิปนั้นแล้ว)
    const gone = existing.rows.filter((r) => !seen.has(r.drive_file_id)).map((r) => r.id);
    for (const part of chunks(gone)) {
      const { error } = await db.from("pay_slips").delete().in("id", part);
      if (error) throw dbError(error.message);
    }

    // 3. จับคู่ + แจ้งเจ้าตัว
    const matched = await autoMatch(db);
    const notified = await notifyNew(db);
    const left = await db.from("pay_slips").select("id", { count: "exact", head: true }).is("staff_id", null).is("matched_by", null);
    return { configured: true, files: seen.size, added: inserts.length, removed: gone.length, matched, unmatched: left.count ?? 0, notified };
  }, 5_000);
  if (!run) throw new Error("กำลังตรวจสลิปอยู่ ลองใหม่อีกครั้ง");
  return run;
}

/** หน้า Owner: สลิปทั้งหมดของฝั่งที่จัดการได้ (รอบใหม่ก่อน) + รายชื่อไว้เลือกจับคู่ */
export async function ownerSlips(sides: { mc: boolean; admin: boolean }): Promise<OwnerSlips> {
  const db = createAdminClient();
  const root = await slipFolder(db);
  const roles = (["mc", "admin"] as const).filter((r) => sides[r]);
  const rows = await allRows<SlipRow>((a, b) => db.from("pay_slips").select("*").in("role", roles)
    .order("round", { ascending: false }).order("file_name").range(a, b));
  if (rows.error) throw dbError(rows.error);
  const { data: staff, error } = await db.from("staff").select("id, role, name").in("role", roles).order("name");
  if (error) throw new Error(error.message);
  const people = (staff ?? []).filter((s) => !isTestAccount(String(s.name)))
    .map((s) => ({ id: Number(s.id), role: s.role as SlipRole, label: label({ role: String(s.role), name: String(s.name) }) }));
  const who = new Map(people.map((p) => [p.id, p.label]));
  return {
    configured: !!root,
    people,
    slips: rows.rows.map((r) => ({
      id: Number(r.id), round: r.round, label: slipRoundLabel(r.round_date, r.round), role: r.role, group: r.grp, fileName: r.file_name,
      staffId: r.staff_id, who: r.staff_id ? who.get(Number(r.staff_id)) ?? null : null, by: r.matched_by,
    })),
  };
}

/**
 * Owner จับคู่สลิปกับรายชื่อ (staffId = null = ไม่ใช่คนในระบบ) — ใช้กับทุกสลิปที่ฝั่ง + ชื่อในไฟล์เดียวกัน (ทุกรอบ)
 *   ระบบจำไว้ รอบหลังเจอไฟล์ชื่อนี้จับคู่เอง · ฝั่งที่จัดการไม่ได้ = 403
 */
export async function assignSlip(id: number, staffId: number | null, sides: { mc: boolean; admin: boolean }) {
  const run = await withSyncLock("slip-scan", async () => {
    const db = createAdminClient();
    const { data: row, error } = await db.from("pay_slips").select("id, role, name_key").eq("id", id).maybeSingle();
    if (error) throw dbError(error.message);
    if (!row) throw new Error("ไม่พบสลิปนี้ (อาจถูกลบจาก Drive แล้ว) กดตรวจสลิปใหม่");
    if (!sides[row.role as SlipRole]) throw status("บัญชีนี้จัดการสลิปของฝั่งนี้ไม่ได้", 403);
    if (staffId) {
      const { data: s } = await db.from("staff").select("id, role").eq("id", staffId).in("role", ["mc", "admin"]).maybeSingle();
      if (!s) throw new Error("ไม่พบรายชื่อนี้ (ต้องเป็น Mc หรือ Admin)");
      if (!sides[s.role as SlipRole]) throw status("บัญชีนี้จัดการรายชื่อฝั่งนี้ไม่ได้", 403);
    }
    let q = db.from("pay_slips").update({ staff_id: staffId, matched_by: "owner", updated_at: new Date().toISOString() });
    // อ่านชื่อในไฟล์ไม่ได้ = เฉพาะไฟล์นี้ (ไม่ลากไฟล์อ่านไม่ได้อื่นไปด้วย)
    q = row.name_key ? q.eq("role", row.role).eq("name_key", row.name_key) : q.eq("id", id);
    const { data, error: upErr } = await q.select("id");
    if (upErr) throw dbError(upErr.message);
    await notifyNew(db);
    return { changed: data?.length ?? 0 };
  }, 10_000);
  if (!run) throw new Error("กำลังตรวจสลิปอยู่ ลองใหม่อีกครั้ง");
  return run;
}

/** สลิปของคนนี้ (รอบใหม่ก่อน ไม่เกิน 24 ใบ) · ยังไม่ได้รัน SQL = ว่าง */
export async function mySlips(staffId: number): Promise<MySlip[]> {
  const { data, error } = await createAdminClient().from("pay_slips").select("id, round, round_date, grp")
    .eq("staff_id", staffId).order("round", { ascending: false }).order("id").limit(24);
  if (error) return [];
  return (data ?? []).map((r) => ({ id: Number(r.id), label: slipRoundLabel(r.round_date as string | null, String(r.round)), group: String(r.grp ?? "") }));
}

/** สลิปตาม id (ไฟล์ให้เปิด: ตรวจสิทธิ์แล้วค่อยส่งไฟล์) */
export async function slipById(id: number) {
  const { data, error } = await createAdminClient().from("pay_slips").select("id, drive_file_id, round, role, staff_id, mime, file_name").eq("id", id).maybeSingle();
  if (error) throw dbError(error.message);
  return data as Pick<SlipRow, "id" | "drive_file_id" | "round" | "role" | "staff_id" | "mime" | "file_name"> | null;
}
