import "server-only";
import { assignCampaigns, instLabel } from "@/lib/campaign";
import { bkkToday, fetchAll, proofsBySlot } from "@/lib/data";
import { gmvCoverage } from "@/lib/gmv";
import { createAdminClient } from "@/lib/supabase/server";
import type { HomeData, HomeSlot } from "@/lib/types";
import { addDays } from "@/lib/window";

/**
 * หน้าแรกของเจ้าของ: งานที่ต้องทำ — ไลฟ์วันนี้ / slot ที่ยังไม่มีคน (7 วัน) / หลักฐาน + GMV ที่ค้าง (7 วัน)
 *   / แคมเปญถัดไป (30 วัน) / ข้อมูลที่ควรแก้ (ไม่มีอีเมลแต่มีคิว, เบอร์ซ้ำ) — เฉพาะฝั่งที่มีสิทธิ์
 */

type Row = {
  id: number; platform: string; live_date: string; start_time: string; end_time: string; starts_at: string; ends_at: string;
  confirmed: boolean | null;
};
type McRow = Row & { campaign: string | null; gmv: number | string | null; mc_id: number | null; person: { name: string; is_salaried: boolean | null } | null };
type AdminRow = Row & { admin_id: number | null; person: { name: string } | null };

const hm = (t: string) => t.slice(0, 5);
const ms = (s: string) => Date.parse(s);
const keyOf = (r: Row) => `${r.platform}|${ms(r.starts_at)}|${ms(r.ends_at)}`;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);

