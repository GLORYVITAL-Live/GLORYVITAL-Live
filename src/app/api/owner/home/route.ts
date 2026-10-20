import { fail, ok, requireOwner } from "@/lib/api";
import { bkkToday } from "@/lib/data";
import { ownerHome } from "@/lib/home";
import { canViewPayDocs } from "@/lib/pay-docs-db";
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
    const payDocs = canViewPayDocs(r.me).catch(() => false);
    const [home, canBackup, receipts, tawi] = await Promise.all([
      ownerHome({ mc: see.mc, admin: see.admin, proofs: see.mc || see.proofs }),
      canClosePeriods(r.me), // ส่วน "สำรองข้อมูล" ท้ายหน้าแรก
      payDocs.then((yes) => (yes ? receiptPending() : null)).catch(() => null),
      payDocs.then((yes) => (yes ? tawiHome(bkkToday()) : null)).catch(() => null),
    ]);
    return ok({ home: { ...withPlatformLabels(home), canBackup, receipts, tawi } });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
