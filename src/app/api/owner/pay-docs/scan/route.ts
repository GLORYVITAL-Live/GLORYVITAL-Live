import { fail, ok, requireMe } from "@/lib/api";
import { matchPayDocsFolders } from "@/lib/drive";
import { canViewPayDocs } from "@/lib/pay-docs-db";

// POST: จับคู่รายชื่อ Mc / Admin กับโฟลเดอร์เอกสารเดิมใน Google Drive ตามชื่อ (เฉพาะ Owner ที่ดูเอกสารทำเบิกได้)
//   คืนรายชื่อที่ผูกใหม่ + ที่ยังไม่เจอ (ผูกเองได้ในหน้าต่างของคนนั้น)
export const maxDuration = 60;

export async function POST() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!(await canViewPayDocs(r.me))) return fail("บัญชีนี้ไม่มีสิทธิ์ดูเอกสารทำเบิก", 403);
  try {
    return ok(await matchPayDocsFolders());
  } catch (err) {
    return fail((err as Error).message || "ตรวจโฟลเดอร์ใน Drive ไม่สำเร็จ");
  }
}
