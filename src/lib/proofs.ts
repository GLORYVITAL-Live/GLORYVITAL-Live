import "server-only";
import { fetchAll, proofsBySlot } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me, ProofSlot } from "@/lib/types";

/**
 * หลักฐานไลฟ์ (รูปแดชบอร์ด TikTok + เวลาเริ่ม/จบจริง) ผูกกับ slot ของ Mc
 *   เห็น/แนบได้: Owner ที่มีสิทธิ์ฝั่ง Mc = ทุก slot / Admin = เฉพาะ slot ที่ตัวเองเป็น Admin
 *   ยกเว้น slot ของ Mc ประจำ (staff.is_salaried = ได้เงินเดือน) ไม่ต้องแนบ จึงไม่แสดง
 *   ลบได้: Owner ฝั่ง Mc หรือคนที่อัปโหลด
 */
export const PROOF_BUCKET = "live-proofs";

type Db = ReturnType<typeof createAdminClient>;

const hm = (t: string) => t.slice(0, 5);
const keyOf = (r: { platform: string; starts_at: string; ends_at: string }) =>
  `${r.platform}|${Date.parse(r.starts_at)}|${Date.parse(r.ends_at)}`;

export const canSeeAll = (me: Me) => !!me.owner?.mc;
export const canUseProofs = (me: Me) => canSeeAll(me) || !!me.admin;

/** slot ที่คนนี้เห็นในหน้าหลักฐาน (slot ของ Mc ที่มีคนไลฟ์ ไม่ถูกยกเลิก) ในช่วงวันที่ */
export async function proofSlots(me: Me, first: string, last: string): Promise<ProofSlot[]> {
  if (!canUseProofs(me)) return [];
  const db = createAdminClient();
  type McRow = {
    id: number; platform: string; live_date: string; start_time: string; end_time: string; starts_at: string; ends_at: string;
    person: { name: string; is_salaried: boolean | null } | null;
  };
  type AdminRow = { platform: string; starts_at: string; ends_at: string; admin_id: number | null; person: { name: string } | null };
  const [mcRows, adminRows, proofs] = await Promise.all([
    fetchAll<McRow>((from, to) =>
      db.from("mc_slots")
        .select("id, platform, live_date, start_time, end_time, starts_at, ends_at, person:staff!mc_id(name, is_salaried)")
        .not("mc_id", "is", null).eq("is_cancelled", false).or("confirmed.is.null,confirmed.eq.true")
        .gte("live_date", first).lte("live_date", last)
        .order("starts_at").range(from, to) as unknown as PromiseLike<{ data: McRow[] | null; error: unknown }>),
    fetchAll<AdminRow>((from, to) =>
      db.from("admin_slots")
        .select("platform, starts_at, ends_at, admin_id, person:staff!admin_id(name)")
        .not("admin_id", "is", null).eq("is_cancelled", false).or("confirmed.is.null,confirmed.eq.true")
        .gte("live_date", first).lte("live_date", last)
        .range(from, to) as unknown as PromiseLike<{ data: AdminRow[] | null; error: unknown }>),
    proofsBySlot(db, first, last),
  ]);

  const admins = new Map<string, { id: number; name: string }>();
  for (const a of adminRows) admins.set(keyOf(a), { id: Number(a.admin_id), name: a.person?.name ?? "" });

  const all = canSeeAll(me);
  const out: ProofSlot[] = [];
  for (const r of mcRows) {
    if (r.person?.is_salaried) continue; // Mc ประจำ (เงินเดือน) ไม่ต้องแนบหลักฐาน
    const admin = admins.get(keyOf(r));
    if (!all && (!me.admin || admin?.id !== me.admin.id)) continue;
    const p = proofs.get(Number(r.id));
    out.push({
      mcSlotId: Number(r.id), platform: r.platform, date: r.live_date, start: hm(r.start_time), end: hm(r.end_time),
      startMs: Date.parse(r.starts_at), endMs: Date.parse(r.ends_at),
      mcName: r.person?.name ? `Mc ${r.person.name}` : "", adminName: admin?.name ?? "",
      proof: p
        ? { id: p.id, startedAt: p.startedAt, endedAt: p.endedAt, by: p.by, driveUrl: p.driveUrl, driveFolderUrl: p.driveFolderUrl, canDelete: all || p.email === me.email }
        : null,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform) || a.startMs - b.startMs);
}

/** ลบหลักฐานที่ไม่ได้ผูกกับ slot ไหนแล้ว (ทั้งแถวและไฟล์รูป) */
export async function removeOrphanProofs(db: Db, ids: number[]) {
  if (!ids.length) return;
  const { data: still } = await db.from("live_proof_slots").select("proof_id").in("proof_id", ids);
  const used = new Set((still ?? []).map((x) => Number(x.proof_id)));
  const orphan = ids.filter((id) => !used.has(id));
  if (!orphan.length) return;
  const { data: rows } = await db.from("live_proofs").select("id, image_path").in("id", orphan);
  const paths = (rows ?? []).map((x) => String(x.image_path)).filter(Boolean);
  if (paths.length) await db.storage.from(PROOF_BUCKET).remove(paths);
  await db.from("live_proofs").delete().in("id", orphan);
}
