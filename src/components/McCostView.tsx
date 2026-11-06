"use client";

import { useEffect, useState } from "react";
import { BANDS } from "@/lib/campaign";
import { fmtMonthShort, money, num } from "@/lib/format";
import { useLocal, writeLocal } from "@/lib/hooks";
import type { CostCell, CostReport } from "@/lib/mc-cost-calc";
import { cn } from "@/lib/utils";
import { ChangeText } from "@/components/LiveCharts";
import { CountUp } from "@/components/motion";
import { LoadError, LoadingBlock, StateBox, api } from "@/components/shared";
import { SortHead, sortRows, STICKY_CELL, STICKY_HEAD, type SortState } from "@/components/SortHead";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * หน้า Cost > ความคุ้มค่า Mc: ค่าจ้าง Mc เทียบยอดขายของคิวเดียวกัน (ไม่นับ Mc ประจำ) — src/lib/mc-cost-calc.ts
 *   แยกดูตาม ช่วงเวลา / ช่อง / Mc / แคมเปญ / แพลตฟอร์ม · เฉพาะคนที่เห็นค่าจ้าง Mc
 */

const DIMS = [["band", "ช่วงเวลา"], ["platform", "ช่อง"], ["mc", "Mc"], ["camp", "แคมเปญ"], ["app", "แพลตฟอร์ม"]] as const;
type Dim = (typeof DIMS)[number][0];
const DIM_KEY = "glory_cost_dim";
const BAND_TIME: Record<string, string> = { เช้า: "07–11", บ่าย: "11–15", เย็น: "15–19", ไพรม์: "19–23", ดึก: "23–07" };

