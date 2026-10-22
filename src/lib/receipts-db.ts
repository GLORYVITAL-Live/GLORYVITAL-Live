import "server-only";
import { Readable } from "stream";
import type { drive_v3 } from "googleapis";
import { driveClient, driveError, folder } from "@/lib/drive";
import { withSyncLock } from "@/lib/lock";
import { notify, notifyMany } from "@/lib/notifications";
import {
  isWebFileOf, matchReceiptFile, parseReceiptFile, receiptFolderMonth, receiptPersonFolder, receiptRealName, receiptWebFileName,
  roleFolder, suggestReceiptPeople, type ReceiptCandidate, type Role,
} from "@/lib/receipt-name";
import {
  cleanRequiredFrom, receiptExt, receiptFolders, receiptMonthOk, receiptRole, receiptState,
} from "@/lib/receipts";
import { docsCan, type DocsScope } from "@/lib/pay-docs-db";
import { createAdminClient } from "@/lib/supabase/server";
import { tawiMonthLabel, tawiNameKey } from "@/lib/tawi-name";
import type {
  HomeReceipts, OwnerReceiptPerson, OwnerReceipts, ReceiptDriveFile, ReceiptState, ReceiptView, TawiPerson,
} from "@/lib/types";

/**
 * เอกสารยืนยันการรับเงินรายเดือน (ตาราง pay_receipts) — SQL 20261101000000_pay_receipts + 20261102000000_receipt_files
 *   ส่งผ่านเว็บ: settings.receipt_drive_folder > 2026 > 10 October > Mc / Admin > "Mc ชื่อเล่น (ชื่อจริง)" > "เอกสารรับเงิน 2026-10.pdf"
 *   ไฟล์เดิมที่ทีมบัญชีอัปเอง (ตาราง receipt_files): ตรวจ + จับคู่ชื่อ -> จับคู่แล้ว = ส่งแล้ว (pay_receipts.source = 'drive')
 *     ไม่ย้าย / ไม่เปลี่ยนชื่อ / ไม่ลบไฟล์เดิม · เดือนนั้นส่งผ่านเว็บแล้ว = ใช้ไฟล์ที่ส่งผ่านเว็บ (ไม่ทับ)
 *   "คน" = อีเมล (1 อีเมล 1 เอกสารต่อเดือน — ส่งใหม่ = แทนไฟล์เดิม ไฟล์เดิมที่ส่งผ่านเว็บลงถังขยะ)
 *   บังคับเมื่อ: รัน SQL แล้ว + ตั้งโฟลเดอร์แล้ว + ตั้งเดือนเริ่ม (settings.receipt_required_from) — ขาดข้อใด = ไม่บังคับ (ดาวน์โหลดได้ตามเดิม)
 */

type Db = ReturnType<typeof createAdminClient>;
type Drive = drive_v3.Drive;

export const RECEIPT_SQL = "ต้องรัน SQL 20261101000000_pay_receipts ใน Supabase ก่อน";
export const RECEIPT_FILES_SQL = "ต้องรัน SQL 20261102000000_receipt_files ใน Supabase ก่อน (ดึงไฟล์เดิมใน Drive)";
/** Owner แก้เอกสารของคนฝั่งที่ไม่ได้รับสิทธิ์ดูเอกสาร */
const NO_SIDE = "บัญชีนี้ไม่มีสิทธิ์ดูเอกสารของคนฝั่งนี้ (ตั้งที่หน้าพนักงาน > สิทธิ์ดูเอกสาร Mc / Admin)";
const noSql = (msg: string) => /pay_receipts|receipt_|schema cache|does not exist/i.test(msg);
const dbError = (msg: string) => new Error(noSql(msg) ? RECEIPT_SQL : msg);
const filesError = (msg: string) => new Error(/receipt_files|source|folder_id|schema cache|does not exist/i.test(msg) ? RECEIPT_FILES_SQL : msg);
/** error ที่มาจาก Google Drive (ตอบ 502 — ให้ระบบแจ้งทีมงาน) */
const driveFail = (msg: string) => Object.assign(new Error(msg), { status: 502 });

/** แถว pay_receipts (อ่านด้วย select * — source / folder_id มีเมื่อรัน SQL receipt_files แล้ว) */
export type ReceiptRow = {
  id: number; email: string; staff_id: number | null; month: string; drive_file_id: string; file_name: string; mime: string; size: number;
  status: "ok" | "rejected"; reject_reason: string | null; reviewed_by: string | null; reviewed_at: string | null;
  uploaded_at: string; updated_at: string; source?: "web" | "drive"; folder_id?: string | null;
};
/** แถว receipt_files */
type FileRow = {
  id: number; drive_file_id: string; month: string; role: Role; file_name: string; path: string; mime: string; size: number;
  nick: string; real_name: string | null; name_key: string; staff_id: number | null; matched_by: "auto" | "owner" | null;
  file_created_at: string | null;
};
const PAGE = 1000;
const FOLDER = "application/vnd.google-apps.folder";
const norm = (email: string) => email.trim().toLowerCase();
type StaffLite = { id: number; role: Role; name: string; email: string | null; legal_name?: string | null; tawi_verified_keys?: string[] | null; live_platform?: string | null };
const label = (s: Pick<StaffLite, "role" | "name">) => (s.role === "mc" ? `Mc ${s.name}` : s.name);
const personOf = (s: Pick<StaffLite, "id" | "email">) => (s.email?.trim() ? `e:${norm(s.email)}` : `s:${s.id}`);
const chunks = <T,>(list: T[], size = 300) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const isWeb = (r: Pick<ReceiptRow, "source">) => r.source !== "drive";

export const receiptView = (r: ReceiptRow): ReceiptView => ({
  id: Number(r.id), month: r.month, status: r.status === "rejected" ? "rejected" : "ok", reason: r.reject_reason,
  uploadedAt: r.uploaded_at, pdf: r.mime === "application/pdf", source: r.source === "drive" ? "drive" : "web",
});

/**
 * ค่าตั้ง · ready = รัน SQL แล้ว · from = เดือนเริ่มที่ตั้งไว้
 *   requiredFrom = เดือนเริ่มบังคับที่ใช้จริง (ยังไม่ได้ตั้งโฟลเดอร์ = null — ส่งไม่ได้จึงไม่บังคับ)
 */
async function loadConfig(db: Db) {
  const { data, error } = await db.from("settings").select("receipt_drive_folder, receipt_required_from").eq("id", 1).maybeSingle();
  if (error) return { ready: false, folder: null, from: null, requiredFrom: null };
  const folderId = (data?.receipt_drive_folder as string | null | undefined)?.trim() || null;
  const from = cleanRequiredFrom(data?.receipt_required_from);
  return { ready: true, folder: folderId, from, requiredFrom: folderId ? from : null };
}

/** รัน SQL 20261102000000_receipt_files แล้ว (มีคอลัมน์ source / folder_id) */
async function hasSource(db: Db) {
  const { error } = await db.from("pay_receipts").select("source, folder_id").limit(1);
  return !error;
}

