"use client";

import { Fragment, useEffect, useId, useState } from "react";
import {
  Building2Icon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, HeadsetIcon, MicIcon, PercentIcon, TrendingUpIcon, WalletIcon, type LucideIcon,
} from "lucide-react";
import { changeOf } from "@/lib/live-stats";
import { hasBudget, parseRate } from "@/lib/agency-budget";
import { costBook, costMoM, costRatio, costTotals, roiOf, rowCost, rowSource, yearRows, type CostApp, type CostPoint, type CostReport, type CostRow } from "@/lib/cost-calc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildCostDeck } from "@/lib/cost-slides";
import { bkkStamp } from "@/lib/live-export";
import type { CostReport as McCostReport } from "@/lib/mc-cost-calc";
import { fmtDayMonth, fmtMonthShort, money, monthKey, monthLabel, num, parseKey } from "@/lib/format";
import { useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { ExportMenu, SlidesMenu } from "@/components/ExportMenu";
import { BarChart, ChangeText, Legend, LineChart, TableView } from "@/components/LiveCharts";
import { McCostView } from "@/components/McCostView";
import { MonthPicker } from "@/components/MonthPicker";
import { KpiCard, type KpiChange } from "@/components/kpi";
import { IconButton, LoadError, LoadingBlock, Notice, StateBox, api, useToast } from "@/components/shared";
import { STICKY_CELL, STICKY_HEAD } from "@/components/SortHead";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// หน้า Cost: ค่าใช้จ่ายของทีมไลฟ์ในหน้าเดียว (src/lib/cost-calc.ts + ชีตของทีม src/lib/cost-sheet.ts) · งานจ่ายเงิน (โอน / ปิดงวด / ไฟล์เบิก) ยังอยู่ที่หน้าเจ้าของ

const MC_OPEN_KEY = "glory_cost_mc_open";
const baht = (n: number | null) => (n === null ? "-" : `฿${money(n)}`);
const pct = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(1)}%`);
const shortMonth = (key: string) => fmtMonthShort.format(new Date(`${key}-01T12:00:00Z`));

/** จุดตัด (ms) -> "5 พ.ย. 23:30 น." */
function cutText(ms: number) {
  const t = new Date(ms + 7 * 3600_000).toISOString();
  return `${fmtDayMonth.format(parseKey(t.slice(0, 10)))} ${t.slice(11, 16)} น.`;
}

/** Cost/GMV ของแถวในตาราง: ไม่มี Cost ในระบบ = "-" (0.0% จะอ่านเหมือนไม่ต้องจ่ายอะไรเลย) */
const rowPct = (cost: number, gmv: number | null) => (cost ? pct(costRatio(cost, gmv)) : "-");
/** ความคุ้มค่า Mc ของเดือนนี้ไว้ใส่ไฟล์ส่งออก / สไลด์ · null = ไม่มีสิทธิ์ดู / โหลดไม่ได้ (ส่วนอื่นยังออกได้) */
const loadMcCost = (month: string | null) => (month
  ? api<{ report: McCostReport }>(`/api/live-stats/cost?month=${month}`).then((r) => (r.ok ? r.report : null)).catch(() => null)
  : Promise.resolve(null));
const roiText = (v: number | null) => (v === null ? "-" : `×${v.toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);

/** ค่าใช้จ่ายของแถวนี้มาจากอะไร */
function RowDetail({ r }: { r: CostRow }) {
  const source = rowSource(r);
  const tag = source ? <span className={cn("block", Object.values(r.sources).includes("forecast") && "font-semibold text-warning-foreground")}>{source}</span> : null;
  if (!r.owner && r.app === "Shopee") return <>ยอดขายที่ไม่มีกลุ่มในแพลนช่วงเวลานี้</>;
  if (r.owner && r.owner !== "In house" && !hasBudget(r.owner)) return <>ไม่คิดค่าใช้จ่าย{tag}</>;
  if (r.owner && hasBudget(r.owner)) {
    return (
      <>
        {r.rate ? <>฿{Math.round(r.rate).toLocaleString("th-TH")} × {num(r.planHours)} ชม.</>
          : r.sources.agency ? null : <span className="font-semibold text-warning-foreground">ยังไม่ตั้งเรท · {num(r.planHours)} ชม.</span>}
        {tag}
      </>
    );
  }
  const parts = ([[r.mc, "Mc"], [r.admin, "Admin"], [r.travel, "ค่ารถ"]] as const).filter(([v]) => v);
  if (!parts.length) return tag ?? <>ยังไม่มีค่าใช้จ่าย</>;
  // มือถือ: คนละบรรทัด (คอลัมน์แคบ) · จอกว้าง: บรรทัดเดียวคั่นด้วย ·
  return <>{parts.map(([v, name]) => <span key={name} className="block sm:inline sm:not-last:after:content-['_·_']">{name} {baht(v)}</span>)}{tag}</>;
}

