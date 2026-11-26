// สรุป Mc TikTok ทีมเรา (ผลงาน Mc > สรุป Mc TikTok · ผู้ใช้ขอ 2026-11-26: สไลด์ของคนดูแล Mc TikTok) — ใช้ทั้ง browser และ server
//   ค่าจ้าง Mc ของเรา = ตัวเลขเดียวกับหน้า Cost / ROI แถว "TikTok ของเรา" ช่อง Mc (ชีต Sum 2 ยอดจริง > ระบบ > Forecast)
//   GMV ของเรา = GMV TikTok ที่ไม่ใช่ช่วงแพลนของ Agency (เหมือนหน้า Cost) · ROI = GMV ÷ ค่าจ้าง Mc (ไม่รวม Admin / Agency ตามที่ผู้ใช้เลือก)
//   ชั่วโมงไลฟ์ = คิว Mc TikTok (แท็บ Deal Mc) ที่ไลฟ์แล้ว · % เป้า = GMV ทั้งช่อง TikTok (รวม Agency) ของช่องที่ตั้งเป้า ÷ เป้า

export type TiktokMcSource = "sheet" | "forecast" | "system";

export type TiktokMcMonth = {
  month: string;
  /** เดือนที่ยังไม่จบ (ตัวเลขนับถึงไลฟ์ล่าสุดในไฟล์ Export) */
  open: boolean;
  cost: number;
  source: TiktokMcSource;
  gmv: number | null;
  hours: number;
  /** ชั่วโมงของ Mc ประจำ (ตัวเลขระบบไม่มีค่าจ้างของคนกลุ่มนี้ — ไม่นับตอนคิดต้นทุนต่อชั่วโมง) */
  salariedHours: number;
  slots: number;
  /** เป้า GMV รวมของช่อง TikTok ที่ตั้งเป้า · null = ไม่ได้ตั้ง */
  target: number | null;
  /** GMV ของช่อง TikTok ที่ตั้งเป้า (รวม Agency) */
  targetGmv: number | null;
};

export type TiktokMcPerson = { mc: string; slots: number; hours: number; cost: number; gmv: number; estHours: number };

/** ราย Mc ของเดือนหนึ่ง (ค่าจ้างจากระบบ · GMV ต่อคิว) */
export type TiktokMcPeople = {
  month: string;
  open: boolean;
  people: TiktokMcPerson[];
  /** คิวของ Mc ประจำในเดือนนั้น (ไม่มีค่าจ้างรายชั่วโมง ไม่อยู่ในตาราง) · คิวที่ยังไม่มียอด */
  salaried: number;
  unknown: { slots: number; cost: number };
};

export const roiOf = (gmv: number | null, cost: number) => (gmv !== null && cost > 0 ? gmv / cost : null);
/** ชั่วโมงที่มีค่าจ้างในตัวเลข: ยอดจากชีตรวม Mc ประจำแล้ว · ตัวเลขระบบไม่มี Mc ประจำ */
export const paidHours = (m: Pick<TiktokMcMonth, "source" | "hours" | "salariedHours">) => (m.source === "system" ? m.hours - m.salariedHours : m.hours);
export const costPerHour = (m: Pick<TiktokMcMonth, "cost" | "source" | "hours" | "salariedHours">) => {
  const h = paidHours(m);
  return h > 0 && m.cost > 0 ? m.cost / h : null;
};
export const gmvPerHour = (m: Pick<TiktokMcMonth, "gmv" | "hours">) => (m.gmv !== null && m.hours > 0 ? m.gmv / m.hours : null);
export const achieveOf = (m: Pick<TiktokMcMonth, "target" | "targetGmv">) => (m.target && m.targetGmv !== null ? m.targetGmv / m.target : null);

/** รวมหลายเดือน (ทั้งปี / ถึงเดือนที่เลือก) */
export function sumMonths(list: TiktokMcMonth[]): TiktokMcMonth {
  const sum = (f: (m: TiktokMcMonth) => number) => list.reduce((a, m) => a + f(m), 0);
  const withTarget = list.filter((m) => m.target);
  return {
    month: list.length ? `${list[0].month}..${list[list.length - 1].month}` : "",
    open: list.some((m) => m.open),
    cost: sum((m) => m.cost),
    // ปนกันหลายที่มา = ถือว่า "system" ตอนคิดต้นทุนต่อชั่วโมง (ไม่นับชั่วโมง Mc ประจำของเดือนที่ใช้ตัวเลขระบบ)
    source: list.every((m) => m.source === "sheet") ? "sheet" : "system",
    gmv: list.some((m) => m.gmv !== null) ? sum((m) => m.gmv ?? 0) : null,
    hours: sum((m) => m.hours),
    salariedHours: sum((m) => (m.source === "system" ? m.salariedHours : 0)),
    slots: sum((m) => m.slots),
    target: withTarget.length ? withTarget.reduce((a, m) => a + (m.target ?? 0), 0) : null,
    targetGmv: withTarget.length ? withTarget.reduce((a, m) => a + (m.targetGmv ?? 0), 0) : null,
  };
}

/** ราย Mc เรียงตาม ROI (ไม่มีค่าจ้าง = ท้ายสุด) */
export const peopleByRoi = (people: TiktokMcPerson[]) =>
  [...people].sort((a, b) => (roiOf(b.gmv, b.cost) ?? -1) - (roiOf(a.gmv, a.cost) ?? -1) || b.gmv - a.gmv);

// ---------- ข้อความ ----------

export const baht = (v: number | null) => (v === null ? "-" : `฿${Math.round(v).toLocaleString("th-TH")}`);
export const roiText = (v: number | null) => (v === null ? "-" : `${v.toFixed(1)} เท่า`);
export const pctText = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
export const hrsText = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} ชม.`;
export const SOURCE_TEXT: Record<TiktokMcSource, string> = { sheet: "ยอดจริงจากชีต", forecast: "ประมาณการ (Forecast)", system: "ระบบคิดจากคิว" };
export const ROI_NOTE = "ROI = GMV ของเรา ÷ ค่าจ้าง Mc ของเรา (ไม่รวม Admin / Agency) · จ่ายค่าจ้าง ฿1 ได้ยอดขายกี่บาท";
