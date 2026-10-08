import type { CampCell } from "@/lib/campaign";
import { shrink } from "@/lib/mc-rank";

/**
 * สรุป Mc ต่อแคมเปญ (หน้า Campaign): ดัชนี = ยอดจริง ÷ ค่าที่คาดหวัง (ดูที่มาใน mc-rank.ts / campaign-report.ts)
 *   ดัชนีรวมดึงเข้าหา 100% ตามชั่วโมงเหมือนหน้าอันดับ / ป้ายสรุป:
 *     ข้อมูลน้อย  = ชั่วโมงแคมเปญ < 12
 *     ขัดกัน     = ดัชนีจากยอดที่กรอก (แม่น) กับจากไฟล์ Export (ประมาณ) ชี้คนละทาง คือฝั่งหนึ่ง ≥ 105% อีกฝั่ง < 95% (ทั้งสองฝั่งมี ≥ 4 ชม.)
 *     เหมาะขึ้นแคมเปญ = ดัชนี ≥ 105% และ ≥ 20 ชม. / ควรทบทวน = ดัชนี < 95% และ ≥ 20 ชม. / นอกนั้น = ปกติ
 */

export type Agg = { hE: number; hX: number; hours: number; ratio: number | null; index: number | null; exact: number; idxE: number | null; idxX: number | null };
export type Fit = "เหมาะขึ้นแคมเปญ" | "ปกติ" | "ควรทบทวน" | "ข้อมูลน้อย" | "ขัดกัน";

const MIN_SIDE = 4;

export function aggregate(cells: CampCell[]): Agg {
  const s = cells.reduce((a, c) => ({ hE: a.hE + c.hE, hX: a.hX + c.hX, aE: a.aE + c.aE, aX: a.aX + c.aX, eE: a.eE + c.eE, eX: a.eX + c.eX }),
    { hE: 0, hX: 0, aE: 0, aX: 0, eE: 0, eX: 0 });
  const hours = s.hE + s.hX, e = s.eE + s.eX;
  const ratio = e > 0 ? (s.aE + s.aX) / e : null;
  return {
    hE: s.hE, hX: s.hX, hours, ratio, index: ratio === null ? null : shrink(hours, ratio), exact: hours ? s.hE / hours : 0,
    idxE: s.hE >= MIN_SIDE && s.eE > 0 ? s.aE / s.eE : null,
    idxX: s.hX >= MIN_SIDE && s.eX > 0 ? s.aX / s.eX : null,
  };
}

export type McCampaign = {
  mc: string;
  campaign: Agg; normal: Agg;
  /** ดัชนีแคมเปญ − ดัชนีวันปกติ (จุดเปอร์เซ็นต์) ต้องมีทั้งสองส่วน */
  diff: number | null;
  perKey: Map<string, Agg>;
  /** ผ่านกี่รอบจากกี่รอบ (นับเฉพาะรอบที่ไลฟ์ ≥ 4 ชม. ผ่าน = ดัชนีดิบ ≥ 100%) */
  passed: number; total: number;
  fit: Fit;
};

export function summarizeMc(mc: string, cells: CampCell[]): McCampaign {
  const campaign = aggregate(cells.filter((c) => c.key));
  const normal = aggregate(cells.filter((c) => !c.key));
  const perKey = new Map<string, Agg>();
  for (const key of new Set(cells.filter((c) => c.key).map((c) => c.key))) perKey.set(key, aggregate(cells.filter((c) => c.key === key)));
  const counted = [...perKey.values()].filter((a) => a.hours >= MIN_SIDE && a.ratio !== null);
  // ขัดกัน = ยอดที่กรอก (แม่น) กับยอดประมาณจาก Export ชี้คนละทาง (ฝั่งหนึ่ง ≥ 105% อีกฝั่ง < 95%) ทั้งสองฝั่งต้องมี ≥ 4 ชม.
  const { idxE, idxX } = campaign;
  const conflict = idxE !== null && idxX !== null && ((idxE >= 1.05 && idxX < 0.95) || (idxX >= 1.05 && idxE < 0.95));
  const idx = campaign.index;
  const fit: Fit = campaign.hours < 12 || idx === null ? "ข้อมูลน้อย"
    : conflict ? "ขัดกัน"
      : idx >= 1.05 && campaign.hours >= 20 ? "เหมาะขึ้นแคมเปญ"
        : idx < 0.95 && campaign.hours >= 20 ? "ควรทบทวน" : "ปกติ";
  return {
    mc, campaign, normal, perKey,
    diff: campaign.index !== null && normal.index !== null ? campaign.index - normal.index : null,
    passed: counted.filter((a) => a.ratio! >= 1).length, total: counted.length, fit,
  };
}
