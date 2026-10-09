/**
 * ตรวจ / ทดสอบอีเมลแจ้งเตือนยกเลิกคิว
 *
 *   bun run mail:test          ตรวจว่าบัญชีระบบอนุญาตสิทธิ์ส่งอีเมลแล้วหรือยัง + แสดงตัวอย่างอีเมล (ยังไม่ส่ง)
 *   bun run mail:test --send   ส่งอีเมลทดสอบ 1 ฉบับ (จากการยกเลิกล่าสุดจริง หัวเรื่องขึ้น [ทดสอบ])
 */
import { googleAuth } from "@/lib/google";
import { NOTIFY_TO, cancelMail, sendMail } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/server";

const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

const auth = googleAuth();
if (!auth || !("getAccessToken" in auth)) {
  console.error("ยังไม่ได้เชื่อมบัญชี Google ของระบบ (ไม่มี GOOGLE_REFRESH_TOKEN ใน .env.local)");
  process.exit(1);
}
const { token } = await auth.getAccessToken();
const info = token ? await auth.getTokenInfo(token).catch(() => null) : null;
const canSend = !!info?.scopes.includes(SEND_SCOPE);
console.log(canSend ? "✓ อนุญาตสิทธิ์ส่งอีเมลแล้ว" : "✗ ยังไม่ได้อนุญาตสิทธิ์ส่งอีเมล — รัน bun run google:auth แล้ว login ด้วยบัญชีระบบ กดอนุญาต");

// ตัวอย่างจากการยกเลิกผ่านเว็บครั้งล่าสุด
const { data: log } = await createAdminClient().from("booking_logs")
  .select("email, name, action, slot_table, slot_id, at")
  .in("action", ["ยกเลิกคิว", "ยกเลิกคิว Admin"]).eq("result", "สำเร็จ")
  .order("id", { ascending: false }).limit(1).maybeSingle();
if (!log) { console.log("ยังไม่มีประวัติการยกเลิกให้ทำตัวอย่าง"); process.exit(0); }
const role = log.slot_table === "admin_slots" ? "admin" : "mc";
const mail = await cancelMail({
  role, name: String(log.name).replace(/^mc\s*/i, ""), email: log.email, slotId: Number(log.slot_id), at: new Date(log.at),
});
if (!mail) { console.log("ไม่พบ slot ของการยกเลิกล่าสุด (อาจถูกลบไปแล้ว)"); process.exit(0); }
console.log(`\nถึง: ${NOTIFY_TO}\nหัวเรื่อง: ${mail.subject}\n`);
console.log(mail.html.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim());

if (process.argv.includes("--send")) {
  if (!canSend) process.exit(1);
  const ok = await sendMail(NOTIFY_TO, `[ทดสอบ] ${mail.subject}`, mail.html);
  console.log(ok ? `\n✓ ส่งอีเมลทดสอบไปที่ ${NOTIFY_TO} แล้ว` : "\n✗ ส่งไม่สำเร็จ (ดูข้อความด้านบน)");
}
