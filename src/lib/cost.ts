import "server-only";
import { hasBudget } from "@/lib/agency-budget";
import { monthRange } from "@/lib/api";
import { costCut, costRows, costTotals, type CostPlanSlot, type CostPoint, type CostReport, type CostSee } from "@/lib/cost-calc";
import { sameTimePrevMonth } from "@/lib/dashboard-calc";
import { fetchAll, ownerSummary } from "@/lib/data";
import { monthKey } from "@/lib/format";
import { ownerSpanOf } from "@/lib/live-owners";
import { loadSessions } from "@/lib/live-stats-db";
import { applyPeriods } from "@/lib/periods";
import { ownerText } from "@/lib/plan-clash";
import { createAdminClient } from "@/lib/supabase/server";

/** กราฟแนวโน้มย้อนหลังกี่เดือน */
const TREND_MONTHS = 6;

const addDays = (date: string, by: number) => new Date(Date.parse(`${date}T00:00:00Z`) + by * 86400_000).toISOString().slice(0, 10);
const NO_PAY = { rates: { mc: {}, admin: {}, shopee: {}, defaultMc: 0, defaultAdmin: 0 }, mc: [], admin: [], details: [] };

/** ข้อมูลของเดือนหนึ่ง เฉพาะส่วนที่บัญชีนี้ดูได้ · ฝั่งที่ปิดงวดแล้ว = ตัวเลขตอนปิด (ตรงกับหน้าเจ้าของ / ไฟล์เบิก) */
async function monthData(month: string | null, see: CostSee) {
  const range = monthRange(month);
  const { key, first, last } = range;
  const db = createAdminClient();
  const sides = [...(see.mc ? ["mc" as const] : []), ...(see.admin ? ["admin" as const] : [])];
  type PlanRow = { agency: string; platform: string; live_date: string; start_time: string; end_time: string };
  const [summary, planRows, rateRows, sessions] = await Promise.all([
    sides.length
      ? ownerSummary(key, first, last).then(async (s) => { await applyPeriods(s, key, sides); return s; })
      : NO_PAY,
    fetchAll<PlanRow>((a, b) => db.from("agency_slots").select("agency, platform, live_date, start_time, end_time")
      .gte("live_date", addDays(first, -1)).lte("live_date", last).order("id").range(a, b) as never),
    see.agency
      ? db.from("agency_rates").select("agency, rate").eq("month", key).then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data ?? [];
      })
      : [],
    // อ่านไฟล์ Export ไม่ได้ = ไม่แสดง GMV (ค่าใช้จ่ายยังแสดง)
    see.gmv
      ? loadSessions(new Date(Date.parse(`${first}T00:00:00+07:00`)).toISOString(), new Date(Date.parse(`${addDays(last, 1)}T00:00:00+07:00`)).toISOString()).catch(() => null)
      : null,
  ]);
  const plan: CostPlanSlot[] = planRows.filter((x) => x.live_date >= first).map((x) => (
    { agency: x.agency, platform: x.platform, date: x.live_date, start: x.start_time.slice(0, 5), end: x.end_time.slice(0, 5) }
  ));
  return { range, summary, plan, rates: new Map(rateRows.map((x) => [x.agency as string, Number(x.rate)])), sessions, spans: planRows.map(ownerSpanOf) };
}

/** รายงานของเดือน (ไม่ส่ง = เดือนนี้) เทียบเดือนก่อน · เดือนที่ยังไม่จบ: เดือนก่อนนับถึงเวลาเดียวกัน */
export async function costReport(month: string | null, see: CostSee): Promise<CostReport> {
  const cur = await monthData(month, see);
  const prevKey = monthKey(-1, cur.range.key);
  const prev = await monthData(prevKey, see);
  const cut = costCut(Date.now(), cur.range.last, cur.sessions);
  const prevCut = cut === Infinity ? Infinity : sameTimePrevMonth(cut, prev.range.last)[0];
  const { rows, salaried, unrated } = costRows({ ...cur, cut, see });
  const hours = new Map<string, number>();
  for (const r of rows) if (r.owner && hasBudget(r.owner)) hours.set(r.owner, (hours.get(r.owner) ?? 0) + r.planHours);
  const names = new Set([...hours.keys(), ...cur.rates.keys()]);
  return {
    month: cur.range.key, prevMonth: prevKey, upTo: cut === Infinity ? null : cut, see,
    rows, totals: costTotals(rows), prev: costTotals(costRows({ ...prev, cut: prevCut, see }).rows),
    salaried, unrated,
    agencies: see.agency
      ? [...names].sort().map((agency) => ({ agency, label: ownerText(agency), rate: cur.rates.get(agency) ?? null, hours: hours.get(agency) ?? 0 }))
      : [],
  };
}

/** ยอดย้อนหลังถึงเดือนนี้ · โหลดทีละเดือนไม่ให้กินแรมพร้อมกัน (เว็บจริงมีแรม 512 MB) */
export async function costTrend(see: CostSee): Promise<CostPoint[]> {
  const out: CostPoint[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const m = await monthData(monthKey(-i), see);
    const cut = costCut(Date.now(), m.range.last, m.sessions);
    out.push({ ...costTotals(costRows({ ...m, cut, see }).rows), month: m.range.key, open: cut !== Infinity });
  }
  return out;
}
