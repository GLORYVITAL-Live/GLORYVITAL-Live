import "server-only";
import webpush from "web-push";
import { missingCalendarCounts } from "@/lib/calendar";
import { bookingRange, getSettings, proofsBySlot, windowAlerts, type Settings } from "@/lib/data";
import { gmvCoverage } from "@/lib/gmv";
import { dataHealth } from "@/lib/health";
import { fmtDayShort, parseKey } from "@/lib/format";
import { tiktokOnly, withLiveTeam } from "@/lib/live-team";
import { platformLabel } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/server";
import { addDays, fmtDay, rangeText, type BookRange } from "@/lib/window";

/**
 * แจ้งเตือนในเว็บ (กระดิ่ง) + เด้งเข้ามือถือ (Web Push) — SQL 20261028000000_notifications
 *   ทุกเรื่องบันทึกลงกระดิ่งของผู้รับ (ผูกกับอีเมลที่ login) แล้วเด้งไปทุกเครื่องที่คนนั้นกดเปิดแจ้งเตือนไว้
 *   เด้งต้องมี VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (ไม่มี = มีแค่กระดิ่ง) · ยังไม่ได้รัน SQL = ข้ามเงียบๆ
 *   ทุกฟังก์ชันไม่ throw: ส่งไม่ได้ไม่กระทบงานหลัก (จอง / ยกเลิก / แก้ slot)
 *
 * เรื่องที่แจ้ง
 *   booked     มีคนจองคิว / รับคิว                → Owner ที่จัดการฝั่งนั้น
 *   cancelled  Mc / Admin เสริมกดยกเลิกคิว         → Owner ฝั่งนั้น + คู่ไลฟ์ของ slot นั้น
 *   slot_open  slot ว่างเพราะมีคนยกเลิก / เจ้าของสร้าง slot ใหม่ / เปิดช่วงจอง
 *                                                  → Mc (ที่จองวันนั้นได้) / Admin เสริม (ไม่รวมทีม Shopee)
 *   changed    Owner เปลี่ยนคน / แคนคิว (เว็บ / ชีต) → คนที่ได้ / เสียคิว
 *   reminder   คืนก่อนวันไลฟ์ (20:00) + ก่อนเริ่ม ~1 ชม. → เจ้าของคิว (cron ทุก 15 นาที)
 *   open_soon  slot ยังว่างใน 48 ชม. (เช้า)           → Owner ฝั่งนั้น
 *   proof      หลังไลฟ์ ~2 ชม. ยังไม่แนบหลักฐาน / GMV → Admin ของ slot · ค้างเกิน 24 ชม. (10:00) → Admin + Owner
 *   calendar   คิวยังไม่ขึ้นปฏิทิน (จันทร์ / พฤหัส 10:00) → คนนั้น พร้อมลิงก์วิธีแชร์
 *   open_soon  [ด่วน] slot ว่างเหลือไม่ถึง 6 ชม. ก่อนไลฟ์ → Owner ฝั่งนั้น (ทุก 15 นาที)
 *   data       ข้อมูลผิด (คนซ้อน slot / คนเดียวกัน 2 slot เวลาทับ / แถวซ้ำ / ขาดแถวคู่) → Owner (ทันที ไม่แจ้งซ้ำเรื่องเดิม)
 *   window     ช่วงเปิดจองหมดภายใน 2 วัน / หมดแล้ว (วันละครั้ง ตั้งแต่ 10:00) → Owner ฝั่งนั้น
 *   weekly     อาทิตย์ 18:00 สรุปคิวสัปดาห์หน้า → ทุกคนที่มีคิว
 *   tawi       ใบ 50 ทวิ พร้อมดาวน์โหลด (ไฟล์ได้เจ้าของครั้งแรก — src/lib/tawi.ts) → เจ้าของไฟล์
 *              เจ้าตัวกรอกชื่อยืนยันตัวตนไม่ตรง (วันละครั้งต่อคน) → Owner ที่ดูเอกสารทำเบิกได้
 *   receipt    Owner ตีกลับเอกสารยืนยันการรับเงิน (src/lib/receipts-db.ts) → เจ้าตัว ให้ส่งใหม่
 *   quota      Owner เปิดใช้สิทธิ์จองตามแร็งค์ (src/lib/mc-quota-db.ts) → Mc ที่ถูกจำกัด บอกสิทธิ์ + แร็งค์ของตัวเอง
 *   loan       ขอยืมอุปกรณ์ (src/lib/loans-db.ts): คำขอใหม่ / ผู้ยืมยกเลิก → คนที่อนุมัติได้ · อนุมัติ / ไม่อนุมัติ → ผู้ยืม
 *              ใกล้ถึง / เลยกำหนดคืน (cron) → ผู้ยืม (+ คนที่อนุมัติได้ ถ้าเลยกำหนด)
 */

export type NoteKind = "booked" | "cancelled" | "slot_open" | "changed" | "reminder" | "open_soon" | "proof" | "calendar" | "data" | "weekly" | "window" | "tawi" | "receipt" | "quota" | "loan" | "pay" | "training" | "test";
/** หน้าที่เปิดเมื่อกด (guide = หน้าวิธีแชร์ปฏิทิน /guide · borrow = หน้าขอยืมของทีมอื่น) */
export type NotePage = "home" | "owner" | "mc" | "admin" | "proof" | "guide" | "equipment" | "borrow";
export type Note = { kind: NoteKind; title: string; body: string; page?: NotePage | null; dedupe?: string };
type Side = "mc" | "admin";
type Table = "mc_slots" | "admin_slots";

const SITE = "https://glory-vital-live.vercel.app";
/** ยกเลิกก่อนไลฟ์ไม่ถึงกี่ชั่วโมง = [ด่วน] */
const URGENT_HOURS = 48;
/** เตือนก่อนเริ่มไลฟ์ภายในกี่นาที (cron ทุก 15 นาที + GitHub อาจช้า จึงเผื่อ) */
const SOON_MIN = 70;
/** เตือนคืนก่อนวันไลฟ์ ตั้งแต่กี่โมง (เวลาไทย) */
const EVENING_HOUR = 20;

