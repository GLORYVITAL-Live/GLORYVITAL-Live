import "server-only";
import { monthRange } from "@/lib/api";
import {
  bkkMonth, forecastEntriesOf, forecastHours, forecastTotal, forecastWrites, lockAt, lockDue, sheetForecastHours,
  type ForecastEntry, type ForecastStatus, type ForecastWrite, type LockedForecast,
} from "@/lib/cost-forecast";
import { parseCostSheet } from "@/lib/cost-sheet";
import { fetchAll } from "@/lib/data";
import { spreadsheetIdOf } from "@/lib/frames";
import { withSyncLock } from "@/lib/lock";
import { sheetsApi } from "@/lib/sheet";
import { createAdminClient } from "@/lib/supabase/server";

// Forecast เดือนหน้าในแท็บ "Sum 2": อัปเดตตามแพลน / ล็อค / ปลดล็อค (กติกาที่ src/lib/cost-forecast.ts)
//   ลิงก์ชีตอยู่ที่ settings.cost_sheet_id (ตัวเดียวกับหน้า Cost) · ตาราง cost_forecasts (SQL 20261202000000_cost_forecasts)

type Actor = { email: string; name: string } | null; // null = อัตโนมัติ (cron)

/** ชีต + แท็บ "Sum 2" · ยังไม่ตั้งลิงก์ = throw */
async function sheetTarget() {
  const { data } = await createAdminClient().from("settings").select("cost_sheet_id").eq("id", 1).maybeSingle();
  const id = spreadsheetIdOf(String(data?.cost_sheet_id ?? ""));
  if (!id) throw new Error("ยังไม่ได้ตั้งลิงก์ชีตค่าใช้จ่าย (settings.cost_sheet_id)");
  const api = sheetsApi();
  const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  const tab = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "").find((t) => /^sum\s*2$/i.test(t.trim()));
  if (!tab) throw new Error('ไม่พบแท็บ "Sum 2" ในชีตค่าใช้จ่าย');
  return { api, id, tab };
}

/** ทั้งแท็บ: ค่าที่แสดง (หัวเดือนเป็นวันที่) + สูตร */
async function readGrid(t: Awaited<ReturnType<typeof sheetTarget>>) {
  const range = `'${t.tab}'!A1:AZ200`;
  const [values, formulas] = await Promise.all([
    t.api.spreadsheets.values.get({ spreadsheetId: t.id, range }),
    t.api.spreadsheets.values.get({ spreadsheetId: t.id, range, valueRenderOption: "FORMULA" }),
  ]);
  return { values: values.data.values ?? [], formulas: formulas.data.values ?? [] };
}

/** ชั่วโมงในแพลนของเดือน (คิว Mc ทีมเรา + แพลนกลุ่มภายนอก) */
async function planHours(month: string) {
  const { first, last } = monthRange(month);
  const db = createAdminClient();
  type Mc = { platform: string; sheet_tab: string | null; start_time: string; end_time: string; person: { is_salaried: boolean | null } | null };
  type Ag = { agency: string; platform: string; start_time: string; end_time: string };
  const [mc, ag] = await Promise.all([
    fetchAll<Mc>((a, b) => db.from("mc_slots").select("platform, sheet_tab, start_time, end_time, person:staff!mc_id(is_salaried)")
      .eq("is_cancelled", false).gte("live_date", first).lte("live_date", last).order("id").range(a, b) as never),
    fetchAll<Ag>((a, b) => db.from("agency_slots").select("agency, platform, start_time, end_time")
      .gte("live_date", first).lte("live_date", last).order("id").range(a, b) as never),
  ]);
  return forecastHours(
    mc.map((s) => ({ platform: s.platform, shopeeTab: s.sheet_tab === "shopee", start: s.start_time, end: s.end_time, salaried: !!s.person?.is_salaried })),
    ag.map((s) => ({ agency: s.agency, platform: s.platform, start: s.start_time, end: s.end_time })),
  );
}

