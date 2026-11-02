import "server-only";
import { monthRange } from "@/lib/api";
import { buildDashboard } from "@/lib/dashboard-calc";
import { ownerSummary } from "@/lib/data";
import { monthKey } from "@/lib/format";
import { loadSessions } from "@/lib/live-stats-db";
import type { DashboardData } from "@/lib/types";

/**
 * แดชบอร์ดเดือนนี้บนหน้าแรกของเจ้าของ: สรุปรายเดือน (สูตรเดียวกับหน้าเจ้าของ) ของเดือนนี้ + เดือนก่อน
 *   payMc / payAdmin = ฝั่งที่จัดการได้ (เห็นค่าจ้าง) · gmv = ดูสถิติไลฟ์ได้ (GMV จากไฟล์ Export)
 */
export async function ownerDashboard(opts: { payMc: boolean; payAdmin: boolean; gmv: boolean }): Promise<DashboardData> {
  const now = Date.now();
  const cur = monthRange(null), prev = monthRange(monthKey(-1, cur.key));
  const from = new Date(Date.parse(`${prev.first}T00:00:00+07:00`)).toISOString();
  const curStart = Date.parse(`${cur.first}T00:00:00+07:00`);
  const [curSum, prevSum, sessions] = await Promise.all([
    ownerSummary(cur.key, cur.first, cur.last),
    ownerSummary(prev.key, prev.first, prev.last),
    // อ่านไฟล์ Export ไม่ได้ = ไม่แสดงช่อง GMV (ส่วนอื่นของแดชบอร์ดยังแสดง)
    opts.gmv ? loadSessions(from, new Date(now).toISOString()).catch(() => null) : Promise.resolve(null),
  ]);
  return buildDashboard({
    cur: curSum, prev: prevSum, month: cur.key, prevMonth: prev.key, last: cur.last, prevLast: prev.last, now,
    payMc: opts.payMc, payAdmin: opts.payAdmin,
    sessions: sessions && {
      cur: sessions.filter((s) => Date.parse(s.startedAt) >= curStart),
      prev: sessions.filter((s) => Date.parse(s.startedAt) < curStart),
    },
  });
}