const sideOf = (t: Table): Side => (t === "mc_slots" ? "mc" : "admin");
const tableOf = (s: Side): Table => (s === "mc" ? "mc_slots" : "admin_slots");
const personCol = (s: Side) => (s === "mc" ? "mc_id" : "admin_id");
const hm = (t: string) => String(t).slice(0, 5);
/** วันที่ (เวลาไทย) ของเวลานี้ */
const bkkDay = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
const cleanEmails = (emails: (string | null | undefined)[]) =>
  [...new Set(emails.filter((e): e is string => !!e?.trim()).map((e) => e.trim().toLowerCase()))];
/** ป้ายฝั่งในหัวข้อแจ้งเตือน (แยกให้เห็นบนหน้าจอล็อกว่าเป็น slot ของ Mc หรือ Admin) */
const roleLabel = (side: Side) => (side === "mc" ? "Mc" : "Admin");
const who = (side: Side, name: string) => (side === "mc" ? `Mc ${name.replace(/^mc\s*/i, "")}` : name);

// ---------- ส่ง ----------

/** ส่งเรื่องเดียวกันให้หลายคน คืนจำนวนที่บันทึกใหม่ (ซ้ำ dedupe = ไม่นับ) */
export function notify(emails: (string | null | undefined)[], note: Note) {
  return notifyMany(cleanEmails(emails).map((email) => ({ ...note, email })));
}

/** ส่งหลายเรื่อง (คนละคน / คนละข้อความ) */
export async function notifyMany(items: (Note & { email: string })[]) {
  if (!items.length) return 0;
  try {
    const rows = items.map((n) => ({
      email: n.email.trim().toLowerCase(), kind: n.kind, title: n.title.slice(0, 200), body: n.body.slice(0, 1000),
      page: n.page ?? null, dedupe_key: n.dedupe ?? null,
    }));
    // dedupe ซ้ำ = ข้าม (คืนเฉพาะแถวที่เพิ่มจริง)
    const { data, error } = await createAdminClient().from("notifications")
      .upsert(rows, { onConflict: "email,dedupe_key", ignoreDuplicates: true })
      .select("id, email, title, body, page");
    if (error) {
      if (!/notifications/.test(error.message)) console.error("บันทึกแจ้งเตือนไม่สำเร็จ:", error.message);
      return 0;
    }
    await pushTo((data ?? []) as Pushed[]);
    return data?.length ?? 0;
  } catch (err) {
    console.error("แจ้งเตือนไม่สำเร็จ:", err);
    return 0;
  }
}

type Pushed = { id: number; email: string; title: string; body: string; page: string | null };
let vapidReady: boolean | null = null;
function vapid() {
  if (vapidReady === null) {
    const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    vapidReady = !!(pub && priv);
    if (vapidReady) webpush.setVapidDetails(SITE, pub!, priv!);
  }
  return vapidReady;
}

/** เด้งเข้าทุกเครื่องที่ผู้รับเปิดแจ้งเตือนไว้ · เครื่องที่เลิกใช้แล้ว (404 / 410) ลบทิ้ง */
async function pushTo(rows: Pushed[]) {
  if (!rows.length || !vapid()) return;
  const db = createAdminClient();
  const { data: subs } = await db.from("push_subscriptions").select("id, email, endpoint, p256dh, auth")
    .in("email", [...new Set(rows.map((r) => r.email))]);
  if (!subs?.length) return;
  const gone = new Set<number>(), sent = new Set<number>();
  await Promise.all(rows.flatMap((n) => subs.filter((s) => s.email === n.email).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        // urgent = [ด่วน] / ใกล้ไลฟ์ → สั่นยาว + ค้างบนจอจนกว่าจะกดปิด (public/sw.js)
        JSON.stringify({
          title: n.title, body: n.body, url: n.page === "guide" ? "/guide" : n.page ? `/?go=${n.page}` : "/", tag: `n${n.id}`,
          urgent: n.title.startsWith("[ด่วน]") || n.title.startsWith("อีก "),
        }),
        { TTL: 6 * 3600, urgency: "high" },
      );
      sent.add(s.id);
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.add(s.id);
      else console.warn("ส่งแจ้งเตือนเข้าเครื่องไม่สำเร็จ:", code ?? "", (err as Error)?.message);
    }
  })));
  if (gone.size) await db.from("push_subscriptions").delete().in("id", [...gone]);
  if (sent.size) await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).in("id", [...sent]);
}

// ---------- ผู้รับ / ข้อมูล slot ----------

/** Owner ที่จัดการฝั่งนี้ได้ และมีอีเมล (ค่าว่าง = จัดการได้ ตาม src/lib/auth.ts) */
export async function ownerEmails(side: Side) {
  type Row = { email: string | null; can_manage: boolean | null };
  const { data } = await createAdminClient().from("staff").select(`email, can_manage:can_manage_${side}`)
    .eq("role", "owner").not("email", "is", null).overrideTypes<Row[], { merge: false }>();
  return cleanEmails((data ?? []).filter((r) => r.can_manage !== false).map((r) => r.email));
}

/** อีเมลของคนตาม id (ไม่มีอีเมล = ไม่อยู่ใน map) */
async function emailsOf(ids: (number | null | undefined)[]) {
  const want = [...new Set(ids.filter((x): x is number => !!x))];
  if (!want.length) return new Map<number, string>();
  const { data } = await createAdminClient().from("staff").select("id, email").in("id", want);
  return new Map((data ?? []).filter((s) => s.email).map((s) => [s.id as number, String(s.email).trim().toLowerCase()]));
}

type Slot = {
  id: number; platform: string; live_date: string; start_time: string; end_time: string; starts_at: string; ends_at: string;
  is_cancelled: boolean; confirmed: boolean | null; person: number | null;
};
async function slotsOf(side: Side, ids: number[]) {
  if (!ids.length) return [] as Slot[];
  const { data } = await createAdminClient().from(tableOf(side))
    .select(`id, platform, live_date, start_time, end_time, starts_at, ends_at, is_cancelled, confirmed, person:${personCol(side)}`)
    .in("id", ids).order("starts_at").overrideTypes<Slot[], { merge: false }>();
  return data ?? [];
}

/** "ศ. 17 ต.ค. 09:30–11:30 GLORY VITAL" */
export const slotText = (s: Pick<Slot, "live_date" | "start_time" | "end_time" | "platform">) =>
  `${fmtDayShort.format(parseKey(String(s.live_date)))} ${hm(s.start_time)}–${hm(s.end_time)} ${platformLabel(s.platform)}`;
