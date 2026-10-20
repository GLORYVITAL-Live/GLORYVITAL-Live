import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { canViewPayDocs } from "@/lib/pay-docs-db";
import { cleanReason } from "@/lib/receipts";
import { RECEIPT_SQL, notifyReceiptRejected, ownerReceipts, reviewReceipt } from "@/lib/receipts-db";
import type { OwnerReceipts } from "@/lib/types";

// เอกสารยืนยันการรับเงิน: ภาพรวมทุกคน (เฉพาะ Owner ที่ดูเอกสารทำเบิกได้ — staff.can_view_pay_docs)
//   GET   ?month=YYYY-MM   สรุปต่อเดือน (ส่งแล้ว / ต้องส่ง / ไม่ผ่าน) + รายชื่อของเดือนนั้น (ไม่ระบุ = ล่าสุด)
//   POST  { action: "reject", id, reason, seenAt }   ไม่ผ่าน = ใบ 50 ทวิเดือนนั้นล็อกอีกครั้ง + แจ้งเจ้าตัวให้ส่งใหม่
//         { action: "unreject", id, seenAt }          ยกเลิกไม่ผ่าน (กลับเป็นผ่าน)
//   seenAt = เวลาส่งของไฟล์ที่ Owner เห็น (เจ้าตัวส่งใหม่ระหว่างนั้น = ไม่ทำ)

async function requireViewer() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!(await canViewPayDocs(r.me))) return { res: fail("บัญชีนี้ไม่มีสิทธิ์ดูเอกสารรับเงินของคนอื่น", 403) };
  return r;
}

const errorOf = (err: unknown) => {
  const msg = (err as Error)?.message || "ทำรายการไม่สำเร็จ";
  return fail(msg, msg === RECEIPT_SQL ? 409 : 400);
};

export async function GET(request: Request) {
  const r = await requireViewer();
  if ("res" in r) return r.res;
  try {
    return ok<OwnerReceipts>(await ownerReceipts(new URL(request.url).searchParams.get("month")));
  } catch (err) {
    return errorOf(err);
  }
}

export async function POST(request: Request) {
  const r = await requireViewer();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่พบเอกสารนี้");
  const seenAt = String(body?.seenAt ?? "");
  try {
    if (body?.action === "reject") {
      const reason = cleanReason(body?.reason);
      if (reason.length < 3) return fail("กรุณาใส่เหตุผลที่ไม่ผ่าน (เจ้าตัวจะเห็นข้อความนี้)");
      const row = await reviewReceipt(id, true, reason, seenAt, r.me.email);
      after(() => notifyReceiptRejected(row, reason));
      return ok({ message: "ตั้งเป็นไม่ผ่านแล้ว แจ้งเจ้าตัวให้ส่งใหม่แล้ว" });
    }
    if (body?.action === "unreject") {
      await reviewReceipt(id, false, "", seenAt, r.me.email);
      return ok({ message: "ยกเลิกไม่ผ่านแล้ว เจ้าตัวดาวน์โหลดใบ 50 ทวิได้" });
    }
    return fail("ไม่รู้จักคำสั่งนี้");
  } catch (err) {
    return errorOf(err);
  }
}
