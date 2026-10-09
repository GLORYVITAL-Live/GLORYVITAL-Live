import { fail, ok, requireOwner } from "@/lib/api";
import { ownerHome } from "@/lib/home";

// หน้าแรกของเจ้าของ (งานค้าง) — เฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์
export async function GET() {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูหน้าแรกของเจ้าของ", "read");
  if ("res" in r) return r.res;
  const see = r.me.owner!.see;
  try {
    return ok({ home: await ownerHome({ mc: see.mc, admin: see.admin, proofs: see.mc || see.proofs }) });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