/** รายการ slot หลายบรรทัด (เกิน 6 = "และอีก N slot") */
const listText = (slots: Slot[]) =>
  slots.slice(0, 6).map(slotText).join("\n") + (slots.length > 6 ? `\nและอีก ${slots.length - 6} slot` : "");

function leadText(ms: number) {
  const h = Math.max(0, Math.floor(ms / 3600_000));
  return h >= 24 ? `${Math.floor(h / 24)} วัน${h % 24 ? ` ${h % 24} ชม.` : ""}` : h ? `${h} ชม.` : `${Math.max(1, Math.round(ms / 60_000))} นาที`;
}

// ---------- เรื่องที่แจ้ง ----------

/** มีคนจองคิว (Mc) / รับคิว (Admin เสริม) ผ่านเว็บ → Owner ฝั่งนั้น */
export async function notifyBooked(side: Side, name: string, actorEmail: string, slotIds: number[]) {
  try {
    const slots = await slotsOf(side, slotIds);
    if (!slots.length) return 0;
    const to = (await ownerEmails(side)).filter((e) => e !== actorEmail.toLowerCase());
    return notify(to, {
      kind: "booked", page: "home",
      title: `${who(side, name)} ${side === "mc" ? "จองคิว" : "รับคิว Admin"} ${slots.length} slot`,
      body: listText(slots),
    });
  } catch (err) {
    console.error("แจ้งเตือนจองคิวไม่สำเร็จ:", err);
    return 0;
  }
}

/**
 * Mc / Admin เสริมกดยกเลิกคิวผ่านเว็บ (slot ว่างแล้ว)
 *   → Owner ฝั่งนั้น + คู่ไลฟ์ของ slot นั้น + คนอื่นที่จองแทนได้ (slot ยังไม่เริ่ม)
 */
export async function notifyCancelled(side: Side, name: string, actorEmail: string, actorId: number, slotId: number, at = new Date()) {
  try {
    const [s] = await slotsOf(side, [slotId]);
    if (!s) return 0;
    const db = createAdminClient();
    const actor = actorEmail.toLowerCase();
    const before = Date.parse(s.starts_at) - at.getTime();
    const urgent = before < URGENT_HOURS * 3600_000 ? "[ด่วน] " : "";
    const text = slotText(s);
    const items: (Note & { email: string })[] = [];

    for (const email of await ownerEmails(side)) {
      if (email !== actor) items.push({ email, kind: "cancelled", page: "home", title: `${urgent}${who(side, name)} ยกเลิกคิว`, body: `${text}\nก่อนไลฟ์ ${leadText(before)} · slot กลับไปว่างแล้ว` });
    }

    // คู่ไลฟ์ (อีกฝั่ง เวลา + แพลตฟอร์มเดียวกัน ยังไม่ยกเลิก)
    const other: Side = side === "mc" ? "admin" : "mc";
    const { data: pairs } = await db.from(tableOf(other)).select(`person:${personCol(other)}, is_cancelled`)
      .eq("platform", s.platform).eq("starts_at", s.starts_at).eq("ends_at", s.ends_at)
      .not(personCol(other), "is", null).overrideTypes<{ person: number; is_cancelled: boolean }[], { merge: false }>();
    const pairIds = (pairs ?? []).filter((p) => !p.is_cancelled).map((p) => p.person);

    // คนอื่นที่จองแทนได้: Mc ที่ช่วงเปิดจองครอบวันนั้น / Admin เสริม (ไม่รวมทีม Shopee)
    let bookable: { id: number; email: string }[] = [];
    if (before > 0) {
      const [staff, settings] = await Promise.all([bookers(side), getSettings()]);
      bookable = staff.filter((p) => p.id !== actorId && inRange(bookingRange(settings, side, p.id), s.live_date));
    }

    const pairEmails = await emailsOf(pairIds);
    for (const id of pairIds) {
      const email = pairEmails.get(id);
      if (email && email !== actor) items.push({ email, kind: "cancelled", page: other, title: `${urgent}${who(side, name)} ยกเลิกคิวที่ไลฟ์คู่กับคุณ`, body: `${text}\nกำลังหาคนแทน` });
    }
    const already = new Set(items.map((x) => x.email));
    for (const p of bookable) {
      if (p.email !== actor && !already.has(p.email)) {
        items.push({ email: p.email, kind: "slot_open", page: side, title: `${urgent}มี slot ${roleLabel(side)} ว่าง: ${text}`, body: `มีคนยกเลิกคิวนี้ ${side === "mc" ? "จองได้" : "รับคิวได้"}ทางเว็บ ใครกดก่อนได้ก่อน` });
      }
    }
    return notifyMany(items);
  } catch (err) {
    console.error("แจ้งเตือนยกเลิกคิวไม่สำเร็จ:", err);
    return 0;
  }
}

/** การเปลี่ยน slot ที่ Owner ทำ (หน้าเว็บ / แก้ในชีต): คนก่อน → คนใหม่ / สถานะก่อน */
export type SlotChange = { id: number; oldPerson: number | null; newPerson: number | null; oldCancelled: boolean };

/**
 * Owner เปลี่ยนคน / แคนคิว → คนที่ได้คิว / เสียคิว (เฉพาะ slot ที่ยังไม่เริ่ม · ไม่แจ้งคนที่แก้เอง)
 *   คนเดียวได้หลายเรื่อง = รวมเป็นแจ้งเตือนเดียว
 */
