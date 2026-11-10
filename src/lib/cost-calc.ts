// หน้า Cost: ค่าใช้จ่ายของทีมไลฟ์ต่อเดือน แยกตามแพลตฟอร์ม + กลุ่มที่ไลฟ์ เทียบ GMV — ฟังก์ชันล้วน (เทสได้ · src/lib/cost.ts โหลดข้อมูล)
//   ทีมเรา = ค่าจ้าง Mc / Admin + ค่ารถ (สูตรเดียวกับสรุปรายเดือน src/lib/owner-pay.ts)
//   กลุ่มภายนอก = เรทต่อชั่วโมง × ชั่วโมงในแพลน (src/lib/agency-budget.ts)
//   GMV = ไฟล์ Export แยกตามเวลาในแพลน (src/lib/live-owners.ts) · ไม่รวมเงินเดือน Mc / Admin ประจำ (ระบบไม่มีตัวเลขนี้)
//   ตัวเลขจากชีตของทีม (src/lib/cost-sheet.ts) ลำดับ: Actual ในชีต > ระบบ > Forecast ในชีต
//     เดือนเก่าระบบคิดด้วยเรทปัจจุบัน + มีคิวที่ยังไม่ตั้งค่าจ้าง จึงไม่ตรงยอดจริง · Forecast เป็นยอดทั้งเดือน ใช้กับเดือนที่จบแล้วเท่านั้น

import { budgetSheet, hasBudget } from "@/lib/agency-budget";
import type { CostSheetEntry, CostSheetKind } from "@/lib/cost-sheet";
import type { ExportBook, ExportSheet } from "@/lib/export";
import type { LiveSession } from "@/lib/live-stats";
import { splitByOwner, type OwnerSpan } from "@/lib/live-owners";
import { MC_COST_DIMS, mcCostRows, type CostReport as McCostReport } from "@/lib/mc-cost-calc";
import { hasRateOf, payOfItems, salariedOf, travelOf, type PayData } from "@/lib/owner-pay";
import { ownerText, spanLen, spanMs } from "@/lib/plan-clash";
import { isShopeePlatform } from "@/lib/platform";
import type { OwnerDetail } from "@/lib/types";

export type CostApp = "TikTok" | "Shopee";
/** ส่วนที่บัญชีนี้ดูได้: ค่าจ้าง Mc / ค่าจ้าง Admin + ค่ารถ / งบกลุ่มภายนอก / GMV */
export type CostSee = { mc: boolean; admin: boolean; agency: boolean; gmv: boolean };
export type CostPlanSlot = { agency: string; platform: string; date: string; start: string; end: string };

/**
 * แถวของกลุ่มหนึ่ง · owner null = TikTok ของเรา · Shopee ทีมเรา = owner "In house"
 *   ตัวเลขนับถึงจุดตัด · full = ทั้งเดือน (รวมคิวที่จองไว้ + แพลนที่ยังไม่ถึงเวลา)
 */
