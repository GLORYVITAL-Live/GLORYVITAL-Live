import { fail, ok, requireMe } from "@/lib/api";
import { payDocsScope } from "@/lib/pay-docs-db";
import { NO_SIDE, TAWI_SQL, TAWI_VERIFY_SQL, assignTawi, ownerTawi, resetTawiVerify, scanTawi } from "@/lib/tawi";
import type { OwnerTawi } from "@/lib/types";

// ใบ 50 ทวิ: จับคู่ไฟล์ใน Drive กับรายชื่อ (เฉพาะ Owner ที่ดูเอกสารได้ — ใบ / รายชื่อเฉพาะฝั่งที่ติ๊กไว้ Mc / Admin)
//   GET   ?month=YYYY-MM                  ไฟล์ของเดือนนั้น (ไม่ระบุ = ล่าสุด) + รายชื่อ Mc / Admin + คนที่น่าจะใช่
//   POST  { action: "scan" }              ตรวจไฟล์ใน Drive (ไฟล์ใหม่ / ลบ / จับคู่อัตโนมัติ / แจ้งเจ้าของ)
//         { action: "assign", docId, staffId }   จับคู่ (ทุกไฟล์ที่ชื่อเดียวกัน)
//         { action: "unassign", docId }          ยกเลิกการจับคู่
//         { action: "reset-verify", staffId }    รีเซ็ตการยืนยันตัวตนของคนนี้ (เจ้าตัวต้องกรอกชื่อยืนยันใหม่)
export const maxDuration = 60;

async function requireViewer() {
  const r = await requireMe();
  if ("res" in r) return r;
  const scope = await payDocsScope(r.me);
  if (!scope.mc && !scope.admin) return { res: fail("บัญชีนี้ไม่มีสิทธิ์ดูใบ 50 ทวิของคนอื่น", 403) };
  return { ...r, scope };
}

const errorOf = (err: unknown) => {
  const msg = (err as Error)?.message || "ทำรายการไม่สำเร็จ";
  return fail(msg, msg === TAWI_SQL || msg === TAWI_VERIFY_SQL ? 409 : msg === NO_SIDE ? 403 : 400);
};

export async function GET(request: Request) {
  const r = await requireViewer();
  if ("res" in r) return r.res;
  try {
    return ok<OwnerTawi>(await ownerTawi(new URL(request.url).searchParams.get("month"), r.scope));
  } catch (err) {
    return errorOf(err);
  }
}

export async function POST(request: Request) {
  const r = await requireViewer();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  try {
    if (body?.action === "scan") {
      const res = await scanTawi();
      if (!res.configured) return fail("ยังไม่ได้ตั้งโฟลเดอร์ Google Drive ของใบ 50 ทวิ (settings.tawi_drive_folder)");
      return ok({ scan: res });
    }
    if (body?.action === "reset-verify") {
      const staffId = Number(body?.staffId);
      if (!Number.isInteger(staffId) || staffId <= 0) return fail("ไม่พบรายชื่อนี้");
      return ok(await resetTawiVerify(staffId, r.scope));
    }
    const docId = Number(body?.docId);
    if (!Number.isInteger(docId) || docId <= 0) return fail("ไม่พบไฟล์นี้");
    if (body?.action === "assign") {
      const staffId = Number(body?.staffId);
      if (!Number.isInteger(staffId) || staffId <= 0) return fail("กรุณาเลือกรายชื่อ");
      return ok(await assignTawi(docId, staffId, r.scope));
    }
    if (body?.action === "unassign") return ok(await assignTawi(docId, null, r.scope));
    return fail("ไม่รู้จักคำสั่งนี้");
  } catch (err) {
    return errorOf(err);
  }
}
