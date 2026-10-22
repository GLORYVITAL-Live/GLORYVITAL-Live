import { fail, ok, requireOwner } from "@/lib/api";
import { bkkToday } from "@/lib/data";
import { ownerHome } from "@/lib/home";
import { payDocsScope } from "@/lib/pay-docs-db";
import { canClosePeriods } from "@/lib/periods";
import { withPlatformLabels } from "@/lib/platform";
import { receiptPending } from "@/lib/receipts-db";
import { tawiHome } from "@/lib/tawi";

// หน้าแรกของเจ้าของ (งานค้าง) — เฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์
export async function GET() {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูหน้าแรกของเจ้าของ", "read");
  if ("res" in r) return r.res;
  const see = r.me.owner!.see;
  try {
    // ใบ 50 ทวิ + เอกสารรับเงินค้าง: เฉพาะคนที่ดูเอกสารทำเบิกได้ · พลาด = ไม่แสดง
    // เฉพาะฝั่งที่ดูเอกสารได้ (Mc / Admin)
    const docs = payDocsScope(r.me).catch(() => ({ mc: false, admin: false }));
    const any = (s: { mc: boolean; admin: boolean }) => s.mc || s.admin;
    const [home, canBackup, receipts, tawi] = await Promise.all([
      ownerHome({ mc: see.mc, admin: see.admin, proofs: see.mc || see.proofs }),
      canClosePeriods(r.me), // ส่วน "สำรองข้อมูล" ท้ายหน้าแรก
      docs.then((s) => (any(s) ? receiptPending(s) : null)).catch(() => null),
      docs.then((s) => (any(s) ? tawiHome(bkkToday(), s) : null)).catch(() => null),
    ]);
    return ok({ home: { ...withPlatformLabels(home), canBackup, receipts, tawi } });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
