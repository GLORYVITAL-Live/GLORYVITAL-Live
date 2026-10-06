import "server-only";
import { fetchAll, gmvBySlot, proofsBySlot } from "@/lib/data";
import { addDays } from "@/lib/window";
import { computeGmv, gmvBeforeMap, type GmvSlot } from "@/lib/gmv";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me, ProofSlot } from "@/lib/types";

/**
 * หลักฐานไลฟ์ (รูปแดชบอร์ด TikTok + เวลาเริ่ม/จบจริง) ผูกกับ slot ของ Mc
 *   เห็น/แนบได้: Owner ที่มีสิทธิ์ฝั่ง Mc = ทุก slot / Admin = เฉพาะ slot ที่ตัวเองเป็น Admin
 *   slot ของ Mc ประจำ (staff.is_salaried = ได้เงินเดือน) ไม่ต้องแนบหลักฐาน แต่แสดง (salaried) ให้กรอก GMV ได้
 *   ลบได้: Owner ฝั่ง Mc หรือคนที่อัปโหลด
 */
export const PROOF_BUCKET = "live-proofs";

type Db = ReturnType<typeof createAdminClient>;

const hm = (t: string) => t.slice(0, 5);
const keyOf = (r: { platform: string; starts_at: string; ends_at: string }) =>
  `${r.platform}|${Date.parse(r.starts_at)}|${Date.parse(r.ends_at)}`;

/** แนบ / ลบหลักฐานได้ทุก slot: Owner ที่ติ๊กจัดการ Mc หรือติ๊ก "จัดการหลักฐานไลฟ์" */
export const canSeeAll = (me: Me) => !!(me.owner?.mc || me.owner?.proofs);
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
  // โหลดย้อนไป 1 วัน: ใช้หายอด GMV สะสมของไลฟ์ที่ต่อกันข้ามเที่ยงคืน (แสดงเฉพาะตั้งแต่ first)
  const since = addDays(first, -1);
  const [mcRows, adminRows, proofs] = await Promise.all([
    fetchAll<McRow>((from, to) =>
      db.from("mc_slots")
        .select("id, platform, live_date, start_time, end_time, starts_at, ends_at, person:staff!mc_id(name, is_salaried)")
        .not("mc_id", "is", null).eq("is_cancelled", false).or("confirmed.is.null,confirmed.eq.true")
        .gte("live_date", since).lte("live_date", last)
        .order("starts_at").range(from, to) as unknown as PromiseLike<{ data: McRow[] | null; error: unknown }>),
    fetchAll<AdminRow>((from, to) =>
      db.from("admin_slots")
        .select("platform, starts_at, ends_at, admin_id, person:staff!admin_id(name)")
        .not("admin_id", "is", null).eq("is_cancelled", false).or("confirmed.is.null,confirmed.eq.true")
        .gte("live_date", first).lte("live_date", last)
        .range(from, to) as unknown as PromiseLike<{ data: AdminRow[] | null; error: unknown }>),
    proofsBySlot(db, since, last),
  ]);
  const gmvs = await gmvBySlot(db, since, last);

  const admins = new Map<string, { id: number; name: string }>();
  for (const a of adminRows) admins.set(keyOf(a), { id: Number(a.admin_id), name: a.person?.name ?? "" });

  // ยอดสะสมก่อนหน้าคิดจากทุก slot (รวม slot ที่ Admin คนนี้มองไม่เห็น เช่น Admin คนละคน / Mc ประจำ)
  const before = gmvBeforeMap(mcRows.map((r) => ({
    id: Number(r.id), platform: r.platform, startMs: Date.parse(r.starts_at), endMs: Date.parse(r.ends_at),
    gmv: gmvs.get(Number(r.id))?.value ?? null,
  })));

  const all = canSeeAll(me);
  const out: ProofSlot[] = [];
  for (const r of mcRows) {
    if (r.live_date < first) continue; // วันก่อนหน้า โหลดมาใช้คิด GMV สะสมเท่านั้น
    // Mc ประจำ (เงินเดือน) ไม่ต้องแนบหลักฐาน แต่ยังแสดงให้กรอก GMV ได้ (salaried = true)
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
      salaried: !!r.person?.is_salaried,
      gmv: gmvs.get(Number(r.id)) ?? null,
      gmvBefore: before.get(Number(r.id)) ?? null,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform) || a.startMs - b.startMs);
}

export type GmvEntry = { id: number; input: string; auto: boolean };

/** อ่านรายการ GMV ที่ส่งมา [{ id, input, auto }] (ข้อมูลผิดรูปแบบ = ตัดทิ้ง) */
export function parseGmvEntries(raw: unknown): GmvEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => ({ id: Number(x?.id), input: String(x?.input ?? "").slice(0, 200), auto: x?.auto !== false }))
    .filter((x) => Number.isInteger(x.id) && x.id > 0);
}

/**
 * คิดยอด GMV ของ slot ที่กรอก (ฝั่ง server คิดเองเสมอ ไม่เชื่อตัวเลขจาก browser)
 *   ยอดสะสมก่อนหน้ามาจาก slot อื่นในฐานข้อมูล (แพลตฟอร์มเดียวกัน ย้อนไป 1 วัน) + slot ก่อนหน้าในชุดเดียวกัน
 */
export async function resolveGmv(db: Db, entries: GmvEntry[]) {
  if (!entries.length) return [];
  type Row = { id: number; platform: string; live_date: string; starts_at: string; ends_at: string };
  const toSlot = (r: Row): GmvSlot => ({ id: Number(r.id), platform: r.platform, startMs: Date.parse(r.starts_at), endMs: Date.parse(r.ends_at), gmv: null });
  const { data: targets, error } = await db.from("mc_slots")
    .select("id, platform, live_date, starts_at, ends_at").in("id", entries.map((e) => e.id));
  if (error) throw error;
  const rows = (targets ?? []) as Row[];
  if (!rows.length) return [];
  const dates = rows.map((r) => r.live_date).sort();
  const [ctx, gmvs] = await Promise.all([
    fetchAll<Row>((from, to) =>
      db.from("mc_slots").select("id, platform, live_date, starts_at, ends_at")
        .in("platform", [...new Set(rows.map((r) => r.platform))])
        .not("mc_id", "is", null).eq("is_cancelled", false)
        .gte("live_date", addDays(dates[0], -1)).lte("live_date", dates[dates.length - 1])
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>),
    gmvBySlot(db, addDays(dates[0], -1), dates[dates.length - 1]),
  ]);
  const byId = new Map(rows.map((r) => [Number(r.id), toSlot(r)]));
  return computeGmv(
    entries.filter((e) => byId.has(e.id)).map((e) => ({ slot: byId.get(e.id)!, input: e.input, auto: e.auto })),
    ctx.map((r) => ({ ...toSlot(r), gmv: gmvs.get(Number(r.id))?.value ?? null })),
  );
}

/** บันทึกยอด GMV ลง slot (ยังไม่ได้รัน SQL = แจ้งให้รันก่อน) คืนข้อความผิดพลาด หรือ "" */
export async function saveGmv(db: Db, results: Awaited<ReturnType<typeof resolveGmv>>) {
  for (const g of results) {
    const { error } = await db.from("mc_slots")
      .update({ gmv: g.gmv, gmv_input: g.input || null, gmv_minus: g.minus }).eq("id", g.id);
    if (error) return /gmv/.test(error.message) ? "ยังไม่ได้รัน SQL ยอด GMV (supabase/migrations/20261016000000_proof_gmv.sql)" : error.message;
  }
  return "";
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