export async function notifySlotChanges(table: Table, changes: SlotChange[], actorEmail = "") {
  try {
    if (!changes.length) return 0;
    const side = sideOf(table);
    const now = Date.now();
    const slots = new Map((await slotsOf(side, changes.map((c) => c.id))).map((s) => [s.id, s]));
    const emails = await emailsOf(changes.flatMap((c) => [c.oldPerson, c.newPerson]));
    const per = new Map<string, { added: Slot[]; removed: Slot[]; cancelled: Slot[] }>();
    const bucket = (id: number | null) => {
      const email = id ? emails.get(id) : undefined;
      if (!email || email === actorEmail.toLowerCase()) return null;
      if (!per.has(email)) per.set(email, { added: [], removed: [], cancelled: [] });
      return per.get(email)!;
    };
    for (const c of changes) {
      const s = slots.get(c.id);
      if (!s || Date.parse(s.starts_at) <= now) continue;
      if (c.oldPerson !== c.newPerson) {
        if (c.oldPerson) bucket(c.oldPerson)?.removed.push(s);
        if (c.newPerson && !s.is_cancelled) bucket(c.newPerson)?.added.push(s);
      } else if (c.newPerson && s.is_cancelled && !c.oldCancelled) {
        bucket(c.newPerson)?.cancelled.push(s);
      }
    }
    const items: (Note & { email: string })[] = [];
    for (const [email, b] of per) {
      const parts = [
        b.added.length ? `ได้รับคิวใหม่ ${b.added.length} slot:\n${listText(b.added)}` : "",
        b.removed.length ? `ถูกเอาออกจากคิว ${b.removed.length} slot:\n${listText(b.removed)}` : "",
        b.cancelled.length ? `คิวถูกยกเลิก (แคน) ${b.cancelled.length} slot:\n${listText(b.cancelled)}` : "",
      ].filter(Boolean);
      if (!parts.length) continue;
      const only = parts.length === 1;
      const title = !only ? `คิว ${roleLabel(side)} ของคุณมีการเปลี่ยนแปลง`
        : b.added.length ? `คุณได้รับคิว ${roleLabel(side)} ใหม่ ${b.added.length} slot`
          : b.removed.length ? `คุณถูกเอาออกจากคิว ${roleLabel(side)} ${b.removed.length} slot` : `คิว ${roleLabel(side)} ของคุณถูกยกเลิก ${b.cancelled.length} slot`;
      items.push({ email, kind: "changed", page: side, title, body: only ? parts[0].replace(/^[^\n]*\n/, "") : parts.join("\n\n") });
    }
    return notifyMany(items);
  } catch (err) {
    console.error("แจ้งเตือนเปลี่ยนคิวไม่สำเร็จ:", err);
    return 0;
  }
}

// ---------- slot ใหม่ / เปิดช่วงจอง ----------

const inRange = (r: BookRange, day: string) => !r.empty && day >= r.from && (r.to === null || day <= r.to);

/** slot ว่างที่ยังไม่เริ่ม (Admin = เฉพาะที่เปิดรับ Admin เสริม) · ids = เฉพาะ slot เหล่านี้ / ไม่ใส่ = ทั้งหมดตั้งแต่วันนี้ */
async function openFutureSlots(side: Side, ids?: number[]) {
  const now = Date.now();
  const cols = `id, platform, live_date, start_time, end_time, starts_at, ends_at, is_cancelled, confirmed, person:${personCol(side)}${side === "admin" ? ", needs_extra_admin" : ""}`;
  let q = createAdminClient().from(tableOf(side)).select(cols)
    .is(personCol(side), null).eq("is_cancelled", false).gte("live_date", bkkDay(now));
  if (ids) q = q.in("id", ids.slice(0, 1000));
  const { data, error } = await q.order("starts_at").limit(3000).overrideTypes<(Slot & { needs_extra_admin?: boolean })[], { merge: false }>();
  if (error) throw error;
  return (data ?? []).filter((s) => Date.parse(s.starts_at) > now && (side === "mc" || s.needs_extra_admin === true));
}

/** คนที่จองผ่านเว็บได้ของฝั่งนั้น (มีอีเมล · Admin = เฉพาะ Admin เสริม · ไม่รวมทีม Shopee ที่ยังจองคิว TikTok ไม่ได้) */
async function bookers(side: Side) {
  type Row = { id: number; email: string; live_platform?: string | null };
  const { data } = await withLiveTeam((extra) => {
    let q = createAdminClient().from("staff").select(`id, email${extra}`).eq("role", side).not("email", "is", null);
    if (side === "admin") q = q.eq("is_extra_admin", true);
    return q.overrideTypes<Row[], { merge: false }>();
  });
  return tiktokOnly(data ?? []).map((p) => ({ id: p.id as number, email: String(p.email).trim().toLowerCase() }));
}

/**
 * เจ้าของสร้าง slot ว่างใหม่ (ปุ่มสร้าง slot / Plan Slot Live / พิมพ์แถวใหม่ในชีต / เปิดรับ Admin เสริม)
 *   → Mc ที่ช่วงเปิดจองครอบวันนั้น / Admin เสริม · คนละ 1 ข้อความ (สร้างทีละเยอะ = รวมเป็นข้อความเดียว)
 *   slot นอกช่วงเปิดจองของคนนั้น = ไม่แจ้ง (จะได้แจ้งตอนเปิดช่วงจอง ดู notifyWindowOpened)
 */
export async function notifyNewSlots(side: Side, slotIds: number[], actorEmail = "") {
  try {
    if (!slotIds.length) return 0;
    const slots = await openFutureSlots(side, slotIds);
    if (!slots.length) return 0;
    const [people, settings] = await Promise.all([bookers(side), getSettings()]);
    const verb = side === "mc" ? "จอง" : "รับคิว";
    const items: (Note & { email: string })[] = [];
    for (const p of people) {
      if (p.email === actorEmail.toLowerCase()) continue;
      const range = bookingRange(settings, side, p.id);
      const mine = slots.filter((s) => inRange(range, s.live_date));
      if (mine.length) items.push({ email: p.email, kind: "slot_open", page: side, title: `มี slot ${roleLabel(side)} ใหม่เปิดให้${verb} ${mine.length} slot`, body: listText(mine) });
    }
    return notifyMany(items);
  } catch (err) {
    console.error("แจ้งเตือน slot ใหม่ไม่สำเร็จ:", err);
    return 0;
  }
}

/**
 * เจ้าของเปลี่ยนช่วงเปิดจอง / เดือนสุดท้ายที่เปิดจอง → คนที่ได้จองวันเพิ่ม และวันที่เพิ่มมามี slot ว่าง
 *   before / after = ค่าตั้งก่อน-หลังแก้ (เทียบช่วงของแต่ละคน รวมรายชื่อ "จองก่อน")
 */
