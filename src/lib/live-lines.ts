// เส้นรายวันของแต่ละแพลตฟอร์มในหน้าสถิติไลฟ์ — ฟังก์ชันล้วน (เทสได้) นับตามวันที่เริ่มไลฟ์

import { bkkParts, metricOf, totalsOf, type LiveSession, type MetricKey, type Platform } from "@/lib/live-stats";

const PLATFORMS: Platform[] = ["TikTok", "Shopee"];

/** ค่าทุกวันของเดือน: วันที่ไม่มีไลฟ์ / ไม่มีค่า = null (เส้นขาด ไม่ลากข้าม) · ไม่แสดงแพลตฟอร์มที่ไม่มีค่าเลย */
export function dailyByPlatform(sessions: LiveSession[], month: string, metric: MetricKey) {
  const def = metricOf(metric);
  const [y, m] = month.split("-").map(Number);
  const days = Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => i + 1);
  const series = PLATFORMS.map((platform) => {
    const byDay = new Map<number, LiveSession[]>();
    for (const s of sessions) {
      if (s.platform !== platform) continue;
      const d = bkkParts(s.startedAt).d;
      byDay.set(d, [...(byDay.get(d) ?? []), s]);
    }
    const values = days.map((d) => {
      const list = byDay.get(d);
      const v = list ? def.value(totalsOf(list)) : null;
      return v === null || !Number.isFinite(v) ? null : v;
    });
    return { platform, values };
  }).filter((s) => s.values.some((v) => v !== null));
  return { days, series };
}
