"use client";

import { Fragment, useEffect, useId, useState } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { hasBudget, parseRate } from "@/lib/agency-budget";
import { costBook, costRatio, costTotals, rowCost, rowSource, yearRows, type CostApp, type CostPoint, type CostReport, type CostRow } from "@/lib/cost-calc";
import { fmtDayMonth, fmtMonthShort, money, monthKey, monthLabel, num, parseKey } from "@/lib/format";
import { useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/ExportMenu";
import { BarChart, ChangeText, Legend, TableView } from "@/components/LiveCharts";
import { McCostView } from "@/components/McCostView";
import { MonthPicker } from "@/components/MonthPicker";
import { CountUp } from "@/components/motion";
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
  const kpis = [
    {
      label: "Cost รวม", value: totals.cost, format: baht, delta: <ChangeText cur={totals.cost} prev={prev.cost} suffix={vs} neutral />,
      note: [open && totals.full !== totals.cost ? `ทั้งเดือนตามแผน ${baht(totals.full)}` : "", totals.forecast ? `ประมาณการ ${baht(totals.forecast)}` : ""].filter(Boolean).join(" · "),
    },
    ...(see.gmv ? [{
      label: "Cost ต่อ GMV", value: costRatio(totals.cost, totals.gmv), format: pct,
      delta: <ChangeText cur={costRatio(totals.cost, totals.gmv)} prev={costRatio(prev.cost, prev.gmv)} suffix={vs} goodDown />,
      note: totals.gmv === null ? "ยังไม่มีไฟล์ Export ของเดือนนี้" : `GMV ${baht(totals.gmv)}`,
    }] : []),
    ...(see.mc ? [{ label: "ค่าจ้าง Mc", value: totals.mc, format: baht, delta: <ChangeText cur={totals.mc} prev={prev.mc} suffix={vs} neutral />, note: "" }] : []),
    ...(see.admin ? [{
      label: "Admin + ค่ารถ", value: totals.admin + totals.travel, format: baht,
      delta: <ChangeText cur={totals.admin + totals.travel} prev={prev.admin + prev.travel} suffix={vs} neutral />,
      note: totals.travel ? `ค่ารถ ${baht(totals.travel)}` : "",
    }] : []),
    ...(see.agency ? [{ label: "งบ Agency", value: totals.agency, format: baht, delta: <ChangeText cur={totals.agency} prev={prev.agency} suffix={vs} neutral />, note: "" }] : []),
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
        <ExportMenu size="sm" label="ส่งออก" build={() => costBook(report, trend)} />
      </div>

      {report.sheet.error ? (
        <Notice variant="warning" icon className="mt-2" title="ยังใช้ยอดจากชีตค่าใช้จ่ายไม่ได้ ตอนนี้แสดงเฉพาะตัวเลขที่ระบบคำนวณ">{report.sheet.error}</Notice>
      ) : null}
      {noRate.length ? (
        <Notice variant="warning" icon className="mt-2" title={`ยังไม่ตั้งเรท ${noRate.map((r) => r.label).join(", ")} — งบของกลุ่มนี้ยังไม่อยู่ในยอด`}>
          ใส่เรทได้ที่ส่วน &ldquo;เรท Agency&rdquo; ด้านล่าง
        </Notice>
      ) : null}

      <dl className={cn("mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border", kpis.length === 5 ? "sm:grid-cols-5" : kpis.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
        {kpis.map((k, i) => (
          // จำนวนช่องคี่ (มือถือ 2 คอลัมน์): ช่องแรก Cost รวมเต็มแถว
          <div key={k.label} className={cn("min-w-0 bg-card px-3 py-2.5", i === 0 && kpis.length % 2 === 1 && "col-span-2 sm:col-span-1")}>
            <dt className="truncate text-xs text-muted-foreground">{k.label}</dt>
            <dd className="text-lg font-bold tabular-nums">{k.value === null ? "-" : <CountUp value={k.value} format={k.format} />}</dd>
            <dd className="mt-0.5 text-xs leading-snug">
              {k.delta}
              {k.note ? <span className="block text-muted-foreground">{k.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

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
  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <h2 className="font-bold">Cost ปี {year}</h2>
      <p className="text-sm">
        รวม <b className="tabular-nums">{baht(yearCost)}</b>
        {see.gmv && yearGmv !== null ? <> · GMV <span className="tabular-nums">{baht(yearGmv)}</span> · Cost/GMV <b className="tabular-nums">{pct(costRatio(yearCost, yearGmv))}</b></> : null}
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
      <TableView title="ดูรายเดือนเป็นตาราง">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เดือน</TableHead>
              {series.map((s) => <TableHead key={s.name} className="text-right">{s.name}</TableHead>)}
              <TableHead className="text-right">Cost รวม</TableHead>
              {see.gmv ? <><TableHead className="text-right">GMV</TableHead><TableHead className="text-right">Cost/GMV</TableHead></> : null}
              <TableHead className="text-right">ในนี้เป็นประมาณการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trend.map((p, i) => (
              <TableRow key={p.month}>
                <TableCell className={cn(i === at && "font-semibold")}>{monthLabel(p.month)}{p.open ? <span className="text-xs text-muted-foreground"> (ยังไม่จบ)</span> : null}</TableCell>
                {series.map((s) => <TableCell key={s.name} className="text-right tabular-nums">{baht(s.values[i])}</TableCell>)}
                <TableCell className="text-right font-semibold tabular-nums">{baht(p.cost)}</TableCell>
                {see.gmv ? <><TableCell className="text-right tabular-nums">{baht(p.gmv)}</TableCell><TableCell className="text-right tabular-nums">{pct(costRatio(p.cost, p.gmv))}</TableCell></> : null}
                <TableCell className={cn("text-right tabular-nums", p.forecast ? "font-semibold text-warning-foreground" : "text-muted-foreground")}>{p.forecast ? baht(p.forecast) : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead className="font-semibold text-foreground">รวม</TableHead>
              {series.map((s) => <TableCell key={s.name} className="text-right font-semibold tabular-nums">{baht(s.values.reduce<number>((a, v) => a + (v ?? 0), 0))}</TableCell>)}
              <TableCell className="text-right font-semibold tabular-nums">{baht(yearCost)}</TableCell>
              {see.gmv ? <><TableCell className="text-right font-semibold tabular-nums">{baht(yearGmv)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{pct(costRatio(yearCost, yearGmv))}</TableCell></> : null}
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
