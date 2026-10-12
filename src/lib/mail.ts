import { google } from "googleapis";
import { googleAuth } from "@/lib/google";

/**
 * ส่งอีเมลจากบัญชี Google ของระบบ (Gmail API สิทธิ์ gmail.send — ดู src/lib/google.ts)
 *   แยกจาก notify.ts (ไม่มี "server-only") เพื่อให้ instrumentation.ts เรียกใช้ได้ด้วย
 */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** ส่งอีเมล HTML (หัวเรื่องภาษาไทยได้) ถึงผู้รับหลายคนในฉบับเดียว · ส่งไม่ได้ = คืน false ไม่ throw */
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
      ? "ส่งอีเมลไม่ได้: บัญชี Google ของระบบยังไม่ได้อนุญาตสิทธิ์ส่งอีเมล (รัน bun run google:auth ใหม่ แล้วอัปเดต GOOGLE_REFRESH_TOKEN)"
      : `ส่งอีเมลไม่สำเร็จ: ${msg}`);
    return false;
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
