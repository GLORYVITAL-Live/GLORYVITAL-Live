"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fmtMonthLong, fmtMonthShort, monthKey } from "@/lib/format";
import {
  ROI_NOTE, achieveOf, baht, costPerHour, gmvPerHour, hrsText, peopleByRoi, pctText, roiOf, roiText, sumMonths,
  type TiktokMcMonth, type TiktokMcPeople,
} from "@/lib/tiktok-mc-calc";
import { BarChart, TableView } from "@/components/LiveCharts";
import { ExportMenu, SlidesMenu } from "@/components/ExportMenu";
import { LoadError, LoadingBlock, MonthNav, Notice, api } from "@/components/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * ผลงาน Mc > สรุป Mc TikTok (ทีมเรา) — ผู้ใช้ขอ 2026-11-26 ให้คนดูแล Mc TikTok กับเจ้าของดึงสไลด์ present ได้
 *   ค่าจ้าง Mc รายเดือน (ภาพรวมทั้งปี) · GMV ของเรา + ROI · ชั่วโมงไลฟ์ + ต้นทุนต่อชั่วโมง · % เป้า GMV TikTok · ROI ราย Mc
 *   สูตร / ที่มาของตัวเลข: src/lib/tiktok-mc-calc.ts · เห็นได้ตาม src/lib/tiktok-mc.ts tiktokMcAccess
 */

