"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { Cell, ExportBook } from "@/lib/export";
import { instLabel, windowText, type CampCell, type CampInstance, type CampaignReport } from "@/lib/campaign";
import { aggregate, summarizeMc, type Agg, type Fit, type McCampaign } from "@/lib/campaign-fit";
import { monthKey, money, num } from "@/lib/format";
import { ExportMenu, SlidesMenu } from "@/components/ExportMenu";
import { bkkStamp } from "@/lib/live-export";
import { MonthPicker, rangeLabel, type MonthRange } from "@/components/MonthPicker";
import { LoadError, LoadingBlock, Notice, api } from "@/components/shared";
import { SortHead, sortRows, type SortState } from "@/components/SortHead";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * หน้า Campaign: ติดตามทีละรอบ (Pay Day ก.ย. / Pay Day ต.ค. / 9.9 / 10.10 …) + Mc แต่ละคนทำแคมเปญได้ดีแค่ไหน
 *   slot ที่ติดแท็กอื่น (CEO Live ฯลฯ) อยู่ในช่วงแคมเปญหลัก = นับเข้าแคมเปญหลัก / ไม่อยู่ = แคมเปญแยก (กฎใน src/lib/campaign.ts)
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (x: number | null | undefined) => (x == null ? "" : Math.round(x * 1000) / 10);

const FIT_CLASS: Record<Fit, string> = {
  "เหมาะขึ้นแคมเปญ": "border-success/40 bg-success/15 text-success",
  "ปกติ": "border-border bg-secondary text-muted-foreground",
  "ควรทบทวน": "border-destructive/40 bg-destructive/10 text-destructive",
  "ข้อมูลน้อย": "border-border text-muted-foreground",
  "ขัดกัน": "border-warning-border bg-warning text-warning-foreground",
};
const FIT_HINT: Record<Fit, string> = {
  "เหมาะขึ้นแคมเปญ": "ดัชนีแคมเปญ ≥ 105% และไลฟ์แคมเปญ ≥ 20 ชม.",
  "ปกติ": "ใกล้ 100% หรือข้อมูล 12–20 ชม.",
  "ควรทบทวน": "ดัชนีแคมเปญ < 95% และไลฟ์แคมเปญ ≥ 20 ชม.",
  "ข้อมูลน้อย": "ไลฟ์แคมเปญน้อยกว่า 12 ชม. ยังสรุปไม่ได้",
  "ขัดกัน": "ยอดที่กรอกใน slot กับยอดประมาณจาก Export ชี้คนละทาง (ฝั่งหนึ่ง ≥ 105% อีกฝั่ง < 95%) ต้องกรอกยอดเพิ่มก่อนตัดสิน",
};

function IdxText({ v, className }: { v: number | null | undefined; className?: string }) {
  if (v == null) return <span className="text-muted-foreground">–</span>;
  return <span className={cn("font-semibold tabular-nums", v >= 0.995 ? "text-success" : "text-destructive", className)}>{pct(v)}%</span>;
}

/** x เท่า เทียบวันปกติ */
const liftText = (v: number | null) => (v == null ? "–" : `${v.toFixed(2)} เท่า`);

// ---------- ส่งออก ----------

