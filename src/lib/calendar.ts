import "server-only";
import { google, type calendar_v3 } from "googleapis";
import { googleAuth } from "@/lib/google";
import { withSyncLock } from "@/lib/lock";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * ลงปฏิทิน Google ของ Mc / Admin ให้ตรงกับข้อมูลใน DB
 *
 * ทำงานในนามบัญชีที่เคยรัน Apps Script (ดู src/lib/google.ts) ซึ่งทุกคนแชร์ปฏิทิน
 * (สิทธิ์ "ทำการเปลี่ยนแปลงกิจกรรม") ให้อยู่แล้ว ปฏิทินของแต่ละคนอ้างด้วยอีเมลของคนนั้น
 *
 * งานถูกจดไว้ในตาราง calendar_jobs ตอนจอง/รับคิว/ยกเลิก แล้วมาทำที่นี่ทีหลัง
 * (ผู้ใช้ไม่ต้องรอ) งานหนึ่งงาน = sync ทั้ง slot ของ Mc และ Admin ที่เป็นคู่กัน
 * เพราะหมายเหตุใน event ของแต่ละฝั่งมีชื่อ + เบอร์ของอีกฝั่ง
 */

const TZ = "Asia/Bangkok";
const MAX_ATTEMPTS = 5;

type Table = "mc_slots" | "admin_slots";
type Person = { name: string; email: string | null; phone: string | null };
type Slot = {
  id: number;
  platform: string;
  starts_at: string;
  ends_at: string;
  confirmed: boolean | null;
  is_cancelled: boolean;
  calendar_email: string | null;
  calendar_event_id: string | null;
  person: Person | null;
};

let _cal: calendar_v3.Calendar | null = null;
function calendarApi() {
  if (!_cal) {
    const auth = googleAuth();
    if (!auth) return null;
    _cal = google.calendar({ version: "v3", auth });
  }
  return _cal;
}

const isNotFound = (err: unknown) => {
  const code = (err as { code?: number })?.code;
  return code === 404 || code === 410;
};

/**
 * อีเมลในองค์กรเดียวกับบัญชีระบบ (@glorythailand.com) ไม่ลงปฏิทินให้: คนในองค์กรดูคิวจากเว็บ/ชีต
 * (ค่าเริ่มต้นของ Workspace แชร์กันแบบดูได้อย่างเดียว ระบบเขียนนัดให้ไม่ได้)
 * ลงปฏิทินเฉพาะ Mc / Admin เสริมที่ใช้อีเมลภายนอก (ต้องแชร์ปฏิทินแบบ "ทำการเปลี่ยนแปลงกิจกรรม" ให้บัญชีระบบ)
 */
const NO_CALENDAR_DOMAINS = ["@glorythailand.com"];
const usesCalendar = (email: string | null | undefined) =>
  !!email && !NO_CALENDAR_DOMAINS.some((d) => email.toLowerCase().endsWith(d));

/** ปฏิทินของพนักงานไม่ได้แชร์ให้บัญชีระบบแบบ "ทำการเปลี่ยนแปลงกิจกรรม" (ลองซ้ำก็ไม่สำเร็จ) */
const isNoAccess = (err: unknown) =>
  (err as { code?: number })?.code === 403 || /writer access|forbidden/i.test(String((err as Error)?.message ?? ""));

/** ระบบเขียนปฏิทินของอีเมลนี้ไม่ได้ (ให้เจ้าของปฏิทินแชร์สิทธิ์แก้ไขให้บัญชีระบบ) */
class CalendarAccessError extends Error {
  constructor(public email: string) {
    super(`ไม่มีสิทธิ์เขียนปฏิทินของ ${email} (ให้แชร์ปฏิทินแบบ "ทำการเปลี่ยนแปลงกิจกรรม" ให้บัญชีระบบ)`);
  }
}

