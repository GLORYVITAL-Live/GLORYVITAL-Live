import "server-only";
import { after } from "next/server";
import { rankReport } from "@/lib/campaign-report";
import { bkkToday, fetchAll, type Settings } from "@/lib/data";
import { liveTeamOf } from "@/lib/live-team";
import { autoQuota, prevMonth, QUOTA_NEW, settleDate, totalQuota, type MyQuota, type QuotaReport, type QuotaRow } from "@/lib/mc-quota";
import { rankCells, type Tier } from "@/lib/mc-rank";
import { isTestAccount } from "@/lib/staff-check";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

/**
 * สิทธิ์จองคิวของ Mc ต่อเดือน (ตาราง mc_quota — SQL 20261107000000_mc_quota) สูตรอยู่ที่ src/lib/mc-quota.ts
 *   แร็งค์ = อันดับ Mc ของเดือนก่อน (เดือนที่เลือก · นับ slot CEO ตามค่าเริ่มต้นของหน้าอันดับ)
 *   คำนวณครั้งแรกตอนมีคนต้องใช้ แล้วอัปเดตเองทุก 1 ชม. จนเดือนก่อนจบ + 3 วัน (ล็อก) · Owner กด "คำนวณใหม่" ได้ (สิทธิ์เพิ่มพิเศษไม่หาย)
 *   ใช้ได้ = Mc ที่มีอีเมล ไม่ใช่ Mc ประจำ ไม่ใช่ทีม Shopee (ทีม Shopee ยังจองคิว TikTok ไม่ได้)
 */

type Db = ReturnType<typeof createAdminClient>;
export const QUOTA_SQL = "ต้องรัน SQL 20261107000000_mc_quota ใน Supabase ก่อน";
const noQuotaSql = (msg: string) => /mc_quota|can_manage_quota|p_month_max|schema cache|does not exist/i.test(msg);
const REFRESH_MS = 3600_000;

type DbRow = {
  month: string; staff_id: number; tier: Tier | null; score: number | string | null; hours: number | string; auto_quota: number;
  extra: number; note: string; computed_at: string; updated_by: string | null; updated_at: string;
};
type McStaff = { id: number; name: string; email: string | null; is_salaried?: boolean; live_platform?: string | null };

export const quotaOn = (s: Settings) => s.mc_quota_on === true;
const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/** Mc ที่ใช้สิทธิ์จอง (มีอีเมล ไม่ใช่ Mc ประจำ ไม่ใช่ทีม Shopee ไม่ใช่บัญชีทดสอบ) */
const eligible = (s: McStaff) => !!s.email && !s.is_salaried && liveTeamOf(s.live_platform) !== "shopee" && !isTestAccount(s.name);

async function mcStaff(db: Db) {
  const { data, error } = await db.from("staff").select("*").eq("role", "mc");
  if (error) throw new Error(error.message);
  return (data ?? []) as McStaff[];
}

/** คำนวณแร็งค์ + สิทธิ์อัตโนมัติของเดือนนี้ใหม่ จากผลงานเดือนก่อน (สิทธิ์เพิ่มพิเศษ / หมายเหตุ ไม่แตะ) */
export async function computeMonth(month: string) {
  const db = createAdminClient();
  const [report, staff] = await Promise.all([rankReport("month", prevMonth(month)), mcStaff(db)]);
  const ranks = new Map(rankCells(report.cells).map((r) => [r.name, r]));
  const now = new Date().toISOString();
  const rows = staff.filter(eligible).map((s) => {
    const r = ranks.get(`Mc ${s.name}`);
    const ranked = !!r?.ranked && r.score !== null;
    const tier = ranked ? r!.tier : null, score = ranked ? r!.score : null;
    return {
      month, staff_id: s.id, tier, score: score === null ? null : Math.round(score * 10000) / 10000,
      hours: Math.round((r?.hours ?? 0) * 100) / 100, auto_quota: autoQuota(tier, score), computed_at: now,
    };
  });
  if (!rows.length) return;
  const { error } = await db.from("mc_quota").upsert(rows, { onConflict: "month,staff_id" });
  if (error) throw new Error(noQuotaSql(error.message) ? QUOTA_SQL : error.message);
}

// คำนวณซ้อนกันในเครื่องเดียวกันไม่ได้ (เปิดหน้าจองพร้อมกันหลายคน)
const running = new Map<string, Promise<void>>();
function refresh(month: string) {
  const cur = running.get(month);
  if (cur) return cur;
  const p = computeMonth(month).finally(() => running.delete(month));
  running.set(month, p);
  return p;
}

/**
 * แถวสิทธิ์ของเดือนนี้ (ยังไม่มี = คำนวณก่อน · เก่าเกิน 1 ชม. ระหว่างที่แร็งค์ยังไม่ล็อก = ใช้ค่าเดิมแล้วคำนวณใหม่หลังตอบ)
 *   แร็งค์ล็อกแล้วแต่ค่าที่มีคำนวณก่อนล็อก = คำนวณใหม่อีกครั้ง (ผลงานเดือนก่อนครบแล้ว)
 */
async function monthRows(db: Db, month: string): Promise<DbRow[]> {
  const read = async () => {
    const { data, error } = await db.from("mc_quota").select("*").eq("month", month);
    if (error) throw new Error(noQuotaSql(error.message) ? QUOTA_SQL : error.message);
    return (data ?? []) as DbRow[];
  };
  let rows = await read();
  if (!rows.length) {
    await refresh(month);
    return read();
  }
  const oldest = Math.min(...rows.map((r) => Date.parse(r.computed_at)));
  const settle = settleDate(month);
  const stale = bkkToday() >= settle
    ? oldest < Date.parse(`${settle}T00:00:00+07:00`)
    : Date.now() - oldest > REFRESH_MS;
  if (stale) {
    try {
      after(() => refresh(month).catch((err) => console.warn("คำนวณสิทธิ์จองไม่สำเร็จ:", (err as Error).message)));
    } catch {
      await refresh(month);
      rows = await read();
    }
  }
  return rows;
}

