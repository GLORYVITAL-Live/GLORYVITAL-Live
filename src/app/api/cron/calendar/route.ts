import { NextResponse } from "next/server";
import { processSyncJobs } from "@/lib/sync";

export const maxDuration = 60;

// เก็บตกงานที่ยังค้าง (ลงปฏิทิน + เขียนชีต) เช่น Google ขัดข้องชั่วคราว
// ต้องส่ง header  Authorization: Bearer <CRON_SECRET>
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await processSyncJobs()) });
}
