// เทียบ 2 ช่วงรายกลุ่ม (Agency / ทีมเรา) และรายบัญชี ทีละตัวชี้วัด เพื่อหาว่าใครดรอปที่ขาไหน — ฟังก์ชันล้วน (เทสได้)
//   ขาของ GMV: GMV = ชั่วโมงไลฟ์ × Viewers/ชม. × GMV/Viewer (คูณกันได้ GMV พอดี) ขาที่ลดมากสุด = จุดที่ควรแก้
//   กลุ่ม: แบ่งแต่ละไลฟ์ตามส่วนของกลุ่ม (กฎเดียวกับกราฟแยก Agency · agencySharesOf) แล้วรวมตัวเลขทุกตัวตามส่วนนั้น

import { AGENCY_OURS, agencySharesOf, type OwnerSpan } from "@/lib/live-owners";
import { accountsOf, changeOf, metricOf, totalsOf, type LiveSession, type MetricKey, type Platform, type Totals } from "@/lib/live-stats";
import { ownerText } from "@/lib/plan-clash";

/** ตัวเลขที่บวกกันได้ของไลฟ์ (คูณตามส่วนของกลุ่ม) · avgViewSec เป็นค่าเฉลี่ย ไม่คูณ */
const ADDITIVE = ["durationSec", "gmv", "orders", "itemsSold", "customers", "viewers", "views", "engagedViewers", "comments", "shares", "likes", "newFollowers", "addToCart", "impressions", "clicks"] as const;

/** ส่วนหนึ่งของไลฟ์ (share 0–1) */
export function scaleSession(s: LiveSession, share: number): LiveSession {
  if (share === 1) return s;
  const out = { ...s } as Record<string, unknown>;
  for (const k of ADDITIVE) { const v = s[k]; out[k] = v === null || v === undefined ? v : (v as number) * share; }
  return out as LiveSession;
}

export type BreakdownRow = { key: string; label: string; platform: Platform; level: "platform" | "group" | "account"; a: Totals; b: Totals };

const PLATFORMS: Platform[] = ["TikTok", "Shopee"];

/**
 * แถวเทียบ a (ช่วงหลัก) กับ b (ช่วงเทียบ)
 *   groups: ต่อแพลตฟอร์ม = แถวรวมแพลตฟอร์ม แล้วตามด้วยกลุ่ม (ทีมเราก่อน) · spans null = ไม่มีแถวกลุ่ม
 *   accounts: แถวละบัญชี เรียง GMV ช่วงหลักมากไปน้อย
 */
export function breakdownRows(a: LiveSession[], b: LiveSession[], spans: OwnerSpan[] | null) {
  const shares = spans ? agencySharesOf([...a, ...b], spans) : null;
  const groups: BreakdownRow[] = [];
  for (const platform of PLATFORMS) {
    const pa = a.filter((s) => s.platform === platform), pb = b.filter((s) => s.platform === platform);
    if (!pa.length && !pb.length) continue;
    groups.push({ key: platform, label: platform, platform, level: "platform", a: totalsOf(pa), b: totalsOf(pb) });
    if (!shares) continue;
    const keys = [...new Set([...pa, ...pb].flatMap((s) => [...shares.get(s)!.keys()]))]
      .sort((x, y) => Number(x !== AGENCY_OURS) - Number(y !== AGENCY_OURS) || x.localeCompare(y));
    const part = (list: LiveSession[], key: string) => list.flatMap((s) => { const w = shares.get(s)!.get(key) ?? 0; return w > 0 ? [scaleSession(s, w)] : []; });
    for (const key of keys) {
      groups.push({
        key: `${platform}|${key}`, platform, level: "group",
        label: key === AGENCY_OURS ? (platform === "Shopee" ? "In house" : "ของเรา") : ownerText(key),
        a: totalsOf(part(pa, key)), b: totalsOf(part(pb, key)),
      });
    }
  }
  const accounts: BreakdownRow[] = accountsOf([...a, ...b]).map((acc) => {
    const mine = (list: LiveSession[]) => list.filter((s) => `${s.platform}|${s.accountId}` === acc.key);
    return { key: acc.key, label: acc.name, platform: acc.platform, level: "account" as const, a: totalsOf(mine(a)), b: totalsOf(mine(b)) };
  }).sort((x, y) => y.a.gmv - x.a.gmv);
  return { groups, accounts };
}

/** ขาของ GMV (คูณกันได้ GMV) */
export const GMV_LEGS: { key: MetricKey; label: string }[] = [
  { key: "duration", label: "ชั่วโมงไลฟ์" },
  { key: "viewersPerHour", label: "Viewers/ชม." },
  { key: "gmvPerViewer", label: "GMV/Viewer" },
];

const valueOf = (t: Totals, k: MetricKey) => (t.lives ? metricOf(k).value(t) : null);

/**
 * ขาที่ทำให้ GMV เปลี่ยนมากสุด: GMV ลด = ขาที่ลดมากสุด · GMV เพิ่ม = ขาที่เพิ่มมากสุด
 *   null = เทียบไม่ได้ (ช่วงใดช่วงหนึ่งไม่มีไลฟ์) หรือไม่มีขาไปทางเดียวกับ GMV
 */
export function mainLeg(a: Totals, b: Totals) {
  const g = changeOf(valueOf(a, "gmv"), valueOf(b, "gmv"));
  if (g === null || Math.abs(g) < 0.0005) return null;
  const legs = GMV_LEGS.flatMap((l) => { const c = changeOf(valueOf(a, l.key), valueOf(b, l.key)); return c === null ? [] : [{ ...l, change: c }]; })
    .filter((l) => Math.sign(l.change) === Math.sign(g))
    .sort((x, y) => (g < 0 ? x.change - y.change : y.change - x.change));
  return legs[0] ? { gmv: g, ...legs[0] } : null;
}
