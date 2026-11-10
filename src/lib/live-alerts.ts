import "server-only";
import { dropDigest } from "@/lib/live-drops";
import { liveDay } from "@/lib/live-days";
import { ownerSpanOf } from "@/lib/live-owners";
import { bkkIso } from "@/lib/live-stats";
import { loadSessions } from "@/lib/live-stats-db";
import { notifyMany } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/server";

// แจ้งเตือนยอดดรอปทุกวันจันทร์ (ผู้ใช้ขอ 2026-11-10) — เรียกจาก cron ประจำเช้า (src/app/api/cron/calendar/route.ts)
//   7 วันล่าสุดที่มีไฟล์ Export ครบทั้งสองแพลตฟอร์ม (ไม่เกินเมื่อวาน) เทียบ 7 วันก่อนหน้า -> Owner ที่ดู Data analytics ได้
//   แจ้งครั้งเดียวต่อช่วง (dedupe ตามวันสุดท้ายของช่วง) · กดแจ้งเตือน = ไปหน้า Analytics

const DAY = 86400_000;
const addDay = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const startOf = (key: string) => { const [y, m, d] = key.split("-").map(Number); return bkkIso(y, m, d); };
const short = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", timeZone: "UTC" });
const rangeText = (from: string, to: string) => {
  const a = short.format(new Date(`${from}T00:00:00Z`)), b = short.format(new Date(`${to}T00:00:00Z`));
  return from.slice(0, 7) === to.slice(0, 7) ? `${a.split(" ")[0]}–${b}` : `${a}–${b}`;
};

/** force = ส่งแม้ไม่ใช่วันจันทร์ (ทดสอบ) · dryRun = คำนวณอย่างเดียว ไม่ส่ง */
export async function weeklyDropAlert(now = Date.now(), opts: { force?: boolean; dryRun?: boolean } = {}) {
  const bkk = new Date(now + 7 * 3600_000);
  if (!opts.force && bkk.getUTCDay() !== 1) return { skipped: "ไม่ใช่วันจันทร์" };
  const db = createAdminClient();
  const yesterday = addDay(bkk.toISOString().slice(0, 10), -1);
  // วันล่าสุดที่มีไลฟ์ในไฟล์ของแต่ละแพลตฟอร์ม: ใช้วันที่ครบทั้งคู่ (แพลตฟอร์มที่ยังไม่อัปโหลดจะดูเหมือนดรอปทั้งวัน)
  const lastDays: string[] = [];
  for (const platform of ["TikTok", "Shopee"]) {
    const { data, error } = await db.from("live_sessions").select("started_at").eq("platform", platform).order("started_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    if (data?.[0]) lastDays.push(liveDay({ startedAt: new Date(String(data[0].started_at)).toISOString() }));
  }
  if (!lastDays.length) return { skipped: "ยังไม่มีข้อมูลไลฟ์" };
  const end = [yesterday, ...lastDays].sort()[0];
  const aFrom = addDay(end, -6), bFrom = addDay(end, -13), bTo = addDay(end, -7);
  const sessions = await loadSessions(startOf(bFrom), startOf(addDay(end, 1)));
  const a = sessions.filter((s) => liveDay(s) >= aFrom), b = sessions.filter((s) => liveDay(s) < aFrom);
  const { data: plan, error } = await db.from("agency_slots").select("agency, platform, live_date, start_time, end_time")
    .gte("live_date", addDay(bFrom, -1)).lte("live_date", end).limit(5000);
  // ยังไม่มีตารางแพลน = แยกกลุ่มจากกลุ่มที่บันทึกกับไลฟ์อย่างเดียว
  const spans = error ? [] : (plan ?? []).map(ownerSpanOf);
  const aName = rangeText(aFrom, end), bName = rangeText(bFrom, bTo);
  const digest = dropDigest(a, b, spans, aName, bName);
  if (opts.dryRun) return { dryRun: true, ...digest };

  const { data: owners } = await db.from("staff").select("email").eq("role", "owner").eq("can_view_analytics", true).not("email", "is", null);
  const emails = [...new Set((owners ?? []).map((o) => String(o.email).trim().toLowerCase()).filter(Boolean))];
  const sent = await notifyMany(emails.map((email) => ({
    email, kind: "weekly" as const, page: "stats" as const, dedupe: `drops:${end}`, title: digest.title, body: digest.body,
  })));
  return { range: `${aFrom}..${end}`, drops: digest.drops.length, sent };
}