export type CostRow = {
  app: CostApp; owner: string | null; label: string;
  mc: number; admin: number; travel: number; agency: number;
  /** กลุ่มภายนอก: เรท (ไม่ตั้ง = null) + ชั่วโมง (ในแพลนทั้งเดือน / ตามชีต) */
  rate: number | null; planHours: number;
  full: number;
  gmv: number | null;
  /** ตัวเลขที่มาจากชีต: sheet = Actual / forecast = ประมาณการ · ไม่มี = ระบบคิดเอง */
  sources: Partial<Record<CostSheetKind, "sheet" | "forecast">>;
  /** ส่วนของยอดนี้ที่เป็น Forecast */
  forecast: number;
};
export type CostTotals = { mc: number; admin: number; travel: number; agency: number; cost: number; full: number; gmv: number | null; forecast: number };
export type CostReport = {
  month: string; prevMonth: string;
  /** เดือนที่ยังไม่จบ: จุดตัด (ms) · เดือนที่จบแล้ว = null */
  upTo: number | null;
  see: CostSee;
  rows: CostRow[]; totals: CostTotals; prev: CostTotals;
  /** แถวของเดือนก่อน (นับถึงเวลาเดียวกันถ้าเดือนนี้ยังไม่จบ) ไว้เทียบ MoM รายกลุ่ม · เซิร์ฟเวอร์เก่ายังไม่ส่ง = ไม่มี */
  prevRows?: CostRow[];
  /** คิวที่ไลฟ์แล้วแต่ไม่อยู่ในยอด: Mc / Admin ประจำ · ยังไม่ได้ตั้งค่าจ้าง */
  salaried: number; unrated: number;
  /** กลุ่มภายนอกของเดือนนี้ (ช่องใส่เรท) · ไม่มีสิทธิ์ = ว่าง */
  agencies: { agency: string; label: string; rate: number | null; hours: number }[];
  /** ชีตของทีม: ready = ตั้งลิงก์แล้ว · error = อ่านไม่ได้ (ใช้ตัวเลขระบบแทน) */
  sheet: { ready: boolean; error: string | null };
};
export type CostPoint = CostTotals & { month: string; open: boolean; rows: CostRow[] };

const DAY = 86400_000;
const appOf = (p: string): CostApp => (isShopeePlatform(p) ? "Shopee" : "TikTok");
const detailApp = (d: OwnerDetail): CostApp => (d.shopee || isShopeePlatform(d.platform) ? "Shopee" : "TikTok");
const startedAtMs = (s: { startedAt: string }) => Date.parse(s.startedAt);

export const rowCost = (r: Pick<CostRow, "mc" | "admin" | "travel" | "agency">) => r.mc + r.admin + r.travel + r.agency;
/** ลำดับแถว: TikTok ก่อน Shopee · ทีมเรา (TikTok ของเรา / Shopee In house) ก่อน แล้วกลุ่มภายนอก */
const rankOf = (r: CostRow) => (r.app === "TikTok" ? 0 : 10) + (r.owner === "In house" || (!r.owner && r.app === "TikTok") ? 0 : r.owner ? 1 : 2);
/** ที่มาของตัวเลขในแถว: ชีต / ประมาณการ / ระบบ */
export const rowSource = (r: Pick<CostRow, "sources">) => {
  const list = Object.values(r.sources);
  return list.includes("forecast") ? "ประมาณการ (Forecast)" : list.length ? "ยอดจริงจากชีต" : "";
};

/** จุดตัดของเดือน: จบแล้ว = ทั้งเดือน · ยังไม่จบ = ไลฟ์ล่าสุดในไฟล์ Export ให้ Cost กับ GMV นับถึงเวลาเดียวกัน (ไม่มีไฟล์ = ตอนนี้) */
export function costCut(now: number, last: string, sessions: { startedAt: string }[] | null) {
  if (now >= Date.parse(`${last}T00:00:00+07:00`) + DAY) return Infinity;
  return sessions?.length ? Math.min(now, Math.max(...sessions.map(startedAtMs))) : now;
}

