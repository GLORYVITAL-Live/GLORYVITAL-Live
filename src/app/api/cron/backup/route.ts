import { NextResponse } from "next/server";
import { alertError } from "@/lib/alert";
import { backupToDrive } from "@/lib/backup";

export const maxDuration = 60;

// สำรองข้อมูลรายสัปดาห์ลง Google Drive (vercel.json: วันจันทร์ ~04:00 เวลาไทย) ต้องส่ง header  Authorization: Bearer <CRON_SECRET>
//   ไม่สำเร็จ = ส่งเมลแจ้ง error (alert.ts)
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await backupToDrive()) });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    await alertError({ where: "สำรองข้อมูลรายสัปดาห์", message }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
