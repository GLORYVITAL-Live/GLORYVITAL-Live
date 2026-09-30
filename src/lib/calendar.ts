import "server-only";
import { google, type calendar_v3 } from "googleapis";
import { googleAuth } from "@/lib/google";
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
  if (table === "mc_slots") {
    return {
      summary: `${platform} - Mc ${p.name}`,
      description: other ? `Admin: ${other.name} (${other.phone || "ไม่พบเบอร์โทร"})` : "Admin: ยังไม่มี Admin สำหรับ slot นี้",
      start: { dateTime: s.starts_at, timeZone: TZ },
      end: { dateTime: s.ends_at, timeZone: TZ },
    };
  }
  return {
    summary: `Admin ${platform} - ${p.name}`,
    description: other ? `Mc: Mc ${other.name} (${other.phone || "ไม่พบเบอร์"})` : "Mc: ยังไม่มี Mc จอง slot นี้",
    start: { dateTime: s.starts_at, timeZone: TZ },
    end: { dateTime: s.ends_at, timeZone: TZ },
  };
}

/** ทำให้ event ของ slot เดียวตรงกับ DB (สร้าง / แก้ / ย้ายคน / ลบ) */
async function syncOne(cal: calendar_v3.Calendar, table: Table, s: Slot, partner: Slot | undefined) {
  const db = createAdminClient();
  const email = active(s) ? s.person!.email : null;

  // ไม่มีคนแล้ว / ยกเลิก / คนนั้นไม่มีอีเมล -> ลบ event เดิม (ถ้ามี)
  if (!email) {
    if (s.calendar_email && s.calendar_event_id) {
      try {
        await cal.events.delete({ calendarId: s.calendar_email, eventId: s.calendar_event_id });
      } catch (err) {
        if (!isNotFound(err)) throw err;
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
  if (s.calendar_email && s.calendar_event_id && s.calendar_email !== email) {
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
  const cal = calendarApi();
  if (!cal) throw new Error("ยังไม่ได้เชื่อมบัญชี Google (bun run google:auth)");
  try {
    await cal.events.delete({ calendarId: email, eventId });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

/** sync slot นี้และ slot คู่ของอีกฝั่ง */
async function syncPair(cal: calendar_v3.Calendar, table: Table, id: number) {
  const s = await loadSlot(table, id);
  if (!s) return;
  const otherTable: Table = table === "mc_slots" ? "admin_slots" : "mc_slots";
  const partners = await loadPartners(otherTable, s);
  const partner = partners.find(active) ?? partners[0];

  await syncOne(cal, table, s, partner);
  for (const p of partners) await syncOne(cal, otherTable, p, active(s) ? s : undefined);
}

/**
 * ทำงานในคิวปฏิทินที่ค้างอยู่ (เรียกหลังตอบผู้ใช้แล้ว และจาก cron)
 * คืนจำนวนงานที่ทำสำเร็จ / ไม่สำเร็จ
 */
export async function processCalendarJobs(limit = 30) {
  const cal = calendarApi();
  if (!cal) return { done: 0, failed: 0, skipped: "ยังไม่ได้เชื่อมบัญชี Google (bun run google:auth)" };

  const db = createAdminClient();
  const { data: jobs, error } = await db
    .from("calendar_jobs")
    .select("id, slot_table, slot_id, attempts")
    .is("done_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(limit);
  if (error) throw error;

  let done = 0, failed = 0;
  const seen = new Set<string>();
  for (const job of jobs ?? []) {
    const k = `${job.slot_table}|${job.slot_id}`;
    try {
      if (!seen.has(k)) await syncPair(cal, job.slot_table as Table, job.slot_id);
      seen.add(k);
      await db.from("calendar_jobs").update({ done_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
      done++;
    } catch (err) {
      failed++;
      const msg = String((err as Error)?.message ?? err);
      console.warn(`ลงปฏิทินไม่สำเร็จ (${k}):`, msg);
      await db.from("calendar_jobs").update({ attempts: job.attempts + 1, last_error: msg.slice(0, 500) }).eq("id", job.id);
    }
  }
  return { done, failed };
}
