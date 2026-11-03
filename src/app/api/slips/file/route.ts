import { fail, requireMe } from "@/lib/api";
import { DRIVE_FILE_GONE, driveError, driveNotFound } from "@/lib/drive";
import { RECEIPT_TYPES, receiptExt } from "@/lib/receipts";
import { downloadReceipt } from "@/lib/receipts-db";
import { SLIP_SQL, slipById } from "@/lib/slips-db";

// เปิดสลิปโอนเงิน ส่งไฟล์จาก Drive ผ่านเซิร์ฟเวอร์ (ไม่เปิดลิงก์ Drive ให้ใคร)
//   ?id=<pay_slips.id> [&inline=1 เปิดในเบราว์เซอร์]
//   เจ้าของสลิป (Mc / Admin ที่จับคู่ไว้) หรือ Owner ที่จัดการฝั่งนั้นได้เท่านั้น
export const maxDuration = 30;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่พบไฟล์นี้", 404);

  let row: Awaited<ReturnType<typeof slipById>>;
  try {
    row = await slipById(id);
  } catch (err) {
    const msg = (err as Error).message;
    return fail(msg, msg === SLIP_SQL ? 409 : 500);
  }
  // ไม่มีไฟล์ / ไม่ใช่ของตัวเอง ตอบเหมือนกัน (ไม่บอกว่ามี id นี้อยู่)
  const mine = !!row?.staff_id && (r.me.mc?.id === Number(row.staff_id) || r.me.admin?.id === Number(row.staff_id));
  const owner = !!row && !!r.me.owner?.[row.role];
  if (!row || (!mine && !owner)) return fail("ไม่มีสิทธิ์เปิดไฟล์นี้", 403);

  let bytes: Uint8Array;
  try {
    bytes = await downloadReceipt(row.drive_file_id);
  } catch (err) {
    return driveNotFound(err) ? fail(DRIVE_FILE_GONE, 404) : fail(driveError(err), 502);
  }
  const type = RECEIPT_TYPES.includes(row.mime) ? row.mime : "application/octet-stream";
  const name = `สลิปโอนเงิน-${row.round}.${type === "application/octet-stream" ? "bin" : receiptExt(type)}`;
  // ชื่อไฟล์ภาษาไทยแบบ RFC 5987 + ชื่อสำรอง ASCII สำหรับเบราว์เซอร์เก่า
  const ascii = name.replace("สลิปโอนเงิน", "slip");
  const disposition = `${params.has("inline") ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": disposition,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
