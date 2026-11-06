// จุดของกราฟ "แต่ละไลฟ์" ในหน้าสถิติไลฟ์ — ฟังก์ชันล้วน (เทสได้)
//   แกนตั้ง = ตัวชี้วัดของไลฟ์นั้น · แกนนอน = เวลาเริ่มไลฟ์ หรือความยาวไลฟ์ (ชั่วโมง)

import { bkkParts, metricOf, totalsOf, type LiveSession, type MetricKey } from "@/lib/live-stats";

export type DotAxis = "start" | "length";
export type LiveDot = { x: number; y: number; session: LiveSession };

/** แกนเวลาเริ่มเรียงตั้งแต่ 05:00 ถึง 05:00 ของคืนนั้น (ไลฟ์หลังเที่ยงคืนอยู่ท้ายแกน · ไลฟ์ที่เปิดก่อน 06:00 ไม่กี่นาทียังอยู่ต้นแกน) */
const AXIS_START_HOUR = 5;
/** ป้ายทุก 3 ชม. ตั้งแต่ 06:00 */
export const START_TICKS = [1, 4, 7, 10, 13, 16, 19, 22];
export const startTickLabel = (x: number) => `${String((AXIS_START_HOUR + x) % 24).padStart(2, "0")}:00`;
/** ชั่วโมงนับจากต้นแกน */
export const startOffset = (iso: string) => {
  const { h, mi } = bkkParts(iso);
  return (((h + mi / 60 - AXIS_START_HOUR) % 24) + 24) % 24;
};

/** ไฟล์ Export ที่มีเวลาเริ่มไลฟ์จริงเริ่มตั้งแต่เดือนนี้ (ก่อนหน้าเป็นยอดรายวันจากชีต ไม่มีเวลาเริ่ม) */
const FIRST_MONTH_WITH_TIMES = "2026-08";
export const hasStartTimes = (month: string) => month >= FIRST_MONTH_WITH_TIMES;

/** จุดเรียงตามแกนนอน · skipped = ไลฟ์ที่ไม่มีค่าให้วาด (เช่น GMV/ชม. ของไลฟ์ 0 นาทีที่ยังไลฟ์อยู่ตอน Export) */
export function liveDots(list: LiveSession[], metric: MetricKey, axis: DotAxis) {
  const def = metricOf(metric);
  const dots: LiveDot[] = [];
  let skipped = 0;
  for (const s of list) {
    const y = def.value(totalsOf([s]));
    if (y === null || !Number.isFinite(y) || (axis === "length" && s.durationSec <= 0)) { skipped++; continue; }
    dots.push({ x: axis === "start" ? startOffset(s.startedAt) : s.durationSec / 3600, y, session: s });
  }
  dots.sort((a, b) => a.x - b.x);
  return { dots, skipped };
}