/** จำนวนคิวของ Mc ในเดือนนี้ (ไม่นับที่ยกเลิก / ปฏิเสธ — นับเหมือนฐานข้อมูลตอนจอง) Map<staff_id, จำนวน> */
async function monthUsage(db: Db, month: string, mcId?: number) {
  type Row = { mc_id: number };
  const rows = await fetchAll<Row>((from, to) => {
    let q = db.from("mc_slots").select("mc_id").not("mc_id", "is", null).eq("is_cancelled", false)
      .or("confirmed.is.null,confirmed.eq.true").gte("live_date", `${month}-01`).lte("live_date", lastDayOf(month));
    if (mcId) q = q.eq("mc_id", mcId);
    return q.order("id").range(from, to);
  });
  const out = new Map<number, number>();
  for (const r of rows) out.set(Number(r.mc_id), (out.get(Number(r.mc_id)) ?? 0) + 1);
  return out;
}

/** ตั้งสิทธิ์เพิ่ม / คำนวณใหม่ / เปิดปิดได้: Owner ที่จัดการได้ทั้ง Mc + Admin หรือติ๊ก "กำหนดสิทธิ์จอง Mc" */
export async function canEditQuota(me: Me) {
  if (!me.owner) return false;
  if (me.owner.mc && me.owner.admin) return true;
  const { data, error } = await createAdminClient().from("staff").select("can_manage_quota").eq("id", me.owner.id).maybeSingle();
  return !error && data?.can_manage_quota === true;
}

/** หน้าเจ้าของ > ผลงาน Mc > สิทธิ์จอง */
export async function quotaReport(month: string, settings: Settings, canEdit: boolean): Promise<QuotaReport> {
  const db = createAdminClient();
  const [rows, staff, used] = await Promise.all([monthRows(db, month), mcStaff(db), monthUsage(db, month)]);
  const byId = new Map(rows.map((r) => [Number(r.staff_id), r]));
  const list: QuotaRow[] = staff.filter(eligible).map((s) => {
    const r = byId.get(s.id);
    const auto = r?.auto_quota ?? QUOTA_NEW, extra = r?.extra ?? 0;
    return {
      staffId: s.id, name: `Mc ${s.name}`, tier: r?.tier ?? null, score: r?.score == null ? null : Number(r.score), hours: Number(r?.hours ?? 0),
      auto, extra, total: totalQuota(auto, extra), used: used.get(s.id) ?? 0, note: r?.note ?? "",
      updatedBy: r?.updated_by ?? null, updatedAt: r?.updated_by ? r.updated_at : null,
    };
  });
  list.sort((a, b) => b.total - a.total || (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, "th"));
  const computed = rows.map((r) => r.computed_at).sort();
  return {
    month, source: prevMonth(month), settled: bkkToday() >= settleDate(month), settleDate: settleDate(month),
    computedAt: computed[computed.length - 1] ?? null, on: quotaOn(settings), canEdit, rows: list,
  };
}

/**
 * สิทธิ์ของ Mc คนนี้ในเดือนที่ระบุ (หน้าจอง / ตอนจอง)
 *   ปิดการจำกัดสิทธิ์ / Mc ประจำ / ทีม Shopee = null (ไม่จำกัด)
 */
export async function myQuotas(settings: Settings, mcId: number, months: string[]): Promise<MyQuota[] | null> {
  if (!quotaOn(settings) || !months.length) return null;
  const db = createAdminClient();
  const { data: me } = await db.from("staff").select("*").eq("id", mcId).maybeSingle();
  if (!me || !eligible(me as McStaff)) return null;
  return Promise.all([...new Set(months)].sort().map(async (month) => {
    const [rows, used] = await Promise.all([monthRows(db, month), monthUsage(db, month, mcId)]);
    const r = rows.find((x) => Number(x.staff_id) === mcId);
    return {
      month, max: totalQuota(r?.auto_quota ?? QUOTA_NEW, r?.extra ?? 0), used: used.get(mcId) ?? 0,
      tier: r?.tier ?? null, settled: bkkToday() >= settleDate(month),
    };
  }));
}

/** ตั้งสิทธิ์เพิ่มพิเศษ + หมายเหตุ (ยังไม่มีแถว = สร้างด้วยสิทธิ์อัตโนมัติของคนยังไม่มีอันดับ) คืนค่าเดิมไว้บันทึกประวัติ */
export async function setQuotaExtra(month: string, staffId: number, extra: number, note: string, by: string) {
  const db = createAdminClient();
  await monthRows(db, month);
  const { data: cur, error: curErr } = await db.from("mc_quota").select("*").eq("month", month).eq("staff_id", staffId).maybeSingle();
  if (curErr) throw new Error(noQuotaSql(curErr.message) ? QUOTA_SQL : curErr.message);
  const before = cur as DbRow | null;
  const { error } = await db.from("mc_quota").upsert({
    month, staff_id: staffId, auto_quota: before?.auto_quota ?? QUOTA_NEW, extra, note, updated_by: by, updated_at: new Date().toISOString(),
  }, { onConflict: "month,staff_id" });
  if (error) throw new Error(noQuotaSql(error.message) ? QUOTA_SQL : error.message);
  return { auto: before?.auto_quota ?? QUOTA_NEW, extra: before?.extra ?? 0, note: before?.note ?? "" };
}
