import "server-only";
import { google } from "googleapis";
import { fmtDayLong, parseKey } from "@/lib/format";
import { googleAuth } from "@/lib/google";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * แจ้งเตือนทางอีเมล
 *   ส่งจากบัญชี Google ของระบบ (บัญชีเดียวกับที่ลงปฏิทิน ดู src/lib/google.ts) ด้วย Gmail API
 *   ต้องอนุญาตสิทธิ์ "ส่งอีเมล" (gmail.send) ให้บัญชีระบบก่อน: รัน `bun run google:auth` ใหม่
 *   แล้วอัปเดต GOOGLE_REFRESH_TOKEN ใน Vercel — ยังไม่อนุญาต = ไม่ส่ง (งานอื่นทำงานปกติ)
 */

/**
 * กล่องเมลของบัญชีระบบ: ใช้ส่งเมลทดสอบ (bun run mail:test) และใช้แทนผู้รับเมื่อยังไม่ได้รัน SQL 20261020000000_notify_cancel
 * ผู้รับจริงตั้งในหน้าพนักงาน > Owner > "รับอีเมลแจ้งยกเลิกคิว" (staff.notify_cancel_mc / notify_cancel_admin)
 */
export const NOTIFY_TO = "kunraroj.d@glorythailand.com";
const SITE = "https://glory-vital-live.vercel.app";
/** ยกเลิกก่อนไลฟ์ไม่ถึงกี่ชั่วโมง = ขึ้น [ด่วน] ที่หัวเรื่อง */
const URGENT_HOURS = 48;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hm = (t: string) => String(t).slice(0, 5);

