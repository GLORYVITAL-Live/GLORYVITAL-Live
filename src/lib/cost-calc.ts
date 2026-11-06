// หน้า Cost: ค่าใช้จ่ายของทีมไลฟ์ต่อเดือน แยกตามแพลตฟอร์ม + กลุ่มที่ไลฟ์ เทียบ GMV — ฟังก์ชันล้วน (เทสได้ · src/lib/cost.ts โหลดข้อมูล)
//   ทีมเรา = ค่าจ้าง Mc / Admin + ค่ารถ (สูตรเดียวกับสรุปรายเดือน src/lib/owner-pay.ts)
//   กลุ่มภายนอก = เรทต่อชั่วโมง × ชั่วโมงในแพลน (src/lib/agency-budget.ts)
//   GMV = ไฟล์ Export แยกตามเวลาในแพลน (src/lib/live-owners.ts) · ไม่รวมเงินเดือน Mc / Admin ประจำ (ระบบไม่มีตัวเลขนี้)

import { budgetSheet, hasBudget } from "@/lib/agency-budget";
import type { ExportBook, ExportSheet } from "@/lib/export";
import type { LiveSession } from "@/lib/live-stats";
import { splitByOwner, type OwnerSpan } from "@/lib/live-owners";
import { hasRateOf, payOfItems, salariedOf, travelOf, type PayData } from "@/lib/owner-pay";
import { ownerText, spanLen, spanMs } from "@/lib/plan-clash";
import { isShopeePlatform } from "@/lib/platform";
import type { OwnerDetail } from "@/lib/types";

export type CostApp = "TikTok" | "Shopee";
/** ส่วนที่บัญชีนี้ดูได้: ค่าจ้าง Mc / ค่าจ้าง Admin + ค่ารถ / งบกลุ่มภายนอก / GMV */
export type CostSee = { mc: boolean; admin: boolean; agency: boolean; gmv: boolean };
export type CostPlanSlot = { agency: string; platform: string; date: string; start: string; end: string };

/**
 * แถวของกลุ่มหนึ่ง · owner null = TikTok: ของเรา / Shopee: ไลฟ์ที่ไม่อยู่ในแพลน
 *   ตัวเลขนับถึงจุดตัด · full = ทั้งเดือน (รวมคิวที่จองไว้ + แพลนที่ยังไม่ถึงเวลา)
 */
export type CostRow = {
  app: CostApp; owner: string | null; label: string;
  mc: number; admin: number; travel: number; agency: number;
  /** กลุ่มภายนอก: เรท (ไม่ตั้ง = null) + ชั่วโมงในแพลนทั้งเดือน */
  rate: number | null; planHours: number;
  full: number;
  gmv: number | null;
};
export type CostTotals = { mc: number; admin: number; travel: number; agency: number; cost: number; full: number; gmv: number | null };
export type CostReport = {
  month: string; prevMonth: string;
  /** เดือนที่ยังไม่จบ: จุดตัด (ms) · เดือนที่จบแล้ว = null */
  upTo: number | null;
  see: CostSee;
  rows: CostRow[]; totals: CostTotals; prev: CostTotals;
  /** คิวที่ไลฟ์แล้วแต่ไม่อยู่ในยอด: Mc / Admin ประจำ · ยังไม่ได้ตั้งค่าจ้าง */
  salaried: number; unrated: number;
  /** กลุ่มภายนอกของเดือนนี้ (ช่องใส่เรท) · ไม่มีสิทธิ์ = ว่าง */
  agencies: { agency: string; label: string; rate: number | null; hours: number }[];
};
export type CostPoint = CostTotals & { month: string; open: boolean };

const DAY = 86400_000;
const appOf = (p: string): CostApp => (isShopeePlatform(p) ? "Shopee" : "TikTok");
const detailApp = (d: OwnerDetail): CostApp => (d.shopee || isShopeePlatform(d.platform) ? "Shopee" : "TikTok");
const startedAtMs = (s: { startedAt: string }) => Date.parse(s.startedAt);