const shortMonth = (key: string) => fmtMonthShort.format(new Date(`${key}-01T12:00:00Z`));
const baht = (n: number) => `฿${money(n)}`;
const pctText = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(1)}%`);
const perBaht = (x: number | null) => (x === null ? "-" : `฿${x.toFixed(1)}`);
const ratio = (a: number, b: number) => (b ? a / b : null);

type Row = { key: string; label: string; slots: number; hours: number; cost: number; gmv: number; estHours: number };

function groupBy(cells: CostCell[], dim: Dim): Row[] {
  const m = new Map<string, Row>();
  for (const c of cells) {
    const key = c[dim];
    const r = m.get(key) ?? { key, label: dim === "band" ? `${key} ${BAND_TIME[key] ?? ""}` : key, slots: 0, hours: 0, cost: 0, gmv: 0, estHours: 0 };
    r.slots += c.slots; r.hours += c.hours; r.cost += c.cost; r.gmv += c.gmv; r.estHours += c.estHours;
    m.set(key, r);
  }
  const rows = [...m.values()];
  // ช่วงเวลาเรียงตามเวลา · อย่างอื่นเรียงตามค่าจ้าง (งบไปที่ไหนมากที่สุด)
  return dim === "band" ? rows.sort((a, b) => BANDS.indexOf(a.key as never) - BANDS.indexOf(b.key as never)) : rows.sort((a, b) => b.cost - a.cost);
}

export function McCostView({ month }: { month: string }) {
  const saved = useLocal(DIM_KEY);
  const dim: Dim = DIMS.some(([k]) => k === saved) ? (saved as Dim) : "band";
  const [sort, setSort] = useState<SortState>(null);
  const [state, setState] = useState<{ month: string; report?: CostReport; error?: string }>({ month: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ report: CostReport }>(`/api/live-stats/cost?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) setState({ month, report: res.report });
      })
      .catch((err) => { if (alive) setState({ month, error: (err as Error).message }); });
    return () => { alive = false; };
  }, [month, attempt]);

  const r = state.month === month ? state.report : undefined;
  if (!r) {
    return state.month === month && state.error ? <LoadError title="โหลดความคุ้มค่า Mc ไม่สำเร็จ" message={state.error} onRetry={() => setAttempt((n) => n + 1)} /> : <LoadingBlock />;
  }

  const total = r.cells.reduce((a, c) => ({ slots: a.slots + c.slots, hours: a.hours + c.hours, cost: a.cost + c.cost, gmv: a.gmv + c.gmv }), { slots: 0, hours: 0, cost: 0, gmv: 0 });
  const prevLabel = `${shortMonth(r.prevMonth)}${r.upTo ? ` 1–${Number(r.upTo.slice(8))}` : ""}`;
  const avg = ratio(total.cost, total.gmv);
  const rows = sortRows(groupBy(r.cells, dim), sort, (x, k) => {
    if (k === "label") return x.label;
    if (k === "pct") return ratio(x.cost, x.gmv);
    if (k === "roi") return ratio(x.gmv, x.cost);
    if (k === "costHr") return ratio(x.cost, x.hours);
    if (k === "gmvHr") return ratio(x.gmv, x.hours);
    return x[k as "hours" | "cost" | "gmv"];
  });
  const kpis = [
    { label: "ค่าจ้าง Mc (คิวที่มียอด)", value: total.cost, format: baht, delta: <ChangeText cur={total.cost} prev={r.prev.cost} suffix={`vs ${prevLabel}`} neutral /> },
    { label: "GMV ของคิวเหล่านี้", value: total.gmv, format: baht, delta: <ChangeText cur={total.gmv} prev={r.prev.gmv} suffix={`vs ${prevLabel}`} /> },
    {
      label: "ค่าจ้างต่อยอดขาย", value: avg, format: (n: number) => pctText(n),
      delta: <ChangeText cur={avg} prev={ratio(r.prev.cost, r.prev.gmv)} suffix={`vs ${prevLabel}`} goodDown />,
    },
    {
      label: "จ่ายค่าจ้าง ฿1 ได้ยอด", value: ratio(total.gmv, total.cost), format: (n: number) => perBaht(n),
      delta: <ChangeText cur={ratio(total.gmv, total.cost)} prev={ratio(r.prev.gmv, r.prev.cost)} suffix={`vs ${prevLabel}`} />,
    },
  ];

  return (
    <>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        ค่าจ้าง Mc (สูตรเดียวกับสรุปรายเดือน) เทียบยอดขายของคิวเดียวกัน · ไม่นับ Mc ประจำ{r.salaried ? ` (${r.salaried} คิว)` : ""}
        {r.upTo ? ` · เดือนนี้ยังไม่จบ นับคิวถึงตอนนี้ เทียบ ${prevLabel}` : ""}
        <br />ยอดต่อคิว = GMV ที่กรอกใน slot ก่อน ไม่มีใช้ยอดจากไฟล์ Export แบ่งตามนาที (≈ ค่าประมาณ)
      </p>
      {r.unknown.slots ? (
        <p className="mt-1 text-xs text-warning-foreground">
          ยังไม่นับ {r.unknown.slots} คิว (ค่าจ้าง {baht(r.unknown.cost)}) เพราะยังไม่มียอด — ยังไม่ได้กรอก GMV และยังไม่มีไฟล์ Export ของช่วงนั้น
        </p>
      ) : null}

      {!r.cells.length ? (
        <StateBox title="ยังไม่มีคิวที่มีทั้งค่าจ้างและยอดขายในเดือนนี้">ลองเลือกเดือนอื่น หรืออัปโหลดไฟล์ Export ของเดือนนี้ที่หน้าอัปโหลด</StateBox>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="min-w-0 bg-card px-3 py-2.5">
                <dt className="truncate text-xs text-muted-foreground">{k.label}</dt>
                <dd className="text-lg font-bold">{k.value === null ? "-" : <CountUp value={k.value} format={k.format} />}</dd>
                <dd className="mt-0.5 text-xs">{k.delta}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-xs text-muted-foreground">{total.slots.toLocaleString("th-TH")} คิว · {num(Math.round(total.hours * 100) / 100)} ชม.</p>

          <section className="my-4 rounded-2xl border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">แยกตาม{DIMS.find(([k]) => k === dim)![1]}</h2>
              <ToggleGroup
                type="single" spacing={1} value={dim} aria-label="แยกตาม"
                onValueChange={(v) => { if (v) { writeLocal(DIM_KEY, v); setSort(null); } }}
                className="flex-wrap rounded-full border bg-card p-1"
              >
                {DIMS.map(([id, text]) => (
                  <ToggleGroupItem key={id} value={id} className="rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!">
                    {text}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead k="label" label={DIMS.find(([k]) => k === dim)![1]} sort={sort} setSort={setSort} text className={STICKY_HEAD} />
                  <SortHead k="hours" label="ชม." sort={sort} setSort={setSort} className="px-2" />
                  <SortHead k="cost" label="ค่าจ้าง" sort={sort} setSort={setSort} className="px-2" />
                  <SortHead k="gmv" label="GMV" sort={sort} setSort={setSort} className="px-2" />
                  <SortHead k="costHr" label="ค่าจ้าง/ชม." sort={sort} setSort={setSort} className="px-2" />
                  <SortHead k="gmvHr" label="GMV/ชม." sort={sort} setSort={setSort} className="px-2" />
                  <SortHead k="pct" label="ค่าจ้าง/ยอด" sort={sort} setSort={setSort} className="px-2" />
                  <SortHead k="roi" label="จ่าย ฿1 ได้ยอด" sort={sort} setSort={setSort} className="px-2" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((x) => {
                  const p = ratio(x.cost, x.gmv), worse = avg !== null && p !== null && p > avg * 1.25;
                  const perHour = (n: number) => { const v = ratio(n, x.hours); return v === null ? "-" : baht(v); };
                  return (
                    <TableRow key={x.key}>
                      <TableCell className={cn(STICKY_CELL, "max-w-48 truncate font-medium")}>{x.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(Math.round(x.hours * 100) / 100)}</TableCell>
                      <TableCell className="text-right tabular-nums">{baht(x.cost)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {x.estHours / (x.hours || 1) > 0.5 ? <span className="text-muted-foreground" title="ยอดส่วนใหญ่ประมาณจากไฟล์ Export">≈</span> : null}{baht(x.gmv)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{perHour(x.cost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{perHour(x.gmv)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", worse && "font-semibold text-warning-foreground")}>{pctText(p)}</TableCell>
                      <TableCell className="text-right tabular-nums">{perBaht(ratio(x.gmv, x.cost))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableHead className={cn(STICKY_CELL, "font-semibold text-foreground")}>รวม</TableHead>
                  <TableCell className="text-right font-semibold tabular-nums">{num(Math.round(total.hours * 100) / 100)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{baht(total.cost)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{baht(total.gmv)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{total.hours ? baht(total.cost / total.hours) : "-"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{total.hours ? baht(total.gmv / total.hours) : "-"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{pctText(avg)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{perBaht(ratio(total.gmv, total.cost))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              ค่าจ้าง/ยอด = ค่าจ้าง/ชม. ÷ GMV/ชม. · จ่าย ฿1 ได้ยอด = GMV ÷ ค่าจ้าง (ตรงข้ามกับค่าจ้าง/ยอด)
              <br />ค่าจ้าง/ยอด สีส้ม = สูงกว่าค่าเฉลี่ยของเดือน ({pctText(avg)}) เกิน 25% · ≈ = ยอดส่วนใหญ่ประมาณจากไฟล์ Export · กดหัวคอลัมน์เพื่อเรียง
            </p>
          </section>
        </>
      )}
    </>
  );
}
