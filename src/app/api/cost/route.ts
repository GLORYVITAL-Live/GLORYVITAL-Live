import { cleanAgency, validRate } from "@/lib/agency-budget";
import { fail, ok, requireMe, requirePlanner } from "@/lib/api";
import { costReport, costTrend } from "@/lib/cost";
import { createAdminClient } from "@/lib/supabase/server";

// หน้า Cost: ค่าใช้จ่ายของทีมไลฟ์
//   GET  ?month=YYYY-MM -> { report } · ?trend=1 -> { trend } ยอดย้อนหลัง (แยกคำขอ หน้าแรกของ Cost จะได้ไม่ต้องรอ)
//   POST { month, rates: [{ agency, rate }] } เรทต่อชั่วโมงของกลุ่มภายนอก (ตาราง agency_rates · rate null = ล้างเรท)
// สิทธิ์: เห็นเฉพาะส่วนที่จัดการได้ ค่าจ้าง Mc / ค่าจ้าง Admin + ค่ารถ / งบกลุ่มภายนอก (Plan Slot Live) · GMV ต้องดูสถิติไลฟ์ได้

export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const o = r.me.owner;
  const see = { mc: !!o?.mc, admin: !!o?.admin, agency: !!o?.plan, gmv: !!o?.see.analytics };
  if (!see.mc && !see.admin && !see.agency) return fail("บัญชีนี้ไม่มีสิทธิ์ดูหน้า Cost", 403);
  const params = new URL(request.url).searchParams;
  try {
    if (params.has("trend")) return ok({ trend: await costTrend(see) });
    return ok({ report: await costReport(params.get("month"), see) });
  } catch (err) {
    return fail((err as { message?: string }).message ?? "โหลดหน้า Cost ไม่สำเร็จ", 500);
  }
}

export async function POST(request: Request) {
  const r = await requirePlanner("บัญชีนี้ไม่มีสิทธิ์แก้เรท Agency");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const month = String(body?.month ?? "");
  if (!MONTH_RE.test(month) || !Array.isArray(body?.rates) || !body.rates.length) return fail("ข้อมูลเรท Agency ไม่ถูกต้อง");
  const rates: { agency: string; rate: number | null }[] = [];
  for (const x of body.rates) {
    const agency = cleanAgency(x?.agency);
    if (!agency || (x?.rate !== null && !validRate(x?.rate))) return fail("ข้อมูลเรท Agency ไม่ถูกต้อง");
    rates.push({ agency, rate: x.rate });
  }
  const db = createAdminClient();
  try {
    const set = rates.filter((x) => x.rate !== null).map((x) => ({ ...x, month, updated_by: r.me.email, updated_at: new Date().toISOString() }));
    if (set.length) {
      const { error } = await db.from("agency_rates").upsert(set, { onConflict: "agency,month" });
      if (error) throw new Error(error.message);
    }
    for (const x of rates.filter((b) => b.rate === null)) {
      const { error } = await db.from("agency_rates").delete().eq("agency", x.agency).eq("month", month);
      if (error) throw new Error(error.message);
    }
    return ok({});
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