/** เอกสารรับเงินของอีเมลนี้ (ใหม่ก่อน) + เดือนเริ่มบังคับ · ยังไม่ได้รัน SQL / อ่านไม่ได้ = ไม่บังคับ (ไม่ล็อกใบ 50 ทวิเพราะระบบนี้) */
export async function myReceipts(email: string): Promise<{ requiredFrom: string | null; rows: ReceiptRow[] }> {
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  if (!cfg.ready) return { requiredFrom: null, rows: [] };
  const { data, error } = await db.from("pay_receipts").select("*").eq("email", norm(email)).order("month", { ascending: false });
  if (error) return { requiredFrom: null, rows: [] };
  return { requiredFrom: cfg.requiredFrom, rows: (data ?? []) as ReceiptRow[] };
}

/**
 * เดือนที่ยังต้องส่งเอกสารรับเงิน (บังคับแล้ว แต่ยังไม่มีเอกสารสถานะ ok) ของแต่ละอีเมล ในเดือนที่ขอ
 *   ใช้ในแจ้งเตือน "ใบ 50 ทวิพร้อมแล้ว" · ยังไม่บังคับ / อ่านไม่ได้ = ว่าง (ไม่บอกให้ส่ง)
 */
export async function receiptGaps(want: { email: string; month: string }[]) {
  const out = new Map<string, Set<string>>();
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  const need = want.filter((w) => receiptState(w.month, cfg.requiredFrom) !== "none");
  if (!need.length) return out;
  const { data, error } = await db.from("pay_receipts").select("email, month, status")
    .in("email", [...new Set(need.map((w) => norm(w.email)))]).eq("status", "ok");
  if (error) return out;
  const ok = new Set((data ?? []).map((r) => `${norm(r.email)}|${r.month}`));
  for (const w of need) {
    if (ok.has(`${norm(w.email)}|${w.month}`)) continue;
    out.set(norm(w.email), (out.get(norm(w.email)) ?? new Set()).add(w.month));
  }
  return out;
}

/**
 * เตือนคนที่ยังไม่ส่งเอกสารรับเงิน (cron ทุก 15 นาที → ส่งจริงทุก 3 วัน ตั้งแต่ 10:00 เวลาไทย)
 *   = มีใบ 50 ทวิจับคู่แล้วในเดือนที่บังคับ แต่ยังไม่มีเอกสารสถานะ ok (ไม่ผ่าน = นับว่ายังไม่ส่ง) · คนละ 1 ข้อความ
 */
export async function sendReceiptReminders(now = Date.now(), dryRun = false) {
  const bkk = new Date(now + 7 * 3600_000);
  const day = Math.floor((now + 7 * 3600_000) / 86400_000);
  if (bkk.getUTCHours() < 10 || day % 3 !== 0) return { sent: 0, items: [] as Parameters<typeof notifyMany>[0] };
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  if (!cfg.requiredFrom) return { sent: 0, items: [] };
  const { data: docs, error } = await db.from("tawi_docs").select("staff_id, month")
    .not("staff_id", "is", null).gte("month", cfg.requiredFrom);
  if (error || !docs?.length) return { sent: 0, items: [] };
  const { data: staff } = await db.from("staff").select("id, role, email").in("id", [...new Set(docs.map((d) => d.staff_id as number))]);
  const byId = new Map((staff ?? []).filter((s) => s.email).map((s) => [s.id as number, { email: norm(String(s.email)), role: s.role as Role }]));
  const want = docs.flatMap((d) => (byId.has(d.staff_id) ? [{ email: byId.get(d.staff_id)!.email, month: String(d.month) }] : []));
  const gaps = await receiptGaps(want);
  const roleOf = new Map([...byId.values()].map((p) => [p.email, p.role]));
  const today = bkk.toISOString().slice(0, 10);
  const items = [...gaps].map(([email, months]) => {
    const list = [...months].sort().map(tawiMonthLabel).join(", ");
    return {
      email, kind: "receipt" as const, page: roleOf.get(email) ?? ("mc" as const), dedupe: `receipt-remind:${today}`,
      title: `ยังไม่ได้ส่งเอกสารรับเงิน เดือน ${list}`,
      body: 'ส่งที่ "ตารางของฉัน" (กดรูปโปรไฟล์มุมขวาบน) → ใบ 50 ทวิ → ส่งเอกสารรับเงิน แล้วดาวน์โหลดใบ 50 ทวิได้ทันที',
    };
  });
  if (dryRun) return { sent: 0, items };
  return { sent: await notifyMany(items), items: [] };
}

/**
 * หน้าแรกของ Owner: คนที่ยังส่งเอกสารรับเงินไม่ครบ (มีใบ 50 ทวิจับคู่แล้วในเดือนที่บังคับ แต่ยังไม่มีเอกสารที่ผ่าน)
 *   นับแบบเดียวกับแผงเอกสารรับเงิน: แถวใน pay_receipts (ต่ออีเมล) ก่อน ไม่มี = ไฟล์เดิมใน Drive ที่จับคู่แล้ว (รายชื่อที่ไม่มีอีเมล)
 *   ยังไม่บังคับ / ยังไม่ได้รัน SQL = null (ไม่แสดง)
 */
export async function receiptPending(scope: DocsScope): Promise<HomeReceipts | null> {
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  const from = cfg.requiredFrom;
  if (!from) return null;
  const [tawi, receipts, files, staff] = await Promise.all([
    allRows<{ month: string; staff_id: number }>((a, b) => db.from("tawi_docs").select("month, staff_id")
      .not("staff_id", "is", null).gte("month", from).order("id").range(a, b)),
    allRows<ReceiptRow>((a, b) => db.from("pay_receipts").select("email, month, status").gte("month", from).order("id").range(a, b)),
    allRows<FileRow>((a, b) => db.from("receipt_files").select("month, staff_id").not("staff_id", "is", null).gte("month", from).order("id").range(a, b)),
    loadStaff(db),
  ]);
  if (tawi.error || receipts.error) return null;
  const byId = new Map(staff.map((s) => [s.id, s]));
  const status = new Map(receipts.rows.map((r) => [`e:${norm(r.email)}|${r.month}`, r.status]));
  const drive = new Set(files.rows.flatMap((f) => {
    const s = byId.get(Number(f.staff_id));
    return s ? [`${personOf(s)}|${f.month}`] : [];
  }));
  const people = new Map<string, HomeReceipts["people"][number]>();
  for (const t of tawi.rows) {
    const s = byId.get(Number(t.staff_id));
    if (!s || !docsCan(scope, s.role)) continue; // เฉพาะคนฝั่งที่ดูเอกสารได้
    const k = personOf(s), st = status.get(`${k}|${t.month}`);
    if (st === "ok" || (!st && drive.has(`${k}|${t.month}`))) continue;
    const p = people.get(k) ?? { label: label(s), hasEmail: !!s.email?.trim(), shopee: s.live_platform === "shopee", months: [], rejected: [] };
    if (!p.months.includes(t.month)) p.months.push(t.month);
    if (st === "rejected" && !p.rejected.includes(t.month)) p.rejected.push(t.month);
    people.set(k, p);
  }
  const list = [...people.values()].map((p) => ({ ...p, months: p.months.sort() }));
  list.sort((a, b) => b.rejected.length - a.rejected.length || Number(b.hasEmail) - Number(a.hasEmail) || a.label.localeCompare(b.label, "th"));
  return { requiredFrom: from, people: list };
}

