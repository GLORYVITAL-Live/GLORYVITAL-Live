import "server-only";
import { bonusPaidMinutes, cleanTiers, lateCut, monthRate, slotPaidHours } from "@/lib/pay";
import { createAdminClient } from "@/lib/supabase/server";
import { bookRange, cleanWindow, windowNotice } from "@/lib/window";
import type { MyItem, OpenSlot, OwnerDetail, OwnerPerson, OwnerSummary } from "@/lib/types";

type Db = ReturnType<typeof createAdminClient>;

export type Settings = {
  site_notice: string;
  schedule_cutoff_month: string | null;
  schedule_notice: string;
  admin_chat_url: string;
  default_mc_rate: number;
  default_admin_rate: number;
  cancel_min_hours: number;
  max_per_request: number;
  rules_mc?: string | null; // กฎการทำงาน ส่วน "อื่นๆ" (null = ข้อความเริ่มต้น)
  rules_admin?: string | null;
  book_window_mc?: unknown; // ช่วงเปิดจอง (src/lib/window.ts) null = ไม่จำกัดเพิ่ม
  book_window_admin?: unknown;
};

type SlotRow = {
  id: number;
  platform: string;
  live_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  ends_at: string;
  confirmed: boolean | null;
  status: string;
  is_cancelled: boolean;
  late_minutes: number | null;
  bonus_minutes: number | null;
};

const SLOT_COLS = "id, platform, live_date, start_time, end_time, starts_at, ends_at, confirmed, status, is_cancelled, late_minutes, bonus_minutes";

/** PostgREST คืนได้ครั้งละ 1000 แถว อ่านทีละหน้าจนหมด */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const hm = (t: string) => t.slice(0, 5);
const ms = (ts: string) => Date.parse(ts);
const hoursOf = (r: SlotRow) => (ms(r.ends_at) - ms(r.starts_at)) / 3600_000;
/** key จับคู่ slot ข้ามตาราง Mc <-> Admin (platform + เวลาเริ่ม + เวลาจบ) */
const slotKey = (r: Pick<SlotRow, "platform" | "starts_at" | "ends_at">) =>
  `${r.platform}|${ms(r.starts_at)}|${ms(r.ends_at)}`;
const isActive = (r: SlotRow) => r.confirmed !== false && !r.is_cancelled;

export function bkkToday() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export async function getSettings(db: Db = createAdminClient()): Promise<Settings> {
  const { data, error } = await db.from("settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data as Settings;
}

export function cutoffDate(s: Settings) {
  if (!s.schedule_cutoff_month) return null;
  const [y, m] = s.schedule_cutoff_month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export const bookWindow = (s: Settings, role: "mc" | "admin") =>
  cleanWindow(role === "mc" ? s.book_window_mc : s.book_window_admin);

/** ช่วงวันที่ฝั่งนี้จองได้ตอนนี้ (ช่วงเปิดจอง + วันนี้ + เดือนสุดท้ายที่เปิดจอง) */
export const bookingRange = (s: Settings, role: "mc" | "admin") => bookRange(bookWindow(s, role), bkkToday(), cutoffDate(s));

/** ข้อความแจ้งบนหน้าจอง: ตั้งช่วงเปิดจองไว้ = บอกช่วงนั้น / ไม่ได้ตั้ง = "เปิดจองถึงสิ้นเดือน ..." */
export function scheduleNotice(s: Settings, role: "mc" | "admin") {
  const w = bookWindow(s, role);
  if (w) return windowNotice(w, bookingRange(s, role));
  if (!s.schedule_cutoff_month) return "";
  if (s.schedule_notice) return s.schedule_notice;
  const [y, m] = s.schedule_cutoff_month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)));
  return `เปิดจองถึงสิ้นเดือน ${label} เท่านั้น ตารางเดือนถัดไปรออัพเดท`;
}

function toOpenSlot(r: SlotRow): OpenSlot {
  return {
    id: r.id, platform: r.platform, date: r.live_date,
    start: hm(r.start_time), end: hm(r.end_time), startMs: ms(r.starts_at), endMs: ms(r.ends_at),
  };
}

/** slot ของ Mc ที่ยังว่าง เฉพาะในช่วงที่เปิดจอง */
export async function openMcSlots(settings: Settings) {
  const db = createAdminClient();
  const r = bookingRange(settings, "mc");
  if (r.empty) return [];
  const rows = await fetchAll<SlotRow>((from, to) => {
    let q = db.from("mc_slots").select(SLOT_COLS).is("mc_id", null).gte("live_date", r.from);
    if (r.to) q = q.lte("live_date", r.to);
    return q.order("starts_at").range(from, to);
  });
  return rows.map(toOpenSlot);
}

