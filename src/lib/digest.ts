import "server-only";
import { fetchAll } from "@/lib/data";
import { fmtDayShort, parseKey } from "@/lib/format";
import { dataHealth, healthCount } from "@/lib/health";
import { escapeHtml as esc, sendMail } from "@/lib/mail";
import { cancelRecipients } from "@/lib/notify";
import { platformLabel } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/window";

/**
 * เมลสรุปทุกเช้า (cron ~07:00 เวลาไทย): slot ที่ยังไม่มี Mc / Admin ใน 48 ชม. ข้างหน้า
 *   ผู้รับ = Owner ที่ติ๊ก "รับอีเมลแจ้งยกเลิกคิว" ฝั่งนั้น (คนเดียวกับเมลแจ้งยกเลิก) ติ๊กทั้งสองฝั่ง = ได้ฉบับเดียวรวมกัน
 *   ไม่มี slot ว่างในฝั่งของคนนั้น = ไม่ส่ง (ท้ายเมลบอกจำนวน "ข้อมูลที่ควรแก้" ในหน้าแรกด้วย)
 */

const SITE = "https://glory-vital-live.vercel.app";
const HOURS = 48;
/** เริ่มไลฟ์ภายในกี่ชั่วโมง = ขึ้นสีแดง "ด่วน" */
const URGENT_HOURS = 24;

type Side = "mc" | "admin";
type Row = { id: number; platform: string; live_date: string; start_time: string; end_time: string; starts_at: string; confirmed: boolean | null };
const hm = (t: string) => t.slice(0, 5);
/** วันที่ (เวลาไทย) ของเวลานี้ */
const bkkDay = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);

/** slot ที่ยังไม่มีคน เริ่มภายใน 48 ชม. (ไม่นับแถวที่ยกเลิก / ไม่นับ) */
async function openSlots(side: Side, now: number) {
  const db = createAdminClient();
  const table = side === "mc" ? "mc_slots" : "admin_slots", col = side === "mc" ? "mc_id" : "admin_id";
  const today = bkkDay(now);
  const rows = await fetchAll<Row>((a, b) => db.from(table)
    .select("id, platform, live_date, start_time, end_time, starts_at, confirmed")
    .is(col, null).eq("is_cancelled", false).gte("live_date", addDays(today, -1)).lte("live_date", addDays(today, 3))
    .order("starts_at").range(a, b) as never);
  return rows.filter((r) => r.confirmed !== false && Date.parse(r.starts_at) > now && Date.parse(r.starts_at) <= now + HOURS * 3600_000);
}

/** ส่งเมลสรุปเช้า คืนจำนวนฉบับที่ส่ง */
export async function sendMorningDigest(now = Date.now()) {
  const { mails, open } = await morningDigest(now);
  let sent = 0;
  for (const m of mails) if (await sendMail(m.to, m.subject, m.html)) sent++;
  return { sent, open };
}

/** เมลสรุปเช้าที่จะส่ง (ยังไม่ส่ง) — ใช้ตรวจก่อนส่งจริงได้ */
export async function morningDigest(now = Date.now()) {
  const [mcTo, adminTo] = await Promise.all([cancelRecipients("mc"), cancelRecipients("admin")]);
  const sidesOf = new Map<string, Side[]>();
  for (const e of mcTo) sidesOf.set(e, ["mc"]);
  for (const e of adminTo) sidesOf.set(e, [...(sidesOf.get(e) ?? []), "admin"]);
  const mails: { to: string; subject: string; html: string }[] = [];
  if (!sidesOf.size) return { mails, open: { mc: 0, admin: 0 } };

  const open = { mc: mcTo.length ? await openSlots("mc", now) : [], admin: adminTo.length ? await openSlots("admin", now) : [] };
  // จำนวนข้อมูลที่ควรแก้ ตามฝั่งที่คนนั้นรับ (คำนวณครั้งเดียวต่อชุดฝั่ง)
  const issues = new Map<string, number>();
  const issueCount = async (sides: Side[]) => {
    const k = sides.join("+");
    if (!issues.has(k)) issues.set(k, await dataHealth({ mc: sides.includes("mc"), admin: sides.includes("admin") }).then(healthCount).catch(() => 0));
    return issues.get(k)!;
  };

  for (const [email, sides] of sidesOf) {
    const mine = sides.filter((s) => open[s].length);
    if (!mine.length) continue;
    mails.push({ to: email, ...digestMail(mine.map((s) => ({ side: s, rows: open[s] })), await issueCount(sides), now) });
  }
  return { mails, open: { mc: open.mc.length, admin: open.admin.length } };
}

function digestMail(parts: { side: Side; rows: Row[] }[], issues: number, now: number) {
  const day = fmtDayShort.format(parseKey(bkkDay(now)));
  const label = (s: Side) => (s === "mc" ? "Mc" : "Admin");
  const subject = `สรุปเช้า ${day}: slot ยังว่างใน ${HOURS} ชม. — ${parts.map((p) => `${label(p.side)} ${p.rows.length}`).join(" · ")}`;
  const section = ({ side, rows }: { side: Side; rows: Row[] }) => {
    const items = rows.map((r) => {
      const urgent = Date.parse(r.starts_at) - now <= URGENT_HOURS * 3600_000;
      return `<tr>
<td style="padding:3px 12px 3px 0;white-space:nowrap">${esc(fmtDayShort.format(parseKey(r.live_date)))}</td>
<td style="padding:3px 12px 3px 0;white-space:nowrap;font-weight:700">${hm(r.start_time)}–${hm(r.end_time)}</td>
<td style="padding:3px 12px 3px 0">${esc(platformLabel(r.platform))}</td>
<td style="padding:3px 0;color:#c0262d;font-weight:700">${urgent ? `ภายใน ${URGENT_HOURS} ชม.` : ""}</td>
</tr>`;
    }).join("\n");
    return `<h3 style="margin:16px 0 6px;font-size:16px">ยังไม่มี ${label(side)} · ${rows.length} slot</h3>
<table style="border-collapse:collapse">${items}</table>`;
  };
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#2a1a22;line-height:1.5">
<p style="margin:0">slot ที่เริ่มไลฟ์ภายใน ${HOURS} ชม. ข้างหน้า แต่ยังไม่มีคน — ${parts.map((p) => (p.side === "mc" ? "Mc จองได้ทางเว็บ" : "Admin เสริมรับคิวได้ทางเว็บ")).join(" · ")} ถ้าใกล้เวลาควรหาคนโดยตรง</p>
${parts.map(section).join("\n")}
${issues ? `<p style="margin:16px 0 0">หน้าแรกมี <b>ข้อมูลที่ควรแก้ ${issues} เรื่อง</b> (เช่น คนซ้อน slot, แถวซ้ำ, ปฏิทินยังไม่แชร์)</p>` : ""}
<p style="margin:12px 0 0"><a href="${SITE}" style="color:#b0306a;font-weight:700">เปิดหน้าแรก</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#8a7a82">อีเมลอัตโนมัติจาก GLORY VITAL Live · ส่งทุกเช้าเฉพาะวันที่มี slot ว่าง ถึงคนที่ตั้งรับอีเมลแจ้งยกเลิกคิว (หน้าพนักงาน &gt; Owner)</p>
</div>`;
  return { subject, html };
}
