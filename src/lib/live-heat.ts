// ช่วงเวลาไหนขายดี: GMV / Viewers และชั่วโมงไลฟ์ แยกวันในสัปดาห์ × ชั่วโมง — ฟังก์ชันล้วน (เทสได้)
//   วันไลฟ์เริ่ม 06:00: ไลฟ์หลังเที่ยงคืนนับเป็นคืนของวันก่อน (ตี 1 คืนวันศุกร์ = ศุกร์ 01:00)
//   ไฟล์ Export ไม่มียอดรายชั่วโมง: GMV และ Viewers ของไลฟ์กระจายเท่าๆ กันทุกนาทีของไลฟ์ (ตัวเลขประมาณ)
//   Viewers เพิ่ม 2026-11-12 (ผู้ใช้ขอดูว่าช่วงไหนคนดูเยอะสุด)

/** ชั่วโมงที่วันไลฟ์เริ่ม · แถวแรกของตาราง = 06:00 */
export const HEAT_DAY_START = 6;
export const HEAT_WEEKDAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
export const HEAT_WEEKDAY_NAMES = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
/** ช่องที่ไลฟ์รวมน้อยกว่านี้ = ตัวอย่างน้อย (GMV/ชม. แกว่งง่าย ไม่จัดอันดับ) */
export const HEAT_MIN_SEC = 2 * 3600;

/** impSec = วินาทีไลฟ์ของไลฟ์ที่มี Impressions (TikTok) ใช้หาร Impressions/ชม. (Shopee ไม่มี Impressions ไม่ให้ดึงค่าลง) */
export type HeatCell = { gmv: number; orders: number; viewers: number; impressions: number; sec: number; impSec: number; lives: number };
/** weight = ส่วนของไลฟ์ที่นับ (เช่น ส่วนของกลุ่มที่เลือก) ไม่ใส่ = ทั้งไลฟ์ · orders / viewers ไม่ใส่ = 0 · impressions null / ไม่ใส่ = ไม่มีข้อมูล (Shopee) */
export type HeatLive = {
  startedAt: string; durationSec: number; gmv: number; orders?: number; viewers?: number; impressions?: number | null; weight?: number;
};

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
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ gmv: 0, orders: 0, viewers: 0, impressions: 0, sec: 0, impSec: 0, lives: 0 })));
  for (const l of lives) {
    const w = l.weight ?? 1;
    if (w <= 0) continue;
    const start = Date.parse(l.startedAt), len = l.durationSec * 1000;
    const orders = l.orders ?? 0, viewers = l.viewers ?? 0;
    const hasImp = l.impressions !== null && l.impressions !== undefined, imp = l.impressions ?? 0;
    if (len <= 0) {
      const c = cellOf(start), x = grid[c.day][c.hour];
      x.gmv += l.gmv * w; x.orders += orders * w; x.viewers += viewers * w; x.impressions += imp * w; x.lives++;
      continue;
    }
    const touched = new Set<HeatCell>();
    // ตัดตามรอยต่อชั่วโมง (เวลาไทยห่าง UTC เต็มชั่วโมง ใช้รอยต่อ UTC ได้)
    for (let t = start; t < start + len;) {
      const next = Math.min(start + len, (Math.floor(t / HOUR) + 1) * HOUR);
      const c = cellOf(t), x = grid[c.day][c.hour];
      const share = ((next - t) / len) * w;
      x.gmv += l.gmv * share;
      x.orders += orders * share;
      x.viewers += viewers * share;
      x.impressions += imp * share;
      x.sec += ((next - t) / 1000) * w;
      if (hasImp) x.impSec += ((next - t) / 1000) * w;
      touched.add(x);
      t = next;
    }
    for (const x of touched) x.lives++;
  }
  return grid;
}