export async function notifyWindowOpened(side: Side, before: Settings, after: Settings, actorEmail = "") {
  try {
    const [people, slots] = await Promise.all([bookers(side), openFutureSlots(side)]);
    if (!slots.length) return 0;
    const verb = side === "mc" ? "จอง" : "รับคิว";
    const items: (Note & { email: string })[] = [];
    for (const p of people) {
      if (p.email === actorEmail.toLowerCase()) continue;
      const was = bookingRange(before, side, p.id), now = bookingRange(after, side, p.id);
      const mine = slots.filter((s) => inRange(now, s.live_date) && !inRange(was, s.live_date));
      if (!mine.length) continue;
      items.push({
        email: p.email, kind: "slot_open", page: side,
        title: `เปิดให้${verb}แล้ว: slot ${roleLabel(side)} ว่าง ${mine.length} slot`,
        body: `ช่วงที่${verb}ได้: ${rangeText(now)}\n${listText(mine)}`,
      });
    }
    return notifyMany(items);
  } catch (err) {
    console.error("แจ้งเตือนเปิดช่วงจองไม่สำเร็จ:", err);
    return 0;
  }
}

/** slot ที่มีคน (ยังไม่ยกเลิก / ไม่ได้ปฏิเสธ) ในช่วงวันนี้ ของทั้งสองฝั่ง */
async function activeSlots(from: string, to: string) {
  const db = createAdminClient();
  const load = async (side: Side) => {
    const { data, error } = await db.from(tableOf(side))
      .select(`id, platform, live_date, start_time, end_time, starts_at, ends_at, is_cancelled, confirmed, person:${personCol(side)}`)
      .gte("live_date", from).lte("live_date", to).not(personCol(side), "is", null).eq("is_cancelled", false)
      .order("starts_at").limit(2000).overrideTypes<Slot[], { merge: false }>();
    if (error) throw error;
    return (data ?? []).filter((s) => s.confirmed !== false).map((s) => ({ ...s, side }));
  };
  const [mc, admin] = await Promise.all([load("mc"), load("admin")]);
  return [...mc, ...admin];
}

/**
 * เตือนก่อนไลฟ์ (cron ทุก 15 นาที) → เจ้าของคิว
 *   คืนก่อนวันไลฟ์: ตั้งแต่ 20:00 สรุปคิวพรุ่งนี้ทั้งหมด (คนละ 1 ข้อความ)
 *   ก่อนเริ่ม ~1 ชม.: ทีละ slot บอกคู่ไลฟ์ด้วย (slot ที่ต่อจากคิวก่อนหน้าของคนเดิมทันที = ไม่เตือน เพราะไลฟ์อยู่แล้ว)
 */
export async function sendPreLiveReminders(now = Date.now(), dryRun = false) {
  const today = bkkDay(now), tomorrow = addDays(today, 1);
  const slots = await activeSlots(addDays(today, -1), tomorrow);
  const emails = await emailsOf(slots.map((s) => s.person));
  const items: (Note & { email: string })[] = [];

  // คืนก่อนวันไลฟ์
  const bkkHour = new Date(now + 7 * 3600_000).getUTCHours();
  if (bkkHour >= EVENING_HOUR) {
    const per = new Map<string, typeof slots>();
    for (const s of slots) {
      const email = emails.get(s.person!);
      if (email && s.live_date === tomorrow) per.set(email, [...(per.get(email) ?? []), s]);
    }
    for (const [email, mine] of per) {
      mine.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      items.push({
        email, kind: "reminder", page: mine[0].side, dedupe: `eve:${tomorrow}`,
        title: `พรุ่งนี้มีไลฟ์ ${mine.length} คิว`,
        body: mine.map((s) => `${hm(s.start_time)}–${hm(s.end_time)} ${platformLabel(s.platform)}${s.side === "admin" && mine.some((x) => x.side === "mc") ? " (Admin)" : ""}`).join("\n"),
      });
    }
  }

  // ก่อนเริ่ม ~1 ชม.
  const continues = new Set(slots.map((s) => `${s.side}|${s.person}|${Date.parse(s.ends_at)}`));
  const names = new Map<number, string>();
  const soon = slots.filter((s) => {
    const left = Date.parse(s.starts_at) - now;
    return left > 0 && left <= SOON_MIN * 60_000 && !continues.has(`${s.side}|${s.person}|${Date.parse(s.starts_at)}`);
  });
  if (soon.length) {
    const { data } = await createAdminClient().from("staff").select("id, name").in("id", [...new Set(slots.map((s) => s.person!))]);
    for (const p of data ?? []) names.set(p.id, p.name);
  }
  for (const s of soon) {
    const email = emails.get(s.person!);
    if (!email) continue;
    const pair = slots.find((x) => x.side !== s.side && x.platform === s.platform && x.starts_at === s.starts_at && x.ends_at === s.ends_at);
    const pairName = pair ? names.get(pair.person!) : null;
    const mins = Math.max(1, Math.round((Date.parse(s.starts_at) - now) / 60_000));
    items.push({
      email, kind: "reminder", page: s.side, dedupe: `soon:${s.side}:${s.id}`,
      title: `อีก ${mins} นาทีไลฟ์ ${hm(s.start_time)}–${hm(s.end_time)} ${platformLabel(s.platform)}`,
      body: pairName ? `คู่ไลฟ์: ${s.side === "mc" ? pairName : `Mc ${pairName}`}` : `${s.side === "mc" ? "ยังไม่มี Admin" : "ยังไม่มี Mc"} ใน slot นี้`,
    });
  }
  // dryRun = ดูว่าจะส่งอะไร (ไม่ส่งจริง) ใช้ตรวจก่อน
  if (dryRun) return { sent: 0, checked: slots.length, items };
  return { sent: await notifyMany(items), checked: slots.length };
}

// ---------- งานค้างของแต่ละคน (cron ทุก 15 นาที) ----------

/** เตือนแนบหลักฐาน / กรอก GMV หลังไลฟ์จบกี่ชั่วโมง */
const PROOF_AFTER_H = 2;
/** สรุปงานค้างรายวัน / เตือนแชร์ปฏิทิน ตั้งแต่กี่โมง (เวลาไทย) */
const DAILY_HOUR = 10;

/**
 * หลักฐานไลฟ์ / GMV ที่ยังค้าง (เกณฑ์เดียวกับหน้าแรก: slot Mc ที่จบแล้วใน 7 วัน มีคน
 *   หลักฐาน = ไม่นับ Mc ประจำ · GMV = นับยอดที่กรอกรวมไว้ใน slot ถัดไปของ Mc คนเดียวกันแล้ว)
 *   คนรับผิดชอบ = Admin ของ slot นั้น (คนที่แนบหลักฐาน / กรอก GMV ในหน้าหลักฐานไลฟ์)
 */
