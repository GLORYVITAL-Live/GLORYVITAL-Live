import { fail, monthRange, ok, requirePlanner } from "@/lib/api";
import { syncRoomSheet } from "@/lib/room-sheet-sync";

// ปุ่ม "ลงตารางห้องไลฟ์" ในหน้า Plan Slot Live: เขียนแท็บ "Live <เดือน> <ปี> (เว็บ)" ของเดือนที่เปิดอยู่ทันที
//   POST { month: "YYYY-MM" } -> { url, title, placed, written, skipped }
//   (ปกติอัปเดตเองทุกชั่วโมงใน cron notify อยู่แล้ว) · สิทธิ์: Owner ที่แก้แพลนได้ (เขียนชีตของทีม)

export const maxDuration = 60;

export async function POST(request: Request) {
  const r = await requirePlanner();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  if (!/^\d{4}-\d{2}$/.test(String(body?.month ?? ""))) return fail("เดือนไม่ถูกต้อง");
  const { key } = monthRange(body.month);
  try {
    const res = await syncRoomSheet([key], { createEmpty: true, waitMs: 20_000 });
    if ("skipped" in res) return fail(res.skipped);
    const x = res[0];
    return ok({ url: x.url, title: x.title, placed: x.placed, written: x.written, skipped: x.skipped });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
