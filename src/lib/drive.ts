import "server-only";
import { Readable } from "stream";
import { google, type drive_v3 } from "googleapis";
import { googleAuth } from "@/lib/google";
import { withSyncLock } from "@/lib/lock";
import { matchDocsFolder, payInfoText } from "@/lib/pay-docs";
import { DRIVE_LINK_SQL, PAY_DOCS_BUCKET, type CrewRow, type PayDocsRow } from "@/lib/pay-docs-db";
import type { DocsFolder } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * สำเนารูปหลักฐานไลฟ์ไว้ใน Google Drive ของบัญชีระบบ (ใช้ทำเบิก)
 *   GLORY VITAL หลักฐานไลฟ์ > 2026 > 10 ตุลาคม > Mc กานต์ > 2026-10-01_GLORY MALL_19.30-21.30.jpg
 * รูปเดียวที่คลุมหลาย Mc = อัปไว้ในโฟลเดอร์ของแต่ละคน (คนละไฟล์) ลิงก์เก็บราย slot ใน live_proof_slots.drive_url
 * โฟลเดอร์ของ Mc เดือนนั้นเก็บใน drive_folder_id (ใช้ลิงก์ในแถวรวมของใบสรุปค่าจ้าง)
 * + เอกสารทำเบิก (บัตรประชาชน / สมุดบัญชี / ข้อมูล) ลงโฟลเดอร์ที่ Owner ตั้งใน settings (ท้ายไฟล์)
 */

type Db = ReturnType<typeof createAdminClient>;
type Drive = drive_v3.Drive;

const FOLDER = "application/vnd.google-apps.folder";
const ROOT_NAME = "GLORY VITAL หลักฐานไลฟ์";
const BUCKET = "live-proofs";
const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function driveClient(): Drive {
  const auth = googleAuth();
  if (!auth) throw new Error("ยังไม่ได้เชื่อมบัญชี Google");
  return google.drive({ version: "v3", auth });
}

