import { NextResponse } from "next/server";
import { pruneNotifications, sendPreLiveReminders, sendWorkReminders } from "@/lib/notifications";

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
    const work = await sendWorkReminders().then((x) => ({ sent: x.sent })).catch((err) => ({ error: String((err as Error)?.message ?? err) }));
    await pruneNotifications().catch(() => undefined);
    return NextResponse.json({ ok: true, reminders, work });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
