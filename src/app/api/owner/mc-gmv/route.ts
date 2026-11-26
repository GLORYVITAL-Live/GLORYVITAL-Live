import { fail, ok, requireOwner } from "@/lib/api";
import { myGmvData } from "@/lib/my-gmv-db";
import { isTestAccount } from "@/lib/staff-check";
import { createAdminClient } from "@/lib/supabase/server";

// ผลงาน Mc > ยอดขายราย Mc — Owner ฝั่ง Mc (เหมือนอันดับ Mc) ดู / ดึงสไลด์ยอดขายของ Mc คนไหนก็ได้ (ผู้ใช้ขอ 2026-11-26)
//   ไม่ส่ง id = รายชื่อ Mc (Mc ประจำขึ้นก่อน) · ?id= = ข้อมูลชุดเดียวกับที่ Mc ประจำเห็นในตารางของฉัน (src/lib/my-gmv-db.ts)
export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูยอดขายของ Mc", "read");
  if ("res" in r) return r.res;
  if (!r.scope.mc) return fail("ยอดขายราย Mc ใช้ข้อมูลฝั่ง Mc ต้องติ๊กสิทธิ์จัดการ Mc", 403);
  const db = createAdminClient();
  const id = Number(new URL(request.url).searchParams.get("id"));
  try {
    if (!id) {
      const { data, error } = await db.from("staff").select("id, name, is_salaried, live_platform").eq("role", "mc");
      if (error) return fail(error.message, 500);
      const mcs = (data ?? [])
        .filter((s) => s.name && !isTestAccount(s.name) && !/^https?:\/\//i.test(s.name))
        .map((s) => ({ id: Number(s.id), name: `Mc ${s.name}`, salaried: !!s.is_salaried, platform: String(s.live_platform ?? "") }))
        .sort((a, b) => Number(b.salaried) - Number(a.salaried) || a.name.localeCompare(b.name, "th"));
      return ok({ mcs });
    }
    const { data: mc } = await db.from("staff").select("id, name").eq("id", id).eq("role", "mc").maybeSingle();
    if (!mc) return fail("ไม่พบ Mc คนนี้", 404);
    return ok(await myGmvData({ id: Number(mc.id), name: String(mc.name) }));
  } catch (err) {
    return fail(`โหลดยอดขายไม่สำเร็จ: ${(err as Error).message}`, 500);
  }
}