const monText = (m: string) => fmtMonthLong.format(new Date(`${m}-01T12:00:00Z`));
const monShort = (m: string) => `${fmtMonthShort.format(new Date(`${m}-01T12:00:00Z`))} ${m.slice(2, 4)}`;
const compact = (v: number) => (v >= 1_000_000 ? `฿${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : v >= 1_000 ? `฿${Math.round(v / 1_000)}K` : `฿${Math.round(v)}`);
const stampNow = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const FIRST_YEAR = 2026;

/** แท็บนี้เห็นได้ไหม (ซ่อนแท็บถ้าไม่มีสิทธิ์) */
export function useTiktokMcAccess() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ allowed: boolean }>("/api/owner/tiktok-mc?access=1").then((res) => { if (alive && res.ok) setAllowed(res.allowed); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return allowed;
}

export function TiktokMcPanel() {
  const thisMonth = monthKey();
  const [year, setYear] = useState(thisMonth.slice(0, 4));
  const [month, setMonth] = useState(thisMonth);
  const [months, setMonths] = useState<{ year: string; list: TiktokMcMonth[] } | null>(null);
  const [people, setPeople] = useState<TiktokMcPeople | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ months: TiktokMcMonth[] }>(`/api/owner/tiktok-mc?year=${year}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setMonths({ year, list: res.months }); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [year, tick]);
  useEffect(() => {
    let alive = true;
    api<{ people: TiktokMcPeople }>(`/api/owner/tiktok-mc?month=${month}`)
      .then((res) => { if (alive && res.ok) setPeople(res.people); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [month, tick]);

  const years = Array.from({ length: Number(thisMonth.slice(0, 4)) - FIRST_YEAR + 1 }, (_, i) => String(FIRST_YEAR + i)).reverse();
  const list = months?.year === year ? months.list : null;
  const shownPeople = people?.month === month ? people : null;
  const goMonth = (by: number) => {
    const next = monthKey(by, month);
    if (next.startsWith(year) && next <= thisMonth) setMonth(next);
  };
  const pickYear = (y: string) => {
    setYear(y);
    setMonth(y === thisMonth.slice(0, 4) ? thisMonth : `${y}-12`);
  };

  return (
    <div className="mt-4 max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">สรุป Mc TikTok (ทีมเรา)</h2>
        <Select value={year} onValueChange={pickYear}>
          <SelectTrigger aria-label="เลือกปี" className="h-9 w-28 rounded-full bg-card"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">{years.map((y) => <SelectItem key={y} value={y}>ปี {y}</SelectItem>)}</SelectContent>
        </Select>
        {list ? (
          <span className="ml-auto flex flex-wrap gap-2">
            <SlidesMenu
              label="สไลด์" title={`GLORY สรุป Mc TikTok ปี ${year}`} variant="default"
              build={async () => (await import("@/lib/tiktok-mc-slides")).buildTiktokMcDeck({ year, months: list, people: shownPeople, exportedAt: stampNow() })}
            />
            <ExportMenu label="ไฟล์ตัวเลข" size="sm" build={async () => (await import("@/lib/tiktok-mc-slides")).tiktokMcBook({ year, months: list, people: shownPeople })} />
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{ROI_NOTE} · สไลด์ใช้ราย Mc ของเดือนที่เลือกด้านล่าง</p>

      {!list ? (error ? <LoadError title="โหลดสรุป Mc TikTok ไม่สำเร็จ" message={error} onRetry={() => setTick((n) => n + 1)} /> : <LoadingBlock className="h-64" />) : (
        <YearView list={list} />
      )}

      <Section
        title="ROI ราย Mc"
        note="ค่าจ้างจากระบบ (ต่อคิว) · GMV = ยอดที่กรอกใน slot / ประมาณจากไฟล์ Export · ไม่รวม Mc ประจำ (ไม่มีค่าจ้างรายชั่วโมง)"
      >
        <MonthNav label={monText(month)} onPrev={() => goMonth(-1)} onNext={() => goMonth(1)} />
        {!shownPeople ? <LoadingBlock className="h-40" /> : <PeopleTable data={shownPeople} />}
      </Section>
    </div>
  );
}

function YearView({ list }: { list: TiktokMcMonth[] }) {
  const ytd = sumMonths(list);
  const cats = list.map((m) => monShort(m.month));
  const titles = list.map((m) => monText(m.month) + (m.open ? " (ยังไม่จบ)" : ""));
  const hatched = list.map((m) => m.open);
  const salariedNote = list.some((m) => m.source === "system" && m.salariedHours > 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Kpi label="ค่าจ้าง Mc ทั้งปี" value={baht(ytd.cost)} sub={`${list.length} เดือน${ytd.open ? " · เดือนล่าสุดยังไม่จบ" : ""}`} big />
        <Kpi label="GMV ของเรา" value={baht(ytd.gmv)} sub="ไม่รวมช่วงไลฟ์ของ Agency" big />
        <Kpi label="ROI" value={roiText(roiOf(ytd.gmv, ytd.cost))} sub="ค่าจ้าง ฿1 ได้ยอดขายกี่บาท" big />
        <Kpi label="ชั่วโมงไลฟ์" value={hrsText(Math.round(ytd.hours))} sub={`${ytd.slots.toLocaleString("th-TH")} คิว`} />
        <Kpi label="ต้นทุนต่อชั่วโมง" value={baht(costPerHour(ytd))} sub={`GMV ${baht(gmvPerHour(ytd))}/ชม.`} />
        <Kpi label="% เป้า GMV TikTok" value={pctText(achieveOf(ytd))} sub={ytd.target ? `เป้า ${compact(ytd.target)} · ทำได้ ${compact(ytd.targetGmv ?? 0)}` : "ยังไม่ได้ตั้งเป้า"} />
      </div>
      {salariedNote ? (
        <Notice>เดือนที่ใช้ตัวเลขระบบ (ทีมยังไม่กรอกยอดจริงในชีต Sum 2): ค่าจ้าง Mc ประจำยังไม่อยู่ในยอด · ต้นทุนต่อชั่วโมงจึงหารเฉพาะชั่วโมงที่มีค่าจ้าง</Notice>
      ) : null}

      <Section title="ค่าจ้าง Mc รายเดือน" note="แท่งลายทแยง = เดือนที่ยังไม่จบ (นับถึงไลฟ์ล่าสุดในไฟล์ Export)">
        <BarChart label="ค่าจ้าง Mc รายเดือน" categories={cats} tooltipTitles={titles} hatched={hatched} format={baht} formatAxis={compact}
          series={[{ name: "ค่าจ้าง Mc", color: "var(--viz-cur)", values: list.map((m) => m.cost) }]} />
      </Section>

      <Section title="GMV ของเรา และ ROI">
        <BarChart label="GMV ของเรา" categories={cats} tooltipTitles={titles} hatched={hatched} format={baht} formatAxis={compact} height={180}
          series={[{ name: "GMV ของเรา", color: "var(--viz-cur)", values: list.map((m) => m.gmv) }]}
          extra={(i) => <span className="text-muted-foreground">ROI {roiText(roiOf(list[i].gmv, list[i].cost))}</span>} />
        <BarChart label="ROI รายเดือน" categories={cats} tooltipTitles={titles} hatched={hatched} height={150}
          format={(v) => (v === null ? "-" : roiText(v))} formatAxis={(v) => `${Math.round(v)}`}
          series={[{ name: "ROI (เท่า)", color: "var(--viz-prev)", values: list.map((m) => roiOf(m.gmv, m.cost)) }]} />
      </Section>

      <Section title="ชั่วโมงไลฟ์ และต้นทุนต่อชั่วโมง">
        <BarChart label="ชั่วโมงไลฟ์" categories={cats} tooltipTitles={titles} hatched={hatched} height={170}
          format={(v) => (v === null ? "-" : hrsText(Math.round(v)))} formatAxis={(v) => `${Math.round(v)}`}
          series={[{ name: "ชั่วโมงไลฟ์", color: "var(--viz-prev)", values: list.map((m) => m.hours) }]}
          extra={(i) => <span className="text-muted-foreground">{baht(costPerHour(list[i]))}/ชม. · GMV {baht(gmvPerHour(list[i]))}/ชม.</span>} />
        <BarChart label="ต้นทุนต่อชั่วโมง" categories={cats} tooltipTitles={titles} hatched={hatched} height={150} format={baht} formatAxis={compact}
          series={[{ name: "บาท/ชม.", color: "var(--viz-cur)", values: list.map((m) => costPerHour(m)) }]} />
      </Section>

      {list.some((m) => m.target) ? (
        <Section title="% เป้า GMV ช่อง TikTok" note="GMV ทั้งช่อง TikTok (รวมช่วงของ Agency) ของช่องที่ตั้งเป้า ÷ เป้า · ตั้งเป้าที่ Analytics > ภาพรวม">
          <BarChart label="% เป้า GMV TikTok" categories={cats} tooltipTitles={titles} hatched={hatched} height={170}
            format={(v) => pctText(v)} formatAxis={(v) => `${Math.round(v * 100)}%`} avg={{ value: 1, label: "เป้า 100%" }}
            series={[{ name: "% เป้า", color: "var(--viz-cur)", values: list.map((m) => achieveOf(m)) }]}
            extra={(i) => <span className="text-muted-foreground">เป้า {list[i].target ? compact(list[i].target!) : "-"} · ทำได้ {list[i].targetGmv !== null ? compact(list[i].targetGmv!) : "-"}</span>} />
        </Section>
      ) : null}

      <TableView title="ดูเป็นตารางรายเดือน">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="border-b text-right">
                <th className="py-1 text-left font-medium">เดือน</th><th className="py-1 font-medium">ค่าจ้าง Mc</th><th className="py-1 font-medium">GMV</th>
                <th className="py-1 font-medium">ROI</th><th className="py-1 font-medium">ชม.</th><th className="py-1 font-medium">บาท/ชม.</th>
                <th className="py-1 font-medium">GMV/ชม.</th><th className="py-1 font-medium">% เป้า</th><th className="py-1 pl-2 text-left font-medium">ที่มา</th>
              </tr>
            </thead>
            <tbody>
              {[...list, ytd].map((m, i) => (
                <tr key={m.month} className={cn("border-b text-right last:border-0", i === list.length && "font-semibold")}>
                  <td className="py-1.5 text-left">{i === list.length ? "รวม" : monShort(m.month) + (m.open ? " *" : "")}</td>
                  <td className="py-1.5">{baht(m.cost)}</td><td className="py-1.5">{baht(m.gmv)}</td><td className="py-1.5">{roiText(roiOf(m.gmv, m.cost))}</td>
                  <td className="py-1.5">{Math.round(m.hours)}</td><td className="py-1.5">{baht(costPerHour(m))}</td><td className="py-1.5">{baht(gmvPerHour(m))}</td>
                  <td className="py-1.5">{pctText(achieveOf(m))}</td>
                  <td className="py-1.5 pl-2 text-left text-muted-foreground">{i === list.length ? "" : m.source === "sheet" ? "ชีต" : m.source === "forecast" ? "Forecast" : "ระบบ"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableView>
    </>
  );
}

function PeopleTable({ data }: { data: TiktokMcPeople }) {
  const list = peopleByRoi(data.people);
  if (!list.length) return <p className="py-3 text-center text-sm text-muted-foreground">เดือนนี้ยังไม่มีคิว Mc ที่มีค่าจ้าง</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr className="border-b text-right">
              <th className="py-1 text-left font-medium">#</th><th className="py-1 text-left font-medium">Mc</th><th className="py-1 font-medium">คิว</th>
              <th className="py-1 font-medium">ชม.</th><th className="py-1 font-medium">ค่าจ้าง</th><th className="py-1 font-medium">GMV</th>
              <th className="py-1 font-medium">ROI</th><th className="py-1 font-medium">GMV/ชม.</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p, i) => {
              const tone = i < 3 ? "text-success" : i >= list.length - 3 && list.length > 6 ? "text-destructive" : "";
              return (
                <tr key={p.mc} className="border-b text-right last:border-0">
                  <td className={cn("py-1.5 text-left", tone)}>{i + 1}</td>
                  <td className={cn("py-1.5 text-left whitespace-nowrap", i < 3 && "font-semibold")}>{p.mc}</td>
                  <td className="py-1.5">{p.slots}</td><td className="py-1.5">{Math.round(p.hours * 10) / 10}</td>
                  <td className="py-1.5">{baht(p.cost)}</td><td className="py-1.5">{baht(p.gmv)}</td>
                  <td className={cn("py-1.5 font-semibold", tone)}>{roiText(roiOf(p.gmv, p.cost))}</td>
                  <td className="py-1.5">{baht(p.hours ? p.gmv / p.hours : null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {data.open ? "เดือนนี้ยังไม่จบ · " : ""}ไม่รวม Mc ประจำ {data.salaried} คิว{data.unknown.slots ? ` · ยังไม่มียอด ${data.unknown.slots} คิว (ค่าจ้าง ${baht(data.unknown.cost)})` : ""} · เขียว = 3 อันดับแรก / แดง = 3 อันดับท้าย
      </p>
    </>
  );
}

function Kpi({ label, value, sub, big = false }: { label: string; value: string; sub: string; big?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
      <span className="block truncate text-xs text-muted-foreground">{label}</span>
      <span className={cn("block truncate font-bold tabular-nums", big ? "text-xl text-primary" : "text-lg")}>{value}</span>
      <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border bg-card p-3 sm:p-4">
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}