/** ส่งอีเมล HTML (หัวเรื่องภาษาไทยได้) จากบัญชีระบบ ถึงผู้รับหลายคนในฉบับเดียว · ส่งไม่ได้ = คืน false ไม่ throw */
export async function sendMail(to: string | string[], subject: string, html: string) {
  const auth = googleAuth();
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!auth || !list.length) return false;
  const mime = [
    `To: ${list.join(", ")}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(html).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  try {
    await google.gmail({ version: "v1", auth }).users.messages.send({
      userId: "me",
      requestBody: { raw: Buffer.from(mime, "utf8").toString("base64url") },
    });
    return true;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(/insufficient|scope|permission/i.test(msg)
      ? "ส่งอีเมลแจ้งเตือนไม่ได้: บัญชี Google ของระบบยังไม่ได้อนุญาตสิทธิ์ส่งอีเมล (รัน bun run google:auth ใหม่ แล้วอัปเดต GOOGLE_REFRESH_TOKEN)"
      : `ส่งอีเมลแจ้งเตือนไม่สำเร็จ: ${msg}`);
    return false;
  }
}

/** ระยะเวลาก่อนไลฟ์ เช่น "3 วัน 4 ชม." / "5 ชม." */
function leadText(ms: number) {
  const h = Math.max(0, Math.floor(ms / 3600_000));
  return h >= 24 ? `${Math.floor(h / 24)} วัน${h % 24 ? ` ${h % 24} ชม.` : ""}` : `${h} ชม.`;
}

type CancelInfo = { role: "mc" | "admin"; name: string; email: string; slotId: number; at?: Date };

/**
 * แจ้งเตือนเมื่อ Mc / Admin เสริมกดยกเลิกคิวผ่านเว็บ (เรียกหลังยกเลิกสำเร็จ — slot ว่างแล้ว)
 *   บอก: ใครยกเลิก / คิวไหน / ก่อนไลฟ์นานแค่ไหน / คู่ไลฟ์ของ slot นั้น / ต้องหาคนแทน
 */
export async function notifyCancel(c: CancelInfo) {
  try {
    const to = await cancelRecipients(c.role);
    if (!to.length) return false; // ไม่มีใครตั้งรับเมลฝั่งนี้
    const mail = await cancelMail(c);
    return mail ? await sendMail(to, mail.subject, mail.html) : false;
  } catch (err) {
    console.error("แจ้งเตือนยกเลิกคิวไม่สำเร็จ:", err);
    return false;
  }
}

/**
 * ผู้รับเมลแจ้งยกเลิกของฝั่งนี้: Owner ที่ติ๊ก "รับอีเมลแจ้งยกเลิกคิว" ฝั่งนั้น มีอีเมล และยังมีสิทธิ์ฝั่งนั้น (ดูได้ / จัดการได้)
 *   ยังไม่ได้รัน SQL 20261020000000_notify_cancel = ส่งเข้ากล่องเมลระบบ (NOTIFY_TO) เหมือนเดิม
 */
export async function cancelRecipients(role: "mc" | "admin") {
  type Row = { email: string | null; can_manage: boolean | null; can_view: boolean | null };
  const { data, error } = await createAdminClient().from("staff")
    .select(`email, can_manage:can_manage_${role}, can_view:can_view_${role}`)
    .eq("role", "owner").eq(`notify_cancel_${role}`, true)
    .overrideTypes<Row[], { merge: false }>();
  if (error) {
    if (!/notify_cancel/.test(error.message)) console.error("อ่านผู้รับเมลแจ้งยกเลิกไม่สำเร็จ:", error.message);
    return [NOTIFY_TO];
  }
  // สิทธิ์ฝั่งนี้: จัดการได้ (ค่าว่าง = จัดการได้ ตาม src/lib/auth.ts) หรือดูได้
  const emails = (data ?? []).filter((r) => r.email && (r.can_manage !== false || r.can_view === true))
    .map((r) => r.email!.trim().toLowerCase());
  return [...new Set(emails)];
}

/** หัวเรื่อง + เนื้อหาอีเมลแจ้งยกเลิกคิว (null = ไม่พบ slot) */
export async function cancelMail(c: CancelInfo) {
  const db = createAdminClient();
  const table = c.role === "mc" ? "mc_slots" : "admin_slots";
  const { data: s } = await db.from(table)
    .select("platform, live_date, start_time, end_time, starts_at, ends_at")
    .eq("id", c.slotId).maybeSingle();
  if (!s) return null;

  // คู่ไลฟ์ของ slot นี้ (อีกฝั่ง เวลา + แพลตฟอร์มเดียวกัน ที่ยังไม่ยกเลิก)
  const otherTable = c.role === "mc" ? "admin_slots" : "mc_slots";
  const otherCol = c.role === "mc" ? "admin_id" : "mc_id";
  type Pair = { is_cancelled: boolean; confirmed: boolean | null; person: { name: string; phone: string | null } | null };
  const { data: pairs } = await db.from(otherTable)
    .select(`is_cancelled, confirmed, person:staff!${otherCol}(name, phone)`)
    .eq("platform", s.platform).eq("starts_at", s.starts_at).eq("ends_at", s.ends_at)
    .not(otherCol, "is", null)
    .overrideTypes<Pair[], { merge: false }>();
  const pair = (pairs ?? []).find((p) => p.person && !p.is_cancelled && p.confirmed !== false)?.person ?? null;

  const at = c.at ?? new Date();
  const before = Date.parse(s.starts_at) - at.getTime();
  const urgent = before < URGENT_HOURS * 3600_000;
  const roleLabel = c.role === "mc" ? "Mc" : "Admin เสริม";
  const who = c.role === "mc" ? `Mc ${c.name.replace(/^mc\s*/i, "")}` : c.name;
  const day = fmtDayLong.format(parseKey(String(s.live_date)));
  const time = `${hm(s.start_time)}–${hm(s.end_time)}`;
  const pairText = pair
    ? `${c.role === "mc" ? "Admin" : "Mc"} ของ slot นี้: ${c.role === "mc" ? pair.name : `Mc ${pair.name}`}${pair.phone ? ` (${pair.phone})` : ""}`
    : `slot นี้ยังไม่มี ${c.role === "mc" ? "Admin" : "Mc"}`;
  const stamp = new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok",
  }).format(at);

  const subject = `${urgent ? "[ด่วน] " : ""}ยกเลิกคิว ${who} · ${day} ${time} ${s.platform}`;
  const row = (k: string, v: string, strong = false) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b5560;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;${strong ? "font-weight:700" : ""}">${esc(v)}</td></tr>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#2a1a22;line-height:1.5">
<p style="margin:0 0 12px"><b>${esc(who)}</b> (${roleLabel}) กดยกเลิกคิวผ่านเว็บ${urgent ? ` <span style="color:#c0262d;font-weight:700">— เหลือเวลาก่อนไลฟ์ไม่ถึง ${URGENT_HOURS} ชม.</span>` : ""}</p>
<table style="border-collapse:collapse;margin:0 0 12px">
${row("คิว", `${day} ${time}`, true)}
${row("แพลตฟอร์ม", s.platform, true)}
${row("ยกเลิกเมื่อ", `${stamp} (ก่อนไลฟ์ ${leadText(before)})`)}
${row("คู่ไลฟ์", pairText)}
${row("อีเมลผู้ยกเลิก", c.email)}
</table>
<p style="margin:0 0 12px">slot นี้กลับไปว่างแล้ว ${c.role === "mc" ? "Mc คนอื่นจองแทนได้ทางเว็บ" : "Admin เสริมคนอื่นรับคิวแทนได้ทางเว็บ"} — ถ้าใกล้เวลาไลฟ์ ควรหาคนแทนโดยตรง</p>
<p style="margin:0"><a href="${SITE}" style="color:#b0306a;font-weight:700">เปิดตาราง slot</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#8a7a82">อีเมลอัตโนมัติจาก GLORY VITAL Live</p>
</div>`;
  return { subject, html };
}
