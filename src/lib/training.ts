import "server-only";
import { driveClient, driveError } from "@/lib/drive";
import { createAdminClient } from "@/lib/supabase/server";
import type { Training, TrainingGroup, TrainingVideo } from "@/lib/types";

/**
 * หน้าเทรนนิ่ง — SQL 20261103000000_training + 20261104000000_training_items
 *   วิดีโอ: settings.training_drive_folder > โฟลเดอร์ย่อยรายสินค้า (ไม่เกิน 2 ชั้น) > ไฟล์วิดีโอ — กลุ่มตามโฟลเดอร์ย่อย
 *   สไลด์: settings.training_slides (id หรือลิงก์ Google Slides)
 *   Owner จัดการในเว็บ (ตาราง training_items): ซ่อน / แสดง คลิปหรือทั้งโฟลเดอร์ · แก้ชื่อที่แสดง · เพิ่มคลิปจากลิงก์ (Google Drive / YouTube)
 *   เล่น / เปิดในหน้าเว็บด้วยตัวเล่นของ Google / YouTube (ไฟล์ในไดรฟ์ต้องแชร์ "ทุกคนที่มีลิงก์ดูได้") — เว็บไม่ดึงไฟล์วิดีโอเอง
 *   รายชื่อไฟล์ในไดรฟ์จำไว้ 10 นาที (ปุ่มรีเฟรช = อ่านใหม่ทันที) · ที่ Owner ตั้งในเว็บมีผลทันที
 */

export const TRAINING_SQL = "ต้องรัน SQL 20261103000000_training ใน Supabase ก่อน";
export const TRAINING_ITEMS_SQL = "ต้องรัน SQL 20261104000000_training_items ใน Supabase ก่อน (จัดการคลิปในเว็บ)";
const FOLDER = "application/vnd.google-apps.folder";
const TTL = 10 * 60_000;

type Db = ReturnType<typeof createAdminClient>;
type DriveVideo = { id: string; name: string; minutes: number | null };
type DriveGroup = { folderId: string; name: string; videos: DriveVideo[] };
type Item = { ref: string; added: boolean; title: string | null; group_name: string | null; hidden: boolean };

let cache: { key: string; at: number; groups: DriveGroup[] } | null = null;

/** id จากลิงก์ Google (/d/<id> · folders/<id> · ?id=<id>) หรือ id ตรงๆ */
export function googleId(raw: string | null | undefined) {
  const s = (raw ?? "").trim();
  const m = s.match(/\/(?:d|folders)\/([\w-]{10,})/) ?? s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : null;
}

/** ลิงก์คลิปที่เพิ่มเอง -> ref ('drive:<id>' / 'youtube:<id>') · ไม่รู้จัก = null */
export function clipRef(raw: string) {
  const s = raw.trim();
  const yt = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  if (yt) return `youtube:${yt[1]}`;
  if (/drive\.google\.com|docs\.google\.com/.test(s) && !/\/folders\//.test(s)) {
    const id = googleId(s);
    if (id) return `drive:${id}`;
  }
  return null;
}

/** ชื่อวิดีโอ: ตัดนามสกุลไฟล์ + สระ / วรรณยุกต์ที่พิมพ์เกินหน้าชื่อ ("ีULTRA ZINC") */
const titleOf = (name: string) => name.normalize("NFC").replace(/\.(mp4|mov|m4v|webm|mkv|avi)$/i, "").replace(/^[ัิ-ฺ็-๎\s]+/, "").trim();
const byName = (a: string, b: string) => a.localeCompare(b, "th", { numeric: true });

