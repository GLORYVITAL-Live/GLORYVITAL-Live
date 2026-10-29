import "server-only";
import type { drive_v3 } from "googleapis";
import { driveClient, driveError } from "@/lib/drive";
import { withSyncLock } from "@/lib/lock";
import { notify, notifyMany } from "@/lib/notifications";
import { docsCan, type DocsScope } from "@/lib/pay-docs-db";
import { receiptState } from "@/lib/receipts";
import { myReceipts, receiptGaps, receiptView } from "@/lib/receipts-db";
import { createAdminClient } from "@/lib/supabase/server";
import {
  cleanRealName, dominantMonth, parseTawiFile, suggestPeople, tawiMonthLabel, tawiNameKey, type TawiCandidate,
} from "@/lib/tawi-name";
import { checkTawiVerify, failsToday, TAWI_VERIFY_MAX_FAILS, tawiVerifyState, type TawiVerifyResult } from "@/lib/tawi-verify";
import type { HomeTawi, MyTawi, OwnerTawi, TawiOwnerDoc } from "@/lib/types";

/**
 * ใบ 50 ทวิ รายเดือน (ตาราง tawi_docs) — SQL 20261029000000_tawi50 + 20261030000000_tawi_verify
 *   โฟลเดอร์หลักใน Drive (settings.tawi_drive_folder) > โฟลเดอร์รายเดือน > PDF รายคน (ชื่อจริงอยู่ในชื่อไฟล์)
 *   จับคู่ไฟล์กับคน: คีย์ชื่อจริงที่รู้ของแต่ละคน = staff.legal_name / ชื่อในเอกสารทำเบิก (pay_docs.full_name)
 *     / ไฟล์ที่ Owner เคยจับคู่ — ตรงคนเดียวเท่านั้น (ชื่อซ้ำ = ไม่เดา ให้ Owner เลือก)
 *   "คน" = อีเมล (เป็นทั้ง Mc และ Admin = คนเดียวกัน) · ไม่มีอีเมล = รายชื่อนั้น
 *   แจ้งเจ้าตัวเมื่อไฟล์ได้เจ้าของครั้งแรก (notified_at) · ตรวจครั้งแรก: ไฟล์เดือนก่อนเดือนล่าสุดถือว่าแจ้งแล้ว (ไม่แจ้งย้อนหลังรัว)
 *   ดาวน์โหลด: เจ้าตัวต้องยืนยันตัวตนด้วยชื่อจริงที่ตรงกับใบนั้นก่อน (src/lib/tawi-verify.ts) — การกรอกชื่อไม่จับคู่ใบให้ใคร
 */

type Db = ReturnType<typeof createAdminClient>;
type Drive = drive_v3.Drive;

export const TAWI_SQL = "ต้องรัน SQL 20261029000000_tawi50 ใน Supabase ก่อน";
export const TAWI_VERIFY_SQL = "ต้องรัน SQL 20261030000000_tawi_verify ใน Supabase ก่อน";
/** ข้อความถึงเจ้าตัวระหว่างยังไม่ได้รัน SQL ยืนยันตัวตน (ไม่ให้ดาวน์โหลดไว้ก่อน) */
export const TAWI_UPDATING = "ระบบใบ 50 ทวิกำลังอัปเดต ยังดาวน์โหลดไม่ได้ชั่วคราว ลองใหม่ภายหลัง";
/** Owner แก้ใบของคนฝั่งที่ไม่ได้รับสิทธิ์ดูเอกสาร */
export const NO_SIDE = "บัญชีนี้ไม่มีสิทธิ์ดูเอกสารของคนฝั่งนี้ (ตั้งที่หน้าพนักงาน > สิทธิ์ดูเอกสาร Mc / Admin)";
/** error จาก DB ที่แปลว่ายังไม่ได้รัน SQL (ไม่มีตาราง / คอลัมน์) */
const noSql = (msg: string) => /tawi|legal_name|schema cache|does not exist/i.test(msg);
const dbError = (msg: string) => new Error(noSql(msg) ? TAWI_SQL : msg);

export type TawiRow = {
  id: number; month: string; drive_file_id: string; file_name: string; real_name: string; name_key: string;
  staff_id: number | null; matched_by: "auto" | "owner" | "self" | null; notified_at: string | null;
};
type StaffLite = { id: number; role: "mc" | "admin"; name: string; email: string | null; legal_name: string | null };

const FOLDER = "application/vnd.google-apps.folder";
const PAGE = 1000;
const chunks = <T,>(list: T[], size = 300) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const personOf = (s: Pick<StaffLite, "id" | "email">) => (s.email?.trim() ? `e:${s.email.trim().toLowerCase()}` : `s:${s.id}`);
const label = (s: Pick<StaffLite, "role" | "name">) => (s.role === "mc" ? `Mc ${s.name}` : s.name);

// ---------- ยืนยันตัวตน (คอลัมน์ staff.tawi_verify* — SQL 20261030000000_tawi_verify) ----------

type VerifyRow = {
  id: number; email: string | null; tawi_verified_keys: string[] | null; tawi_verified_at: string | null;
  tawi_verify_fails: number | null; tawi_verify_fails_day: number | null; tawi_verify_failed_at: string | null;
};
type Verify = { keys: string[]; at: string | null; fails: number; dayFails: number; failedAt: string | null };
const VERIFY_COLS = "id, email, tawi_verified_keys, tawi_verified_at, tawi_verify_fails, tawi_verify_fails_day, tawi_verify_failed_at";
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** แถว Mc / Admin ตาม id หรืออีเมล · ยังไม่ได้รัน SQL = null (เรียกแยกจาก select อื่น เพื่อไม่ให้ส่วนอื่นพังตาม) */
async function verifyRows(db: Db, by: { ids: number[] } | { email: string }) {
  if ("ids" in by && !by.ids.length) return [] as VerifyRow[];
  const q = db.from("staff").select(VERIFY_COLS).in("role", ["mc", "admin"]);
  const { data, error } = await ("ids" in by ? q.in("id", by.ids) : q.eq("email", by.email.trim().toLowerCase()));
  return error ? null : ((data ?? []) as unknown as VerifyRow[]);
}