function campaignBook(r: CampaignReport, mcs: McCampaign[], cols: CampInstance[]): ExportBook {
  const cal: unknown[][] = [["แคมเปญ", "ประเภท", "เริ่ม", "จบ", "สถานะ", "แท็กที่นับรวม", "slot", "ชม. ตามแพลน", "ชม. ที่มียอด", "GMV (ใน slot ของ Mc)", "GMV/ชม.", "ดันยอด (เท่าของวันปกติ)", "รอบก่อนที่เทียบ", "GMV/ชม. รอบก่อน", "ดันยอดรอบก่อน (เท่า)"]];
  for (const i of [...r.instances].sort((a, b) => a.start.localeCompare(b.start))) {
    cal.push([
      instLabel(i), i.big ? "แคมเปญหลัก" : "แคมเปญแยก", i.start, i.end, i.status === "done" ? "จบแล้ว" : i.status === "live" ? "กำลังดำเนินอยู่" : "ยังไม่เริ่ม",
      i.tags.join(", "), i.slots, round2(i.plannedHours), round2(i.hours), round2(i.gmv), i.rate == null ? "" : round2(i.rate), i.lift == null ? "" : round2(i.lift),
      i.prevLabel ?? "", i.prevRate == null ? "" : round2(i.prevRate), i.prevLift == null ? "" : round2(i.prevLift),
    ]);
  }
  const mat: unknown[][] = [["Mc", ...cols.map((c) => `${instLabel(c)} ดัชนี (%)`), "ผ่าน / ทั้งหมด", "แคมเปญรวม: ชม.", "แคมเปญรวม: ดัชนี (%)", "วันปกติ: ดัชนี (%)", "ส่วนต่าง (จุด)", "ยอดที่กรอกจริง (%ของชม.)", "สรุป"]];
  for (const m of mcs) {
    mat.push([
      m.mc, ...cols.map((c) => { const a = m.perKey.get(c.key); return a && a.ratio !== null ? pct(a.ratio) : ""; }),
      m.total ? `${m.passed}/${m.total}` : "", round2(m.campaign.hours), pct(m.campaign.index), pct(m.normal.index), m.diff == null ? "" : Math.round(m.diff * 100),
      m.campaign.hours ? Math.round(m.campaign.exact * 100) : "", m.campaign.exact < 0.3 && m.fit !== "ข้อมูลน้อย" ? `${m.fit} (ประมาณ จากไฟล์ Export)` : m.fit,
    ]);
  }
  const names = new Map(r.instances.map((i) => [i.key, i]));
  const det: unknown[][] = [["Mc", "แคมเปญ", "ช่วง", "ชม.", "ดัชนี (%)", "ที่มายอด"]];
  for (const m of mcs) for (const [key, a] of m.perKey) {
    const i = names.get(key);
    if (!i || a.ratio === null) continue;
    det.push([m.mc, instLabel(i), windowText(i.start, i.end), round2(a.hours), pct(a.ratio), a.exact >= 0.7 ? "ยอดที่กรอกใน slot" : a.hE > 0 ? "ปนกัน (กรอกบางส่วน + ประมาณจาก Export)" : "ประมาณจาก Export"]);
  }
  return {
    title: `GLORY Campaign ${r.from} ถึง ${r.to}`,
    sheets: [
      { name: "ปฏิทินแคมเปญ", rows: cal as Cell[][] },
      { name: "Mc x แคมเปญ", rows: mat as Cell[][] },
      { name: "Mc รายแคมเปญ", rows: det as Cell[][] },
    ],
  };
}

// ---------- หน้าจอ ----------

