/**
 * อันดับ Mc จาก GMV ต่อชั่วโมง เทียบ "ค่าที่คาดหวังของ slot นั้น" (หน้าสรุปรายเดือน > อันดับ Mc)
 *
 * ค่าที่คาดหวัง = GMV/ชม. เฉลี่ยของ slot แบบเดียวกัน คือช่อง x แคมเปญ x ช่วงเวลา จากทุกไลฟ์ในไฟล์ Export (lib/campaign-data.ts)
 *   Mc ที่ไลฟ์ช่วงบ่ายวันธรรมดาจึงไม่ถูกเทียบกับไพรม์ไทม์
 * ยอดของ Mc ต่อ slot: ยอดที่กรอกใน slot ก่อน (แม่น) ไม่มี = ยอดไลฟ์จาก Export แบ่งตามนาที (≈ ประมาณ) — lib/campaign-report.ts slotUnits
 *   ยอดจริงเกิน CAP เท่าของที่คาดหวังนับแค่ CAP เท่า
 * ต่อส่วน (แคมเปญ / วันปกติ): ratio = ยอดจริงรวม ÷ ยอดที่คาดหวังรวม แล้วดึงเข้าหา 100% ตามชั่วโมง
 *   index = (ชม. x ratio + SHRINK_HOURS x 100%) ÷ (ชม. + SHRINK_HOURS)   ข้อมูลน้อย = ใกล้ 100% (ลดผลของดวง)
 * คะแนนรวม = เฉลี่ยของสองส่วนที่มี (แคมเปญ 50% + วันปกติ 50%) / ระดับ A ≥ 110% · B 95–110% · C < 95%
 * เข้าอันดับเมื่อมีชั่วโมงที่มียอดอย่างน้อย MIN_RANK_HOURS
 */

export const MIN_RANK_HOURS = 8;
export const SHRINK_HOURS = 8;
export const CAP = 3;
export const TIER_A = 1.1;
export const TIER_B = 0.95;

export type Tier = "A" | "B" | "C";
export type Confidence = "สูง" | "กลาง" | "ต่ำ";
export type RankPeriod = "month" | "30" | "90";

/** ยอดของ Mc แยก แคมเปญ x ช่อง x ที่มา (จากเซิร์ฟเวอร์) */
export type RankCellRaw = {
  mc: string; key: string; label: string; campaign: boolean; platform: string; isCeo: boolean; source: "E" | "X";
  hours: number; gmv: number; actual: number; expected: number; slots: number;
};
/** ค่าที่คาดหวัง (GMV/ชม.) ของแต่ละแคมเปญ x ช่อง x ช่วงเวลา */
export type ExpectRow = { label: string; platform: string; rates: Record<string, number | null>; slots: number };
export type RankReport = {
  period: RankPeriod; month: string;
  from: string; to: string; prevFrom: string; prevTo: string; today: string;
  /** ช่วงนี้ยังไม่จบ (มีวันที่ยังไม่ถึง) */
  partial: boolean;
  cells: RankCellRaw[]; prevCells: RankCellRaw[]; skipped: number;
  expect: ExpectRow[];
  progress: {
    total: number; past: number; entered: number;
    campaigns: { label: string; total: number; past: number }[];
    perMc: Record<string, { total: number; past: number }>;
  };
};

export type RankCell = {
  key: string; label: string; platform: string;
  /** gmv = ยอดจริง / actual = ยอดจริงที่จำกัดไม่เกิน CAP เท่าของที่คาดหวัง (ใช้คิดคะแนน) */
  hours: number; gmv: number; actual: number; expected: number; slots: number; exact: number;
};
export type RankPart = {
  hours: number; gmv: number; actual: number; expected: number; perHour: number;
  /** ยอดจริง ÷ ที่คาดหวัง (ยังไม่ดึงเข้าหา 100%) */
  ratio: number;
  /** ดึงเข้าหา 100% ตามชั่วโมงแล้ว (ใช้คิดคะแนน) */
  index: number;
  cells: RankCell[];
};
export type McRank = {
  name: string; gmv: number; hours: number; perHour: number;
  campaign: RankPart | null; normal: RankPart | null;
  score: number | null; tier: Tier | null; confidence: Confidence;
  /** สัดส่วนชั่วโมงที่มาจากยอดที่กรอกใน slot (ที่เหลือ = ประมาณจาก Export) */
  exact: number;
  ranked: boolean; rank: number | null;
};
export type RankOptions = { excludeCeo?: boolean };

