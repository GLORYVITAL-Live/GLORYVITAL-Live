// ช่วงเวลาไหนขายดี: GMV และชั่วโมงไลฟ์ แยกวันในสัปดาห์ × ชั่วโมง — ฟังก์ชันล้วน (เทสได้)
//   วันไลฟ์เริ่ม 06:00: ไลฟ์หลังเที่ยงคืนนับเป็นคืนของวันก่อน (ตี 1 คืนวันศุกร์ = ศุกร์ 01:00)
//   ไฟล์ Export ไม่มียอดรายชั่วโมง: GMV ของไลฟ์กระจายเท่าๆ กันทุกนาทีของไลฟ์ (ตัวเลขประมาณ)

/** ชั่วโมงที่วันไลฟ์เริ่ม · แถวแรกของตาราง = 06:00 */
export const HEAT_DAY_START = 6;
export const HEAT_WEEKDAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
export const HEAT_WEEKDAY_NAMES = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
/** ช่องที่ไลฟ์รวมน้อยกว่านี้ = ตัวอย่างน้อย (GMV/ชม. แกว่งง่าย ไม่จัดอันดับ) */
export const HEAT_MIN_SEC = 2 * 3600;

export type HeatCell = { gmv: number; sec: number; lives: number };
/** weight = ส่วนของไลฟ์ที่นับ (เช่น ส่วนของกลุ่มที่เลือก) ไม่ใส่ = ทั้งไลฟ์ */
export type HeatLive = { startedAt: string; durationSec: number; gmv: number; weight?: number };

const HOUR = 3600_000, BKK = 7 * HOUR;

/** ชั่วโมงของแถว i เช่น 0 -> "06:00" */
export const heatHour = (i: number) => `${String((i + HEAT_DAY_START) % 24).padStart(2, "0")}:00`;

/** ช่องของเวลา ms: วัน 0 = จันทร์ (นับวันไลฟ์) · ชั่วโมง 0 = 06:00 */
function cellOf(ms: number) {
  const d = new Date(ms + BKK - HEAT_DAY_START * HOUR);
  return { day: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours() };
}

/** ตาราง [วัน 0–6][ชั่วโมง 0–23] ของ GMV / วินาทีไลฟ์ / จำนวนไลฟ์ที่อยู่ในช่อง · ไลฟ์ 0 นาที = GMV ลงช่องเวลาเริ่ม ไม่มีชั่วโมง */
export function heatGrid(lives: HeatLive[]): HeatCell[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ gmv: 0, sec: 0, lives: 0 })));
  for (const l of lives) {
    const w = l.weight ?? 1;
    if (w <= 0) continue;
    const start = Date.parse(l.startedAt), len = l.durationSec * 1000;
    if (len <= 0) {
      const c = cellOf(start), x = grid[c.day][c.hour];
      x.gmv += l.gmv * w; x.lives++;
      continue;
    }
    const touched = new Set<HeatCell>();
    // ตัดตามรอยต่อชั่วโมง (เวลาไทยห่าง UTC เต็มชั่วโมง ใช้รอยต่อ UTC ได้)
    for (let t = start; t < start + len;) {
      const next = Math.min(start + len, (Math.floor(t / HOUR) + 1) * HOUR);
      const c = cellOf(t), x = grid[c.day][c.hour];
      x.gmv += l.gmv * ((next - t) / len) * w;
      x.sec += ((next - t) / 1000) * w;
      touched.add(x);
      t = next;
    }
    for (const x of touched) x.lives++;
  }
  return grid;
}

/** GMV ต่อชั่วโมงไลฟ์ของช่อง · ไม่มีชั่วโมงไลฟ์ = null */
export const heatPerHour = (c: HeatCell) => (c.sec >= 60 ? c.gmv / (c.sec / 3600) : null);

/** ช่องที่ขายดีสุด (เฉพาะช่องที่ไลฟ์รวมถึง HEAT_MIN_SEC) เรียงตามค่าที่เลือก */
export function heatTop(grid: HeatCell[][], value: (c: HeatCell) => number | null, n: number) {
  return grid.flatMap((row, day) => row.map((c, hour) => ({ day, hour, cell: c, v: value(c) })))
    .filter((x) => x.v !== null && x.v > 0 && x.cell.sec >= HEAT_MIN_SEC)
    .sort((a, b) => b.v! - a.v!)
    .slice(0, n);
}
