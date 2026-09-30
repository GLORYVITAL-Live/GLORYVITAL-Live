import { NextResponse } from "next/server";
import { removeSlotsDeletedInSheet } from "@/lib/sheet-sync";
import { processSyncJobs } from "@/lib/sync";

export const maxDuration = 60;

// เก็บตกงานที่ยังค้าง (ลงปฏิทิน + เขียนชีต) เช่น Google ขัดข้องชั่วคราว
// + ลบ slot ที่ถูกลบแถวในชีตแล้วแต่เว็บยังไม่รู้ (เช่น Apps Script ส่งไม่สำเร็จ)
// ต้องส่ง header  Authorization: Bearer <CRON_SECRET>
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const removed: Record<string, unknown> = {};
  for (const tab of ["mc", "admin"] as const) {
    try {
      removed[tab] = await removeSlotsDeletedInSheet(tab);
    } catch (err) {
      removed[tab] = { error: String((err as Error)?.message ?? err) };
    }
  }
  return NextResponse.json({ ok: true, ...(await processSyncJobs()), removed });
}
