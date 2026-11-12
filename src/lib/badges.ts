import "server-only";
import { bkkToday, fetchAll, proofsBySlot } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import type { Badges, Me } from "@/lib/types";
import { addDays } from "@/lib/window";

/**
 * ป้ายตัวเลขงานค้างบนเมนู (เมนูด้านซ้าย / แถบบน / แถบล่าง) — ผู้ใช้ขอ 2026-11-12 (เฟส 3 ตามคลิปตัวอย่าง)
 *   นับแบบเดียวกับหน้าแรก (src/lib/home.ts) แต่ดึงเฉพาะที่ต้องใช้ (ช่วง 7 วันก่อน – 7 วันข้างหน้า) ให้เบาพอเรียกทุกไม่กี่นาที
 *   home  = slot ที่ยังไม่มี Mc / Admin ใน 7 วันข้างหน้า (ฝั่งที่มีสิทธิ์)
 *   proof = slot ที่จบแล้วใน 7 วันล่าสุด มี Mc (ไม่ใช่ Mc ประจำ / คิว Shopee) แต่ยังไม่แนบหลักฐาน
 *           Owner เห็นทุก slot · Admin เห็นเฉพาะ slot ที่ตัวเองเป็น Admin (เหมือนหน้าหลักฐานไลฟ์)
 *   equipment = คำขอยืมอุปกรณ์ที่รออนุมัติ
 *   0 = ไม่มีป้าย · อ่านไม่ได้ = ไม่มีป้ายนั้น (ไม่ทำให้เมนูพัง)
 */
type Row = { id: number; platform: string; live_date: string; starts_at: string; ends_at: string };
type McRow = Row & { mc_id: number | null; sheet_tab: string | null; person: { is_salaried: boolean | null } | null };
type AdminRow = Row & { admin_id: number | null };

const ms = (s: string) => Date.parse(s);
const keyOf = (r: Row) => `${r.platform}|${ms(r.starts_at)}|${ms(r.ends_at)}`;

export async function badgesFor(me: Me): Promise<Badges> {
  const db = createAdminClient();
  const out: Badges = {};
  const o = me.owner;
  const homeMc = !!o && o.see.mc, homeAdmin = !!o && o.see.admin;
  // หน้าหลักฐานไลฟ์: Owner ฝั่ง Mc / ติ๊กหลักฐานไลฟ์ = ทุก slot · Admin = slot ของตัวเอง
  const proofAll = !!o && (o.see.mc || o.see.proofs);
  const proofMine = !proofAll && me.admin ? me.admin.id : null;

  const jobs: Promise<void>[] = [];
  if (homeMc || homeAdmin || proofAll || proofMine) {
    jobs.push((async () => {
      const today = bkkToday(), now = Date.now();
      const from = addDays(today, -7), to = addDays(today, 6), weekAgo = addDays(today, -6);
      const base = "id, platform, live_date, starts_at, ends_at";
      const [mcRows, adminRows, proofs] = await Promise.all([
        fetchAll<McRow>((a, b) => db.from("mc_slots").select(`${base}, mc_id, sheet_tab, person:staff!mc_id(is_salaried)`)
          .eq("is_cancelled", false).gte("live_date", from).lte("live_date", to).order("id").range(a, b) as never),
        homeAdmin || proofMine
          ? fetchAll<AdminRow>((a, b) => db.from("admin_slots").select(`${base}, admin_id`)
            .eq("is_cancelled", false).gte("live_date", from).lte("live_date", to).order("id").range(a, b) as never)
          : Promise.resolve([] as AdminRow[]),
        proofAll || proofMine ? proofsBySlot(db, addDays(today, -8), today) : Promise.resolve(new Map<number, unknown>()),
      ]);
      const upcoming = (r: Row) => r.live_date >= today && r.live_date <= to && ms(r.ends_at) > now;
      if (homeMc || homeAdmin) {
        out.home = (homeMc ? mcRows.filter((r) => !r.mc_id && upcoming(r)).length : 0)
          + (homeAdmin ? adminRows.filter((r) => !r.admin_id && upcoming(r)).length : 0);
      }
      if (proofAll || proofMine) {
        const mine = proofMine ? new Set(adminRows.filter((r) => r.admin_id === proofMine).map(keyOf)) : null;
        out.proof = mcRows.filter((r) => r.mc_id && r.live_date >= weekAgo && ms(r.ends_at) <= now
          && !r.person?.is_salaried && r.sheet_tab !== "shopee" && !proofs.has(Number(r.id))
          && (!mine || mine.has(keyOf(r)))).length;
      }
    })().catch((err) => console.warn("นับป้ายงานค้าง (slot / หลักฐาน) ไม่สำเร็จ:", err)));
  }
  if (me.equipment) {
    jobs.push((async () => {
      const { count, error } = await db.from("equipment_loans").select("id", { count: "exact", head: true }).eq("status", "pending");
      if (!error) out.equipment = count ?? 0;
    })());
  }
  await Promise.all(jobs);
  return out;
}
