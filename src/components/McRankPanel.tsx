"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { BANDS, windowText } from "@/lib/campaign";
import type { Cell, ExportBook } from "@/lib/export";
import { monthKey, monthLabel, money, num } from "@/lib/format";
import { useLocal, writeLocal } from "@/lib/hooks";
import { bkkStamp } from "@/lib/live-export";
import { MIN_RANK_HOURS, rankCells, type McRank, type RankPart, type RankPeriod, type RankReport, type Tier } from "@/lib/mc-rank";
import { cn } from "@/lib/utils";
import { ExportMenu, SlidesMenu } from "@/components/ExportMenu";
import { LoadError, LoadingBlock, MonthNav, Notice, api } from "@/components/shared";
import { SortHead, sortRows, STICKY_CELL, STICKY_HEAD, type SortState } from "@/components/SortHead";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const round2 = (n: number) => Math.round(n * 100) / 100;
// อันดับ Mc: GMV/ชม. เทียบ "ค่าที่คาดหวังของ slot นั้น" (ช่อง x แคมเปญ x ช่วงเวลา) ตามช่วงที่เลือก — src/lib/mc-rank.ts
const pct = (x: number | null | undefined) => (x == null ? "" : Math.round(x * 1000) / 10);
const TIER_TEXT: Record<Tier, string> = { A: "เหนือเกณฑ์", B: "ใกล้เกณฑ์", C: "ต่ำกว่าเกณฑ์" };
const TIER_CLASS: Record<Tier, string> = {
  A: "border-success/40 bg-success/15 text-success",
  B: "border-border bg-secondary text-muted-foreground",
  C: "border-destructive/40 bg-destructive/10 text-destructive",
};
const RANK_PERIOD_KEY = "glory_rank_period";
const RANK_PERIODS: [RankPeriod, string][] = [["month", "เดือนที่เลือก"], ["30", "30 วันล่าสุด"], ["90", "90 วันล่าสุด"]];

const periodText = (r: RankReport) => (r.period === "month" ? monthLabel(r.month) : `${r.period} วันล่าสุด (${windowText(r.from, r.to)})`);
const prevPeriodText = (r: RankReport) => (r.period === "month" ? monthLabel(monthKey(-1, r.month)) : `${r.period} วันก่อนหน้า`);
/** undefined = ช่วงก่อนไม่มีข้อมูลให้เทียบ (ไม่แสดง) / null = ไม่มีอันดับในช่วงก่อน */
const moveText = (m: number | null | undefined) => (m === undefined ? "" : m === null ? "ใหม่" : m > 0 ? `▲${m}` : m < 0 ? `▼${-m}` : "–");

/** สถานะช่วงที่ยังไม่จบ (เดือนนี้): ไลฟ์ไปแล้วกี่ชั่วโมง / แคมเปญที่ยังไม่เริ่ม */
function partialNote(r: RankReport) {
  if (!r.partial || r.period !== "month") return "";
  const p = r.progress;
  const waiting = p.campaigns.filter((c) => c.past < c.total).map((c) => (c.past ? `${c.label} ${num(c.past)}/${num(c.total)} ชม.` : `${c.label} ยังไม่เริ่ม (${num(c.total)} ชม.)`));
  return `ไลฟ์ไปแล้ว ${num(Math.round(p.past))}/${num(Math.round(p.total))} ชม. (${p.total ? Math.round((p.past / p.total) * 100) : 0}%) · กรอกยอดแล้ว ${num(Math.round(p.entered))} ชม.${waiting.length ? ` · ${waiting.join(" · ")}` : ""}`;
}

