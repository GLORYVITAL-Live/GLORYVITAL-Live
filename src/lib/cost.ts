import "server-only";
import { hasBudget } from "@/lib/agency-budget";
import { monthRange } from "@/lib/api";
import { costCut, costRows, costTotals, type CostPlanSlot, type CostPoint, type CostReport, type CostSee } from "@/lib/cost-calc";
import { parseCostSheet, sheetCoversPay, type CostSheetEntry } from "@/lib/cost-sheet";
import { sameTimePrevMonth } from "@/lib/dashboard-calc";
import { fetchAll, ownerSummary } from "@/lib/data";
import { monthKey } from "@/lib/format";
import { spreadsheetIdOf } from "@/lib/frames";
import { ownerSpanOf } from "@/lib/live-owners";
import { loadSessions } from "@/lib/live-stats-db";
import { applyPeriods } from "@/lib/periods";
import { ownerText, spanLen } from "@/lib/plan-clash";
import { sheetsApi } from "@/lib/sheet";
import { createAdminClient } from "@/lib/supabase/server";

/** อ่านชีตของทีมจำไว้กี่นาที (ทีมกรอกเพิ่ม = หน้า Cost อัปเดตภายในเวลานี้) */
const SHEET_TTL = 5 * 60_000;

const addDays = (date: string, by: number) => new Date(Date.parse(`${date}T00:00:00Z`) + by * 86400_000).toISOString().slice(0, 10);
const NO_PAY = { rates: { mc: {}, admin: {}, shopee: {}, defaultMc: 0, defaultAdmin: 0 }, mc: [], admin: [], details: [] };

let sheetCache: { at: number; id: string; months: Map<string, CostSheetEntry[]> } | null = null;

/**
 * ค่าใช้จ่ายรายเดือนจากแท็บ "Sum 2" (ลิงก์อยู่ที่ settings.cost_sheet_id ไม่อยู่ในโค้ด เพราะ repo เป็น public · SQL 20261126000000_cost_sheet)
 *   ยังไม่ตั้งลิงก์ / ยังไม่รัน SQL = ใช้ตัวเลขระบบอย่างเดียว · อ่านไม่ได้ชั่วคราว = ใช้ชุดเดิมที่จำไว้ ไม่มีก็แจ้ง error แล้วใช้ตัวเลขระบบ
 */
