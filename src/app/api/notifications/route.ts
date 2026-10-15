import { fail, ok, requireMe } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/server";

// แจ้งเตือนในเว็บ (กระดิ่ง) ของคนที่ login อยู่
//   GET                     50 รายการล่าสุด + จำนวนที่ยังไม่อ่าน
//   POST { action: "read" } อ่านทั้งหมดแล้ว
// ยังไม่ได้รัน SQL 20261028000000_notifications = คืนรายการว่าง (กระดิ่งไม่ขึ้นตัวเลข)

const missing = (msg: string) => /notifications/.test(msg);

export async function GET() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const db = createAdminClient();
  const [list, unread] = await Promise.all([
    db.from("notifications").select("id, kind, title, body, page, created_at, read_at")
      .eq("email", r.me.email).order("created_at", { ascending: false }).limit(50),
    db.from("notifications").select("id", { count: "exact", head: true }).eq("email", r.me.email).is("read_at", null),
  ]);
  if (list.error) return missing(list.error.message) ? ok({ items: [], unread: 0, missing: true }) : fail(list.error.message, 500);
  const items = (list.data ?? []).map((n) => ({
    id: n.id, kind: n.kind, title: n.title, body: n.body, page: n.page, at: n.created_at, read: !!n.read_at,
  }));
  return ok({ items, unread: unread.count ?? 0 });
}

export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  if (body?.action !== "read") return fail("ไม่รู้จักคำสั่งนี้");
  const { error } = await createAdminClient().from("notifications").update({ read_at: new Date().toISOString() })
    .eq("email", r.me.email).is("read_at", null);
  if (error && !missing(error.message)) return fail(error.message, 500);
  return ok({});
}