/** slot ที่รอ Admin เสริม (เฉพาะในช่วงที่เปิดจอง) + ชื่อ Mc ที่ไลฟ์ใน slot นั้น */
export async function openAdminSlots(settings: Settings) {
  const db = createAdminClient();
  const r = bookingRange(settings, "admin");
  if (r.empty) return [];
  const rows = await fetchAll<SlotRow>((from, to) => {
    let q = db.from("admin_slots").select(SLOT_COLS).is("admin_id", null).eq("needs_extra_admin", true).gte("live_date", r.from);
    if (r.to) q = q.lte("live_date", r.to);
    return q.order("starts_at").range(from, to);
  });
  if (!rows.length) return [];

  const pairs = await pairMap("mc_slots", rows[0].live_date, rows[rows.length - 1].live_date);
  return rows.map((r) => {
    const mc = pairs.get(slotKey(r));
    return { ...toOpenSlot(r), pairName: mc ? `Mc ${mc.name}` : "" };
  });
}

/** { slotKey: { name, phone } } ของอีกฝั่งในช่วงวันที่ (เฉพาะคิวที่ยังไม่ยกเลิก) */
async function pairMap(table: "mc_slots" | "admin_slots", firstDate: string, lastDate: string) {
  const db = createAdminClient();
  const personCol = table === "mc_slots" ? "mc_id" : "admin_id";
  type Row = SlotRow & { person: { name: string; phone: string | null } | null };
  const rows = await fetchAll<Row>((from, to) =>
    db.from(table)
      .select(`${SLOT_COLS}, person:staff!${personCol}(name, phone)`)
      .not(personCol, "is", null)
      .gte("live_date", firstDate)
      // เผื่อ slot ข้ามเที่ยงคืนที่ไปตรงกับวันถัดไป
      .lte("live_date", lastDate)
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
  );
  const map = new Map<string, { name: string; phone: string }>();
  for (const r of rows) {
    if (r.person && isActive(r)) map.set(slotKey(r), { name: r.person.name, phone: r.person.phone ?? "" });
  }
  return map;
}

/** คิวของฉันในเดือนที่เลือก (ไม่นับแถวที่ confirmed = false) */
export async function mySlots(role: "mc" | "admin", personId: number, first: string, last: string): Promise<MyItem[]> {
  const db = createAdminClient();
  const table = role === "mc" ? "mc_slots" : "admin_slots";
  const personCol = role === "mc" ? "mc_id" : "admin_id";
  const rows = await fetchAll<SlotRow>((from, to) =>
    db.from(table).select(SLOT_COLS).eq(personCol, personId)
      .gte("live_date", first).lte("live_date", last)
      .or("confirmed.is.null,confirmed.eq.true")
      .order("starts_at").range(from, to),
  );
  const pairs = await pairMap(role === "mc" ? "admin_slots" : "mc_slots", first, last);
  return rows.map((r) => {
    const p = pairs.get(slotKey(r));
    return {
      ...toOpenSlot(r),
      hours: hoursOf(r),
      status: r.status,
      cancelled: r.is_cancelled,
      lateMinutes: r.late_minutes ?? null,
      bonusMinutes: r.bonus_minutes ?? null,
      pairName: p ? (role === "admin" ? `Mc ${p.name}` : p.name) : "",
      pairPhone: p?.phone ?? "",
    };
  });
}

