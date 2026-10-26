import { after } from "next/server";
import { fail, ok, requireOwner } from "@/lib/api";
import { getSettings } from "@/lib/data";
import { canEditQuota, computeMonth, notifyQuotaOn, QUOTA_SQL, quotaReport, setQuotaExtra } from "@/lib/mc-quota-db";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

// สิทธิ์จองคิวของ Mc ต่อเดือนตามแร็งค์ (หน้าเจ้าของ > ผลงาน Mc > สิทธิ์จอง) — src/lib/mc-quota-db.ts
//   GET    ?month=YYYY-MM  แร็งค์ + สิทธิ์ + จองแล้ว ของทุก Mc (Owner ที่ดูฝั่ง Mc ได้)
//   POST   { month, action: "refresh" }  คำนวณแร็งค์ใหม่ (สิทธิ์เพิ่มพิเศษไม่หาย)
//          { action: "toggle", on }       เปิด / ปิดการจำกัดสิทธิ์จอง
//   PATCH  { month, staffId, extra, note } ตั้งสิทธิ์เพิ่มพิเศษ (ติดลบ = ลดสิทธิ์)
// แก้ได้: Owner ที่จัดการได้ทั้ง Mc + Admin หรือติ๊ก "กำหนดสิทธิ์จอง Mc" ในหน้าพนักงาน

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const thisMonth = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
const noEdit = () => fail("บัญชีนี้ไม่มีสิทธิ์กำหนดสิทธิ์จอง Mc (ให้ Owner ที่จัดการได้ทั้ง Mc และ Admin ติ๊กให้ในหน้าพนักงาน)", 403);
const sqlFail = (err: unknown) => {
  const msg = (err as Error).message;
  return fail(msg, msg === QUOTA_SQL ? 409 : 500);
};

/** ประวัติ (booking_logs) staffId = ผูกกับรายชื่อนั้น (เห็นในประวัติการแก้ของคนนั้น) */
async function log(me: Me, action: string, staffId?: number) {
  await createAdminClient().from("booking_logs").insert({
    email: me.email, role: "Owner", name: me.owner?.name ?? "", action, result: "สำเร็จ",
    ...(staffId ? { slot_table: "staff", slot_id: staffId } : {}),
  });
}

async function access() {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูสิทธิ์จอง Mc", "read");
  if ("res" in r) return r;
  if (!r.scope.mc) return { res: fail("สิทธิ์จอง Mc ใช้ข้อมูลฝั่ง Mc ต้องมีสิทธิ์ฝั่ง Mc", 403) };
  return { me: r.me, canEdit: await canEditQuota(r.me) };
}

export async function GET(request: Request) {
  const r = await access();
  if ("res" in r) return r.res;
  const month = new URL(request.url).searchParams.get("month") ?? thisMonth();
  if (!MONTH_RE.test(month)) return fail("เดือนไม่ถูกต้อง");
  try {
    return ok({ report: await quotaReport(month, await getSettings(), r.canEdit) });
  } catch (err) {
    return sqlFail(err);
  }
}

export async function POST(request: Request) {
  const r = await access();
  if ("res" in r) return r.res;
  if (!r.canEdit) return noEdit();
  const body = await request.json().catch(() => ({}));
  if (body?.action === "toggle") {
    const on = body.on === true;
    const { error } = await createAdminClient().from("settings").update({ mc_quota_on: on }).eq("id", 1);
    if (error) return fail(/mc_quota_on/.test(error.message) ? QUOTA_SQL : error.message, /mc_quota_on/.test(error.message) ? 409 : 500);
    after(async () => {
      await log(r.me, `${on ? "เปิด" : "ปิด"}การจำกัดสิทธิ์จอง Mc ตามแร็งค์`);
      // เปิดใช้ = แจ้งเตือน Mc ที่ถูกจำกัดทุกคน (สิทธิ์ + แร็งค์ของตัวเอง · วันละครั้ง)
      if (on) await notifyQuotaOn({ ...(await getSettings()), mc_quota_on: true }, r.me.email);
    });
    return ok({ message: on ? "เปิดการจำกัดสิทธิ์จองแล้ว · แจ้งเตือน Mc แล้ว" : "ปิดการจำกัดสิทธิ์จองแล้ว" });
  }
  if (body?.action === "refresh") {
    const month = String(body.month ?? "");
    if (!MONTH_RE.test(month)) return fail("เดือนไม่ถูกต้อง");
    try {
      await computeMonth(month);
      after(() => log(r.me, `คำนวณแร็งค์สิทธิ์จอง Mc เดือน ${month} ใหม่`));
      return ok({ report: await quotaReport(month, await getSettings(), r.canEdit) });
    } catch (err) {
      return sqlFail(err);
    }
  }
  return fail("ไม่รู้จักคำสั่งนี้");
}

export async function PATCH(request: Request) {
  const r = await access();
  if ("res" in r) return r.res;
  if (!r.canEdit) return noEdit();
  const body = await request.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  const staffId = Number(body?.staffId);
  const extra = Number(String(body?.extra ?? "0").trim() || 0);
  const note = String(body?.note ?? "").trim().slice(0, 200);
  if (!MONTH_RE.test(month)) return fail("เดือนไม่ถูกต้อง");
  if (!Number.isInteger(staffId) || staffId <= 0) return fail("ไม่พบรายชื่อนี้");
  if (!Number.isInteger(extra) || extra < -100 || extra > 200) return fail("สิทธิ์เพิ่มต้องเป็นจำนวนเต็ม -100 ถึง 200");

  const db = createAdminClient();
  const { data: person } = await db.from("staff").select("name").eq("id", staffId).eq("role", "mc").maybeSingle();
  if (!person) return fail("ไม่พบรายชื่อ Mc นี้");
  try {
    const before = await setQuotaExtra(month, staffId, extra, note, r.me.owner?.name || r.me.email);
    if (before.extra !== extra || before.note !== note) {
      const parts = [
        before.extra !== extra ? `เพิ่มพิเศษ ${before.extra} → ${extra} (รวม ${Math.max(0, before.auto + before.extra)} → ${Math.max(0, before.auto + extra)} slot)` : "",
        before.note !== note ? `หมายเหตุ "${before.note || "ว่าง"}" → "${note || "ว่าง"}"` : "",
      ].filter(Boolean);
      after(() => log(r.me, `สิทธิ์จอง Mc ${person.name} เดือน ${month}: ${parts.join(" · ")}`, staffId));
    }
    return ok({ message: "บันทึกแล้ว" });
  } catch (err) {
    return sqlFail(err);
  }
}