export function costRows({ summary, plan, rates, sessions, spans, cut, see, sheet }: {
  /** ยอดของเดือนนี้จากชีตของทีม · ไม่ส่ง = ใช้ตัวเลขระบบอย่างเดียว */
  sheet?: CostSheetEntry[] | null;
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
  /** ยอดทั้งเดือนแยกตามชนิด (ตัวเลขจากชีตแทนที่ทีละชนิด) รวมเป็น full ตอนท้าย */
  const fulls = new Map<CostRow, Record<CostSheetKind, number>>();
  const rowOf = (app: CostApp, owner: string | null) => {
    const k = `${app}|${owner ?? ""}`;
    const r = rows.get(k) ?? {
      app, owner, label: ownerText(owner),
      mc: 0, admin: 0, travel: 0, agency: 0, rate: null, planHours: 0, full: 0, gmv: null, sources: {}, forecast: 0,
    };
    rows.set(k, r);
    if (!fulls.has(r)) fulls.set(r, { mc: 0, admin: 0, travel: 0, agency: 0 });
    return r;
  };

  // ทีมเรา: ปัดเงินทีละคิวแล้วรวม (ตัวเลขเดียวกับสรุปรายเดือน / ไฟล์เบิก)
  let salaried = 0, unrated = 0;
  for (const d of summary.details) {
    if (d.cancelled || (d.type === "Mc" ? !see.mc : !see.admin)) continue;
    const app = detailApp(d), r = rowOf(app, app === "TikTok" ? null : "In house");
    const pay = payOfItems(summary, d.type, [d]), travel = travelOf(d), full = fulls.get(r)!;
    if (d.type === "Mc") full.mc += pay; else full.admin += pay - travel;
    full.travel += travel;
    if (d.startMs > cut) continue;
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
      fulls.get(r)!.agency += rate * hours;
      if (spanMs(s).startMs <= cut) r.agency += rate * hours;
    }
  }

  // ชีตของทีม: Actual > ระบบ > Forecast (ดูหัวไฟล์)
  const closed = cut === Infinity;
  const seen = (e: CostSheetEntry) => (e.kind === "mc" ? see.mc : e.kind === "agency" ? see.agency : see.admin);
  const entries = (sheet ?? []).filter(seen);
  for (const e of entries) {
    const current = rows.get(`${e.app}|${e.owner ?? ""}`);
    if (e.actual || (closed && e.forecast && !current?.[e.kind])) {
      const amount = (e.actual ?? e.forecast)!, r = rowOf(e.app, e.owner);
      r[e.kind] = amount;
      fulls.get(r)![e.kind] = amount;
      r.sources[e.kind] = e.actual ? "sheet" : "forecast";
      if (!e.actual) r.forecast += amount;
      if (e.kind === "agency") {
        const hours = (e.actual ? e.actualHours : e.forecastHours) ?? 0;
        r.planHours = hours;
        r.rate = hours ? amount / hours : null;
      }
    } else if (!closed && e.forecast && !(current && fulls.get(current)![e.kind])) {
      // เดือนที่ยังไม่จบและระบบไม่มีแผนของกลุ่มนี้: ลงเฉพาะยอดทั้งเดือน ไม่ปนกับยอดถึงวันนี้
      const r = rowOf(e.app, e.owner);
      fulls.get(r)![e.kind] = e.forecast;
      r.sources[e.kind] = "forecast";
      if (e.kind === "agency" && e.forecastHours) {
        r.planHours = e.forecastHours;
        r.rate = e.forecast / e.forecastHours;
      }
    }
  }
  const actualOf = (kind: CostSheetKind) => entries.some((e) => e.app === "TikTok" && e.kind === kind && e.actual);
  // Admin ใช้ยอดจริงจากชีตแล้ว: ค่ารถที่ระบบคิดเองไม่นับซ้ำ (เอาตามแถวค่าเดินทางในชีต)
  const ours = rows.get("TikTok|");
  if (ours && actualOf("admin") && !actualOf("travel")) {
    ours.travel = 0;
    fulls.get(ours)!.travel = 0;
  }
  // ใช้ยอดจริงทั้ง Mc และ Admin แล้ว: คิวที่ยังไม่ตั้งค่าจ้างในระบบไม่มีผลกับตัวเลข
  if (actualOf("mc") && actualOf("admin")) unrated = 0;
  for (const [r, f] of fulls) r.full = f.mc + f.admin + f.travel + f.agency;

  // GMV: ตามเวลาในแพลน · ส่วนที่ไม่ใช่ Agency = ทีมเรา: TikTok = ของเรา / Shopee = In house (ผู้ใช้ยืนยัน 2026-11-09)
  const lives = sessions?.filter((s) => startedAtMs(s) <= cut) ?? [];
  if (lives.length) {
    const rest: Record<CostApp, number> = { TikTok: 0, Shopee: 0 };
    for (const s of lives) rest[s.platform === "Shopee" ? "Shopee" : "TikTok"] += s.gmv;
    for (const c of splitByOwner(lives, spans)) {
      for (const x of c.rows) {
        if (!x.owner || x.owner === "In house") continue;
        const app = appOf(c.channel);
        rest[app] -= x.gmv;
        if (hasBudget(x.owner) && !see.agency) continue;
        const r = rowOf(app, x.owner);
        r.gmv = (r.gmv ?? 0) + x.gmv;
      }
    }
    for (const app of ["TikTok", "Shopee"] as const) if (rest[app] >= 0.5) rowOf(app, app === "TikTok" ? null : "In house").gmv = rest[app];
  }

  return {
    rows: [...rows.values()]
      .filter((r) => rowCost(r) || r.full || r.planHours || r.gmv)
      .sort((a, b) => rankOf(a) - rankOf(b) || b.full - a.full || a.label.localeCompare(b.label)),
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
    forecast: sum((r) => r.forecast),
  };
}

