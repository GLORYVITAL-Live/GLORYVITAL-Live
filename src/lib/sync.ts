import "server-only";
import { processCalendarJobs } from "@/lib/calendar";
import { processSheetJobs } from "@/lib/sheet-sync";

/** ทำงานค้างทั้งหมดหลังตอบผู้ใช้แล้ว: ลงปฏิทิน + เขียนชีต (พลาดอย่างหนึ่งไม่กระทบอีกอย่าง) */
export async function processSyncJobs() {
  const [calendar, sheet] = await Promise.allSettled([processCalendarJobs(), processSheetJobs()]);
  if (calendar.status === "rejected") console.warn("ลงปฏิทินไม่สำเร็จ:", calendar.reason);
  if (sheet.status === "rejected") console.warn("เขียนชีตไม่สำเร็จ:", sheet.reason);
  return {
    calendar: calendar.status === "fulfilled" ? calendar.value : { error: String(calendar.reason) },
    sheet: sheet.status === "fulfilled" ? sheet.value : { error: String(sheet.reason) },
  };
}
