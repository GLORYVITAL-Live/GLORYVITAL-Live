import "server-only";
import { driveClient, driveError } from "@/lib/drive";
import { todayKey } from "@/lib/format";
import { frameFor, frameSheetError, parseFrameSheet, spreadsheetIdOf, type FrameWindow } from "@/lib/frames";
import { sheetsApi } from "@/lib/sheet";
import { createAdminClient } from "@/lib/supabase/server";
import type { BriefView, FrameFile, FrameView } from "@/lib/types";

/**
 * เฟรมไลฟ์ + บรีฟการแต่งตัว — SQL 20261113000000_live_frames
 *   เฟรม: แท็บ "Frame live" ในชีตวางแผน (settings.frame_sheet_id ตั้งด้วย SQL — ลิงก์ชีตเต็มหรือ id ก็ได้) อ่านจำไว้ 10 นาที
 *     โครงชีตอ่านที่ src/lib/frames.ts
 *   บรีฟ: ตาราง live_briefs (ช่อง + ช่วงวันของเฟรม) ข้อความ + รูปชุดตัวอย่างใน bucket live-briefs
 *   ไฟล์ในไดรฟ์เปิดผ่านเว็บ (/api/frames/media) ได้เฉพาะไฟล์ที่อยู่ในชีตเฟรม
 */

export const FRAMES_SQL = "ต้องรัน SQL 20261113000000_live_frames ใน Supabase ก่อน";
const NO_SHEET = "ยังไม่ได้ตั้งชีตเฟรมไลฟ์ (settings.frame_sheet_id — วางลิงก์ชีตทั้งบรรทัด หรือ id ก็ได้)";
const BAD_SHEET = "ค่า settings.frame_sheet_id ไม่ใช่ลิงก์หรือ id ของ Google Sheets — วางลิงก์ชีตทั้งบรรทัดได้เลย";
const BUCKET = "live-briefs";
const TTL = 10 * 60_000;
export const MAX_BRIEF_IMAGES = 12;
const noSql = (msg: string) => /live_briefs|frame_sheet_id|can_manage_briefs|schema cache|does not exist|bucket/i.test(msg);

let cache: { at: number; sheet: string; windows: FrameWindow[] } | null = null;
const metaCache = new Map<string, FrameFile>();