/** อ่านรายชื่อวิดีโอในไดรฟ์ (จำไว้ 10 นาที · force = อ่านใหม่) */
async function driveGroups(folder: string, exclude: Set<string>, force: boolean): Promise<DriveGroup[]> {
  const key = `${folder}|${[...exclude].sort().join(",")}`;
  if (!force && cache && cache.key === key && Date.now() - cache.at < TTL) return cache.groups;
  const drive = driveClient();
  const list = async (parent: string) => {
    const out: { id: string; name: string; mime: string; ms: number }[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${parent}' in parents and trashed = false and (mimeType = '${FOLDER}' or mimeType contains 'video/')`,
        fields: "nextPageToken, files(id, name, mimeType, videoMediaMetadata(durationMillis))",
        pageSize: 200, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        out.push({ id: f.id!, name: f.name ?? "", mime: f.mimeType ?? "", ms: Number(f.videoMediaMetadata?.durationMillis ?? 0) });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  };
  const groups: DriveGroup[] = [];
  const walk = async (parent: string, path: string[], depth: number) => {
    const items = await list(parent);
    const videos = items.filter((f) => f.mime !== FOLDER)
      .map((f) => ({ id: f.id, name: titleOf(f.name), minutes: f.ms ? Math.max(1, Math.round(f.ms / 60_000)) : null }))
      .sort((a, b) => byName(a.name, b.name));
    if (videos.length) groups.push({ folderId: parent, name: path.join(" / ") || "ทั่วไป", videos });
    if (depth >= 2) return;
    const subs = items.filter((f) => f.mime === FOLDER && !exclude.has(f.id)).sort((a, b) => byName(a.name, b.name));
    for (const s of subs) await walk(s.id, [...path, s.name.trim()], depth + 1);
  };
  await walk(folder, [], 0);
  cache = { key, at: Date.now(), groups };
  return groups;
}

/** ที่ Owner ตั้งไว้ (ยังไม่ได้รัน SQL = null) */
async function loadItems(db: Db): Promise<Item[] | null> {
  const { data, error } = await db.from("training_items").select("ref, added, title, group_name, hidden").order("id");
  return error ? null : ((data ?? []) as Item[]);
}

/**
 * หน้าเทรนนิ่ง · manage = Owner ที่จัดการได้ (เห็นคลิป / กลุ่มที่ซ่อนด้วย) · คนอื่นไม่เห็นที่ซ่อน
 *   refresh = อ่านรายชื่อในไดรฟ์ใหม่ทันที (ไม่รอ 10 นาที)
 */
export async function loadTraining(manage: boolean, refresh = false): Promise<Training> {
  const db = createAdminClient();
  const { data, error } = await db.from("settings").select("training_drive_folder, training_slides").eq("id", 1).maybeSingle();
  if (error) return { ready: false, message: TRAINING_SQL, slides: null, groups: [], manage: null };
  const folder = googleId(data?.training_drive_folder as string | null);
  const slides = googleId(data?.training_slides as string | null);
  // โฟลเดอร์ที่ซ่อนแบบเดิม (settings.training_exclude — SQL training_items ย้ายมาไว้ในตารางแล้ว) ยังไม่ได้รัน SQL ส่วนนี้ = ไม่ซ่อน
  const { data: ex } = await db.from("settings").select("training_exclude").eq("id", 1).maybeSingle();
  const exclude = new Set(String(ex?.training_exclude ?? "").split(/[,\n]/).map(googleId).filter((x): x is string => !!x));
  const items = await loadItems(db);
  const itemOf = new Map((items ?? []).map((i) => [i.ref, i]));

  let drive: DriveGroup[] = [];
  let message: string | null = null;
  if (folder) {
    try {
      drive = await driveGroups(folder, exclude, refresh);
    } catch (err) {
      message = /not found/i.test(String((err as Error)?.message))
        ? "บัญชีระบบเปิดโฟลเดอร์วิดีโอไม่ได้ (แชร์โฟลเดอร์ให้บัญชีระบบ หรือตรวจ id โฟลเดอร์)"
        : `อ่านรายชื่อวิดีโอไม่สำเร็จ: ${driveError(err)}`;
    }
  }

  const video = (ref: string, fileTitle: string, minutes: number | null, added: boolean): TrainingVideo => {
    const it = itemOf.get(ref);
    const [kind, id] = ref.split(":") as ["drive" | "youtube", string];
    return { ref, kind, id, title: it?.title?.trim() || fileTitle, fileTitle, minutes, hidden: !!it?.hidden, added };
  };
  const groups: TrainingGroup[] = drive.map((g) => {
    const it = itemOf.get(`folder:${g.folderId}`);
    return {
      ref: `folder:${g.folderId}`, name: it?.title?.trim() || g.name, folderName: g.name, hidden: !!it?.hidden,
      videos: g.videos.map((v) => video(`drive:${v.id}`, v.name, v.minutes, false)),
    };
  });
  // คลิปที่เพิ่มจากลิงก์: เข้ากลุ่มที่ชื่อตรงกัน ไม่มี = กลุ่มใหม่ (ท้ายสุด)
  for (const it of items ?? []) {
    if (!it.added) continue;
    const name = it.group_name?.trim() || "คลิปเพิ่มเติม";
    let g = groups.find((x) => x.name === name);
    if (!g) {
      g = { ref: null, name, folderName: null, hidden: false, videos: [] };
      groups.push(g);
    }
    g.videos.push(video(it.ref, it.title?.trim() || "ไม่มีชื่อ", null, true));
  }
  for (const g of groups) g.videos.sort((a, b) => byName(a.title, b.title));

  const visible = manage ? groups : groups.filter((g) => !g.hidden)
    .map((g) => ({ ...g, videos: g.videos.filter((v) => !v.hidden) })).filter((g) => g.videos.length);
  return {
    ready: true, message, slides, groups: visible,
    manage: manage ? { ready: items !== null, message: items === null ? TRAINING_ITEMS_SQL : null } : null,
  };
}

/** บันทึกที่ Owner ตั้ง (สร้างแถวถ้ายังไม่มี) */
async function upsert(ref: string, patch: Partial<Item>, by: string) {
  const db = createAdminClient();
  const { error } = await db.from("training_items")
    .upsert({ ref, ...patch, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "ref" });
  if (error) throw new Error(/training_items|schema cache|does not exist/i.test(error.message) ? TRAINING_ITEMS_SQL : error.message);
}

const okRef = (ref: unknown): ref is string => typeof ref === "string" && /^(drive|folder|youtube):[\w-]{10,}$/.test(ref);
const cleanText = (s: unknown, max = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** ซ่อน / แสดง คลิปหรือกลุ่ม */
export async function setTrainingHidden(ref: unknown, hidden: boolean, by: string) {
  if (!okRef(ref)) throw new Error("ไม่พบคลิปนี้");
  await upsert(ref, { hidden }, by);
}

/** แก้ชื่อที่แสดง (ว่าง = กลับไปใช้ชื่อไฟล์ / ชื่อโฟลเดอร์ · คลิปที่เพิ่มเองต้องมีชื่อ) */
export async function renameTraining(ref: unknown, title: unknown, by: string) {
  if (!okRef(ref)) throw new Error("ไม่พบคลิปนี้");
  const t = cleanText(title);
  const db = createAdminClient();
  const { data } = await db.from("training_items").select("added").eq("ref", ref).maybeSingle();
  if (!t && data?.added) throw new Error("กรุณาใส่ชื่อคลิป");
  await upsert(ref, { title: t || null }, by);
}

/**
 * เพิ่มคลิปจากลิงก์ (Google Drive / YouTube) เข้ากลุ่ม · ไม่ใส่ชื่อ = ใช้ชื่อไฟล์ในไดรฟ์ / ชื่อคลิปใน YouTube
 *   คลิปที่อยู่ในโฟลเดอร์เทรนนิ่งอยู่แล้ว / เพิ่มไปแล้ว = แจ้งว่ามีแล้ว
 */
export async function addTrainingClip(url: unknown, title: unknown, group: unknown, by: string) {
  const ref = clipRef(String(url ?? ""));
  if (!ref) throw new Error("ลิงก์ไม่ถูกต้อง — ใช้ลิงก์ไฟล์วิดีโอใน Google Drive หรือลิงก์ YouTube");
  const groupName = cleanText(group, 80);
  if (!groupName) throw new Error("กรุณาเลือกหรือพิมพ์ชื่อกลุ่ม");
  const db = createAdminClient();
  const { data: cur } = await db.from("training_items").select("added").eq("ref", ref).maybeSingle();
  if (cur?.added) throw new Error("คลิปนี้เพิ่มไว้แล้ว");
  if (cache?.groups.some((g) => g.videos.some((v) => `drive:${v.id}` === ref))) {
    throw new Error("คลิปนี้อยู่ในโฟลเดอร์เทรนนิ่งในไดรฟ์อยู่แล้ว (ถ้าซ่อนไว้ กด \"แสดง\" ที่คลิปนั้นแทน)");
  }
  let name = cleanText(title);
  const [kind, id] = ref.split(":");
  if (!name && kind === "drive") {
    const f = await driveClient().files.get({ fileId: id, fields: "name, mimeType", supportsAllDrives: true }).catch(() => null);
    if (f?.data.mimeType && !f.data.mimeType.startsWith("video/")) throw new Error("ลิงก์นี้ไม่ใช่ไฟล์วิดีโอ");
    name = titleOf(f?.data.name ?? "");
  }
  if (!name && kind === "youtube") {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) as { title?: string } | null : null;
    name = cleanText(j?.title);
  }
  if (!name) throw new Error("อ่านชื่อคลิปไม่ได้ (ไฟล์อาจไม่ได้แชร์แบบทุกคนที่มีลิงก์) กรุณาใส่ชื่อคลิปเอง");
  await upsert(ref, { added: true, title: name, group_name: groupName, hidden: false }, by);
  return { title: name };
}

/** ลบคลิปที่เพิ่มจากลิงก์ (ไฟล์ในไดรฟ์ / YouTube ไม่ถูกลบ) */
export async function removeTrainingClip(ref: unknown) {
  if (!okRef(ref)) throw new Error("ไม่พบคลิปนี้");
  const db = createAdminClient();
  const { data, error } = await db.from("training_items").delete().eq("ref", ref).eq("added", true).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("ลบได้เฉพาะคลิปที่เพิ่มจากลิงก์ (คลิปในโฟลเดอร์ใช้ \"ซ่อน\" แทน)");
}
