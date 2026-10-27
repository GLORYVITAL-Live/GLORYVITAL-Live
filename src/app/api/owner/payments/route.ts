import { fail, ok, requireOwner } from "@/lib/api";
import { addPayments, voidPayment } from "@/lib/pay-months";

// บันทึกการโอนค่าจ้าง (หน้าสรุปรายเดือน) — เฉพาะ Owner ที่จัดการฝั่งนั้นได้ (เห็นค่าจ้าง)
//   POST { action: "add", month, paidOn, note?, notify?, items: [{ staffId, amount }] }   คนเดียว / หลายคนพร้อมกัน (notify false = ลงย้อนหลังไม่แจ้งเตือน)
//   POST { action: "void", id }                                                ยกเลิกรายการที่บันทึกผิด (เก็บไว้เป็นประวัติ)
export async function POST(request: Request) {
  const r = await requireOwner("บัญชีนี้บันทึกการโอนค่าจ้างไม่ได้");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const actor = { name: r.me.owner?.name ?? r.me.email, email: r.me.email };
  const roles = r.scope.edit;
  if (body?.action === "add") {
    const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
    const res = await addPayments(String(body.month ?? ""), items, String(body.paidOn ?? ""), String(body.note ?? ""), actor, roles, body.notify !== false);
    if ("error" in res) return fail(res.error ?? "บันทึกไม่สำเร็จ");
    return ok({ message: res.count > 1 ? `บันทึกการโอน ${res.count} คนแล้ว` : "บันทึกการโอนแล้ว" });
  }
  if (body?.action === "void") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return fail("ไม่พบรายการนี้");
    const res = await voidPayment(id, actor, roles);
    if ("error" in res) return fail(res.error ?? "ยกเลิกไม่สำเร็จ");
    return ok({ message: "ยกเลิกรายการโอนแล้ว" });
  }
  return fail("ไม่รู้จักคำสั่งนี้");
}
