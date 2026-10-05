import "server-only";
import { Readable } from "stream";
import { google, type drive_v3 } from "googleapis";
import { googleAuth } from "@/lib/google";
import { withSyncLock } from "@/lib/lock";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * สำเนารูปหลักฐานไลฟ์ไว้ใน Google Drive ของบัญชีระบบ (ใช้ทำเบิก)
 *   GLORY VITAL หลักฐานไลฟ์ > 2026 > 10 ตุลาคม > Mc กานต์ > 2026-10-01_GLORY MALL_19.30-21.30.jpg
 * รูปเดียวที่คลุมหลาย Mc = อัปไว้ในโฟลเดอร์ของแต่ละคน (คนละไฟล์) ลิงก์เก็บราย slot ใน live_proof_slots.drive_url
 * สิทธิ์ drive.file: ระบบเห็นเฉพาะไฟล์/โฟลเดอร์ที่ตัวเองสร้าง
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
    if (!todo.length) return { done, failed, remaining: 0, folderId: null as string | null };

    const drive = driveClient();
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
          .update({ drive_file_id: res.data.id, drive_url: res.data.webViewLink, drive_error: null })
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