/** รวมหลายแถวของคนเดียว (Mc + Admin อีเมลเดียวกัน — ปกติเขียนพร้อมกันอยู่แล้ว) */
function mergeVerify(rows: VerifyRow[]): Verify {
  const v: Verify = { keys: [], at: null, fails: 0, dayFails: 0, failedAt: null };
  for (const r of rows) {
    v.keys.push(...(r.tawi_verified_keys ?? []).filter((k) => k && !v.keys.includes(k)));
    v.at = later(v.at, r.tawi_verified_at);
    v.fails = Math.max(v.fails, r.tawi_verify_fails ?? 0);
    if (r.tawi_verify_failed_at && later(v.failedAt, r.tawi_verify_failed_at) === r.tawi_verify_failed_at) {
      v.failedAt = r.tawi_verify_failed_at;
      v.dayFails = r.tawi_verify_fails_day ?? 0;
    }
  }
  return v;
}

/** สถานะยืนยันต่อคน (personOf) */
function verifyByPerson(rows: VerifyRow[]) {
  const groups = new Map<string, VerifyRow[]>();
  for (const r of rows) groups.set(personOf(r), [...(groups.get(personOf(r)) ?? []), r]);
  return new Map([...groups].map(([k, list]) => [k, mergeVerify(list)]));
}

/** คีย์ชื่อที่อีเมลนี้ยืนยันแล้ว · ยังไม่ได้รัน SQL = null */
export async function verifiedKeysOf(email: string) {
  const rows = await verifyRows(createAdminClient(), { email });
  return rows ? mergeVerify(rows).keys : null;
}

/** ลบคีย์ชื่อนี้ออกจากการยืนยันของรายชื่อเหล่านี้ (Owner ย้าย / ยกเลิกการจับคู่) — ไม่สำเร็จไม่เป็นไร (ดาวน์โหลดเช็ก staff_id อยู่แล้ว) */
async function dropVerifiedKey(db: Db, ids: number[], key: string) {
  const rows = await verifyRows(db, { ids });
  for (const r of rows ?? []) {
    if (!r.tawi_verified_keys?.includes(key)) continue;
    await db.from("staff").update({ tawi_verified_keys: r.tawi_verified_keys.filter((k) => k !== key) }).eq("id", r.id);
  }
}

/** id โฟลเดอร์หลัก (ไม่ได้ตั้ง = null) · ยังไม่ได้รัน SQL = throw TAWI_SQL */
async function rootFolder(db: Db) {
  const { data, error } = await db.from("settings").select("tawi_drive_folder").eq("id", 1).single();
  if (error) throw dbError(error.message);
  return (data?.tawi_drive_folder as string | null | undefined)?.trim() || null;
}

