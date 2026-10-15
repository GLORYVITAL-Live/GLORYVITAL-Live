import "server-only";
import webpush from "web-push";
import { bookingRange, getSettings } from "@/lib/data";
import { fmtDayShort, parseKey } from "@/lib/format";
import { platformLabel } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/window";

/**
 * แจ้งเตือนในเว็บ (กระดิ่ง) + เด้งเข้ามือถือ (Web Push) — SQL 20261028000000_notifications
 *   ทุกเรื่องบันทึกลงกระดิ่งของผู้รับ (ผูกกับอีเมลที่ login) แล้วเด้งไปทุกเครื่องที่คนนั้นกดเปิดแจ้งเตือนไว้
 *   เด้งต้องมี VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (ไม่มี = มีแค่กระดิ่ง) · ยังไม่ได้รัน SQL = ข้ามเงียบๆ
 *   ทุกฟังก์ชันไม่ throw: ส่งไม่ได้ไม่กระทบงานหลัก (จอง / ยกเลิก / แก้ slot)
 *
 * เรื่องที่แจ้ง
 *   booked     มีคนจองคิว / รับคิว                → Owner ที่จัดการฝั่งนั้น
 *   cancelled  Mc / Admin เสริมกดยกเลิกคิว         → Owner ฝั่งนั้น + คู่ไลฟ์ของ slot นั้น
 *   slot_open  slot ว่างเพราะมีคนยกเลิก            → Mc (ที่จองวันนั้นได้) / Admin เสริม คนอื่น
 *   changed    Owner เปลี่ยนคน / แคนคิว (เว็บ / ชีต) → คนที่ได้ / เสียคิว
 *   reminder   คืนก่อนวันไลฟ์ (20:00) + ก่อนเริ่ม ~1 ชม. → เจ้าของคิว (cron ทุก 15 นาที)
 *   open_soon  slot ยังว่างใน 48 ชม. (เช้า)           → Owner ฝั่งนั้น
 */

export type NoteKind = "booked" | "cancelled" | "slot_open" | "changed" | "reminder" | "open_soon" | "test";
export type NotePage = "home" | "owner" | "mc" | "admin";
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
          title: n.title, body: n.body, url: n.page ? `/?go=${n.page}` : "/", tag: `n${n.id}`,
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

    // คนอื่นที่จองแทนได้: Mc ที่ช่วงเปิดจองครอบวันนั้น / Admin เสริม
    let bookable: { id: number; email: string }[] = [];
    if (before > 0) {
      let q = db.from("staff").select("id, email").eq("role", side).not("email", "is", null).neq("id", actorId);
      if (side === "admin") q = q.eq("is_extra_admin", true);
      const [{ data: staff }, settings] = await Promise.all([q, getSettings()]);
      bookable = (staff ?? []).filter((p) => {
        const r = bookingRange(settings, side, p.id);
        return !r.empty && s.live_date >= r.from && (r.to === null || s.live_date <= r.to);
      }).map((p) => ({ id: p.id, email: String(p.email).trim().toLowerCase() }));
    }

    const pairEmails = await emailsOf(pairIds);
    for (const id of pairIds) {
      const email = pairEmails.get(id);
      if (email && email !== actor) items.push({ email, kind: "cancelled", page: other, title: `${urgent}${who(side, name)} ยกเลิกคิวที่ไลฟ์คู่กับคุณ`, body: `${text}\nกำลังหาคนแทน` });
    }
    const already = new Set(items.map((x) => x.email));
    for (const p of bookable) {
      if (p.email !== actor && !already.has(p.email)) {
        items.push({ email: p.email, kind: "slot_open", page: side, title: `${urgent}มี slot ว่าง: ${text}`, body: `มีคนยกเลิกคิวนี้ ${side === "mc" ? "จองได้" : "รับคิวได้"}ทางเว็บ ใครกดก่อนได้ก่อน` });
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
      const title = !only ? "คิวของคุณมีการเปลี่ยนแปลง"
        : b.added.length ? `คุณได้รับคิวใหม่ ${b.added.length} slot`
          : b.removed.length ? `คุณถูกเอาออกจากคิว ${b.removed.length} slot` : `คิวของคุณถูกยกเลิก ${b.cancelled.length} slot`;
      items.push({ email, kind: "changed", page: side, title, body: only ? parts[0].replace(/^[^\n]*\n/, "") : parts.join("\n\n") });
    }
    return notifyMany(items);
  } catch (err) {
    console.error("แจ้งเตือนเปลี่ยนคิวไม่สำเร็จ:", err);
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
