import { NextResponse } from "next/server";
import { pruneNotifications, sendOwnerAlerts, sendPreLiveReminders, sendWeeklySummary, sendWorkReminders } from "@/lib/notifications";
import { sendLoanReminders } from "@/lib/loans-db";
import { sendReceiptReminders } from "@/lib/receipts-db";
import { processSheetJobs } from "@/lib/sheet-sync";

export const maxDuration = 60;

// เตือนก่อนไลฟ์ — GitHub Actions เรียกทุก 15 นาที (.github/workflows/notify.yml)
//   ต้องส่ง header  Authorization: Bearer <CRON_SECRET>  (ค่าเดียวกับใน Vercel ใส่ไว้ใน GitHub > Settings > Secrets)
//   Vercel cron แบบฟรีรันได้วันละครั้ง จึงใช้ GitHub เรียกแทน (เวลาอาจคลาด 5–15 นาที)
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const reminders = await sendPreLiveReminders();
    // งานค้าง (หลักฐาน / GMV / ยังไม่แชร์ปฏิทิน) — พลาดไม่กระทบเตือนก่อนไลฟ์
    const fail = (err: unknown) => ({ error: String((err as Error)?.message ?? err) });
    const work = await sendWorkReminders().then((x) => ({ sent: x.sent })).catch(fail);
    // แจ้ง Owner ทันที (slot ว่างใกล้ไลฟ์ / ข้อมูลผิด) + สรุปรายสัปดาห์ (อาทิตย์เย็น)
    const owner = await sendOwnerAlerts().then((x) => ({ sent: x.sent })).catch(fail);
    const weekly = await sendWeeklySummary().then((x) => ({ sent: x.sent })).catch(fail);
    // ยังไม่ส่งเอกสารรับเงิน (เดือนที่บังคับ) → เตือนทุก 3 วัน
    const receipt = await sendReceiptReminders().then((x) => ({ sent: x.sent })).catch(fail);
    // ยืมอุปกรณ์: ใกล้ถึง / เลยกำหนดคืน → ผู้ยืม (+ คนที่อนุมัติได้ ถ้าเลยกำหนด)
    const loans = await sendLoanReminders().then((sent) => ({ sent })).catch(fail);
    // งานเขียนชีตที่ค้าง (เช่น แท็บเปิดตัวกรองอยู่ตอนเพิ่ม slot) → ลองใหม่ทุก 15 นาที
    const sheet = await processSheetJobs().catch(fail);
    await pruneNotifications().catch(() => undefined);
    return NextResponse.json({ ok: true, reminders, work, owner, weekly, receipt, loans, sheet });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