export async function ownerHome(scope: { mc: boolean; admin: boolean; proofs: boolean }): Promise<HomeData> {
  const db = createAdminClient();
  const today = bkkToday(), now = Date.now();
  const from = addDays(today, -14), to = addDays(today, 45);
  const base = "id, platform, live_date, start_time, end_time, starts_at, ends_at, confirmed";

  const [mcRows, adminRows, proofs, staff] = await Promise.all([
    fetchAll<McRow>((a, b) => db.from("mc_slots")
      .select(`${base}, campaign, gmv, mc_id, person:staff!mc_id(name, is_salaried)`)
      .eq("is_cancelled", false).gte("live_date", from).lte("live_date", to).order("starts_at").range(a, b) as never),
    fetchAll<AdminRow>((a, b) => db.from("admin_slots")
      .select(`${base}, admin_id, person:staff!admin_id(name)`)
      .eq("is_cancelled", false).gte("live_date", from).lte("live_date", to).order("starts_at").range(a, b) as never),
    proofsBySlot(db, addDays(today, -8), today),
    fetchAll<{ id: number; role: string; name: string; email: string | null; phone: string | null }>((a, b) =>
      db.from("staff").select("id, role, name, email, phone").order("id").range(a, b) as never),
  ]);

  const adminOf = new Map(adminRows.map((r) => [keyOf(r), r]));
  const mcOf = new Map(mcRows.map((r) => [keyOf(r), r]));
  const slot = (r: Row, mc: string | null, admin: string | null): HomeSlot => ({
    id: Number(r.id), date: r.live_date, platform: r.platform, start: hm(r.start_time), end: hm(r.end_time), mc, admin,
  });
  const mcName = (r: McRow) => (r.mc_id && r.person ? `Mc ${r.person.name}` : null);
  const adminName = (r: Row) => adminOf.get(keyOf(r))?.person?.name ?? null;
  const week = addDays(today, 6), weekAgo = addDays(today, -6);

  // GMV ของ slot ก่อนหน้าที่รวมอยู่ใน slot ถัดไปของ Mc คนเดียวกัน = ถือว่ากรอกแล้ว
  const assigned = mcRows.filter((r) => r.mc_id && r.confirmed !== false);
  const covered = gmvCoverage(assigned.map((r) => ({
    id: Number(r.id), platform: r.platform, startMs: ms(r.starts_at), endMs: ms(r.ends_at), gmv: r.gmv === null ? null : Number(r.gmv), who: r.mc_id,
  })));
  const hasGmv = (r: McRow) => r.gmv !== null || covered.has(Number(r.id));

  const out: HomeData = {
    today, scope, live: [], noMc: [], noAdmin: [], missingProof: [], missingGmv: [], campaigns: [],
    issues: { noEmail: [], noEmailTotal: 0, samePhone: [] },
  };

  if (scope.mc || scope.proofs) {
    const yesterday = addDays(today, -1);
    for (const r of mcRows) {
      if (!(r.live_date === today || (r.live_date === yesterday && ms(r.ends_at) > now))) continue;
      const s0 = ms(r.starts_at), s1 = ms(r.ends_at);
      out.live.push({
        ...slot(r, mcName(r), adminName(r)),
        status: s1 <= now ? "done" : s0 <= now ? "live" : "next",
        proof: proofs.has(Number(r.id)), noProof: !!r.person?.is_salaried, gmv: hasGmv(r),
      });
    }
    // หลักฐานค้าง: slot ที่จบแล้วใน 7 วันล่าสุด มี Mc (ไม่ใช่ Mc ประจำ) แต่ยังไม่แนบรูป
    for (const r of assigned) {
      if (r.live_date < weekAgo || ms(r.ends_at) > now || r.person?.is_salaried || proofs.has(Number(r.id))) continue;
      out.missingProof.push(slot(r, mcName(r), adminName(r)));
    }
  }

  if (scope.mc) {
    for (const r of mcRows) {
      if (!r.mc_id && r.live_date >= today && r.live_date <= week && ms(r.ends_at) > now) out.noMc.push(slot(r, null, adminName(r)));
    }
    for (const r of assigned) {
      if (r.live_date < weekAgo || ms(r.ends_at) > now || hasGmv(r)) continue;
      out.missingGmv.push(slot(r, mcName(r), adminName(r)));
    }
    // แคมเปญ: กำลังดำเนินอยู่ + เริ่มภายใน 30 วัน
    const camps = assignCampaigns(mcRows.map((r) => ({ id: Number(r.id), date: r.live_date, campaign: r.campaign })));
    const byKey = new Map<string, HomeData["campaigns"][number]>();
    for (const r of mcRows) {
      const c = camps.get(Number(r.id));
      if (!c || c.end < today || c.start > addDays(today, 30)) continue;
      const x = byKey.get(c.key) ?? {
        key: c.key, label: instLabel(c), start: c.start, end: c.end, status: c.start <= today ? "live" as const : "upcoming" as const,
        daysUntil: Math.max(0, dayDiff(today, c.start)), slots: 0, noMc: 0,
      };
      x.slots++;
      if (!r.mc_id && r.live_date >= today) x.noMc++;
      byKey.set(c.key, x);
    }
    out.campaigns = [...byKey.values()].sort((a, b) => a.start.localeCompare(b.start));
  }

  if (scope.admin) {
    for (const r of adminRows) {
      // ยังไม่มี Admin: ทั้งแบบเปิดให้ Admin เสริมจอง (needs_extra_admin) และแบบที่เจ้าของต้องใส่เอง
      if (r.admin_id || r.live_date < today || r.live_date > week || ms(r.ends_at) <= now) continue;
      const m = mcOf.get(keyOf(r));
      out.noAdmin.push(slot(r, m ? mcName(m) : null, null));
    }
  }

  // ข้อมูลที่ควรแก้ (เฉพาะฝั่งที่มีสิทธิ์)
  const roles = new Set<string>([...(scope.mc ? ["mc"] : []), ...(scope.admin ? ["admin"] : [])]);
  const upcoming = new Map<string, number>();
  for (const r of mcRows) if (r.mc_id && r.live_date >= today) upcoming.set(`mc|${r.mc_id}`, (upcoming.get(`mc|${r.mc_id}`) ?? 0) + 1);
  for (const r of adminRows) if (r.admin_id && r.live_date >= today) upcoming.set(`admin|${r.admin_id}`, (upcoming.get(`admin|${r.admin_id}`) ?? 0) + 1);
  const phones = new Map<string, { role: "mc" | "admin"; phone: string; names: string[] }>();
  for (const p of staff) {
    if (!roles.has(p.role)) continue;
    const role = p.role as "mc" | "admin";
    const label = role === "mc" ? `Mc ${p.name}` : p.name;
    if (!p.email?.trim()) {
      out.issues.noEmailTotal++;
      const n = upcoming.get(`${role}|${p.id}`) ?? 0;
      if (n) out.issues.noEmail.push({ role, name: label, upcoming: n });
    }
    const digits = String(p.phone ?? "").replace(/\D/g, "");
    if (digits.length >= 9) {
      const g = phones.get(`${role}|${digits}`) ?? { role, phone: String(p.phone).trim(), names: [] };
      g.names.push(label);
      phones.set(`${role}|${digits}`, g);
    }
  }
  out.issues.noEmail.sort((a, b) => b.upcoming - a.upcoming);
  out.issues.samePhone = [...phones.values()].filter((g) => g.names.length > 1);
  return out;
}