function rankBook(r: RankReport, rows: McRank[], moves: Map<string, number | null>): ExportBook {
  const partCells = (p: RankPart | null) => (p ? [round2(p.hours), round2(p.perHour), pct(p.index)] : ["", "", ""]);
  const ranking: unknown[][] = [[
    "อันดับ", `เทียบ${prevPeriodText(r)}`, "ระดับ", "Mc", "ชม. ที่มียอด", "GMV", "GMV/ชม.",
    "แคมเปญ: ชม.", "แคมเปญ: GMV/ชม.", "แคมเปญ: ดัชนี (%)", "วันปกติ: ชม.", "วันปกติ: GMV/ชม.", "วันปกติ: ดัชนี (%)",
    "คะแนนรวม (%)", "ความมั่นใจ", "ยอดที่กรอกจริง (% ของชม.)", "หมายเหตุ",
  ]];
  for (const x of rows) {
    ranking.push([
      x.rank ?? "", x.ranked ? moveText(moves.size ? moves.get(x.name) ?? null : undefined) : "", x.tier ? `${x.tier} ${TIER_TEXT[x.tier]}` : "", x.name, round2(x.hours), round2(x.gmv), round2(x.perHour),
      ...partCells(x.campaign), ...partCells(x.normal), pct(x.score), x.confidence, Math.round(x.exact * 100),
      x.ranked ? "" : `ข้อมูลน้อย (ต่ำกว่า ${MIN_RANK_HOURS} ชม.) ยังไม่จัดอันดับ`,
    ]);
  }
  const expect: unknown[][] = [["แคมเปญ", "ช่อง", "จำนวน slot", ...BANDS.map((b) => `${b} (GMV/ชม.)`)]];
  for (const e of r.expect) expect.push([e.label, e.platform, e.slots, ...BANDS.map((b) => (e.rates[b] == null ? "" : Math.round(e.rates[b]!)))]);
  const detail: unknown[][] = [["Mc", "แคมเปญ", "ช่อง", "ชม.", "GMV", "GMV/ชม.", "ที่คาดหวัง GMV/ชม.", "ดัชนี (%)", "ที่มายอด"]];
  for (const x of rows) for (const c of [...(x.campaign?.cells ?? []), ...(x.normal?.cells ?? [])]) {
    detail.push([x.name, c.label, c.platform, round2(c.hours), round2(c.gmv), round2(c.gmv / c.hours), round2(c.expected / c.hours), pct(c.actual / c.expected),
      c.exact >= 0.7 ? "ยอดที่กรอกใน slot" : c.exact > 0 ? "กรอกบางส่วน + ประมาณจาก Export" : "ประมาณจากไฟล์ Export"]);
  }
  const note = partialNote(r);
  return {
    title: `GLORY อันดับ Mc ${periodText(r)}`,
    sheets: [
      { name: "อันดับ Mc", rows: [...(note ? [[`อันดับชั่วคราว: ${note}`], []] : []), ...ranking] as Cell[][] },
      { name: "ค่าที่คาดหวัง", rows: expect as Cell[][] },
      { name: "รายแคมเปญ", rows: detail as Cell[][] },
    ],
  };
}

/** ดัชนี (% เทียบค่าที่คาดหวัง): เขียว = 100% ขึ้นไป แดง = ต่ำกว่า */
function IndexText({ index, className }: { index: number | null | undefined; className?: string }) {
  if (index == null) return <span className="text-muted-foreground">–</span>;
  return <span className={cn("font-semibold tabular-nums", index >= 0.995 ? "text-success" : "text-destructive", className)}>{pct(index)}%</span>;
}

function PartCell({ part }: { part: RankPart | null }) {
  return (
    <TableCell className="px-3 text-right tabular-nums">
      {part ? (
        <span title={`ก่อนดึงเข้าหา 100%: ${pct(part.ratio)}%`}>
          <IndexText index={part.index} />
          <span className="block text-[11px] text-muted-foreground">฿{money(part.perHour)}/ชม. · {num(round2(part.hours))} ชม.</span>
        </span>
      ) : <span className="text-muted-foreground">–</span>}
    </TableCell>
  );
}

const RANK_COLS: [string, string][] = [["hours", "ชม. ที่มียอด"], ["gmv", "GMV"], ["perHour", "GMV/ชม."], ["campaign", "แคมเปญ"], ["normal", "วันปกติ"], ["score", "คะแนนรวม"]];

