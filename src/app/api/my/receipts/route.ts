import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES, isMonth, sniffType } from "@/lib/receipts";
import { RECEIPT_SQL, myReceipts, receiptView, saveReceipt } from "@/lib/receipts-db";
import { createAdminClient } from "@/lib/supabase/server";
import { myTawi } from "@/lib/tawi";
import { tawiMonthLabel } from "@/lib/tawi-name";
import type { MyTawi, ReceiptView } from "@/lib/types";

// เอกสารยืนยันการรับเงินของตัวเอง (Mc / Admin — ทุกบทบาทของอีเมลนี้)
//   GET   เดือนเริ่มบังคับ + เอกสารที่ส่งแล้ว (ใหม่ก่อน)
//   POST  multipart { month: "YYYY-MM", file: รูป / PDF ไม่เกิน 4 MB } ส่ง / ส่งใหม่ -> ขึ้น Google Drive -> ดาวน์โหลดใบ 50 ทวิเดือนนั้นได้ทันที
//         ตอบข้อมูลใบ 50 ทวิชุดใหม่ (tawi) ให้หน้าเว็บอัปเดตปุ่มเลย
export const maxDuration = 60;

async function requireCrew() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!r.me.mc && !r.me.admin) return { res: fail("ส่งเอกสารรับเงินได้เฉพาะบัญชี Mc / Admin", 403) };
  return r;
}

export async function GET() {
  const r = await requireCrew();
  if ("res" in r) return r.res;
  const rc = await myReceipts(r.me.email);
  return ok<{ receiptFrom: string | null; receipts: ReceiptView[] }>({ receiptFrom: rc.requiredFrom, receipts: rc.rows.map(receiptView) });
}

export async function POST(request: Request) {
  const r = await requireCrew();
  if ("res" in r) return r.res;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("ข้อมูลไม่ครบ หรือไฟล์ใหญ่เกินไป ลองใหม่อีกครั้ง");
  const month = String(form.get("month") ?? "");
  if (!isMonth(month)) return fail("เดือนไม่ถูกต้อง");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return fail("กรุณาเลือกไฟล์");
  if (file.size > RECEIPT_MAX_BYTES) return fail("ไฟล์ใหญ่เกินไป (ไม่เกิน 4 MB) ลองถ่ายรูปแทน");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!RECEIPT_TYPES.includes(type)) return fail("รองรับเฉพาะรูป JPG / PNG / WebP หรือไฟล์ PDF");

  let res: Awaited<ReturnType<typeof saveReceipt>>;
  try {
    res = await saveReceipt(r.me.email, month, bytes, type);
  } catch (err) {
    const msg = (err as Error)?.message || "ส่งเอกสารไม่สำเร็จ";
    return fail(msg, (err as { status?: number }).status ?? (msg === RECEIPT_SQL ? 409 : 400));
  }
  // บันทึกไว้ให้ทีมงานตรวจย้อนหลังได้
  after(async () => {
    await createAdminClient().from("booking_logs").insert({
      email: r.me.email, role: r.me.mc ? "Mc" : "Admin", name: res.label,
      action: `${res.replaced ? "ส่งใหม่" : "ส่ง"}เอกสารรับเงิน ${tawiMonthLabel(month)}`, result: "สำเร็จ",
    });
  });
  return ok<{ message: string; tawi: MyTawi }>({
    message: `ส่งเอกสารรับเงิน ${tawiMonthLabel(month)} แล้ว ดาวน์โหลดใบ 50 ทวิได้เลย`,
    tawi: await myTawi(r.me.email),
  });
}