async function costSheet(): Promise<{ months: Map<string, CostSheetEntry[]>; ready: boolean; error: string | null }> {
  const none = new Map<string, CostSheetEntry[]>();
  const { data, error } = await createAdminClient().from("settings").select("cost_sheet_id").eq("id", 1).maybeSingle();
  if (error) return { months: none, ready: false, error: null };
  const raw = String(data?.cost_sheet_id ?? "").trim();
  if (!raw) return { months: none, ready: false, error: null };
  const id = spreadsheetIdOf(raw);
  if (!id) return { months: none, ready: true, error: "ลิงก์ชีตค่าใช้จ่ายไม่ถูกต้อง (settings.cost_sheet_id)" };
  if (sheetCache?.id === id && Date.now() - sheetCache.at < SHEET_TTL) return { months: sheetCache.months, ready: true, error: null };
  try {
    const api = sheetsApi();
    const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
    const tab = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "").find((t) => /^sum\s*2$/i.test(t.trim()));
    if (!tab) throw new Error('ไม่พบแท็บ "Sum 2"');
    // อ่านตามที่แสดงในชีต: หัวเดือนเก็บเป็นวันที่ ค่าดิบเป็นเลขวันที่ ไม่ใช่ "Nov 2026"
    const res = await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A1:AZ200` });
    const months = parseCostSheet(res.data.values ?? []);
    sheetCache = { at: Date.now(), id, months };
    return { months, ready: true, error: null };
  } catch (err) {
    if (sheetCache?.id === id) return { months: sheetCache.months, ready: true, error: null };
    const msg = String((err as Error)?.message ?? err);
    return { months: none, ready: true, error: /permission/i.test(msg) ? "บัญชีระบบเปิดชีตค่าใช้จ่ายไม่ได้ ต้องแชร์ชีตให้บัญชีที่เว็บใช้อยู่" : `อ่านชีตค่าใช้จ่ายไม่สำเร็จ: ${msg.slice(0, 160)}` };
  }
}

/**
 * ข้อมูลของเดือนหนึ่ง เฉพาะส่วนที่บัญชีนี้ดูได้ · ฝั่งที่ปิดงวดแล้ว = ตัวเลขตอนปิด (ตรงกับหน้าเจ้าของ / ไฟล์เบิก)
 *   skipPay = ไม่ต้องโหลดสรุปค่าจ้าง (ชีตมียอดจริงครบแล้ว)
 */
async function monthData(month: string | null, see: CostSee, skipPay = false) {
  const range = monthRange(month);
  const { key, first, last } = range;
  const db = createAdminClient();
  const sides = [...(see.mc ? ["mc" as const] : []), ...(see.admin ? ["admin" as const] : [])];
  type PlanRow = { agency: string; platform: string; live_date: string; start_time: string; end_time: string };
  const [summary, planRows, rateRows, sessions] = await Promise.all([
    sides.length && !skipPay
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
  const [cur, sheet] = await Promise.all([monthData(month, see), costSheet()]);
  const prevKey = monthKey(-1, cur.range.key);
  const prev = await monthData(prevKey, see);
  const cut = costCut(Date.now(), cur.range.last, cur.sessions);
  const prevCut = cut === Infinity ? Infinity : sameTimePrevMonth(cut, prev.range.last)[0];
  const { rows, salaried, unrated } = costRows({ ...cur, cut, see, sheet: sheet.months.get(cur.range.key) });
  // เดือนก่อนนับถึงเวลาเดียวกัน: ยอดในชีตเป็นยอดทั้งเดือน เทียบกันไม่ได้ ใช้ตัวเลขระบบ
  const prevRows = costRows({ ...prev, cut: prevCut, see, sheet: prevCut === Infinity ? sheet.months.get(prevKey) : null }).rows;
  // ช่องใส่เรท: กลุ่มในแพลนของเดือนนี้ + กลุ่มที่เคยตั้งเรทไว้ (ชั่วโมงตามแพลน ไม่ใช่ชั่วโมงในชีต)
  const hours = new Map<string, number>();
  for (const s of cur.plan) if (hasBudget(s.agency)) hours.set(s.agency, (hours.get(s.agency) ?? 0) + spanLen(s) / 60);
  const names = new Set([...hours.keys(), ...cur.rates.keys()]);
  return {
    month: cur.range.key, prevMonth: prevKey, upTo: cut === Infinity ? null : cut, see,
    rows, totals: costTotals(rows), prev: costTotals(prevRows),
    salaried, unrated,
    agencies: see.agency
      ? [...names].sort().map((agency) => ({ agency, label: ownerText(agency), rate: cur.rates.get(agency) ?? null, hours: hours.get(agency) ?? 0 }))
      : [],
    sheet: { ready: sheet.ready, error: sheet.error },
  };
}

/**
 * ยอดรายเดือนของทั้งปี (ถึงเดือนนี้) · โหลดทีละเดือนไม่ให้กินแรมพร้อมกัน (เว็บจริงมีแรม 512 MB)
 *   เดือนที่ชีตมียอดจริงครบไม่ต้องโหลดสรุปค่าจ้าง จึงเร็วกว่าโหลดทุกเดือน
 */
export async function costTrend(year: string, see: CostSee): Promise<CostPoint[]> {
  const sheet = await costSheet();
  const now = monthKey();
  const last = year < now.slice(0, 4) ? 12 : year === now.slice(0, 4) ? Number(now.slice(5)) : 0;
  const out: CostPoint[] = [];
  for (let i = 0; i < last; i++) {
    const key = monthKey(i, `${year}-01`), entries = sheet.months.get(key);
    const m = await monthData(key, see, sheetCoversPay(entries));
    const cut = costCut(Date.now(), m.range.last, m.sessions);
    const { rows } = costRows({ ...m, cut, see, sheet: entries });
    out.push({ ...costTotals(rows), month: m.range.key, open: cut !== Infinity, rows });
  }
  return out;
}