export const shrink = (hours: number, ratio: number) => (hours * ratio + SHRINK_HOURS) / (hours + SHRINK_HOURS);
export const tierOf = (score: number): Tier => (score >= TIER_A ? "A" : score >= TIER_B ? "B" : "C");
export const confidenceOf = (hours: number): Confidence => (hours >= 24 ? "สูง" : hours >= 12 ? "กลาง" : "ต่ำ");

export function rankCells(raw: RankCellRaw[], opt: RankOptions = {}): McRank[] {
  type Acc = { hours: number; hE: number; gmv: number; actual: number; expected: number; cells: Map<string, RankCell & { hE: number }> };
  const mk = (): Acc => ({ hours: 0, hE: 0, gmv: 0, actual: 0, expected: 0, cells: new Map() });
  const accs = new Map<string, { campaign: Acc; normal: Acc }>();
  for (const c of raw) {
    if (opt.excludeCeo && c.isCeo) continue;
    if (c.hours <= 0 || c.expected <= 0) continue;
    const a = accs.get(c.mc) ?? { campaign: mk(), normal: mk() };
    accs.set(c.mc, a);
    const part = c.campaign ? a.campaign : a.normal;
    const hE = c.source === "E" ? c.hours : 0;
    part.hours += c.hours; part.hE += hE; part.gmv += c.gmv; part.actual += c.actual; part.expected += c.expected;
    const key = `${c.key}|${c.platform}`;
    const x = part.cells.get(key) ?? { key, label: c.label, platform: c.platform, hours: 0, hE: 0, gmv: 0, actual: 0, expected: 0, slots: 0, exact: 0 };
    x.hours += c.hours; x.hE += hE; x.gmv += c.gmv; x.actual += c.actual; x.expected += c.expected; x.slots += c.slots;
    part.cells.set(key, x);
  }
  const toPart = (a: Acc): RankPart | null => {
    if (!a.hours || !a.expected) return null;
    const ratio = a.actual / a.expected;
    return {
      hours: a.hours, gmv: a.gmv, actual: a.actual, expected: a.expected, perHour: a.gmv / a.hours, ratio, index: shrink(a.hours, ratio),
      cells: [...a.cells.values()].map(({ hE, ...c }) => ({ ...c, exact: c.hours ? hE / c.hours : 0 })).sort((x, y) => y.hours - x.hours),
    };
  };
  const rows: McRank[] = [...accs.entries()].map(([name, a]) => {
    const campaign = toPart(a.campaign), normal = toPart(a.normal);
    const parts = [campaign?.index, normal?.index].filter((x): x is number => x != null);
    const hours = a.campaign.hours + a.normal.hours;
    const gmv = (campaign?.gmv ?? 0) + (normal?.gmv ?? 0);
    const score = parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null;
    return {
      name, gmv, hours, perHour: hours ? gmv / hours : 0, campaign, normal, score,
      tier: score === null ? null : tierOf(score), confidence: confidenceOf(hours),
      exact: hours ? (a.campaign.hE + a.normal.hE) / hours : 0,
      ranked: score !== null && hours >= MIN_RANK_HOURS, rank: null,
    };
  });
  rows.sort((a, b) => Number(b.ranked) - Number(a.ranked) || (b.score ?? -1) - (a.score ?? -1) || b.gmv - a.gmv);
  rows.forEach((r, i) => { if (r.ranked) r.rank = i + 1; });
  return rows;
}
