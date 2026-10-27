import "server-only";
import { Readable } from "stream";
import { driveClient, driveError } from "@/lib/drive";
import { notifyMany } from "@/lib/notifications";
import { isTestAccount } from "@/lib/staff-check";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me, Training, TrainingBlock, TrainingGroup, TrainingProgress, TrainingVideo, TrainingViews } from "@/lib/types";

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
type Item = { ref: string; added: boolean; title: string | null; group_name: string | null; hidden: boolean; required?: boolean };

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

/** ที่ Owner ตั้งไว้ (ยังไม่ได้รัน SQL = null · ยังไม่ได้รัน SQL pay_sync = ไม่มีคลิปบังคับ) */
async function loadItems(db: Db): Promise<Item[] | null> {
  const cols = "ref, added, title, group_name, hidden";
  const first = await db.from("training_items").select(`${cols}, required`).order("id");
  const res = first.error && /required/.test(first.error.message) ? await db.from("training_items").select(cols).order("id") : first;
  return res.error ? null : ((res.data ?? []) as Item[]);
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

  // บังคับดู: ติ๊กที่คลิป หรือทั้งกลุ่ม (กลุ่มโฟลเดอร์ในไดรฟ์)
  const video = (ref: string, fileTitle: string, minutes: number | null, added: boolean, groupRequired = false): TrainingVideo => {
    const it = itemOf.get(ref);
    const [kind, id] = ref.split(":") as ["drive" | "youtube", string];
    return {
      ref, kind, id, title: it?.title?.trim() || fileTitle, fileTitle, minutes, hidden: !!it?.hidden, added,
      required: groupRequired || !!it?.required,
    };
  };
  const groups: TrainingGroup[] = drive.map((g) => {
    const it = itemOf.get(`folder:${g.folderId}`);
    return {
      ref: `folder:${g.folderId}`, name: it?.title?.trim() || g.name, folderName: g.name, hidden: !!it?.hidden, required: !!it?.required,
      videos: g.videos.map((v) => video(`drive:${v.id}`, v.name, v.minutes, false, !!it?.required)),
    };
  });
  // คลิปที่เพิ่มจากลิงก์: เข้ากลุ่มที่ชื่อตรงกัน ไม่มี = กลุ่มใหม่ (ท้ายสุด)
  for (const it of items ?? []) {
    if (!it.added) continue;
    const name = it.group_name?.trim() || "คลิปเพิ่มเติม";
    let g = groups.find((x) => x.name === name);
    if (!g) {
      g = { ref: null, name, folderName: null, hidden: false, required: false, videos: [] };
      groups.push(g);
    }
    g.videos.push(video(it.ref, it.title?.trim() || "ไม่มีชื่อ", null, true, g.required));
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

// ---------- ส่งไฟล์วิดีโอให้ตัวเล่นของเว็บ ----------
//   Google บล็อกเว็บอื่นไม่ให้ดึงวิดีโอจากลิงก์ไดรฟ์ตรงๆ (403) → เซิร์ฟเวอร์ดึงด้วยบัญชีระบบแล้วส่งต่อทีละช่วง (Range)
//   ส่งได้เฉพาะคลิปที่อยู่ในหน้าเทรนนิ่ง (กันใช้เปิดไฟล์อื่นที่บัญชีระบบเข้าถึงได้ เช่น ใบ 50 ทวิ / เอกสารรับเงิน)
//   ช่วงละไม่เกิน 4MB (ฟังก์ชันของ Vercel ตอบได้ไม่เกิน ~4.5MB ต่อครั้ง) — ตัวเล่นขอช่วงถัดไปเอง

const CHUNK = 4 * 1024 * 1024;
let allowed: { manage: boolean; at: number; ids: Set<string> }[] = [];
const sizes = new Map<string, { size: number; mime: string }>();

/** คลิปไดรฟ์ที่เปิดได้ (จำไว้ 10 นาที · Owner ที่จัดการได้ = รวมที่ซ่อน) */
async function allowedIds(manage: boolean) {
  const hit = allowed.find((a) => a.manage === manage && Date.now() - a.at < TTL);
  if (hit) return hit.ids;
  const t = await loadTraining(manage);
  const ids = new Set(t.groups.flatMap((g) => g.videos).filter((v) => v.kind === "drive").map((v) => v.id));
  allowed = [...allowed.filter((a) => a.manage !== manage), { manage, at: Date.now(), ids }];
  return ids;
}

/**
 * ส่งวิดีโอ 1 ช่วงตาม header Range (ไม่มี = ช่วงแรก) · ไม่ใช่คลิปในหน้าเทรนนิ่ง = 404
 *   ส่งต่อทันทีที่ได้จากไดรฟ์ (ไม่รอครบช่วง — เริ่มเล่น / เลื่อนเวลาได้เร็ว) · ตัวเล่นยกเลิกคำขอ (เลื่อนไปที่อื่น) = หยุดดึงจากไดรฟ์
 */
export async function trainingVideoChunk(id: string, range: string | null, manage: boolean, signal?: AbortSignal): Promise<Response> {
  if (!/^[\w-]{10,}$/.test(id) || !(await allowedIds(manage)).has(id)) return new Response("not found", { status: 404 });
  const drive = driveClient();
  let meta = sizes.get(id);
  if (!meta) {
    const f = await drive.files.get({ fileId: id, fields: "size, mimeType", supportsAllDrives: true });
    meta = { size: Number(f.data.size ?? 0), mime: f.data.mimeType || "video/mp4" };
    sizes.set(id, meta);
  }
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  let start = m?.[1] ? Number(m[1]) : 0;
  let end = m?.[2] ? Number(m[2]) : meta.size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, meta.size - Number(m[2])); end = meta.size - 1; } // bytes=-N (ท้ายไฟล์)
  if (start >= meta.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${meta.size}` } });
  end = Math.min(end, start + CHUNK - 1, meta.size - 1);
  const res = await drive.files.get(
    { fileId: id, alt: "media", supportsAllDrives: true },
    { responseType: "stream", headers: { Range: `bytes=${start}-${end}` }, signal },
  );
  const node = res.data as unknown as Readable;
  signal?.addEventListener("abort", () => node.destroy(), { once: true });
  return new Response(Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>, {
    status: 206,
    headers: {
      "Content-Type": meta.mime, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${meta.size}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

// ---------- ประวัติการเข้าชม (SQL 20261105000000_training_views) ----------

export const TRAINING_VIEWS_SQL = "ต้องรัน SQL 20261105000000_training_views ใน Supabase ก่อน (ประวัติการเข้าชม)";
const VIEW_GAP = 30 * 60_000;

/** ชื่อ + บทบาทของคนที่เข้าชม (Mc ก่อน — คนที่เป็นหลายบทบาท) */
function viewerOf(me: Me) {
  if (me.mc) return { who: `Mc ${me.mc.name}`, role: "mc" };
  if (me.admin) return { who: me.admin.name, role: "admin" };
  if (me.owner) return { who: me.owner.name, role: "owner" };
  return { who: me.marketing?.name ?? me.email, role: "marketing" };
}

/**
 * บันทึกการเข้าชม (คนเดิม + เรื่องเดิม ภายใน 30 นาที = ไม่บันทึกซ้ำ) · ยังไม่ได้รัน SQL / พลาด = ไม่เป็นไร (ไม่กระทบการดู)
 *   'done' = ดูคลิปจบ (ใช้กับคลิปบังคับก่อนจอง) บันทึกครั้งเดียวต่อคลิป
 */
export async function logTrainingView(me: Me, kind: unknown, ref: unknown, title: unknown) {
  if (kind !== "page" && kind !== "video" && kind !== "slides" && kind !== "done") return;
  const clip = (kind === "video" || kind === "done") && okRef(ref) && !ref.startsWith("folder:") ? ref : null;
  if ((kind === "video" || kind === "done") && !clip) return;
  const db = createAdminClient();
  const email = me.email.trim().toLowerCase();
  let q = db.from("training_views").select("id").eq("email", email).eq("kind", kind).limit(1);
  if (kind !== "done") q = q.gte("created_at", new Date(Date.now() - VIEW_GAP).toISOString());
  q = clip ? q.eq("ref", clip) : q;
  const { data, error } = await q;
  if (error || data?.length) return;
  await db.from("training_views").insert({ email, ...viewerOf(me), kind, ref: clip, title: clip ? cleanText(title, 200) || null : null });
}

/**
 * ประวัติการเข้าชมในช่วง days วันล่าสุด (0 = ทั้งหมด) ต่อคน + Mc / Admin (มีอีเมล) ที่ยังไม่เคยเข้าในช่วงนั้น
 *   คนที่มีหลายแถวในรายชื่อ (อีเมลเดียวกัน) = คนเดียว
 */
export async function trainingViews(days: number): Promise<TrainingViews> {
  const db = createAdminClient();
  const since = days > 0 ? new Date(Date.now() - days * 86400_000).toISOString() : null;
  type Row = { email: string; who: string; role: string; kind: "page" | "video" | "slides"; ref: string | null; title: string | null; created_at: string };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("training_views").select("email, who, role, kind, ref, title, created_at").order("created_at", { ascending: false });
    if (since) q = q.gte("created_at", since);
    const { data, error } = await q.range(from, from + 999);
    if (error) return { ready: false, message: TRAINING_VIEWS_SQL, days, people: [], never: [] };
    rows.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < 1000 || rows.length >= 20_000) break;
  }
  const people = new Map<string, TrainingViews["people"][number]>();
  for (const r of rows) {
    // แถวแรก = ล่าสุด (เรียงใหม่ไปเก่า) → ชื่อ / บทบาทล่าสุด
    const p = people.get(r.email) ?? {
      email: r.email, who: r.who || r.email, role: r.role, lastAt: r.created_at, firstAt: r.created_at, pages: 0, slides: 0, plays: [],
    };
    p.firstAt = r.created_at;
    if (r.kind === "page") p.pages++;
    else if (r.kind === "slides") p.slides++;
    else if (r.ref) {
      const c = p.plays.find((x) => x.ref === r.ref);
      if (c) c.count++;
      else p.plays.push({ ref: r.ref, title: r.title || "ไม่มีชื่อ", count: 1, lastAt: r.created_at });
    }
    people.set(r.email, p);
  }
  const { data: staff } = await db.from("staff").select("role, name, email").in("role", ["mc", "admin"]).not("email", "is", null).order("name");
  const seen = new Set(people.keys());
  const never = new Map<string, string>();
  for (const s of staff ?? []) {
    const e = String(s.email ?? "").trim().toLowerCase();
    if (!e || seen.has(e) || never.has(e)) continue;
    never.set(e, s.role === "mc" ? `Mc ${s.name}` : String(s.name));
  }
  return {
    ready: true, message: null, days,
    people: [...people.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    never: [...never.values()].sort((a, b) => a.localeCompare(b, "th")),
  };
}

// ---------- คลิปบังคับก่อนจองคิว (SQL 20261111000000_pay_sync) ----------
//   Owner ติ๊ก "บังคับดู" ที่คลิป / ทั้งกลุ่ม + เปิดใช้ (settings.training_required) → Mc / Admin เสริมต้องดูจบครบก่อนจองผ่านเว็บ
//   ดูจบ = ตัวเล่นของเว็บ (คลิปในไดรฟ์) เล่นจริงเกือบทั้งคลิป · YouTube = กด "ดูจบแล้ว" เอง · staff.training_passed = Owner ให้ผ่าน

export const TRAINING_GATE_SQL = "ต้องรัน SQL 20261111000000_pay_sync ใน Supabase ก่อน (คลิปบังคับก่อนจอง)";
const gateSqlMissing = (msg: string) => /required|training_passed|schema cache|does not exist/i.test(msg);

/** คลิปบังคับที่ทีมเห็น (ไม่นับที่ซ่อน) */
async function requiredClips() {
  const t = await loadTraining(false);
  return t.groups.flatMap((g) => g.videos).filter((v) => v.required).map((v) => ({ ref: v.ref, title: v.title }));
}

/** ref ที่ดูจบแล้วของอีเมลนี้ */
async function doneRefs(email: string) {
  const { data } = await createAdminClient().from("training_views").select("ref").eq("email", email.trim().toLowerCase()).eq("kind", "done");
  return new Set((data ?? []).map((r) => String(r.ref)));
}

/** เปิดใช้อยู่ไหม (ยังไม่ได้รัน SQL = ปิด) */
async function gateOn() {
  const { data, error } = await createAdminClient().from("settings").select("training_required").eq("id", 1).maybeSingle();
  return !error && data?.training_required === true;
}

/** คนนี้ Owner ให้ผ่านแล้ว */
async function passed(staffId: number) {
  const { data, error } = await createAdminClient().from("staff").select("training_passed").eq("id", staffId).maybeSingle();
  return !error && data?.training_passed === true;
}

/**
 * หน้าจอง / ตอนจอง: ยังดูคลิปบังคับไม่ครบ = { total, done, missing } · null = จองได้ (ปิดอยู่ / ไม่มีคลิปบังคับ / ให้ผ่านแล้ว / ดูครบ)
 *   on = ค่าตั้งที่โหลดมาแล้ว (ไม่ส่ง = อ่านเอง)
 */
export async function trainingBlock(email: string, staffId: number, on?: boolean): Promise<TrainingBlock | null> {
  if (!(on ?? (await gateOn())) || (await passed(staffId))) return null;
  const clips = await requiredClips();
  if (!clips.length) return null;
  const done = await doneRefs(email);
  const missing = clips.filter((c) => !done.has(c.ref));
  return missing.length ? { total: clips.length, done: clips.length - missing.length, missing: missing.map((c) => c.title) } : null;
}

/** หน้าเทรนนิ่งของคนนี้: เปิดใช้ไหม / ต้องดูไหม (Mc / Admin เสริม) / ให้ผ่านแล้วไหม / ดูจบคลิปไหนแล้ว */
export async function myTrainingGate(me: Me): Promise<Training["gate"]> {
  const person = me.mc ?? (me.admin?.isExtra ? me.admin : null);
  const [on, done, ok] = await Promise.all([gateOn(), doneRefs(me.email), person ? passed(person.id) : Promise.resolve(false)]);
  return { on, applies: !!person, passed: ok, done: [...done] };
}

/** ความคืบหน้ารายคน (Owner): Mc ทุกคน + Admin เสริม ที่มีอีเมล (ไม่รวมบัญชีทดสอบ) */
export async function trainingProgress(): Promise<TrainingProgress> {
  const db = createAdminClient();
  const [on, clips, staff, views] = await Promise.all([
    gateOn(),
    requiredClips(),
    db.from("staff").select("id, role, name, email, is_extra_admin, training_passed").in("role", ["mc", "admin"]).not("email", "is", null).order("name"),
    db.from("training_views").select("email, ref").eq("kind", "done"),
  ]);
  if (staff.error) throw new Error(gateSqlMissing(staff.error.message) ? TRAINING_GATE_SQL : staff.error.message);
  const refs = new Set(clips.map((c) => c.ref));
  const doneOf = new Map<string, Set<string>>();
  for (const v of views.data ?? []) {
    const e = String(v.email);
    if (refs.has(String(v.ref))) doneOf.set(e, (doneOf.get(e) ?? new Set()).add(String(v.ref)));
  }
  const people = (staff.data ?? [])
    .filter((s) => (s.role === "mc" || s.is_extra_admin) && !isTestAccount(s.name))
    .map((s) => ({
      id: Number(s.id), who: s.role === "mc" ? `Mc ${s.name}` : String(s.name), role: s.role as "mc" | "admin",
      done: doneOf.get(String(s.email).trim().toLowerCase())?.size ?? 0, passed: s.training_passed === true,
    }));
  return { on, total: clips.length, people };
}

/** ติ๊ก / เอาติ๊กบังคับดู (คลิป หรือทั้งกลุ่ม) */
export async function setTrainingRequired(ref: unknown, required: boolean, by: string) {
  if (!okRef(ref)) throw new Error("ไม่พบคลิปนี้");
  try {
    await upsert(ref, { required }, by);
  } catch (err) {
    throw new Error(gateSqlMissing((err as Error).message) ? TRAINING_GATE_SQL : (err as Error).message);
  }
}

/**
 * เปิด / ปิด บังคับดูก่อนจอง · เปิด = แจ้งคนที่ยังดูไม่ครบ (วันละครั้ง)
 *   คืนจำนวนคนที่แจ้ง
 */
export async function setTrainingGate(on: boolean) {
  const db = createAdminClient();
  const { error } = await db.from("settings").update({ training_required: on }).eq("id", 1);
  if (error) throw new Error(gateSqlMissing(error.message) ? TRAINING_GATE_SQL : error.message);
  if (!on) return 0;
  const p = await trainingProgress();
  if (!p.total) return 0;
  const ids = p.people.filter((x) => !x.passed && x.done < p.total).map((x) => x.id);
  if (!ids.length) return 0;
  const { data } = await db.from("staff").select("id, role, email").in("id", ids);
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  return notifyMany((data ?? []).filter((s) => s.email).map((s) => ({
    email: String(s.email).trim().toLowerCase(), kind: "training" as const, page: s.role === "mc" ? "mc" as const : "admin" as const,
    dedupe: `training_gate:${today}`,
    title: "ต้องดูคลิปเทรนนิ่งที่บังคับให้ครบก่อนจองคิว",
    body: `มีคลิปบังคับ ${p.total} คลิป — เปิดเมนู "เทรนนิ่ง" แล้วดูให้จบ ระบบนับให้อัตโนมัติ ครบแล้วจองคิวได้ตามปกติ`,
  })));
}

/** Owner ให้ผ่าน / ยกเลิกให้ผ่าน (เช่น เทรนนอกเว็บแล้ว) */
export async function setTrainingPassed(staffId: number, value: boolean) {
  const { data, error } = await createAdminClient().from("staff").update({ training_passed: value }).eq("id", staffId).in("role", ["mc", "admin"]).select("id");
  if (error) throw new Error(gateSqlMissing(error.message) ? TRAINING_GATE_SQL : error.message);
  if (!data?.length) throw new Error("ไม่พบรายชื่อนี้");
}

/** ลบคลิปที่เพิ่มจากลิงก์ (ไฟล์ในไดรฟ์ / YouTube ไม่ถูกลบ) */
export async function removeTrainingClip(ref: unknown) {
  if (!okRef(ref)) throw new Error("ไม่พบคลิปนี้");
  const db = createAdminClient();
  const { data, error } = await db.from("training_items").delete().eq("ref", ref).eq("added", true).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("ลบได้เฉพาะคลิปที่เพิ่มจากลิงก์ (คลิปในโฟลเดอร์ใช้ \"ซ่อน\" แทน)");
}