/** สถานะเอกสารรับเงินของอีเมลนี้ในเดือนนี้ (ใช้ตอนดาวน์โหลดใบ 50 ทวิ) */
export async function receiptStateOf(email: string, month: string): Promise<ReceiptState> {
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  if (receiptState(month, cfg.requiredFrom) === "none") return "none";
  const { data, error } = await db.from("pay_receipts").select("status").eq("email", norm(email)).eq("month", month).maybeSingle();
  if (error) return "none";
  return receiptState(month, cfg.requiredFrom, data as { status: string } | null);
}

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/**
 * โฟลเดอร์ของคนนี้เดือนนี้ใต้โฟลเดอร์ Mc / Admin
 *   1. id ที่จำไว้ (ยังอยู่ในโฟลเดอร์เดิม ไม่อยู่ในถังขยะ) 2. ชื่อตรง ("Mc ปลื้ม (ชื่อจริง)") / ชื่อแบบไม่มีชื่อจริง ("Mc ปลื้ม" — เพิ่งรู้ชื่อจริง) 3. สร้างใหม่
 *   ชื่อไม่ตรงกับที่ควรเป็น = เปลี่ยนชื่อโฟลเดอร์ (เฉพาะโฟลเดอร์คนที่เว็บสร้าง) · taken = โฟลเดอร์ที่คนอื่นใช้เดือนนี้ (ไม่ใช้ร่วม)
 */
async function personFolder(drive: Drive, side: string, o: { remembered: string | null; want: string; display: string; taken: Set<string> }) {
  let hit: { id: string; name: string } | null = null;
  if (o.remembered && !o.taken.has(o.remembered)) {
    const f = await drive.files.get({ fileId: o.remembered, fields: "id, name, trashed, parents", supportsAllDrives: true })
      .then((r) => r.data).catch(() => null);
    if (f?.id && !f.trashed && f.parents?.includes(side)) hit = { id: f.id, name: f.name ?? "" };
  }
  if (!hit) {
    const { data } = await drive.files.list({
      q: `${quote(side)} in parents and trashed=false and mimeType='${FOLDER}'`,
      fields: "files(id, name)", pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    const list = (data.files ?? []).filter((f) => f.id && !o.taken.has(f.id)).map((f) => ({ id: f.id!, name: (f.name ?? "").normalize("NFC") }));
    hit = list.find((f) => f.name === o.want) ?? (o.want !== o.display ? list.find((f) => f.name === o.display) : undefined) ?? null;
  }
  if (!hit) {
    const res = await drive.files.create({ requestBody: { name: o.want, mimeType: FOLDER, parents: [side] }, fields: "id" });
    return res.data.id!;
  }
  if (hit.name !== o.want) {
    await drive.files.update({ fileId: hit.id, requestBody: { name: o.want } }).catch(() => undefined);
  }
  return hit.id;
}

/**
 * เจ้าตัวส่งเอกสารรับเงินของเดือนนี้ (ไฟล์ผ่านการตรวจชนิด / ขนาดแล้ว) -> อัปขึ้น Drive -> บันทึก (สถานะ ok ดาวน์โหลดได้ทันที)
 *   ลงโฟลเดอร์ Mc / Admin ตามบทบาทที่ใบ 50 ทวิเดือนนั้นจับคู่ไว้ (ไม่ชัด = Mc) > โฟลเดอร์คน "Mc ชื่อเล่น (ชื่อจริง)"
 *   ชื่อจริง = ชื่อในใบ 50 ทวิเดือนนั้นที่จับคู่ให้คนนี้ (ที่เจ้าตัวยืนยันแล้วก่อน) / staff.legal_name — ไม่รู้ = ชื่อที่แสดงอย่างเดียว
 *   ส่งซ้ำ = ไฟล์เดิมที่ส่งผ่านเว็บ + "เอกสารรับเงิน YYYY-MM.*" ในโฟลเดอร์คนลงถังขยะ (ไฟล์เดิมที่ทีมบัญชีอัปเองไม่แตะ)
 */
export async function saveReceipt(email: string, month: string, bytes: Uint8Array, mime: string) {
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  if (!cfg.ready) throw new Error(RECEIPT_SQL);
  if (!cfg.folder) throw new Error("ยังไม่เปิดรับเอกสารรับเงิน (ทีมงานยังไม่ได้ตั้งโฟลเดอร์ Google Drive) ลองใหม่ภายหลัง");
  const key = norm(email);
  // select * = ได้ legal_name / คีย์ชื่อที่ยืนยันแล้ว (ถ้ามีคอลัมน์)
  const { data: staffData, error: staffErr } = await db.from("staff").select("*").eq("email", key).in("role", ["mc", "admin"]).order("id");
  if (staffErr) throw new Error(staffErr.message);
  const staff = (staffData ?? []) as StaffLite[];
  if (!staff.length) throw new Error("ไม่พบรายชื่อ Mc / Admin ของบัญชีนี้");
  // ใบ 50 ทวิของคนนี้ (ยังไม่ได้รัน SQL ใบ 50 ทวิ = ไม่มี)
  const { data: tawiData } = await db.from("tawi_docs").select("id, month, staff_id, real_name, name_key").in("staff_id", staff.map((s) => s.id)).order("id");
  const tawi = (tawiData ?? []) as { month: string; staff_id: number; real_name: string | null; name_key: string }[];
  if (!receiptMonthOk(month, tawi.map((t) => t.month))) throw new Error("ส่งเอกสารของเดือนนี้ไม่ได้ (เลือกเดือนที่มีใบ 50 ทวิ หรือเดือนที่ผ่านมาแล้ว)");
  const byId = new Map(staff.map((s) => [s.id, s]));
  const role = receiptRole(staff.map((s) => s.role), tawi.filter((t) => t.month === month).map((t) => byId.get(t.staff_id)?.role).filter((r) => !!r) as Role[]);
  const person = staff.find((s) => s.role === role) ?? staff[0];
  const display = label(person);
  const realName = receiptRealName(month, tawi, staff.flatMap((s) => s.tawi_verified_keys ?? []), staff.find((s) => s.legal_name?.trim())?.legal_name ?? null);
  const folderName = receiptPersonFolder(display, realName);
  const name = receiptWebFileName(month, receiptExt(mime));
  const v2 = await hasSource(db);

  const run = await withSyncLock(`receipt:${key}`, async () => {
    const { data: curData, error } = await db.from("pay_receipts").select("*").eq("email", key).eq("month", month).maybeSingle();
    if (error) throw dbError(error.message);
    const cur = curData as ReceiptRow | null;
    // โฟลเดอร์ที่คนอื่นใช้เดือนนี้ (ชื่อที่แสดงซ้ำกัน + ไม่รู้ชื่อจริง = ไม่ใช้โฟลเดอร์ร่วม กันไฟล์ของอีกคนลงถังขยะ)
    const taken = new Set<string>();
    if (v2) {
      const { data: others } = await db.from("pay_receipts").select("folder_id").eq("month", month).neq("email", key).not("folder_id", "is", null);
      for (const o of others ?? []) if (o.folder_id) taken.add(String(o.folder_id));
    }
    const drive = driveClient();
    let fileId: string, folderId: string, same: string[];
    try {
      const f = receiptFolders(month);
      const cache = new Map<string, string>();
      const year = await folder(drive, f.year, cfg.folder!, cache);
      const mon = await folder(drive, f.month, year, cache);
      const side = await folder(drive, role === "mc" ? "Mc" : "Admin", mon, cache);
      folderId = await personFolder(drive, side, { remembered: cur?.folder_id ?? null, want: folderName, display, taken });
      // ไฟล์ของเดือนนี้ที่ส่งผ่านเว็บไว้ในโฟลเดอร์คนนี้ ลงถังขยะหลังบันทึกไฟล์ใหม่สำเร็จ
      const { data: inFolder } = await drive.files.list({
        q: `${quote(folderId)} in parents and trashed=false and mimeType != '${FOLDER}'`,
        fields: "files(id, name)", pageSize: 200, supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      same = (inFolder.files ?? []).filter((x) => x.id && isWebFileOf(x.name ?? "", month)).map((x) => x.id!);
      const res = await drive.files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType: mime, body: Readable.from(Buffer.from(bytes)) },
        fields: "id",
      });
      fileId = res.data.id!;
    } catch (err) {
      throw driveFail(/file not found/i.test((err as Error)?.message ?? "")
        ? "บัญชีระบบเข้าโฟลเดอร์เอกสารรับเงินใน Drive ไม่ได้ แจ้งทีมงาน (แชร์โฟลเดอร์ให้บัญชีระบบเป็นผู้แก้ไข)"
        : `อัปไฟล์ขึ้น Google Drive ไม่สำเร็จ: ${driveError(err)}`);
    }
    const now = new Date().toISOString();
    const { data: saved, error: saveErr } = await db.from("pay_receipts").upsert({
      email: key, staff_id: person.id, month, drive_file_id: fileId, file_name: name, mime, size: bytes.byteLength,
      status: "ok", reject_reason: null, reviewed_by: null, reviewed_at: null, uploaded_at: now, updated_at: now,
      ...(v2 ? { source: "web", folder_id: folderId } : {}),
    }, { onConflict: "email,month" }).select("*").single();
    if (saveErr || !saved) {
      await drive.files.update({ fileId, requestBody: { trashed: true } }).catch(() => undefined);
      throw dbError(saveErr?.message ?? "บันทึกไม่สำเร็จ");
    }
    // ไฟล์เดิมที่ส่งผ่านเว็บ (ย้ายลงถังขยะ กู้คืนได้ 30 วัน) — ไฟล์เดิมใน Drive ที่จับคู่ให้ (source drive) ไม่แตะ · พลาดไม่เป็นไร
    const old = [...new Set([cur && isWeb(cur) ? cur.drive_file_id : null, ...same])].filter((x): x is string => !!x && x !== fileId);
    for (const id of old) await drive.files.update({ fileId: id, requestBody: { trashed: true } }).catch(() => undefined);
    return { row: saved as ReceiptRow, replaced: !!cur, label: display };
  }, 10_000);
  if (!run) throw new Error("กำลังส่งไฟล์ของเดือนนี้อยู่ ลองใหม่อีกครั้ง");
  return run;
}

/**
 * Owner เห็นเอกสารของอีเมลนี้ไหม (ฝั่งที่ดูเอกสารได้) — คนเดียวเป็นทั้ง Mc และ Admin = เห็นได้จากฝั่งใดฝั่งหนึ่ง
 *   ไม่มีในรายชื่อ Mc / Admin แล้ว = เห็นเฉพาะคนที่ดูได้ทั้งสองฝั่ง
 */
export async function receiptVisible(email: string | null, scope: DocsScope) {
  if (scope.mc && scope.admin) return true;
  if (!email) return false;
  const { data } = await createAdminClient().from("staff").select("role").eq("email", norm(email)).in("role", ["mc", "admin"]);
  return (data ?? []).some((s) => docsCan(scope, String(s.role)));
}

/** ตรวจเอกสาร (ไม่ผ่าน / ยกเลิกไม่ผ่าน) ได้เฉพาะเอกสารของคนฝั่งที่ดูได้ */
export async function requireReceiptSide(id: number, scope: DocsScope) {
  const row = await receiptById(id);
  if (!row) throw new Error("ไม่พบเอกสารนี้ กดโหลดใหม่");
  if (!(await receiptVisible(row.email, scope))) throw Object.assign(new Error(NO_SIDE), { status: 403 });
}

/** แถวตาม id (ไฟล์ให้เปิด: ตรวจสิทธิ์แล้วค่อยส่งไฟล์) */
export async function receiptById(id: number) {
  const { data, error } = await createAdminClient().from("pay_receipts").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError(error.message);
  return (data as ReceiptRow | null) ?? null;
}

/** ไฟล์เดิมใน Drive ตาม id ของ receipt_files + อีเมลของคนที่จับคู่ไว้ (ไม่มี = null) */
export async function receiptFileById(id: number) {
  const db = createAdminClient();
  const { data, error } = await db.from("receipt_files").select("id, month, drive_file_id, mime, staff_id, role").eq("id", id).maybeSingle();
  if (error) throw filesError(error.message);
  if (!data) return null;
  let ownerEmail: string | null = null, ownerRole: string | null = null;
  if (data.staff_id) {
    const { data: s } = await db.from("staff").select("email, role").eq("id", data.staff_id).maybeSingle();
    ownerEmail = (s?.email as string | null)?.trim().toLowerCase() || null;
    ownerRole = (s?.role as string | null) ?? null;
  }
  // ฝั่งของไฟล์: คนที่จับคู่ไว้ ไม่มี = โฟลเดอร์ Mc / Admin ที่ไฟล์อยู่
  return { month: String(data.month), fileId: String(data.drive_file_id), mime: String(data.mime ?? ""), ownerEmail, role: ownerRole ?? String(data.role) };
}

/** ไฟล์จาก Drive */
export async function downloadReceipt(fileId: string) {
  const res = await driveClient().files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  return new Uint8Array(res.data as ArrayBuffer);
}

/** ทุกแถว (ทีละ 1000 แถว) */
async function allRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) return { rows: out, error: error.message };
    out.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE) return { rows: out, error: null };
  }
}

