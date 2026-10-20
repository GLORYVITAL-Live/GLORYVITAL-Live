import "server-only";
import { Readable } from "stream";
import { driveClient, driveError, folder } from "@/lib/drive";
import { withSyncLock } from "@/lib/lock";
import { notify } from "@/lib/notifications";
import {
  cleanRequiredFrom, receiptFileName, receiptFolders, receiptMonthOk, receiptRole, receiptState,
} from "@/lib/receipts";
import { createAdminClient } from "@/lib/supabase/server";
import { tawiMonthLabel } from "@/lib/tawi-name";
import type { OwnerReceiptPerson, OwnerReceipts, ReceiptState, ReceiptView } from "@/lib/types";

/**
 * เอกสารยืนยันการรับเงินรายเดือน (ตาราง pay_receipts) — SQL 20261101000000_pay_receipts
 *   ไฟล์เก็บใน Google Drive: settings.receipt_drive_folder > 2026 > 10 October > Mc / Admin > "Mc ชื่อ - 2026-10.pdf"
 *   "คน" = อีเมล (1 อีเมล 1 ไฟล์ต่อเดือน — ส่งใหม่ = แทนไฟล์เดิม ไฟล์เดิมลงถังขยะ)
 *   บังคับเมื่อ: รัน SQL แล้ว + ตั้งโฟลเดอร์แล้ว + ตั้งเดือนเริ่ม (settings.receipt_required_from) — ขาดข้อใด = ไม่บังคับ (ดาวน์โหลดได้ตามเดิม)
 */

type Db = ReturnType<typeof createAdminClient>;

export const RECEIPT_SQL = "ต้องรัน SQL 20261101000000_pay_receipts ใน Supabase ก่อน";
const noSql = (msg: string) => /pay_receipts|receipt_|schema cache|does not exist/i.test(msg);
const dbError = (msg: string) => new Error(noSql(msg) ? RECEIPT_SQL : msg);
/** error ที่มาจาก Google Drive (ตอบ 502 — ให้ระบบแจ้งทีมงาน) */
const driveFail = (msg: string) => Object.assign(new Error(msg), { status: 502 });

export type ReceiptRow = {
  id: number; email: string; staff_id: number | null; month: string; drive_file_id: string; file_name: string; mime: string; size: number;
  status: "ok" | "rejected"; reject_reason: string | null; reviewed_by: string | null; reviewed_at: string | null;
  uploaded_at: string; updated_at: string;
};
const COLS = "id, email, staff_id, month, drive_file_id, file_name, mime, size, status, reject_reason, reviewed_by, reviewed_at, uploaded_at, updated_at";
const PAGE = 1000;
const norm = (email: string) => email.trim().toLowerCase();
type StaffLite = { id: number; role: "mc" | "admin"; name: string; email: string | null };
const label = (s: Pick<StaffLite, "role" | "name">) => (s.role === "mc" ? `Mc ${s.name}` : s.name);
const personOf = (s: Pick<StaffLite, "id" | "email">) => (s.email?.trim() ? `e:${norm(s.email)}` : `s:${s.id}`);