export const rowCost = (r: Pick<CostRow, "mc" | "admin" | "travel" | "agency">) => r.mc + r.admin + r.travel + r.agency;

/** จุดตัดของเดือน: จบแล้ว = ทั้งเดือน · ยังไม่จบ = ไลฟ์ล่าสุดในไฟล์ Export ให้ Cost กับ GMV นับถึงเวลาเดียวกัน (ไม่มีไฟล์ = ตอนนี้) */
export function costCut(now: number, last: string, sessions: { startedAt: string }[] | null) {
  if (now >= Date.parse(`${last}T00:00:00+07:00`) + DAY) return Infinity;
  return sessions?.length ? Math.min(now, Math.max(...sessions.map(startedAtMs))) : now;
}

export function costRows({ summary, plan, rates, sessions, spans, cut, see }: {
  summary: PayData & { details: OwnerDetail[] };
  /** แพลนของกลุ่มในเดือนนี้ */
  plan: CostPlanSlot[];
  rates: Map<string, number>;
  /** ไลฟ์ของเดือนนี้จากไฟล์ Export · null = ดู GMV ไม่ได้ */
  sessions: LiveSession[] | null;
  /** แพลนไว้แยก GMV (รวมคืนก่อนต้นเดือน) */
  spans: OwnerSpan[];
  cut: number;
  see: CostSee;
}) {
  const rows = new Map<string, CostRow>();
  const rowOf = (app: CostApp, owner: string | null) => {
    const k = `${app}|${owner ?? ""}`;
    const r = rows.get(k) ?? {
      app, owner, label: owner || app === "TikTok" ? ownerText(owner) : "ไม่อยู่ในแพลน",
      mc: 0, admin: 0, travel: 0, agency: 0, rate: null, planHours: 0, full: 0, gmv: null,
    };
    rows.set(k, r);
    return r;
  };

  // ทีมเรา: ปัดเงินทีละคิวแล้วรวม (ตัวเลขเดียวกับสรุปรายเดือน / ไฟล์เบิก)
  let salaried = 0, unrated = 0;
  for (const d of summary.details) {
    if (d.cancelled || (d.type === "Mc" ? !see.mc : !see.admin)) continue;
    const app = detailApp(d), r = rowOf(app, app === "TikTok" ? null : "In house");
    const pay = payOfItems(summary, d.type, [d]);
    r.full += pay;
    if (d.startMs > cut) continue;
    const travel = travelOf(d);
    if (d.type === "Mc") r.mc += pay; else r.admin += pay - travel;
    r.travel += travel;
    if (salariedOf(summary, d.type, d.name)) salaried++;
    else if (!hasRateOf(summary, d.type, d.name)) unrated++;
  }

  // กลุ่มภายนอก: เรท × ชั่วโมงในแพลน (ไม่ตั้งเรท = ยังไม่มีงบ แต่ยังเห็นชั่วโมง)
  if (see.agency) {
    for (const s of plan) {
      if (!hasBudget(s.agency)) continue;
      const r = rowOf(appOf(s.platform), s.agency);
      const rate = rates.get(s.agency) ?? 0, hours = spanLen(s) / 60;
      r.rate = rate || null;
      r.planHours += hours;
      r.full += rate * hours;
      if (spanMs(s).startMs <= cut) r.agency += rate * hours;
    }
  }

  // GMV: ตามเวลาในแพลน · ส่วนที่เหลือ TikTok = ของเรา / Shopee = ไม่อยู่ในแพลน
  const lives = sessions?.filter((s) => startedAtMs(s) <= cut) ?? [];
  if (lives.length) {
    const rest: Record<CostApp, number> = { TikTok: 0, Shopee: 0 };
    for (const s of lives) rest[s.platform === "Shopee" ? "Shopee" : "TikTok"] += s.gmv;
    for (const c of splitByOwner(lives, spans)) {
      for (const x of c.rows) {
        if (!x.owner) continue;
        const app = appOf(c.channel);
        rest[app] -= x.gmv;
        if (hasBudget(x.owner) && !see.agency) continue;
        const r = rowOf(app, x.owner);
        r.gmv = (r.gmv ?? 0) + x.gmv;
      }
    }
    for (const app of ["TikTok", "Shopee"] as const) if (rest[app] >= 0.5) rowOf(app, null).gmv = rest[app];
  }

  // TikTok ก่อน Shopee · ทีมเราก่อน แล้วกลุ่มภายนอก ไม่อยู่ในแพลนไว้ท้าย
  const rank = (r: CostRow) => (r.app === "TikTok" ? 0 : 10) + (r.owner === "In house" || (!r.owner && r.app === "TikTok") ? 0 : r.owner ? 1 : 2);
  return {
    rows: [...rows.values()]
      .filter((r) => rowCost(r) || r.full || r.planHours || r.gmv)
      .sort((a, b) => rank(a) - rank(b) || b.full - a.full || a.label.localeCompare(b.label)),
    salaried, unrated,
  };
}