export function CostPage() {
  const [month, setMonth] = useState(() => monthKey());
  const [state, setState] = useState<{ month: string; report?: CostReport; error?: string }>({ month: "" });
  const [trend, setTrend] = useState<CostPoint[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mcOpen = useLocal(MC_OPEN_KEY) === "1";
  const year = month.slice(0, 4);

  useEffect(() => {
    let alive = true;
    api<{ report: CostReport }>(`/api/cost?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) setState({ month, report: res.report });
      })
      .catch((err) => { if (alive) setState({ month, error: (err as Error).message }); });
    return () => { alive = false; };
  }, [month, attempt]);

  // ยอดทั้งปีของเดือนที่เลือก: เปลี่ยนเดือนในปีเดียวกันไม่ต้องโหลดใหม่ · แก้เรทแล้วโหลดใหม่ · โหลดไม่ได้ = ซ่อนกราฟ ส่วนอื่นยังใช้ได้
  useEffect(() => {
    let alive = true;
    api<{ trend: CostPoint[] }>(`/api/cost?trend=${year}`)
      .then((res) => { if (alive) setTrend(res.ok ? res.trend : []); })
      .catch(() => { if (alive) setTrend([]); });
    return () => { alive = false; };
  }, [year, attempt]);

  const nav = (
    <div className="my-2 flex items-center justify-between gap-3">
      <IconButton label="เดือนก่อนหน้า" onClick={() => setMonth(monthKey(-1, month))}><ChevronLeftIcon /></IconButton>
      <MonthPicker mode="single" value={{ from: month, to: month }} onChange={(x) => setMonth(x.from)} />
      <IconButton label="เดือนถัดไป" onClick={() => setMonth(monthKey(1, month))}><ChevronRightIcon /></IconButton>
    </div>
  );
  const report = state.month === month ? state.report : undefined;
  if (!report) {
    return <>{nav}{state.month === month && state.error ? <LoadError title="โหลดหน้า Cost ไม่สำเร็จ" message={state.error} onRetry={() => setAttempt((n) => n + 1)} /> : <LoadingBlock />}</>;
  }

  const { see, totals, prev } = report;
  const open = report.upTo !== null;
  const prevName = shortMonth(report.prevMonth);
  const vs = `vs ${prevName}`;
  // เส้นแนวโน้มในการ์ด = ยอดรายเดือนของปีนี้ถึงเดือนที่เลือก (โหลดยอดทั้งปีไม่ได้ = ไม่มีเส้น)
  const upToMonth = (trend ?? []).filter((p) => p.month <= report.month);
  const sparkOf = (f: (t: CostPoint) => number | null) => (upToMonth.length > 1 ? upToMonth.map(f) : undefined);
  type Kpi = { label: string; icon: LucideIcon; value: number | null; format: (n: number) => string; change: KpiChange; note: string; spark?: (number | null)[] };
  const kpis: Kpi[] = [
    {
      label: "Cost รวม", icon: WalletIcon, value: totals.cost, format: baht, change: { cur: totals.cost, prev: prev.cost, neutral: true },
      note: [open && totals.full !== totals.cost ? `ทั้งเดือนตามแผน ${baht(totals.full)}` : "", totals.forecast ? `ประมาณการ ${baht(totals.forecast)}` : ""].filter(Boolean).join(" · "),
      spark: sparkOf((t) => t.cost),
    },
    ...(see.gmv ? [{
      label: "Cost ต่อ GMV", icon: PercentIcon, value: costRatio(totals.cost, totals.gmv), format: pct,
      change: { cur: costRatio(totals.cost, totals.gmv), prev: costRatio(prev.cost, prev.gmv), goodDown: true },
      note: totals.gmv === null ? "ยังไม่มีไฟล์ Export ของเดือนนี้" : `GMV ${baht(totals.gmv)}`,
      spark: sparkOf((t) => costRatio(t.cost, t.gmv)),
    }, {
      label: "ROI (GMV ÷ Cost)", icon: TrendingUpIcon, value: roiOf(totals.gmv, totals.cost), format: roiText,
      change: { cur: roiOf(totals.gmv, totals.cost), prev: roiOf(prev.gmv, prev.cost) },
      note: roiOf(totals.gmv, totals.cost) === null ? "" : `จ่าย ฿1 ได้ยอดขาย ${baht(roiOf(totals.gmv, totals.cost))}`,
      spark: sparkOf((t) => roiOf(t.gmv, t.cost)),
    }] : []),
    ...(see.mc ? [{ label: "ค่าจ้าง Mc", icon: MicIcon, value: totals.mc, format: baht, change: { cur: totals.mc, prev: prev.mc, neutral: true }, note: "", spark: sparkOf((t) => t.mc) }] : []),
    ...(see.admin ? [{
      label: "Admin + ค่ารถ", icon: HeadsetIcon, value: totals.admin + totals.travel, format: baht,
      change: { cur: totals.admin + totals.travel, prev: prev.admin + prev.travel, neutral: true },
      note: totals.travel ? `ค่ารถ ${baht(totals.travel)}` : "", spark: sparkOf((t) => t.admin + t.travel),
    }] : []),
    ...(see.agency ? [{
      label: "งบ Agency", icon: Building2Icon, value: totals.agency, format: baht, change: { cur: totals.agency, prev: prev.agency, neutral: true }, note: "",
      spark: sparkOf((t) => t.agency),
    }] : []),
  ];

  const noRate = report.rows.filter((r) => r.owner && hasBudget(r.owner) && !r.rate && !r.sources.agency);
  const groups = (["TikTok", "Shopee"] as CostApp[]).map((app) => ({ app, rows: report.rows.filter((r) => r.app === app) })).filter((g) => g.rows.length);
  // มี Cost ของกลุ่มแต่แยก GMV ไม่ได้ (เดือนที่ยังไม่มีแพลนกลุ่ม)
  const noGroupGmv = see.gmv && report.rows.some((r) => r.owner && rowCost(r) && r.gmv === null);

  return (
    <div className="pb-10">
      {nav}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          {report.upTo !== null
            ? <>นับถึง {cutText(report.upTo)}{see.gmv && totals.gmv !== null ? " (ไลฟ์ล่าสุดในไฟล์ Export ให้เทียบ GMV ได้ตรงกัน)" : ""} · {prevName} นับถึงเวลาเดียวกัน</>
            : <>ทั้งเดือน {monthLabel(report.month)} · เทียบ {monthLabel(report.prevMonth)}</>}
          {totals.agency && !prev.agency ? <span className="block font-semibold text-warning-foreground">{prevName} ยังไม่มีงบ Agency ในยอด Cost ที่เทียบกันจึงดูเพิ่มขึ้นมากกว่าจริง</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <ExportMenu size="sm" label="ส่งออก" build={async () => costBook(report, trend, await loadMcCost(see.mc && see.gmv ? month : null))} />
          <SlidesMenu label="สไลด์" title={`GLORY Cost ROI ${monthLabel(report.month)}`} build={async (target) => buildCostDeck({
            report, trend, mc: await loadMcCost(see.mc && see.gmv ? month : null),
            monthName: monthLabel(report.month), prevName, shortMonth, monthLabel,
            cutText: report.upTo !== null ? `นับถึง ${cutText(report.upTo)} · ${prevName} นับถึงเวลาเดียวกัน` : `ทั้งเดือน ${monthLabel(report.month)} · เทียบ ${monthLabel(report.prevMonth)}`,
            exportedAt: bkkStamp(new Date().toISOString()),
          }, target)} />
        </div>
      </div>

      {report.sheet.error ? (
        <Notice variant="warning" icon className="mt-2" title="ยังใช้ยอดจากชีตค่าใช้จ่ายไม่ได้ ตอนนี้แสดงเฉพาะตัวเลขที่ระบบคำนวณ">{report.sheet.error}</Notice>
      ) : null}
      {noRate.length ? (
        <Notice variant="warning" icon className="mt-2" title={`ยังไม่ตั้งเรท ${noRate.map((r) => r.label).join(", ")} — งบของกลุ่มนี้ยังไม่อยู่ในยอด`}>
          ใส่เรทได้ที่ส่วน &ldquo;เรท Agency&rdquo; ด้านล่าง
        </Notice>
      ) : null}

      {/* หน้านี้กว้างไม่เกิน ~700px: ไม่เกิน 3 การ์ดต่อแถว (6 การ์ดแถวเดียวแคบจนตัวหนังสือทับกัน) · มือถือ 2 คอลัมน์ */}
      <div className={cn("mt-3 grid grid-cols-2 gap-2", kpis.length === 4 ? "sm:grid-cols-4" : kpis.length > 2 ? "sm:grid-cols-3" : "")}>
        {kpis.map((k, i) => (
          // ช่องว่างท้ายแถว: มือถือจำนวนคี่ = Cost รวมเต็มแถว · จอกว้าง 5 การ์ด = Cost รวมกว้าง 2 ช่อง (3 + 2 → 2 แถวเต็ม)
          <KpiCard
            key={k.label} index={i} icon={k.icon} label={k.label} value={k.value} format={k.format} empty="-" change={k.change} spark={k.spark}
            className={cn(i === 0 && kpis.length % 2 === 1 && "max-sm:col-span-2", i === 0 && kpis.length === 5 && "sm:col-span-2")}
          >
            {/* ป้าย % มุมขวาบน · บรรทัดนี้บอกว่าเทียบกับอะไร (ไม่มีฐานเทียบ = ข้อความแจ้ง) */}
            {changeOf(k.change.cur, k.change.prev) === null
              ? <ChangeText cur={k.change.cur} prev={k.change.prev} suffix={vs} />
              : <span className="block text-muted-foreground">{vs}</span>}
            {k.note ? <span className="block text-muted-foreground">{k.note}</span> : null}
          </KpiCard>
        ))}
      </div>

      {report.rows.length ? (
        <section className="my-4 rounded-2xl border bg-card p-3">
          <h2 className="mb-2 font-bold">แยกตามแพลตฟอร์มและกลุ่ม</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={STICKY_HEAD}>กลุ่ม</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                {see.gmv ? <><TableHead className="text-right">GMV</TableHead><TableHead className="text-right">Cost/GMV</TableHead></> : null}
                {open ? <TableHead className="text-right">ทั้งเดือนตามแผน</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => {
                const sub = costTotals(g.rows);
                return (
                  <Fragment key={g.app}>
                    <TableRow className="bg-muted/50 font-semibold">
                      <TableCell className={cn(STICKY_CELL, "bg-muted")}>{g.app}</TableCell>
                      <TableCell className="text-right tabular-nums">{baht(sub.cost)}</TableCell>
                      {see.gmv ? <><TableCell className="text-right tabular-nums">{baht(sub.gmv)}</TableCell><TableCell className="text-right tabular-nums">{rowPct(sub.cost, sub.gmv)}</TableCell></> : null}
                      {open ? <TableCell className="text-right tabular-nums">{baht(sub.full)}</TableCell> : null}
                    </TableRow>
                    {g.rows.map((r) => (
                      <TableRow key={r.label}>
                        <TableCell className={cn(STICKY_CELL, "max-w-56 min-w-32 whitespace-normal")}>
                          <span className="block font-medium">{r.label}</span>
                          <span className="block text-xs text-muted-foreground"><RowDetail r={r} /></span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{baht(rowCost(r))}</TableCell>
                        {see.gmv ? <><TableCell className="text-right tabular-nums">{baht(r.gmv)}</TableCell><TableCell className="text-right tabular-nums">{rowPct(rowCost(r), r.gmv)}</TableCell></> : null}
                        {open ? <TableCell className="text-right tabular-nums text-muted-foreground">{baht(r.full)}</TableCell> : null}
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableHead className={cn(STICKY_CELL, "font-semibold text-foreground")}>รวม</TableHead>
                <TableCell className="text-right font-semibold tabular-nums">{baht(totals.cost)}</TableCell>
                {see.gmv ? <><TableCell className="text-right font-semibold tabular-nums">{baht(totals.gmv)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{pct(costRatio(totals.cost, totals.gmv))}</TableCell></> : null}
                {open ? <TableCell className="text-right font-semibold tabular-nums">{baht(totals.full)}</TableCell> : null}
              </TableRow>
            </TableFooter>
          </Table>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {report.sheet.ready ? "ลำดับตัวเลข: ยอดจริง (Actual) ในชีต > ระบบคำนวณ > ประมาณการ (Forecast) ในชีต · " : ""}
            ตัวเลขที่ระบบคำนวณ: ค่าจ้าง Mc / Admin สูตรเดียวกับสรุปรายเดือน · งบ Agency = เรท × ชั่วโมงในแพลน ไม่ใช่ยอดที่จ่ายจริง
            {see.gmv ? " · GMV แยกตามเวลาในแพลน ไลฟ์ที่คร่อมหลายกลุ่มแบ่งตามนาที (≈ ประมาณ)" : ""}
            {noGroupGmv ? <><br />เดือนนี้ยังไม่มีแพลนกลุ่ม จึงแยก GMV รายกลุ่มไม่ได้ ดู Cost/GMV ที่บรรทัด TikTok / Shopee แทน</> : null}
            <br />ไม่รวมเงินเดือน Mc / Admin ประจำ เพราะระบบไม่มีตัวเลขนี้{report.salaried ? ` (${report.salaried.toLocaleString("th-TH")} คิว)` : ""}
            {report.unrated ? <span className="font-semibold text-warning-foreground"> · มี {report.unrated.toLocaleString("th-TH")} คิวที่ยังไม่ได้ตั้งค่าจ้าง จึงยังไม่อยู่ในยอด</span> : null}
          </p>
        </section>
      ) : <StateBox title={`ยังไม่มีค่าใช้จ่ายของ${monthLabel(report.month)}`}>ลองเลือกเดือนอื่น</StateBox>}

      {report.prevRows && (report.rows.length || report.prevRows.length) ? <MomSection report={report} prevName={prevName} /> : null}

      <TrendSection key={attempt} trend={trend} report={report} month={month} year={year} />

      {see.agency && report.agencies.length ? (
        <AgencyRates key={`${month}|${attempt}`} report={report} onSaved={() => setAttempt((n) => n + 1)} />
      ) : null}

      {/* มี GMV จากไฟล์ Export: ต้องเห็นค่าจ้าง Mc และดูสถิติไลฟ์ได้ทั้งคู่ */}
      {see.mc && see.gmv ? (
        <Collapsible open={mcOpen} onOpenChange={(v) => writeLocal(MC_OPEN_KEY, v ? "1" : "0")} className="group/mc my-4 rounded-2xl border bg-card p-3">
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span>
              <span className="block font-bold">ความคุ้มค่า Mc</span>
              <span className="block text-xs text-muted-foreground">ค่าจ้าง Mc เทียบยอดขายของคิวเดียวกัน แยกตามช่วงเวลา / ช่อง / Mc / แคมเปญ / แพลตฟอร์ม</span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/mc:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2"><McCostView month={month} /></CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

type MomMetric = "cost" | "gmv" | "roi" | "ratio";
const MOM_METRICS: { key: MomMetric; label: string; gmv: boolean }[] = [
  { key: "cost", label: "Cost", gmv: false }, { key: "gmv", label: "GMV", gmv: true },
  { key: "roi", label: "ROI (GMV ÷ Cost)", gmv: true }, { key: "ratio", label: "Cost ต่อ GMV", gmv: true },
];
const momValue = (x: { cost: number; gmv: number | null }, k: MomMetric) =>
  k === "cost" ? x.cost : k === "gmv" ? x.gmv : k === "roi" ? roiOf(x.gmv, x.cost) : x.cost ? costRatio(x.cost, x.gmv) : null;
const momFormat = (k: MomMetric, v: number | null) => (k === "roi" ? roiText(v) : k === "ratio" ? pct(v) : baht(v));

/**
 * เทียบ MoM รายแพลตฟอร์ม + กลุ่ม (ผู้ใช้ขอ 2026-11-10): กราฟแท่งคู่ เดือนนี้ (ชมพู) vs เดือนก่อน (ฟ้า) เลือกตัวชี้วัดจากดรอปดาวน์ + ตารางครบทุกค่า
 *   เดือนที่ยังไม่จบ: เดือนก่อนนับถึงเวลาเดียวกัน (ตัวเลขระบบ ไม่ใช้ยอดทั้งเดือนในชีต) · Cost เพิ่ม = ไม่ระบายเขียว/แดง · Cost/GMV ลด = ดี
 */
function MomSection({ report, prevName }: { report: CostReport; prevName: string }) {
  const [metric, setMetric] = useState<MomMetric>("cost");
  const { see } = report;
  const rows = costMoM(report.rows, report.prevRows ?? []);
  const groups = rows.filter((r) => r.level === "group");
  const metrics = MOM_METRICS.filter((m) => see.gmv || !m.gmv);
  const active = metrics.some((m) => m.key === metric) ? metric : "cost";
  const def = MOM_METRICS.find((m) => m.key === active)!;
  const curName = shortMonth(report.month), prevShort = `${prevName}${report.upTo !== null ? " (ถึงเวลาเดียวกัน)" : ""}`;
  const delta = (k: MomMetric, r: (typeof rows)[number]) => (
    <ChangeText cur={momValue(r.cur, k)} prev={momValue(r.prev, k)} neutral={k === "cost"} goodDown={k === "ratio"} />
  );
  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">เทียบ MoM: {curName} vs {prevShort}</h2>
        <Select value={active} onValueChange={(v) => setMetric(v as MomMetric)}>
          <SelectTrigger aria-label="ตัวชี้วัดที่เทียบ" className="h-8 min-w-36 rounded-full bg-card text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            {metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        แท่งชมพู = {curName} · แท่งฟ้า = {prevShort} · ชี้ / แตะแท่งดูตัวเลขและ % ที่เปลี่ยน
        {report.upTo !== null ? " · เดือนก่อนนับถึงเวลาเดียวกัน ใช้ตัวเลขที่ระบบคำนวณ (ยอดในชีตเป็นยอดทั้งเดือน)" : ""}
      </p>
      {groups.length ? (
        <BarChart
          key={`${active}|${report.month}`} label={`${def.label} แยกกลุ่ม ${curName} เทียบ ${prevShort}`} height={220}
          categories={groups.map((r) => r.label.replace(/^Agency /, ""))} tooltipTitles={groups.map((r) => `${r.app} · ${r.label}`)}
          series={[
            { name: curName, color: "var(--viz-cur)", values: groups.map((r) => momValue(r.cur, active)) },
            { name: prevShort, color: "var(--viz-prev)", values: groups.map((r) => momValue(r.prev, active)) },
          ]}
          format={(v) => momFormat(active, v)}
          formatAxis={(v) => (active === "roi" ? `×${v.toLocaleString("th-TH", { maximumFractionDigits: 1 })}` : active === "ratio" ? `${(v * 100).toFixed(0)}%`
            : v >= 1_000_000 ? `฿${(v / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}M` : v >= 1000 ? `฿${Math.round(v / 1000)}K` : `฿${v}`)}
        />
      ) : null}
      <div className="mt-1"><Legend series={[{ name: curName, color: "var(--viz-cur)" }, { name: prevShort, color: "var(--viz-prev)" }]} /></div>
      <div className="mt-3 overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={STICKY_HEAD}>กลุ่ม</TableHead>
              <TableHead className="text-right">Cost {curName}</TableHead><TableHead className="text-right">Cost {prevName}</TableHead><TableHead className="text-right">MoM</TableHead>
              {see.gmv ? (
                <>
                  <TableHead className="text-right">GMV {curName}</TableHead><TableHead className="text-right">GMV {prevName}</TableHead><TableHead className="text-right">MoM</TableHead>
                  <TableHead className="text-right">ROI {curName}</TableHead><TableHead className="text-right">ROI {prevName}</TableHead><TableHead className="text-right">MoM</TableHead>
                </>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} className={cn(r.level !== "group" && "bg-muted/50 font-semibold hover:bg-muted/50")}>
                <TableCell className={cn(STICKY_CELL, r.level !== "group" && "bg-muted", r.level === "group" && "pl-5")}>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{baht(r.cur.cost)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{baht(r.prev.cost)}</TableCell>
                <TableCell className="text-right">{delta("cost", r)}</TableCell>
                {see.gmv ? (
                  <>
                    <TableCell className="text-right tabular-nums">{baht(r.cur.gmv)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{baht(r.prev.gmv)}</TableCell>
                    <TableCell className="text-right">{delta("gmv", r)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{roiText(momValue(r.cur, "roi"))}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{roiText(momValue(r.prev, "roi"))}</TableCell>
                    <TableCell className="text-right">{delta("roi", r)}</TableCell>
                  </>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {report.totals.agency && !report.prev.agency ? (
        <p className="mt-1 text-xs font-semibold text-warning-foreground">{prevName} ยังไม่มีงบ Agency ในยอด Cost ที่เทียบกันจึงดูเพิ่มขึ้นมากกว่าจริง</p>
      ) : null}
    </section>
  );
}

/** Cost ทั้งปี: แท่งซ้อนรายเดือนตามประเภทค่าใช้จ่าย (ความสูง = Cost รวมจริง) + ตารางรายเดือน + ตารางแยกกลุ่ม */
function TrendSection({ trend, report, month, year }: { trend: CostPoint[] | null; report: CostReport; month: string; year: string }) {
  if (!trend) return <LoadingBlock />;
  if (!trend.length) return null;
  const { see } = report;
  const sum = (f: (p: CostPoint) => number) => trend.reduce((a, p) => a + f(p), 0);
  const yearCost = sum((p) => p.cost), yearForecast = sum((p) => p.forecast);
  const hasGmv = trend.some((p) => p.gmv !== null), yearGmv = hasGmv ? sum((p) => p.gmv ?? 0) : null;
  const byGroup = yearRows(trend);
  const series = [
    ...(see.mc ? [{ name: "Mc", color: "var(--cost-mc)", values: trend.map((p) => p.mc) }] : []),
    ...(see.admin ? [{ name: "Admin + ค่ารถ", color: "var(--cost-admin)", values: trend.map((p) => p.admin + p.travel) }] : []),
    ...(see.agency ? [{ name: "Agency", color: "var(--cost-agency)", values: trend.map((p) => p.agency) }] : []),
  ];
  const at = trend.findIndex((p) => p.month === month);
  const roi = trend.map((p) => roiOf(p.gmv, p.cost));
  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <h2 className="font-bold">Cost ปี {year}</h2>
      <p className="text-sm">
        รวม <b className="tabular-nums">{baht(yearCost)}</b>
        {see.gmv && yearGmv !== null ? <> · GMV <span className="tabular-nums">{baht(yearGmv)}</span> · Cost/GMV <b className="tabular-nums">{pct(costRatio(yearCost, yearGmv))}</b> · ROI <b className="tabular-nums">{roiText(roiOf(yearGmv, yearCost))}</b></> : null}
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        * = ยังไม่จบเดือน · ~ = มีตัวเลขประมาณการ (Forecast){yearForecast ? ` รวม ${baht(yearForecast)}` : ""}{at >= 0 ? " · ชื่อตัวหนา = เดือนที่เลือก" : ""}
      </p>
      <BarChart
        label={`Cost รายเดือน ปี ${year}`}
        categories={trend.map((p) => `${shortMonth(p.month)}${p.open ? "*" : p.forecast ? "~" : ""}`)}
        tooltipTitles={trend.map((p) => `${monthLabel(p.month)}${p.open ? " (ยังไม่จบเดือน)" : p.forecast ? ` (ประมาณการ ${baht(p.forecast)})` : ""}`)}
        series={series}
        format={baht}
        formatAxis={(v) => (v >= 1_000_000 ? `฿${(v / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}M` : v >= 1000 ? `฿${(v / 1000).toLocaleString("th-TH", { maximumFractionDigits: 0 })}K` : `฿${v}`)}
        highlight={at >= 0 ? at : undefined}
        stacked
        compare={false}
      />
      {series.length > 1 ? <div className="mt-1"><Legend series={series} /></div> : null}
      {see.gmv && roi.some((v) => v !== null) ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">ROI รายเดือน (GMV ÷ Cost)</h3>
          <p className="text-xs text-muted-foreground">จ่ายค่าทีมไลฟ์ ฿1 ได้ยอดขายกี่บาท · สูงขึ้น = คุ้มขึ้น{at > 0 && roi[at] !== null && roi[at - 1] !== null ? <> · {monthLabel(month)} เทียบเดือนก่อน <ChangeText cur={roi[at]} prev={roi[at - 1]} /></> : null}</p>
          <LineChart
            label={`ROI รายเดือน ปี ${year}`} height={200}
            categories={trend.map((p) => `${shortMonth(p.month)}${p.open ? "*" : p.forecast ? "~" : ""}`)}
            tooltipTitles={trend.map((p) => monthLabel(p.month))}
            series={[{ name: "ROI", color: "var(--viz-cur)", values: roi }]}
            format={roiText} formatAxis={(v) => `×${v.toLocaleString("th-TH", { maximumFractionDigits: 1 })}`}
          />
        </>
      ) : null}
      <TableView title="ดูรายเดือนเป็นตาราง">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เดือน</TableHead>
              {series.map((s) => <TableHead key={s.name} className="text-right">{s.name}</TableHead>)}
              <TableHead className="text-right">Cost รวม</TableHead>
              {see.gmv ? <><TableHead className="text-right">GMV</TableHead><TableHead className="text-right">Cost/GMV</TableHead><TableHead className="text-right">ROI</TableHead><TableHead className="text-right">ROI MoM</TableHead></> : null}
              <TableHead className="text-right">ในนี้เป็นประมาณการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trend.map((p, i) => (
              <TableRow key={p.month}>
                <TableCell className={cn(i === at && "font-semibold")}>{monthLabel(p.month)}{p.open ? <span className="text-xs text-muted-foreground"> (ยังไม่จบ)</span> : null}</TableCell>
                {series.map((s) => <TableCell key={s.name} className="text-right tabular-nums">{baht(s.values[i])}</TableCell>)}
                <TableCell className="text-right font-semibold tabular-nums">{baht(p.cost)}</TableCell>
                {see.gmv ? (
                  <>
                    <TableCell className="text-right tabular-nums">{baht(p.gmv)}</TableCell><TableCell className="text-right tabular-nums">{pct(costRatio(p.cost, p.gmv))}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{roiText(roi[i])}</TableCell>
                    <TableCell className="text-right">{i > 0 ? <ChangeText cur={roi[i]} prev={roi[i - 1]} /> : null}</TableCell>
                  </>
                ) : null}
                <TableCell className={cn("text-right tabular-nums", p.forecast ? "font-semibold text-warning-foreground" : "text-muted-foreground")}>{p.forecast ? baht(p.forecast) : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead className="font-semibold text-foreground">รวม</TableHead>
              {series.map((s) => <TableCell key={s.name} className="text-right font-semibold tabular-nums">{baht(s.values.reduce<number>((a, v) => a + (v ?? 0), 0))}</TableCell>)}
              <TableCell className="text-right font-semibold tabular-nums">{baht(yearCost)}</TableCell>
              {see.gmv ? (
                <>
                  <TableCell className="text-right font-semibold tabular-nums">{baht(yearGmv)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{pct(costRatio(yearCost, yearGmv))}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{roiText(roiOf(yearGmv, yearCost))}</TableCell><TableCell />
                </>
              ) : null}
              <TableCell className="text-right font-semibold tabular-nums">{yearForecast ? baht(yearForecast) : "-"}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableView>
      <TableView title="ดูแยกกลุ่มทั้งปีเป็นตาราง">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>กลุ่ม</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">สัดส่วน</TableHead>
              <TableHead className="text-right">ในนี้เป็นประมาณการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byGroup.filter((r) => rowCost(r)).map((r) => (
              <TableRow key={`${r.app}|${r.owner ?? ""}`}>
                <TableCell>{r.app} · {r.label}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{baht(rowCost(r))}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(costRatio(rowCost(r), yearCost))}</TableCell>
                <TableCell className={cn("text-right tabular-nums", r.forecast ? "font-semibold text-warning-foreground" : "text-muted-foreground")}>{r.forecast ? baht(r.forecast) : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableView>
    </section>
  );
}

/** เรทต่อชั่วโมงของกลุ่มภายนอก (ตั้งแยกแต่ละเดือน) กดบันทึกแล้วตัวเลขทั้งหน้าเปลี่ยนตาม */
function AgencyRates({ report, onSaved }: { report: CostReport; onSaved: () => void }) {
  const id = useId();
  const toast = useToast();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const rows = report.agencies.map((g) => {
    const text = typed[g.agency] ?? (g.rate === null ? "" : String(g.rate));
    return { ...g, text, next: parseRate(text) };
  });
  const changed = rows.filter((g) => !Number.isNaN(g.next) && g.next !== g.rate);
  const bad = rows.some((g) => Number.isNaN(g.next));

  async function save() {
    setSaving(true);
    try {
      const res = await api("/api/cost", { month: report.month, rates: changed.map((g) => ({ agency: g.agency, rate: g.next })) });
      if (!res.ok) throw new Error(res.message);
      toast("บันทึกเรท Agency แล้ว");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="my-4 space-y-3 rounded-2xl border bg-card p-3 text-sm">
      <h2 className="text-base font-bold">เรท Agency {monthLabel(report.month)}</h2>
      {rows.map((g) => {
        const wrong = Number.isNaN(g.next);
        return (
          <div key={g.agency} className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${id}-${g.agency}`} className="w-32 font-semibold">{g.label}</Label>
            <Input
              id={`${id}-${g.agency}`}
              inputMode="decimal"
              value={g.text}
              onChange={(e) => setTyped((t) => ({ ...t, [g.agency]: e.target.value }))}
              placeholder="เรทต่อชั่วโมง (บาท)"
              aria-invalid={wrong}
              className="w-44"
            />
            <span className={cn("text-xs tabular-nums", wrong ? "font-semibold text-destructive" : "text-muted-foreground")}>
              {wrong ? "ตัวเลขไม่ถูกต้อง"
                : !g.next ? `${num(g.hours)} ชม. ในแพลน · ยังไม่ตั้งเรท`
                  : <>฿{g.next.toLocaleString("th-TH")}/ชม. × {num(g.hours)} ชม. = <strong className="text-foreground">{baht(g.next * g.hours)}</strong></>}
            </span>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          ตั้งเรทแยกแต่ละเดือน · งบเปลี่ยนตามชั่วโมงที่ติ๊กในหน้าแพลน · เก็บในเว็บ ไม่ลงชีต
        </p>
        <Button disabled={saving || bad || !changed.length} onClick={save}>
          {saving ? <><Spinner />กำลังบันทึก...</> : "บันทึกเรท"}
        </Button>
      </div>
    </section>
  );
}
