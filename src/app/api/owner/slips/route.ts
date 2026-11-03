import { fail, ok, requireOwner } from "@/lib/api";
import { SLIP_SQL, assignSlip, ownerSlips, scanSlips } from "@/lib/slips-db";
import type { OwnerSlips, SlipScan } from "@/lib/types";

// สลิปโอนเงิน (โฟลเดอร์ Slip ใน Drive ที่ฝ่ายบัญชีอัปไว้) — เฉพาะ Owner ที่จัดการฝั่งนั้นได้ (เห็นค่าจ้าง)
//   GET                                      สลิปทั้งหมดของฝั่งที่จัดการได้ + รายชื่อไว้เลือกจับคู่
//   POST { action: "scan" }                  ตรวจโฟลเดอร์ใน Drive + จับคู่อัตโนมัติ + แจ้งเจ้าตัว (สลิปที่เพิ่งอัป)
//   POST { action: "assign", id, staffId }   จับคู่เอง (staffId null = ไม่ใช่คนในระบบ) — ใช้กับไฟล์ชื่อเดียวกันทุกรอบ
export const maxDuration = 60;

const errorOf = (err: unknown) => {
  const msg = (err as Error)?.message || "ทำรายการไม่สำเร็จ";
  return fail(msg, (err as { status?: number }).status ?? (msg === SLIP_SQL ? 409 : 400));
};

export async function GET() {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูสลิปโอนเงิน");
  if ("res" in r) return r.res;
  try {
    return ok<OwnerSlips>(await ownerSlips(r.scope.edit));
  } catch (err) {
    return errorOf(err);
  }
}

export async function POST(request: Request) {
  const r = await requireOwner("บัญชีนี้จัดการสลิปโอนเงินไม่ได้");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  try {
    if (body?.action === "scan") {
      const scan = await scanSlips();
      if (!scan.configured) return fail("ยังไม่ได้ตั้งโฟลเดอร์สลิปใน Google Drive (ตั้งด้วย SQL)");
      return ok<{ scan: SlipScan }>({ scan });
    }
    if (body?.action === "assign") {
      const id = Number(body?.id);
      if (!Number.isInteger(id) || id <= 0) return fail("ไม่พบสลิปนี้");
      const staffId = body?.staffId == null ? null : Number(body.staffId);
      if (staffId !== null && (!Number.isInteger(staffId) || staffId <= 0)) return fail("ไม่พบรายชื่อนี้");
      return ok(await assignSlip(id, staffId, r.scope.edit));
    }
    return fail("ไม่รู้จักคำสั่งนี้");
  } catch (err) {
    return errorOf(err);
  }
}
