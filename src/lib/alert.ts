import { escapeHtml, sendMail } from "@/lib/mail";

/**
 * แจ้งทางอีเมลเมื่อเว็บจริงเกิด error ฝั่งเซิร์ฟเวอร์ (ส่งเข้ากล่องเมลบัญชีระบบ)
 *   เรียกจาก instrumentation.ts (error ที่ไม่ได้ดักไว้) และ fail(..., 500) ใน src/lib/api.ts
 *   ส่งเฉพาะเว็บจริง (Render / Vercel ที่เป็น production · localhost ไม่ส่ง) · กันเมลรัว: error เดียวกันไม่เกิน 1 ฉบับต่อ 30 นาที และรวมไม่เกิน 10 ฉบับต่อชั่วโมง
 *   (นับแยกต่อเครื่องเซิร์ฟเวอร์ ถ้าเว็บแตกหลายเครื่องอาจได้ซ้ำบ้าง)
 */

const ALERT_TO = "kunraroj.d@glorythailand.com";
const SAME_ERROR_MS = 30 * 60_000;
const MAX_PER_HOUR = 10;

const sentAt = new Map<string, number>();
let hourStart = 0, hourCount = 0;

/** error ที่ไม่ต้องแจ้ง: redirect / not found ของ Next.js และผู้ใช้ปิดหน้าก่อนโหลดเสร็จ */
const IGNORE = /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|aborted|AbortError|ECONNRESET/i;

export async function alertError(o: { where: string; message: string; digest?: string }) {
  const live = (process.env.RENDER === "true" && process.env.IS_PULL_REQUEST !== "true") || process.env.VERCEL_ENV === "production";
  if (!live || IGNORE.test(o.message)) return;
  const now = Date.now();
  const key = `${o.where}|${o.message.slice(0, 160)}`;
  if (now - (sentAt.get(key) ?? 0) < SAME_ERROR_MS) return;
  if (now - hourStart > 3600_000) { hourStart = now; hourCount = 0; }
  if (hourCount >= MAX_PER_HOUR) return;
  sentAt.set(key, now);
  hourCount++;
  const when = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(now);
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b5560;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`;
  try {
    await sendMail(ALERT_TO, `[เว็บ error] ${o.where}`.slice(0, 120), `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#2a1a22;line-height:1.5">
<p style="margin:0 0 10px"><b>GLORY VITAL Live เกิด error ฝั่งเซิร์ฟเวอร์</b></p>
<table style="border-collapse:collapse;margin:0 0 10px">
${row("เวลา", when)}
${row("ที่", o.where)}
${row("ข้อความ", o.message.slice(0, 600))}
${o.digest ? row("รหัส", o.digest) : ""}
</table>
<p style="margin:0;font-size:12px;color:#8a7a82">ดูรายละเอียดเต็มได้ที่ Vercel &gt; โปรเจกต์ &gt; Logs (ค้นด้วยเวลาหรือรหัสด้านบน) · error เดียวกันจะไม่แจ้งซ้ำภายใน 30 นาที</p>
</div>`);
  } catch {
    // แจ้งไม่ได้ก็ไม่เป็นไร (ไม่ให้กระทบงานหลัก)
  }
}