/** ยอดรวมของหลายแถว · ไม่มี GMV เลย = null */
export function costTotals(rows: CostRow[]): CostTotals {
  const sum = (f: (r: CostRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    mc: sum((r) => r.mc), admin: sum((r) => r.admin), travel: sum((r) => r.travel), agency: sum((r) => r.agency),
    cost: sum(rowCost), full: sum((r) => r.full),
    gmv: rows.some((r) => r.gmv !== null) ? sum((r) => r.gmv ?? 0) : null,
  };
}

/** Cost ต่อ GMV · ไม่มี GMV = null */
export const costRatio = (cost: number, gmv: number | null) => (gmv ? cost / gmv : null);

const money = (v: number | null) => ({ v, f: "money" as const });
const pct = (v: number | null) => ({ v, f: "pct" as const });

/** ไฟล์ส่งออกหน้า Cost: สรุปตามกลุ่ม + งบ Agency + แนวโน้มรายเดือน */
export function costBook(report: CostReport, trend: CostPoint[] | null): ExportBook {
  const open = report.upTo !== null;
  const line = (app: string, label: string, r: Pick<CostRow, "mc" | "admin" | "travel" | "agency" | "full" | "gmv">) => [
    app, label, money(r.mc), money(r.admin), money(r.travel), money(r.agency), money(rowCost(r)), money(r.gmv), pct(costRatio(rowCost(r), r.gmv)),
    ...(open ? [money(r.full)] : []),
  ];
  const budget = budgetSheet(report.rows.filter((r) => r.owner && hasBudget(r.owner)).map((r) => (
    { label: r.label, channel: r.app, rate: r.rate, hours: r.planHours }
  )));
  const sheets: ExportSheet[] = [
    {
      name: "Cost",
      rows: [
        ["แพลตฟอร์ม", "กลุ่ม", "Mc", "Admin", "ค่ารถ", "Agency", "Cost รวม", "GMV", "Cost/GMV", ...(open ? ["ทั้งเดือนตามแผน"] : [])],
        ...report.rows.map((r) => line(r.app, r.label, r)),
        line("รวม", "", report.totals),
      ],
    },
    ...(budget ? [budget] : []),
    ...(trend?.length ? [{
      name: "แนวโน้มรายเดือน",
      rows: [
        ["เดือน", "Mc", "Admin + ค่ารถ", "Agency", "Cost รวม", "GMV", "Cost/GMV", "หมายเหตุ"],
        ...trend.map((p) => [
          p.month, money(p.mc), money(p.admin + p.travel), money(p.agency), money(p.cost), money(p.gmv), pct(costRatio(p.cost, p.gmv)), p.open ? "ยังไม่จบเดือน" : "",
        ]),
      ],
    }] : []),
  ];
  return { title: `GLORY Cost ${report.month}`, sheets };
}
