import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { LOOK_GENDERS, type BriefView, type LookGender } from "@/lib/types";

/**
 * Look แต่งหน้า + แต่งตัว (รูป Ref) แยกผู้หญิง / ผู้ชาย ใช้ทุกไลฟ์ — SQL 20261130000000_look_refs
 *   ตาราง look_refs 1 แถวต่อเพศ: ข้อความ + รูปใน bucket live-briefs (looks/<gender>/...)
 *   Mc / Admin เห็นในโปรไฟล์ · แก้ที่ เทรนนิ่ง > เฟรมไลฟ์ (สิทธิ์เดียวกับบรีฟการแต่งตัว)
 */

export const LOOKS_SQL = "ต้องรัน SQL 20261130000000_look_refs ใน Supabase ก่อน";
const BUCKET = "live-briefs";
export const MAX_LOOK_IMAGES = 12;
const noSql = (msg: string) => /look_refs|schema cache|does not exist|bucket/i.test(msg);
const pathsOf = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : []);

type Row = { gender: string; note: string; images: unknown; updated_by: string; updated_at: string };

/** Look ทั้งสองเพศ (รูป = ลิงก์ชั่วคราว 1 ชม.) · ยังไม่ได้รัน SQL = ready false */
export async function listLooks(): Promise<{ ready: boolean; message: string | null; looks: Record<LookGender, BriefView | null> }> {
  const empty = { female: null, male: null };
  const db = createAdminClient();
  const { data, error } = await db.from("look_refs").select("*");
  if (error) return { ready: false, message: noSql(error.message) ? LOOKS_SQL : error.message, looks: empty };
  const rows = (data ?? []) as Row[];
  const paths = rows.flatMap((r) => pathsOf(r.images));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const looks: Record<LookGender, BriefView | null> = { ...empty };
  for (const r of rows) {
    if (!isGender(r.gender)) continue;
    looks[r.gender] = {
      note: r.note ?? "", updatedBy: r.updated_by ?? "", updatedAt: r.updated_at,
      images: pathsOf(r.images).flatMap((path) => (urls.has(path) ? [{ path, url: urls.get(path)! }] : [])),
    };
  }
  return { ready: true, message: null, looks };
}

export const isGender = (v: unknown): v is LookGender => (LOOK_GENDERS as readonly unknown[]).includes(v);

function genderOf(v: unknown): LookGender {
  if (!isGender(v)) throw new Error("ไม่รู้จัก Look นี้ (ผู้หญิง / ผู้ชาย)");
  return v;
}

async function currentImages(gender: LookGender) {
  const { data, error } = await createAdminClient().from("look_refs").select("images").eq("gender", gender).maybeSingle();
  if (error) throw new Error(noSql(error.message) ? LOOKS_SQL : error.message);
  return pathsOf(data?.images);
}

async function save(gender: LookGender, patch: { note?: string; images?: string[] }, by: string) {
  const { error } = await createAdminClient().from("look_refs").upsert(
    { gender, ...patch, updated_by: by, updated_at: new Date().toISOString() },
    { onConflict: "gender" },
  );
  if (error) throw new Error(noSql(error.message) ? LOOKS_SQL : error.message);
}

/** แก้ข้อความ Look */
export async function saveLookNote(key: unknown, note: unknown, by: string) {
  await save(genderOf(key), { note: String(note ?? "").replace(/\r\n/g, "\n").trim().slice(0, 2000) }, by);
}

/** เพิ่มรูป Ref (ตรวจชนิด / ขนาดที่ route แล้ว) */
export async function addLookImage(key: unknown, file: File, type: string, by: string) {
  const gender = genderOf(key);
  const images = await currentImages(gender);
  if (images.length >= MAX_LOOK_IMAGES) throw new Error(`รูป Ref ได้ไม่เกิน ${MAX_LOOK_IMAGES} รูปต่อ Look`);
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `looks/${gender}/${crypto.randomUUID()}.${ext}`;
  const db = createAdminClient();
  const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: type });
  if (error) throw new Error(noSql(error.message) ? LOOKS_SQL : `อัปโหลดรูปไม่สำเร็จ: ${error.message}`);
  try {
    await save(gender, { images: [...images, path] }, by);
  } catch (err) {
    await db.storage.from(BUCKET).remove([path]);
    throw err;
  }
}

/** ลบรูป Ref */
export async function removeLookImage(key: unknown, path: unknown, by: string) {
  const gender = genderOf(key);
  const images = await currentImages(gender);
  if (typeof path !== "string" || !images.includes(path)) throw new Error("ไม่พบรูปนี้ (อาจถูกลบไปแล้ว)");
  await save(gender, { images: images.filter((p) => p !== path) }, by);
  await createAdminClient().storage.from(BUCKET).remove([path]);
}
