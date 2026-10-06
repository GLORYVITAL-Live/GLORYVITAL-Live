"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, FileSpreadsheetIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import {
  accountsOf, bkkIso, bkkLocal, bkkParts, filterSessions, fmtMetric, fromBkkLocal, METRICS, metricOf, monthOf, monthWindow, parseRows,
  previousWindow, readXlsx, totalsOf, type Campaign, type LiveSession, type MetricKey, type ParsedFile, type Platform, type Totals,
} from "@/lib/live-stats";
import { fmtMonthShort, monthKey, monthLabel } from "@/lib/format";
import { useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { compareBook, monthBook, yearBook } from "@/lib/live-export";
import { ExportMenu } from "@/components/ExportMenu";
import { BarChart, ChangeText, Legend, PairBars } from "@/components/LiveCharts";
import {
  AppDialog, DialogActions, DialogBody, IconButton, LoadError, LoadingBlock, MonthNav, Notice, StateBox, api, useConfirm, useToast,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// หน้าสถิติไลฟ์ (Owner): ภาพรวมรายเดือน MoM / YoY | เทียบแคมเปญ | อัปโหลดไฟล์ Export

type MonthRow = { month: string; platform: string; lives: number; gmv: number };

const TAB_KEY = "glory_live_stats_tab";
const CUR = "var(--viz-cur)";
const PREV = "var(--viz-prev)";

const bkkDate = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
const bkkDateTime = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const bkkTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const sameDay = (a: string, b: string) => bkkDate.format(new Date(a)) === bkkDate.format(new Date(b));
const windowText = (from: string, to: string) =>
  `${bkkDateTime.format(new Date(from))} – ${sameDay(from, to) ? bkkTime.format(new Date(to)) : bkkDateTime.format(new Date(to))}`;
const fmtDuration = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;

/** โหลดไลฟ์ในช่วง [from, to) (เก็บไว้ในหน่วยความจำ เปลี่ยนกลับมาช่วงเดิมไม่โหลดซ้ำ) */
const sessionCache = new Map<string, LiveSession[]>();
function useSessions(from: string | null, to: string | null, version: number) {
  const key = from && to ? `${from}|${to}|${version}` : "";
  const [state, setState] = useState<{ key: string; data?: LiveSession[]; error?: string }>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  const cached = key ? sessionCache.get(key) : undefined;
  useEffect(() => {
    if (!key || cached) return;
    let alive = true;
    api<{ sessions: LiveSession[] }>(`/api/live-stats?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        sessionCache.set(key, res.sessions);
        if (alive) setState({ key, data: res.sessions });
      })
      .catch((err) => { if (alive) setState({ key, error: (err as Error).message }); });
    return () => { alive = false; };
  }, [key, cached, from, to, attempt]);
  return {
    data: cached ?? (state.key === key ? state.data : undefined),
    error: state.key === key ? state.error : undefined,
    retry: () => { setState({ key: "" }); setAttempt((n) => n + 1); },
  };
}

async function fetchMonths() {
  const res = await api<{ months: MonthRow[] }>("/api/live-stats?months=1");
  if (!res.ok) throw new Error(res.message);
  return res.months;
}
async function fetchCampaigns() {
  const res = await api<{ campaigns: Campaign[] }>("/api/live-stats/campaigns");
  if (!res.ok) throw new Error(res.message);
  return res.campaigns;
}

export function LiveStats() {
  const saved = useLocal(TAB_KEY);
  const tab = saved === "compare" || saved === "campaign" || saved === "upload" ? saved : "overview";
  const [months, setMonths] = useState<MonthRow[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // บันทึก/ลบข้อมูลแล้ว = เลขนี้เปลี่ยน กราฟโหลดใหม่
  const [version, setVersion] = useState(0);
  const onError = (err: unknown) => setError((err as Error).message);

  useEffect(() => {
    Promise.all([fetchMonths(), fetchCampaigns()])
      .then(([m, c]) => { setMonths(m); setCampaigns(c); setError(""); })
      .catch((err) => setError((err as Error).message));
  }, [attempt]);

  if (error) return <LoadError title="โหลดสถิติไลฟ์ไม่สำเร็จ" message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!months || !campaigns) return <LoadingBlock />;

  const tabs = [["overview", "ภาพรวม"], ["compare", "เทียบช่วง"], ["campaign", "แคมเปญ"], ["upload", "อัปโหลด"]] as const;
  const dataMonths = [...new Set(months.map((m) => m.month))];
  return (
    <Tabs value={tab} onValueChange={(v) => writeLocal(TAB_KEY, v)} className="gap-0 pb-10">
      <TabsList aria-label="เมนูสถิติไลฟ์" className="my-3 h-auto! w-full rounded-full border bg-card p-1">
        {tabs.map(([id, label]) => (
          <TabsTrigger key={id} value={id} className="rounded-full py-1.5 text-[13px] font-semibold data-active:bg-primary! data-active:text-primary-foreground! sm:text-sm">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview">
        {months.length ? <Overview latest={months[0].month} version={version} /> : <NoData />}
      </TabsContent>
      <TabsContent value="compare">
        {months.length ? <CompareView dataMonths={dataMonths} version={version} /> : <NoData />}
      </TabsContent>
      <TabsContent value="campaign">
        <CampaignView campaigns={campaigns} dataMonths={dataMonths} version={version} onChanged={() => fetchCampaigns().then(setCampaigns, onError)} />
      </TabsContent>
      <TabsContent value="upload">
        <UploadView months={months} onChanged={() => { setVersion((v) => v + 1); fetchMonths().then(setMonths, onError); }} />
      </TabsContent>
    </Tabs>
  );
}

function NoData() {
  return (
    <StateBox
      title="ยังไม่มีข้อมูลไลฟ์"
      action={<Button onClick={() => writeLocal(TAB_KEY, "upload")}><UploadIcon />ไปที่อัปโหลดข้อมูล</Button>}
    >
      อัปโหลดไฟล์ Export จาก TikTok LIVE / Shopee Live ก่อน แล้วกลับมาดูสรุปที่นี่
    </StateBox>
  );
}

// ---------- ตัวกรอง แพลตฟอร์ม / บัญชี ----------

function useFilter() {
  const [platform, setPlatform] = useState<Platform | "">("");
  const [account, setAccount] = useState("");
  return { platform, account, setPlatform: (p: Platform | "") => { setPlatform(p); setAccount(""); }, setAccount };
}

/** ตัวกรองแพลตฟอร์ม / บัญชี + ปุ่มด้านขวา (เช่น ส่งออก) */
function FilterBar({ filter, sessions, children }: { filter: ReturnType<typeof useFilter>; sessions: LiveSession[]; children?: ReactNode }) {
  const accounts = accountsOf(sessions).filter((a) => !filter.platform || a.platform === filter.platform);
  return (
    <div className="my-2 flex flex-wrap items-center gap-2">
      {children ? <div className="order-last ml-auto">{children}</div> : null}
      <ToggleGroup
        type="single"
        spacing={1}
        value={filter.platform || "all"}
        onValueChange={(v) => { if (v) filter.setPlatform(v === "all" ? "" : (v as Platform)); }}
        aria-label="แพลตฟอร์ม"
        className="rounded-full border bg-card p-1"
      >
        {[["all", "ทั้งหมด"], ["TikTok", "TikTok"], ["Shopee", "Shopee"]].map(([id, text]) => (
          <ToggleGroupItem
            key={id}
            value={id}
            className="rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!"
          >
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {accounts.length > 1 ? (
        <Select value={filter.account || "all"} onValueChange={(v) => filter.setAccount(v === "all" ? "" : v)}>
          <SelectTrigger aria-label="บัญชี" className="h-9 min-w-44 rounded-full bg-card"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all">ทุกบัญชี</SelectItem>
            {accounts.map((a) => <SelectItem key={a.key} value={a.key}>{filter.platform ? "" : `${a.platform} · `}{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

function MetricSelect({ value, onChange }: { value: MetricKey; onChange: (k: MetricKey) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MetricKey)}>
      <SelectTrigger aria-label="ตัวชี้วัดในกราฟ" className="h-8 min-w-36 rounded-full bg-card text-[13px]"><SelectValue /></SelectTrigger>
      <SelectContent position="popper">
        {METRICS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ---------- ภาพรวมรายเดือน ----------

const shortMonth = (key: string) => {
  const label = fmtMonthShort.format(new Date(`${key}-01T12:00:00Z`));
  return key.endsWith("-01") ? `${label} ${key.slice(2, 4)}` : label;
};

/** การ์ดตัวชี้วัด + % เทียบกับช่วงอื่น (เช่น MoM / YoY) */
function KpiGrid({ cur, compare }: { cur: Totals; compare: { totals: Totals; label: string }[] }) {
  return (
    <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {METRICS.map((m) => {
        const v = m.value(cur);
        return (
          <div key={m.key} className="rounded-xl border bg-card px-3 py-2.5">
            <div className="text-xs text-muted-foreground">{m.label}{m.note ? <span className="opacity-80"> · {m.note}</span> : null}</div>
            <div className="text-lg font-bold">{fmtMetric(m.kind, v)}</div>
            {v === null && m.key === "co" && cur.coBase === null ? (
              <div className="text-xs text-muted-foreground">สูตรต่างกัน เลือก TikTok หรือ Shopee เพื่อดู</div>
            ) : v === null ? null : (
              <div className="mt-0.5 flex flex-col">
                {compare.map((c) => <ChangeText key={c.label} cur={v} prev={c.totals.lives ? m.value(c.totals) : null} suffix={c.label} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const OVERVIEW_KEY = "glory_live_overview_mode";

function Overview({ latest, version }: { latest: string; version: number }) {
  const mode = useLocal(OVERVIEW_KEY) === "year" ? "year" : "month";
  return (
    <>
      <ToggleGroup type="single" spacing={1} value={mode} onValueChange={(v) => { if (v) writeLocal(OVERVIEW_KEY, v); }}
        aria-label="ดูภาพรวมแบบ" className="mb-1 rounded-full border bg-card p-1">
        {[["month", "รายเดือน"], ["year", "ทั้งปี"]].map(([id, text]) => (
          <ToggleGroupItem key={id} value={id} className="rounded-full! px-4 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!">
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {mode === "year" ? <YearOverview latest={latest} version={version} /> : <MonthOverview latest={latest} version={version} />}
    </>
  );
}

function MonthOverview({ latest, version }: { latest: string; version: number }) {
  const [month, setMonth] = useState(latest);
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const filter = useFilter();
  const months13 = useMemo(() => Array.from({ length: 13 }, (_, i) => monthKey(i - 12, month)), [month]);
  const { data, error, retry } = useSessions(monthWindow(months13[0]).from, monthWindow(month).to, version);

  const nav = <MonthNav label={monthLabel(month)} onPrev={() => setMonth(monthKey(-1, month))} onNext={() => setMonth(monthKey(1, month))} />;
  if (!data) return <>{nav}{error ? <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={retry} /> : <LoadingBlock />}</>;

  const list = filterSessions(data, filter.platform, filter.account);
  const byMonth = new Map<string, LiveSession[]>(months13.map((m) => [m, []]));
  for (const s of list) byMonth.get(monthOf(s.startedAt))?.push(s);
  const totals = new Map(months13.map((m) => [m, totalsOf(byMonth.get(m)!)]));
  const cur = totals.get(month)!;
  const prevKey = monthKey(-1, month), yoyKey = monthKey(-12, month);
  const prev = totals.get(prevKey)!, yoy = totals.get(yoyKey)!;
  const def = metricOf(metric);
  const fmt = (v: number | null) => fmtMetric(def.kind, v);

  return (
    <>
      {nav}
      <FilterBar filter={filter} sessions={data}>
        <ExportMenu size="sm" label="ส่งออก" build={() => monthBook({
          month, monthLabel, months13, byMonth, filter: { platform: filter.platform, account: filter.account, sessions: data },
        })} />
      </FilterBar>
      {!cur.lives ? (
        <StateBox title={`ไม่มีข้อมูลไลฟ์ ${monthLabel(month)}`}>ลองเปลี่ยนเดือน / แพลตฟอร์ม หรืออัปโหลดไฟล์ของเดือนนี้</StateBox>
      ) : (
        <KpiGrid cur={cur} compare={[
          { totals: prev, label: `MoM vs ${shortMonth(prevKey)}` },
          { totals: yoy, label: `YoY vs ${shortMonth(yoyKey)} ${yoyKey.slice(2, 4)}` },
        ]} />
      )}

      <section className="my-4 rounded-2xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{def.label} รายเดือน (13 เดือน)</h2>
          <MetricSelect value={metric} onChange={setMetric} />
        </div>
        <BarChart
          label={`${def.label} รายเดือน`}
          categories={months13.map(shortMonth)}
          tooltipTitles={months13.map(monthLabel)}
          series={[{ name: def.label, color: CUR, values: months13.map((m) => (totals.get(m)!.lives ? def.value(totals.get(m)!) : null)) }]}
          format={fmt}
          formatAxis={(v) => fmtMetric(def.kind === "hours" ? "int" : def.kind, v, true)}
          highlight={12}
        />
        <TableView title="ดูเป็นตาราง">
          <Table>
            <TableHeader><TableRow><TableHead>เดือน</TableHead><TableHead className="text-right">{def.label}</TableHead><TableHead className="text-right">MoM</TableHead><TableHead className="text-right">ไลฟ์</TableHead></TableRow></TableHeader>
            <TableBody>
              {months13.slice().reverse().map((m) => {
                const t = totals.get(m)!;
                return (
                  <TableRow key={m}>
                    <TableCell>{monthLabel(m)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.lives ? fmt(def.value(t)) : "-"}</TableCell>
                    <TableCell className="text-right">{t.lives ? <ChangeText cur={def.value(t)} prev={def.value(totals.get(monthKey(-1, m)) ?? totalsOf([]))} /> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.lives}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableView>
      </section>

      {cur.lives ? <AccountTable cur={byMonth.get(month)!} prev={byMonth.get(prevKey)!} prevLabel={shortMonth(prevKey)} /> : null}
    </>
  );
}

/**
 * ภาพรวมทั้งปี: ยอดรวมปี + YoY / กราฟ 12 เดือนเทียบปีก่อน / ตารางรายไตรมาส / แยกบัญชี
 *   ปีปัจจุบันยังไม่จบ = เทียบ YoY กับช่วงเดียวกันของปีก่อน (ม.ค. ถึงเดือนนี้)
 */
function YearOverview({ latest, version }: { latest: string; version: number }) {
  const [year, setYear] = useState(+latest.slice(0, 4));
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const filter = useFilter();
  const { data, error, retry } = useSessions(monthWindow(`${year - 1}-01`).from, monthWindow(`${year}-12`).to, version);

  const nav = (
    <div className="my-2 flex items-center justify-between gap-3">
      <IconButton label="ปีก่อนหน้า" onClick={() => setYear(year - 1)}><ChevronLeftIcon /></IconButton>
      <strong aria-live="polite">ปี {year}</strong>
      <IconButton label="ปีถัดไป" onClick={() => setYear(year + 1)}><ChevronRightIcon /></IconButton>
    </div>
  );
  if (!data) return <>{nav}{error ? <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={retry} /> : <LoadingBlock />}</>;

  const now = monthKey();
  const ongoing = now.startsWith(String(year));
  const lastIdx = ongoing ? +now.slice(5, 7) : 12; // นับถึงเดือนที่เท่าไร (YTD)
  const keysOf = (y: number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  const curKeys = keysOf(year), prevKeys = keysOf(year - 1);

  const list = filterSessions(data, filter.platform, filter.account);
  const byMonth = new Map<string, LiveSession[]>([...curKeys, ...prevKeys].map((m) => [m, []]));
  for (const s of list) byMonth.get(monthOf(s.startedAt))?.push(s);
  const sessionsOf = (keys: string[]) => keys.flatMap((k) => byMonth.get(k)!);
  const totals = new Map([...byMonth].map(([k, v]) => [k, totalsOf(v)]));
  const curList = sessionsOf(curKeys.slice(0, lastIdx));
  // ปีที่ยังไม่จบ: ปีก่อนนับถึงวันเดียวกัน (YTD)
  const today = new Date();
  const sameDayLastYear = new Date(today.getTime()).setFullYear(today.getFullYear() - 1);
  const prevList = sessionsOf(prevKeys.slice(0, lastIdx)).filter((s) => !ongoing || Date.parse(s.startedAt) < sameDayLastYear);
  const cur = totalsOf(curList), prev = totalsOf(prevList);
  const rangeText = ongoing ? `1 ม.ค.–${bkkDate.format(today)}` : "ทั้งปี";

  const def = metricOf(metric);
  const fmt = (v: number | null) => fmtMetric(def.kind, v);
  const valOf = (k: string) => (totals.get(k)!.lives ? def.value(totals.get(k)!) : null);
  const series = [{ name: String(year), color: CUR, values: curKeys.map(valOf) }];
  const hasPrev = prevKeys.some((k) => totals.get(k)!.lives);
  if (hasPrev) series.push({ name: String(year - 1), color: PREV, values: prevKeys.map(valOf) });

  // ไตรมาส: Q4 ปีก่อน -> Q1..Q4 ปีนี้ (ใช้เทียบ QoQ)
  const quarter = (y: number, q: number) => totalsOf(sessionsOf(keysOf(y).slice(q * 3 - 3, q * 3)));
  const quarters = [1, 2, 3, 4].map((q) => ({ q, t: quarter(year, q), before: q === 1 ? quarter(year - 1, 4) : quarter(year, q - 1), lastYear: quarter(year - 1, q) }));
  const v = (t: Totals) => (t.lives ? def.value(t) : null);

  return (
    <>
      {nav}
      <FilterBar filter={filter} sessions={data}>
        <ExportMenu size="sm" label="ส่งออก" build={() => yearBook({
          year, rangeText, monthLabel, curKeys, prevKeys, byMonth, curList, prevList,
          filter: { platform: filter.platform, account: filter.account, sessions: data },
        })} />
      </FilterBar>
      {!cur.lives ? (
        <StateBox title={`ไม่มีข้อมูลไลฟ์ปี ${year}`}>ลองเปลี่ยนปี / แพลตฟอร์ม หรืออัปโหลดไฟล์ของปีนี้</StateBox>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            ยอดรวมปี {year} {ongoing ? `${rangeText} (ปีนี้ยังไม่จบ)` : "ทั้งปี"} · YoY เทียบกับปี {year - 1} ช่วงเดียวกัน
          </p>
          <KpiGrid cur={cur} compare={[{ totals: prev, label: `YoY vs ${year - 1} (${rangeText})` }]} />
        </>
      )}

      <section className="my-4 rounded-2xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{def.label} รายเดือน ปี {year}{hasPrev ? ` เทียบ ${year - 1}` : ""}</h2>
          <MetricSelect value={metric} onChange={setMetric} />
        </div>
        {hasPrev ? <div className="mb-2"><Legend series={series} /></div> : null}
        <BarChart
          label={`${def.label} รายเดือน ปี ${year}`}
          categories={curKeys.map((k) => fmtMonthShort.format(new Date(`${k}-01T12:00:00Z`)))}
          tooltipTitles={curKeys.map((k, i) => (hasPrev ? `${monthLabel(k)} vs ${monthLabel(prevKeys[i])}` : monthLabel(k)))}
          series={series}
          format={fmt}
          formatAxis={(x) => fmtMetric(def.kind === "hours" ? "int" : def.kind, x, true)}
        />
        <TableView title="ดูเป็นตาราง">
          <Table>
            <TableHeader><TableRow><TableHead>เดือน</TableHead><TableHead className="text-right">{year}</TableHead><TableHead className="text-right">MoM</TableHead><TableHead className="text-right">{year - 1}</TableHead><TableHead className="text-right">YoY</TableHead></TableRow></TableHeader>
            <TableBody>
              {curKeys.map((k, i) => {
                const show = valOf(k) !== null && k !== now; // เดือนนี้ยังไม่จบ ไม่แสดง %
                return (
                  <TableRow key={k}>
                    <TableCell>{monthLabel(k)}{k === now ? <span className="text-xs text-muted-foreground"> (ยังไม่จบ)</span> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(valOf(k))}</TableCell>
                    <TableCell className="text-right">{show ? <ChangeText cur={valOf(k)} prev={valOf(i ? curKeys[i - 1] : prevKeys[11])} /> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(valOf(prevKeys[i]))}</TableCell>
                    <TableCell className="text-right">{show ? <ChangeText cur={valOf(k)} prev={valOf(prevKeys[i])} /> : null}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableView>
      </section>

      <section className="my-4">
        <h2 className="mb-2 text-lg font-bold">{def.label} รายไตรมาส</h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ไตรมาส</TableHead><TableHead className="text-right">ไลฟ์</TableHead><TableHead className="text-right">{def.label}</TableHead>
                <TableHead className="text-right">QoQ</TableHead><TableHead className="text-right">YoY</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quarters.map(({ q, t, before, lastYear }) => {
                // ไตรมาสที่ยังไม่จบ ไม่แสดง % (ยอดยังไม่ครบ เทียบแล้วดูเหมือนตก)
                const open = ongoing && q === Math.ceil(lastIdx / 3);
                const pending = <span className="text-xs text-muted-foreground">รอจบไตรมาส</span>;
                return (
                  <TableRow key={q}>
                    <TableCell className="font-medium">Q{q}/{year}{open ? <span className="text-xs font-normal text-muted-foreground"> (ยังไม่จบ)</span> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.lives}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(v(t))}</TableCell>
                    <TableCell className="text-right">{!t.lives ? null : open ? pending : <ChangeText cur={v(t)} prev={v(before)} />}</TableCell>
                    <TableCell className="text-right">{!t.lives ? null : open ? pending : <ChangeText cur={v(t)} prev={v(lastYear)} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {cur.lives ? <AccountTable cur={curList} prev={prevList} prevLabel={`${year - 1}`} /> : null}
    </>
  );
}

function TableView({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="group/tv mt-2">
      <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 rounded text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/tv:rotate-180" />{title}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** แยกตามบัญชี: ยอดของช่วงนี้ + เทียบช่วงก่อน */
function AccountTable({ cur, prev, prevLabel }: { cur: LiveSession[]; prev: LiveSession[]; prevLabel: string }) {
  const accounts = accountsOf([...cur, ...prev]);
  const gmv = metricOf("gmv"), perHour = metricOf("gmvPerHour"), co = metricOf("co");
  const all = totalsOf(cur);
  return (
    <section className="my-4">
      <h2 className="mb-2 text-lg font-bold">แยกตามบัญชี</h2>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>บัญชี</TableHead><TableHead className="text-right">ไลฟ์</TableHead><TableHead className="text-right">ชม.</TableHead>
              <TableHead className="text-right">GMV</TableHead><TableHead className="text-right">vs {prevLabel}</TableHead>
              <TableHead className="text-right">GMV/ชม.</TableHead><TableHead className="text-right">CO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const t = totalsOf(cur.filter((s) => `${s.platform}|${s.accountId}` === a.key));
              const p = totalsOf(prev.filter((s) => `${s.platform}|${s.accountId}` === a.key));
              return (
                <TableRow key={a.key}>
                  <TableCell><span className="text-xs text-muted-foreground">{a.platform}</span><br />{a.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.lives}</TableCell>
                  <TableCell className="text-right tabular-nums">{(t.durationSec / 3600).toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMetric("baht", t.gmv)}</TableCell>
                  <TableCell className="text-right"><ChangeText cur={t.lives ? t.gmv : null} prev={p.lives ? p.gmv : null} /></TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMetric("baht", perHour.value(t))}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMetric("pct", co.value(t))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>รวม</TableCell>
              <TableCell className="text-right tabular-nums">{all.lives}</TableCell>
              <TableCell className="text-right tabular-nums">{(all.durationSec / 3600).toFixed(1)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtMetric("baht", gmv.value(all))}</TableCell>
              <TableCell className="text-right"><ChangeText cur={all.gmv} prev={prev.length ? totalsOf(prev).gmv : null} /></TableCell>
              <TableCell className="text-right tabular-nums">{fmtMetric("baht", perHour.value(all))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtMetric("pct", co.value(all))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </section>
  );
}

// ---------- เทียบไตรมาส ----------

/** "YYYY-MM" -> "YYYY-Q1".."YYYY-Q4" */
const quarterOf = (month: string) => `${month.slice(0, 4)}-Q${Math.ceil(+month.slice(5, 7) / 3)}`;
const shiftQuarter = (q: string, by: number) => {
  const i = +q.slice(0, 4) * 4 + +q.slice(-1) - 1 + by;
  return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
};
const firstMonthOfQuarter = (q: string) => `${q.slice(0, 4)}-${String(+q.slice(-1) * 3 - 2).padStart(2, "0")}`;
const quarterName = (q: string) => `Q${q.slice(-1)}/${q.slice(0, 4)}`;
function quarterPeriod(q: string): Period {
  const first = firstMonthOfQuarter(q);
  return { from: monthWindow(first).from, to: monthWindow(monthKey(3, first)).from, name: quarterName(q) };
}
function quarterLabel(q: string) {
  const first = firstMonthOfQuarter(q);
  const m = (k: string) => fmtMonthShort.format(new Date(`${k}-01T12:00:00Z`));
  return `${quarterName(q)} (${m(first)}–${m(monthKey(2, first))})`;
}

/** หน่วยของแท็บเทียบช่วง: เดือน "YYYY-MM" (MoM) / ไตรมาส "YYYY-Qn" (QoQ) */
const PERIOD_KINDS = {
  month: {
    tab: "เดือน (MoM)", pick: "เดือน", prevText: "เดือนก่อน (MoM)", yoyText: "เดือนเดียวกันปีก่อน (YoY)", yoy: 12, unit: "day",
    of: (m: string) => m,
    shift: (k: string, by: number) => monthKey(by, k),
    period: (k: string): Period => ({ ...monthWindow(k), name: monthLabel(k) }),
    label: monthLabel,
  },
  quarter: {
    tab: "ไตรมาส (QoQ)", pick: "ไตรมาส", prevText: "ไตรมาสก่อน (QoQ)", yoyText: "ไตรมาสเดียวกันปีก่อน (YoY)", yoy: 4, unit: "month",
    of: quarterOf,
    shift: shiftQuarter,
    period: quarterPeriod,
    label: quarterLabel,
  },
} as const;
type PeriodKind = keyof typeof PERIOD_KINDS;

function CompareView({ dataMonths, version }: { dataMonths: string[]; version: number }) {
  const sorted = dataMonths.slice().sort();
  const [kind, setKind] = useState<PeriodKind>("month");
  const k = PERIOD_KINDS[kind];
  const now = k.of(monthKey());
  const latest = sorted.length ? k.of(sorted[sorted.length - 1]) : now;
  // ช่วงที่เลือกของแต่ละหน่วย (สลับไปมาแล้วค่าเดิมยังอยู่) ยังไม่เลือก = ช่วงล่าสุดที่มีข้อมูล vs ช่วงก่อนหน้า
  const [picked, setPicked] = useState<Partial<Record<PeriodKind, { a: string; b: string }>>>({});
  const { a, b } = picked[kind] ?? { a: latest, b: k.shift(latest, -1) };
  const setA = (v: string) => setPicked((p) => ({ ...p, [kind]: { a: v, b } }));
  const setB = (v: string) => setPicked((p) => ({ ...p, [kind]: { a, b: v } }));
  // ตัวเลือก: ตั้งแต่ 1 ปีก่อนข้อมูลแรก ถึงช่วงปัจจุบัน (ใหม่สุดก่อน)
  const options: string[] = [];
  const oldest = k.shift(sorted.length ? k.of(sorted[0]) : now, -k.yoy);
  for (let q = now > latest ? now : latest; q >= oldest; q = k.shift(q, -1)) options.push(q);

  const picker = (value: string, onChange: (q: string) => void, label: string, swatch: string) => (
    <div className="min-w-0 flex-1">
      <span className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("size-2.5 rounded-[3px]", swatch)} />{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-9 w-full rounded-full bg-card font-semibold"><SelectValue /></SelectTrigger>
        <SelectContent position="popper">
          {options.map((q) => <SelectItem key={q} value={q}>{k.label(q)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <>
      <div className="my-3 rounded-xl border bg-card p-3">
        <ToggleGroup type="single" spacing={1} value={kind} onValueChange={(v) => { if (v) setKind(v as PeriodKind); }}
          aria-label="เทียบเป็น" className="mb-3 rounded-full border bg-card p-1">
          {(Object.keys(PERIOD_KINDS) as PeriodKind[]).map((id) => (
            <ToggleGroupItem key={id} value={id} className="rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!">
              {PERIOD_KINDS[id].tab}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex flex-wrap gap-3 sm:flex-nowrap">
          {picker(a, setA, k.pick, "bg-viz-cur")}
          {picker(b, setB, "เทียบกับ", "bg-viz-prev")}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setB(k.shift(a, -1))}>{k.prevText}</Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setB(k.shift(a, -k.yoy))}>{k.yoyText}</Button>
        </div>
      </div>
      {a === now || b === now ? (
        <Notice>{k.period(now).name} ยังไม่จบ{k.pick} ตัวเลขนับเฉพาะไลฟ์ที่อัปโหลดแล้ว</Notice>
      ) : null}
      {a === b ? <StateBox title={`เลือก${k.pick}ที่ต่างกัน`}>เลือก{k.pick}ในช่อง &ldquo;เทียบกับ&rdquo; หรือกดปุ่มลัดด้านบน</StateBox> : (
        <PeriodCompare
          report={`เทียบ${k.pick} (${b === k.shift(a, -1) ? (kind === "month" ? "MoM" : "QoQ") : b === k.shift(a, -k.yoy) ? "YoY" : "เลือกเอง"})`}
          cur={k.period(a)} prev={k.period(b)} unit={k.unit} dataMonths={dataMonths} version={version} fixHint={`หรือเลือก${k.pick}อื่น`} />
      )}
    </>
  );
}

// ---------- เทียบแคมเปญ ----------

const CAMPAIGN_KEY = "glory_live_campaign";

/** เดือนในช่วง [from, to) ที่ยังไม่มีข้อมูลในระบบ (ข้อความ เช่น "ก.ย. 2026") */
function missingMonths(from: string, to: string, dataMonths: string[]) {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(new Date(Date.parse(to) - 1).toISOString()); m = monthKey(1, m)) {
    if (!dataMonths.includes(m)) out.push(monthLabel(m));
  }
  return out;
}
const haveText = (dataMonths: string[]) =>
  dataMonths.length ? `ในระบบมีข้อมูล: ${dataMonths.slice().sort().map(monthLabel).join(", ")}` : "ยังไม่มีข้อมูลในระบบ";

/** ชื่อแบบวันเลขเบิ้ล / วันที่.เดือน เช่น "9.9" "11.11" "25.12" -> วันนั้นของปีนี้ 00:00 ถึงวันถัดไป 00:00 */
function windowFromName(name: string) {
  const m = name.trim().match(/^(\d{1,2})[./](\d{1,2})$/);
  if (!m) return null;
  const d = +m[1], mon = +m[2];
  if (mon < 1 || mon > 12 || d < 1 || d > 31) return null;
  const y = bkkParts(new Date().toISOString()).y;
  const start = bkkIso(y, mon, d);
  return { start: bkkLocal(start), end: bkkLocal(bkkIso(y, mon, d + 1)) };
}

function compareOf(c: Campaign, all: Campaign[]) {
  const other = c.compareId ? all.find((x) => x.id === c.compareId) : undefined;
  if (other) return { from: other.startsAt, to: other.endsAt, name: other.name, auto: "" };
  const w = previousWindow(c.startsAt, c.endsAt);
  return { from: w.from, to: w.to, name: "เดือนก่อน", auto: w.doubleDay ? "วันเลขเบิ้ลของเดือนก่อน" : "ช่วงเดียวกันของเดือนก่อน" };
}

function CampaignView({ campaigns, dataMonths, version, onChanged }: {
  campaigns: Campaign[];
  dataMonths: string[];
  version: number;
  onChanged: () => void;
}) {
  const saved = Number(useLocal(CAMPAIGN_KEY));
  const c = campaigns.find((x) => x.id === saved) ?? campaigns[0];
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  async function remove(x: Campaign) {
    if (!(await confirm({ title: `ลบแคมเปญ "${x.name}"?`, description: "ลบเฉพาะการตั้งช่วงเวลา ข้อมูลไลฟ์ไม่หาย", confirmText: "ลบ", destructive: true }))) return;
    try {
      const res = await api("/api/live-stats/campaigns", { id: x.id }, "DELETE");
      if (!res.ok) throw new Error(res.message);
      toast("ลบแคมเปญแล้ว");
      onChanged();
    } catch (err) { toast((err as Error).message, "error"); }
  }

  return (
    <>
      <div className="my-2 flex flex-wrap items-center gap-2">
        {campaigns.length ? (
          <Select value={c ? String(c.id) : ""} onValueChange={(v) => writeLocal(CAMPAIGN_KEY, v)}>
            <SelectTrigger aria-label="เลือกแคมเปญ" className="h-9 min-w-52 flex-1 rounded-full bg-card font-semibold sm:flex-none"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              {campaigns.map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
        {c ? (
          <>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing(c)}><PencilIcon />แก้ไข</Button>
            <Button variant="outline" size="sm" className="rounded-full text-destructive" onClick={() => remove(c)}><Trash2Icon />ลบ</Button>
          </>
        ) : null}
        <Button size="sm" className="rounded-full" onClick={() => setEditing("new")}><PlusIcon />เพิ่มแคมเปญ</Button>
      </div>
      {c ? <CampaignCompare key={c.id} c={c} all={campaigns} dataMonths={dataMonths} version={version} /> : (
        <StateBox title="ยังไม่มีแคมเปญ" action={<Button onClick={() => setEditing("new")}><PlusIcon />เพิ่มแคมเปญ</Button>}>
          ตั้งชื่อและช่วงวันเวลา เช่น 10.10 = 10 ต.ค. 00:00 ถึง 11 ต.ค. 00:00 ระบบจะเทียบกับ 9.9 ให้เอง
        </StateBox>
      )}
      {editing ? (
        <CampaignDialog
          campaign={editing === "new" ? null : editing}
          all={campaigns}
          dataMonths={dataMonths}
          onClose={() => setEditing(null)}
          onSaved={(id) => { writeLocal(CAMPAIGN_KEY, String(id)); setEditing(null); onChanged(); }}
        />
      ) : null}
    </>
  );
}

function CampaignCompare({ c, all, dataMonths, version }: { c: Campaign; all: Campaign[]; dataMonths: string[]; version: number }) {
  const cmp = compareOf(c, all);
  return (
    <>
      <div className="my-3 grid gap-2 rounded-xl border bg-card p-3 text-sm sm:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2.5 rounded-[3px] bg-viz-cur" />ช่วงแคมเปญ</span>
          <div className="font-semibold">{windowText(c.startsAt, c.endsAt)}</div>
        </div>
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-[3px] bg-viz-prev" />เทียบกับ {cmp.auto ? `(อัตโนมัติ: ${cmp.auto})` : cmp.name}
          </span>
          <div className="font-semibold">{windowText(cmp.from, cmp.to)}</div>
        </div>
      </div>
      <PeriodCompare
        report="Campaign on Campaign"
        cur={{ from: c.startsAt, to: c.endsAt, name: c.name }}
        prev={{ from: cmp.from, to: cmp.to, name: cmp.name }}
        unit="day"
        dataMonths={dataMonths}
        version={version}
        fixHint="หรือกด “แก้ไข” เพื่อเปลี่ยนช่วงวัน / เทียบกับแคมเปญอื่น"
      />
    </>
  );
}

type Period = { from: string; to: string; name: string };

/** จำนวนเดือนจาก "YYYY-MM" a ถึง b */
const monthDiff = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const lastMonthOf = (p: Period) => monthOf(new Date(Date.parse(p.to) - 1).toISOString());

/**
 * เทียบสองช่วงเวลา (แคมเปญ / ไตรมาส): แท่งเทียบทุกตัวชี้วัด + กราฟแยกบัญชี หรือตามเวลา + รายการไลฟ์
 *   unit = กราฟตามเวลาแบ่งเป็นรายวัน หรือรายเดือน (นับจากวันเริ่ม/เดือนแรกของแต่ละช่วง)
 */
function PeriodCompare({ report, cur: pc, prev: pp, unit, dataMonths, version, fixHint }: {
  /** ชื่อรายงานในไฟล์ที่ส่งออก เช่น "เทียบเดือน (MoM)" / "Campaign on Campaign" */
  report: string;
  cur: Period;
  prev: Period;
  unit: "day" | "month";
  dataMonths: string[];
  version: number;
  fixHint: string;
}) {
  const filter = useFilter();
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const [groupBy, setGroupBy] = useState<"account" | "time">("account");
  const curQ = useSessions(pc.from, pc.to, version);
  const prevQ = useSessions(pp.from, pp.to, version);
  const error = curQ.error || prevQ.error;
  if (!curQ.data || !prevQ.data) {
    return error ? <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={() => { curQ.retry(); prevQ.retry(); }} /> : <LoadingBlock />;
  }

  const cur = filterSessions(curQ.data, filter.platform, filter.account);
  const prev = filterSessions(prevQ.data, filter.platform, filter.account);
  const tc = totalsOf(cur), tp = totalsOf(prev);
  const def = metricOf(metric);
  const fmt = (v: number | null) => fmtMetric(def.kind, v);
  const curName = pc.name, prevName = pp.name;
  const timeText = unit === "day" ? "รายวัน" : "รายเดือน";

  // กลุ่มในกราฟ: แยกบัญชี หรือ วัน/เดือนที่ 1, 2, ... นับจากต้นของแต่ละช่วง
  const steps = unit === "day"
    ? Math.ceil((Date.parse(pc.to) - Date.parse(pc.from)) / 86400_000)
    : monthDiff(monthOf(pc.from), lastMonthOf(pc)) + 1;
  const byTime = groupBy === "time" && steps > 1;
  const stepOf = (s: LiveSession, start: string) => unit === "day"
    ? Math.floor((Date.parse(s.startedAt) - Date.parse(start)) / 86400_000)
    : monthDiff(monthOf(start), monthOf(s.startedAt));
  const stepLabel = (start: string, i: number) => unit === "day"
    ? bkkDate.format(new Date(Date.parse(start) + i * 86400_000))
    : shortMonth(monthKey(i, monthOf(start)));
  // วัน/เดือนที่ 1, 2, ... ของทั้งสองช่วง (ใช้ทั้งกราฟและไฟล์ที่ส่งออก)
  const timeGroups = Array.from({ length: steps > 1 ? steps : 0 }, (_, i) => ({
    short: stepLabel(pc.from, i),
    label: `${unit === "day" ? "วันที่" : "เดือนที่"} ${i + 1}: ${stepLabel(pc.from, i)} vs ${stepLabel(pp.from, i)}`,
    a: cur.filter((s) => stepOf(s, pc.from) === i),
    b: prev.filter((s) => stepOf(s, pp.from) === i),
  }));
  let categories: string[], titles: string[], curVals: (number | null)[], prevVals: (number | null)[];
  const val = (list: LiveSession[]) => (list.length ? def.value(totalsOf(list)) : null);
  if (byTime) {
    categories = timeGroups.map((g) => g.short);
    titles = timeGroups.map((g) => g.label);
    curVals = timeGroups.map((g) => val(g.a));
    prevVals = timeGroups.map((g) => val(g.b));
  } else {
    const accounts = accountsOf([...cur, ...prev]);
    categories = accounts.map((a) => a.name);
    titles = accounts.map((a) => `${a.platform} · ${a.name}`);
    const of = (list: LiveSession[], key: string) => list.filter((s) => `${s.platform}|${s.accountId}` === key);
    curVals = accounts.map((a) => val(of(cur, a.key)));
    prevVals = accounts.map((a) => val(of(prev, a.key)));
  }
  const chartSeries = [{ name: curName, color: CUR, values: curVals }, { name: prevName, color: PREV, values: prevVals }];
  const missing = [...new Set([...missingMonths(pc.from, pc.to, dataMonths), ...missingMonths(pp.from, pp.to, dataMonths)])];

  const exportBook = () => compareBook({
    title: `GLORY ${report} ${curName} vs ${prevName}`, report, aName: curName, bName: prevName,
    aRange: windowText(pc.from, pc.to), bRange: windowText(pp.from, pp.to), a: cur, b: prev,
    timeName: timeText, time: timeGroups,
    filter: { platform: filter.platform, account: filter.account, sessions: [...curQ.data!, ...prevQ.data!] },
  });

  return (
    <>
      <FilterBar filter={filter} sessions={[...curQ.data, ...prevQ.data]}>
        <ExportMenu size="sm" label="ส่งออก" build={exportBook} />
      </FilterBar>
      {missing.length ? (
        <Notice variant="warning" icon title={`ยังไม่ได้อัปโหลดข้อมูลเดือน ${missing.join(", ")}`}>
          {haveText(dataMonths)} · อัปโหลดไฟล์ของเดือนนั้นที่แท็บ &ldquo;อัปโหลด&rdquo; {fixHint}
        </Notice>
      ) : null}
      {!tc.lives && !tp.lives ? (
        <StateBox title="ไม่มีไลฟ์ในทั้งสองช่วง">ไลฟ์นับตามเวลาเริ่มไลฟ์ (เวลาไทย)</StateBox>
      ) : (
        <>
          <div className="mt-3 mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">สรุปเทียบทุกตัวชี้วัด</h2>
            <Legend series={chartSeries} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {METRICS.map((m) => (
              <PairBars key={m.key} label={m.label} note={m.note} cur={tc.lives ? m.value(tc) : null} prev={tp.lives ? m.value(tp) : null}
                format={(v) => fmtMetric(m.kind, v)} curName={curName} prevName={prevName} />
            ))}
          </div>

          <section className="my-4 rounded-2xl border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">{def.label} {byTime ? timeText : "แยกตามบัญชี"}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {steps > 1 ? (
                  <ToggleGroup type="single" spacing={1} value={groupBy} onValueChange={(v) => { if (v) setGroupBy(v as "account" | "time"); }}
                    aria-label="แบ่งกราฟตาม" className="rounded-full border bg-card p-0.5">
                    {[["account", "บัญชี"], ["time", timeText]].map(([id, text]) => (
                      <ToggleGroupItem key={id} value={id} className="h-7 rounded-full! px-2.5 text-xs font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!">{text}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : null}
                <MetricSelect value={metric} onChange={setMetric} />
              </div>
            </div>
            <Legend series={chartSeries} />
            <div className="mt-2">
              <BarChart label={`${def.label} ${curName} เทียบ ${prevName}`} categories={categories} tooltipTitles={titles} series={chartSeries}
                format={fmt} formatAxis={(v) => fmtMetric(def.kind === "hours" ? "int" : def.kind, v, true)} />
            </div>
            <TableView title="ดูเป็นตาราง">
              <Table>
                <TableHeader><TableRow><TableHead>{byTime ? (unit === "day" ? "วัน" : "เดือน") : "บัญชี"}</TableHead><TableHead className="text-right">{curName}</TableHead><TableHead className="text-right">{prevName}</TableHead><TableHead className="text-right">เปลี่ยน</TableHead></TableRow></TableHeader>
                <TableBody>
                  {categories.map((cat, i) => (
                    <TableRow key={i}>
                      <TableCell>{titles[i]}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(curVals[i])}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(prevVals[i])}</TableCell>
                      <TableCell className="text-right"><ChangeText cur={curVals[i]} prev={prevVals[i]} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableView>
          </section>

          <SessionList title={`ไลฟ์ใน ${curName} (${cur.length})`} sessions={cur} />
          <SessionList title={`ไลฟ์ใน ${prevName} (${prev.length})`} sessions={prev} />
        </>
      )}
    </>
  );
}

function SessionList({ title, sessions }: { title: string; sessions: LiveSession[] }) {
  if (!sessions.length) return null;
  return (
    <Collapsible className="group/sl my-2 rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]/sl:rotate-180" />{title}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-x-auto border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เริ่ม</TableHead><TableHead>บัญชี</TableHead><TableHead className="text-right">นาน</TableHead>
              <TableHead className="text-right">GMV</TableHead><TableHead className="text-right">ออเดอร์</TableHead><TableHead className="text-right">Viewers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={`${s.platform}${s.accountId}${s.startedAt}`}>
                <TableCell className="whitespace-nowrap">{bkkDateTime.format(new Date(s.startedAt))}</TableCell>
                <TableCell><span className="text-xs text-muted-foreground">{s.platform}</span> {s.accountName}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtDuration(s.durationSec)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMetric("baht", s.gmv)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.orders.toLocaleString("th-TH")}</TableCell>
                <TableCell className="text-right tabular-nums">{s.viewers.toLocaleString("th-TH")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CampaignDialog({ campaign, all, dataMonths, onClose, onSaved }: {
  campaign: Campaign | null;
  all: Campaign[];
  dataMonths: string[];
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const today = bkkLocal(new Date().toISOString()).slice(0, 10);
  const [name, setName] = useState(campaign?.name ?? "");
  const [start, setStart] = useState(campaign ? bkkLocal(campaign.startsAt) : `${today}T00:00`);
  const [end, setEnd] = useState(campaign ? bkkLocal(campaign.endsAt) : bkkLocal(new Date(Date.parse(fromBkkLocal(`${today}T00:00`)!) + 86400_000).toISOString()));
  // แคมเปญใหม่: พิมพ์ชื่อ "9.9" แล้วใส่วันให้เอง จนกว่าจะแก้วันเวลาเอง
  const [datesTouched, setDatesTouched] = useState(!!campaign);
  const [compareId, setCompareId] = useState(campaign?.compareId ? String(campaign.compareId) : "auto");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function changeName(v: string) {
    setName(v);
    const w = datesTouched ? null : windowFromName(v);
    if (w) { setStart(w.start); setEnd(w.end); }
  }

  const startsAt = fromBkkLocal(start), endsAt = fromBkkLocal(end);
  const invalid = !startsAt || !endsAt || endsAt <= startsAt;
  const auto = !invalid ? previousWindow(startsAt!, endsAt!) : null;
  const other = compareId === "auto" ? null : all.find((x) => String(x.id) === compareId);
  const missing = invalid ? [] : [...new Set([
    ...missingMonths(startsAt!, endsAt!, dataMonths),
    ...(auto && !other ? missingMonths(auto.from, auto.to, dataMonths) : other ? missingMonths(other.startsAt, other.endsAt, dataMonths) : []),
  ])];

  async function save() {
    if (!name.trim()) return toast("กรุณาใส่ชื่อแคมเปญ", "error");
    if (invalid) return toast("เวลาจบต้องหลังเวลาเริ่ม", "error");
    setBusy(true);
    try {
      const res = await api<{ id: number }>("/api/live-stats/campaigns", {
        id: campaign?.id, name, startsAt, endsAt, compareId: compareId === "auto" ? null : Number(compareId),
      });
      if (!res.ok) throw new Error(res.message);
      toast("บันทึกแคมเปญแล้ว");
      onSaved(res.id);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  }

  return (
    <AppDialog open onClose={onClose} busy={busy} title={campaign ? "แก้ไขแคมเปญ" : "เพิ่มแคมเปญ"} description="ไลฟ์นับเข้าแคมเปญตามเวลาเริ่มไลฟ์ (เวลาไทย)">
      <DialogBody className="space-y-3">
        <div>
          <Label htmlFor="cp-name" className="mb-1.5">ชื่อแคมเปญ</Label>
          <Input id="cp-name" value={name} maxLength={80} placeholder="เช่น 10.10" disabled={busy} onChange={(e) => changeName(e.target.value)} />
          {!campaign ? <p className="mt-1 text-xs text-muted-foreground">พิมพ์แบบ 9.9 / 25.12 ระบบใส่วันที่ของปีนี้ให้เอง (แก้ได้)</p> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="cp-start" className="mb-1.5">เริ่ม</Label>
            <Input id="cp-start" type="datetime-local" value={start} disabled={busy} onChange={(e) => { setDatesTouched(true); setStart(e.target.value); }} />
          </div>
          <div>
            <Label htmlFor="cp-end" className="mb-1.5">จบ (ไม่นับไลฟ์ที่เริ่มตั้งแต่เวลานี้)</Label>
            <Input id="cp-end" type="datetime-local" value={end} disabled={busy} onChange={(e) => { setDatesTouched(true); setEnd(e.target.value); }} />
          </div>
        </div>
        <div>
          <Label className="mb-1.5">เทียบกับ</Label>
          <Select value={compareId} onValueChange={setCompareId} disabled={busy}>
            <SelectTrigger aria-label="เทียบกับ" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="auto">ช่วงเดียวกันของเดือนก่อน (อัตโนมัติ)</SelectItem>
              {all.filter((x) => x.id !== campaign?.id).map((x) => <SelectItem key={x.id} value={String(x.id)}>แคมเปญ {x.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {compareId === "auto" && auto ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              จะเทียบกับ {windowText(auto.from, auto.to)}{auto.doubleDay ? " (วันเลขเบิ้ลของเดือนก่อน)" : ""}
            </p>
          ) : null}
        </div>
        {invalid ? <Notice variant="warning">เวลาจบต้องหลังเวลาเริ่ม</Notice> : null}
        {missing.length ? (
          <Notice variant="warning">ยังไม่มีข้อมูลเดือน {missing.join(", ")} (บันทึกได้ ตัวเลขจะขึ้นเมื่ออัปโหลดไฟล์ของเดือนนั้น) · {haveText(dataMonths)}</Notice>
        ) : null}
      </DialogBody>
      <DialogActions>
        <Button variant="outline" disabled={busy} onClick={onClose}>ยกเลิก</Button>
        <Button disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button>
      </DialogActions>
    </AppDialog>
  );
}

// ---------- อัปโหลดไฟล์ Export ----------

type Picked = { name: string; parsed?: ParsedFile; error?: string };

function UploadView({ months, onChanged }: { months: MonthRow[]; onChanged: () => void }) {
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();

  async function pick(list: FileList | null) {
    const out: Picked[] = [];
    for (const f of Array.from(list ?? [])) {
      try {
        out.push({ name: f.name, parsed: parseRows(readXlsx(new Uint8Array(await f.arrayBuffer()))) });
      } catch (err) {
        out.push({ name: f.name, error: (err as Error).message });
      }
    }
    setFiles(out);
  }

  const ready = files.filter((f) => f.parsed?.sessions.length);
  async function save() {
    setBusy(true);
    let inserted = 0, updated = 0;
    try {
      for (const f of ready) {
        const list = f.parsed!.sessions;
        for (let i = 0; i < list.length; i += 500) {
          const res = await api<{ inserted: number; updated: number }>("/api/live-stats", { fileName: f.name, sessions: list.slice(i, i + 500) });
          if (!res.ok) throw new Error(`${f.name}: ${res.message}`);
          inserted += res.inserted;
          updated += res.updated;
        }
      }
      toast(`บันทึกแล้ว: ไลฟ์ใหม่ ${inserted} / อัปเดต ${updated}`);
      setFiles([]);
      setInputKey((k) => k + 1);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMonth(platform: string, month: string, lives: number) {
    if (!(await confirm({
      title: `ลบข้อมูล ${platform} ${monthLabel(month)}?`,
      description: `ลบ ${lives} ไลฟ์ของเดือนนี้ (ใช้เมื่ออัปไฟล์ผิด แล้วอัปไฟล์ที่ถูกใหม่) กู้คืนไม่ได้`,
      confirmText: "ลบ", destructive: true,
    }))) return;
    try {
      const res = await api<{ deleted: number }>("/api/live-stats", { platform, month }, "DELETE");
      if (!res.ok) throw new Error(res.message);
      toast(`ลบแล้ว ${res.deleted} ไลฟ์`);
      onChanged();
    } catch (err) { toast((err as Error).message, "error"); }
  }

  const monthKeys = [...new Set(months.map((m) => m.month))];
  return (
    <>
      <Notice>
        TikTok: LIVE Center / Seller Center &gt; ข้อมูลไลฟ์ &gt; รายการไลฟ์ &gt; Export · Shopee: Seller Centre &gt; Shopee Live &gt; ข้อมูลไลฟ์ &gt; Export
        <br />อัปไฟล์เดือนเดิมซ้ำได้ ระบบอัปเดตไลฟ์เดิม (บัญชี + เวลาเริ่มเดียวกัน) ไม่นับซ้ำ
      </Notice>
      <div className="my-3 rounded-2xl border bg-card p-3">
        <Label htmlFor="live-file" className="mb-1.5">เลือกไฟล์ Excel (.xlsx) เลือกได้หลายไฟล์</Label>
        <Input key={inputKey} id="live-file" type="file" multiple disabled={busy}
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => pick(e.target.files)} />
        {files.map((f) => <FilePreview key={f.name} file={f} />)}
        {ready.length ? (
          <DialogActions className="mt-3">
            <Button variant="outline" disabled={busy} onClick={() => { setFiles([]); setInputKey((k) => k + 1); }}>ล้าง</Button>
            <Button disabled={busy} onClick={save}>
              <UploadIcon />{busy ? "กำลังบันทึก…" : `บันทึก ${ready.reduce((a, f) => a + f.parsed!.sessions.length, 0)} ไลฟ์`}
            </Button>
          </DialogActions>
        ) : null}
      </div>

      <h2 className="mt-5 mb-2 text-lg font-bold">ข้อมูลที่มีในระบบ</h2>
      {monthKeys.length ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>เดือน</TableHead><TableHead>TikTok</TableHead><TableHead>Shopee</TableHead></TableRow></TableHeader>
            <TableBody>
              {monthKeys.map((m) => (
                <TableRow key={m}>
                  <TableCell className="font-medium">{monthLabel(m)}</TableCell>
                  {(["TikTok", "Shopee"] as const).map((p) => {
                    const row = months.find((x) => x.month === m && x.platform === p);
                    return (
                      <TableCell key={p}>
                        {row ? (
                          <span className="inline-flex items-center gap-1.5 tabular-nums">
                            {row.lives} ไลฟ์ · {fmtMetric("baht", row.gmv, true)}
                            <Button variant="ghost" size="icon-sm" aria-label={`ลบข้อมูล ${p} ${monthLabel(m)}`} title="ลบข้อมูลเดือนนี้"
                              className="text-muted-foreground hover:text-destructive" onClick={() => removeMonth(p, m, row.lives)}>
                              <Trash2Icon />
                            </Button>
                          </span>
                        ) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <StateBox title="ยังไม่มีข้อมูล">เลือกไฟล์ด้านบนแล้วกดบันทึก</StateBox>}
    </>
  );
}

function FilePreview({ file }: { file: Picked }) {
  if (file.error || !file.parsed) {
    return <Notice variant="warning" icon title={file.name} className="mt-3">{file.error}</Notice>;
  }
  const { platform, sessions, skipped } = file.parsed;
  const times = sessions.map((s) => s.startedAt).sort();
  const t = totalsOf(sessions);
  return (
    <div className="mt-3 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <FileSpreadsheetIcon className="size-4 text-muted-foreground" />
        <strong className="min-w-0 truncate">{file.name}</strong>
        <Badge className={cn("font-semibold", platform === "TikTok" ? "bg-p2/15 text-p2" : "bg-p1/15 text-p1")}>{platform}</Badge>
      </div>
      {sessions.length ? (
        <div className="mt-1.5 text-muted-foreground">
          {sessions.length} ไลฟ์ · {windowText(times[0], times[times.length - 1])} · GMV {fmtMetric("baht", t.gmv)}
          <br />บัญชี: {accountsOf(sessions).map((a) => a.name).join(", ")}
        </div>
      ) : <div className="mt-1.5 text-destructive">ไม่พบไลฟ์ในไฟล์นี้</div>}
      {skipped.length ? (
        <TableView title={`ข้าม ${skipped.length} แถว`}>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {skipped.map((s) => <li key={s.row}>แถว {s.row}: {s.reason}</li>)}
          </ul>
        </TableView>
      ) : null}
    </div>
  );
}