/** เฟรมทุกช่วงในชีต (จำไว้ 10 นาที · force = อ่านใหม่) · ready false = ยังไม่ได้ตั้งชีต / ยังไม่ได้รัน SQL */
export async function frameWindows(force = false): Promise<{ ready: boolean; message: string | null; windows: FrameWindow[] }> {
  const { data, error } = await createAdminClient().from("settings").select("frame_sheet_id").eq("id", 1).maybeSingle();
  if (error) return { ready: false, message: noSql(error.message) ? FRAMES_SQL : error.message, windows: [] };
  const raw = String(data?.frame_sheet_id ?? "").trim();
  if (!raw) return { ready: false, message: NO_SHEET, windows: [] };
  const id = spreadsheetIdOf(raw);
  if (!id) return { ready: false, message: BAD_SHEET, windows: [] };
  if (!force && cache && cache.sheet === id && Date.now() - cache.at < TTL) return { ready: true, message: null, windows: cache.windows };
  try {
    const api = sheetsApi();
    const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
    const tab = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "").find((t) => /frame\s*live/i.test(t));
    if (!tab) return { ready: true, message: 'ไม่พบแท็บ "Frame live" ในชีตเฟรม', windows: [] };
    const res = await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A1:AZ2000` });
    const windows = parseFrameSheet(res.data.values ?? [], todayKey());
    cache = { at: Date.now(), sheet: id, windows };
    return { ready: true, message: null, windows };
  } catch (err) {
    // อ่านไม่ได้ชั่วคราว = ใช้ชุดเดิมที่จำไว้
    if (cache?.sheet === id) return { ready: true, message: null, windows: cache.windows };
    const msg = String((err as Error)?.message ?? err);
    return { ready: true, message: `อ่านชีตเฟรมไม่สำเร็จ: ${frameSheetError(msg) ?? driveError(err)}`, windows: [] };
  }
}

/** ชนิด / ชื่อไฟล์ในไดรฟ์ (จำไว้ · เปิดไม่ได้ = file) */
async function filesOf(ids: (string | null)[]) {
  const want = [...new Set(ids.filter((x): x is string => !!x && !metaCache.has(x)))];
  const drive = driveClient();
  await Promise.all(want.map(async (id) => {
    const f = await drive.files.get({ fileId: id, fields: "mimeType, name", supportsAllDrives: true }).catch(() => null);
    const mime = f?.data.mimeType ?? "";
    metaCache.set(id, { id, name: f?.data.name ?? "", kind: mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "file" });
  }));
  return (id: string | null) => (id ? metaCache.get(id) ?? null : null);
}

type BriefRow = { platform: string; date_from: string; date_to: string; note: string; images: unknown; updated_by: string; updated_at: string };
const keyOf = (r: Pick<BriefRow, "platform" | "date_from" | "date_to">) => `${r.platform}|${r.date_from}|${r.date_to}`;
const pathsOf = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : []);

/** บรีฟที่ช่วงวันซ้อนกับ [first, last] Map<key, บรีฟ> (รูป = ลิงก์ชั่วคราว 1 ชม.) · ยังไม่ได้รัน SQL = ว่าง */
async function briefsBetween(first: string, last: string) {
  const db = createAdminClient();
  const { data, error } = await db.from("live_briefs").select("*").lte("date_from", last).gte("date_to", first);
  const out = new Map<string, BriefView>();
  if (error) return out;
  const rows = (data ?? []) as BriefRow[];
  const paths = rows.flatMap((r) => pathsOf(r.images));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  for (const r of rows) {
    out.set(keyOf(r), {
      note: r.note ?? "", updatedBy: r.updated_by ?? "", updatedAt: r.updated_at,
      images: pathsOf(r.images).flatMap((path) => (urls.has(path) ? [{ path, url: urls.get(path)! }] : [])),
    });
  }
  return out;
}

/**
 * เทรนนิ่ง > เฟรมไลฟ์: เฟรมที่ยังไม่จบ (ตั้งแต่ since) + บรีฟ
 *   ใส่ชนิดไฟล์ (วิดีโอ / รูป) ให้เฉพาะเฟรมที่แสดง
 */
export async function listFrames(since: string): Promise<{ ready: boolean; message: string | null; frames: FrameView[] }> {
  const r = await frameWindows();
  if (!r.ready) return { ready: false, message: r.message, frames: [] };
  const shown = r.windows.filter((w) => w.to >= since);
  if (!shown.length) return { ready: true, message: r.message, frames: [] };
  const [file, briefs] = await Promise.all([
    filesOf(shown.flatMap((w) => [w.frameId, w.productId])),
    briefsBetween(shown[0].from < since ? shown[0].from : since, shown.reduce((a, w) => (w.to > a ? w.to : a), since)),
  ]);
  return {
    ready: true, message: r.message,
    frames: shown.map((w) => ({
      key: w.key, platform: w.platform, from: w.from, to: w.to,
      frame: file(w.frameId), product: file(w.productId), brief: briefs.get(w.key) ?? null,
    })),
  };
}

/** ตารางของฉัน: เฟรม + บรีฟของแต่ละ slot (ช่อง + วัน) Map<"ช่อง|วัน", ...> · ยังไม่ได้ตั้งชีต / อ่านไม่ได้ = ว่าง */
export async function framesForSlots(slots: { platform: string; date: string }[]) {
  const out = new Map<string, { frame: FrameFile | null; brief: BriefView | null }>();
  if (!slots.length) return out;
  const r = await frameWindows();
  if (!r.ready || !r.windows.length) return out;
  const hit = new Map(slots.map((s) => [`${s.platform}|${s.date}`, frameFor(r.windows, s.platform, s.date)]));
  const used = [...hit.values()].filter((w): w is FrameWindow => !!w);
  if (!used.length) return out;
  const dates = slots.map((s) => s.date).sort();
  const [file, briefs] = await Promise.all([filesOf(used.map((w) => w.frameId)), briefsBetween(dates[0], dates[dates.length - 1])]);
  for (const [k, w] of hit) if (w) out.set(k, { frame: file(w.frameId), brief: briefs.get(w.key) ?? null });
  return out;
}

/** ไฟล์นี้อยู่ในชีตเฟรมไหม (เปิดผ่านเว็บได้เฉพาะไฟล์เหล่านี้) */
export async function isFrameFile(id: string) {
  const r = await frameWindows();
  return r.windows.some((w) => w.frameId === id || w.productId === id);
}

/** เฟรมของ key นี้ (ต้องมีในชีตตอนนี้) */
async function windowOf(key: string) {
  const w = (await frameWindows()).windows.find((x) => x.key === key);
  if (!w) throw new Error("ไม่พบเฟรมช่วงนี้ในชีตแล้ว (ชีตอาจถูกแก้) โหลดหน้าใหม่");
  return w;
}

async function currentImages(w: FrameWindow) {
  const { data, error } = await createAdminClient().from("live_briefs").select("images")
    .eq("platform", w.platform).eq("date_from", w.from).eq("date_to", w.to).maybeSingle();
  if (error) throw new Error(noSql(error.message) ? FRAMES_SQL : error.message);
  return pathsOf(data?.images);
}

async function save(w: FrameWindow, patch: Partial<Pick<BriefRow, "note">> & { images?: string[] }, by: string) {
  const { error } = await createAdminClient().from("live_briefs").upsert(
    { platform: w.platform, date_from: w.from, date_to: w.to, ...patch, updated_by: by, updated_at: new Date().toISOString() },
    { onConflict: "platform,date_from,date_to" },
  );
  if (error) throw new Error(noSql(error.message) ? FRAMES_SQL : error.message);
}

/** แก้ข้อความบรีฟ */
export async function saveBriefNote(key: string, note: unknown, by: string) {
  await save(await windowOf(key), { note: String(note ?? "").replace(/\r\n/g, "\n").trim().slice(0, 2000) }, by);
}

/** เพิ่มรูปชุดตัวอย่าง (ตรวจชนิด / ขนาดที่ route แล้ว) */
export async function addBriefImage(key: string, file: File, type: string, by: string) {
  const w = await windowOf(key);
  const images = await currentImages(w);
  if (images.length >= MAX_BRIEF_IMAGES) throw new Error(`รูปตัวอย่างได้ไม่เกิน ${MAX_BRIEF_IMAGES} รูปต่อช่วง`);
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `${w.platform.replace(/\W+/g, "-")}/${w.from}_${w.to}/${crypto.randomUUID()}.${ext}`;
  const db = createAdminClient();
  const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: type });
  if (error) throw new Error(noSql(error.message) ? FRAMES_SQL : `อัปโหลดรูปไม่สำเร็จ: ${error.message}`);
  try {
    await save(w, { images: [...images, path] }, by);
  } catch (err) {
    await db.storage.from(BUCKET).remove([path]);
    throw err;
  }
}

/** ลบรูปชุดตัวอย่าง */
export async function removeBriefImage(key: string, path: unknown, by: string) {
  const w = await windowOf(key);
  const images = await currentImages(w);
  if (typeof path !== "string" || !images.includes(path)) throw new Error("ไม่พบรูปนี้ (อาจถูกลบไปแล้ว)");
  await save(w, { images: images.filter((p) => p !== path) }, by);
  await createAdminClient().storage.from(BUCKET).remove([path]);
}