/** รวมหลายเดือนต่อกลุ่ม (ตารางทั้งปี) เรียงเหมือนในเดือน · ชั่วโมง / เรทไม่รวม เพราะแต่ละเดือนต่างที่มากัน */
export function yearRows(points: CostPoint[]): CostRow[] {
  const out = new Map<string, CostRow>();
  for (const r of points.flatMap((p) => p.rows)) {
    const k = `${r.app}|${r.owner ?? ""}`;
    const y = out.get(k) ?? { ...r, mc: 0, admin: 0, travel: 0, agency: 0, full: 0, gmv: null, forecast: 0, rate: null, planHours: 0, sources: {} };
    y.mc += r.mc; y.admin += r.admin; y.travel += r.travel; y.agency += r.agency; y.full += r.full; y.forecast += r.forecast;
    if (r.gmv !== null) y.gmv = (y.gmv ?? 0) + r.gmv;
    out.set(k, y);
  }
  return [...out.values()].sort((a, b) => rankOf(a) - rankOf(b) || b.full - a.full || a.label.localeCompare(b.label));
}

/** แถวเทียบ MoM: รวมแพลตฟอร์ม (app) / กลุ่ม (group) / รวมทั้งหมด (total) */
export type CostMomRow = {
  key: string; app: CostApp | null; label: string; level: "app" | "group" | "total";
  cur: { cost: number; gmv: number | null }; prev: { cost: number; gmv: number | null };
};
/**
 * เทียบ MoM รายแพลตฟอร์ม + กลุ่ม (กลุ่มที่มีแค่เดือนใดเดือนหนึ่งก็แสดง อีกเดือนเป็น 0 / ไม่มี GMV)
 *   เรียงแบบตารางหลัก: TikTok ก่อน Shopee · ในแพลตฟอร์มตามลำดับของเดือนนี้ แล้วกลุ่มที่มีแค่เดือนก่อน
 */
export function costMoM(rows: CostRow[], prev: CostRow[]): CostMomRow[] {
  const keyOf = (r: CostRow) => `${r.app}|${r.owner ?? ""}`;
  const pick = (r: CostRow | undefined) => ({ cost: r ? rowCost(r) : 0, gmv: r?.gmv ?? null });
  const sums = (list: CostRow[]) => { const t = costTotals(list); return { cost: t.cost, gmv: t.gmv }; };
  const out: CostMomRow[] = [];
  for (const app of ["TikTok", "Shopee"] as CostApp[]) {
    const a = rows.filter((r) => r.app === app), b = prev.filter((r) => r.app === app);
    if (!a.length && !b.length) continue;
    out.push({ key: app, app, label: app, level: "app", cur: sums(a), prev: sums(b) });
    const keys = [...new Set([...a, ...b].map(keyOf))];
    for (const k of keys) {
      const ra = a.find((r) => keyOf(r) === k), rb = b.find((r) => keyOf(r) === k);
      out.push({ key: k, app, label: (ra ?? rb)!.label, level: "group", cur: pick(ra), prev: pick(rb) });
    }
  }
  out.push({ key: "total", app: null, label: "รวม", level: "total", cur: sums(rows), prev: sums(prev) });
  return out;
}

