import { fail, ok, requireMe } from "@/lib/api";
import { CALENDAR_SHARE_TO, calendarAccess, enqueueMissingCalendar, processCalendarJobs } from "@/lib/calendar";

// ปุ่ม "แชร์แล้ว เช็กเลย" (Mc / Admin เสริม) — POST { role }
//   ถาม Google ว่าบัญชีระบบเขียนปฏิทินของคนนี้ได้แล้วหรือยัง ได้แล้ว = ลงคิวที่ยังไม่มีนัดให้ทันที
export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const role = body?.role === "admin" ? "admin" : "mc";
  const person = role === "mc" ? r.me.mc : r.me.admin;
  if (!person) return fail("บัญชีนี้ไม่มีคิวของฝั่งนี้", 403);

  const access = await calendarAccess(r.me.email);
  if (access === "skip") return ok({ access, message: "อีเมลนี้ระบบไม่ได้ลงนัดในปฏิทินให้ (อีเมลในองค์กร) ดูคิวจากเว็บได้เลย" });
  if (access === "error") return fail("ตรวจปฏิทินไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่", 502);
  if (access === "none") {
    return ok({ access, message: `ยังไม่เห็นปฏิทินของคุณ — ตรวจว่าแชร์ให้ ${CALENDAR_SHARE_TO} แล้ว และกด "บันทึก" (บางครั้ง Google ใช้เวลา 1–2 นาที)` });
  }
  if (access === "readonly") {
    return ok({ access, message: `แชร์แล้ว แต่สิทธิ์ยังเป็น "ดูอย่างเดียว" — เปลี่ยนสิทธิ์ของ ${CALENDAR_SHARE_TO} เป็น "แก้ไขและดูรายละเอียดทั้งหมดของกิจกรรม"` });
  }

  // แชร์ถูกต้องแล้ว: ลงคิวที่ค้างให้ทันที (ส่วนที่ไม่ทันในรอบนี้ ระบบทำต่อเอง)
  const queued = await enqueueMissingCalendar(role, person.id);
  const res = queued ? await processCalendarJobs(30, 20_000) : null;
  return ok({
    access,
    queued,
    done: res?.done ?? 0,
    message: queued ? `เชื่อมปฏิทินสำเร็จ ✓ กำลังลง ${queued} คิวในปฏิทินของคุณ` : "เชื่อมปฏิทินสำเร็จ ✓ คิวของคุณอยู่ในปฏิทินครบแล้ว",
  });
}