async function overdueWork(now: number) {
  const db = createAdminClient();
  const today = bkkDay(now), from = addDays(today, -7);
  type McRow = Slot & { gmv: number | string | null; mc: { name: string; is_salaried: boolean | null } | null };
  const [mcRes, adminRes, proofs] = await Promise.all([
    db.from("mc_slots")
      .select("id, platform, live_date, start_time, end_time, starts_at, ends_at, is_cancelled, confirmed, gmv, person:mc_id, mc:staff!mc_id(name, is_salaried)")
      .eq("is_cancelled", false).not("mc_id", "is", null).gte("live_date", from).lte("live_date", today)
      .order("starts_at").limit(3000).overrideTypes<McRow[], { merge: false }>(),
    db.from("admin_slots").select("platform, starts_at, ends_at, admin_id, is_cancelled")
      .eq("is_cancelled", false).not("admin_id", "is", null).gte("live_date", from).lte("live_date", today).limit(3000),
    proofsBySlot(db, from, today),
  ]);
  if (mcRes.error) throw mcRes.error;
  const assigned = (mcRes.data ?? []).filter((r) => r.confirmed !== false);
  const covered = gmvCoverage(assigned.map((r) => ({
    id: r.id, platform: r.platform, startMs: Date.parse(r.starts_at), endMs: Date.parse(r.ends_at), gmv: r.gmv === null ? null : Number(r.gmv), who: r.person,
  })));
  const key = (x: { platform: string; starts_at: string; ends_at: string }) => `${x.platform}|${Date.parse(x.starts_at)}|${Date.parse(x.ends_at)}`;
  const adminOf = new Map((adminRes.data ?? []).map((a) => [key(a), a.admin_id as number]));
  return assigned.filter((r) => Date.parse(r.ends_at) <= now).map((r) => ({
    ...r,
    admin: adminOf.get(key(r)) ?? null,
    needProof: !r.mc?.is_salaried && !proofs.has(r.id),
    needGmv: r.gmv === null && !covered.has(r.id),
  }));
}
type Work = Awaited<ReturnType<typeof overdueWork>>[number];
const missText = (w: Work) => [w.needProof ? "หลักฐาน" : "", w.needGmv ? "GMV" : ""].filter(Boolean).join(" + ");

/** Owner ที่ดูแลหลักฐาน / GMV (จัดการฝั่ง Mc ได้ หรือติ๊กจัดการหลักฐานไลฟ์) */
async function proofOwnerEmails() {
  type Row = { email: string | null; can_manage_mc: boolean | null; can_manage_proofs: boolean | null };
  const { data } = await createAdminClient().from("staff").select("email, can_manage_mc, can_manage_proofs")
    .eq("role", "owner").not("email", "is", null).overrideTypes<Row[], { merge: false }>();
  return cleanEmails((data ?? []).filter((r) => r.can_manage_mc !== false || r.can_manage_proofs === true).map((r) => r.email));
}

/**
 * งานค้างของแต่ละคน (cron ทุก 15 นาที)
 *   หลังไลฟ์จบ ~2 ชม. ยังไม่แนบหลักฐาน / กรอก GMV → Admin ของ slot (ไลฟ์ต่อกันหลาย slot = เตือนครั้งเดียวตอนจบช่วง)
 *   ทุกวัน 10:00: ค้างเกิน 24 ชม. → Admin คนนั้น + สรุปรวมถึง Owner
 *   จันทร์ / พฤหัส 10:00: คิวยังไม่ขึ้นปฏิทิน (ยังไม่แชร์) → คนนั้น พร้อมลิงก์วิธีแชร์
 */