/** ข้อความ error ของ Google ให้อ่านง่าย (ยังไม่ได้ให้สิทธิ์ Drive = ต้องรัน bun run google:auth ใหม่) */
function driveError(err: unknown) {
  const msg = (err as Error)?.message ?? String(err);
  if (/insufficient|scope|permission/i.test(msg)) return "บัญชีระบบยังไม่ได้ให้สิทธิ์ Google Drive (ต้องเชื่อมบัญชีใหม่)";
  if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) return "ยังไม่ได้เปิด Google Drive API ใน Google Cloud";
  return msg.slice(0, 300);
}

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** หาโฟลเดอร์ชื่อนี้ใต้ parent (ไม่มี = สร้าง) */
async function folder(drive: Drive, name: string, parent: string, cache: Map<string, string>) {
  const key = `${parent}/${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { data } = await drive.files.list({
    q: `mimeType='${FOLDER}' and name=${quote(name)} and ${quote(parent)} in parents and trashed=false`,
    fields: "files(id)", pageSize: 1, spaces: "drive",
  });
  const id = data.files?.[0]?.id
    ?? (await drive.files.create({ requestBody: { name, mimeType: FOLDER, parents: [parent] }, fields: "id" })).data.id!;
  cache.set(key, id);
  return id;
}

/** โฟลเดอร์หลัก (จำ id ไว้ใน settings ถ้าถูกลบ/ทิ้งถังขยะ สร้างใหม่) */
async function rootFolder(drive: Drive, db: Db) {
  const { data: s } = await db.from("settings").select("proof_drive_folder_id").eq("id", 1).single();
  const saved = s?.proof_drive_folder_id as string | null | undefined;
  if (saved) {
    const ok = await drive.files.get({ fileId: saved, fields: "id, trashed" }).then((r) => !r.data.trashed).catch(() => false);
    if (ok) return saved;
  }
  const id = (await drive.files.create({ requestBody: { name: ROOT_NAME, mimeType: FOLDER }, fields: "id" })).data.id!;
  await db.from("settings").update({ proof_drive_folder_id: id }).eq("id", 1);
  return id;
}

export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

type LinkRow = {
  mc_slot_id: number;
  proof: { id: number; platform: string; live_date: string; image_path: string } | null;
  slot: { live_date: string; start_time: string; end_time: string; person: { name: string } | null } | null;
};

/**
 * อัปรูปหลักฐานที่ยังไม่มีใน Drive (ทีละไม่เกิน limit กลุ่ม) คืนจำนวนที่ทำได้ / พลาด / ที่ยังเหลือ
 * proofIds = เฉพาะหลักฐานเหล่านี้ (เช่น หลังแนบรูปใหม่) / ไม่ระบุ = ทุกอันที่ค้าง
 */
export async function syncProofsToDrive(opts: { proofIds?: number[]; limit?: number } = {}) {
  const run = await withSyncLock("drive", async () => {
    const db = createAdminClient();
    let q = db.from("live_proof_slots")
      .select("mc_slot_id, proof:live_proofs(id, platform, live_date, image_path), slot:mc_slots(live_date, start_time, end_time, person:staff!mc_id(name))")
      .is("drive_file_id", null)
      .limit(500);
    if (opts.proofIds?.length) q = q.in("proof_id", opts.proofIds);
    const { data, error } = await q;
    if (error) throw error;

    // 1 ไฟล์ต่อ (หลักฐาน x Mc)
    const groups = new Map<string, LinkRow[]>();
    for (const r of (data ?? []) as unknown as LinkRow[]) {
      if (!r.proof || !r.slot) continue;
      const k = `${r.proof.id}|${r.slot.person?.name ?? ""}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const todo = [...groups.values()].slice(0, opts.limit ?? 20);
    let done = 0, failed = 0;

    // ไฟล์ที่อัปไว้ก่อนมีช่อง drive_folder_id: ถาม Drive ว่าอยู่โฟลเดอร์ไหน แล้วจดไว้
    const { data: noFolder } = await db.from("live_proof_slots")
      .select("drive_file_id").not("drive_file_id", "is", null).is("drive_folder_id", null).limit(200);
    const fileIds = [...new Set((noFolder ?? []).map((x) => String(x.drive_file_id)))];
    if (!todo.length && !fileIds.length) return { done, failed, remaining: 0, folderId: null as string | null };

    const drive = driveClient();
    for (const fileId of fileIds) {
      const parent = await drive.files.get({ fileId, fields: "parents" }).then((r) => r.data.parents?.[0]).catch(() => undefined);
      if (parent) await db.from("live_proof_slots").update({ drive_folder_id: parent }).eq("drive_file_id", fileId);
    }
    if (!todo.length) return { done, failed, remaining: 0, folderId: null as string | null };

    const root = await rootFolder(drive, db);
    const cache = new Map<string, string>();
    const images = new Map<number, Buffer>();

    for (const rows of todo) {
      const p = rows[0].proof!;
      const mc = rows[0].slot!.person?.name;
      const ids = rows.map((r) => r.mc_slot_id);
      try {
        const [y, m] = p.live_date.split("-");
        const year = await folder(drive, y, root, cache);
        const month = await folder(drive, `${m} ${MONTHS[Number(m) - 1]}`, year, cache);
        const person = await folder(drive, mc ? `Mc ${mc}` : "ไม่มีชื่อ Mc", month, cache);

        let image = images.get(p.id);
        if (!image) {
          const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(p.image_path);
          if (dlErr || !blob) throw new Error("โหลดรูปจากที่เก็บไม่สำเร็จ: " + (dlErr?.message ?? ""));
          image = Buffer.from(await blob.arrayBuffer());
          images.set(p.id, image);
        }
        const times = rows
          .map((r) => `${r.slot!.start_time.slice(0, 5)}-${r.slot!.end_time.slice(0, 5)}`.replace(/:/g, "."))
          .sort().join("+");
        const ext = p.image_path.split(".").pop() || "jpg";
        const name = `${rows[0].slot!.live_date}_${p.platform}_${times}${mc ? `_Mc ${mc}` : ""}.${ext}`;
        const res = await drive.files.create({
          requestBody: { name, parents: [person] },
          media: { mimeType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", body: Readable.from(image) },
          fields: "id, webViewLink",
        });
        await db.from("live_proof_slots")
          .update({ drive_file_id: res.data.id, drive_url: res.data.webViewLink, drive_folder_id: person, drive_error: null })
          .in("mc_slot_id", ids).eq("proof_id", p.id);
        done++;
      } catch (err) {
        failed++;
        await db.from("live_proof_slots").update({ drive_error: driveError(err) }).in("mc_slot_id", ids).eq("proof_id", p.id);
      }
    }
    return { done, failed, remaining: groups.size - todo.length, folderId: root };
  }, 5_000);
  return run ?? { done: 0, failed: 0, remaining: -1, folderId: null, busy: true as const };
}

