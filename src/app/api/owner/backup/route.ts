import { fail, ok, requireMe } from "@/lib/api";
import { backupStatus, backupToDrive } from "@/lib/backup";
import { driveError } from "@/lib/drive";
import { canClosePeriods } from "@/lib/periods";

// สำรองข้อมูลลง Google Drive — GET = ไฟล์ล่าสุด / POST = สำรองตอนนี้
//   เฉพาะ Owner ที่ตั้ง can_close_periods (ไฟล์มีข้อมูลทุกอย่าง รวมค่าจ้างและเอกสารทำเบิก)
export const maxDuration = 60;

async function requireBackup() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!(await canClosePeriods(r.me))) return { res: fail("บัญชีนี้ไม่มีสิทธิ์สำรองข้อมูล", 403) };
  return r;
}

export async function GET() {
  const r = await requireBackup();
  if ("res" in r) return r.res;
  try {
    return ok(await backupStatus());
  } catch (err) {
    return fail(driveError(err));
  }
}

export async function POST() {
  const r = await requireBackup();
  if ("res" in r) return r.res;
  try {
    const res = await backupToDrive();
    return ok({ ...res, message: `สำรองข้อมูลแล้ว (${res.sizeKB.toLocaleString("th-TH")} KB)` });
  } catch (err) {
    return fail("สำรองข้อมูลไม่สำเร็จ: " + driveError(err), 500);
  }
}