/** Cost ต่อ GMV · ไม่มี GMV = null */
export const costRatio = (cost: number, gmv: number | null) => (gmv ? cost / gmv : null);
/** ROI ของไลฟ์ = GMV ÷ Cost (จ่าย ฿1 ได้ยอดขายกี่บาท) · ไม่มี GMV / Cost = null */
export const roiOf = (gmv: number | null, cost: number) => (gmv !== null && cost > 0 ? gmv / cost : null);

const money = (v: number | null) => ({ v, f: "money" as const });
const pct = (v: number | null) => ({ v, f: "pct" as const });
const dec = (v: number | null) => (v === null ? null : { v, f: "dec" as const });
const change = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : pct(a / b - 1));

/**
 * ไฟล์ส่งออกหน้า Cost / ROI: สรุปตามกลุ่ม + งบ Agency + แนวโน้มรายเดือน (ROI + ROI MoM) + แยกกลุ่มทั้งปี
 *   mc = ความคุ้มค่า Mc ของเดือนนี้ (แยก 5 มุมเหมือนหน้าเว็บ) · ไม่ส่ง = ไม่มีแผ่นนั้น
 */
export function costBook(report: CostReport, trend: CostPoint[] | null, mc?: McCostReport | null): ExportBook {
  const open = report.upTo !== null;
  const line = (app: string, label: string, r: Pick<CostRow, "mc" | "admin" | "travel" | "agency" | "full" | "gmv">, source = "") => [
    app, label, money(r.mc), money(r.admin), money(r.travel), money(r.agency), money(rowCost(r)), money(r.gmv), pct(costRatio(rowCost(r), r.gmv)),
    dec(roiOf(r.gmv, rowCost(r))), ...(open ? [money(r.full)] : []), source,
  ];
  // งบจากเรทในเว็บเท่านั้น (แถวที่มาจากชีตเรทคำนวณกลับจากยอด ไม่ใช่เรทที่ตั้งไว้)
  const budget = budgetSheet(report.rows.filter((r) => r.owner && hasBudget(r.owner) && !r.sources.agency).map((r) => (
    { label: r.label, channel: r.app, rate: r.rate, hours: r.planHours }
  )));
  const sheets: ExportSheet[] = [
    {
      name: "Cost",
      rows: [
        ["แพลตฟอร์ม", "กลุ่ม", "Mc", "Admin", "ค่ารถ", "Agency", "Cost รวม", "GMV", "Cost/GMV", "ROI (GMV ÷ Cost)", ...(open ? ["ทั้งเดือนตามแผน"] : []), "ที่มา"],
        ...report.rows.map((r) => line(r.app, r.label, r, rowSource(r) || "ระบบ")),
        line("รวม", "", report.totals),
        [],
        [`เทียบ ${report.prevMonth}${open ? " (นับถึงเวลาเดียวกัน)" : ""}`, "", money(report.prev.mc), money(report.prev.admin), money(report.prev.travel), money(report.prev.agency), money(report.prev.cost), money(report.prev.gmv), pct(costRatio(report.prev.cost, report.prev.gmv)), dec(roiOf(report.prev.gmv, report.prev.cost))],
      ],
    },
    ...(budget ? [budget] : []),
    ...(report.prevRows ? [{
      name: "เทียบ MoM",
      rows: [
        [`เดือนนี้ = ${report.month}${open ? " (ยังไม่จบเดือน)" : ""} · เดือนก่อน = ${report.prevMonth}${open ? " นับถึงเวลาเดียวกัน (ตัวเลขระบบ)" : ""}`],
        ["แพลตฟอร์ม", "กลุ่ม", "Cost เดือนนี้", "Cost เดือนก่อน", "Cost MoM", "GMV เดือนนี้", "GMV เดือนก่อน", "GMV MoM", "ROI เดือนนี้", "ROI เดือนก่อน", "ROI MoM", "Cost/GMV เดือนนี้", "Cost/GMV เดือนก่อน"],
        ...costMoM(report.rows, report.prevRows).map((r) => {
          const ra = roiOf(r.cur.gmv, r.cur.cost), rb = roiOf(r.prev.gmv, r.prev.cost);
          return [
            r.level === "total" ? "รวม" : r.app ?? "", r.level === "group" ? r.label : "",
            money(r.cur.cost), money(r.prev.cost), change(r.cur.cost, r.prev.cost),
            money(r.cur.gmv), money(r.prev.gmv), change(r.cur.gmv, r.prev.gmv),
            dec(ra), dec(rb), change(ra, rb),
            pct(r.cur.cost ? costRatio(r.cur.cost, r.cur.gmv) : null), pct(r.prev.cost ? costRatio(r.prev.cost, r.prev.gmv) : null),
          ];
        }),
      ],
    }] : []),
    ...(trend?.length ? [{
      name: "แนวโน้มรายเดือน",
      rows: [
        ["เดือน", "Mc", "Admin + ค่ารถ", "Agency", "Cost รวม", "GMV", "Cost/GMV", "ROI (GMV ÷ Cost)", "ROI MoM", "ในจำนวนนี้เป็นประมาณการ", "หมายเหตุ"],
        ...trend.map((p, i) => [
          p.month, money(p.mc), money(p.admin + p.travel), money(p.agency), money(p.cost), money(p.gmv), pct(costRatio(p.cost, p.gmv)),
          dec(roiOf(p.gmv, p.cost)), i ? change(roiOf(p.gmv, p.cost), roiOf(trend[i - 1].gmv, trend[i - 1].cost)) : null,
          money(p.forecast || null), p.open ? "ยังไม่จบเดือน" : "",
        ]),
      ],
    }, {
      name: "แยกกลุ่มทั้งปี",
      rows: [
        ["แพลตฟอร์ม", "กลุ่ม", "Mc", "Admin", "ค่ารถ", "Agency", "Cost รวม", "สัดส่วน Cost", "GMV", "ROI (GMV ÷ Cost)", "ในนี้เป็นประมาณการ"],
        ...yearRows(trend).filter((r) => rowCost(r) || r.gmv).map((r) => {
          const yearCost = trend.reduce((a, p) => a + p.cost, 0);
          return [r.app, r.label, money(r.mc), money(r.admin), money(r.travel), money(r.agency), money(rowCost(r)), pct(costRatio(rowCost(r), yearCost)), money(r.gmv), dec(roiOf(r.gmv, rowCost(r))), money(r.forecast || null)];
        }),
      ],
    }] : []),
    ...(mc?.cells.length ? MC_COST_DIMS.map(([dim, title]) => ({
      name: `คุ้มค่า Mc ${title}`,
      rows: [
        [title, "คิว", "ชม.", "ค่าจ้าง", "GMV", "ค่าจ้าง/ชม.", "GMV/ชม.", "ค่าจ้าง/ยอด", "จ่าย ฿1 ได้ยอด"],
        ...mcCostRows(mc.cells, dim).map((x) => [
          x.label, x.slots, dec(x.hours), money(x.cost), money(x.gmv), money(x.hours ? x.cost / x.hours : null), money(x.hours ? x.gmv / x.hours : null),
          pct(x.gmv ? x.cost / x.gmv : null), dec(x.cost ? x.gmv / x.cost : null),
        ]),
        [],
        ["ค่าจ้าง Mc (สูตรเดียวกับสรุปรายเดือน) เทียบยอดขายของคิวเดียวกัน · ไม่นับ Mc ประจำ · ยอดต่อคิว = GMV ที่กรอกใน slot ก่อน ไม่มีใช้ยอดจากไฟล์ Export แบ่งตามนาที (ประมาณ)"],
      ],
    })) : []),
  ];
  return { title: `GLORY Cost ${report.month}`, sheets };
}