/** รายชื่อ Mc / Admin (select * = ได้ legal_name ถ้ามีคอลัมน์) */
async function loadStaff(db: Db) {
  const { data, error } = await db.from("staff").select("*").in("role", ["mc", "admin"]).order("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffLite[];
}

/**
 * รายชื่อสำหรับจับคู่ไฟล์: ชื่อในระบบ (ชื่อเล่น) + คีย์ชื่อจริงที่ Owner รับรองแล้วต่อคน
 *   (legal_name / ชื่อในใบ 50 ทวิที่จับคู่ให้คนนั้นแล้ว)
 *   ไม่ใช้ชื่อในเอกสารทำเบิก (pay_docs.full_name): เจ้าตัวพิมพ์เอง ไม่มีใครตรวจกับบัตร — พิมพ์ชื่อเพื่อนจะได้ไฟล์ของเพื่อน
 */
async function candidatesOf(db: Db, staff: StaffLite[]): Promise<ReceiptCandidate[]> {
  const td = await allRows<{ staff_id: number; name_key: string }>((a, b) => db.from("tawi_docs").select("staff_id, name_key").not("staff_id", "is", null).order("id").range(a, b));
  const keys = new Map<string, Set<string>>();
  const add = (person: string, k: string) => { if (k.length >= 4) keys.set(person, (keys.get(person) ?? new Set()).add(k)); };
  const byId = new Map(staff.map((s) => [s.id, s]));
  for (const s of staff) if (s.legal_name?.trim()) add(personOf(s), tawiNameKey(s.legal_name));
  for (const t of td.rows) {
    const s = byId.get(Number(t.staff_id));
    if (s) add(personOf(s), String(t.name_key));
  }
  return staff.map((s) => ({ id: s.id, role: s.role, person: personOf(s), nick: s.name, label: label(s), realKeys: [...(keys.get(personOf(s)) ?? [])], shopee: s.live_platform === "shopee",
  }));
}

/**
 * หน้า Owner: สรุปต่อเดือน (ต้องส่ง = คนที่มีใบ 50 ทวิเดือนนั้น ตั้งแต่เดือนเริ่มบังคับ) + รายชื่อของเดือนที่เลือก
 *   + ไฟล์เดิมใน Drive ที่ยังไม่จับคู่ของเดือนนั้น (ยังไม่ได้รัน SQL receipt_files = drive.ready false)
 *   รายชื่อที่ไม่มีอีเมล: ไฟล์ใน Drive ที่จับคู่แล้วนับว่าส่งแล้ว (ไม่มีแถวใน pay_receipts เพราะเข้าเว็บไม่ได้)
 */
export async function ownerReceipts(month: string | null, scope: DocsScope): Promise<OwnerReceipts> {
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  const off: OwnerReceipts = {
    ready: false, folderSet: false, requiredFrom: null, month: null, months: [], people: [], drive: { ready: false, files: [], people: [] },
  };
  if (!cfg.ready) return off;
  const from = cfg.from;
  const [receiptsAll, allStaff, tawiAll, filesAll] = await Promise.all([
    allRows<ReceiptRow>((a, b) => db.from("pay_receipts").select("*").order("id").range(a, b)),
    loadStaff(db),
    from
      ? allRows<{ month: string; staff_id: number }>((a, b) => db.from("tawi_docs").select("month, staff_id")
        .not("staff_id", "is", null).gte("month", from).order("id").range(a, b))
      : Promise.resolve({ rows: [] as { month: string; staff_id: number }[], error: null }),
    allRows<FileRow>((a, b) => db.from("receipt_files").select("*").order("id").range(a, b)),
  ]);
  if (receiptsAll.error) {
    if (noSql(receiptsAll.error)) return off;
    throw new Error(receiptsAll.error);
  }
  // เฉพาะฝั่งที่ดูเอกสารได้: คน (อีเมล) ที่มีแถวฝั่งนั้น · ไฟล์ที่ยังไม่จับคู่ = ตามโฟลเดอร์ Mc / Admin ที่ไฟล์อยู่
  const roleById = new Map(allStaff.map((s) => [s.id, s.role]));
  const staff = allStaff.filter((s) => docsCan(scope, s.role));
  const seen = new Set(staff.map(personOf));
  const both = scope.mc && scope.admin;
  const receipts = { ...receiptsAll, rows: receiptsAll.rows.filter((r) => both || seen.has(`e:${norm(r.email)}`)) };
  const tawi = { ...tawiAll, rows: tawiAll.rows.filter((t) => docsCan(scope, roleById.get(Number(t.staff_id)) ?? "")) };
  const filesRes = {
    ...filesAll,
    rows: filesAll.rows.filter((f) => (f.staff_id ? docsCan(scope, roleById.get(Number(f.staff_id)) ?? "") : docsCan(scope, f.role))),
  };
  const driveReady = !filesRes.error;
  const files = driveReady ? filesRes.rows : [];
  const byId = new Map(staff.map((s) => [s.id, s]));
  // ชื่อที่แสดงต่อคน (Mc ก่อน — คนที่เป็นทั้งคู่)
  const nameOf = new Map<string, StaffLite>();
  for (const s of [...staff].sort((a, b) => Number(a.role !== "mc") - Number(b.role !== "mc"))) {
    if (!nameOf.has(personOf(s))) nameOf.set(personOf(s), s);
  }

  // เดือน -> คนที่ต้องส่ง (ชื่อตามรายชื่อที่ใบ 50 ทวิจับคู่ไว้)
  const required = new Map<string, Map<string, StaffLite>>();
  for (const t of tawi.rows) {
    const s = byId.get(Number(t.staff_id));
    if (!s) continue;
    const m = required.get(t.month) ?? new Map<string, StaffLite>();
    if (!m.has(personOf(s))) m.set(personOf(s), s);
    required.set(t.month, m);
  }
  const sentBy = new Map<string, Map<string, ReceiptRow>>();
  for (const r of receipts.rows) {
    const m = sentBy.get(r.month) ?? new Map<string, ReceiptRow>();
    m.set(`e:${norm(r.email)}`, r);
    sentBy.set(r.month, m);
  }
  // เดือน -> คน -> ไฟล์เดิมใน Drive ที่จับคู่แล้ว
  const driveBy = new Map<string, Map<string, FileRow[]>>();
  const unmatchedBy = new Map<string, FileRow[]>();
  for (const f of files) {
    const s = f.staff_id ? byId.get(Number(f.staff_id)) : undefined;
    if (!s) {
      unmatchedBy.set(f.month, [...(unmatchedBy.get(f.month) ?? []), f]);
      continue;
    }
    const m = driveBy.get(f.month) ?? new Map<string, FileRow[]>();
    m.set(personOf(s), [...(m.get(personOf(s)) ?? []), f]);
    driveBy.set(f.month, m);
  }
  const sentOk = (k: string, sent: Map<string, ReceiptRow>, drv: Map<string, FileRow[]>) =>
    sent.has(k) ? sent.get(k)!.status === "ok" : (drv.get(k)?.length ?? 0) > 0;

  const allMonths = [...new Set([...required.keys(), ...sentBy.keys(), ...driveBy.keys(), ...unmatchedBy.keys()])].sort((a, b) => b.localeCompare(a));
  const months = allMonths.map((m) => {
    const req = required.get(m) ?? new Map(), sent = sentBy.get(m) ?? new Map<string, ReceiptRow>(), drv = driveBy.get(m) ?? new Map<string, FileRow[]>();
    return {
      month: m, required: req.size,
      sent: [...req.keys()].filter((k) => sentOk(k, sent, drv)).length,
      rejected: [...sent.values()].filter((r) => r.status === "rejected").length,
      received: [...new Set([...sent.keys(), ...drv.keys()])].filter((k) => sentOk(k, sent, drv)).length,
      unmatched: (unmatchedBy.get(m) ?? []).filter((f) => !f.matched_by).length,
    };
  });
  const pick = month && allMonths.includes(month) ? month : allMonths[0] ?? null;

  const people: OwnerReceiptPerson[] = [];
  let driveFiles: ReceiptDriveFile[] = [];
  if (pick) {
    const req = required.get(pick) ?? new Map<string, StaffLite>(), sent = sentBy.get(pick) ?? new Map<string, ReceiptRow>();
    const drv = driveBy.get(pick) ?? new Map<string, FileRow[]>();
    for (const k of new Set([...req.keys(), ...sent.keys(), ...drv.keys()])) {
      const s = req.get(k) ?? nameOf.get(k);
      const r = sent.get(k);
      people.push({
        key: k, label: s ? label(s) : r?.email ?? k, hasEmail: k.startsWith("e:"), required: req.has(k),
        receipt: r ? { ...receiptView(r), reviewedAt: r.reviewed_at } : null,
        driveFiles: (drv.get(k) ?? []).map((f) => ({ id: Number(f.id), fileName: f.file_name, matchedBy: f.matched_by })),
      });
    }
    const rank = (p: OwnerReceiptPerson) => (p.receipt?.status === "rejected" ? 1 : p.receipt || p.driveFiles.length ? 2 : 0);
    people.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "th"));

    const loose = unmatchedBy.get(pick) ?? [];
    if (loose.length) {
      const cands = await candidatesOf(db, staff);
      driveFiles = loose.map((f) => ({
        id: Number(f.id), month: f.month, role: f.role, fileName: f.file_name, path: f.path, nick: f.nick, realName: f.real_name,
        ignored: f.matched_by === "owner",
        suggest: f.matched_by === "owner" ? [] : suggestReceiptPeople({ role: f.role, key: f.name_key, nick: f.nick, realName: f.real_name }, cands)
          .map((x) => ({ id: x.id, score: Math.round(x.score * 100) / 100 })),
      })).sort((a, b) => Number(a.ignored) - Number(b.ignored) || a.role.localeCompare(b.role) || a.nick.localeCompare(b.nick, "th"));
    }
  }
  const options: TawiPerson[] = staff
    .map((s) => ({ id: s.id, role: s.role, label: label(s), legalName: s.legal_name?.trim() || null, hasEmail: !!s.email?.trim() }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
  return {
    ready: true, folderSet: !!cfg.folder, requiredFrom: from, month: pick, months, people,
    drive: { ready: driveReady, files: driveFiles, people: driveReady ? options : [] },
  };
}

/**
 * Owner ตรวจเอกสาร: reject = ไม่ผ่าน (ต้องมีเหตุผล) / ไม่ใช่ = ยกเลิกไม่ผ่าน (กลับเป็นผ่าน)
 *   seenAt = เวลาส่งของไฟล์ที่ Owner เห็น — เจ้าตัวส่งไฟล์ใหม่ระหว่างนั้น = ไม่ทำ (กันตีกลับไฟล์ที่ยังไม่ได้ดู)
 */
export async function reviewReceipt(id: number, reject: boolean, reason: string, seenAt: string, by: string) {
  const db = createAdminClient();
  const row = await receiptById(id);
  if (!row) throw new Error("ไม่พบเอกสารนี้ กดโหลดใหม่");
  if (Date.parse(row.uploaded_at) !== Date.parse(seenAt)) throw new Error("เจ้าตัวส่งไฟล์ใหม่แล้ว กดโหลดใหม่แล้วเปิดดูไฟล์ล่าสุดก่อน");
  const now = new Date().toISOString();
  const { data, error } = await db.from("pay_receipts").update({
    status: reject ? "rejected" : "ok", reject_reason: reject ? reason : null, reviewed_by: norm(by), reviewed_at: now, updated_at: now,
  }).eq("id", id).eq("drive_file_id", row.drive_file_id).select("id");
  if (error) throw dbError(error.message);
  if (!data?.length) throw new Error("เจ้าตัวส่งไฟล์ใหม่แล้ว กดโหลดใหม่");
  return { ...row, reviewed_at: now };
}

/** แจ้งเจ้าตัวว่าเอกสารไม่ผ่าน (ส่งใหม่แล้วถูกตีกลับอีก = แจ้งอีกครั้ง) */
export async function notifyReceiptRejected(row: ReceiptRow, reason: string) {
  const { data: s } = row.staff_id
    ? await createAdminClient().from("staff").select("role").eq("id", row.staff_id).maybeSingle()
    : { data: null };
  const role = s?.role === "mc" || s?.role === "admin" ? s.role : null;
  await notify([row.email], {
    kind: "receipt", page: role, dedupe: `receipt-reject:${row.id}:${row.reviewed_at}`,
    title: `เอกสารรับเงินเดือน ${tawiMonthLabel(row.month)} ไม่ผ่าน — ส่งใหม่`,
    body: `เหตุผล: ${reason}\nส่งใหม่ได้ที่ "ตารางของฉัน" (กดรูปโปรไฟล์มุมขวาบน) ส่งแล้วดาวน์โหลดใบ 50 ทวิเดือนนี้ได้ทันที`,
  });
}

// ---------- ไฟล์เดิมใน Drive (ตาราง receipt_files) ----------

type DFile = { id: string; name: string; mime: string; size: number; created: string | null; parent: string };

/** ลูกของหลายโฟลเดอร์ในคำขอเดียว (ทีละ 40 โฟลเดอร์) — kind: เฉพาะโฟลเดอร์ / เฉพาะไฟล์ / ทั้งหมด */
async function listIn(drive: Drive, parents: string[], kind: "folders" | "files" | "all") {
  const out: DFile[] = [];
  for (const part of chunks(parents, 40)) {
    const type = kind === "folders" ? ` and mimeType = '${FOLDER}'` : kind === "files" ? ` and mimeType != '${FOLDER}'` : "";
    const q = `(${part.map((p) => `${quote(p)} in parents`).join(" or ")}) and trashed=false${type}`;
    let pageToken: string | undefined;
    do {
      const { data } = await drive.files.list({
        q, fields: "nextPageToken, files(id, name, mimeType, size, createdTime, parents)", pageSize: 1000, pageToken,
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      for (const f of data.files ?? []) {
        out.push({
          id: f.id!, name: (f.name ?? "").normalize("NFC"), mime: f.mimeType ?? "", size: Number(f.size ?? 0), created: f.createdTime ?? null,
          parent: (f.parents ?? []).find((p) => part.includes(p)) ?? part[0],
        });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return out;
}

type Seen = { fileName: string; month: string; role: Role; path: string; mime: string; size: number; created: string | null; nick: string; realName: string | null; key: string };

/**
 * อ่านไฟล์ทั้งหมด: โฟลเดอร์หลัก > ปี (2026) > เดือน (09 September) > Mc / Admin > ไฟล์ + โฟลเดอร์ย่อย 1 ชั้น (เช่น Shopee / โฟลเดอร์คน)
 *   เฉพาะรูป / PDF · ข้ามไฟล์ที่ส่งผ่านเว็บ (webIds) · อ่านชื่อไม่ได้ / ใบแจ้งหนี้บริษัท = skipped
 */
async function readDrive(drive: Drive, root: string, webIds: Set<string>) {
  const years = (await listIn(drive, [root], "folders")).filter((f) => /^20\d\d$/.test(f.name.trim()));
  const yearName = new Map(years.map((y) => [y.id, y.name.trim()]));
  const months = (await listIn(drive, years.map((y) => y.id), "folders"))
    .map((m) => ({ ...m, month: receiptFolderMonth(yearName.get(m.parent) ?? "", m.name) }))
    .filter((m): m is DFile & { month: string } => !!m.month);
  const monthOf = new Map(months.map((m) => [m.id, m.month]));
  const roles = (await listIn(drive, months.map((m) => m.id), "folders"))
    .map((r) => ({ ...r, role: roleFolder(r.name), month: monthOf.get(r.parent)! }))
    .filter((r): r is DFile & { role: Role; month: string } => !!r.role);
  const roleOf = new Map(roles.map((r) => [r.id, r]));
  const items = roles.length ? await listIn(drive, roles.map((r) => r.id), "all") : [];
  const subs = items.filter((x) => x.mime === FOLDER);
  const subOf = new Map(subs.map((s) => [s.id, s]));
  const subFiles = subs.length ? await listIn(drive, subs.map((s) => s.id), "files") : [];

  const seen = new Map<string, Seen>();
  let skipped = 0;
  for (const f of [...items.filter((x) => x.mime !== FOLDER), ...subFiles]) {
    if (webIds.has(f.id)) continue;
    const sub = subOf.get(f.parent);
    const r = roleOf.get(sub ? sub.parent : f.parent);
    if (!r) continue;
    const okType = f.mime.startsWith("image/") || f.mime === "application/pdf";
    const p = okType ? parseReceiptFile(f.name, { month: r.month, role: r.role, subfolder: sub?.name ?? null }) : null;
    if (!p) { skipped++; continue; }
    seen.set(f.id, {
      fileName: f.name, month: p.month, role: p.role, path: sub ? `${r.name}/${sub.name}` : r.name, mime: f.mime, size: f.size,
      created: f.created, nick: p.nick, realName: p.realName, key: p.key,
    });
  }
  return { seen, skipped };
}

/** จับคู่ไฟล์ที่ยังไม่มีเจ้าของ: ชื่อที่ Owner เคยเลือกไว้ (บทบาท + คีย์เดียวกัน) ก่อน แล้วค่อยเทียบชื่อ (ชัดเจนคนเดียว) — คืนจำนวนที่จับคู่ได้ */
async function autoMatch(db: Db, rows: FileRow[], staff: StaffLite[]) {
  const ids = new Set(staff.map((s) => s.id));
  // "role:key" -> staff id ที่ Owner เลือก (0 = Owner ตั้งว่าไม่ใช่คนในระบบ)
  const mem = new Map<string, number>();
  for (const r of rows) if (r.matched_by === "owner") mem.set(`${r.role}:${r.name_key}`, r.staff_id ?? 0);
  // matched_by auto + ไม่มีคน = รายชื่อที่จับคู่ไว้ถูกลบ -> จับใหม่
  const todo = rows.filter((r) => !r.staff_id && r.matched_by !== "owner");
  if (!todo.length) return 0;
  const cands = await candidatesOf(db, staff);
  const patches = new Map<string, number[]>(); // "staffId|by" -> ids
  for (const r of todo) {
    const m = mem.get(`${r.role}:${r.name_key}`);
    let staffId: number | null, by: "auto" | "owner";
    if (m !== undefined && (m === 0 || ids.has(m))) { staffId = m || null; by = "owner"; }
    else {
      staffId = matchReceiptFile({ role: r.role, key: r.name_key, nick: r.nick, realName: r.real_name }, cands, new Map());
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
      const { error } = await db.from("receipt_files").update({ staff_id: sid ? Number(sid) : null, matched_by: by, updated_at: now })
        .in("id", part).is("staff_id", null);
      if (error) throw filesError(error.message);
    }
    if (sid) n += list.length;
  }
  return n;
}

/**
 * ไฟล์เดิมที่จับคู่แล้ว -> pay_receipts (source drive, สถานะ ok) ต่อคน (อีเมล) ต่อเดือน — คืนจำนวนแถวที่เปลี่ยน
 *   เดือนนั้นส่งผ่านเว็บแล้ว = ไม่แตะ · ไฟล์ที่ชี้อยู่ไม่ได้จับคู่กับคนนี้แล้ว = เปลี่ยนเป็นไฟล์อื่นของคนนี้ / ลบแถว (ไม่มีไฟล์เหลือ)
 *   รายชื่อที่ไม่มีอีเมล = ข้าม (pay_receipts ต้องมีอีเมล — ส่วนของ Owner นับจาก receipt_files แทน)
 */
async function syncDriveReceipts(db: Db) {
  const [files, receipts, staff] = await Promise.all([
    allRows<FileRow>((a, b) => db.from("receipt_files").select("*").not("staff_id", "is", null).order("id").range(a, b)),
    allRows<ReceiptRow>((a, b) => db.from("pay_receipts").select("*").order("id").range(a, b)),
    loadStaff(db),
  ]);
  if (files.error) throw filesError(files.error);
  if (receipts.error) throw dbError(receipts.error);
  const byId = new Map(staff.map((s) => [s.id, s]));
  const groups = new Map<string, { email: string; staffId: number; month: string; files: FileRow[] }>();
  for (const f of files.rows) {
    const s = byId.get(Number(f.staff_id));
    if (!s?.email?.trim()) continue;
    const k = `${norm(s.email)}|${f.month}`;
    const g = groups.get(k) ?? { email: norm(s.email), staffId: s.id, month: f.month, files: [] };
    g.files.push(f);
    groups.set(k, g);
  }
  const rows = new Map(receipts.rows.map((r) => [`${norm(r.email)}|${r.month}`, r]));
  const now = new Date().toISOString();
  let n = 0;
  const fileFields = (f: FileRow) => ({ drive_file_id: f.drive_file_id, file_name: f.file_name, mime: f.mime, size: Number(f.size) || 0 });
  for (const [k, g] of groups) {
    // ไฟล์ในโฟลเดอร์ Mc / Admin โดยตรงก่อนไฟล์ในโฟลเดอร์ย่อย
    const [f] = [...g.files].sort((a, b) => Number(a.path.includes("/")) - Number(b.path.includes("/")) || a.id - b.id);
    const row = rows.get(k);
    if (!row) {
      const { error } = await db.from("pay_receipts").upsert({
        email: g.email, staff_id: g.staffId, month: g.month, ...fileFields(f), status: "ok", source: "drive",
        uploaded_at: f.file_created_at ?? now, updated_at: now,
      }, { onConflict: "email,month", ignoreDuplicates: true });
      if (error) throw filesError(error.message);
      n++;
    } else if (row.source === "drive" && !g.files.some((x) => x.drive_file_id === row.drive_file_id)) {
      const { error } = await db.from("pay_receipts").update({
        staff_id: g.staffId, ...fileFields(f), status: "ok", reject_reason: null, reviewed_by: null, reviewed_at: null,
        uploaded_at: f.file_created_at ?? now, updated_at: now,
      }).eq("id", row.id).eq("source", "drive");
      if (error) throw filesError(error.message);
      n++;
    }
  }
  for (const [k, row] of rows) {
    if (row.source !== "drive" || groups.has(k)) continue;
    const { error } = await db.from("pay_receipts").delete().eq("id", row.id).eq("source", "drive").eq("drive_file_id", row.drive_file_id);
    if (error) throw filesError(error.message);
    n++;
  }
  return n;
}

export type ReceiptScan = {
  configured: boolean; files: number; added: number; removed: number; renamed: number; matched: number; unmatched: number; synced: number; skipped: number;
};

/**
 * ตรวจไฟล์เดิมใน Drive -> บันทึกไฟล์ใหม่ / ชื่อเปลี่ยน / ลบแถวของไฟล์ที่หายไป -> จับคู่อัตโนมัติ -> นับเป็นส่งแล้ว (pay_receipts)
 *   อ่าน Drive อย่างเดียว (ไม่ย้าย / ไม่เปลี่ยนชื่อ / ไม่ลบไฟล์) · ไม่ส่งแจ้งเตือน
 *   ยังไม่ได้ตั้งโฟลเดอร์ = configured: false · ยังไม่ได้รัน SQL / Drive ขัดข้อง = throw
 */
export async function scanReceiptFiles(): Promise<ReceiptScan> {
  const run = await withSyncLock("receipt-scan", async () => {
    const db = createAdminClient();
    const cfg = await loadConfig(db);
    if (!cfg.ready) throw new Error(RECEIPT_SQL);
    const empty = { files: 0, added: 0, removed: 0, renamed: 0, matched: 0, unmatched: 0, synced: 0, skipped: 0 };
    if (!cfg.folder) return { configured: false, ...empty };
    const [existingRes, receipts] = await Promise.all([
      allRows<FileRow>((a, b) => db.from("receipt_files").select("*").order("id").range(a, b)),
      allRows<ReceiptRow>((a, b) => db.from("pay_receipts").select("*").order("id").range(a, b)),
    ]);
    if (existingRes.error) throw filesError(existingRes.error);
    if (receipts.error) throw dbError(receipts.error);
    if (!(await hasSource(db))) throw new Error(RECEIPT_FILES_SQL);
    const existing = existingRes.rows;
    const webIds = new Set(receipts.rows.filter(isWeb).map((r) => r.drive_file_id));

    // 1. อ่านรายการไฟล์ทั้งหมดก่อน (พลาดกลางทาง = throw ไม่ลบแถวใดๆ)
    let seen: Map<string, Seen>, skipped: number;
    try {
      ({ seen, skipped } = await readDrive(driveClient(), cfg.folder, webIds));
    } catch (err) {
      throw driveFail(/file not found/i.test((err as Error)?.message ?? "")
        ? "บัญชีระบบเข้าโฟลเดอร์เอกสารรับเงินใน Drive ไม่ได้ (แชร์โฟลเดอร์ให้บัญชีระบบ หรือตรวจ id โฟลเดอร์)"
        : `อ่านไฟล์ใน Google Drive ไม่สำเร็จ: ${driveError(err)}`);
    }
    if (!seen.size && existing.length) throw new Error("ไม่พบไฟล์เอกสารรับเงินใน Drive (ไม่ลบข้อมูลเดิม ตรวจโฟลเดอร์ใน Drive)");

    // 2. เทียบกับที่บันทึกไว้
    const now = new Date().toISOString();
    const byFile = new Map(existing.map((r) => [r.drive_file_id, r]));
    const fields = (p: Seen) => ({
      month: p.month, role: p.role, file_name: p.fileName, path: p.path, mime: p.mime, size: p.size,
      nick: p.nick, real_name: p.realName, name_key: p.key, file_created_at: p.created,
    });
    const inserts = [...seen].filter(([id]) => !byFile.has(id)).map(([id, p]) => ({ drive_file_id: id, ...fields(p) }));
    for (const part of chunks(inserts)) {
      const { error } = await db.from("receipt_files").upsert(part, { onConflict: "drive_file_id", ignoreDuplicates: true });
      if (error) throw filesError(error.message);
    }
    // ชื่อ / ที่อยู่ / ชื่อที่อ่านได้เปลี่ยน (id เดิม): อ่านใหม่ · ระบบจับคู่ไว้และชื่อคน / บทบาทเปลี่ยน = จับใหม่ (ที่ Owner เลือกไว้คงเดิม)
    let renamed = 0;
    for (const r of existing) {
      const p = seen.get(r.drive_file_id);
      if (!p || (p.fileName === r.file_name && p.path === r.path && p.month === r.month && p.role === r.role && p.key === r.name_key)) continue;
      const rematch = (p.key !== r.name_key || p.role !== r.role) && r.matched_by === "auto";
      const { error } = await db.from("receipt_files").update({
        ...fields(p), updated_at: now, ...(rematch ? { staff_id: null, matched_by: null } : {}),
      }).eq("id", r.id);
      if (error) throw filesError(error.message);
      renamed++;
    }
    // ไฟล์ที่ถูกลบ / ย้ายออก = ลบแถว (pay_receipts ที่มาจากไฟล์นี้ถูกจัดการตอน sync)
    const gone = existing.filter((r) => !seen.has(r.drive_file_id)).map((r) => r.id);
    for (const part of chunks(gone)) {
      const { error } = await db.from("receipt_files").delete().in("id", part);
      if (error) throw filesError(error.message);
    }

    // 3. จับคู่ + นับเป็นส่งแล้ว
    const all = await allRows<FileRow>((a, b) => db.from("receipt_files").select("*").order("id").range(a, b));
    if (all.error) throw filesError(all.error);
    const staff = await loadStaff(db);
    const matched = await autoMatch(db, all.rows, staff);
    const synced = await syncDriveReceipts(db);
    const left = await db.from("receipt_files").select("id", { count: "exact", head: true }).is("staff_id", null).is("matched_by", null);
    return {
      configured: true, files: seen.size, added: inserts.length, removed: gone.length, renamed, matched,
      unmatched: left.count ?? 0, synced, skipped,
    };
  }, 5_000);
  if (!run) throw new Error("กำลังตรวจไฟล์เอกสารรับเงินอยู่ ลองใหม่อีกครั้ง");
  return run;
}

/**
 * Owner จับคู่ไฟล์เดิมใน Drive กับรายชื่อ (staffId = null = ไม่ใช่คนในระบบ / ยกเลิกการจับคู่)
 *   ใช้กับทุกไฟล์ที่บทบาท + ชื่อเดียวกัน (ทุกเดือน) — ระบบจำไว้ ไฟล์ชื่อนี้ที่เจอทีหลังจับคู่เอง
 */
export async function assignReceiptFile(fileId: number, staffId: number | null, scope?: DocsScope) {
  const run = await withSyncLock("receipt-scan", async () => {
    const db = createAdminClient();
    const { data: row, error } = await db.from("receipt_files").select("id, role, name_key").eq("id", fileId).maybeSingle();
    if (error) throw filesError(error.message);
    if (!row) throw new Error("ไม่พบไฟล์นี้ (อาจถูกลบจาก Drive แล้ว) กดตรวจไฟล์ใหม่");
    // Owner (scope): ไฟล์ในโฟลเดอร์ฝั่งที่ดูได้ + คนฝั่งที่ดูได้เท่านั้น
    if (scope && !docsCan(scope, String(row.role))) throw Object.assign(new Error(NO_SIDE), { status: 403 });
    if (staffId) {
      const { data: s } = await db.from("staff").select("id, role").eq("id", staffId).in("role", ["mc", "admin"]).maybeSingle();
      if (!s) throw new Error("ไม่พบรายชื่อนี้ (ต้องเป็น Mc หรือ Admin)");
      if (scope && !docsCan(scope, String(s.role))) throw Object.assign(new Error(NO_SIDE), { status: 403 });
    }
    const { data, error: upErr } = await db.from("receipt_files")
      .update({ staff_id: staffId, matched_by: "owner", updated_at: new Date().toISOString() })
      .eq("role", row.role).eq("name_key", row.name_key).select("id");
    if (upErr) throw filesError(upErr.message);
    await syncDriveReceipts(db);
    return { changed: data?.length ?? 0 };
  }, 10_000);
  if (!run) throw new Error("กำลังตรวจไฟล์เอกสารรับเงินอยู่ ลองใหม่อีกครั้ง");
  return run;
}