export function CampaignView() {
  const [range, setRange] = useState<MonthRange>(() => ({ from: "2026-08", to: monthKey() > "2026-08" ? monthKey() : "2026-08" }));
  const key = `${range.from}|${range.to}`;
  const [cache, setCache] = useState<Record<string, CampaignReport>>({});
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const report = cache[key];
  const error = failed?.key === key ? failed.message : "";

  useEffect(() => {
    if (report) return;
    api<{ report: CampaignReport }>(`/api/owner/campaigns?from=${range.from}&to=${range.to}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        setCache((c) => ({ ...c, [key]: res.report }));
        setFailed(null);
      })
      .catch((err) => setFailed({ key, message: (err as Error).message }));
  }, [key, report, range.from, range.to, attempt]);

  const picker = (
    <div className="my-3 flex flex-wrap items-center gap-2">
      <MonthPicker mode="range" value={range} onChange={setRange} maxMonths={12} label={rangeLabel(range)} />
      <span className="text-xs text-muted-foreground">
        ติดตามทีละรอบ · ยอดจากไฟล์ Export ที่ตกใน slot ของ Mc (ตั้งแต่ ส.ค. 2026) · slot ที่ติดแท็กอื่นแต่อยู่ในช่วงแคมเปญหลัก (เช่น CEO Live ใน 10.10) นับรวมเข้าแคมเปญหลัก
      </span>
    </div>
  );
  if (!report) {
    return (
      <div className="pb-10">
        {picker}
        {error ? <LoadError title="โหลดข้อมูลแคมเปญไม่สำเร็จ" message={error} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} /> : <LoadingBlock />}
      </div>
    );
  }
  return <Loaded report={report} picker={picker} />;
}

function Loaded({ report, picker }: { report: CampaignReport; picker: React.ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);

  const { mcs, cols } = useMemo(() => {
    const byMc = new Map<string, CampCell[]>();
    for (const c of report.cells) byMc.set(c.mc, [...(byMc.get(c.mc) ?? []), c]);
    const has = new Set(report.cells.filter((c) => c.key).map((c) => c.key));
    return {
      mcs: [...byMc].map(([mc, cs]) => summarizeMc(mc, cs)).filter((m) => m.campaign.hours > 0),
      cols: report.instances.filter((i) => has.has(i.key)).sort((a, b) => a.start.localeCompare(b.start)),
    };
  }, [report]);
  const byKey = useMemo(() => {
    const m = new Map<string, { mc: string; agg: Agg }[]>();
    const names = new Set(report.cells.map((c) => c.mc));
    for (const key of new Set(report.cells.filter((c) => c.key).map((c) => c.key))) {
      const list = [...names].map((mc) => ({ mc, agg: aggregate(report.cells.filter((c) => c.mc === mc && c.key === key)) })).filter((x) => x.agg.hours >= 2 && x.agg.ratio !== null);
      m.set(key, list.sort((a, b) => b.agg.ratio! - a.agg.ratio!));
    }
    return m;
  }, [report]);

  const valueOf = (m: McCampaign, k: string): number | string | null => {
    if (k === "name") return m.mc;
    if (k === "hours") return m.campaign.hours;
    if (k === "camp") return m.campaign.index;
    if (k === "norm") return m.normal.index;
    if (k === "diff") return m.diff;
    if (k === "pass") return m.total ? m.passed / m.total : null;
    if (k === "fit") return ["เหมาะขึ้นแคมเปญ", "ปกติ", "ควรทบทวน", "ขัดกัน", "ข้อมูลน้อย"].indexOf(m.fit);
    if (k.startsWith("i:")) { const a = m.perKey.get(k.slice(2)); return a && a.ratio !== null ? a.ratio : null; }
    return null;
  };
  const rows = sortRows([...mcs].sort((a, b) => (b.campaign.index ?? -1) - (a.campaign.index ?? -1)), sort, valueOf);
  const upcoming = report.instances.filter((i) => i.status === "upcoming").length;

  return (
    <div className="pb-10">
      {picker}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="flex flex-wrap items-baseline gap-2 text-lg font-bold">
          ปฏิทินแคมเปญ
          <span className="text-xs font-normal text-muted-foreground">กดแถวเพื่อดูแยกช่อง และ Mc ที่ไลฟ์ในรอบนั้น</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <ExportMenu label="ส่งออก Campaign" size="sm" build={() => campaignBook(report, mcs, cols)} />
          <SlidesMenu
            label="สไลด์"
            title={`GLORY Campaign ${rangeLabel({ from: report.from, to: report.to })}`}
            build={async () => {
              const { buildCampaignDeck } = await import("@/lib/campaign-slides");
              return buildCampaignDeck({ rangeText: rangeLabel({ from: report.from, to: report.to }), exportedAt: bkkStamp(new Date().toISOString()), report, mcs, cols });
            }}
          />
        </div>
      </div>
      {!report.instances.length ? (
        <div className="mt-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">ไม่มี slot ที่ตั้ง Campaign ในช่วงนี้</div>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border bg-card">
          <Table className="min-w-[860px]">
            <TableHeader className="bg-secondary">
              <TableRow className="hover:bg-transparent">
                {[["แคมเปญ", true], ["ช่วงวัน", true], ["slot / ชม.", false], ["GMV", false], ["GMV/ชม.", false], ["ดันยอด", false], ["เทียบรอบก่อน", false]].map(([h, left]) => (
                  <th key={String(h)} className={cn("px-3 py-2 text-xs font-semibold text-muted-foreground", left ? "text-left" : "text-right")}>{h as string}</th>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.instances.map((i) => {
                const isOpen = open === i.key;
                const change = i.lift != null && i.prevLift != null && i.prevLift > 0 ? i.lift / i.prevLift - 1 : null;
                return (
                  <Fragment key={i.key}>
                    <TableRow
                      tabIndex={0}
                      aria-expanded={isOpen}
                      data-state={isOpen ? "selected" : undefined}
                      onClick={() => setOpen(isOpen ? null : i.key)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : i.key); } }}
                      className={cn("cursor-pointer data-[state=selected]:bg-secondary", i.status === "upcoming" && "text-muted-foreground")}
                    >
                      <TableCell className="px-3">
                        <ChevronRightIcon className={cn("mr-0.5 inline size-4 text-muted-foreground transition-transform", isOpen && "rotate-90 text-primary")} />
                        <b className="font-semibold">{instLabel(i)}</b>
                        {!i.big ? <Badge variant="outline" className="ml-1.5 text-[11px] text-muted-foreground" title="ไม่อยู่ในช่วงแคมเปญหลัก จึง track แยก">แยก</Badge> : null}
                        {i.tags.map((t) => <Badge key={t} variant="outline" className="ml-1 text-[11px]" title="slot ที่ติดแท็กนี้ในช่วงแคมเปญ นับรวมอยู่ในรอบนี้">+ {t}</Badge>)}
                        <span className={cn("ml-1.5 text-[11px]", i.status === "live" ? "font-semibold text-primary" : "text-muted-foreground")}>
                          {i.status === "done" ? "" : i.status === "live" ? "กำลังดำเนินอยู่" : "ยังไม่เริ่ม"}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 whitespace-nowrap">{windowText(i.start, i.end)}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">
                        {i.slots}<span className="text-muted-foreground"> / {num(round2(i.plannedHours))}</span>
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{i.hours ? money(i.gmv) : "–"}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{i.rate == null ? "–" : money(i.rate)}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums font-semibold">{liftText(i.lift)}</TableCell>
                      <TableCell className="px-3 text-right text-xs tabular-nums">
                        {i.prevLabel && i.prevLift != null && i.lift != null ? (
                          <>
                            <span className={cn("font-semibold", change != null && change >= 0 ? "text-success" : "text-destructive")}>
                              {change == null ? "" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change * 100).toFixed(1)}%`}
                            </span>
                            <span className="block text-muted-foreground">{i.prevLabel} {liftText(i.prevLift)}</span>
                          </>
                        ) : <span className="text-muted-foreground">{i.prevLabel ? "รอบก่อนยังไม่มียอด" : "–"}</span>}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="bg-secondary hover:bg-secondary">
                        <TableCell colSpan={7} className="px-3 pt-1 pb-3 pl-8 whitespace-normal">
                          {i.platforms.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {i.platforms.map((p) => (
                                <Badge key={p.platform} variant="outline" className="h-auto bg-card px-2.5 py-1 font-normal">
                                  <b className="font-semibold text-primary">{p.platform}</b>
                                  {` ฿${money(p.rate ?? 0)}/ชม. · ${num(round2(p.hours))} ชม. · ดันยอด ${liftText(p.lift)}`}
                                </Badge>
                              ))}
                            </div>
                          ) : <span className="text-xs text-muted-foreground">ยังไม่มียอดจากไฟล์ Export ในรอบนี้</span>}
                          {byKey.get(i.key)?.length ? (
                            <ul className="mt-2 space-y-1 text-xs">
                              {byKey.get(i.key)!.map((x) => (
                                <li key={x.mc} className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="w-28 font-semibold">{x.mc}</span>
                                  <span className="tabular-nums text-muted-foreground">{num(round2(x.agg.hours))} ชม.</span>
                                  <IdxText v={x.agg.ratio} />
                                  {x.agg.exact < 0.7 ? <span className="text-muted-foreground" title="ประมาณจากไฟล์ Export (แบ่งยอดไลฟ์ตามนาที)">≈ ประมาณ</span> : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
            <TableFooter className="bg-transparent">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="px-3 py-2 text-xs font-normal text-muted-foreground">
                  ดันยอด = GMV ÷ ยอดที่ slot เดียวกันควรได้ถ้าเป็นวันปกติ (ช่องและช่วงเวลาเดียวกัน) ·
                  วันปกติเฉลี่ย {report.normal.map((n) => `${n.platform} ฿${money(n.rate ?? 0)}/ชม.`).join(" · ") || "–"} ·
                  เทียบรอบก่อน: Pay Day กับ Pay Day รอบก่อน / วันเลขเบิ้ลกับวันเลขเบิ้ลรอบก่อน{upcoming ? ` · มี ${upcoming} รอบที่ยังไม่เริ่ม` : ""}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-bold">Mc × แคมเปญ</h2>
        <span className="text-xs text-muted-foreground">
          ดัชนี = ยอดจริง ÷ ค่าที่คาดหวังของ slot (ช่อง · แคมเปญ · ช่วงเวลา) · 100% ขึ้นไป = เหนือค่าที่คาดหวัง · ≈ = ประมาณจากไฟล์ Export (Mc ที่ไลฟ์ต่อกันในไลฟ์เดียวกันจะได้ยอดต่อชม.เท่ากัน) · ไม่มี ≈ = ยอดที่กรอกใน slot
        </span>
      </div>
      {!mcs.length ? (
        <div className="mt-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">ยังไม่มีข้อมูลที่คิดดัชนีได้ในช่วงนี้</div>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border bg-card">
          <Table className="min-w-[900px]">
            <TableHeader className="bg-secondary">
              <TableRow className="hover:bg-transparent">
                <SortHead k="name" label="Mc" text sort={sort} setSort={setSort} />
                {cols.map((c) => <SortHead key={c.key} k={`i:${c.key}`} label={instLabel(c)} sort={sort} setSort={setSort} />)}
                <SortHead k="hours" label="ชม. แคมเปญ" sort={sort} setSort={setSort} />
                <SortHead k="camp" label="แคมเปญรวม" sort={sort} setSort={setSort} />
                <SortHead k="norm" label="วันปกติ" sort={sort} setSort={setSort} />
                <SortHead k="diff" label="ส่วนต่าง" sort={sort} setSort={setSort} />
                <SortHead k="pass" label="ผ่านค่าที่คาดหวัง" sort={sort} setSort={setSort} />
                <SortHead k="fit" label="สรุป" sort={sort} setSort={setSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.mc}>
                  <TableCell className="px-3 font-semibold whitespace-nowrap">{m.mc}</TableCell>
                  {cols.map((c) => {
                    const a = m.perKey.get(c.key);
                    return (
                      <TableCell key={c.key} className="px-3 text-right tabular-nums">
                        {a && a.ratio !== null ? (
                          <span className={cn(a.hours < 4 && "opacity-50")} title={`${num(round2(a.hours))} ชม. · ${a.exact >= 0.7 ? "ยอดที่กรอกใน slot" : a.hE > 0 ? "กรอกบางส่วน + ประมาณจาก Export" : "ประมาณจากไฟล์ Export"}`}>
                            {a.exact < 0.7 ? <span className="mr-0.5 text-[11px] text-muted-foreground">≈</span> : null}
                            <IdxText v={a.ratio} />
                            <span className="block text-[11px] text-muted-foreground">{num(round2(a.hours))} ชม.</span>
                          </span>
                        ) : <span className="text-muted-foreground">–</span>}
                      </TableCell>
                    );
                  })}
                  <TableCell className="px-3 text-right tabular-nums">{num(round2(m.campaign.hours))}</TableCell>
                  <TableCell className="px-3 text-right" title="ดึงเข้าหา 100% ตามจำนวนชั่วโมง"><IdxText v={m.campaign.index} className="text-base" /></TableCell>
                  <TableCell className="px-3 text-right"><IdxText v={m.normal.index} /></TableCell>
                  <TableCell className={cn("px-3 text-right tabular-nums", m.diff != null && (m.diff >= 0 ? "text-success" : "text-destructive"))}>
                    {m.diff == null ? <span className="text-muted-foreground">–</span> : `${m.diff >= 0 ? "+" : ""}${Math.round(m.diff * 100)} จุด`}
                  </TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{m.total ? `${m.passed}/${m.total} รอบ` : <span className="text-muted-foreground">–</span>}</TableCell>
                  <TableCell className="px-3 text-right">
                    <span
                      className={cn("inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", FIT_CLASS[m.fit])}
                      title={`${FIT_HINT[m.fit]}${m.campaign.exact < 0.3 ? " · ส่วนใหญ่ (ยอดที่กรอกใน slot น้อยกว่า 30%) ประมาณจากไฟล์ Export" : ""}`}
                    >
                      {m.campaign.exact < 0.3 && m.fit !== "ข้อมูลน้อย" ? "≈ " : ""}{m.fit}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
            ผ่านค่าที่คาดหวัง = นับรอบที่ไลฟ์ ≥ 4 ชม. และดัชนี ≥ 100% · ป้ายสรุป: เหมาะขึ้นแคมเปญ = ดัชนีรวม ≥ 105% และ ≥ 20 ชม. · ควรทบทวน = &lt; 95% และ ≥ 20 ชม. · ข้อมูลน้อย = &lt; 12 ชม. · ขัดกัน = ยอดที่กรอกกับยอดประมาณชี้คนละทาง
          </div>
        </div>
      )}
      <Notice className="mt-3">
        ตัดสินใจเรื่อง &quot;ใครควรขึ้นแคมเปญ&quot; ควรดูควบคู่กับยอดที่กรอกจริงใน slot (ไม่มี ≈) เพราะตัวเลข ≈ มาจากไฟล์ Export ที่ไม่แยกว่า Mc คนไหนทำยอดในไลฟ์ที่ต่อกันหลายคน · ไม่มีข้อมูลงบโฆษณาและสินค้าที่ขายในแต่ละ slot ผลจึงเป็นผลลัพธ์ GMV ไม่ใช่ฝีมืออย่างเดียว
      </Notice>
    </div>
  );
}
