import { fail, ok, requireOwner } from "@/lib/api";
import { ownerDashboard } from "@/lib/dashboard";

// แดชบอร์ดเดือนนี้บนหน้าแรกของเจ้าของ (โหลดแยกจากงานค้าง ไม่ให้หน้าแรกช้าลง)
//   ต้องดูฝั่ง Mc ได้ (ไม่ได้ = dashboard: null) · ค่าจ้างเฉพาะฝั่งที่จัดการได้ · GMV เฉพาะคนที่ดูสถิติไลฟ์ได้
export async function GET() {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูหน้าแรกของเจ้าของ", "read");
  if ("res" in r) return r.res;
  const { mc, admin, edit } = r.scope;
  if (!mc) return ok({ dashboard: null });
  try {
    const dashboard = await ownerDashboard({ payMc: edit.mc, payAdmin: admin && edit.admin, gmv: !!r.me.owner?.see.analytics });
    return ok({ dashboard });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
