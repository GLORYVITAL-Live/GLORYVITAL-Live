import { NextResponse } from "next/server";
import { closeGivenUpCalendarJobs, enqueueSharedCalendars } from "@/lib/calendar";
import { openSlots, sendMorningDigest } from "@/lib/digest";
import { notifyOpenSoon } from "@/lib/notifications";
import { matchPayDocsFolders, syncPendingPayDocs } from "@/lib/drive";
import { removeSlotsDeletedInSheet } from "@/lib/sheet-sync";
import { scanTawi } from "@/lib/tawi";
import { processSyncJobs } from "@/lib/sync";

export const maxDuration = 60;

// งานประจำวัน (vercel.json: ทุกเช้า ~07:00 เวลาไทย) ต้องส่ง header  Authorization: Bearer <CRON_SECRET>
//   1. ลบ slot ที่ถูกลบแถวในชีตแล้วแต่เว็บยังไม่รู้ (เช่น Apps Script ส่งไม่สำเร็จ)
//   2. เมลสรุปเช้า + แจ้งเตือนในเว็บ "slot ยังว่างใน 48 ชม." (ทำก่อนงานยาว ไม่ให้หมดเวลาก่อนส่ง)
//   3. ปิดงานลงปฏิทินที่ระบบเลิกลองแล้ว + คนที่เพิ่งแชร์ปฏิทิน ลงคิวที่ค้างให้
//      + เอกสารทำเบิก (ขึ้น Drive ที่ค้าง / จับคู่โฟลเดอร์เอกสารเดิม) + ใบ 50 ทวิ (ไฟล์ใหม่ใน Drive / จับคู่ / แจ้งเจ้าของ)
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
  // แจ้งเตือนในเว็บ / มือถือ: slot ยังว่างใน 48 ชม. → Owner ฝั่งนั้น
  const now = Date.now();
  const openSoon = await Promise.all([openSlots("mc", now), openSlots("admin", now)])
    .then(([mc, admin]) => notifyOpenSoon({ mc, admin }, now)).catch(errorOf);
  const calendarClosed = await closeGivenUpCalendarJobs().catch(errorOf);
  // คนที่แชร์ปฏิทินแล้วแต่ยังไม่ได้เปิดเว็บ / กด "แชร์แล้ว เช็กเลย": จดงานลงคิวที่ค้าง (ลงจริงตอน processSyncJobs ท้ายสุด)
  const calendarShared = await enqueueSharedCalendars().catch(errorOf);
  const payDocs = {
    sync: await syncPendingPayDocs().catch(errorOf),
    match: await matchPayDocsFolders().then((m) => ({ linked: m.linked.length })).catch(errorOf),
  };
  // ยังไม่ได้ตั้งโฟลเดอร์ = ข้าม · ยังไม่ได้รัน SQL / Drive ขัดข้อง = บันทึก error ไม่กระทบงานอื่น
  const tawi = await scanTawi()
    .then((s) => (s.configured ? { added: s.added, removed: s.removed, matched: s.matched, unmatched: s.unmatched, notified: s.notified } : { skipped: "no folder" }))
    .catch(errorOf);
  return NextResponse.json({ ok: true, ...(await processSyncJobs()), removed, digest, openSoon, calendarClosed, calendarShared, payDocs, tawi });
}
