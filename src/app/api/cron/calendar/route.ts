import { NextResponse } from "next/server";
import { closeGivenUpCalendarJobs } from "@/lib/calendar";
import { sendMorningDigest } from "@/lib/digest";
import { matchPayDocsFolders, syncPendingPayDocs } from "@/lib/drive";
import { removeSlotsDeletedInSheet } from "@/lib/sheet-sync";
import { processSyncJobs } from "@/lib/sync";

export const maxDuration = 60;

// งานประจำวัน (vercel.json: ทุกเช้า ~07:00 เวลาไทย) ต้องส่ง header  Authorization: Bearer <CRON_SECRET>
//   1. ลบ slot ที่ถูกลบแถวในชีตแล้วแต่เว็บยังไม่รู้ (เช่น Apps Script ส่งไม่สำเร็จ)
//   2. เมลสรุปเช้า "slot ยังว่างใน 48 ชม." (ทำก่อนงานยาว ไม่ให้หมดเวลาก่อนส่ง)
//   3. ปิดงานลงปฏิทินที่ระบบเลิกลองแล้ว + เอกสารทำเบิก (ขึ้น Drive ที่ค้าง / จับคู่โฟลเดอร์เอกสารเดิม)
//   4. เก็บตกงานที่ค้าง (ลงปฏิทิน + เขียนชีต) เช่น Google ขัดข้องชั่วคราว
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const errorOf = (err: unknown) => ({ error: String((err as Error)?.message ?? err) });
  const removed: Record<string, unknown> = {};
  for (const tab of ["mc", "admin"] as const) {
    removed[tab] = await removeSlotsDeletedInSheet(tab).catch(errorOf);
  }
  const digest = await sendMorningDigest().catch(errorOf);
  const calendarClosed = await closeGivenUpCalendarJobs().catch(errorOf);
  const payDocs = {
    sync: await syncPendingPayDocs().catch(errorOf),
    match: await matchPayDocsFolders().then((m) => ({ linked: m.linked.length })).catch(errorOf),
  };
  return NextResponse.json({ ok: true, ...(await processSyncJobs()), removed, digest, calendarClosed, payDocs });
}
