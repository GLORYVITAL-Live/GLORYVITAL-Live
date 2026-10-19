import { fail, requireMe } from "@/lib/api";
import { driveError } from "@/lib/drive";
import { canViewPayDocs } from "@/lib/pay-docs-db";
import { TAWI_SQL, TAWI_UPDATING, downloadTawi, tawiDoc, verifiedKeysOf } from "@/lib/tawi";
import { tawiAccess } from "@/lib/tawi-verify";

// ดาวน์โหลดใบ 50 ทวิ (?id=<tawi_docs.id>[&inline=1]) ส่ง PDF จาก Drive ผ่านเซิร์ฟเวอร์ (ไม่เปิดลิงก์ Drive ให้ใคร)
//   เจ้าของไฟล์ (อีเมลของรายชื่อที่จับคู่ = คนที่ login) ที่ยืนยันตัวตนด้วยชื่อของใบนี้แล้ว
//   หรือ Owner ที่ดูเอกสารทำเบิกได้ (เปิดได้เสมอ) · ยังไม่ยืนยัน = 403 · ยังไม่ได้รัน SQL ยืนยันตัวตน = 503 (เจ้าตัว)
export const maxDuration = 30;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่พบไฟล์นี้", 404);

  let doc: Awaited<ReturnType<typeof tawiDoc>>;
  try {
    doc = await tawiDoc(id);
  } catch (err) {
    const msg = (err as Error).message;
    return fail(msg, msg === TAWI_SQL ? 409 : 500);
  }
  // ไม่มีไฟล์ / ไม่ใช่ของตัวเอง ตอบเหมือนกัน (ไม่บอกว่ามี id นี้อยู่)
  if (!doc) return fail("ไม่มีสิทธิ์เปิดไฟล์นี้", 403);
  // ของตัวเอง = staff_id ปัจจุบันของใบนี้เป็นอีเมลนี้ (Owner ย้าย / ยกเลิกการจับคู่แล้ว = ไม่ใช่)
  const mine = !!doc.ownerEmail && doc.ownerEmail === r.me.email.trim().toLowerCase();
  let access = tawiAccess({ viewer: false, mine, docKey: doc.nameKey, verifiedKeys: mine ? await verifiedKeysOf(r.me.email) : [] });
  if (access !== "ok" && (await canViewPayDocs(r.me))) access = "ok";
  if (access === "forbidden") return fail("ไม่มีสิทธิ์เปิดไฟล์นี้", 403);
  if (access === "updating") return fail(TAWI_UPDATING, 503);
  if (access === "verify") return fail('ยืนยันตัวตนก่อนดาวน์โหลด: กรอกชื่อ-นามสกุลจริงที่ "ตารางของฉัน"', 403);

  let bytes: Uint8Array;
  try {
    bytes = await downloadTawi(doc.fileId);
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    return fail(/not found/i.test(msg) ? "ไม่พบไฟล์ใน Google Drive (อาจถูกลบแล้ว) แจ้งทีมงาน" : driveError(err), /not found/i.test(msg) ? 404 : 502);
  }
  const name = `50ทวิ-${doc.month}${doc.sameMonth > 1 ? `-${doc.order}` : ""}.pdf`;
  // ชื่อไฟล์ภาษาไทยแบบ RFC 5987 + ชื่อสำรอง ASCII สำหรับเบราว์เซอร์เก่า
  const ascii = name.replace("50ทวิ", "50tawi");
  const disposition = `${params.has("inline") ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