export const receiptView = (r: ReceiptRow): ReceiptView => ({
  id: Number(r.id), month: r.month, status: r.status === "rejected" ? "rejected" : "ok", reason: r.reject_reason,
  uploadedAt: r.uploaded_at, pdf: r.mime === "application/pdf",
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

/** เอกสารรับเงินของอีเมลนี้ (ใหม่ก่อน) + เดือนเริ่มบังคับ · ยังไม่ได้รัน SQL / อ่านไม่ได้ = ไม่บังคับ (ไม่ล็อกใบ 50 ทวิเพราะระบบนี้) */
export async function myReceipts(email: string): Promise<{ requiredFrom: string | null; rows: ReceiptRow[] }> {
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  if (!cfg.ready) return { requiredFrom: null, rows: [] };
  const { data, error } = await db.from("pay_receipts").select(COLS).eq("email", norm(email)).order("month", { ascending: false });
  if (error) return { requiredFrom: null, rows: [] };
  return { requiredFrom: cfg.requiredFrom, rows: (data ?? []) as ReceiptRow[] };
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
 * เจ้าตัวส่งเอกสารรับเงินของเดือนนี้ (ไฟล์ผ่านการตรวจชนิด / ขนาดแล้ว) -> อัปขึ้น Drive -> บันทึก (สถานะ ok ดาวน์โหลดได้ทันที)
 *   ลงโฟลเดอร์ Mc / Admin ตามบทบาทที่ใบ 50 ทวิเดือนนั้นจับคู่ไว้ (ไม่ชัด = Mc) · ส่งซ้ำ = ไฟล์เดิม + ไฟล์ชื่อเดียวกันในโฟลเดอร์ลงถังขยะ
 */
export async function saveReceipt(email: string, month: string, bytes: Uint8Array, mime: string) {
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  if (!cfg.ready) throw new Error(RECEIPT_SQL);
  if (!cfg.folder) throw new Error("ยังไม่เปิดรับเอกสารรับเงิน (ทีมงานยังไม่ได้ตั้งโฟลเดอร์ Google Drive) ลองใหม่ภายหลัง");
  const key = norm(email);
  const { data: staffData, error: staffErr } = await db.from("staff").select("id, role, name, email").eq("email", key).in("role", ["mc", "admin"]).order("id");
  if (staffErr) throw new Error(staffErr.message);
  const staff = (staffData ?? []) as StaffLite[];
  if (!staff.length) throw new Error("ไม่พบรายชื่อ Mc / Admin ของบัญชีนี้");
  // ใบ 50 ทวิของคนนี้ (ยังไม่ได้รัน SQL ใบ 50 ทวิ = ไม่มี)
  const { data: tawiData } = await db.from("tawi_docs").select("month, staff_id").in("staff_id", staff.map((s) => s.id));
  const tawi = (tawiData ?? []) as { month: string; staff_id: number }[];
  if (!receiptMonthOk(month, tawi.map((t) => t.month))) throw new Error("ส่งเอกสารของเดือนนี้ไม่ได้ (เลือกเดือนที่มีใบ 50 ทวิ หรือเดือนที่ผ่านมาแล้ว)");
  const byId = new Map(staff.map((s) => [s.id, s]));
  const role = receiptRole(staff.map((s) => s.role), tawi.filter((t) => t.month === month).map((t) => byId.get(t.staff_id)?.role).filter((r) => !!r) as ("mc" | "admin")[]);
  const person = staff.find((s) => s.role === role) ?? staff[0];
  const name = receiptFileName(label(person), month, mime);

  const run = await withSyncLock(`receipt:${key}`, async () => {
    const { data: cur, error } = await db.from("pay_receipts").select(COLS).eq("email", key).eq("month", month).maybeSingle();
    if (error) throw dbError(error.message);
    const drive = driveClient();
    let fileId: string, same: string[];
    try {
      const f = receiptFolders(month);
      const cache = new Map<string, string>();
      const year = await folder(drive, f.year, cfg.folder!, cache);
      const mon = await folder(drive, f.month, year, cache);
      const side = await folder(drive, role === "mc" ? "Mc" : "Admin", mon, cache);
      // ไฟล์ชื่อเดียวกันที่มีอยู่แล้ว (ส่งซ้ำ / ทีมงานอัปไว้เอง) = ของคนนี้เดือนนี้ ลงถังขยะหลังบันทึกไฟล์ใหม่สำเร็จ
      const { data: dup } = await drive.files.list({
        q: `name=${quote(name)} and ${quote(side)} in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: "files(id)", pageSize: 20,
      });
      same = (dup.files ?? []).map((x) => x.id!).filter(Boolean);
      const res = await drive.files.create({
        requestBody: { name, parents: [side] },
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
    }, { onConflict: "email,month" }).select(COLS).single();
    if (saveErr || !saved) {
      await drive.files.update({ fileId, requestBody: { trashed: true } }).catch(() => undefined);
      throw dbError(saveErr?.message ?? "บันทึกไม่สำเร็จ");
    }
    // ไฟล์เดิม (ย้ายลงถังขยะ กู้คืนได้ 30 วัน) — พลาดไม่เป็นไร
    const old = [...new Set([(cur as ReceiptRow | null)?.drive_file_id, ...same])].filter((x): x is string => !!x && x !== fileId);
    for (const id of old) await drive.files.update({ fileId: id, requestBody: { trashed: true } }).catch(() => undefined);
    return { row: saved as ReceiptRow, replaced: !!cur, label: label(person) };
  }, 10_000);
  if (!run) throw new Error("กำลังส่งไฟล์ของเดือนนี้อยู่ ลองใหม่อีกครั้ง");
  return run;
}

/** แถวตาม id (ไฟล์ให้เปิด: ตรวจสิทธิ์แล้วค่อยส่งไฟล์) */
export async function receiptById(id: number) {
  const { data, error } = await createAdminClient().from("pay_receipts").select(COLS).eq("id", id).maybeSingle();
  if (error) throw dbError(error.message);
  return (data as ReceiptRow | null) ?? null;
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

/**
 * หน้า Owner: สรุปต่อเดือน (ต้องส่ง = คนที่มีใบ 50 ทวิเดือนนั้น ตั้งแต่เดือนเริ่มบังคับ) + รายชื่อของเดือนที่เลือก
 *   requiredFrom = เดือนเริ่มที่ตั้งไว้ (ยังไม่ได้ตั้งโฟลเดอร์ = หน้าเว็บบอกว่ายังไม่บังคับ)
 */
export async function ownerReceipts(month: string | null): Promise<OwnerReceipts> {
  const db = createAdminClient();
  const cfg = await loadConfig(db);
  const off: OwnerReceipts = { ready: false, folderSet: false, requiredFrom: null, month: null, months: [], people: [] };
  if (!cfg.ready) return off;
  const from = cfg.from;
  const [receipts, staffRes, tawi] = await Promise.all([
    allRows<ReceiptRow>((a, b) => db.from("pay_receipts").select(COLS).order("id").range(a, b)),
    db.from("staff").select("id, role, name, email").in("role", ["mc", "admin"]).order("id"),
    from
      ? allRows<{ month: string; staff_id: number }>((a, b) => db.from("tawi_docs").select("month, staff_id")
        .not("staff_id", "is", null).gte("month", from).order("id").range(a, b))
      : Promise.resolve({ rows: [] as { month: string; staff_id: number }[], error: null }),
  ]);
  if (receipts.error) {
    if (noSql(receipts.error)) return off;
    throw new Error(receipts.error);
  }
  if (staffRes.error) throw new Error(staffRes.error.message);
  const staff = (staffRes.data ?? []) as StaffLite[];
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
  const allMonths = [...new Set([...required.keys(), ...sentBy.keys()])].sort((a, b) => b.localeCompare(a));
  const months = allMonths.map((m) => {
    const req = required.get(m) ?? new Map(), sent = sentBy.get(m) ?? new Map<string, ReceiptRow>();
    return {
      month: m, required: req.size,
      sent: [...req.keys()].filter((k) => sent.get(k)?.status === "ok").length,
      rejected: [...sent.values()].filter((r) => r.status === "rejected").length,
    };
  });
  const pick = month && allMonths.includes(month) ? month : allMonths[0] ?? null;

  const people: OwnerReceiptPerson[] = [];
  if (pick) {
    const req = required.get(pick) ?? new Map<string, StaffLite>(), sent = sentBy.get(pick) ?? new Map<string, ReceiptRow>();
    for (const k of new Set([...req.keys(), ...sent.keys()])) {
      const s = req.get(k) ?? nameOf.get(k);
      const r = sent.get(k);
      people.push({
        key: k, label: s ? label(s) : r?.email ?? k, hasEmail: k.startsWith("e:"), required: req.has(k),
        receipt: r ? { ...receiptView(r), reviewedAt: r.reviewed_at } : null,
      });
    }
    const rank = (p: OwnerReceiptPerson) => (!p.receipt ? 0 : p.receipt.status === "rejected" ? 1 : 2);
    people.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "th"));
  }
  return { ready: true, folderSet: !!cfg.folder, requiredFrom: from, month: pick, months, people };
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
