import "server-only";
import { Readable } from "stream";
import { gzipSync } from "zlib";
import { driveClient, driveFolderUrl, folder } from "@/lib/drive";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * สำรองข้อมูลลง Google Drive ของบัญชีระบบ (cron ทุกวันจันทร์ ~04:00 เวลาไทย + ปุ่ม "สำรองตอนนี้" ในหน้าแรก)
 *   ไฟล์เดียว: GLORY VITAL สำรองข้อมูล / glory-vital-backup-YYYY-MM-DD-HHmm.json.gz = ทุกตารางที่เป็นข้อมูลจริง (JSON บีบอัด)
 *   ไม่รวมงานชั่วคราว (sheet_jobs / calendar_jobs / sync_locks) และไฟล์รูป (หลักฐานไลฟ์อยู่ใน Drive แล้ว / เอกสารทำเบิกมีสำเนาใน Drive)
 *   เก็บไว้ KEEP ไฟล์ล่าสุด ที่เก่ากว่าทิ้งถังขยะ
 */

const FOLDER_NAME = "GLORY VITAL สำรองข้อมูล";
const PREFIX = "glory-vital-backup-";
const KEEP = 12;
/** ตาราง -> คอลัมน์ที่ใช้เรียงตอนอ่านทีละ 1000 แถว */
const TABLES: Record<string, string> = {
  staff: "id", settings: "id", mc_slots: "id", admin_slots: "id", agency_slots: "id", booking_logs: "id",
  live_proofs: "id", live_proof_slots: "mc_slot_id", live_sessions: "id", live_campaigns: "id", ceo_sessions: "id",
  pay_docs: "email", pay_periods: "id",
};

async function readTable(name: string, order: string) {
  const db = createAdminClient();
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(name).select("*").order(order).range(from, from + 999);
    if (error) throw new Error(`${name}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function backupFolder() {
  return folder(driveClient(), FOLDER_NAME, "root", new Map());
}

/** ไฟล์สำรองในโฟลเดอร์ (ใหม่ก่อน) */
async function listBackups(parent: string) {
  const { data } = await driveClient().files.list({
    q: `'${parent}' in parents and name contains '${PREFIX}' and trashed=false`,
    fields: "files(id, name, createdTime, size, webViewLink)", orderBy: "createdTime desc", pageSize: 100,
  });
  return data.files ?? [];
}

/** สำรองข้อมูลตอนนี้ คืนชื่อไฟล์ / ขนาด / จำนวนแถวต่อตาราง / ตารางที่อ่านไม่ได้ */
export async function backupToDrive() {
  const tables: Record<string, unknown[]> = {};
  const skipped: string[] = [];
  for (const [name, order] of Object.entries(TABLES)) {
    try {
      tables[name] = await readTable(name, order);
    } catch (err) {
      // ยังไม่ได้รัน SQL ของตารางนั้น = ข้าม (ไฟล์ยังใช้ได้)
      skipped.push(String((err as Error).message).slice(0, 120));
    }
  }
  const createdAt = new Date().toISOString();
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  const body = gzipSync(Buffer.from(JSON.stringify({ app: "GLORY VITAL Live", createdAt, counts, tables }), "utf8"));
  const stamp = new Date(Date.parse(createdAt) + 7 * 3600_000).toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const name = `${PREFIX}${stamp}.json.gz`;

  const drive = driveClient();
  const parent = await backupFolder();
  const res = await drive.files.create({
    requestBody: { name, parents: [parent], description: `สำรองข้อมูล GLORY VITAL Live ${Object.values(counts).reduce((a, b) => a + b, 0)} แถว` },
    media: { mimeType: "application/gzip", body: Readable.from(body) },
    fields: "id, webViewLink",
  });
  // เก็บไว้ KEEP ไฟล์ล่าสุด
  const old = (await listBackups(parent)).slice(KEEP);
  for (const f of old) await drive.files.update({ fileId: f.id!, requestBody: { trashed: true } }).catch(() => undefined);
  return { name, url: res.data.webViewLink ?? null, sizeKB: Math.round(body.length / 1024), counts, skipped, trashed: old.length };
}

/** ไฟล์สำรองล่าสุด (หน้าแรก) */
export async function backupStatus() {
  const parent = await backupFolder();
  const files = (await listBackups(parent)).slice(0, 3).map((f) => ({
    name: f.name!, at: f.createdTime!, sizeKB: Math.round(Number(f.size ?? 0) / 1024), url: f.webViewLink ?? null,
  }));
  return { folderUrl: driveFolderUrl(parent), files };
}