/** สรุปรายเดือนสำหรับเจ้าของ (ชั่วโมง/slot/วัน/ค่าจ้าง ของ Mc และ Admin) */
export async function ownerSummary(key: string, first: string, last: string): Promise<Omit<OwnerSummary, "scope">> {
  const db = createAdminClient();
  const settings = await getSettings(db);
  type Person = { name: string; hourly_rate: number | null; commit_tiers: unknown };
  type Row = SlotRow & { person: Person | null };

  const load = (table: "mc_slots" | "admin_slots", personCol: string) =>
    fetchAll<Row>((from, to) =>
      db.from(table)
        .select(`${SLOT_COLS}, person:staff!${personCol}(name, hourly_rate, commit_tiers)`)
        .not(personCol, "is", null)
        .gte("live_date", first).lte("live_date", last)
        .or("confirmed.is.null,confirmed.eq.true")
        .order("starts_at").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
    );
  const [mcRows, adminRows] = await Promise.all([load("mc_slots", "mc_id"), load("admin_slots", "admin_id")]);

  const rates: OwnerSummary["rates"] = {
    mc: {}, admin: {}, defaultMc: Number(settings.default_mc_rate) || 0, defaultAdmin: Number(settings.default_admin_rate) || 0,
  };
  const details: (OwnerDetail & { key: string })[] = [];
  const persons = new Map<string, Person>(); // "Mc|ชื่อ" -> ข้อมูลค่าจ้างของคนนั้น
  const collect = (rows: Row[], type: "Mc" | "Admin") => {
    for (const r of rows) {
      if (!r.person) continue;
      const name = type === "Mc" ? `Mc ${r.person.name}` : r.person.name;
      persons.set(`${type}|${name}`, r.person);
      details.push({
        type, name, date: r.live_date, start: hm(r.start_time), end: hm(r.end_time), platform: r.platform,
        hours: hoursOf(r), startMs: ms(r.starts_at), status: r.status, cancelled: r.is_cancelled, pair: "", key: slotKey(r),
        lateMinutes: r.late_minutes ?? null,
        bonusMinutes: r.bonus_minutes ?? null,
      });
    }
  };
  collect(mcRows, "Mc");
  collect(adminRows, "Admin");

  // จับคู่ Mc <-> Admin ของ slot เดียวกัน
  const byKey = new Map<string, { Mc?: string; Admin?: string }>();
  for (const d of details) if (!d.cancelled) byKey.set(d.key, { ...byKey.get(d.key), [d.type]: d.name });
  for (const d of details) d.pair = byKey.get(d.key)?.[d.type === "Mc" ? "Admin" : "Mc"] ?? "";
  details.sort((a, b) => a.type.localeCompare(b.type) || a.startMs - b.startMs);

  const summarize = (type: "Mc" | "Admin"): OwnerPerson[] => {
    const people = new Map<string, { slots: number; hours: number; paid: number; late: number; bonus: number; days: Set<string>; cancelled: number }>();
    for (const d of details) {
      if (d.type !== type) continue;
      const p = people.get(d.name) ?? { slots: 0, hours: 0, paid: 0, late: 0, bonus: 0, days: new Set<string>(), cancelled: 0 };
      people.set(d.name, p);
      if (d.cancelled) { p.cancelled++; continue; }
      p.slots++;
      p.hours += d.hours;
      // ชั่วโมงที่ได้เงิน = หลังหักมาสาย + ไลฟ์ชดเชย (ปัดขึ้นทีละ 15 นาที)
      p.paid += slotPaidHours(d.hours, d.lateMinutes, d.bonusMinutes);
      p.bonus += bonusPaidMinutes(d.bonusMinutes);
      if (lateCut(d.lateMinutes) > 0) p.late++;
      p.days.add(d.date);
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const defaultRate = type === "Mc" ? rates.defaultMc : rates.defaultAdmin;
    return [...people.entries()]
      .map(([name, p]) => {
        // ค่าจ้าง/ชม. ของเดือนนี้: รายคน (ไม่ตั้ง = ค่าเริ่มต้น) แล้วดูเทียร์ Commit จากชั่วโมงที่จองทั้งเดือน
        const info = persons.get(`${type}|${name}`);
        const base = Number(info?.hourly_rate) || defaultRate;
        const m = monthRate(base, cleanTiers(info?.commit_tiers), p.hours);
        if (m.rate) (type === "Mc" ? rates.mc : rates.admin)[name] = m.rate;
        return {
          name, slots: p.slots, hours: r2(p.hours), paidHours: r2(p.paid), lateSlots: p.late, bonusMinutes: p.bonus,
          days: p.days.size, cancelled: p.cancelled,
          commit: m.hasCommit ? { tiers: m.tiers, baseRate: base, tier: m.tier, next: m.next } : null,
        };
      })
      .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, "th"));
  };

  return {
    ok: true, month: key, rates, mc: summarize("Mc"), admin: summarize("Admin"),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    details: details.map(({ key, ...d }) => d),
  };
}

/** บันทึกประวัติ (พลาดก็ไม่ให้การจองล้ม) */
export async function writeLogs(entries: {
  email: string; role: string; name: string; action: string; slot_table: string; slot_id: number; result: string;
}[]) {
  if (!entries.length) return;
  const db = createAdminClient();
  try {
    const ids = entries.map((e) => e.slot_id);
    const { data } = await db.from(entries[0].slot_table).select("id, platform, live_date, start_time, end_time").in("id", ids);
    const info = new Map((data ?? []).map((r) => [r.id as number, r]));
    await db.from("booking_logs").insert(entries.map((e) => {
      const s = info.get(e.slot_id);
      return {
        ...e,
        platform: s?.platform ?? null,
        live_date: s?.live_date ?? null,
        time_range: s ? `${hm(s.start_time)}-${hm(s.end_time)}` : null,
      };
    }));
  } catch (err) {
    console.warn("เขียน Log ไม่สำเร็จ:", err);
  }
}
