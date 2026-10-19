import { fail, monthRange, ok, requireMe } from "@/lib/api";
import { ownerSummary } from "@/lib/data";
import { PERIODS_SQL, canClosePeriods, snapshotOf, type Side } from "@/lib/periods";
import { createAdminClient } from "@/lib/supabase/server";

// ปิด / เปิดงวดรายเดือน — POST { month: "YYYY-MM", side: "mc" | "admin", action: "close" | "reopen" }
//   เฉพาะ Owner ที่ตั้ง can_close_periods · ปิด = เก็บตัวเลขสรุปของฝั่งนั้นตอนนี้ / เปิด = ตัวเลขกลับไปคิดสดตามข้อมูลจริง
export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!(await canClosePeriods(r.me))) return fail("บัญชีนี้ปิด / เปิดงวดไม่ได้", 403);
  const body = await request.json().catch(() => ({}));
  const side = body?.side as Side;
  if (side !== "mc" && side !== "admin") return fail("เลือกฝั่ง Mc หรือ Admin");
  const { key, first, last } = monthRange(String(body?.month ?? ""));
  if (String(body?.month) !== key) return fail("เดือนไม่ถูกต้อง");
  const db = createAdminClient();
  const who = r.me.owner?.name ?? r.me.email;
  const label = `${side === "mc" ? "Mc" : "Admin"} เดือน ${key}`;
  const log = (action: string) => db.from("booking_logs").insert({ email: r.me.email, role: "Owner", name: who, action, result: "สำเร็จ" });

  if (body?.action === "close") {
    // เดือนที่ยังไม่จบ (เดือนนี้ / เดือนหน้า ตามเวลาไทย) ปิดไม่ได้: สรุปรวมคิวที่ยังไม่ถึงวันไลฟ์ด้วย ตัวเลขที่ปิดจะไม่ใช่ยอดจริง
    if (key >= monthRange(null).key) return fail(`ปิดงวด ${label} ไม่ได้ เดือนนี้ยังไม่จบ — ปิดได้ตั้งแต่วันที่ 1 ของเดือนถัดไป`);
    const snapshot = snapshotOf(await ownerSummary(key, first, last), side);
    const { error } = await db.from("pay_periods").insert({ month: key, side, closed_by: who, closed_email: r.me.email, snapshot });
    if (error) {
      if (/pay_periods_open_key|duplicate/.test(error.message)) return fail(`งวด ${label} ปิดอยู่แล้ว`);
      return fail(/pay_periods|schema cache|does not exist/.test(error.message) ? PERIODS_SQL : error.message, 500);
    }
    await log(`ปิดงวด ${label} (${snapshot.people.length} คน ${snapshot.details.length} คิว)`);
    return ok({ message: `ปิดงวด ${label} แล้ว` });
  }
  if (body?.action === "reopen") {
    const { data, error } = await db.from("pay_periods").update({ reopened_at: new Date().toISOString(), reopened_by: who })
      .eq("month", key).eq("side", side).is("reopened_at", null).select("id");
    if (error) return fail(error.message, 500);
    if (!data?.length) return fail(`งวด ${label} ยังไม่ได้ปิด`);
    await log(`เปิดงวด ${label} ใหม่`);
    return ok({ message: `เปิดงวด ${label} ใหม่แล้ว ตัวเลขกลับไปคิดตามข้อมูลจริง` });
  }
  return fail("ไม่รู้จักคำสั่งนี้");
}