export async function sendWorkReminders(now = Date.now(), dryRun = false) {
  const today = bkkDay(now);
  const bkk = new Date(now + 7 * 3600_000);
  const daily = bkk.getUTCHours() >= DAILY_HOUR;
  const items: (Note & { email: string })[] = [];

  // ---- หลักฐาน / GMV ----
  const work = await overdueWork(now);
  const emails = await emailsOf(work.map((w) => w.admin));
  // ช่วงไลฟ์ต่อกันของ Admin คนเดียวกัน (ช่องเดียวกัน slot จบ = slot ถัดไปเริ่ม)
  const chains: Work[][] = [];
  const open = new Map<string, Work[]>();
  for (const w of [...work].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))) {
    const k = `${w.admin}|${w.platform}`, cur = open.get(k);
    if (cur && Date.parse(cur[cur.length - 1].ends_at) === Date.parse(w.starts_at)) cur.push(w);
    else { const c = [w]; chains.push(c); open.set(k, c); }
  }
  const line = (w: Work) => `${slotText(w)} · ขาด ${missText(w)}`;
  const late: Work[] = []; // ค้างเกิน 24 ชม.
  for (const c of chains) {
    const missing = c.filter((w) => w.needProof || w.needGmv);
    if (!missing.length) continue;
    const ago = now - Date.parse(c[c.length - 1].ends_at);
    if (ago >= 24 * 3600_000) late.push(...missing);
    const email = c[0].admin ? emails.get(c[0].admin) : undefined;
    if (!email || ago < PROOF_AFTER_H * 3600_000 || ago >= 24 * 3600_000) continue;
    items.push({
      email, kind: "proof", page: "proof", dedupe: `proof:${c[c.length - 1].id}`,
      title: `อย่าลืมแนบหลักฐาน / กรอก GMV ${missing.length} slot`,
      body: missing.map(line).join("\n"),
    });
  }
  if (daily && late.length) {
    // Admin แต่ละคน
    const per = new Map<string, Work[]>();
    for (const w of late) {
      const email = w.admin ? emails.get(w.admin) : undefined;
      if (email) per.set(email, [...(per.get(email) ?? []), w]);
    }
    for (const [email, mine] of per) {
      items.push({
        email, kind: "proof", page: "proof", dedupe: `proofday:${today}`,
        title: `[ค้าง] หลักฐาน / GMV เกิน 24 ชม. ${mine.length} slot`,
        body: mine.slice(0, 6).map(line).join("\n") + (mine.length > 6 ? `\nและอีก ${mine.length - 6} slot` : ""),
      });
    }
    // สรุปถึง Owner (แยกตาม Admin)
    const { data: staff } = await createAdminClient().from("staff").select("id, name").in("id", [...new Set(late.map((w) => w.admin).filter((x): x is number => !!x))]);
    const nameOf = new Map((staff ?? []).map((s) => [s.id as number, String(s.name)]));
    const byAdmin = new Map<string, number>();
    for (const w of late) {
      const n = w.admin ? nameOf.get(w.admin) ?? "–" : "(ยังไม่มี Admin)";
      byAdmin.set(n, (byAdmin.get(n) ?? 0) + 1);
    }
    for (const email of await proofOwnerEmails()) {
      items.push({
        email, kind: "proof", page: "home", dedupe: `proofowner:${today}`,
        title: `หลักฐาน / GMV ค้างเกิน 24 ชม. ${late.length} slot`,
        body: [...byAdmin].sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n}: ${k} slot`).join("\n"),
      });
    }
  }

  // ---- ยังไม่แชร์ปฏิทิน (จันทร์ / พฤหัส) ----
  const weekday = bkk.getUTCDay();
  if (daily && (weekday === 1 || weekday === 4)) {
    const counts = await missingCalendarCounts();
    const calEmails = await emailsOf([...counts.keys()]);
    for (const [id, n] of counts) {
      const email = calEmails.get(id);
      if (!email) continue;
      items.push({
        email, kind: "calendar", page: "guide", dedupe: `cal:${today}`,
        title: `คิวของคุณ ${n} คิวยังไม่ขึ้น Google Calendar`,
        body: "เพราะยังไม่ได้แชร์ปฏิทินให้ระบบ แตะเพื่อดูวิธีแชร์ (ใช้เวลา 2 นาที) แชร์แล้วคิวทั้งหมดจะขึ้นปฏิทินเอง",
      });
    }
  }

  if (dryRun) return { sent: 0, items };
  return { sent: await notifyMany(items), items: [] };
}

// ---------- แจ้ง Owner ทันที (cron ทุก 15 นาที) ----------

/** slot ว่างที่เหลือไม่ถึงกี่ชั่วโมงก่อนไลฟ์ = [ด่วน] */
const URGENT_OPEN_H = 6;
/** สรุปรายสัปดาห์ วันอาทิตย์ตั้งแต่กี่โมง (เวลาไทย) */
const WEEKLY_HOUR = 18;

/**
 * แจ้ง Owner ทันที (cron ทุก 15 นาที · ไม่แจ้งซ้ำเรื่องเดิม)
 *   [ด่วน] slot ยังไม่มี Mc / Admin และเหลือไม่ถึง 6 ชม. ก่อนไลฟ์ (ไลฟ์ต่อกันหลาย slot = ข้อความเดียว)
 *   ข้อมูลผิด: คนละคนซ้อน slot / แถวซ้ำในชีต / slot มีแถวฝั่งเดียว (เกณฑ์เดียวกับ "ข้อมูลที่ควรแก้" ในหน้าแรก)
 */
export async function sendOwnerAlerts(now = Date.now(), dryRun = false) {
  const db = createAdminClient();
  const today = bkkDay(now);
  const items: (Note & { email: string })[] = [];
  const owners = { mc: await ownerEmails("mc"), admin: await ownerEmails("admin") };

  // ---- slot ว่างใกล้ไลฟ์ ----
  for (const side of ["mc", "admin"] as const) {
    const { data, error } = await db.from(tableOf(side))
      .select("id, platform, live_date, start_time, end_time, starts_at, ends_at, confirmed")
      .is(personCol(side), null).eq("is_cancelled", false).gte("live_date", addDays(today, -1)).lte("live_date", addDays(today, 1))
      .order("starts_at").overrideTypes<Slot[], { merge: false }>();
    if (error) throw error;
    const open = (data ?? []).filter((s) => {
      const left = Date.parse(s.starts_at) - now;
      return s.confirmed !== false && left > 0 && left <= URGENT_OPEN_H * 3600_000;
    });
    // ไลฟ์ต่อกัน (ช่องเดียวกัน) = ข้อความเดียว
    const chains: Slot[][] = [];
    for (const s of open) {
      const c = chains.find((x) => x[x.length - 1].platform === s.platform && x[x.length - 1].ends_at === s.starts_at);
      if (c) c.push(s); else chains.push([s]);
    }
    for (const c of chains) {
      const h = Math.max(1, Math.round((Date.parse(c[0].starts_at) - now) / 3600_000));
      for (const email of owners[side]) {
        items.push({
          email, kind: "open_soon", page: "home", dedupe: `urgent:${side}:${c[0].id}`,
          title: `[ด่วน] slot ${roleLabel(side)} ยังว่าง อีก ${h} ชม. ไลฟ์`,
          body: `${c.map(slotText).join("\n")}\nยังไม่มี ${roleLabel(side)} — ควรหาคนแทนโดยตรง`,
        });
      }
    }
  }

  // ---- ช่วงเปิดจองใกล้หมด / หมดแล้ว (วันละครั้ง ตั้งแต่ 10:00 ไม่ปลุกกลางคืน) ----
  if (new Date(now + 7 * 3600_000).getUTCHours() >= DAILY_HOUR) {
    for (const w of windowAlerts(await getSettings(db), ["mc", "admin"])) {
      const when = w.ended ? `หมดแล้ว (วันสุดท้าย ${fmtDay(w.to)})` : w.daysLeft === 0 ? `หมดวันนี้ (${fmtDay(w.to)})` : `จะหมดในอีก ${w.daysLeft} วัน (วันสุดท้าย ${fmtDay(w.to)})`;
      for (const email of owners[w.role]) {
        items.push({
          email, kind: "window", page: "home", dedupe: `window:${w.role}:${today}`,
          title: `ช่วงเปิดจอง ${roleLabel(w.role)} ${when}`,
          body: `${w.ended ? `${roleLabel(w.role)} จองคิวใหม่ผ่านเว็บไม่ได้แล้ว` : `หลังวันสุดท้าย ${roleLabel(w.role)} จะจองคิวใหม่ผ่านเว็บไม่ได้`} — ตั้งช่วงเปิดจองรอบถัดไปที่หน้าเจ้าของ > ตาราง slot > รายวัน`,
        });
      }
    }
  }

  // ---- ข้อมูลผิด ----
  const health = await dataHealth({ mc: true, admin: true });
  const day = (d: string) => fmtDayShort.format(parseKey(d));
  const toOwners = (sides: Side[], key: string, title: string, body: string) => {
    const emails = sides.length === 2 ? owners.mc.filter((e) => owners.admin.includes(e)) : owners[sides[0]];
    for (const email of emails) items.push({ email, kind: "data", page: "home", dedupe: `health:${key}`, title, body });
  };
  for (const x of health.overlap) {
    toOwners([x.role], `overlap:${x.role}|${x.date}|${x.platform}|${x.time}|${x.names.join(",")}`,
      `ข้อมูลผิด: คนซ้อน slot ${roleLabel(x.role)}`, `${day(x.date)} ${x.time} ${x.platform}\n${x.names.join(" + ")} อยู่ช่องเดียวกันเวลาทับกัน (ชั่วโมง / ค่าจ้างนับทั้งคู่)`);
  }
  for (const x of health.selfOverlap) {
    toOwners([x.role], `self:${x.role}|${x.date}|${x.name}|${x.slots.join(",")}`,
      `ข้อมูลผิด: ${x.name} อยู่ ${x.slots.length} slot เวลาทับกัน`, `${day(x.date)}\n${x.slots.join("\n")}\nคนเดียวไลฟ์พร้อมกันไม่ได้ (ชั่วโมง / ค่าจ้างนับทุก slot) — เปลี่ยนคนใน slot ที่ไม่ได้ไลฟ์จริง`);
  }
  for (const x of health.dupRows) {
    toOwners([x.role], `dup:${x.role}|${x.date}|${x.platform}|${x.time}|${x.rows}`,
      `ข้อมูลผิด: แถวซ้ำในชีต ${roleLabel(x.role)}`, `${day(x.date)} ${x.time} ${x.platform}\n${x.rows} แถว (${x.note})`);
  }
  for (const x of health.noPair) {
    toOwners(["mc", "admin"], `nopair:${x.missing}|${x.date}|${x.platform}|${x.time}`,
      `ข้อมูลผิด: slot ขาดแถว ${roleLabel(x.missing)}`, `${day(x.date)} ${x.time} ${x.platform}\nมีแถวแค่ฝั่ง ${roleLabel(x.missing === "mc" ? "admin" : "mc")} (แท็บ Deal Mc กับ Admin เสริมไม่ตรงกัน)`);
  }

  if (dryRun) return { sent: 0, items };
  return { sent: await notifyMany(items), items: [] };
}

/**
 * สรุปรายสัปดาห์ (อาทิตย์ 18:00) → ทุกคนที่มีคิวสัปดาห์หน้า (จันทร์–อาทิตย์) คนละ 1 ข้อความ
 *   ไม่มีคิว = ไม่ส่ง · เป็นทั้ง Mc และ Admin = รวมกัน บอก (Admin) ท้ายคิว Admin
 */
export async function sendWeeklySummary(now = Date.now(), dryRun = false) {
  const bkk = new Date(now + 7 * 3600_000);
  if (bkk.getUTCDay() !== 0 || bkk.getUTCHours() < WEEKLY_HOUR) return { sent: 0, items: [] as (Note & { email: string })[] };
  const monday = addDays(bkkDay(now), 1), sunday = addDays(monday, 6);
  const slots = (await activeSlots(monday, sunday)).filter((s) => s.live_date >= monday);
  const emails = await emailsOf(slots.map((s) => s.person));
  const per = new Map<string, typeof slots>();
  for (const s of slots) {
    const email = emails.get(s.person!);
    if (email) per.set(email, [...(per.get(email) ?? []), s]);
  }
  const items: (Note & { email: string })[] = [];
  for (const [email, mine] of per) {
    mine.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    const mixed = new Set(mine.map((s) => s.side)).size > 1;
    const days = new Set(mine.map((s) => s.live_date)).size;
    const lines = mine.map((s) => `${slotText(s)}${mixed && s.side === "admin" ? " (Admin)" : ""}`);
    items.push({
      email, kind: "weekly", page: mine[0].side, dedupe: `week:${monday}`,
      title: `สัปดาห์หน้าคุณมีไลฟ์ ${mine.length} คิว (${days} วัน)`,
      body: lines.slice(0, 10).join("\n") + (lines.length > 10 ? `\nและอีก ${lines.length - 10} คิว` : ""),
    });
  }
  if (dryRun) return { sent: 0, items };
  return { sent: await notifyMany(items), items: [] };
}

/** เช้า: slot ยังว่างใน 48 ชม. → Owner ฝั่งนั้น (คนละ 1 ข้อความ ติ๊กสองฝั่ง = รวมกัน) */
export async function notifyOpenSoon(open: { mc: Pick<Slot, "live_date" | "start_time" | "end_time" | "platform">[]; admin: Pick<Slot, "live_date" | "start_time" | "end_time" | "platform">[] }, now = Date.now()) {
  try {
    const sidesOf = new Map<string, Side[]>();
    for (const side of ["mc", "admin"] as const) {
      if (!open[side].length) continue;
      for (const e of await ownerEmails(side)) sidesOf.set(e, [...(sidesOf.get(e) ?? []), side]);
    }
    const label = (s: Side) => (s === "mc" ? "Mc" : "Admin");
    return notifyMany([...sidesOf].map(([email, sides]) => ({
      email, kind: "open_soon" as const, page: "home" as const, dedupe: `open:${bkkDay(now)}`,
      title: `slot ยังว่างใน 48 ชม.: ${sides.map((s) => `${label(s)} ${open[s].length}`).join(" · ")}`,
      body: sides.map((s) => `ยังไม่มี ${label(s)}:\n${open[s].slice(0, 5).map(slotText).join("\n")}${open[s].length > 5 ? `\nและอีก ${open[s].length - 5} slot` : ""}`).join("\n\n"),
    })));
  } catch (err) {
    console.error("แจ้งเตือน slot ว่างไม่สำเร็จ:", err);
    return 0;
  }
}

/** ลบแจ้งเตือนเก่า (เกิน 60 วัน) */
export async function pruneNotifications(now = Date.now()) {
  await createAdminClient().from("notifications").delete().lt("created_at", new Date(now - 60 * 86400_000).toISOString());
}
