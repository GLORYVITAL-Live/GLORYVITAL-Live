import { fail, ok, requireMe } from "@/lib/api";
import { driveStatus, syncProofsToDrive } from "@/lib/drive";
import { canSeeAll } from "@/lib/proofs";

// สำเนารูปหลักฐานไลฟ์ใน Google Drive (Owner ฝั่ง Mc)
//   GET   สถานะ: ค้างกี่ slot / error ล่าสุด / ลิงก์โฟลเดอร์หลัก
//   POST  อัปรูปที่ค้าง (ทีละ 20 กลุ่ม) หน้าเว็บเรียกซ้ำจน remaining = 0
export const maxDuration = 60;

async function requireProofOwner() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!canSeeAll(r.me)) return { res: fail("เฉพาะเจ้าของที่มีสิทธิ์ฝั่ง Mc", 403) };
  return r;
}

export async function GET() {
  const r = await requireProofOwner();
  if ("res" in r) return r.res;
  return ok(await driveStatus());
}

export async function POST() {
  const r = await requireProofOwner();
  if ("res" in r) return r.res;
  try {
    const res = await syncProofsToDrive({ limit: 20 });
    return ok({ ...res, ...(await driveStatus()) });
  } catch (err) {
    return fail("อัปขึ้น Google Drive ไม่สำเร็จ: " + (err as Error).message, 500);
  }
}