async function agencyRates(month: string) {
  const { data, error } = await createAdminClient().from("agency_rates").select("agency, rate").eq("month", month);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((x) => [String(x.agency), Number(x.rate)]));
}

type Row = { month: string; entries: ForecastEntry[]; total: number; hours: number; locked_at: string; locked_by: string };
const toLocked = (r: Row): LockedForecast => ({
  month: r.month, entries: r.entries ?? [], total: Number(r.total), hours: Number(r.hours), lockedAt: r.locked_at, lockedBy: r.locked_by,
});

/** ทุกเดือนที่ล็อคแล้ว (ยังไม่ได้รัน SQL = ว่าง) */
export async function lockedForecasts(): Promise<LockedForecast[]> {
  const { data, error } = await createAdminClient().from("cost_forecasts").select("*");
  return error ? [] : ((data ?? []) as Row[]).map(toLocked);
}

export async function lockedForecast(month: string): Promise<LockedForecast | null> {
  const { data, error } = await createAdminClient().from("cost_forecasts").select("*").eq("month", month).maybeSingle();
  if (error) {
    if (/cost_forecasts/.test(error.message)) throw new Error("ยังไม่ได้รัน SQL ล็อค Forecast (supabase/migrations/20261202000000_cost_forecasts.sql)");
    throw new Error(error.message);
  }
  return data ? toLocked(data as Row) : null;
}

async function writeLog(actor: Actor, action: string) {
  await createAdminClient().from("booking_logs").insert({
    email: actor?.email ?? "", role: actor ? "Owner" : "ระบบ", name: actor?.name ?? "Forecast อัตโนมัติ", action, result: "สำเร็จ",
  });
}

const monthText = (month: string) => `Forecast ${month}`;

export type ForecastUpdate = { month: string; written: ForecastWrite[]; warnings: string[]; missing: string | null; skipped?: string };

/** อัปเดตคอลัมน์ Forecast ของเดือนนี้ตามแพลน (ล็อคแล้ว / เลยวันล็อค = ไม่แตะ) */
export async function updateForecast(month: string, actor: Actor): Promise<ForecastUpdate> {
  const base = { month, written: [], warnings: [], missing: null };
  if (await lockedForecast(month)) return { ...base, skipped: "ล็อคแล้ว" };
  if (lockDue(month, Date.now())) return { ...base, skipped: "เลยวันล็อคแล้ว" };
  const res = await withSyncLock("cost-forecast", async () => {
    const t = await sheetTarget();
    const [grid, hours, rates] = await Promise.all([readGrid(t), planHours(month), agencyRates(month)]);
    const plan = forecastWrites(grid, month, hours, rates);
    if (plan.writes.length) {
      await t.api.spreadsheets.values.batchUpdate({
        spreadsheetId: t.id,
        requestBody: { valueInputOption: "USER_ENTERED", data: plan.writes.map((w) => ({ range: `'${t.tab}'!${w.cell}`, values: [[w.value]] })) },
      });
      await writeLog(actor, `${monthText(month)}: อัปเดตตามแพลน ${plan.writes.length} ช่อง (${plan.writes.map((w) => `${w.cell}=${w.value}`).join(", ")})`.slice(0, 500));
    }
    return { month, written: plan.writes, warnings: plan.warnings, missing: plan.missing };
  }, 20_000);
  return res ?? { ...base, skipped: "มีการอัปเดตชีตค่าใช้จ่ายอยู่ ลองใหม่อีกครั้ง" };
}

