import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { applySheetEdits, processSheetJobs } from "@/lib/sheet-sync";
import { processSyncJobs } from "@/lib/sync";

export const maxDuration = 60;

// ปุ่ม "ซิงค์จากชีตทั้งหมด" ในหน้าเจ้าของ > ตาราง slot: เขียนงานค้างจากเว็บลงชีตก่อน แล้วอ่านทุกแถวในชีตมาอัปเดตเว็บ
//   เฉพาะ Owner ที่จัดการ Mc หรือ Admin (คนที่เห็นปุ่มนี้) — ติ๊กแค่ Data analytics / หลักฐานไลฟ์ สั่งซิงค์ไม่ได้
export async function POST() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!r.me.owner || !(r.me.owner.mc || r.me.owner.admin)) return fail("บัญชีนี้ไม่มีสิทธิ์ซิงค์ชีต", 403);
  try {
    await processSheetJobs();
    const mc = await applySheetEdits("mc");
    const admin = await applySheetEdits("admin");
    after(() => processSyncJobs().then(() => undefined));
    return ok({ mc, admin });
  } catch (err) {
    return fail("ซิงค์ไม่สำเร็จ: " + String((err as Error)?.message ?? err), 500);
  }
}
