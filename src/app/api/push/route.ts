import { fail, ok, requireMe } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/server";

// แจ้งเตือนเด้งเข้ามือถือ (Web Push) ของเครื่องนี้
//   GET                                กุญแจสาธารณะ (VAPID) สำหรับสมัคร · null = เว็บยังไม่ได้ตั้งค่า
//   POST { subscription }              เปิดแจ้งเตือนบนเครื่องนี้ (จำเครื่องไว้กับอีเมลที่ login)
//   POST { action: "test" }            ส่งแจ้งเตือนทดสอบหาตัวเอง
//   DELETE { endpoint }                ปิดแจ้งเตือนบนเครื่องนี้

const SQL = "ต้องรัน SQL 20261028000000_notifications ใน Supabase ก่อน";
const dbFail = (msg: string) => fail(/push_subscriptions|notifications/.test(msg) ? SQL : msg, 500);

export async function GET() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  return ok({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
}

export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const db = createAdminClient();

  if (body?.action === "test") {
    const { count, error } = await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("email", r.me.email);
    if (error) return dbFail(error.message);
    await notify([r.me.email], { kind: "test", title: "ทดสอบแจ้งเตือน GLORY VITAL", body: "ถ้าเห็นข้อความนี้ แปลว่าเครื่องนี้รับแจ้งเตือนได้แล้ว" });
    return ok({ devices: count ?? 0, message: count ? `ส่งแล้ว (${count} เครื่อง)` : "ส่งเข้ากระดิ่งแล้ว (ยังไม่มีเครื่องที่เปิดแจ้งเตือน)" });
  }

  const sub = body?.subscription;
  const endpoint = String(sub?.endpoint ?? ""), p256dh = String(sub?.keys?.p256dh ?? ""), auth = String(sub?.keys?.auth ?? "");
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return fail("ข้อมูลเครื่องไม่ถูกต้อง");
  }
  const { error } = await db.from("push_subscriptions").upsert({
    email: r.me.email, endpoint, p256dh, auth, user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
  }, { onConflict: "endpoint" });
  if (error) return dbFail(error.message);
  return ok({ message: "เปิดแจ้งเตือนบนเครื่องนี้แล้ว" });
}

export async function DELETE(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const endpoint = String((await request.json().catch(() => null))?.endpoint ?? "");
  if (!endpoint) return fail("ข้อมูลเครื่องไม่ถูกต้อง");
  const { error } = await createAdminClient().from("push_subscriptions").delete().eq("endpoint", endpoint).eq("email", r.me.email);
  if (error) return dbFail(error.message);
  return ok({ message: "ปิดแจ้งเตือนบนเครื่องนี้แล้ว" });
}
