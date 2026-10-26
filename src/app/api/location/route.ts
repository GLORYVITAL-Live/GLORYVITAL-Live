import { ok, requireMe } from "@/lib/api";
import { getSettings } from "@/lib/data";

// ลิงก์โลเคชั่นที่ทำงาน (Google Maps) — เฉพาะคนที่มีบัญชีในระบบ (requireMe ตรวจว่าลงทะเบียนแล้ว) ว่าง = ไม่แสดงปุ่ม
//   แก้ได้ที่หน้าเจ้าของ > กฎการทำงาน (PATCH /api/rules { workLocationUrl })
export async function GET() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const s = await getSettings();
  return ok({ url: s.work_location_url ?? "" });
}