async function loadSlot(table: Table, id: number) {
  const col = table === "mc_slots" ? "mc_id" : "admin_id";
  const { data, error } = await createAdminClient()
    .from(table)
    .select(`id, platform, starts_at, ends_at, confirmed, is_cancelled, calendar_email, calendar_event_id, person:staff!${col}(name, email, phone)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Slot | null;
}

/** slot ของอีกฝั่งที่ platform + เวลาเริ่ม + เวลาจบ ตรงกัน */
async function loadPartners(table: Table, s: Pick<Slot, "platform" | "starts_at" | "ends_at">) {
  const col = table === "mc_slots" ? "mc_id" : "admin_id";
  const { data, error } = await createAdminClient()
    .from(table)
    .select(`id, platform, starts_at, ends_at, confirmed, is_cancelled, calendar_email, calendar_event_id, person:staff!${col}(name, email, phone)`)
    .eq("platform", s.platform)
    .eq("starts_at", s.starts_at)
    .eq("ends_at", s.ends_at);
  if (error) throw error;
  return (data ?? []) as unknown as Slot[];
}

const active = (s: Slot) => !!s.person && s.confirmed !== false && !s.is_cancelled;

function eventFor(table: Table, s: Slot, partner: Slot | undefined): calendar_v3.Schema$Event {
  const p = s.person!;
  const other = partner && active(partner) ? partner.person! : null;
  const platform = s.platform || "Live";
  // ป้ายบอกว่า event นี้เว็บสร้าง (ของ slot ไหน) ใช้หา event ซ้ำ/ค้างตอนเก็บกวาด
  const tag = { private: { [TAG_KEY]: `${table}:${s.id}` } };
  // status confirmed: ถ้า event เดิมถูกลบไปจากปฏิทิน (ยังอยู่ในถังขยะของ Google) การ patch จะกู้กลับมาให้เห็นอีกครั้ง
  if (table === "mc_slots") {
    return {
      status: "confirmed",
      summary: `${platform} - Mc ${p.name}`,
      description: other ? `Admin: ${other.name} (${other.phone || "ไม่พบเบอร์โทร"})` : "Admin: ยังไม่มี Admin สำหรับ slot นี้",
      start: { dateTime: s.starts_at, timeZone: TZ },
      end: { dateTime: s.ends_at, timeZone: TZ },
      extendedProperties: tag,
    };
  }
  return {
    status: "confirmed",
    summary: `Admin ${platform} - ${p.name}`,
    description: other ? `Mc: Mc ${other.name} (${other.phone || "ไม่พบเบอร์"})` : "Mc: ยังไม่มี Mc จอง slot นี้",
    start: { dateTime: s.starts_at, timeZone: TZ },
    end: { dateTime: s.ends_at, timeZone: TZ },
    extendedProperties: tag,
  };
}

const TAG_KEY = "gloryVitalSlot";

/** ทำให้ event ของ slot เดียวตรงกับ DB (สร้าง / แก้ / ย้ายคน / ลบ) */
async function syncOne(cal: calendar_v3.Calendar, table: Table, s: Slot, partner: Slot | undefined) {
  const db = createAdminClient();
  const email = active(s) && usesCalendar(s.person!.email) ? s.person!.email : null;

  // ไม่มีคนแล้ว / ยกเลิก / คนนั้นไม่มีอีเมล / อีเมลในองค์กร -> ลบ event เดิม (ถ้ามี)
  if (!email) {
    if (s.calendar_email && s.calendar_event_id) {
      // ปฏิทินในองค์กรระบบเขียนไม่ได้อยู่แล้ว ล้างแค่ข้อมูลในระบบ
      if (usesCalendar(s.calendar_email)) {
        try {
          await cal.events.delete({ calendarId: s.calendar_email, eventId: s.calendar_event_id });
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
      }
      await db.from(table).update({ calendar_email: null, calendar_event_id: null }).eq("id", s.id);
    }
    return;
  }

  const body = eventFor(table, s, partner);
  if (s.calendar_email === email && s.calendar_event_id) {
    try {
      await cal.events.patch({ calendarId: email, eventId: s.calendar_event_id, requestBody: body });
      return;
    } catch (err) {
      if (!isNotFound(err)) throw err; // event เดิมหาย -> สร้างใหม่ด้านล่าง
    }
  }

  const created = await cal.events.insert({ calendarId: email, requestBody: body });
  // เปลี่ยนคน -> ลบ event ในปฏิทินของคนเดิม
  if (s.calendar_email && s.calendar_event_id && s.calendar_email !== email && usesCalendar(s.calendar_email)) {
    try {
      await cal.events.delete({ calendarId: s.calendar_email, eventId: s.calendar_event_id });
    } catch (err) {
      if (!isNotFound(err)) console.warn("ลบ event ของคนเดิมไม่สำเร็จ:", err);
    }
  }
  const { data: saved } = await db.from(table)
    .update({ calendar_email: email, calendar_event_id: created.data.id }).eq("id", s.id).select("id");
  // slot ถูกลบไประหว่างสร้าง event (เช่น ลบแถวในชีต) -> ลบ event ที่เพิ่งสร้าง ไม่ให้ค้างในปฏิทิน
  if (saved && !saved.length && created.data.id) await deleteCalendarEvent(email, created.data.id);
}

/** ลบ event ของ slot ที่กำลังจะถูกลบออกจาก DB (event หายไปแล้วถือว่าสำเร็จ) */
export async function deleteCalendarEvent(email: string, eventId: string) {
  if (!usesCalendar(email)) return; // ปฏิทินในองค์กร ระบบไม่ได้ลงนัดให้
  const cal = calendarApi();
  if (!cal) throw new Error("ยังไม่ได้เชื่อมบัญชี Google (bun run google:auth)");
  try {
    await cal.events.delete({ calendarId: email, eventId });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

/** ปฏิทินที่ slot นี้เขียน (คนปัจจุบัน หรือปฏิทินเดิมที่มี event ค้าง) */
const calendarOf = (s: Slot) => (active(s) ? s.person?.email : null) ?? s.calendar_email ?? "";

/**
 * sync slot นี้และ slot คู่ของอีกฝั่ง คืนรายการ slot ที่ sync แล้ว ("ตาราง|id")
 * ปฏิทินของ slot นี้ไม่มีสิทธิ์เขียน -> CalendarAccessError
 * ปฏิทินของ slot คู่ไม่มีสิทธิ์เขียน -> จดอีเมลไว้ใน noAccess แล้วทำต่อ (ไม่ให้ขวางคิวของคนนี้)
 */
async function syncPair(cal: calendar_v3.Calendar, table: Table, id: number, noAccess: Set<string>) {
  const s = await loadSlot(table, id);
  if (!s) return [`${table}|${id}`];
  const otherTable: Table = table === "mc_slots" ? "admin_slots" : "mc_slots";
  const partners = await loadPartners(otherTable, s);
  const partner = partners.find(active) ?? partners[0];

  try {
    await syncOne(cal, table, s, partner);
  } catch (err) {
    if (isNoAccess(err)) throw new CalendarAccessError(calendarOf(s));
    throw err;
  }
  for (const p of partners) {
    try {
      await syncOne(cal, otherTable, p, active(s) ? s : undefined);
    } catch (err) {
      if (!isNoAccess(err)) throw err;
      if (calendarOf(p)) noAccess.add(calendarOf(p));
    }
  }
  return [`${table}|${id}`, ...partners.map((p) => `${otherTable}|${p.id}`)];
}

/**
 * ปิดงานค้างของ slot ที่เพิ่ง sync ไปแล้ว (ยกเว้นงานที่กำลังทำ)
 * เฉพาะงานที่มีอยู่ก่อนเริ่มชุดนี้ (id <= maxId) งานที่เข้ามาระหว่าง sync (เช่น มีคนจองพอดี) เก็บไว้ทำรอบถัดไป
 */
async function closeDuplicateJobs(keys: string[], exceptId: number, maxId: number) {
  const db = createAdminClient();
  for (const table of ["mc_slots", "admin_slots"] as const) {
    const ids = keys.filter((k) => k.startsWith(`${table}|`)).map((k) => Number(k.split("|")[1]));
    if (!ids.length) continue;
    await db.from("calendar_jobs").update({ done_at: new Date().toISOString(), last_error: null })
      .eq("slot_table", table).in("slot_id", ids).is("done_at", null).neq("id", exceptId).lte("id", maxId);
  }
}

/** จำนวนงานลงปฏิทินที่ยังค้าง */
export async function pendingCalendarJobs() {
  const { count, error } = await createAdminClient().from("calendar_jobs")
    .select("id", { count: "exact", head: true }).is("done_at", null).lt("attempts", MAX_ATTEMPTS);
  if (error) throw error;
  return count ?? 0;
}

/**
 * ซิงค์ปฏิทินใหม่ทั้งหมด: จดงานลงปฏิทินของทุกคิวตั้งแต่วันนี้ (มีคน หรือยังมี event ค้าง)
 * แต่ละงานจะสร้าง event ที่หาย / แก้ที่ไม่ตรง / กู้ที่ถูกลบ / ลบของคิวที่ไม่มีคนแล้ว
 */
export async function enqueueUpcomingCalendar() {
  const db = createAdminClient();
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

  // slot ที่มีงานค้างอยู่แล้ว ไม่ต้องจดซ้ำ (กดซิงค์หลายรอบ)
  const pending = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("calendar_jobs").select("slot_table, slot_id")
      .is("done_at", null).lt("attempts", MAX_ATTEMPTS).order("id").range(from, from + 999);
    if (error) throw error;
    for (const j of data ?? []) pending.add(`${j.slot_table}|${j.slot_id}`);
    if (!data || data.length < 1000) break;
  }

  const jobs: { slot_table: Table; slot_id: number }[] = [];
  for (const table of ["mc_slots", "admin_slots"] as const) {
    const col = table === "mc_slots" ? "mc_id" : "admin_id";
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select("id").gte("live_date", today)
        .or(`${col}.not.is.null,calendar_event_id.not.is.null`).order("id").range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) if (!pending.has(`${table}|${r.id}`)) jobs.push({ slot_table: table, slot_id: r.id });
      if (!data || data.length < 1000) break;
    }
  }
  for (let i = 0; i < jobs.length; i += 500) {
    const { error } = await db.from("calendar_jobs").insert(jobs.slice(i, i + 500));
    if (error) throw error;
  }
  return jobs.length;
}

/**
 * ทำงานในคิวปฏิทินที่ค้างอยู่ (เรียกหลังตอบผู้ใช้แล้ว และจาก cron)
 * ทำทีละหนึ่งคำขอ (ล็อก "calendar") ไม่งั้นคำขอที่เข้ามาพร้อมกันจะหยิบงานเดียวกันไปสร้าง event ซ้ำ
 * คนที่ถือล็อกวนทำจนงานหมด (รวมงานที่เข้ามาระหว่างทำ) หรือจนหมดเวลา budgetMs (งานที่เหลือทำรอบหน้า)
 * คืนจำนวนงานที่ทำสำเร็จ / ไม่สำเร็จ
 */
export async function processCalendarJobs(limit = 30, budgetMs = 40_000) {
  const cal = calendarApi();
  if (!cal) return { done: 0, failed: 0, noAccess: [] as string[], skipped: "ยังไม่ได้เชื่อมบัญชี Google (bun run google:auth)" };

  const started = Date.now();
  const result = await withSyncLock("calendar", async () => {
    const db = createAdminClient();
    let done = 0, failed = 0;
    const seen = new Set<string>(); // slot ที่ sync แล้วในรอบนี้ (รวม slot คู่) ไม่ต้องทำซ้ำ
    const noAccess = new Set<string>(); // ปฏิทินที่ไม่ได้แชร์สิทธิ์แก้ไขให้ระบบ
    for (let round = 0; round < 50 && Date.now() - started < budgetMs; round++) {
      const { data: jobs, error } = await db
        .from("calendar_jobs")
        .select("id, slot_table, slot_id, attempts")
        .is("done_at", null)
        .lt("attempts", MAX_ATTEMPTS)
        .order("created_at")
        .limit(limit);
      if (error) throw error;
      if (!jobs?.length) break;
      const { data: last } = await db.from("calendar_jobs").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
      const maxId = Number(last?.id ?? 0);

      for (const job of jobs) {
        if (Date.now() - started > budgetMs) break;
        const k = `${job.slot_table}|${job.slot_id}`;
        try {
          if (!seen.has(k)) {
            const synced = await syncPair(cal, job.slot_table as Table, job.slot_id, noAccess);
            for (const x of synced) seen.add(x);
            // งานค้างอื่นของ slot เดียวกัน / slot คู่ที่เพิ่ง sync ไป = ซ้ำ ปิดทิ้งเลย (กดซิงค์หลายรอบ หรือคิวคู่ Mc-Admin)
            await closeDuplicateJobs(synced, job.id, maxId);
          }
          seen.add(k);
          await db.from("calendar_jobs").update({ done_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
          done++;
        } catch (err) {
          failed++;
          const msg = String((err as Error)?.message ?? err);
          console.warn(`ลงปฏิทินไม่สำเร็จ (${k}):`, msg);
          if (err instanceof CalendarAccessError) {
            // ไม่มีสิทธิ์ ลองซ้ำก็ไม่สำเร็จ: ปิดงานไว้พร้อมเหตุผล (แชร์ปฏิทินแล้วกด "ซิงค์ปฏิทินใหม่ทั้งหมด" อีกครั้ง)
            if (err.email) noAccess.add(err.email);
            seen.add(k);
            await db.from("calendar_jobs").update({ done_at: new Date().toISOString(), last_error: msg.slice(0, 500) }).eq("id", job.id);
          } else {
            await db.from("calendar_jobs").update({ attempts: job.attempts + 1, last_error: msg.slice(0, 500) }).eq("id", job.id);
          }
        }
      }
    }
    return { done, failed, noAccess: [...noAccess].sort() };
  }, 20_000);
  return result ?? { done: 0, failed: 0, noAccess: [] as string[], skipped: "มีงานลงปฏิทินอื่นกำลังทำอยู่" };
}

// ---------- เก็บกวาด event ซ้ำ / ค้าง ----------

/**
 * หา event ในปฏิทินของพนักงาน (ตั้งแต่วันนี้ ไม่เกิน 120 วันข้างหน้า) ที่ไม่ตรงกับคิวจริงในระบบ
 *   = event ที่เว็บสร้าง (มีป้าย) หรือชื่อรูปแบบเดียวกับที่เว็บสร้าง ("Shopee - Mc มะนาว" / "Admin Shopee - แพรวา")
 *     แต่ไม่ใช่ event ที่ระบบจดไว้ของคิวที่ยังมีคนนั้นอยู่ -> event ซ้ำ หรือคิวที่เอาคนออกแล้วแต่ event ค้าง
 * dryRun = แค่นับ/แสดงรายการ ไม่ลบ
 */
export async function cleanupCalendarEvents(dryRun: boolean) {
  const cal = calendarApi();
  if (!cal) throw new Error("ยังไม่ได้เชื่อมบัญชี Google");
  const db = createAdminClient();

  // ทำงานลงปฏิทินที่ค้างก่อน (event ของคิวที่เพิ่งจองจะได้ถูกจดไว้ ไม่ถูกนับเป็นของค้าง) จำกัดเวลาไม่ให้เกินเวลาของคำขอ
  await processCalendarJobs(30, 10_000);
  if ((await pendingCalendarJobs()) > 0) {
    throw new Error("ยังมีงานลงปฏิทินค้างอยู่ กด \"ซิงค์ปฏิทินใหม่ทั้งหมด\" ให้เสร็จก่อน แล้วค่อยล้าง event ซ้ำ");
  }

  return withSyncLock("calendar", async () => {
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const timeMin = new Date(`${today}T00:00:00+07:00`).toISOString();
    const timeMax = new Date(Date.parse(timeMin) + 120 * 86400_000).toISOString();

    // event ที่ระบบจดไว้ของคิวตั้งแต่วันนี้ (ต่อปฏิทิน)
    const keep = new Map<string, Set<string>>();
    for (const table of ["mc_slots", "admin_slots"] as const) {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from(table).select("calendar_email, calendar_event_id")
          .gte("live_date", today).not("calendar_event_id", "is", null).range(from, from + 999);
        if (error) throw error;
        for (const r of data ?? []) {
          if (!r.calendar_email) continue;
          if (!keep.has(r.calendar_email)) keep.set(r.calendar_email, new Set());
          keep.get(r.calendar_email)!.add(r.calendar_event_id);
        }
        if (!data || data.length < 1000) break;
      }
    }

    const { data: staff, error: staffErr } = await db.from("staff").select("role, name, email")
      .in("role", ["mc", "admin"]).not("email", "is", null);
    if (staffErr) throw staffErr;

    const found: { email: string; name: string; summary: string; start: string }[] = [];
    let deleted = 0;
    const errors: string[] = [];
    for (const p of staff ?? []) {
      if (!usesCalendar(p.email)) continue; // ปฏิทินในองค์กร ระบบไม่ได้ลงนัดให้
      const ours = p.role === "mc" ? ` - Mc ${p.name}` : ` - ${p.name}`;
      const isOurs = (e: calendar_v3.Schema$Event) =>
        !!e.extendedProperties?.private?.[TAG_KEY]
        || (p.role === "mc" ? !!e.summary?.endsWith(ours) && !e.summary.startsWith("Admin ") : !!e.summary?.startsWith("Admin ") && !!e.summary.endsWith(ours));
      try {
        let pageToken: string | undefined;
        do {
          const res = await cal.events.list({
            calendarId: p.email!, timeMin, timeMax, singleEvents: true, maxResults: 2500, pageToken,
          });
          for (const e of res.data.items ?? []) {
            if (!e.id || e.status === "cancelled" || !isOurs(e) || keep.get(p.email!)?.has(e.id)) continue;
            found.push({ email: p.email!, name: p.name, summary: e.summary ?? "", start: e.start?.dateTime ?? e.start?.date ?? "" });
            if (!dryRun) {
              try {
                await cal.events.delete({ calendarId: p.email!, eventId: e.id });
                deleted++;
              } catch (err) {
                if (!isNotFound(err)) errors.push(`${p.email}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
              }
            }
          }
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      } catch (err) {
        // ปฏิทินที่ไม่ได้แชร์ให้ระบบ / ไม่มีสิทธิ์ ข้ามไป
        if (!isNotFound(err)) errors.push(`${p.email}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      }
    }
    found.sort((a, b) => a.start.localeCompare(b.start));
    return { found, deleted, errors };
  }, 30_000);
}
