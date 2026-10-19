import "server-only";
import { missingCalendarCounts } from "@/lib/calendar";
import { bkkToday, fetchAll } from "@/lib/data";
import { platformLabel } from "@/lib/platform";
import { checkInOf } from "@/lib/pay";
import { samePersonOverlaps } from "@/lib/staff-check";
import { createAdminClient } from "@/lib/supabase/server";
import type { HealthIssues } from "@/lib/types";
import { addDays } from "@/lib/window";

/**
 * ตรวจสุขภาพข้อมูล (ส่วน "ข้อมูลที่ควรแก้" ในหน้าแรกของเจ้าของ) — เฉพาะฝั่งที่มีสิทธิ์
 *   ช่วงที่ตรวจ: ต้นเดือนนี้ (ค่าจ้างเดือนนี้) ถึง 60 วันข้างหน้า
 *   overlap  = คนละคนอยู่ slot ช่องเดียวกันเวลาทับกัน (มักเป็นแถวซ้ำในชีต) -> ชั่วโมง / ค่าจ้างนับทั้งคู่
 *   selfOverlap = คนเดียวกันอยู่ 2 slot เวลาทับกัน (ไลฟ์พร้อมกันไม่ได้) -> ชั่วโมง / ค่าจ้างนับทุก slot
 *   badCheckIn  = หมายเหตุ "เข้า ..." อ่านเวลาไม่ได้ / อยู่นอกช่วง slot -> ระบบจ่ายเต็ม slot
 *   dupRows  = slot ข้างหน้าที่มีแถวซ้ำ (ช่อง + เวลาเดียวกัน) มีแถวว่างปน หรือคนเดิมซ้ำ -> หน้าแรกนับว่ายังไม่มีคน / ชั่วโมงซ้ำ
 *   noPair   = slot ข้างหน้าที่มีแถวแค่ฝั่งเดียว (แท็บ Deal Mc กับ Admin เสริมไม่ตรงกัน)
 *   notFirm  = ไลฟ์ไปแล้วเดือนนี้แต่สถานะยัง "ไม่เฟิร์ม" ทั้งที่มีคน -> ระบบนับชั่วโมง / ค่าจ้างให้แล้ว
 *   noRate   = มีคิวเดือนนี้แต่ไม่ได้ตั้งค่าจ้าง (ค่าเริ่มต้นก็ไม่มี) และไม่ใช่พนักงานประจำ -> ยอดเงิน 0
 *   noPhone  = มีคิวข้างหน้าแต่ไม่มีเบอร์ (คู่ไลฟ์ติดต่อไม่ได้)
 *   calendar = คิวข้างหน้าที่ยังไม่ขึ้นปฏิทิน (ส่วนใหญ่ = ยังไม่แชร์ปฏิทินให้บัญชีระบบ)
 */

type Role = "mc" | "admin";
type Row = {
  id: number; platform: string; live_date: string; start_time: string; end_time: string; starts_at: string; ends_at: string;
  status: string | null; confirmed: boolean | null; is_cancelled: boolean; pid: number | null; remark: string | null;
};
type Person = { id: number; role: string; name: string; phone: string | null; hourly_rate: number | string | null; is_salaried: boolean | null };

const NOT_FIRM = /ไม่\s*เ?ฟิ?ร์ม|not\s*firm/i;
const hm = (t: string) => t.slice(0, 5);
const ms = (s: string) => Date.parse(s);
const timeOf = (r: Row) => `${hm(r.start_time)}–${hm(r.end_time)}`;
const keyOf = (r: Row) => `${r.platform}|${ms(r.starts_at)}|${ms(r.ends_at)}`;
const counted = (r: Row) => !r.is_cancelled && r.confirmed !== false;