/** GMV ต่อชั่วโมงไลฟ์ของช่อง · ไม่มีชั่วโมงไลฟ์ = null */
export const heatPerHour = (c: HeatCell) => (c.sec >= 60 ? c.gmv / (c.sec / 3600) : null);
/** ออเดอร์ต่อชั่วโมงไลฟ์ของช่อง · ไม่มีชั่วโมงไลฟ์ / ไม่มีออเดอร์ = null */
export const heatOrdersPerHour = (c: HeatCell) => (c.sec >= 60 && c.orders > 0 ? c.orders / (c.sec / 3600) : null);
/** Viewers ต่อชั่วโมงไลฟ์ของช่อง (คนดูหนาแน่นแค่ไหน) · ไม่มีชั่วโมงไลฟ์ / ไม่มีคนดู = null */
export const heatViewersPerHour = (c: HeatCell) => (c.sec >= 60 && c.viewers > 0 ? c.viewers / (c.sec / 3600) : null);
/** Product Impressions ต่อชั่วโมงไลฟ์ TikTok ของช่อง (หารเฉพาะชั่วโมงของไลฟ์ที่มี Impressions) · ไม่มี = null */
export const heatImpressionsPerHour = (c: HeatCell) => (c.impSec >= 60 && c.impressions > 0 ? c.impressions / (c.impSec / 3600) : null);

/** ค่าที่เลือกดูในตาราง: GMV · ออเดอร์ · Viewers · Impressions (ต่อชั่วโมง / รวม) — ออเดอร์ / Viewers / Impressions เพิ่ม 2026-11-12 */
export type HeatMetric = "perHour" | "gmv" | "ordersPerHour" | "orders" | "viewersPerHour" | "viewers" | "impressionsPerHour" | "impressions";
/** tiktok = มีเฉพาะไลฟ์ TikTok (ชั่วโมงที่ใช้ตัดสินว่าตัวอย่างพอ = ชั่วโมงไลฟ์ TikTok) */
export const HEAT_METRICS: { key: HeatMetric; label: string; kind: "baht" | "int"; perHour: boolean; tiktok?: boolean }[] = [
  { key: "perHour", label: "GMV/ชม.", kind: "baht", perHour: true },
  { key: "gmv", label: "GMV รวม", kind: "baht", perHour: false },
  { key: "ordersPerHour", label: "ออเดอร์/ชม.", kind: "int", perHour: true },
  { key: "orders", label: "ออเดอร์รวม", kind: "int", perHour: false },
  { key: "viewersPerHour", label: "Viewers/ชม.", kind: "int", perHour: true },
  { key: "viewers", label: "Viewers รวม", kind: "int", perHour: false },
  { key: "impressionsPerHour", label: "Impressions/ชม.", kind: "int", perHour: true, tiktok: true },
  { key: "impressions", label: "Impressions รวม", kind: "int", perHour: false, tiktok: true },
];
/** ค่าของช่องตามตัวชี้วัด · ไม่มี = null */
export function heatValue(metric: HeatMetric, c: HeatCell) {
  if (metric === "perHour") return heatPerHour(c);
  if (metric === "ordersPerHour") return heatOrdersPerHour(c);
  if (metric === "viewersPerHour") return heatViewersPerHour(c);
  if (metric === "impressionsPerHour") return heatImpressionsPerHour(c);
  const v = metric === "gmv" ? c.gmv : metric === "orders" ? c.orders : metric === "viewers" ? c.viewers : c.impressions;
  return v > 0 ? v : null;
}
/** ชั่วโมงไลฟ์ที่ใช้ตัดสินว่าตัวอย่างพอ / แสดงคู่กับค่า (Impressions = เฉพาะไลฟ์ TikTok) */
export const heatSecOf = (metric: HeatMetric, c: HeatCell) => (metric === "impressions" || metric === "impressionsPerHour" ? c.impSec : c.sec);

/** ช่องที่ขายดีสุด (เฉพาะช่องที่ไลฟ์รวมถึง HEAT_MIN_SEC) เรียงตามค่าที่เลือก · secOf = ชั่วโมงที่ใช้ตัดสิน (Impressions = ชั่วโมงไลฟ์ TikTok) */
export function heatTop(grid: HeatCell[][], value: (c: HeatCell) => number | null, n: number, secOf: (c: HeatCell) => number = (c) => c.sec) {
  return grid.flatMap((row, day) => row.map((c, hour) => ({ day, hour, cell: c, v: value(c) })))
    .filter((x) => x.v !== null && x.v > 0 && secOf(x.cell) >= HEAT_MIN_SEC)
    .sort((a, b) => b.v! - a.v!)
    .slice(0, n);
}