/** ทุกแถว (ทีละ 1000 แถว — Supabase ส่งได้ครั้งละไม่เกินนี้) */
async function allDocs(db: Db) {
  const out: TawiRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("tawi_docs")
      .select("id, month, drive_file_id, file_name, real_name, name_key, staff_id, matched_by, notified_at")
      .order("id").range(from, from + PAGE - 1);
    if (error) throw dbError(error.message);
    out.push(...((data ?? []) as TawiRow[]));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

/** รายชื่อ Mc / Admin + ชื่อในเอกสารทำเบิก (ต่ออีเมล) */
async function loadPeople(db: Db) {
  const [staff, payDocs] = await Promise.all([
    db.from("staff").select("id, role, name, email, legal_name").in("role", ["mc", "admin"]).order("id"),
    db.from("pay_docs").select("email, full_name"),
  ]);
  if (staff.error) throw dbError(staff.error.message);
  // ยังไม่ได้รัน SQL เอกสารทำเบิก = ไม่มีชื่อจากตรงนั้น
  const fullNames = new Map((payDocs.error ? [] : payDocs.data ?? []).map((d) => [String(d.email).trim().toLowerCase(), String(d.full_name ?? "")]));
  return { staff: (staff.data ?? []) as StaffLite[], fullNames };
}

/**
 * คีย์ชื่อจริง -> คนที่ใช้คีย์นี้ (คน -> รายชื่อที่จะผูกไฟล์) — ใช้จับคู่อัตโนมัติ จึงนับเฉพาะชื่อที่ Owner รับรอง
 *   legal_name (Owner จับคู่ / ตั้งเอง) + ไฟล์ที่ Owner เคยจับคู่
 *   ชื่อ-นามสกุลในเอกสารทำเบิก (pay_docs.full_name) ไม่นับ: เจ้าตัวพิมพ์เอง ไม่มีใครตรวจกับบัตร
 *   (พิมพ์ชื่อเพื่อนที่ยังไม่ได้จับคู่ = ได้ใบ 50 ทวิของเพื่อน) — ใช้เป็นแค่ "ชื่อแนะนำ" ในแผง Owner
 *   (ไฟล์ matched_by 'self' แบบเดิมไม่นับเช่นกัน)
 */
function keyOwners(staff: StaffLite[], docs: TawiRow[]) {
  const map = new Map<string, Map<string, number>>();
  const add = (key: string, s: StaffLite) => {
    if (key.length < 2) return;
    const m = map.get(key) ?? new Map<string, number>();
    if (!m.has(personOf(s))) m.set(personOf(s), s.id);
    map.set(key, m);
  };
  // Mc ก่อน Admin (คนที่เป็นทั้งคู่ ผูกกับรายชื่อ Mc)
  const ordered = [...staff].sort((a, b) => Number(a.role !== "mc") - Number(b.role !== "mc") || a.id - b.id);
  for (const s of ordered) if (s.legal_name?.trim()) add(tawiNameKey(s.legal_name), s);
  const byId = new Map(staff.map((s) => [s.id, s]));
  for (const d of docs) {
    const s = d.staff_id ? byId.get(d.staff_id) : undefined;
    if (s && d.matched_by === "owner") add(d.name_key, s);
  }
  return map;
}

/** จับคู่ไฟล์ที่ยังไม่มีเจ้าของ (Owner ไม่ได้ยกเลิกไว้) กับคนที่ชื่อตรงคนเดียว — แก้ docs ในหน่วยความจำด้วย คืนจำนวน */
async function autoMatch(db: Db, docs: TawiRow[], staff: StaffLite[]) {
  const owners = keyOwners(staff, docs);
  const byStaff = new Map<number, TawiRow[]>();
  for (const d of docs) {
    if (d.staff_id || d.matched_by) continue; // matched_by = owner + ไม่มีคน = Owner ยกเลิกการจับคู่เอง (ไม่จับซ้ำ)
    const who = owners.get(d.name_key);
    if (who?.size !== 1) continue;
    const id = [...who.values()][0];
    byStaff.set(id, [...(byStaff.get(id) ?? []), d]);
  }
  let n = 0;
  for (const [staffId, list] of byStaff) {
    for (const part of chunks(list)) {
      const { error } = await db.from("tawi_docs").update({ staff_id: staffId, matched_by: "auto", updated_at: new Date().toISOString() })
        .in("id", part.map((d) => d.id)).is("staff_id", null);
      if (error) throw dbError(error.message);
      for (const d of part) { d.staff_id = staffId; d.matched_by = "auto"; }
      n += part.length;
    }
  }
  return n;
}

/**
 * แจ้งเจ้าของไฟล์ที่ยังไม่ได้แจ้ง (รวมหลายเดือนเป็นข้อความเดียวต่อคน) แล้วตั้ง notified_at — คืนจำนวนคนที่แจ้ง
 *   รายชื่อที่ไม่มีอีเมล = ยังไม่แจ้ง (เพิ่มอีเมลแล้วจะแจ้งรอบถัดไป)
 *   ยังไม่ได้ยืนยันชื่อของใบเหล่านี้ = บอกให้กรอกชื่อจริงยืนยันตัวตนก่อน (ยังไม่ได้รัน SQL ยืนยัน = บอกด้วย)
 */
async function notifyPending(db: Db, staff: StaffLite[], staffIds?: number[]) {
  let q = db.from("tawi_docs").select("id, month, staff_id, name_key").not("staff_id", "is", null).is("notified_at", null).limit(2000);
  if (staffIds) q = q.in("staff_id", staffIds);
  const { data, error } = await q;
  if (error) throw dbError(error.message);
  const byId = new Map(staff.map((s) => [s.id, s]));
  const groups = new Map<string, { email: string; role: "mc" | "admin"; docs: { id: number; month: string; key: string }[] }>();
  for (const d of (data ?? []) as { id: number; month: string; staff_id: number; name_key: string }[]) {
    const s = byId.get(d.staff_id);
    if (!s?.email?.trim()) continue;
    const k = personOf(s);
    const g = groups.get(k) ?? { email: s.email.trim().toLowerCase(), role: s.role, docs: [] };
    g.docs.push({ id: d.id, month: d.month, key: d.name_key });
    groups.set(k, g);
  }
  if (!groups.size) return 0;
  const rows = await verifyRows(db, { ids: staff.filter((s) => groups.has(personOf(s))).map((s) => s.id) });
  const verified = rows ? verifyByPerson(rows) : new Map<string, Verify>();
  // เดือนที่ต้องส่งเอกสารยืนยันการรับเงินก่อนดาวน์โหลด (บังคับแล้วแต่ยังไม่ส่ง) — อ่านไม่ได้ = ไม่บอก
  const gaps = await receiptGaps([...groups.values()].flatMap((g) => g.docs.map((d) => ({ email: g.email, month: d.month }))))
    .catch(() => new Map<string, Set<string>>());
  const items = [...groups].map(([person, g]) => {
    const months = [...new Set(g.docs.map((d) => d.month))].sort().map(tawiMonthLabel).join(", ");
    const keys = verified.get(person)?.keys ?? [];
    const ready = g.docs.every((d) => keys.includes(d.key));
    const needReceipt = g.docs.some((d) => gaps.get(g.email)?.has(d.month));
    const steps = [
      ready ? "" : `กรอกชื่อจริงเพื่อยืนยันตัวตน${keys.length ? "" : "ครั้งแรก"}`,
      needReceipt ? "ส่งเอกสารยืนยันการรับเงินของเดือนนั้น" : "",
    ].filter(Boolean);
    return {
      email: g.email, kind: "tawi" as const, page: g.role,
      dedupe: `tawi:${g.docs.map((d) => d.id).sort((a, b) => a - b).join(",")}`.slice(0, 200),
      title: steps.length ? `ใบ 50 ทวิ เดือน ${months} พร้อมแล้ว${needReceipt ? " — ส่งเอกสารรับเงินก่อนดาวน์โหลด" : ""}` : `ใบ 50 ทวิ เดือน ${months} พร้อมดาวน์โหลดแล้ว`,
      body: steps.length
        ? `${steps.join(" แล้ว")}ก่อนดาวน์โหลด ที่ "ตารางของฉัน" (กดรูปโปรไฟล์มุมขวาบน)`
        : 'ดาวน์โหลดได้ที่ "ตารางของฉัน" (กดรูปโปรไฟล์มุมขวาบน)',
    };
  });
  await notifyMany(items);
  const ids = [...groups.values()].flatMap((g) => g.docs.map((d) => d.id));
  for (const part of chunks(ids)) {
    const { error: upErr } = await db.from("tawi_docs").update({ notified_at: new Date().toISOString() }).in("id", part);
    if (upErr) throw dbError(upErr.message);
  }
  return groups.size;
}

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
/** ลูกในโฟลเดอร์ (folders = เฉพาะโฟลเดอร์ / ไม่ = เฉพาะไฟล์) */
async function children(drive: Drive, parent: string, folders: boolean) {
  const out: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q: `${quote(parent)} in parents and trashed=false and mimeType ${folders ? "=" : "!="} '${FOLDER}'`,
      fields: "nextPageToken, files(id, name)", pageSize: 1000, pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    out.push(...(data.files ?? []).map((f) => ({ id: f.id!, name: f.name ?? "" })));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export type TawiScan = {
  configured: boolean; months: number; files: number; added: number; removed: number; renamed: number;
  matched: number; unmatched: number; notified: number; skipped: number;
};

/**
 * ตรวจไฟล์ใน Drive -> บันทึกไฟล์ใหม่ / ชื่อเปลี่ยน / ลบแถวของไฟล์ที่หายไป -> จับคู่อัตโนมัติ -> แจ้งเจ้าของ
 *   ยังไม่ได้ตั้งโฟลเดอร์ = configured: false · ยังไม่ได้รัน SQL / Drive ขัดข้อง = throw
 */
export async function scanTawi(): Promise<TawiScan> {
  const run = await withSyncLock("tawi", async () => {
    const db = createAdminClient();
    const root = await rootFolder(db);
    const empty = { months: 0, files: 0, added: 0, removed: 0, renamed: 0, matched: 0, unmatched: 0, notified: 0, skipped: 0 };
    if (!root) return { configured: false, ...empty };

    // 1. อ่านรายการไฟล์ทั้งหมดก่อน (พลาดกลางทาง = throw ไม่ลบแถวใดๆ)
    const drive = driveClient();
    const seen = new Map<string, { fileName: string; month: string; realName: string; nameKey: string }>();
    let months = 0, skipped = 0;
    try {
      const folders = await children(drive, root, true);
      for (const f of folders) {
        const files = await children(drive, f.id, false);
        // ไฟล์ที่ไม่มีเลขเอกสาร: ใช้เดือนที่พบบ่อยในโฟลเดอร์ (มีปีด้วย) ก่อนเดาจากชื่อโฟลเดอร์
        const fallbackMonth = dominantMonth(files.map((x) => x.name));
        let used = false;
        for (const x of files) {
          const p = parseTawiFile(x.name, f.name, { fallbackMonth });
          if (!p) { skipped++; continue; } // ไม่ใช่ PDF (.zip) / ผู้รับเป็นบริษัท / อ่านชื่อไม่ได้
          seen.set(x.id, { fileName: x.name, month: p.month, realName: p.realName, nameKey: p.nameKey });
          used = true;
        }
        if (used) months++;
      }
    } catch (err) {
      throw new Error(/file not found/i.test((err as Error)?.message ?? "")
        ? "บัญชีระบบเข้าโฟลเดอร์ใบ 50 ทวิไม่ได้ (แชร์โฟลเดอร์ให้บัญชีระบบ หรือตรวจ id โฟลเดอร์)"
        : driveError(err));
    }

    // 2. เทียบกับที่บันทึกไว้
    const existing = await allDocs(db);
    if (!seen.size && existing.length) throw new Error("ไม่พบไฟล์ PDF ในโฟลเดอร์ใบ 50 ทวิ (ไม่ลบข้อมูลเดิม ตรวจโฟลเดอร์ใน Drive)");
    const firstScan = !existing.length;
    const latest = [...seen.values()].reduce((m, p) => (p.month > m ? p.month : m), "");
    const now = new Date().toISOString();
    const byFile = new Map(existing.map((d) => [d.drive_file_id, d]));

    const inserts = [...seen].filter(([id]) => !byFile.has(id)).map(([id, p]) => ({
      month: p.month, drive_file_id: id, file_name: p.fileName, real_name: p.realName, name_key: p.nameKey,
      // ตรวจครั้งแรก: ไฟล์ย้อนหลัง (ก่อนเดือนล่าสุด) ไม่ต้องแจ้ง — เจ้าตัวเห็นเองใน "ตารางของฉัน"
      notified_at: firstScan && p.month < latest ? now : null,
    }));
    for (const part of chunks(inserts)) {
      const { error } = await db.from("tawi_docs").upsert(part, { onConflict: "drive_file_id", ignoreDuplicates: true });
      if (error) throw dbError(error.message);
    }

    // ชื่อไฟล์เปลี่ยน (id เดิม) / กฎคีย์ชื่อเปลี่ยน (คีย์ที่คำนวณใหม่ไม่ตรงของเดิม): อ่านใหม่
    //   ระบบจับคู่ไว้และชื่อคนเปลี่ยน = จับใหม่ (ที่ Owner / เจ้าตัวจับคู่ไว้คงเดิม)
    let renamed = 0;
    for (const d of existing) {
      const p = seen.get(d.drive_file_id);
      if (!p || (p.fileName === d.file_name && p.nameKey === d.name_key)) continue;
      const rematch = p.nameKey !== d.name_key && d.matched_by === "auto";
      const { error } = await db.from("tawi_docs").update({
        file_name: p.fileName, month: p.month, real_name: p.realName, name_key: p.nameKey, updated_at: now,
        ...(rematch ? { staff_id: null, matched_by: null } : {}),
      }).eq("id", d.id);
      if (error) throw dbError(error.message);
      renamed++;
    }

    // ไฟล์ที่ถูกลบ / ย้ายออกจากโฟลเดอร์ = ลบแถว (เจ้าตัวดาวน์โหลดไม่ได้แล้วอยู่ดี)
    const gone = existing.filter((d) => !seen.has(d.drive_file_id)).map((d) => d.id);
    for (const part of chunks(gone)) {
      const { error } = await db.from("tawi_docs").delete().in("id", part);
      if (error) throw dbError(error.message);
    }

    // 3. จับคู่ + แจ้ง
    const docs = await allDocs(db);
    const { staff } = await loadPeople(db);
    const matched = await autoMatch(db, docs, staff);
    const notified = await notifyPending(db, staff);
    return {
      configured: true, months, files: seen.size, added: inserts.length, removed: gone.length, renamed,
      matched, unmatched: docs.filter((d) => !d.staff_id).length, notified, skipped,
    };
  }, 5_000);
  if (!run) throw new Error("กำลังตรวจไฟล์ใบ 50 ทวิอยู่ ลองใหม่อีกครั้ง");
  return run;
}

/**
 * Owner จับคู่ชื่อในไฟล์นี้กับรายชื่อ (staffId = null = ยกเลิกการจับคู่)
 *   ใช้กับทุกไฟล์ที่ชื่อเดียวกัน (ทุกเดือน) — ชื่อจริง 1 ชื่อ = คนเดียว
 *   คนใหม่ยังไม่มี legal_name = ตั้งจากชื่อในไฟล์ (เดือนถัดไปจับคู่เอง) · คนเดิมที่ legal_name เป็นชื่อนี้ = ล้างออก (จับผิดคน)
 *   เปลี่ยนคนของไฟล์เดือนล่าสุด = แจ้งคนใหม่
 */
export async function assignTawi(docId: number, staffId: number | null, scope?: DocsScope) {
  const db = createAdminClient();
  const { data: doc, error } = await db.from("tawi_docs").select("id, name_key, real_name").eq("id", docId).maybeSingle();
  if (error) throw dbError(error.message);
  if (!doc) throw new Error("ไม่พบไฟล์นี้ (อาจถูกลบจาก Drive แล้ว) กดตรวจไฟล์ใหม่");
  const { staff } = await loadPeople(db);
  const target = staffId ? staff.find((s) => s.id === staffId) : null;
  if (staffId && !target) throw new Error("ไม่พบรายชื่อนี้ (ต้องเป็น Mc หรือ Admin)");

  const { data: same, error: sameErr } = await db.from("tawi_docs").select("id, month, staff_id, notified_at").eq("name_key", doc.name_key);
  if (sameErr) throw dbError(sameErr.message);
  // Owner (scope): จับคู่ / ย้าย / ยกเลิกได้เฉพาะคนฝั่งที่ดูเอกสารได้ (ทั้งคนใหม่และคนเดิมของใบนี้)
  if (scope) {
    const roleOf = new Map(staff.map((s) => [s.id, s.role]));
    const sides = [target?.role, ...(same ?? []).map((r) => (r.staff_id ? roleOf.get(Number(r.staff_id)) : undefined))].filter((x): x is "mc" | "admin" => !!x);
    if (sides.some((r) => !docsCan(scope, r))) throw new Error(NO_SIDE);
  }
  const { data: last } = await db.from("tawi_docs").select("month").order("month", { ascending: false }).limit(1);
  const latest = String(last?.[0]?.month ?? "");
  const rows = (same ?? []) as { id: number; month: string; staff_id: number | null; notified_at: string | null }[];
  const now = new Date().toISOString();
  const patch = { staff_id: staffId, matched_by: "owner", updated_at: now };
  const renotify = staffId ? rows.filter((r) => r.staff_id !== staffId && r.notified_at && r.month === latest).map((r) => r.id) : [];
  const rest = rows.map((r) => r.id).filter((id) => !renotify.includes(id));
  for (const [ids, extra] of [[rest, {}], [renotify, { notified_at: null }]] as const) {
    if (!ids.length) continue;
    const { error: upErr } = await db.from("tawi_docs").update({ ...patch, ...extra }).in("id", [...ids]);
    if (upErr) throw dbError(upErr.message);
  }

  // legal_name: คนเดิมที่ตั้งชื่อนี้ไว้ = ล้าง / คนใหม่ที่ยังว่าง = ตั้ง (ทุกบทบาทของอีเมลนั้น)
  const prevPeople = new Set(rows.map((r) => staff.find((s) => s.id === r.staff_id)).filter((s): s is StaffLite => !!s).map(personOf));
  if (target) prevPeople.delete(personOf(target));
  const clear = staff.filter((s) => prevPeople.has(personOf(s)) && s.legal_name && tawiNameKey(s.legal_name) === doc.name_key).map((s) => s.id);
  if (clear.length) await db.from("staff").update({ legal_name: null }).in("id", clear);
  // คนเดิมเคยยืนยันชื่อนี้ = ลบการยืนยันชื่อนี้ออกด้วย (ถ้าภายหลังจับคู่กลับมา ต้องยืนยันใหม่)
  const prevIds = staff.filter((s) => prevPeople.has(personOf(s))).map((s) => s.id);
  if (prevIds.length) await dropVerifiedKey(db, prevIds, String(doc.name_key));
  if (target) {
    const mine = staff.filter((s) => personOf(s) === personOf(target));
    if (!mine.some((s) => s.legal_name?.trim())) {
      const { error: nameErr } = await db.from("staff").update({ legal_name: cleanRealName(String(doc.real_name)) }).in("id", mine.map((s) => s.id));
      if (nameErr) throw dbError(nameErr.message);
    }
    await notifyPending(db, staff, [target.id]);
  }
  return { changed: rows.length };
}

/**
 * ไฟล์ทั้งหมดที่จับคู่กับอีเมลนี้ (ทุกบทบาท) + ใบไหนยืนยันตัวตนแล้ว + เอกสารรับเงินของแต่ละเดือน (src/lib/receipts-db.ts)
 *   ยังไม่ได้รัน SQL ใบ 50 ทวิ = ready: false · ยังไม่ได้รัน SQL ยืนยันตัวตน = verifyReady: false (ดาวน์โหลดไม่ได้)
 */
export async function myTawi(email: string): Promise<MyTawi> {
  const db = createAdminClient();
  const off: MyTawi = { ready: false, verifyReady: false, locked: false, docs: [], receiptFrom: null, receipts: [] };
  const { data: staff, error } = await db.from("staff").select("id").eq("email", email).in("role", ["mc", "admin"]);
  if (error) return off;
  const ids = (staff ?? []).map((s) => Number(s.id));
  if (!ids.length) return { ...off, ready: true, verifyReady: true };
  const [{ data, error: docErr }, rows, rc] = await Promise.all([
    db.from("tawi_docs").select("id, month, name_key").in("staff_id", ids).order("month", { ascending: false }).order("id"),
    verifyRows(db, { ids }),
    myReceipts(email),
  ]);
  if (docErr) return off;
  const v = rows ? mergeVerify(rows) : null;
  const byMonth = new Map(rc.rows.map((r) => [r.month, r]));
  return {
    ready: true, verifyReady: !!v,
    locked: !!v && failsToday(v.dayFails, v.failedAt) >= TAWI_VERIFY_MAX_FAILS,
    docs: (data ?? []).map((d) => ({
      id: Number(d.id), month: String(d.month), verified: !!v?.keys.includes(String(d.name_key)),
      receipt: receiptState(String(d.month), rc.requiredFrom, byMonth.get(String(d.month))),
    })),
    receiptFrom: rc.requiredFrom, receipts: rc.rows.map(receiptView),
  };
}

/**
 * เจ้าตัวกรอกชื่อ-นามสกุลจริงเพื่อยืนยันตัวตน (ไม่จับคู่ใบให้ใคร — เทียบกับใบที่ทีมงานจับคู่ให้คนนี้แล้วเท่านั้น)
 *   ตรง = จำคีย์ชื่อ (ทุกแถวของอีเมลนี้) ล้างจำนวนครั้งที่ผิด · ไม่ตรง = นับครั้ง (ผิดครบ 5 ครั้ง/วัน = ล็อกถึงพรุ่งนี้)
 *   ยังไม่ได้รัน SQL ยืนยันตัวตน = updating
 */
export async function verifyTawi(email: string, name: unknown): Promise<TawiVerifyResult | { status: "updating" }> {
  const db = createAdminClient();
  const rows = await verifyRows(db, { email });
  if (!rows) return { status: "updating" };
  if (!rows.length) return { status: "nothing" };
  const ids = rows.map((r) => r.id);
  const { data, error } = await db.from("tawi_docs").select("name_key").in("staff_id", ids);
  if (error) throw dbError(error.message);
  const v = mergeVerify(rows);
  const res = checkTawiVerify({
    name, docKeys: (data ?? []).map((d) => String(d.name_key)), verifiedKeys: v.keys, dayFails: v.dayFails, failedAt: v.failedAt,
  });
  const now = new Date().toISOString();
  const patch = res.status === "ok"
    ? { tawi_verified_keys: res.keys, tawi_verified_at: now, tawi_verify_fails: 0, tawi_verify_fails_day: 0, tawi_verify_failed_at: null }
    : res.status === "mismatch"
      ? { tawi_verify_fails: v.fails + 1, tawi_verify_fails_day: res.failsToday, tawi_verify_failed_at: now }
      : null;
  if (patch) {
    const { error: upErr } = await db.from("staff").update(patch).in("id", ids);
    if (upErr) throw new Error(noSql(upErr.message) ? TAWI_UPDATING : upErr.message);
  }
  return res;
}

/** แจ้ง Owner ที่ดูเอกสารฝั่งของคนนี้ได้ ว่าคนนี้กรอกชื่อไม่ตรง (วันละครั้งต่อคน — ไม่ใส่ชื่อที่กรอกในแจ้งเตือน) */
export async function notifyVerifyFail(email: string, who: string, fails: number) {
  const db = createAdminClient();
  const { data: mine } = await db.from("staff").select("role").eq("email", email.trim().toLowerCase()).in("role", ["mc", "admin"]);
  const roles = new Set((mine ?? []).map((s) => String(s.role)));
  // ฝั่ง Mc = can_view_pay_docs · ฝั่ง Admin = can_view_pay_docs_admin (ยังไม่ได้รัน SQL = can_view_pay_docs ทั้งสองฝั่ง)
  const cols = [...(roles.has("mc") || !roles.size ? ["can_view_pay_docs"] : []), ...(roles.has("admin") ? ["can_view_pay_docs_admin"] : [])];
  const res = await db.from("staff").select("email")
    .eq("role", "owner").not("email", "is", null).or(cols.map((c) => `${c}.eq.true`).join(","));
  const { data } = res.error
    ? await db.from("staff").select("email").eq("role", "owner").eq("can_view_pay_docs", true).not("email", "is", null)
    : res;
  const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  await notify((data ?? []).map((r) => r.email as string), {
    kind: "tawi", page: "owner", dedupe: `tawi-verify:${email.trim().toLowerCase()}:${day}`,
    title: `${who} กรอกชื่อไม่ตรงกับใบ 50 ทวิที่จับคู่ไว้ — ตรวจการจับคู่`,
    body: `กรอกไม่ตรง ${fails} ครั้งวันนี้ · ดูที่หน้าเจ้าของ > สรุปรายเดือน > ใบ 50 ทวิ (แท็บ "จับคู่แล้ว")`,
  });
}

/** Owner รีเซ็ตการยืนยันตัวตนของคนนี้ (ทุกบทบาทของอีเมลเดียวกัน) — เจ้าตัวต้องกรอกชื่อยืนยันใหม่ · เฉพาะฝั่งที่ดูเอกสารได้ */
export async function resetTawiVerify(staffId: number, scope: DocsScope) {
  const db = createAdminClient();
  const { data: s } = await db.from("staff").select("id, email, role").eq("id", staffId).in("role", ["mc", "admin"]).maybeSingle();
  if (!s) throw new Error("ไม่พบรายชื่อนี้");
  if (!docsCan(scope, String(s.role))) throw new Error(NO_SIDE);
  const email = (s.email as string | null)?.trim().toLowerCase();
  const rows = await verifyRows(db, email ? { email } : { ids: [staffId] });
  if (!rows) throw new Error(TAWI_VERIFY_SQL);
  const ids = rows.length ? rows.map((r) => r.id) : [staffId];
  const { error } = await db.from("staff").update({
    tawi_verified_keys: null, tawi_verified_at: null, tawi_verify_fails: 0, tawi_verify_fails_day: 0, tawi_verify_failed_at: null,
  }).in("id", ids);
  if (error) throw new Error(noSql(error.message) ? TAWI_VERIFY_SQL : error.message);
  return { reset: ids.length };
}

/**
 * หน้าจับคู่ของ Owner: เดือนที่เลือก (ไม่ระบุ = ล่าสุด) + รายชื่อให้เลือก + คนที่น่าจะใช่
 *   เฉพาะฝั่งที่ดูเอกสารได้: ใบที่จับคู่กับคนฝั่งอื่น = ไม่แสดง · รายชื่อให้เลือก = ฝั่งที่ดูได้
 *   ใบที่ยังไม่มีเจ้าของ = แสดง (ยังไม่รู้ว่าเป็นของฝั่งไหน — ต้องดูชื่อเพื่อจับคู่)
 */
export async function ownerTawi(month: string | null, scope: DocsScope): Promise<OwnerTawi> {
  const db = createAdminClient();
  let root: string | null;
  try { root = await rootFolder(db); } catch (err) {
    if ((err as Error).message !== TAWI_SQL) throw err;
    return { ready: false, folderSet: false, verifyReady: false, month: null, months: [], docs: [], people: [] };
  }
  const [allDocRows, { staff: allStaff, fullNames }] = await Promise.all([allDocs(db), loadPeople(db)]);
  const roleOf = new Map(allStaff.map((s) => [s.id, s.role]));
  const docs = allDocRows.filter((d) => !d.staff_id || docsCan(scope, roleOf.get(d.staff_id) ?? ""));
  const staff = allStaff.filter((s) => docsCan(scope, s.role));
  const vRows = await verifyRows(db, { ids: staff.map((s) => s.id) });
  const verified = vRows ? verifyByPerson(vRows) : null;
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const verifyOf = (d: TawiRow) => {
    const s = d.staff_id ? staffById.get(d.staff_id) : undefined;
    const v = s && verified ? verified.get(personOf(s)) ?? { keys: [], fails: 0, failedAt: null } : null;
    return v ? tawiVerifyState(v, d.name_key) : null;
  };
  const byMonth = new Map<string, { total: number; matched: number }>();
  for (const d of docs) {
    const m = byMonth.get(d.month) ?? { total: 0, matched: 0 };
    m.total++;
    if (d.staff_id) m.matched++;
    byMonth.set(d.month, m);
  }
  const months = [...byMonth].map(([m, v]) => ({ month: m, ...v })).sort((a, b) => b.month.localeCompare(a.month));
  const pick = month && byMonth.has(month) ? month : months[0]?.month ?? null;

  // คนที่น่าจะใช่: คีย์ชื่อจริงที่รู้ของแต่ละรายชื่อ + ชื่อในระบบ
  const keysOf = new Map<number, Set<string>>();
  const addKey = (id: number, k: string) => { if (k) keysOf.set(id, (keysOf.get(id) ?? new Set()).add(k)); };
  for (const s of staff) {
    if (s.legal_name) addKey(s.id, tawiNameKey(s.legal_name));
    const full = s.email ? fullNames.get(s.email.trim().toLowerCase()) : "";
    if (full) addKey(s.id, tawiNameKey(full));
  }
  for (const d of docs) if (d.staff_id && roleOf.has(d.staff_id)) addKey(d.staff_id, d.name_key);
  const candidates: TawiCandidate[] = staff.map((s) => ({ id: s.id, label: label(s), keys: [...(keysOf.get(s.id) ?? [])], nick: s.name }));

  const list: TawiOwnerDoc[] = docs.filter((d) => d.month === pick)
    .sort((a, b) => Number(!!a.staff_id) - Number(!!b.staff_id) || a.real_name.localeCompare(b.real_name, "th"))
    .map((d) => ({
      id: d.id, month: d.month, realName: d.real_name, fileName: d.file_name, staffId: d.staff_id, matchedBy: d.matched_by,
      suggest: d.staff_id ? [] : suggestPeople(d.real_name, candidates).map((s) => ({ id: s.id, score: Math.round(s.score * 100) / 100 })),
      verify: verifyOf(d),
    }));
  return {
    ready: true, folderSet: !!root, verifyReady: !!verified, month: pick, months, docs: list,
    people: staff.map((s) => ({ id: s.id, role: s.role, label: label(s), legalName: s.legal_name?.trim() || null, hasEmail: !!s.email?.trim() }))
      .sort((a, b) => a.label.localeCompare(b.label, "th")),
  };
}

/**
 * หน้าแรกของ Owner: เรื่องใบ 50 ทวิที่ต้องจัดการ · ยังไม่ได้รัน SQL / ไม่ได้ตั้งโฟลเดอร์ = null (ไม่แสดง)
 *   unmatched = ชื่อในใบที่ยังไม่มีเจ้าของ (ไม่นับที่ Owner ตั้งว่าไม่ใช่คนในทีม) · noEmail = มีใบแล้วแต่รายชื่อไม่มีอีเมล (เข้าเว็บดาวน์โหลดไม่ได้)
 *   missingMonth = เลยวันที่ 10 แล้วยังไม่มีใบของเดือนก่อน (ทีมบัญชีลืมสร้างโฟลเดอร์รายเดือนในโฟลเดอร์หลัก / วางไฟล์ผิดที่)
 */
export async function tawiHome(today: string, scope: DocsScope): Promise<HomeTawi | null> {
  const db = createAdminClient();
  let root: string | null;
  try { root = await rootFolder(db); } catch { return null; }
  if (!root) return null;
  const [docs, { staff }] = await Promise.all([allDocs(db), loadPeople(db)]);
  // ไม่มีอีเมล: เฉพาะคนฝั่งที่ดูเอกสารได้ · ใบที่ยังไม่มีเจ้าของ: แสดงทุกฝั่ง (ยังไม่รู้ว่าเป็นของใคร)
  const byId = new Map(staff.filter((s) => docsCan(scope, s.role)).map((s) => [s.id, s]));

  const loose = new Map<string, { name: string; months: string[] }>();
  for (const d of docs) {
    if (d.staff_id || d.matched_by === "owner") continue;
    const g = loose.get(d.name_key) ?? { name: d.real_name, months: [] };
    if (!g.months.includes(d.month)) g.months.push(d.month);
    loose.set(d.name_key, g);
  }
  const noEmail = new Map<number, { label: string; months: string[] }>();
  for (const d of docs) {
    const s = d.staff_id ? byId.get(d.staff_id) : undefined;
    if (!s || s.email?.trim()) continue;
    const g = noEmail.get(s.id) ?? { label: label(s), months: [] };
    if (!g.months.includes(d.month)) g.months.push(d.month);
    noEmail.set(s.id, g);
  }
  // เดือนเรียงเก่าไปใหม่ · คนที่มีใบเดือนล่าสุดก่อน
  const latest = <T extends { months: string[] },>(list: T[]) => list.map((g) => ({ ...g, months: g.months.sort() }))
    .sort((a, b) => b.months[b.months.length - 1].localeCompare(a.months[a.months.length - 1]));

  // เดือนก่อน (เวลาไทย) ควรมีใบแล้วหลังวันที่ 10
  const [y, m, d] = today.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const months = new Set(docs.map((x) => x.month));
  return {
    unmatched: latest([...loose.values()]).map((g) => ({ name: g.name, months: g.months })),
    noEmail: latest([...noEmail.values()]),
    missingMonth: d > 10 && months.size && !months.has(prev) ? prev : null,
  };
}

/** ไฟล์ให้ดาวน์โหลด: ตรวจสิทธิ์แล้วค่อยเรียก (เจ้าของไฟล์ที่ยืนยันตัวตนแล้ว / Owner ที่ดูเอกสารทำเบิกได้) */
export async function tawiDoc(id: number) {
  const db = createAdminClient();
  const { data, error } = await db.from("tawi_docs").select("id, month, drive_file_id, staff_id, name_key").eq("id", id).maybeSingle();
  if (error) throw dbError(error.message);
  if (!data) return null;
  let ownerEmail: string | null = null, ownerRole: string | null = null, order = 1, sameMonth = 1;
  if (data.staff_id) {
    const { data: s } = await db.from("staff").select("email, role").eq("id", data.staff_id).maybeSingle();
    ownerEmail = (s?.email as string | null)?.trim().toLowerCase() || null;
    ownerRole = (s?.role as string | null) ?? null;
    // เดือนเดียวกันมีหลายไฟล์ = ต่อท้ายลำดับในชื่อไฟล์ดาวน์โหลด
    const { data: sib } = await db.from("tawi_docs").select("id").eq("staff_id", data.staff_id).eq("month", data.month).order("id");
    sameMonth = sib?.length ?? 1;
    order = Math.max(1, (sib ?? []).findIndex((x) => Number(x.id) === id) + 1);
  }
  return { month: String(data.month), fileId: String(data.drive_file_id), nameKey: String(data.name_key), ownerEmail, ownerRole, order, sameMonth };
}

/** ไฟล์ PDF จาก Drive */
export async function downloadTawi(fileId: string) {
  const res = await driveClient().files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  return new Uint8Array(res.data as ArrayBuffer);
}