/** ล็อค Forecast ของเดือนนี้: เก็บตัวเลขในชีตตอนนี้ไว้ในเว็บ (ล็อคแล้ว = คืนชุดเดิม) */
export async function lockForecast(month: string, actor: Actor): Promise<LockedForecast> {
  const had = await lockedForecast(month);
  if (had) return had;
  const t = await sheetTarget();
  const res = await t.api.spreadsheets.values.get({ spreadsheetId: t.id, range: `'${t.tab}'!A1:AZ200` });
  const values = res.data.values ?? [];
  const entries = forecastEntriesOf(parseCostSheet(values).get(month));
  if (!entries.length) throw new Error(`แท็บ "Sum 2" ยังไม่มีตัวเลข Forecast ของ ${month} จึงยังล็อคไม่ได้`);
  const total = forecastTotal(entries), hours = sheetForecastHours(values, month);
  const db = createAdminClient();
  const { error } = await db.from("cost_forecasts").insert({ month, entries, total, hours, locked_by: actor?.email ?? "" });
  // ล็อคพร้อมกันสองที่ (เช่น กดปุ่มตอน cron ทำงาน) = ใช้ชุดที่ล็อคก่อน
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  if (!error) await writeLog(actor, `${monthText(month)}: ล็อค (เงิน ${total} บาท · ${hours} ชม.)`);
  return (await lockedForecast(month))!;
}

/** ปลดล็อค (ได้เฉพาะก่อนวันล็อค เช่น กดล็อคเร็วไป) */
export async function unlockForecast(month: string, actor: Actor) {
  if (lockDue(month, Date.now())) throw new Error("เลยวันที่ 20 ของเดือนก่อนหน้าแล้ว ปลดล็อคไม่ได้ (ส่วนที่เปลี่ยนให้ไปใส่ใน Actual)");
  const { error } = await createAdminClient().from("cost_forecasts").delete().eq("month", month);
  if (error) throw new Error(error.message);
  await writeLog(actor, `${monthText(month)}: ปลดล็อค`);
}

export async function forecastStatus(month: string): Promise<ForecastStatus> {
  const out: ForecastStatus = { month, lockAt: lockAt(month), due: lockDue(month, Date.now()), locked: null, sheet: null, last: null, error: null };
  try {
    out.locked = await lockedForecast(month);
    const t = await sheetTarget();
    const res = await t.api.spreadsheets.values.get({ spreadsheetId: t.id, range: `'${t.tab}'!A1:AZ200` });
    const values = res.data.values ?? [];
    const entries = forecastEntriesOf(parseCostSheet(values).get(month));
    out.sheet = entries.length ? { total: forecastTotal(entries), hours: sheetForecastHours(values, month) } : null;
  } catch (err) {
    out.error = String((err as Error)?.message ?? err).slice(0, 200);
  }
  const { data } = await createAdminClient().from("booking_logs").select("at, action")
    .like("action", `${monthText(month)}:%`).order("at", { ascending: false }).limit(1);
  out.last = data?.[0] ? { at: String(data[0].at), action: String(data[0].action) } : null;
  return out;
}

/**
 * cron (ชั่วโมงละครั้ง): 23:00 น. อัปเดต Forecast เดือนหน้าตามแพลน (จนถึงวันที่ 20)
 *   เดือนนี้ / เดือนหน้าที่เลยวันล็อคแล้วแต่ยังไม่ล็อค → ล็อคจากตัวเลขในชีต (ชีตยังไม่มี Forecast = ข้าม ลองใหม่รอบหน้า)
 */
export async function forecastCron(now = Date.now()) {
  const next = bkkMonth(now, 1);
  const hour = new Date(now + 7 * 3600_000).getUTCHours();
  const update = hour === 23 && !lockDue(next, now)
    ? await updateForecast(next, null).then((x) => ({ month: x.month, written: x.written.length, skipped: x.skipped, missing: x.missing }))
    : null;
  const locked: { month: string; total?: number; error?: string }[] = [];
  for (const month of [bkkMonth(now, 0), next]) {
    if (!lockDue(month, now) || (await lockedForecast(month))) continue;
    locked.push(await lockForecast(month, null).then((x) => ({ month, total: x.total })).catch((err) => ({ month, error: String(err?.message ?? err).slice(0, 120) })));
  }
  return { update, locked };
}