/** ย้ายไฟล์ใน Drive ที่ไม่มี slot ไหนใช้แล้วไปถังขยะ (หลังลบ / แทนที่หลักฐาน) */
export async function trashUnusedDriveFiles(fileIds: (string | null | undefined)[]) {
  const ids = [...new Set(fileIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const db = createAdminClient();
  const { data } = await db.from("live_proof_slots").select("drive_file_id").in("drive_file_id", ids);
  const used = new Set((data ?? []).map((x) => String(x.drive_file_id)));
  let drive: Drive;
  try { drive = driveClient(); } catch { return; }
  for (const id of ids.filter((x) => !used.has(x))) {
    await drive.files.update({ fileId: id, requestBody: { trashed: true } }).catch(() => undefined);
  }
}

// ---------- เอกสารทำเบิก ----------

const PAY_FOLDER_COL = { mc: "pay_docs_drive_mc", admin: "pay_docs_drive_admin" } as const;
const mimeOf = (ext: string) =>
  ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
const fmtStamp = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

/**
 * สำเนาเอกสารทำเบิกของอีเมลนี้ขึ้น Google Drive แทนชุดเดิม (ชุดเดิมทิ้งถังขยะ)
 *   โฟลเดอร์ Mc (settings.pay_docs_drive_mc) > Mc กานต์ > บัตรประชาชน.jpg / สมุดบัญชี.jpg / ข้อมูลทำเบิก.txt
 *   เป็นทั้ง Mc และ Admin = ลงทั้งสองโฟลเดอร์ · โฟลเดอร์ของ Owner ต้องแชร์ให้บัญชีระบบแก้ไขได้ (สิทธิ์ Drive เต็ม)
 */
export async function syncPayDocsToDrive(email: string): Promise<{ ok: boolean; error: string | null }> {
  const run = await withSyncLock(`pay-docs:${email}`, async () => {
    const db = createAdminClient();
    const [docRes, settingsRes, peopleRes] = await Promise.all([
      db.from("pay_docs").select("*").eq("email", email).maybeSingle(),
      db.from("settings").select("pay_docs_drive_mc, pay_docs_drive_admin").eq("id", 1).single(),
      db.from("staff").select("*").eq("email", email).in("role", ["mc", "admin"]).order("role", { ascending: false }),
    ]);
    const doc = docRes.data as PayDocsRow | null;
    if (!doc) return { ok: false, error: "ยังไม่มีเอกสาร" };
    const save = (patch: Partial<PayDocsRow>) => db.from("pay_docs").update(patch).eq("email", email);
    const settings = (settingsRes.data ?? {}) as Partial<Record<(typeof PAY_FOLDER_COL)[keyof typeof PAY_FOLDER_COL], string | null>>;
    // โฟลเดอร์เอกสารเดิมที่ผูกไว้ = ลงโฟลเดอร์นั้น / ไม่มี = หา (หรือสร้าง) โฟลเดอร์ "Mc ชื่อ" ในโฟลเดอร์ของฝั่งนั้น
    const targets = ((peopleRes.data ?? []) as (CrewRow & { phone: string | null })[]).flatMap((p) => {
      const parent = settings[PAY_FOLDER_COL[p.role]]?.trim();
      return parent
        ? [{ role: p.role, parent, linked: p.pay_docs_drive_folder || null, name: p.role === "mc" ? `Mc ${p.name}` : p.name, phone: p.phone }]
        : [];
    });
    if (!targets.length) {
      const error = "ยังไม่ได้ตั้งโฟลเดอร์ Google Drive ของเอกสารทำเบิก";
      await save({ drive_error: error });
      return { ok: false, error };
    }

    let fileIds = [...(doc.drive_file_ids ?? [])];
    try {
      const drive = driveClient();
      for (const id of fileIds) await drive.files.update({ fileId: id, requestBody: { trashed: true } }).catch(() => undefined);
      fileIds = [];
      const files = await Promise.all(([["บัตรประชาชน", doc.id_card_path], ["สมุดบัญชี", doc.bank_book_path]] as const).map(async ([label, path]) => {
        const { data: blob, error } = await db.storage.from(PAY_DOCS_BUCKET).download(path);
        if (error || !blob) throw new Error("โหลดไฟล์จากที่เก็บไม่สำเร็จ: " + (error?.message ?? ""));
        const ext = path.split(".").pop() || "jpg";
        return { name: `${label}.${ext}`, mime: mimeOf(ext), data: Buffer.from(await blob.arrayBuffer()) };
      }));
      const info = {
        fullName: doc.full_name, idCardNo: doc.id_card_no, address: doc.address, bank: doc.bank, accountNo: doc.account_no, accountName: doc.account_name,
      };
      const folders: PayDocsRow["drive_folders"] = {};
      const cache = new Map<string, string>();
      for (const t of targets) {
        const person = t.linked ?? await folder(drive, t.name, t.parent, cache);
        folders[t.role] = person;
        const text = payInfoText(info, { name: t.name, email, phone: t.phone }, fmtStamp.format(new Date(doc.updated_at)));
        for (const f of [...files, { name: "ข้อมูลทำเบิก.txt", mime: "text/plain", data: Buffer.from(text, "utf8") }]) {
          const res = await drive.files.create({
            requestBody: { name: f.name, parents: [person] },
            media: { mimeType: f.mime, body: Readable.from(f.data) },
            fields: "id",
          });
          fileIds.push(res.data.id!);
        }
      }
      await save({ drive_file_ids: fileIds, drive_folders: folders, drive_error: null, drive_synced_at: new Date().toISOString() });
      return { ok: true, error: null };
    } catch (err) {
      // โฟลเดอร์ที่ Owner สร้างเอง: ยังไม่ได้แชร์ให้บัญชีระบบ หรือบัญชีระบบยังมีสิทธิ์ Drive แค่ไฟล์ที่ตัวเองสร้าง
      const error = /file not found/i.test((err as Error)?.message ?? "")
        ? "บัญชีระบบเข้าโฟลเดอร์ Drive ของเอกสารทำเบิกไม่ได้ (แชร์โฟลเดอร์ให้บัญชีระบบเป็นผู้แก้ไข และเชื่อมบัญชี Google ใหม่ด้วยสิทธิ์ Drive เต็ม)"
        : driveError(err);
      await save({ drive_file_ids: fileIds, drive_error: error });
      return { ok: false, error };
    }
  }, 10_000);
  return run ?? { ok: false, error: "กำลังส่งขึ้น Drive อยู่ ลองใหม่อีกครั้ง" };
}

/** โฟลเดอร์ Drive ของเอกสารทำเบิกฝั่งนี้ (settings) ไม่ได้ตั้ง = null */
export async function payDocsParent(role: "mc" | "admin") {
  const { data } = await createAdminClient().from("settings").select("pay_docs_drive_mc, pay_docs_drive_admin").eq("id", 1).single();
  return (data?.[PAY_FOLDER_COL[role]] as string | null | undefined)?.trim() || null;
}

/** โฟลเดอร์รายคน (โฟลเดอร์ย่อย) ในโฟลเดอร์เอกสารทำเบิก */
async function personFolders(drive: Drive, parent: string) {
  const out: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q: `mimeType='${FOLDER}' and ${quote(parent)} in parents and trashed=false`,
      fields: "nextPageToken, files(id, name)", pageSize: 200, pageToken, orderBy: "name",
    });
    out.push(...(data.files ?? []).map((f) => ({ id: f.id!, name: f.name!.trim() })));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/** ตัวเลือกให้ Owner ผูกโฟลเดอร์เอง (ฝั่งของรายชื่อนั้น) + ใครผูกโฟลเดอร์ไหนอยู่ */
export async function docsFolderOptions(role: "mc" | "admin"): Promise<DocsFolder[]> {
  const parent = await payDocsParent(role);
  if (!parent) return [];
  const db = createAdminClient();
  const [folders, staff] = await Promise.all([
    personFolders(driveClient(), parent),
    db.from("staff").select("*").eq("role", role),
  ]);
  const usedBy = new Map(((staff.data ?? []) as CrewRow[]).filter((s) => s.pay_docs_drive_folder)
    .map((s) => [s.pay_docs_drive_folder!, s.role === "mc" ? `Mc ${s.name}` : s.name]));
  return folders.map((f) => ({ ...f, url: driveFolderUrl(f.id), usedBy: usedBy.get(f.id) ?? null }));
}

/** โฟลเดอร์นี้อยู่ในโฟลเดอร์เอกสารทำเบิกของฝั่งนี้จริงไหม (ก่อน Owner ผูกเอง) คืนชื่อโฟลเดอร์ */
export async function docsFolderName(role: "mc" | "admin", folderId: string) {
  const parent = await payDocsParent(role);
  if (!parent) return null;
  const { data } = await driveClient().files.get({ fileId: folderId, fields: "name, parents, mimeType, trashed" }).catch(() => ({ data: null }));
  return data && !data.trashed && data.mimeType === FOLDER && data.parents?.includes(parent) ? data.name ?? "" : null;
}

/**
 * จับคู่รายชื่อ Mc / Admin (ที่มีอีเมลและยังไม่ได้ผูก) กับโฟลเดอร์เอกสารเดิมใน Drive ตามชื่อ ("Mc มะนาว" = มะนาว)
 *   ผูกแล้ว = มีเอกสาร ไม่ขึ้นป้ายเตือน · ไม่ทับที่ Owner ผูกเอง · Mc จับคู่ในโฟลเดอร์ Mc / Admin ในโฟลเดอร์ Admin
 */
export async function matchPayDocsFolders() {
  const db = createAdminClient();
  const { data, error } = await db.from("staff").select("*").in("role", ["mc", "admin"]).not("email", "is", null);
  if (error) throw error;
  const rows = (data ?? []) as CrewRow[];
  if (rows.length && !("pay_docs_drive_folder" in rows[0])) throw new Error(DRIVE_LINK_SQL);
  const drive = driveClient();
  const label = (p: CrewRow) => (p.role === "mc" ? `Mc ${p.name}` : p.name);
  const linked: string[] = [], missing: CrewRow[] = [];
  const hasFolder = new Set(rows.filter((x) => x.pay_docs_drive_folder).map((x) => x.email));
  for (const role of ["mc", "admin"] as const) {
    const parent = await payDocsParent(role);
    if (!parent) continue;
    const folders = await personFolders(drive, parent);
    for (const p of rows.filter((x) => x.role === role && !x.pay_docs_drive_folder)) {
      const hit = matchDocsFolder(p.name, folders);
      if (!hit) { missing.push(p); continue; }
      const { error: upErr } = await db.from("staff").update({ pay_docs_drive_folder: hit.id }).eq("id", p.id);
      if (upErr) throw upErr;
      linked.push(label(p));
      hasFolder.add(p.email);
    }
  }
  // ไม่เจอ (ไม่นับพนักงานประจำ และคนที่มีโฟลเดอร์อีกฝั่งแล้ว — เอกสารเป็นของคน ไม่ใช่ของบทบาท)
  const unmatched = missing.filter((p) => !p.is_salaried && !hasFolder.has(p.email)).map(label);
  return { linked, unmatched };
}

/** เก็บตกเอกสารที่ยังไม่ขึ้น Drive (cron) */
export async function syncPendingPayDocs(limit = 5) {
  const { data, error } = await createAdminClient().from("pay_docs").select("email").is("drive_synced_at", null).limit(limit);
  if (error) return { done: 0, failed: 0, error: error.message };
  let done = 0, failed = 0;
  for (const d of data ?? []) {
    if ((await syncPayDocsToDrive(String(d.email))).ok) done++;
    else failed++;
  }
  return { done, failed };
}

/** สถานะ: ค้างกี่ slot / พลาดเพราะอะไร / โฟลเดอร์หลัก */
export async function driveStatus() {
  const db = createAdminClient();
  const [{ count }, { data: errs }, { data: s }] = await Promise.all([
    db.from("live_proof_slots").select("mc_slot_id", { count: "exact", head: true }).is("drive_file_id", null),
    db.from("live_proof_slots").select("drive_error").is("drive_file_id", null).not("drive_error", "is", null).limit(1),
    db.from("settings").select("proof_drive_folder_id").eq("id", 1).single(),
  ]);
  const folderId = (s?.proof_drive_folder_id as string | null) ?? null;
  return {
    pending: count ?? 0,
    error: (errs?.[0]?.drive_error as string | undefined) ?? null,
    folderUrl: folderId ? driveFolderUrl(folderId) : null,
  };
}