export async function dataHealth(scope: { mc: boolean; admin: boolean }): Promise<HealthIssues> {
  const db = createAdminClient();
  const today = bkkToday(), now = Date.now();
  const month = today.slice(0, 7), monthStart = `${month}-01`, to = addDays(today, 60);
  const cols = "id, platform, live_date, start_time, end_time, starts_at, ends_at, status, confirmed, is_cancelled, remark";
  const load = (table: "mc_slots" | "admin_slots", col: string) => fetchAll<Row>((a, b) => db.from(table)
    .select(`${cols}, pid:${col}`).gte("live_date", monthStart).lte("live_date", to).order("id").range(a, b) as never);
  const [mcRows, adminRows, staff, settings, noCal] = await Promise.all([
    load("mc_slots", "mc_id"),
    load("admin_slots", "admin_id"),
    fetchAll<Person>((a, b) => db.from("staff").select("id, role, name, phone, hourly_rate, is_salaried").in("role", ["mc", "admin"]).order("id").range(a, b) as never),
    db.from("settings").select("default_mc_rate, default_admin_rate").eq("id", 1).single(),
    missingCalendarCounts().catch(() => new Map<number, number>()),
  ]);
  const byId = new Map(staff.map((p) => [`${p.role}|${p.id}`, p]));
  const nameOf = (role: Role, id: number | null) => {
    const p = id ? byId.get(`${role}|${id}`) : null;
    return p ? (role === "mc" ? `Mc ${p.name}` : p.name) : "–";
  };
  const rowsOf: Record<Role, Row[]> = { mc: mcRows, admin: adminRows };
  const roles = (["mc", "admin"] as const).filter((r) => scope[r]);
  const out: HealthIssues = { overlap: [], selfOverlap: [], badCheckIn: [], dupRows: [], noPair: [], notFirm: [], noRate: [], noPhone: [], calendar: [] };

  for (const role of roles) {
    const rows = rowsOf[role].filter(counted);
    // คนละคน ช่องเดียวกัน เวลาทับกัน
    const withPerson = rows.filter((r) => r.pid).sort((a, b) => a.platform.localeCompare(b.platform) || ms(a.starts_at) - ms(b.starts_at));
    const used = new Set<number>();
    for (let i = 0; i < withPerson.length; i++) {
      const a = withPerson[i];
      if (used.has(a.id)) continue;
      const group = [a];
      for (let j = i + 1; j < withPerson.length; j++) {
        const b = withPerson[j];
        if (b.platform !== a.platform || ms(b.starts_at) >= ms(a.ends_at)) break;
        if (b.pid !== a.pid && !used.has(b.id)) group.push(b);
      }
      if (group.length < 2) continue;
      group.forEach((g) => used.add(g.id));
      out.overlap.push({ role, date: a.live_date, platform: platformLabel(a.platform), time: timeOf(a), names: group.map((g) => nameOf(role, g.pid)) });
    }
    // คนเดียวกัน 2 slot เวลาทับกัน (คนละช่อง / ช่องเดียวกันคนละเวลา) — แถวซ้ำเวลาเดียวกันเป๊ะไปอยู่ใน dupRows
    const spans = rows.map((r) => ({ ...r, startMs: ms(r.starts_at), endMs: ms(r.ends_at) }));
    for (const g of samePersonOverlaps(spans)) {
      out.selfOverlap.push({
        role, date: g[0].live_date, name: nameOf(role, g[0].pid),
        slots: g.map((r) => `${platformLabel(r.platform)} ${timeOf(r)}`),
      });
    }
    // หมายเหตุ "เข้า ..." ที่ใช้ไม่ได้ (ระบบจ่ายเต็ม slot) — เฉพาะ slot ที่มีคน
    for (const r of rows) {
      const c = r.pid ? checkInOf(r.remark, ms(r.starts_at), ms(r.ends_at)) : null;
      if (c?.bad) {
        out.badCheckIn!.push({
          role, date: r.live_date, platform: platformLabel(r.platform), time: timeOf(r), name: nameOf(role, r.pid), text: c.time, reason: c.reason,
        });
      }
    }
    // แถวซ้ำข้างหน้า (ที่ไม่ใช่กรณีคนละคนข้างบน)
    const groups = new Map<string, Row[]>();
    for (const r of rows) if (r.live_date >= today) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
    for (const g of groups.values()) {
      const people = g.filter((r) => r.pid);
      // ทุกแถวมีคน และรายงานเป็น "คนละคนซ้อนกัน" ไปแล้ว = ไม่ต้องซ้ำ
      const reported = people.length === g.length && people.every((r) => used.has(r.id));
      if (g.length < 2 || reported) continue;
      out.dupRows.push({
        role, date: g[0].live_date, platform: platformLabel(g[0].platform), time: timeOf(g[0]), rows: g.length,
        note: people.length && new Set(people.map((r) => r.pid)).size < people.length ? `${nameOf(role, people[0].pid)} ซ้ำ ${people.length} แถว` : `แถวว่าง ${g.length - people.length} แถว`,
      });
    }
    // ไลฟ์ไปแล้วเดือนนี้ สถานะยัง "ไม่เฟิร์ม"
    for (const r of rows) {
      if (!r.pid || ms(r.ends_at) > now || !NOT_FIRM.test(r.status ?? "")) continue;
      out.notFirm.push({ role, date: r.live_date, platform: platformLabel(r.platform), time: timeOf(r), name: nameOf(role, r.pid) });
    }
    // ค่าจ้าง / เบอร์โทร
    const defaultRate = Number(role === "mc" ? settings.data?.default_mc_rate : settings.data?.default_admin_rate) || 0;
    const monthSlots = new Map<number, number>(), upcoming = new Map<number, number>();
    for (const r of rows) {
      if (!r.pid) continue;
      if (r.live_date.startsWith(month)) monthSlots.set(r.pid, (monthSlots.get(r.pid) ?? 0) + 1);
      if (ms(r.ends_at) > now) upcoming.set(r.pid, (upcoming.get(r.pid) ?? 0) + 1);
    }
    for (const [id, n] of monthSlots) {
      const p = byId.get(`${role}|${id}`);
      if (p && !p.is_salaried && !(Number(p.hourly_rate) > 0) && !defaultRate) out.noRate.push({ role, name: nameOf(role, id), slots: n });
    }
    for (const [id, n] of upcoming) {
      const p = byId.get(`${role}|${id}`);
      if (p && String(p.phone ?? "").replace(/\D/g, "").length < 9) out.noPhone.push({ role, name: nameOf(role, id), upcoming: n });
    }
    // ปฏิทิน (missingCalendarCounts นับตาม id ของ staff ซึ่งไม่ซ้ำกันข้ามบทบาท)
    for (const p of staff) {
      const n = p.role === role ? noCal.get(p.id) : 0;
      if (n) out.calendar.push({ role, name: nameOf(role, p.id), count: n });
    }
  }

  // แถวฝั่งเดียว (ข้างหน้า): ต้องเห็นทั้งสองฝั่งถึงจะรู้
  if (scope.mc && scope.admin) {
    const live = (rs: Row[]) => rs.filter((r) => !r.is_cancelled && r.live_date >= today && ms(r.ends_at) > now);
    const mk = new Set(mcRows.filter((r) => !r.is_cancelled).map(keyOf)), ak = new Set(adminRows.filter((r) => !r.is_cancelled).map(keyOf));
    for (const r of live(mcRows)) if (!ak.has(keyOf(r))) out.noPair.push({ missing: "admin", date: r.live_date, platform: platformLabel(r.platform), time: timeOf(r) });
    for (const r of live(adminRows)) if (!mk.has(keyOf(r))) out.noPair.push({ missing: "mc", date: r.live_date, platform: platformLabel(r.platform), time: timeOf(r) });
  }

  const byDate = <T extends { date: string; time: string }>(a: T, b: T) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
  out.overlap.sort(byDate);
  out.selfOverlap.sort((a, b) => a.date.localeCompare(b.date) || a.slots[0].localeCompare(b.slots[0]));
  out.dupRows.sort(byDate);
  out.noPair.sort(byDate);
  out.notFirm.sort(byDate);
  out.noRate.sort((a, b) => b.slots - a.slots);
  out.noPhone.sort((a, b) => b.upcoming - a.upcoming);
  out.calendar.sort((a, b) => b.count - a.count);
  return out;
}

/** จำนวนเรื่องที่ควรแก้ทั้งหมด */
export const healthCount = (h: HealthIssues) =>
  h.overlap.length + (h.selfOverlap?.length ?? 0) + (h.badCheckIn?.length ?? 0) + h.dupRows.length + h.noPair.length + h.notFirm.length + h.noRate.length + h.noPhone.length + h.calendar.length;
