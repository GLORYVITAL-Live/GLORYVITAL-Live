import "server-only";
import { spreadsheetIdOf } from "@/lib/frames";
import { parseDayTagRows } from "@/lib/live-days-sheet";
import type { DayTag } from "@/lib/live-days";
import type { Platform } from "@/lib/live-stats";
import { sheetsApi } from "@/lib/sheet";
import { createAdminClient } from "@/lib/supabase/server";

// ซิงก์ป้ายวันแคมเปญจากชีตของทีม "GLORY LIVE (INTERNAL)" ทุกเช้า (ผู้ใช้ขอ 2026-11-10 · cron src/app/api/cron/calendar/route.ts)
//   ลิงก์ชีตใช้ settings.cost_sheet_id ตัวเดียวกับหน้า Cost (ไม่อยู่ในโค้ด เพราะ repo เป็นสาธารณะ)
//   บันทึกเฉพาะวันที่ชีตมีป้าย และเฉพาะที่เปลี่ยน · วันที่หายจากชีตไม่ลบ (ป้ายเก่าที่นำเข้าไว้ยังอยู่)

const TABS: [Platform, RegExp][] = [["TikTok", /^glory\s*tiktok$/i], ["Shopee", /^glory\s*shopee$/i]];

export async function syncDayTags() {
  const db = createAdminClient();
  const { data: s, error: sErr } = await db.from("settings").select("cost_sheet_id").eq("id", 1).maybeSingle();
  if (sErr) return { skipped: "ยังไม่ได้รัน SQL ชีตค่าใช้จ่าย" };
  const id = spreadsheetIdOf(String(s?.cost_sheet_id ?? "").trim());
  if (!id) return { skipped: "ยังไม่ได้ตั้งลิงก์ชีต (settings.cost_sheet_id)" };

  const api = sheetsApi();
  const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(title,hidden,gridProperties.rowCount)" });
  const visible = (meta.data.sheets ?? []).map((x) => x.properties!).filter((p) => !p.hidden);
  const parsed: DayTag[] = [];
  const counts: Record<string, number> = {};
  for (const [platform, re] of TABS) {
    // แท็บซ่อน "GLORY Shopee" (ไม่มีวรรค) เป็นของเก่า · อ่านเฉพาะแท็บที่เห็น
    const tab = visible.find((p) => re.test((p.title ?? "").trim()));
    if (!tab) { counts[platform] = -1; continue; }
    const res = await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab.title}'!A1:J${tab.gridProperties?.rowCount ?? 3000}` });
    const tags = parseDayTagRows(res.data.values ?? [], platform);
    counts[platform] = tags.length;
    parsed.push(...tags);
  }
  if (!parsed.length) return { skipped: "ไม่พบป้ายวันในชีต", counts };

  // บันทึกเฉพาะที่ต่างจากในระบบ
  const have = new Map<string, string>();
  for (let p = 0; ; p++) {
    const { data, error } = await db.from("live_day_tags").select("platform, day, kind, label").range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(/live_day_tags/.test(error.message) ? "ยังไม่ได้รัน SQL 20261128000000_live_day_tags" : error.message);
    for (const r of data ?? []) have.set(`${r.platform}|${r.day}`, `${r.kind}|${r.label}`);
    if ((data ?? []).length < 1000) break;
  }
  const changed = parsed.filter((t) => have.get(`${t.platform}|${t.day}`) !== `${t.kind}|${t.label}`);
  const now = new Date().toISOString();
  for (let i = 0; i < changed.length; i += 500) {
    const { error } = await db.from("live_day_tags").upsert(
      changed.slice(i, i + 500).map((t) => ({ platform: t.platform, day: t.day, kind: t.kind, label: t.label, updated_at: now })),
      { onConflict: "platform,day" },
    );
    if (error) throw new Error(error.message);
  }
  return { counts, changed: changed.length, added: changed.filter((t) => !have.has(`${t.platform}|${t.day}`)).length };
}