export function McRankPanel() {
  const [month, setMonth] = useState(() => monthKey());
  const saved = useLocal(RANK_PERIOD_KEY);
  const period: RankPeriod = saved === "month" || saved === "30" ? saved : "90";
  // 30 / 90 วันล่าสุด ไม่ขึ้นกับเดือนที่เลือก
  const key = period === "month" ? `month|${month}` : period;
  const [cache, setCache] = useState<Record<string, RankReport>>({});
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [excludeCeo, setExcludeCeo] = useState(false);
  const report = cache[key];
  const error = failed?.key === key ? failed.message : "";

  useEffect(() => {
    if (report) return;
    api<{ report: RankReport }>(`/api/owner/rank?period=${period}&month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        setCache((c) => ({ ...c, [key]: res.report }));
        setFailed(null);
      })
      .catch((err) => setFailed({ key, message: (err as Error).message }));
  }, [key, report, period, month, attempt]);

  const all = useMemo(() => (report ? rankCells(report.cells, { excludeCeo }) : []), [report, excludeCeo]);
  const moves = useMemo(() => {
    const prev = new Map(report ? rankCells(report.prevCells, { excludeCeo }).filter((x) => x.ranked).map((x) => [x.name, x.rank!]) : []);
    // ช่วงก่อนไม่มีใครมีอันดับ (เช่น ก่อน ส.ค. 2026 ยังไม่มีข้อมูลรายไลฟ์) = ไม่เทียบ ไม่แสดงลูกศร
    if (!prev.size) return new Map<string, number | null>();
    return new Map(all.map((x) => [x.name, x.rank != null && prev.has(x.name) ? prev.get(x.name)! - x.rank : null]));
  }, [report, all, excludeCeo]);

  const valueOf = (r: McRank, k: string): number | string | null => {
    switch (k) {
      case "rank": return r.rank;
      case "name": return r.name;
      case "hours": return r.hours;
      case "gmv": return r.gmv;
      case "perHour": return r.perHour;
      case "campaign": return r.campaign?.index ?? null;
      case "normal": return r.normal?.index ?? null;
      case "score": return r.score;
      default: return null;
    }
  };
  const rows = sortRows(all, sort, valueOf);
  const hasNames = new Set(all.map((r) => r.name));
  const none = report ? Object.entries(report.progress.perMc).filter(([n, p]) => p.past > 0 && !hasNames.has(n)).map(([n]) => n) : [];
  const note = report ? partialNote(report) : "";
  const exact = (() => {
    const h = all.reduce((a, r) => a + r.hours, 0);
    return h ? all.reduce((a, r) => a + r.exact * r.hours, 0) / h : 0;
  })();

  return (
    <section className="mt-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 className="flex flex-wrap items-baseline gap-2 text-lg font-bold">
          อันดับ Mc
          <span className="text-xs font-normal text-muted-foreground">
            GMV/ชม. เทียบค่าที่คาดหวังของ slot แบบเดียวกัน (ช่อง · แคมเปญ · ช่วงเวลา) · คะแนนรวม = แคมเปญ 50% + วันปกติ 50% · 100% ขึ้นไป = เหนือค่าที่คาดหวัง
          </span>
        </h2>
        {report && all.length ? (
          <div className="flex flex-wrap gap-2">
            <ExportMenu label="อันดับ Mc" size="sm" build={() => rankBook(report, all, moves)} />
            <SlidesMenu
              label="สไลด์"
              title={`GLORY อันดับ Mc ${periodText(report)}`}
              build={async () => {
                const { buildRankDeck } = await import("@/lib/campaign-slides");
                return buildRankDeck({
                  periodText: periodText(report), prevText: prevPeriodText(report), partialNote: note, exactShare: exact,
                  exportedAt: bkkStamp(new Date().toISOString()), rows: all, moves, expect: report.expect, excludeCeo,
                });
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single" spacing={1} value={period}
          onValueChange={(v) => { if (v) writeLocal(RANK_PERIOD_KEY, v); }}
          aria-label="ช่วงที่ใช้จัดอันดับ" className="rounded-full border bg-card p-1"
        >
          {RANK_PERIODS.map(([id, text]) => (
            <ToggleGroupItem key={id} value={id} className="rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!">
              {id === "month" ? `${text} (${monthLabel(month)})` : text}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {report ? (
          <span className="text-xs text-muted-foreground">
            {periodText(report)} · {moves.size ? `เทียบอันดับกับ${prevPeriodText(report)}` : `${prevPeriodText(report)}ยังไม่มีข้อมูลรายไลฟ์ให้เทียบอันดับ`}{all.length ? ` · ยอดที่กรอกจริง ${Math.round(exact * 100)}% ของชั่วโมง ที่เหลือ ≈ ประมาณจากไฟล์ Export` : ""}
            {report.from < "2026-08-01" ? " · ข้อมูล Export รายไลฟ์มีตั้งแต่ 1 ส.ค. 2026" : ""}
          </span>
        ) : null}
      </div>
      {period === "month" ? <MonthNav label={monthLabel(month)} onPrev={() => setMonth(monthKey(-1, month))} onNext={() => setMonth(monthKey(1, month))} /> : null}
      {note ? (
        <Notice variant="warning" title={`อันดับชั่วคราว: ${monthLabel(report!.month)} ยังไม่จบเดือน`} className="mb-2">
          {note} · ดูภาพรวมที่ &quot;90 วันล่าสุด&quot; ได้
        </Notice>
      ) : null}
      {!report ? (
        error ? <LoadError title="โหลดอันดับไม่สำเร็จ" message={error} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} /> : <LoadingBlock className="h-32" />
      ) : !all.length ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          ยังไม่มียอดที่คิดคะแนนได้ในช่วงนี้ (ไฟล์ Export รายไลฟ์มีตั้งแต่ ส.ค. 2026 · ยอดที่กรอกใน slot มีตั้งแต่ ต.ค. 2026)
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="min-w-[780px]">
            <TableHeader className="bg-secondary">
              <TableRow className="hover:bg-transparent">
                <SortHead k="rank" label="#" sort={sort} setSort={setSort} text className="w-14" />
                <SortHead k="name" label="Mc" text sort={sort} setSort={setSort} className={STICKY_HEAD} />
                {RANK_COLS.map(([k, h]) => <SortHead key={k} k={k} label={h} sort={sort} setSort={setSort} />)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isOpen = open === r.name;
                const cells = [...(r.campaign?.cells ?? []), ...(r.normal?.cells ?? [])];
                const mv = moves.get(r.name);
                const prog = report.period === "month" && report.partial ? report.progress.perMc[r.name] : undefined;
                return (
                  <Fragment key={r.name}>
                    <TableRow
                      tabIndex={0}
                      aria-expanded={isOpen}
                      data-state={isOpen ? "selected" : undefined}
                      onClick={() => setOpen(isOpen ? null : r.name)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : r.name); } }}
                      className={cn("cursor-pointer data-[state=selected]:bg-secondary", !r.ranked && "text-muted-foreground")}
                    >
                      <TableCell className="px-3 tabular-nums">
                        <b>{r.rank ?? "–"}</b>
                        {r.ranked && moveText(mv) ? (
                          <span
                            className={cn("block text-[11px] font-semibold", mv == null ? "text-primary" : mv > 0 ? "text-success" : mv < 0 ? "text-destructive" : "text-muted-foreground")}
                            title={mv == null ? `ไม่มีอันดับใน${prevPeriodText(report)}` : `เทียบ${prevPeriodText(report)}`}
                          >
                            {moveText(mv)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className={cn("px-3", STICKY_CELL)}>
                        <ChevronRightIcon className={cn("mr-0.5 inline size-4 text-muted-foreground transition-transform", isOpen && "rotate-90 text-primary")} />
                        {r.name}
                        {!r.ranked ? (
                          <Badge variant="outline" className="ml-1.5 text-[11px] text-muted-foreground" title={`ต้องมียอด GMV อย่างน้อย ${MIN_RANK_HOURS} ชม. ถึงเข้าอันดับ`}>
                            ข้อมูลน้อย (&lt; {MIN_RANK_HOURS} ชม.)
                          </Badge>
                        ) : null}
                        {r.exact < 0.3 ? <span className="ml-1.5 text-[11px] text-muted-foreground" title="ยอดส่วนใหญ่ประมาณจากไฟล์ Export (ยอดที่กรอกใน slot น้อยกว่า 30% ของชั่วโมง)">≈</span> : null}
                        {prog ? <span className="block pl-5 text-[11px] text-muted-foreground">ไลฟ์ไปแล้ว {num(round2(prog.past))}/{num(round2(prog.total))} ชม.</span> : null}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{num(round2(r.hours))}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{money(r.gmv)}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{money(r.perHour)}</TableCell>
                      <PartCell part={r.campaign} />
                      <PartCell part={r.normal} />
                      <TableCell className="px-3 text-right">
                        {r.score === null || !r.tier ? <span className="text-muted-foreground">–</span> : (
                          <>
                            <IndexText index={r.score} className="text-base" />
                            <span className="mt-0.5 flex items-center justify-end gap-1">
                              <span className={cn("rounded-full border px-1.5 text-[11px] font-bold", TIER_CLASS[r.tier])} title={TIER_TEXT[r.tier]}>{r.tier}</span>
                              <span className="text-[11px] text-muted-foreground" title="ความมั่นใจตามจำนวนชั่วโมงที่มียอด">มั่นใจ{r.confidence}</span>
                            </span>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="bg-secondary hover:bg-secondary">
                        <TableCell colSpan={8} className="px-3 pt-1 pb-3 pl-8 whitespace-normal">
                          <ul className="space-y-1 text-xs">
                            {cells.map((c) => (
                              <li key={c.key} className="flex flex-wrap items-baseline gap-x-2">
                                <b className={cn("font-semibold", c.label !== "วันปกติ" && "text-primary")}>{c.label}</b>
                                <span className="text-muted-foreground">{c.platform}</span>
                                <span className="tabular-nums">
                                  {num(round2(c.hours))} ชม. · ฿{money(c.gmv / c.hours)}/ชม. (คาดหวัง ฿{money(c.expected / c.hours)}/ชม.)
                                </span>
                                <IndexText index={c.actual / c.expected} />
                                {c.exact < 0.7 ? <span className="text-muted-foreground">≈ ประมาณ</span> : null}
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={excludeCeo} onChange={(e) => setExcludeCeo(e.target.checked)} className="size-3.5 accent-primary" />
              ไม่นับ slot ที่มี CEO ไลฟ์ในคะแนนรายคน (ค่าเริ่มต้น = นับ)
            </label>
            <span>
              ระดับ A ≥ 110% · B 95–110% · C &lt; 95% · ข้อมูลน้อยถูกดึงเข้าหา 100% · ≈ = ประมาณจากไฟล์ Export
              {report.skipped ? ` · ข้าม ${report.skipped} หน่วยที่ไม่มีค่าเทียบ` : ""}
            </span>
          </div>
          <details className="border-t px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold">ค่าที่คาดหวัง GMV/ชม. แยกแคมเปญ · ช่อง · ช่วงเวลา ({report.expect.length} กลุ่ม)</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1 pr-2 text-left font-semibold">แคมเปญ</th>
                    <th className="py-1 pr-2 text-left font-semibold">ช่อง</th>
                    <th className="py-1 pl-2 text-right font-semibold">slot</th>
                    {BANDS.map((b) => <th key={b} className="py-1 pl-2 text-right font-semibold">{b}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {report.expect.map((e) => (
                    <tr key={`${e.label}|${e.platform}`} className="border-b last:border-0">
                      <td className={cn("py-1 pr-2", e.label !== "วันปกติ" && "font-semibold text-primary")}>{e.label}</td>
                      <td className="py-1 pr-2">{e.platform}</td>
                      <td className="py-1 pl-2 text-right tabular-nums">{e.slots}</td>
                      {BANDS.map((b) => (
                        <td key={b} className="py-1 pl-2 text-right tabular-nums">{e.rates[b] == null ? <span className="text-muted-foreground">–</span> : money(e.rates[b]!)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted-foreground">
                ค่าที่คาดหวัง = GMV/ชม. เฉลี่ยของ slot แบบเดียวกันจากทุกไลฟ์ในไฟล์ Export ย้อนหลังไม่เกิน 120 วัน (ไม่ใช่ยอดที่กรอกรายคน) · ช่วงเวลา: เช้า 07–11 · บ่าย 11–15 · เย็น 15–19 · ไพรม์ 19–23 · ดึก 23–07 · &quot;–&quot; = กลุ่มนั้นมี slot น้อยกว่า 6 ใช้ค่ากลุ่มกว้างกว่าแทน/เทียบไม่ได้
              </p>
            </div>
          </details>
        </div>
      )}
      {none.length ? <p className="mt-2 text-xs text-muted-foreground">ไลฟ์แล้วแต่ยังไม่มียอดที่คิดคะแนนได้: {none.join(", ")}</p> : null}
    </section>
  );
}
