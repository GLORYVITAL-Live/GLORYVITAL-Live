// ค่าของแต่ละแพลตฟอร์มสำหรับกราฟในหน้าสถิติไลฟ์ (แท่งซ้อน / เส้นรายวัน) — ฟังก์ชันล้วน (เทสได้) นับตามวันที่เริ่มไลฟ์

import { bkkParts, metricOf, totalsOf, type LiveSession, type MetricKey, type Platform } from "@/lib/live-stats";

const PLATFORMS: Platform[] = ["TikTok", "Shopee"];

/** ตัวชี้วัดที่บวกกันได้ = ซ้อนแท่งได้ (ความสูงรวม = ยอดรวมจริง) · ค่าต่อหน่วย (GMV/ชม. CO ...) บวกกันแล้วความหมายผิด */
const STACKABLE: MetricKey[] = ["gmv", "orders", "items", "duration", "viewers", "views", "impressions", "lives"];
export const isStackable = (metric: MetricKey) => STACKABLE.includes(metric);

/** ค่าของไลฟ์กลุ่มหนึ่ง: ไม่มีไลฟ์ / ไม่มีค่า = null */
const valueOf = (list: LiveSession[], metric: MetricKey) => {
  const v = list.length ? metricOf(metric).value(totalsOf(list)) : null;
  return v === null || !Number.isFinite(v) ? null : v;
};

/** ค่าของแต่ละกลุ่ม (วัน / เดือน / ...) แยกแพลตฟอร์ม · ไม่แสดงแพลตฟอร์มที่ไม่มีค่าเลย */
export function platformSeries(groups: LiveSession[][], metric: MetricKey) {
  return PLATFORMS.map((platform) => ({
    platform,
    values: groups.map((list) => valueOf(list.filter((s) => s.platform === platform), metric)),
  })).filter((s) => s.values.some((v) => v !== null));
}

/** ค่ารวมทุกแพลตฟอร์มของแต่ละกลุ่ม (คิดจากยอดรวม ไม่ใช่เอาค่าแต่ละแพลตฟอร์มมาบวก) · CO รวมสองแพลตฟอร์มไม่มีค่า = null ทั้งหมด */
export const totalSeries = (groups: LiveSession[][], metric: MetricKey) => groups.map((list) => valueOf(list, metric));

/** ค่าทุกวันของเดือนแยกแพลตฟอร์ม (วันที่ไม่มีค่า = null เส้นขาด ไม่ลากข้าม) */
export function dailyByPlatform(sessions: LiveSession[], month: string, metric: MetricKey) {
  const [y, m] = month.split("-").map(Number);
  const days = Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => i + 1);
  const byDay = new Map<number, LiveSession[]>();
  for (const s of sessions) {
    const d = bkkParts(s.startedAt).d;
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  return { days, series: platformSeries(days.map((d) => byDay.get(d) ?? []), metric) };
}
