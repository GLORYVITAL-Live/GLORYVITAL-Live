"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, FileSpreadsheetIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import {
  accountLabel, accountsOf, bkkIso, bkkLocal, bkkParts, filterSessions, fmtMetric, fromBkkLocal, METRICS, metricOf, monthOf, monthWindow, parseRows,
  previousWindow, readXlsx, totalsOf, type Campaign, type LiveSession, type MetricKey, type ParsedFile, type Platform, type Totals,
} from "@/lib/live-stats";
import { fmtDayMonth, fmtMonthShort, fmtWeekShort, monthKey, monthLabel, parseKey } from "@/lib/format";
import { useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { bkkStamp, compareBook, deltaOf, filterText, monthBook, MULTI_ORDER, multiBook, singleBook, yearBook, type CrewMap } from "@/lib/live-export";
import { dailyByPlatform, isStackable, platformSeries, totalSeries } from "@/lib/live-lines";
import { breakdownRows, mainLeg, type BreakdownRow } from "@/lib/live-breakdown";
import { DAY_KINDS, dayKindLabel, dayKindStats, liveDay, tagKey, type DayTag } from "@/lib/live-days";
import { HEAT_MIN_SEC, HEAT_WEEKDAY_NAMES, HEAT_WEEKDAYS, heatGrid, heatHour, heatPerHour, heatTop, type HeatCell } from "@/lib/live-heat";
import { AGENCY_OURS, agencySharesOf, agencyTrend, mergePlatforms, splitByOwner, type AgencyTrend, type ChannelSplit, type OwnerSpan } from "@/lib/live-owners";
import { ownerText } from "@/lib/plan-clash";
import { buildCompareDeck, buildMultiDeck } from "@/lib/live-slides";
import { monthDays, targetReport, targetsInScope, type LiveTarget } from "@/lib/live-targets";
import { DatePicker } from "@/components/date-picker";
import { ExportMenu, SlidesMenu } from "@/components/ExportMenu";
import { MonthPicker, monthsIn, rangeLabel, type MonthRange } from "@/components/MonthPicker";
import { BarChart, ChangeText, Legend, LineChart, PairBars, TableView } from "@/components/LiveCharts";
import { CountUp } from "@/components/motion";
import { CeoLive } from "@/components/CeoLive";
import { STICKY_CELL, STICKY_HEAD } from "@/components/SortHead";
import dynamic from "next/dynamic";
import { DayTarget, TargetPanel } from "@/components/LiveTargets";
import {
  AppDialog, DialogActions, DialogBody, IconButton, LoadError, LoadingBlock, Notice, StateBox, api, useConfirm, useToast,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// หน้าสถิติไลฟ์ (Owner): ภาพรวม / เทียบช่วง (รายเดือน ทั้งปี วัน ช่วงวัน เดือน ไตรมาส หลายเดือน) | เทียบแคมเปญ | CEO Live | อัปโหลดไฟล์ Export

type MonthRow = { month: string; platform: string; lives: number; gmv: number };

const TAB_KEY = "glory_live_stats_tab";
/** แท็บ Cost / ROI = หน้า Cost ทั้งหน้า (โหลดเมื่อเปิดแท็บ) */
const CostPage = dynamic(() => import("@/components/CostPage").then((m) => m.CostPage), { loading: () => <LoadingBlock /> });
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
/**
 * ใครไลฟ์ / แคมเปญ ของไลฟ์ในรายการ (ใช้ตอนส่งออก) โหลดไม่สำเร็จ = null (ยังส่งออกได้ คอลัมน์คนไลฟ์ว่าง)
 */
async function loadCrew(list: LiveSession[]): Promise<CrewMap> {
  if (!list.length) return {};
  let lo = Infinity, hi = -Infinity;
  for (const s of list) { const t = Date.parse(s.startedAt); if (t < lo) lo = t; if (t > hi) hi = t; }
  try {
    const res = await api<{ crew: CrewMap }>(`/api/live-stats/crew?from=${encodeURIComponent(new Date(lo).toISOString())}&to=${encodeURIComponent(new Date(hi + 1000).toISOString())}`);
    return res.ok ? res.crew : null;
  } catch {
    return null;
  }
}

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

/**
 * หน้า Analytics = สถิติไลฟ์ + แท็บ Cost / ROI (หน้า Cost เดิมทั้งหน้า)
 *   analytics = เห็นสถิติไลฟ์ · readOnly = ดูได้อย่างเดียว (ไม่มีแท็บอัปโหลด / แก้แคมเปญไม่ได้ แต่ส่งออกได้)
 *   cost = เห็นแท็บ Cost (ตัวเลขเงิน) · ไม่มีสิทธิ์สถิติไลฟ์ = มีแค่ Cost
 */
export function LiveStats({ readOnly = false, analytics = true, cost = false }: { readOnly?: boolean; analytics?: boolean; cost?: boolean }) {
  const saved = useLocal(TAB_KEY);
  const tab = (saved === "cost" && cost) || saved === "campaign" || saved === "ceo" || (saved === "upload" && !readOnly) ? saved! : "overview";
  const [months, setMonths] = useState<MonthRow[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // บันทึก/ลบข้อมูลแล้ว = เลขนี้เปลี่ยน กราฟโหลดใหม่
  const [version, setVersion] = useState(0);
  const onError = (err: unknown) => setError((err as Error).message);

  useEffect(() => {
    if (!analytics) return;
    Promise.all([fetchMonths(), fetchCampaigns()])
      .then(([m, c]) => { setMonths(m); setCampaigns(c); setError(""); })
      .catch((err) => setError((err as Error).message));
  }, [attempt, analytics]);

  if (!analytics) return <div className="pt-3"><CostPage /></div>;

  const tabs: [string, ReactNode][] = [
    ["overview", "ภาพรวม / เทียบ"],
    ...(cost ? [["cost", <><span className="sm:hidden">Cost</span><span className="max-sm:hidden">Cost / ROI</span></>] as [string, ReactNode]] : []),
    ["campaign", "แคมเปญ"], ["ceo", "CEO Live"], ...(readOnly ? [] : [["upload", "อัปโหลด"] as [string, ReactNode]]),
  ];
  const dataMonths = months ? [...new Set(months.map((m) => m.month))] : [];
  const empty = <EmptyData readOnly={readOnly} />;
  // แท็บสถิติไลฟ์รอข้อมูลเดือน / แคมเปญ · แท็บ Cost ใช้ได้เลยไม่ต้องรอ
  const stats = (body: () => ReactNode) => (error
    ? <LoadError title="โหลดสถิติไลฟ์ไม่สำเร็จ" message={error} onRetry={() => setAttempt((n) => n + 1)} />
    : !months || !campaigns ? <LoadingBlock /> : body());
  return (
    <Tabs value={tab} onValueChange={(v) => writeLocal(TAB_KEY, v)} className="gap-0 pb-10">
      <TabsList aria-label="เมนู Analytics" className="my-3 h-auto! w-full rounded-full border bg-card p-1">
        {tabs.map(([id, label]) => (
          // มือถือ: แท็บทั้งหมดต้องพอดีแถวเดียว (ระยะข้างแคบลง)
          <TabsTrigger key={id} value={id} className="rounded-full py-1.5 text-[13px] font-semibold data-active:bg-tint! data-active:text-tint-foreground! max-sm:px-1 max-sm:text-[12.5px] sm:text-sm">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview">
        {stats(() => (months!.length ? <Overview latest={months![0].month} dataMonths={dataMonths} version={version} readOnly={readOnly} /> : empty))}
      </TabsContent>
      {cost ? <TabsContent value="cost"><CostPage /></TabsContent> : null}
      <TabsContent value="campaign">
        {stats(() => <CampaignView campaigns={campaigns!} dataMonths={dataMonths} version={version} readOnly={readOnly} onChanged={() => fetchCampaigns().then(setCampaigns, onError)} />)}
      </TabsContent>
      {/* หน้าเดียวกับที่บัญชี Marketing เห็น */}
      <TabsContent value="ceo"><CeoLive key={version} /></TabsContent>
      {readOnly ? null : (
        <TabsContent value="upload">
          {stats(() => <UploadView months={months!} onChanged={() => { setVersion((v) => v + 1); fetchMonths().then(setMonths, onError); }} />)}
        </TabsContent>
      )}
    </Tabs>
  );
}

function EmptyData({ readOnly }: { readOnly: boolean }) {
  return (
    <StateBox
      title="ยังไม่มีข้อมูลไลฟ์"
      action={readOnly ? undefined : <Button onClick={() => writeLocal(TAB_KEY, "upload")}><UploadIcon />ไปที่อัปโหลดข้อมูล</Button>}
    >
      {readOnly ? "ยังไม่มีคนอัปโหลดไฟล์ Export จาก TikTok LIVE / Shopee Live" : "อัปโหลดไฟล์ Export จาก TikTok LIVE / Shopee Live ก่อน แล้วกลับมาดูสรุปที่นี่"}
    </StateBox>
  );
}

// ---------- ตัวกรอง แพลตฟอร์ม / บัญชี ----------

/** initial = แพลตฟอร์ม / บัญชี ("แพลตฟอร์ม|รหัสบัญชี") ที่เลือกไว้ตอนเปิด (ไม่ใส่ = ทุกบัญชี) */
function useFilter(initial: { platform?: Platform | ""; account?: string } = {}) {
  const [platform, setPlatform] = useState<Platform | "">(() => initial.platform || (initial.account?.split("|")[0] as Platform) || "");
  const [account, setAccount] = useState(initial.account ?? "");
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
            className="rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!"
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
            {accounts.map((a) => <SelectItem key={a.key} value={a.key}>{filter.platform ? a.name : accountLabel(a)}</SelectItem>)}
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

/** ส่วนต่างตามหน่วยของตัวชี้วัด (ไม่ใส่เครื่องหมาย) · ค่าที่เป็น % = pp */
const gapText = (kind: (typeof METRICS)[number]["kind"], g: number) => (kind === "pct" ? `${(g * 100).toFixed(2)}pp` : fmtMetric(kind, g));

/** การ์ดตัวชี้วัด + % เทียบกับช่วงอื่น (เช่น MoM / YoY) */
function KpiGrid({ cur, compare }: { cur: Totals; compare: { totals: Totals; label: string }[] }) {
  return (
    <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {METRICS.map((m, i) => {
        const v = m.value(cur);
        return (
          // มือถือ 2 คอลัมน์: จำนวนช่องเป็นเลขคี่ = ช่องสุดท้ายเต็มแถว (ไม่เหลือช่องว่าง)
          <div key={m.key} className={cn("rounded-xl border bg-card px-3 py-2.5", METRICS.length % 2 && i === METRICS.length - 1 && "col-span-2 sm:col-span-1")}>
            <div className="text-xs text-muted-foreground">{m.label}{m.note ? <span className="opacity-80"> · {m.note}</span> : null}</div>
            {/* ตัวเลขนับจากค่าเดิมไปค่าใหม่ (ตอนโหลด / เปลี่ยนตัวกรอง) */}
            <div className="text-lg font-bold">{v === null ? fmtMetric(m.kind, v) : <CountUp value={v} format={(n) => fmtMetric(m.kind, n)} />}</div>
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

/** โหมดของแท็บภาพรวม / เทียบ: ดูภาพรวม หรือเทียบ (cmp-month = เทียบเดือน แยกจาก month = ภาพรวมรายเดือน) */
type OverviewMode = "month" | "year" | "day" | "range" | "cmp-month" | "quarter" | "multi";
const VIEW_MODES: [OverviewMode, string][] = [["month", "รายเดือน"], ["year", "ทั้งปี"]];
// [โหมด, ชื่อเต็ม, ชื่อสั้นบนมือถือ, คำอธิบายในเมนู]
const COMPARE_MODES: [OverviewMode, string, string, string][] = [
  ["day", "วัน", "วัน", "วันต่อวัน · วันก่อน / สัปดาห์ก่อน / เดือนก่อน"],
  ["range", "ช่วงวันที่", "ช่วงวัน", "เลือกช่วงวันที่เอง · ช่วงก่อนหน้า / เดือนก่อน / หลายเดือน"],
  ["cmp-month", "เดือน (MoM)", "เดือน", "เดือนต่อเดือน หรือเดือนเดียวกันปีก่อน (YoY)"],
  ["quarter", "ไตรมาส (QoQ)", "ไตรมาส", "ไตรมาสต่อไตรมาส หรือไตรมาสเดียวกันปีก่อน (YoY)"],
  ["multi", "หลายเดือน", "หลายเดือน", "ค่าหลายเดือนเรียงกัน (ไม่เกิน 12 เดือน)"],
];
const MODE_PILL = "rounded-full! text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!";

/**
 * ภาพรวม + เทียบช่วงอยู่หน้าเดียวกัน: แถบเดียว "รายเดือน | ทั้งปี | เทียบ ▾" (จำโหมดล่าสุดไว้ในเครื่อง)
 *   เทียบทุกแบบรวมอยู่ในปุ่มเดียว กดแล้วเลือกแบบเทียบจากเมนู (ผู้ใช้ขอ 2026-11-10 แทนปุ่มแยก 5 ปุ่ม)
 */
function Overview({ latest, dataMonths, version, readOnly }: { latest: string; dataMonths: string[]; version: number; readOnly: boolean }) {
  const saved = useLocal(OVERVIEW_KEY) as OverviewMode | null;
  const mode: OverviewMode = saved && [...VIEW_MODES, ...COMPARE_MODES].some(([id]) => id === saved) ? saved : "month";
  const [menu, setMenu] = useState(false);
  const pick = (v: string) => { if (v) writeLocal(OVERVIEW_KEY, v); };
  const cmp = COMPARE_MODES.find(([id]) => id === mode);
  return (
    <>
      <div className="mb-1 flex w-fit max-w-full items-center gap-0.5 rounded-full border bg-card p-1">
        <ToggleGroup type="single" spacing={1} value={cmp ? "" : mode} onValueChange={pick} aria-label="ดูภาพรวมแบบ">
          {VIEW_MODES.map(([id, text]) => <ToggleGroupItem key={id} value={id} className={cn(MODE_PILL, "px-3 sm:px-4")}>{text}</ToggleGroupItem>)}
        </ToggleGroup>
        <Popover open={menu} onOpenChange={setMenu}>
          <PopoverTrigger asChild>
            <button
              type="button" aria-label={cmp ? `เทียบแบบ ${cmp[1]} (เปลี่ยนแบบเทียบ)` : "เทียบ: เลือกแบบเทียบ"}
              className={cn(
                "inline-flex h-8 min-w-0 items-center gap-1 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap text-muted-foreground transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-9",
                cmp && "bg-tint text-tint-foreground hover:bg-tint hover:text-tint-foreground",
              )}
            >
              เทียบ{cmp ? <>: <span className="sm:hidden">{cmp[2]}</span><span className="max-sm:hidden">{cmp[1]}</span></> : null}
              <ChevronDownIcon className="size-4 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-1">
            {COMPARE_MODES.map(([id, text, , desc]) => (
              <Button
                key={id} variant="ghost" aria-pressed={id === mode}
                className={cn("h-auto w-full justify-start gap-2.5 py-2 text-left whitespace-normal", id === mode && "bg-muted")}
                onClick={() => { pick(id); setMenu(false); }}
              >
                <CheckIcon className={cn("size-4 shrink-0", id !== mode && "invisible")} />
                <span><span className="block font-semibold">{text}</span><span className="text-xs font-normal text-muted-foreground">{desc}</span></span>
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      {mode === "year" ? <YearOverview latest={latest} dataMonths={dataMonths} version={version} />
        : mode === "multi" ? <MultiMonthView dataMonths={dataMonths} version={version} />
          : mode === "day" ? <DayCompare dataMonths={dataMonths} version={version} />
            : mode === "range" ? <RangeCompare dataMonths={dataMonths} version={version} />
              : mode === "cmp-month" ? <PairCompare kind="month" dataMonths={dataMonths} version={version} />
                : mode === "quarter" ? <PairCompare kind="quarter" dataMonths={dataMonths} version={version} />
                  : <MonthOverview latest={latest} dataMonths={dataMonths} version={version} readOnly={readOnly} />}
    </>
  );
}

function MonthOverview({ latest, dataMonths, version, readOnly }: { latest: string; dataMonths: string[]; version: number; readOnly: boolean }) {
  const [month, setMonth] = useState(latest);
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const filter = useFilter();
  const months13 = useMemo(() => Array.from({ length: 13 }, (_, i) => monthKey(i - 12, month)), [month]);
  const { data, error, retry } = useSessions(monthWindow(months13[0]).from, monthWindow(month).to, version);
  const owners = useOwnerSpans(`from=${months13[0]}&to=${month}`, version);
  const dayTags = useDayTags(`month=${month}`, version);
  const [monthSplit, setMonthSplit] = useState<Split>("platform");

  const nav = (
    <div className="my-2 flex items-center justify-between gap-3">
      <IconButton label="เดือนก่อนหน้า" onClick={() => setMonth(monthKey(-1, month))}><ChevronLeftIcon /></IconButton>
      <MonthPicker mode="single" value={{ from: month, to: month }} onChange={(r) => setMonth(r.from)} marked={dataMonths} />
      <IconButton label="เดือนถัดไป" onClick={() => setMonth(monthKey(1, month))}><ChevronRightIcon /></IconButton>
    </div>
  );
  if (!data) return <>{nav}{error ? <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={retry} /> : <LoadingBlock />}</>;

  const list = filterSessions(data, filter.platform, filter.account);
  const byMonth = new Map<string, LiveSession[]>(months13.map((m) => [m, []]));
  for (const s of list) byMonth.get(monthOf(s.startedAt))?.push(s);
  const totals = new Map(months13.map((m) => [m, totalsOf(byMonth.get(m)!)]));
  const cur = totals.get(month)!;
  const prevKey = monthKey(-1, month), yoyKey = monthKey(-12, month);
  // เดือนที่ยังไม่จบ: เทียบเดือนก่อน / ปีก่อน ถึงวันเดียวกัน (เดิมเทียบทั้งเดือน = ขึ้นแดงเกินจริง)
  //   นับถึงวันของไลฟ์ล่าสุดที่อัปโหลดแล้วในเดือนนี้ (ทุกบัญชี) — แบบเดียวกับหน้า "ทั้งปี" ที่ตัดปีก่อนถึงวันเดียวกัน
  const ongoing = month === monthKey();
  const lastDay = ongoing
    ? Math.max(0, ...data.filter((s) => monthOf(s.startedAt) === month).map((s) => bkkParts(s.startedAt).d))
    : 0;
  const upTo = (l: LiveSession[]) => (ongoing && lastDay ? l.filter((s) => bkkParts(s.startedAt).d <= lastDay) : l);
  const prevList = upTo(byMonth.get(prevKey)!);
  const prev = totalsOf(prevList), yoy = totalsOf(upTo(byMonth.get(yoyKey)!));
  const cutText = ongoing && lastDay ? ` 1–${lastDay}` : "";
  const def = metricOf(metric);
  const fmt = (v: number | null) => fmtMetric(def.kind, v);
  // เปลี่ยนเดือน / ตัวกรอง = กราฟแท่งโตขึ้นใหม่
  const replay = `${month}|${filter.platform}|${filter.account}`;
  const monthSeries = platformLines(months13.map((m) => byMonth.get(m)!), metric);
  const monthAgency = owners.spans ? agencyTrend(months13.map((m) => byMonth.get(m)!), owners.spans) : null;
  const monthByAgency = monthSplit === "agency" && hasAgency(monthAgency);
  const monthCategories = months13.map((m) => `${shortMonth(m)}${ongoing && m === month ? "*" : ""}`);
  const monthTitles = months13.map((m) => `${monthLabel(m)}${ongoing && m === month ? ` (ยังไม่จบเดือน ถึงวันที่ ${lastDay})` : ""}`);

  // สไลด์: ครบเหมือนหน้าเว็บ (เป้า + รายวัน + 13 เดือน + กลุ่มผู้ไลฟ์) · โหลดเป้า / แพลนไม่ได้ = ไม่มีหน้านั้น สไลด์ส่วนอื่นยังออกได้
  const buildSlides = async (target: "pptx" | "gslides") => {
    const curList = byMonth.get(month)!;
    const dayOf = (s: LiveSession) => bkkParts(s.startedAt).d;
    const [targets, owners] = await Promise.all([
      api<{ targets: LiveTarget[] }>(`/api/live-stats/targets?month=${month}`).then((r) => (r.ok ? r.targets : [])).catch(() => [] as LiveTarget[]),
      api<{ spans: OwnerSpan[] }>(`/api/live-stats/owners?from=${months13[0]}&to=${month}`).then((r) => (r.ok ? r.spans : [])).catch(() => [] as OwnerSpan[]),
    ]);
    const dayGroups = monthDays(month).map((d) => curList.filter((s) => dayOf(s) === Number(d.slice(8))));
    const scope = targetsInScope(targets, filter.platform, filter.account);
    const names = new Map(accountsOf(data).map((a) => [a.key, accountLabel(a)]));
    const prevName = `${shortMonth(prevKey)}${cutText}`;
    return buildCompareDeck({
      report: "รายเดือน", aName: monthLabel(month), bName: prevName, aRange: ongoing && lastDay ? `1–${lastDay} ${shortMonth(month)}` : monthLabel(month), bRange: prevName,
      a: curList, b: prevList, timeName: "รายวัน",
      time: monthDays(month).map((d) => {
        const n = Number(d.slice(8));
        return { short: String(n), a: curList.filter((s) => dayOf(s) === n), b: prevList.filter((s) => dayOf(s) === n) };
      }),
      filterText: filterText({ platform: filter.platform, account: filter.account, sessions: data }).join(" · "),
      exportedAt: bkkStamp(new Date().toISOString()),
      cover: { kicker: `รายเดือน${ongoing ? " (ยังไม่จบเดือน)" : ""}`, headline: monthLabel(month) },
      platformTime: true,
      months: months13.map((m) => ({ short: `${shortMonth(m)}${ongoing && m === month ? "*" : ""}`, a: byMonth.get(m)! })),
      target: scope.length ? { report: targetReport(scope, list, month, lastDay), lastDay, names } : undefined,
      owners: splitByOwner(curList, owners),
      agency: [
        { title: "GMV รายวัน แยก Agency", labels: monthDays(month).map((d) => String(Number(d.slice(8)))), trend: agencyTrend(dayGroups, owners), lineTitle: "GMV/ชม. รายวัน แยก Agency" },
        { title: "GMV รายเดือน (13 เดือน) แยก Agency", labels: monthCategories, trend: agencyTrend(months13.map((m) => byMonth.get(m)!), owners) },
      ],
      // เหมือนหน้าเว็บ: เทียบรายกลุ่ม / รายบัญชีกับเดือนก่อน + ช่วงเวลาขายดี + วันปกติ vs วันแคมเปญ
      breakdown: { spans: owners },
      heat: { title: `ช่วงเวลาไหนขายดี ${monthLabel(month)}` },
      dayKinds: dayTags.tags ? { title: `วันปกติ vs วันแคมเปญ ${monthLabel(month)}`, tags: dayTags.tags } : undefined,
    }, target);
  };

  return (
    <>
      {nav}
      <FilterBar filter={filter} sessions={data}>
        <div className="flex flex-wrap gap-2">
          <ExportMenu size="sm" label="ส่งออก" build={async () => monthBook({
            month, monthLabel, months13, byMonth, filter: { platform: filter.platform, account: filter.account, sessions: data },
            crew: await loadCrew(byMonth.get(month) ?? []),
            // ให้ครบเหมือนหน้าเว็บ: กลุ่มผู้ไลฟ์ / เทียบรายกลุ่ม / แยก Agency / ช่วงเวลาขายดี / วันแคมเปญ
            extras: {
              spans: owners.spans ?? null, owners: true, heat: true, tags: dayTags.tags ?? null,
              breakdown: { b: prevList, aName: `${shortMonth(month)}${cutText}`, bName: `${shortMonth(prevKey)}${cutText}` },
              agency: owners.spans ? [
                { name: "แยก Agency รายวัน", first: "วันที่", labels: monthDays(month), trend: agencyTrend(monthDays(month).map((d) => (byMonth.get(month) ?? []).filter((s) => bkkParts(s.startedAt).d === Number(d.slice(8)))), owners.spans) },
                { name: "แยก Agency 13 เดือน", first: "เดือน", labels: months13.map(monthLabel), trend: agencyTrend(months13.map((m) => byMonth.get(m)!), owners.spans) },
              ] : undefined,
            },
          })} />
          {cur.lives ? <SlidesMenu label="สไลด์" title={`GLORY รายเดือน ${monthLabel(month)}`} build={buildSlides} /> : null}
        </div>
      </FilterBar>
      {/* เป้าหมาย GMV + % achieve (ตั้งเป้าล่วงหน้าได้ แม้เดือนนี้ยังไม่มีข้อมูล) */}
      <TargetPanel month={month} sessions={data} platform={filter.platform} account={filter.account} lastDay={lastDay} readOnly={readOnly} />
      {!cur.lives ? (
        <StateBox title={`ไม่มีข้อมูลไลฟ์ ${monthLabel(month)}`}>ลองเปลี่ยนเดือน / แพลตฟอร์ม หรืออัปโหลดไฟล์ของเดือนนี้</StateBox>
      ) : (
        <>
          {ongoing ? (
            <p className="mt-2 text-xs text-muted-foreground">
              ข้อมูลถึงวันที่ {lastDay} {shortMonth(month).split(" ")[0]} (ยังไม่จบเดือน) · MoM / YoY เทียบวันที่ 1–{lastDay} ของเดือนก่อน / ปีก่อน
            </p>
          ) : null}
          <KpiGrid cur={cur} compare={[
            { totals: prev, label: `MoM vs ${shortMonth(prevKey)}${cutText}` },
            { totals: yoy, label: `YoY vs ${shortMonth(yoyKey)} ${yoyKey.slice(2, 4)}${cutText}` },
          ]} />
          <Funnel cur={byMonth.get(month)!} prev={prevList} prevLabel={`${shortMonth(prevKey)}${cutText}`} />
          <DailySection
            month={month} sessions={byMonth.get(month)!} metric={metric} onMetric={setMetric} replay={replay} spans={owners.spans}
            tagText={(d) => dayTagText(dayTags.tags, `${month}-${String(d).padStart(2, "0")}`, filter.platform)}
          />
        </>
      )}

      <section className="my-4 rounded-2xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{monthByAgency ? "GMV รายเดือน (13 เดือน) แยก Agency" : `${def.label} รายเดือน (13 เดือน)`}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {hasAgency(monthAgency) ? <SplitTabs value={monthByAgency ? "agency" : "platform"} onChange={setMonthSplit} /> : null}
            {monthByAgency ? null : <MetricSelect value={metric} onChange={setMetric} />}
          </div>
        </div>
        {monthByAgency ? (
          <AgencyBars trend={monthAgency!} categories={monthCategories} titles={monthTitles} label="GMV รายเดือน แยก Agency" rowHead="เดือน" replay={replay} highlight={12} />
        ) : (
          <PlatformBars
            series={monthSeries} metric={metric} replay={replay}
            label={`${def.label} รายเดือน`}
            categories={monthCategories}
            titles={monthTitles}
            highlight={12}
          />
        )}
        {ongoing ? <p className="mt-1 text-xs text-muted-foreground">* {monthLabel(month)} ยังไม่จบเดือน (ข้อมูลถึงวันที่ {lastDay}) แท่งจึงยังต่ำกว่าเดือนเต็ม</p> : null}
        {monthByAgency ? null : <TableView title="ดูเป็นตาราง">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เดือน</TableHead><TableHead className="text-right">{def.label}</TableHead>
                {monthSeries.length > 1 ? monthSeries.map((s) => <TableHead key={s.name} className="text-right">{s.name}</TableHead>) : null}
                <TableHead className="text-right">MoM</TableHead><TableHead className="text-right">ไลฟ์</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months13.slice().reverse().map((m) => {
                const t = totals.get(m)!;
                const at = months13.indexOf(m);
                const open = ongoing && m === month; // เดือนนี้ยังไม่จบ = เทียบเดือนก่อนถึงวันเดียวกัน
                const before = open ? prev : totals.get(monthKey(-1, m)) ?? totalsOf([]);
                return (
                  <TableRow key={m}>
                    <TableCell>{monthLabel(m)}{open ? <span className="text-xs text-muted-foreground"> (ถึงวันที่ {lastDay})</span> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.lives ? fmt(def.value(t)) : "-"}</TableCell>
                    {monthSeries.length > 1 ? monthSeries.map((s) => <TableCell key={s.name} className="text-right tabular-nums">{fmt(s.values[at])}</TableCell>) : null}
                    <TableCell className="text-right">{t.lives ? <ChangeText cur={def.value(t)} prev={before.lives ? def.value(before) : null} /> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.lives}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableView>}
      </section>

      {cur.lives ? <LineSection month={month} sessions={byMonth.get(month)!} replay={replay} spans={owners.spans} /> : null}
      {cur.lives ? <HeatSection title={`ช่วงเวลาไหนขายดี ${monthLabel(month)}`} sessions={byMonth.get(month)!} spans={owners.spans} /> : null}
      {cur.lives ? <DayKindSection title={`วันปกติ vs วันแคมเปญ ${monthLabel(month)}`} sessions={byMonth.get(month)!} tags={dayTags.tags} ready={dayTags.ready} replay={replay} /> : null}
      {cur.lives ? <OwnerTable owners={owners} sessions={byMonth.get(month)!} /> : null}
      {cur.lives && prev.lives ? (
        <BreakdownSection a={byMonth.get(month)!} b={prevList} curName={`${shortMonth(month)}${cutText}`} prevName={`${shortMonth(prevKey)}${cutText}`} spans={owners.spans} replay={replay} />
      ) : null}
      {cur.lives ? <AccountTable cur={byMonth.get(month)!} prev={prevList} prevLabel={`${shortMonth(prevKey)}${cutText}`} /> : null}
    </>
  );
}

// ---------- Funnel: ยอดมาจากไหน ----------

type FunnelStep = { label: string; value: (t: Totals) => number | null; kind: "int" | "pct" | "baht"; rate?: boolean; why?: [string, string] };
const ratioOf = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : a / b);
/** ขั้นของแต่ละแพลตฟอร์ม: ขั้นหลัก (จำนวน) สลับกับอัตรา (rate) · why = คำอธิบายเมื่อขั้นนั้นทำให้ยอดเปลี่ยน [ลดลง, เพิ่มขึ้น] */
const FUNNEL_STEPS: Record<Platform, FunnelStep[]> = {
  TikTok: [
    { label: "Product Impressions", value: (t) => t.impressions, kind: "int", why: ["คนเห็นสินค้าน้อยลง", "คนเห็นสินค้ามากขึ้น"] },
    { label: "CTR", value: (t) => ratioOf(t.clicks, t.impressions), kind: "pct", rate: true, why: ["คนคลิกสินค้าน้อยลง", "คนคลิกสินค้ามากขึ้น"] },
    { label: "คลิก", value: (t) => t.clicks, kind: "int" },
    { label: "CO", value: (t) => ratioOf(t.orders, t.clicks), kind: "pct", rate: true, why: ["คลิกแล้วซื้อน้อยลง", "คลิกแล้วซื้อมากขึ้น"] },
    { label: "ออเดอร์", value: (t) => t.orders, kind: "int" },
    { label: "มูลค่าต่อออเดอร์", value: (t) => ratioOf(t.gmv, t.orders), kind: "baht", rate: true, why: ["มูลค่าต่อออเดอร์ลดลง", "มูลค่าต่อออเดอร์เพิ่มขึ้น"] },
    { label: "GMV", value: (t) => t.gmv, kind: "baht" },
  ],
  Shopee: [
    { label: "Viewers", value: (t) => t.viewers, kind: "int", why: ["คนดูน้อยลง", "คนดูมากขึ้น"] },
    { label: "CO", value: (t) => ratioOf(t.orders, t.viewers), kind: "pct", rate: true, why: ["คนดูแล้วซื้อน้อยลง", "คนดูแล้วซื้อมากขึ้น"] },
    { label: "ออเดอร์", value: (t) => t.orders, kind: "int" },
    { label: "มูลค่าต่อออเดอร์", value: (t) => ratioOf(t.gmv, t.orders), kind: "baht", rate: true, why: ["มูลค่าต่อออเดอร์ลดลง", "มูลค่าต่อออเดอร์เพิ่มขึ้น"] },
    { label: "GMV", value: (t) => t.gmv, kind: "baht" },
  ],
};

/**
 * GMV = ขั้นแรก × อัตราทุกขั้น → การเปลี่ยนของ GMV แยกเป็นผลของแต่ละตัวได้ด้วย log ของอัตราส่วน (ผลรวมทุกตัว = การเปลี่ยนของ GMV)
 *   ตัวที่ผลมากที่สุดในทิศเดียวกับ GMV = สาเหตุหลัก · ข้อมูลไม่ครบ (มีค่า 0 / ไม่มีช่วงเทียบ) = ไม่บอก
 */
function funnelCause(steps: FunnelStep[], cur: Totals, prev: Totals) {
  const g1 = cur.gmv, g0 = prev.gmv;
  if (!g1 || !g0) return null;
  const parts = steps.filter((s) => s.why).map((s) => ({ s, a: s.value(cur), b: s.value(prev) }));
  if (parts.some((p) => !p.a || !p.b)) return null;
  const total = Math.log(g1 / g0);
  const effects = parts.map((p) => ({ s: p.s, e: Math.log(p.a! / p.b!), change: p.a! / p.b! - 1 }));
  const same = effects.filter((x) => Math.sign(x.e) === Math.sign(total));
  const main = (same.length ? same : effects).reduce((m, x) => (Math.abs(x.e) > Math.abs(m.e) ? x : m));
  return { up: total > 0, change: g1 / g0 - 1, main };
}

function Funnel({ cur, prev, prevLabel }: { cur: LiveSession[]; prev: LiveSession[]; prevLabel: string }) {
  const platforms = (["TikTok", "Shopee"] as const).filter((p) => cur.some((s) => s.platform === p));
  if (!platforms.length) return null;
  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <h2 className="font-bold">ยอดมาจากไหน</h2>
      <p className="text-xs text-muted-foreground">GMV = จำนวนคนขั้นแรก × อัตราแต่ละขั้น · เทียบ {prevLabel} · ขั้นที่ทำให้ยอดเปลี่ยนมากที่สุดเป็นตัวหนา</p>
      <div className={cn("mt-3 grid gap-x-6 gap-y-5", platforms.length === 2 && "sm:grid-cols-2")}>
        {platforms.map((p) => (
          <FunnelColumn key={p} platform={p} cur={totalsOf(cur.filter((s) => s.platform === p))} prev={totalsOf(prev.filter((s) => s.platform === p))} />
        ))}
      </div>
    </section>
  );
}

function FunnelColumn({ platform, cur, prev }: { platform: Platform; cur: Totals; prev: Totals }) {
  const steps = FUNNEL_STEPS[platform];
  const cause = prev.lives ? funnelCause(steps, cur, prev) : null;
  const pct = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;
  return (
    <div>
      <h3 className="text-sm font-semibold">{platform}</h3>
      <ol className="mt-1">
        {steps.map((s) => {
          const v = s.value(cur), main = cause?.main.s === s;
          return (
            <li
              key={s.label}
              className={cn("flex items-baseline justify-between gap-3", s.rate ? "py-0.5 pl-4 text-xs text-muted-foreground" : "border-b py-1.5 text-sm last:border-b-0", main && "font-semibold text-foreground")}
            >
              <span className="min-w-0 truncate">{s.rate ? <ChevronDownIcon className="mr-1 inline size-3 align-[-2px]" aria-hidden /> : null}{s.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className={cn("tabular-nums", !s.rate && "font-semibold")}>{fmtMetric(s.kind, v)}</span>
                <span className="w-16 text-right">{prev.lives ? <ChangeText cur={v} prev={s.value(prev)} /> : null}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {cause ? (
        <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs leading-relaxed">
          GMV {cause.up ? "เพิ่มขึ้น" : "ลดลง"} {Math.abs(cause.change * 100).toFixed(1)}% — มาจาก<b>{cause.main.s.why![cause.main.change > 0 ? 1 : 0]}</b>มากที่สุด ({cause.main.s.label} {pct(cause.main.change)})
        </p>
      ) : null}
    </div>
  );
}

/**
 * ภาพรวมทั้งปี / ช่วงเดือนที่เลือก (ไม่เกิน 12 เดือน): ยอดรวม + YoY / กราฟรายเดือนเทียบปีก่อน / ตารางรายไตรมาส / แยกบัญชี
 *   ช่วงที่ยังไม่จบ (มีเดือนนี้) = เทียบ YoY กับปีก่อนถึงวันเดียวกัน
 *   โหลดข้อมูลย้อนหลัง 12 เดือนก่อนช่วงด้วย (ใช้คิด YoY, MoM เดือนแรก, QoQ ไตรมาสแรก)
 */
function YearOverview({ latest, dataMonths, version }: { latest: string; dataMonths: string[]; version: number }) {
  const [range, setRange] = useState<MonthRange>(() => ({ from: `${latest.slice(0, 4)}-01`, to: `${latest.slice(0, 4)}-12` }));
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const filter = useFilter();
  const n = monthsIn(range);
  const loadFrom = monthKey(-12, range.from);
  const { data, error, retry } = useSessions(monthWindow(loadFrom).from, monthWindow(range.to).to, version);
  // แพลนกลุ่มย้อนถึงปีก่อนด้วย (ส่วนเทียบรายกลุ่มกับปีก่อน)
  const owners = useOwnerSpans(`from=${loadFrom}&to=${range.to}`, version);
  const dayTags = useDayTags(`from=${range.from}&to=${range.to}`, version);
  const [yearSplit, setYearSplit] = useState<Split>("platform");
  const shift =(by: number) => setRange({ from: monthKey(by, range.from), to: monthKey(by, range.to) });

  const nav = (
    <div className="my-2 flex items-center justify-between gap-3">
      <IconButton label="ช่วงก่อนหน้า (ปีก่อน)" onClick={() => shift(-12)}><ChevronLeftIcon /></IconButton>
      <MonthPicker mode="range" value={range} onChange={setRange} marked={dataMonths} />
      <IconButton label="ช่วงถัดไป (ปีหน้า)" onClick={() => shift(12)}><ChevronRightIcon /></IconButton>
    </div>
  );
  if (!data) return <>{nav}{error ? <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={retry} /> : <LoadingBlock />}</>;

  const now = monthKey();
  const curKeys = Array.from({ length: n }, (_, i) => monthKey(i, range.from));
  const prevKeys = curKeys.map((k) => monthKey(-12, k));
  const ongoing = curKeys.includes(now);
  const doneKeys = curKeys.filter((k) => k <= now); // เดือนที่ถึงแล้ว (ใช้คิด YTD)

  const list = filterSessions(data, filter.platform, filter.account);
  const byMonth = new Map<string, LiveSession[]>(Array.from({ length: n + 12 }, (_, i) => [monthKey(i, loadFrom), []]));
  for (const s of list) byMonth.get(monthOf(s.startedAt))?.push(s);
  const sessionsOf = (keys: string[]) => keys.flatMap((k) => byMonth.get(k) ?? []);
  const totalsAt = (k: string) => totalsOf(byMonth.get(k) ?? []);
  const curList = sessionsOf(doneKeys);
  // ช่วงที่ยังไม่จบ: ปีก่อนนับถึงวันเดียวกัน (YTD)
  const today = new Date();
  const sameDayLastYear = new Date(today.getTime()).setFullYear(today.getFullYear() - 1);
  const prevList = sessionsOf(doneKeys.map((k) => monthKey(-12, k))).filter((s) => !ongoing || Date.parse(s.startedAt) < sameDayLastYear);
  const cur = totalsOf(curList), prev = totalsOf(prevList);
  const aName = rangeLabel(range);
  const bName = rangeLabel({ from: prevKeys[0], to: prevKeys[n - 1] });
  const rangeText = ongoing ? `1 ${shortMonth(range.from).split(" ")[0]} ${range.from.slice(0, 4)} – ${bkkDate.format(today)}` : aName;

  const def = metricOf(metric);
  const fmt = (v: number | null) => fmtMetric(def.kind, v);
  const replay = `${range.from}|${range.to}|${filter.platform}|${filter.account}`;
  const valOf = (k: string) => { const t = totalsAt(k); return t.lives ? def.value(t) : null; };
  const hasPrev = prevKeys.some((k) => totalsAt(k).lives);
  const curGroups = curKeys.map((k) => byMonth.get(k) ?? []);
  // กราฟแท่งแยกแพลตฟอร์ม · กราฟเส้นแยกแพลตฟอร์มด้วย เว้นแต่มีข้อมูลปีก่อน จะเป็นเส้นเทียบปีแทน (2 ปี × แพลตฟอร์ม = เส้นเยอะจนอ่านไม่ออก)
  const yearSeries = platformLines(curGroups, metric);
  const series = hasPrev
    ? [{ name: aName, color: CUR, values: curKeys.map(valOf) }, { name: bName, color: PREV, values: prevKeys.map(valOf) }]
    : trendLines(curGroups, metric);
  const yearAgency = owners.spans ? agencyTrend(curGroups, owners.spans) : null;
  const yearByAgency = yearSplit === "agency" && hasAgency(yearAgency);

  // ไตรมาสที่อยู่ในช่วง (บางไตรมาสอาจมีไม่ครบ 3 เดือน) + ไตรมาสก่อนหน้า (QoQ) + ปีก่อน (YoY)
  const quarterKeys = [...new Set(curKeys.map(quarterOf))];
  const quarters = quarterKeys.map((q) => {
    const months = curKeys.filter((k) => quarterOf(k) === q);
    const first = firstMonthOfQuarter(q);
    const beforeMonths = Array.from({ length: 3 }, (_, i) => monthKey(i - 3, first));
    return {
      q, label: quarterName(q), months, partial: months.length < 3, open: months.includes(now),
      a: sessionsOf(months), b: sessionsOf(months.map((k) => monthKey(-12, k))), before: sessionsOf(beforeMonths),
    };
  });
  const v = (t: Totals) => (t.lives ? def.value(t) : null);

  // สไลด์: ช่วงนี้ vs ปีก่อน รายเดือน / ยังไม่มีข้อมูลปีก่อน = วิเคราะห์เดือนล่าสุดที่จบแล้วเทียบเดือนก่อนหน้า
  const buildSlides = (target: "pptx" | "gslides") => {
    const lastDone = [...doneKeys].reverse().find((k) => k < now && totalsAt(k).lives && totalsAt(monthKey(-1, k)).lives);
    return buildCompareDeck({
      report: "ภาพรวม", aName, bName, aRange: rangeText, bRange: `${bName} ช่วงเดียวกัน`,
      a: curList, b: prevList, timeName: "รายเดือน",
      time: doneKeys.map((k) => ({ short: `${shortMonth(k)}${k === now ? "*" : ""}`, a: byMonth.get(k) ?? [], b: byMonth.get(monthKey(-12, k)) ?? [] })),
      filterText: filterText({ platform: filter.platform, account: filter.account, sessions: data }).join(" · "),
      exportedAt: bkkStamp(new Date().toISOString()),
      cover: { kicker: `ภาพรวม${ongoing ? " (ยังไม่จบช่วง)" : ""}`, headline: aName },
      quarters: quarters.map((q) => ({ label: q.partial || q.open ? `${q.label}*` : q.label, a: q.a, b: q.b, before: q.before, open: q.open || q.partial })),
      focus: !prev.lives && lastDone
        ? { aName: monthLabel(lastDone), bName: monthLabel(monthKey(-1, lastDone)), a: byMonth.get(lastDone)!, b: byMonth.get(monthKey(-1, lastDone)) ?? [] }
        : undefined,
      agency: owners.spans ? [{
        title: `GMV รายเดือน ${aName} แยก Agency`, lineTitle: `GMV/ชม. รายเดือน ${aName} แยก Agency`,
        labels: doneKeys.map((k) => `${shortMonth(k)}${k === now ? "*" : ""}`), trend: agencyTrend(doneKeys.map((k) => byMonth.get(k) ?? []), owners.spans),
      }] : undefined,
      // เหมือนหน้าเว็บ: กลุ่มผู้ไลฟ์ + รายกลุ่ม / รายบัญชี (เทียบปีก่อนเมื่อมีข้อมูล) + ช่วงเวลาขายดี + วันปกติ vs วันแคมเปญ
      owners: owners.spans ? splitByOwner(curList, owners.spans) : undefined,
      breakdown: { spans: owners.spans ?? null },
      heat: { title: `ช่วงเวลาไหนขายดี ${aName}` },
      dayKinds: dayTags.tags ? { title: `วันปกติ vs วันแคมเปญ ${aName}`, tags: dayTags.tags } : undefined,
    }, target);
  };

  return (
    <>
      {nav}
      <FilterBar filter={filter} sessions={data}>
        <div className="flex flex-wrap gap-2">
          <ExportMenu size="sm" label="ส่งออก" build={async () => yearBook({
            aName, bName, rangeText, monthLabel, curKeys, prevKeys, byMonth, curList, prevList,
            quarters: quarters.map((q) => ({ label: q.partial ? `${q.label} (บางเดือน)` : q.label, a: q.a, b: q.b })),
            filter: { platform: filter.platform, account: filter.account, sessions: data },
            crew: await loadCrew(curList),
            extras: {
              spans: owners.spans ?? null, owners: true, heat: true, tags: dayTags.tags ?? null,
              breakdown: { b: prevList, aName: ongoing ? rangeText : aName, bName: ongoing ? `${bName} ช่วงเดียวกัน` : bName },
              agency: owners.spans ? [{ name: "แยก Agency รายเดือน", first: "เดือน", labels: doneKeys.map(monthLabel), trend: agencyTrend(doneKeys.map((k) => byMonth.get(k) ?? []), owners.spans) }] : undefined,
            },
          })} />
          <SlidesMenu label="สไลด์" title={`GLORY ภาพรวม ${aName}`} build={buildSlides} />
        </div>
      </FilterBar>
      {!cur.lives ? (
        <StateBox title={`ไม่มีข้อมูลไลฟ์ ${aName}`}>ลองเปลี่ยนช่วงเดือน / แพลตฟอร์ม หรืออัปโหลดไฟล์ของช่วงนี้</StateBox>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            ยอดรวม {ongoing ? `${rangeText} (ยังไม่จบช่วง)` : aName} · YoY เทียบกับ {bName} ช่วงเดียวกัน
          </p>
          <KpiGrid cur={cur} compare={[{ totals: prev, label: `YoY vs ${bName}` }]} />
        </>
      )}

      <section className="my-4 rounded-2xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{yearByAgency ? `GMV รายเดือน ${aName} แยก Agency` : `${def.label} รายเดือน ${aName}`}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {hasAgency(yearAgency) ? <SplitTabs value={yearByAgency ? "agency" : "platform"} onChange={setYearSplit} /> : null}
            {yearByAgency ? null : <MetricSelect value={metric} onChange={setMetric} />}
          </div>
        </div>
        {yearByAgency ? (
          <AgencyBars trend={yearAgency!} categories={curKeys.map(shortMonth)} titles={curKeys.map(monthLabel)} label={`GMV รายเดือน ${aName} แยก Agency`} rowHead="เดือน" replay={replay} />
        ) : (
          <PlatformBars
            series={yearSeries} metric={metric} replay={replay}
            label={`${def.label} รายเดือน ${aName}`}
            categories={curKeys.map(shortMonth)}
            titles={curKeys.map(monthLabel)}
          />
        )}
        {yearByAgency ? null : <TableView title="ดูเป็นตาราง">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เดือน</TableHead><TableHead className="text-right">{def.label}</TableHead>
                {yearSeries.length > 1 ? yearSeries.map((s) => <TableHead key={s.name} className="text-right">{s.name}</TableHead>) : null}
                <TableHead className="text-right">MoM</TableHead><TableHead className="text-right">ปีก่อน</TableHead><TableHead className="text-right">YoY</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {curKeys.map((k, i) => {
                const show = valOf(k) !== null && k !== now; // เดือนนี้ยังไม่จบ ไม่แสดง %
                return (
                  <TableRow key={k}>
                    <TableCell>{monthLabel(k)}{k === now ? <span className="text-xs text-muted-foreground"> (ยังไม่จบ)</span> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(valOf(k))}</TableCell>
                    {yearSeries.length > 1 ? yearSeries.map((s) => <TableCell key={s.name} className="text-right tabular-nums">{fmt(s.values[i])}</TableCell>) : null}
                    <TableCell className="text-right">{show ? <ChangeText cur={valOf(k)} prev={valOf(monthKey(-1, k))} /> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(valOf(prevKeys[i]))}</TableCell>
                    <TableCell className="text-right">{show ? <ChangeText cur={valOf(k)} prev={valOf(prevKeys[i])} /> : null}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableView>}
      </section>

      <TrendSection
        title={`${def.label} แนวโน้มรายเดือน ${aName}${hasPrev ? ` เทียบ ${bName}` : ""}`}
        label={`แนวโน้ม ${def.label} รายเดือน ${aName}`}
        rowHead="เดือน"
        categories={curKeys.map(shortMonth)}
        titles={curKeys.map((k, i) => (hasPrev ? `${monthLabel(k)} vs ${monthLabel(prevKeys[i])}` : monthLabel(k)))}
        series={series}
        metric={metric}
        onMetric={setMetric}
        replay={replay}
        compare={hasPrev}
        table={false}
        agency={{ trend: yearAgency, title: `GMV/ชม. รายเดือน ${aName} แยก Agency`, titles: curKeys.map(monthLabel) }}
      />

      {cur.lives ? <HeatSection title={`ช่วงเวลาไหนขายดี ${aName}`} sessions={curList} spans={owners.spans} /> : null}
      {cur.lives ? <DayKindSection title={`วันปกติ vs วันแคมเปญ ${aName}`} sessions={curList} tags={dayTags.tags} ready={dayTags.ready} replay={replay} /> : null}

      {cur.lives ? <OwnerTable owners={owners} sessions={curList} /> : null}
      {cur.lives ? (
        <BreakdownSection a={curList} b={prevList} curName={ongoing ? rangeText : aName} prevName={ongoing ? `${bName} ช่วงเดียวกัน` : bName} spans={owners.spans} replay={replay} />
      ) : null}

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
              {quarters.map((q) => {
                const t = totalsOf(q.a);
                // ไตรมาสที่ยังไม่จบ ไม่แสดง % (ยอดยังไม่ครบ เทียบแล้วดูเหมือนตก) / มีไม่ครบ 3 เดือนในช่วง = ไม่คิด QoQ
                const pending = <span className="text-xs text-muted-foreground">{q.open ? "รอจบไตรมาส" : "-"}</span>;
                return (
                  <TableRow key={q.q}>
                    <TableCell className="font-medium">
                      {q.label}
                      {q.open ? <span className="text-xs font-normal text-muted-foreground"> (ยังไม่จบ)</span>
                        : q.partial ? <span className="text-xs font-normal text-muted-foreground"> (เฉพาะ {q.months.map((k) => shortMonth(k).split(" ")[0]).join(", ")})</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.lives}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(v(t))}</TableCell>
                    <TableCell className="text-right">{!t.lives ? null : q.open || q.partial ? pending : <ChangeText cur={v(t)} prev={v(totalsOf(q.before))} />}</TableCell>
                    <TableCell className="text-right">{!t.lives ? null : q.open ? pending : <ChangeText cur={v(t)} prev={v(totalsOf(q.b))} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {cur.lives ? <AccountTable cur={curList} prev={prevList} prevLabel="ปีก่อน" /> : null}
    </>
  );
}

/** "พฤ. 5 พ.ย." ของวันที่ d ในเดือนนี้ */
function dayTitle(month: string, d: number) {
  const k = parseKey(`${month}-${String(d).padStart(2, "0")}`);
  return `${fmtWeekShort.format(k)} ${fmtDayMonth.format(k)}`;
}

/** กราฟแท่งรายวันของเดือนนี้ (นับตามวันที่เริ่มไลฟ์) ใช้ตัวชี้วัดเดียวกับกราฟรายเดือน · แท็บแยก Agency (spans = แพลนของกลุ่ม) */
function DailySection({ month, sessions, metric, onMetric, replay, spans, tagText }: {
  month: string; sessions: LiveSession[]; metric: MetricKey; onMetric: (k: MetricKey) => void; replay: string; spans?: OwnerSpan[];
  /** ป้ายวัน (วันแคมเปญ ...) ต่อท้ายชื่อวันในกล่องตัวเลข / ตาราง */
  tagText?: (day: number) => string;
}) {
  const [split, setSplit] = useState<Split>("platform");
  const def = metricOf(metric);
  const fmt = (v: number | null) => fmtMetric(def.kind, v);
  const [y, m] = month.split("-").map(Number);
  const days = Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => i + 1);
  const byDay = new Map<number, LiveSession[]>();
  for (const s of sessions) {
    const d = bkkParts(s.startedAt).d;
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const value = (d: number) => {
    const list = byDay.get(d);
    return list ? def.value(totalsOf(list)) : null;
  };
  const title = (d: number) => { const tag = tagText?.(d); return tag ? `${dayTitle(month, d)} · ${tag}` : dayTitle(month, d); };
  const groups = days.map((d) => byDay.get(d) ?? []);
  const series = platformLines(groups, metric);
  const agency = spans ? agencyTrend(groups, spans) : null;
  const byAgency = split === "agency" && hasAgency(agency);
  if (byAgency) {
    return (
      <section className="my-4 rounded-2xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">GMV รายวัน แยก Agency</h2>
          <SplitTabs value="agency" onChange={setSplit} />
        </div>
        <AgencyBars trend={agency!} categories={days.map(String)} titles={days.map(title)} label={`GMV รายวัน ${monthLabel(month)} แยก Agency`} rowHead="วันที่" replay={replay} />
      </section>
    );
  }
  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{def.label} รายวัน</h2>
        <div className="flex flex-wrap items-center gap-2">
          {hasAgency(agency) ? <SplitTabs value="platform" onChange={setSplit} /> : null}
          <MetricSelect value={metric} onChange={onMetric} />
        </div>
      </div>
      <PlatformBars
        series={series} metric={metric} replay={replay}
        label={`${def.label} รายวัน ${monthLabel(month)}`}
        categories={days.map(String)}
        titles={days.map(title)}
      />
      <TableView title="ดูเป็นตาราง">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>วันที่</TableHead><TableHead className="text-right">{def.label}</TableHead>
              {series.length > 1 ? series.map((s) => <TableHead key={s.name} className="text-right">{s.name}</TableHead>) : null}
              <TableHead className="text-right">ไลฟ์</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d, i) => (byDay.has(d) ? (
              <TableRow key={d}>
                <TableCell>{title(d)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(value(d))}</TableCell>
                {series.length > 1 ? series.map((s) => <TableCell key={s.name} className="text-right tabular-nums">{fmt(s.values[i])}</TableCell>) : null}
                <TableCell className="text-right tabular-nums">{byDay.get(d)!.length}</TableCell>
              </TableRow>
            ) : null))}
          </TableBody>
        </Table>
      </TableView>
    </section>
  );
}

/**
 * การ์ดกราฟเส้น + ตารางคู่กัน ใช้ร่วมกันทุกโหมด · เปลี่ยนเดือน / ตัวกรอง / ตัวชี้วัด (replay) = เส้นวาดใหม่
 *   compare = 2 เส้นเป็นช่วงที่เทียบกัน (มีคอลัมน์ % ที่เปลี่ยน) · table = false เมื่อการ์ดอื่นมีตารางของตัวเลขชุดนี้แล้ว
 *   agency = มีแท็บแยก Agency (GMV/ชม. เส้นละกลุ่ม) เมื่อช่วงนี้มีข้อมูลกลุ่ม
 */
function TrendSection({ title, label, rowHead, categories, titles, series, metric, onMetric, replay, compare = false, table = true, agency }: {
  title: string; label: string; rowHead: string; categories: string[]; titles: string[];
  series: { name: string; color: string; values: (number | null)[] }[];
  metric: MetricKey; onMetric: (k: MetricKey) => void; replay: string; compare?: boolean; table?: boolean;
  agency?: { trend: AgencyTrend[] | null; title: string; titles?: string[] };
}) {
  const [split, setSplit] = useState<Split>("platform");
  const def = metricOf(metric);
  const fmt = (v: number | null) => fmtMetric(def.kind, v);
  const pair = compare && series.length === 2;
  const canSplit = hasAgency(agency?.trend ?? null);
  if (agency && canSplit && split === "agency") {
    return (
      <section className="my-4 rounded-2xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{agency.title}</h2>
          <SplitTabs value="agency" onChange={setSplit} />
        </div>
        <AgencyLines trend={agency.trend!} categories={categories} titles={agency.titles ?? titles} label={agency.title} rowHead={rowHead} replay={replay} />
      </section>
    );
  }
  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {canSplit ? <SplitTabs value="platform" onChange={setSplit} /> : null}
          <MetricSelect value={metric} onChange={onMetric} />
        </div>
      </div>
      {series.length ? (
        <LineChart
          key={`${metric}|${replay}`}
          label={label}
          categories={categories}
          tooltipTitles={titles}
          series={series}
          format={fmt}
          formatAxis={(v) => fmtMetric(def.kind === "hours" ? "int" : def.kind, v, true)}
          compare={compare}
        />
      ) : <p className="py-8 text-center text-sm text-muted-foreground">ไม่มีค่า {def.label} ในช่วงนี้</p>}
      {series.length > 1 ? <div className="mt-1"><Legend series={series} line /></div> : null}
      {series.length && table ? (
        <TableView title="ดูเป็นตาราง">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{rowHead}</TableHead>
                {series.map((s) => <TableHead key={s.name} className="text-right">{s.name}</TableHead>)}
                {pair ? <TableHead className="text-right">เปลี่ยน</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c, i) => (series.some((s) => s.values[i] !== null) ? (
                <TableRow key={c}>
                  <TableCell>{titles[i]}</TableCell>
                  {series.map((s) => <TableCell key={s.name} className="text-right tabular-nums">{fmt(s.values[i])}</TableCell>)}
                  {pair ? <TableCell className="text-right"><ChangeText cur={series[0].values[i]} prev={series[1].values[i]} /></TableCell> : null}
                </TableRow>
              ) : null))}
            </TableBody>
          </Table>
        </TableView>
      ) : null}
    </section>
  );
}

/** สีของแพลตฟอร์มในกราฟ (ผูกกับแพลตฟอร์ม กรองแล้วสีไม่เปลี่ยน) */
const PLATFORM_COLOR: Record<string, string> = { TikTok: CUR, Shopee: PREV };
/** ค่าของแต่ละกลุ่มแยกแพลตฟอร์ม พร้อมชื่อ + สีสำหรับกราฟและตาราง */
const platformLines = (groups: LiveSession[][], metric: MetricKey) =>
  platformSeries(groups, metric).map((s) => ({ name: s.platform, color: PLATFORM_COLOR[s.platform], values: s.values }));
/**
 * กราฟเส้นแนวโน้ม: แยกแพลตฟอร์ม + เส้นรวมสีตัวอักษร (สีเทาแยกจากชมพู TikTok ไม่ออกสำหรับคนตาบอดสีแดง)
 *   เหลือแพลตฟอร์มเดียว = เส้นรวมคือเส้นเดียวกัน ไม่ต้องมี · ค่าที่รวมไม่ได้ (CO) = ไม่มีเส้นรวม
 */
const trendLines = (groups: LiveSession[][], metric: MetricKey) => {
  const lines: { name: string; color: string; values: (number | null)[] }[] = platformLines(groups, metric);
  const total = totalSeries(groups, metric);
  return lines.length > 1 && total.some((v) => v !== null) ? [...lines, { name: "รวม", color: "var(--foreground)", values: total }] : lines;
};

/**
 * กราฟแท่งแยกสีตามแพลตฟอร์ม: ค่าที่บวกกันได้ (GMV ออเดอร์ ชั่วโมง ...) = แท่งซ้อน ความสูงรวมคือยอดรวมจริง
 *   ค่าต่อหน่วย (GMV/ชม. CO ...) บวกกันไม่ได้ = แท่งคู่ · ตัวกรองเหลือแพลตฟอร์มเดียว = แท่งสีเดียว ไม่มี Legend
 */
function PlatformBars({ series, metric, categories, titles, label, highlight, replay }: {
  series: ReturnType<typeof platformLines>; metric: MetricKey; categories: string[]; titles: string[]; label: string; highlight?: number; replay: string;
}) {
  const def = metricOf(metric);
  return (
    <>
      <BarChart
        key={`${metric}|${replay}`}
        label={label}
        categories={categories}
        tooltipTitles={titles}
        series={series}
        format={(v) => fmtMetric(def.kind, v)}
        formatAxis={(v) => fmtMetric(def.kind === "hours" ? "int" : def.kind, v, true)}
        highlight={highlight}
        stacked={isStackable(metric)}
        compare={false}
      />
      {series.length > 1 ? <div className="mt-1"><Legend series={series} /></div> : null}
    </>
  );
}

/** กราฟเส้นรายวันแยก TikTok / Shopee (src/lib/live-lines.ts) ตั้งต้นที่ GMV/ชม. เพราะยอดรวมรายวันมีกราฟแท่งแล้ว · แท็บแยก Agency */
function LineSection({ month, sessions, replay, spans }: { month: string; sessions: LiveSession[]; replay: string; spans?: OwnerSpan[] }) {
  const [metric, setMetric] = useState<MetricKey>("gmvPerHour");
  const def = metricOf(metric);
  const { days, series } = dailyByPlatform(sessions, month, metric);
  const lines = series.map((s) => ({ name: s.platform, color: PLATFORM_COLOR[s.platform], values: s.values }));
  const groups = days.map((d) => sessions.filter((s) => bkkParts(s.startedAt).d === d));
  return (
    <TrendSection
      title={`${def.label} รายวัน ${lines.length > 1 ? "แยกแพลตฟอร์ม" : lines[0]?.name ?? ""}`}
      label={`${def.label} รายวัน ${monthLabel(month)}`}
      rowHead="วันที่"
      categories={days.map(String)}
      titles={days.map((d) => dayTitle(month, d))}
      series={lines}
      metric={metric}
      onMetric={setMetric}
      replay={replay}
      agency={{ trend: spans ? agencyTrend(groups, spans) : null, title: "GMV/ชม. รายวัน แยก Agency" }}
    />
  );
}

/**
 * ช่วงเวลาไหนขายดี: ตาราง ชั่วโมง (แถว เริ่ม 06:00) × วันในสัปดาห์ (คอลัมน์) สีเดียวไล่ระดับ เข้ม = ค่าสูง (src/lib/live-heat.ts)
 *   GMV/ชม. (ค่าเริ่ม) หรือ GMV รวม · กรองกลุ่มได้ (ทีมเรา / Agency) · ช่องที่ไลฟ์รวมไม่ถึง 2 ชม. สีจาง ไม่จัดอันดับ
 *   แตะ / ชี้ช่องเพื่อดูตัวเลข · ตารางตัวเลขเต็มอยู่ใน "ดูเป็นตาราง"
 */
function HeatSection({ title, sessions, spans }: { title: string; sessions: LiveSession[]; spans?: OwnerSpan[] }) {
  const [metric, setMetric] = useState<"perHour" | "gmv">("perHour");
  const [group, setGroup] = useState("all");
  const [pick, setPick] = useState<{ day: number; hour: number } | null>(null);
  const shares = spans ? agencySharesOf(sessions, spans) : null;
  const groups = shares ? [...new Set([...shares.values()].flatMap((m) => [...m.keys()]))].sort((a, b) => Number(a !== AGENCY_OURS) - Number(b !== AGENCY_OURS) || a.localeCompare(b)) : [];
  const active = groups.includes(group) ? group : "all";
  const grid = heatGrid(sessions.map((s) => ({ startedAt: s.startedAt, durationSec: s.durationSec, gmv: s.gmv, weight: active === "all" ? 1 : shares?.get(s)?.get(active) ?? 0 })));
  const value = (c: HeatCell) => (metric === "perHour" ? heatPerHour(c) : c.gmv > 0 ? c.gmv : null);
  const enough = (c: HeatCell) => metric === "gmv" || c.sec >= HEAT_MIN_SEC;
  // สเกลสีจากช่องที่ข้อมูลพอ (ช่องตัวอย่างน้อยค่าแกว่ง ไม่ให้กินสเกล)
  const max = Math.max(0, ...grid.flat().filter(enough).map((c) => value(c) ?? 0));
  const top = heatTop(grid, value, 5);
  const rank = new Map(top.slice(0, 3).map((x, i) => [`${x.day}|${x.hour}`, i + 1]));
  const sel = pick ?? (top[0] ? { day: top[0].day, hour: top[0].hour } : null);
  const selCell = sel ? grid[sel.day][sel.hour] : null;
  const baht = (v: number | null) => fmtMetric("baht", v);
  const slotText = (day: number, hour: number) => `${HEAT_WEEKDAY_NAMES[day]} ${heatHour(hour)}–${heatHour(hour + 1)}`;
  const groupLabel = (k: string) => (k === AGENCY_OURS ? "ทีมเรา (ของเรา / In house)" : ownerText(k));
  const pctOf = (v: number) => Math.round(12 + 88 * Math.min(1, max ? v / max : 0));

  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {groups.length > 1 ? (
            <Select value={active} onValueChange={setGroup}>
              <SelectTrigger aria-label="กลุ่มผู้ไลฟ์" className="h-8 min-w-36 rounded-full bg-card text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">ทุกกลุ่ม</SelectItem>
                {groups.map((k) => <SelectItem key={k} value={k}>{groupLabel(k)}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <ToggleGroup type="single" spacing={1} value={metric} onValueChange={(v) => { if (v) setMetric(v as "perHour" | "gmv"); }} aria-label="ค่าในตาราง" className="rounded-full border bg-card p-0.5">
            {[["perHour", "GMV/ชม."], ["gmv", "GMV รวม"]].map(([id, text]) => (
              <ToggleGroupItem key={id} value={id} className="h-7 rounded-full! px-2.5 text-xs font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!">{text}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {top.length ? (
        <ol className="mb-3 grid gap-1 text-sm sm:grid-cols-2">
          {top.map((x, i) => (
            <li key={`${x.day}|${x.hour}`} className="flex items-baseline gap-2">
              <span className="w-4 shrink-0 text-right font-bold tabular-nums">{i + 1}</span>
              <span className="min-w-0">
                <span className="font-semibold">{slotText(x.day, x.hour)}</span>{" "}
                <span className="tabular-nums text-muted-foreground">{baht(x.v)}{metric === "perHour" ? "/ชม." : ""} · ไลฟ์รวม {(x.cell.sec / 3600).toFixed(1)} ชม.</span>
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="mb-3 text-sm text-muted-foreground">ยังไม่มีช่วงเวลาที่ไลฟ์รวมถึง 2 ชม. ลองดูช่วงที่ยาวขึ้น (ทั้งปี)</p>}

      <div
        role="img" aria-label={`ตาราง${title} แถว = ชั่วโมง คอลัมน์ = วัน${top[0] ? ` ขายดีสุด ${slotText(top[0].day, top[0].hour)}` : ""}`}
        className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] gap-0.5 text-[11px] select-none"
      >
        <div />
        {HEAT_WEEKDAYS.map((d) => <div key={d} className="pb-0.5 text-center font-semibold text-muted-foreground">{d}</div>)}
        {Array.from({ length: 24 }, (_, h) => (
          <Fragment key={h}>
            <div className="pr-1 text-right leading-5 text-muted-foreground tabular-nums">{heatHour(h)}</div>
            {grid.map((col, d) => {
              const c = col[h], v = value(c), r = rank.get(`${d}|${h}`), p = v ? pctOf(v) : 0;
              const on = sel?.day === d && sel?.hour === h;
              return (
                <div
                  key={d}
                  className={cn("flex h-5 items-center justify-center rounded-[3px] font-bold", !v && "bg-muted/40", on && "ring-2 ring-foreground ring-inset")}
                  style={v ? { background: `color-mix(in srgb, var(--viz-cur) ${p}%, var(--card))`, opacity: enough(c) ? 1 : 0.45, color: p >= 55 ? "white" : undefined } : undefined}
                  onMouseEnter={() => setPick({ day: d, hour: h })}
                  onClick={() => setPick({ day: d, hour: h })}
                >
                  {r ?? null}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* ตัวเลขของช่องที่ชี้ / แตะ (มือถือแตะได้) */}
      <div className="mt-2 rounded-lg border bg-muted/30 px-2.5 py-2 text-xs tabular-nums" aria-live="polite">
        {sel && selCell ? (
          <>
            <span className="font-semibold">{slotText(sel.day, sel.hour)}</span>
            {" · "}GMV/ชม. {baht(heatPerHour(selCell))} · GMV {baht(selCell.gmv || null)} · ไลฟ์รวม {(selCell.sec / 3600).toFixed(1)} ชม. ({selCell.lives} ไลฟ์)
            {selCell.sec && selCell.sec < HEAT_MIN_SEC ? <span className="text-muted-foreground"> · ตัวอย่างน้อย</span> : null}
          </>
        ) : "แตะช่องในตารางเพื่อดูตัวเลข"}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>น้อย</span>
        <span aria-hidden className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in srgb, var(--viz-cur) 12%, var(--card)), var(--viz-cur))" }} />
        <span>มาก{max ? ` (${baht(max)}${metric === "perHour" ? "/ชม." : ""})` : ""}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        ไฟล์ Export ไม่มียอดรายชั่วโมง จึงกระจาย GMV ของแต่ละไลฟ์เท่าๆ กันตามเวลาไลฟ์ (ตัวเลขประมาณ) · ไลฟ์หลังเที่ยงคืนนับเป็นคืนของวันก่อน
        {metric === "perHour" ? " · ช่องสีจาง = ไลฟ์รวมไม่ถึง 2 ชม. (ตัวอย่างน้อย ไม่จัดอันดับ)" : ""}
      </p>
      <TableView title="ดูเป็นตาราง">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เวลา</TableHead>
              {HEAT_WEEKDAYS.map((d) => <TableHead key={d} className="text-right">{d}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 24 }, (_, h) => (grid.some((col) => value(col[h]) !== null) ? (
              <TableRow key={h}>
                <TableCell className="tabular-nums">{heatHour(h)}–{heatHour(h + 1)}</TableCell>
                {grid.map((col, d) => <TableCell key={d} className="text-right tabular-nums">{baht(value(col[h]))}</TableCell>)}
              </TableRow>
            ) : null))}
          </TableBody>
        </Table>
      </TableView>
    </section>
  );
}

/**
 * แพลนของกลุ่ม (Agency) ไว้แยก GMV ตามกลุ่มผู้ไลฟ์ · query = month= หรือ from= &to= (null = ไม่โหลด เช่น CEO Live)
 *   spans ยังไม่มี = กำลังโหลด / โหลดไม่สำเร็จ (ดู error)
 */
function useOwnerSpans(query: string | null, version: number) {
  const key = query ? `${query}|${version}` : "";
  const [state, setState] = useState<{ key: string; spans?: OwnerSpan[]; error?: string }>({ key: "" });
  useEffect(() => {
    if (!query) return;
    let alive = true;
    api<{ spans: OwnerSpan[] }>(`/api/live-stats/owners?${query}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) setState({ key, spans: res.spans });
      })
      .catch((err) => { if (alive) setState({ key, error: (err as Error).message }); });
    return () => { alive = false; };
  }, [key, query]);
  return key && state.key === key ? { spans: state.spans, error: state.error } : {};
}

/** ป้ายวันต่อแพลตฟอร์มจากชีตของทีม (key = tagKey) · ready false = ยังไม่ได้รัน SQL 20261128000000_live_day_tags */
function useDayTags(query: string, version: number) {
  const key = `${query}|${version}`;
  const [state, setState] = useState<{ key: string; tags?: Map<string, DayTag>; ready?: boolean }>({ key: "" });
  useEffect(() => {
    let alive = true;
    api<{ ready: boolean; tags: DayTag[] }>(`/api/live-stats/day-tags?${query}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) setState({ key, ready: res.ready, tags: new Map(res.tags.map((t) => [tagKey(t.platform, t.day), t])) });
      })
      .catch(() => { if (alive) setState({ key, tags: new Map() }); }); // โหลดไม่ได้ = ไม่มีป้าย (ส่วนอื่นยังใช้ได้)
    return () => { alive = false; };
  }, [key, query]);
  const cur = state.key === key ? state : null;
  return { tags: cur?.tags, ready: cur?.ready };
}

/** ข้อความป้ายของวัน (ไม่ใช่วันปกติ) เช่น "TikTok PayDay Campaign · Shopee PAYDAY" · platform = ตัวกรอง ("" = ทุกแพลตฟอร์ม) */
const dayTagText = (tags: Map<string, DayTag> | undefined, day: string, platform: Platform | "") =>
  (["TikTok", "Shopee"] as Platform[]).filter((p) => !platform || p === platform).flatMap((p) => {
    const t = tags?.get(tagKey(p, day));
    return t && t.kind !== "bau" ? [`${platform ? "" : `${p} `}${t.label || dayKindLabel(t.kind)}`] : [];
  }).join(" · ");

/**
 * วันปกติ vs วันแคมเปญ: GMV ต่อวัน / GMV ต่อชม. ของแต่ละชนิดวัน เทียบวันปกติ แยก TikTok / Shopee (src/lib/live-days.ts)
 *   ป้ายต่อแพลตฟอร์มจากชีตของทีม · วันที่ยังไม่มีป้ายไม่นับ (บอกจำนวนไลฟ์ไว้)
 */
function DayKindSection({ title, sessions, tags, ready, replay }: { title: string; sessions: LiveSession[]; tags?: Map<string, DayTag>; ready?: boolean; replay: string }) {
  const [metric, setMetric] = useState<"perDay" | "perHour">("perDay");
  if (ready === false) return <Notice className="my-4">ยังเทียบวันปกติกับวันแคมเปญไม่ได้ ต้องรัน SQL 20261128000000_live_day_tags ใน Supabase ก่อน</Notice>;
  if (!tags) return null;
  const per = (["TikTok", "Shopee"] as Platform[]).map((p) => ({ p, ...dayKindStats(sessions, tags, p) })).filter((x) => x.stats.length);
  if (!per.length) return null;
  const kinds = DAY_KINDS.filter((k) => per.some((x) => x.stats.some((s) => s.kind === k.kind)));
  const pick = (s: { perDay: number | null; perHour: number | null } | undefined) => (s ? (metric === "perDay" ? s.perDay : s.perHour) : null);
  const series = per.map((x) => ({ name: x.p, color: PLATFORM_COLOR[x.p], values: kinds.map((k) => pick(x.stats.find((s) => s.kind === k.kind))) }));
  const baht = (v: number | null) => fmtMetric("baht", v);
  const times = (v: number | null, base: number | null) => (v === null || !base ? "-" : `×${(v / base).toFixed(2)}`);
  const untagged = per.reduce((a, x) => a + x.untagged, 0);
  // วันที่มีป้าย (ไม่ใช่วันปกติ) และมีไลฟ์ ไว้ดูทีละวัน
  const days = [...new Set(sessions.map((s) => `${s.platform}|${liveDay(s)}`))].sort((a, b) => a.slice(-10).localeCompare(b.slice(-10)) || a.localeCompare(b))
    .flatMap((k) => { const t = tags.get(k); return t && t.kind !== "bau" ? [{ t, gmv: sessions.filter((s) => `${s.platform}|${liveDay(s)}` === k).reduce((a, s) => a + s.gmv, 0) }] : []; });
  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        <ToggleGroup type="single" spacing={1} value={metric} onValueChange={(v) => { if (v) setMetric(v as "perDay" | "perHour"); }} aria-label="ค่าที่เทียบ" className="rounded-full border bg-card p-0.5">
          {[["perDay", "GMV ต่อวัน"], ["perHour", "GMV/ชม."]].map(([id, text]) => (
            <ToggleGroupItem key={id} value={id} className="h-7 rounded-full! px-2.5 text-xs font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!">{text}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <BarChart
        key={`${metric}|${replay}`} label={`${metric === "perDay" ? "GMV ต่อวัน" : "GMV ต่อชั่วโมง"} แยกชนิดวัน`} categories={kinds.map((k) => k.label.replace(/ \(.*\)$/, ""))} tooltipTitles={kinds.map((k) => k.label)}
        series={series} format={baht} formatAxis={(v) => fmtMetric("baht", v, true)} compare={false}
      />
      {series.length > 1 ? <div className="mt-1"><Legend series={series} /></div> : null}
      <div className={cn("mt-3 grid gap-3", per.length > 1 && "lg:grid-cols-2")}>
        {per.map((x) => {
          const bau = x.stats.find((s) => s.kind === "bau");
          return (
            <div key={x.p} className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{x.p}</TableHead><TableHead className="text-right">วัน</TableHead>
                    <TableHead className="text-right">GMV/วัน</TableHead><TableHead className="text-right">เทียบวันปกติ</TableHead>
                    <TableHead className="text-right">GMV/ชม.</TableHead><TableHead className="text-right">เทียบวันปกติ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {x.stats.map((s) => (
                    <TableRow key={s.kind}>
                      <TableCell className="whitespace-nowrap">{dayKindLabel(s.kind)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.days}</TableCell>
                      <TableCell className="text-right tabular-nums">{baht(s.perDay)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{s.kind === "bau" ? "-" : times(s.perDay, bau?.perDay ?? null)}</TableCell>
                      <TableCell className="text-right tabular-nums">{baht(s.perHour)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{s.kind === "bau" ? "-" : times(s.perHour, bau?.perHour ?? null)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        ป้ายวันจากชีตของทีม (Shopee = remark แท็บ GLORY Shopee · TikTok = หมายเหตุ แท็บ GLORY TIKTOK) · วัน = วันที่มีไลฟ์ นับตามเวลาเริ่มไลฟ์
        {untagged ? ` · ${untagged.toLocaleString("th-TH")} ไลฟ์อยู่ในวันที่ยังไม่มีป้าย จึงไม่นับ` : ""}
      </p>
      {days.length ? (
        <TableView title={`ดูทีละวัน (${days.length} วันที่มีป้าย)`}>
          <Table>
            <TableHeader>
              <TableRow><TableHead>วันที่</TableHead><TableHead>แพลตฟอร์ม</TableHead><TableHead>ป้าย</TableHead><TableHead className="text-right">GMV</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {days.map(({ t, gmv }) => (
                <TableRow key={`${t.platform}|${t.day}`}>
                  <TableCell className="whitespace-nowrap">{dayTitle(t.day.slice(0, 7), Number(t.day.slice(8)))}</TableCell>
                  <TableCell>{t.platform}</TableCell>
                  <TableCell>{t.label || dayKindLabel(t.kind)} <span className="text-xs text-muted-foreground">({dayKindLabel(t.kind)})</span></TableCell>
                  <TableCell className="text-right tabular-nums">{baht(gmv)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableView>
      ) : null}
    </section>
  );
}

/** ช่วงเดือนที่ครอบทุกช่วงในรายการ -> query ของ useOwnerSpans */
const ownerQueryOf = (periods: Period[]) => {
  const months = periods.flatMap((p) => [monthOf(p.from), lastMonthOf(p)]).sort();
  return `from=${months[0]}&to=${months[months.length - 1]}`;
};

type Split = "platform" | "agency";
/** โหลดแพลนกลุ่มแล้ว + ช่วงนี้มีไลฟ์ = แสดงแท็บแยก Agency */
const hasAgency = (trend: AgencyTrend[] | null) => !!trend?.some((t) => t.gmv.some((v) => v !== null));

/** แท็บในหัวการ์ดกราฟ: แยกตามแพลตฟอร์ม / แยก Agency (รวม TikTok + Shopee ไว้กราฟเดียว) */
function SplitTabs({ value, onChange }: { value: Split; onChange: (v: Split) => void }) {
  return (
    <ToggleGroup type="single" spacing={1} value={value} onValueChange={(v) => { if (v) onChange(v as Split); }} aria-label="แยกกราฟตาม" className="rounded-full border bg-card p-0.5">
      {[["platform", "แพลตฟอร์ม"], ["agency", "แยก Agency"]].map(([id, text]) => (
        <ToggleGroupItem key={id} value={id} className="h-7 rounded-full! px-2.5 text-xs font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!">{text}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * สีกลุ่ม ผูกกับกลุ่ม (กรองแล้วสีไม่เปลี่ยน): ทีมเรา / Agency ใช้สีเดียวกับหน้า Cost ไม่ใช้ชมพูที่เป็นสี TikTok ในหน้านี้ · กลุ่มอื่นที่ยังไม่มีสี = เทา
 *   ชุดสีผ่านการตรวจแยกสี (คนตาบอดสี) ทั้งโหมดสว่าง / มืด
 */
const AGENCY_COLOR: Record<string, string> = { [AGENCY_OURS]: "var(--cost-mc)", TDH: "var(--cost-agency)", MCN: "var(--cost-admin)", Infinite: "var(--viz-prev)" };
const agencyColor = (key: string) => AGENCY_COLOR[key] ?? "var(--muted-foreground)";
/** คำอธิบายใต้กราฟ · merged = กราฟเส้นที่รวมแพลตฟอร์ม (ของเรารวม Shopee In house) */
const agencyNote = (trend: { key: string }[], merged: boolean) => (trend.some((t) => t.key === AGENCY_OURS)
  ? merged ? "ของเรา = ไลฟ์ที่ไม่ใช่ Agency ทั้ง TikTok (รวม Cherry, Skin Expert) และ Shopee In house"
    : "ไลฟ์ที่ไม่ใช่ Agency = ทีมเรา: TikTok = ของเรา (รวม Cherry, Skin Expert) · Shopee = In house"
  : "");

/**
 * GMV แยก Agency: แท่งคู่ TikTok | Shopee แต่ละแท่งซ้อนตามกลุ่ม (ความสูงแต่ละแท่ง = GMV จริงของแพลตฟอร์ม) + ตาราง
 *   ตัวกรองเหลือแพลตฟอร์มเดียว = แท่งเดียว
 */
function AgencyBars({ trend, categories, titles, label, rowHead, replay, highlight }: {
  trend: AgencyTrend[]; categories: string[]; titles: string[]; label: string; rowHead: string; replay: string; highlight?: number;
}) {
  const series = trend.map((t) => ({ name: t.label, color: agencyColor(t.key), values: t.gmv, stack: t.platform }));
  const platforms = [...new Set(trend.map((t) => t.platform))];
  const baht = (v: number | null) => fmtMetric("baht", v);
  const hasRow = (i: number) => trend.some((t) => t.gmv[i] !== null);
  const sumOf = (list: AgencyTrend[], i: number) => list.reduce((a, t) => a + (t.gmv[i] ?? 0), 0);
  const pair = platforms.length > 1;
  return (
    <>
      <BarChart
        key={`agency|${replay}`} label={label} categories={categories} tooltipTitles={titles} series={series}
        format={baht} formatAxis={(v) => fmtMetric("baht", v, true)} highlight={highlight} stacked compare={false}
      />
      {/* Legend แยกตามแท่ง: บอกว่าแท่งซ้าย / ขวาคือแพลตฟอร์มไหน */}
      <div className="mt-1 space-y-1">
        {platforms.map((p, i) => (
          <div key={p} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs font-semibold">{p}{pair ? (i === 0 ? " (แท่งซ้าย)" : " (แท่งขวา)") : ""}</span>
            <Legend series={series.filter((s) => s.stack === p)} />
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{agencyNote(trend, false)}</p>
      <TableView title="ดูเป็นตาราง">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{rowHead}</TableHead>
              {trend.map((t) => (
                <TableHead key={`${t.platform}|${t.key}`} className="text-right">
                  <span className="block text-[11px] font-normal text-muted-foreground">{t.platform}</span>{t.label}
                </TableHead>
              ))}
              {pair ? platforms.map((p) => <TableHead key={p} className="text-right">รวม {p}</TableHead>) : null}
              <TableHead className="text-right">รวม</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((c, i) => (hasRow(i) ? (
              <TableRow key={c}>
                <TableCell>{titles[i]}</TableCell>
                {trend.map((t) => <TableCell key={`${t.platform}|${t.key}`} className="text-right tabular-nums">{baht(t.gmv[i])}</TableCell>)}
                {pair ? platforms.map((p) => <TableCell key={p} className="text-right tabular-nums">{baht(sumOf(trend.filter((t) => t.platform === p), i))}</TableCell>) : null}
                <TableCell className="text-right font-semibold tabular-nums">{baht(sumOf(trend, i))}</TableCell>
              </TableRow>
            ) : null))}
          </TableBody>
        </Table>
      </TableView>
    </>
  );
}

/**
 * แยก Agency ตอนเทียบ 2 ช่วง: ไม่ซ้อน (ซ้อนแล้วเทียบกันยาก) = กราฟยอดรวมต่อแพลตฟอร์ม + กราฟแท่งแยกรายกลุ่ม
 *   ทุกกราฟแท่งคู่ สีบอกช่วงเวลา (ชมพู = ช่วงหลัก / ฟ้า = ช่วงเทียบ) เหมือนกราฟเทียบอื่นในหน้านี้ · trend = agencyTrend([ช่วงเทียบ, ช่วงหลัก])
 */
function AgencyCompare({ trend, curName, prevName, replay }: { trend: AgencyTrend[]; curName: string; prevName: string; replay: string }) {
  const platforms = [...new Set(trend.map((t) => t.platform))];
  const sum = (list: AgencyTrend[], i: number) => (list.some((t) => t.gmv[i] !== null) ? list.reduce((a, t) => a + (t.gmv[i] ?? 0), 0) : null);
  const totals = [...platforms.map((p) => ({ name: p, list: trend.filter((t) => t.platform === p) })), ...(platforms.length > 1 ? [{ name: "รวม", list: trend }] : [])];
  const pair = (cur: (number | null)[], prev: (number | null)[]) => [{ name: curName, color: CUR, values: cur }, { name: prevName, color: PREV, values: prev }];
  // ชื่อกลุ่มใต้แท่ง: สั้น · ชื่อเดียวกันสองแพลตฟอร์ม (เช่น MCN) ต่อท้ายแพลตฟอร์ม
  const dup = (t: AgencyTrend) => trend.filter((x) => x.label === t.label).length > 1;
  const short = (t: AgencyTrend) => `${t.label.replace(/^Agency /, "")}${dup(t) ? ` (${t.platform})` : ""}`;
  const baht = (v: number | null) => fmtMetric("baht", v), axis = (v: number) => fmtMetric("baht", v, true);
  return (
    <>
      <Legend series={pair([], [])} />
      <h3 className="mt-3 mb-1 text-sm font-semibold">ยอดรวม</h3>
      <BarChart
        key={`agency-total|${replay}`} label={`GMV รวม ${curName} เทียบ ${prevName}`} height={180}
        categories={totals.map((x) => x.name)} series={pair(totals.map((x) => sum(x.list, 1)), totals.map((x) => sum(x.list, 0)))}
        format={baht} formatAxis={axis}
      />
      <h3 className="mt-3 mb-1 text-sm font-semibold">แยกรายกลุ่ม</h3>
      <BarChart
        key={`agency-groups|${replay}`} label={`GMV แยกกลุ่ม ${curName} เทียบ ${prevName}`}
        categories={trend.map(short)} tooltipTitles={trend.map((t) => `${t.platform} · ${t.label}`)}
        series={pair(trend.map((t) => t.gmv[1]), trend.map((t) => t.gmv[0]))} format={baht} formatAxis={axis}
      />
      <p className="mt-1 text-xs text-muted-foreground">{agencyNote(trend, false)} · ตัวเลขทุกตัวชี้วัดของแต่ละกลุ่มอยู่ในตาราง &ldquo;เทียบรายกลุ่มและรายบัญชี&rdquo; ด้านล่าง</p>
    </>
  );
}

/** ตัวชี้วัดในดรอปดาวน์ของกราฟเทียบรายกลุ่ม / รายบัญชี (ผู้ใช้เลือก 2026-11-10) · ตัวชี้วัดอื่นอยู่ในตาราง */
const BREAKDOWN_METRICS: MetricKey[] = ["gmv", "gmvPerHour", "ctr", "co", "impressions", "viewers", "orders"];

/**
 * เทียบ 2 ช่วงรายกลุ่ม (Agency / ทีมเรา) และรายบัญชี: เลือกตัวชี้วัดทีละตัวจากดรอปดาวน์ · แยกแพลตฟอร์ม TikTok | Shopee ตั้งแต่แรก
 *   แต่ละฝั่งกราฟแท่งคู่ (ช่วงนี้ vs ช่วงก่อน) + ขาที่ทำให้ GMV เปลี่ยน + ตารางตัวเลข (src/lib/live-breakdown.ts)
 *   เป้าหมาย: เห็นว่ากลุ่ม / ช่องไหนดรอป และดรอปที่ขาไหน (ชั่วโมงไลฟ์ / คนดูต่อชม. / ยอดต่อคนดู) จะได้ไปแก้ถูกจุด
 *   ยอดรวมแพลตฟอร์มอยู่ที่หัวของฝั่งนั้น ไม่เป็นแท่ง (ยอดรวมใหญ่จนแท่งของกลุ่มเล็ก) · Impressions / CTR มีแค่ TikTok
 */
function BreakdownSection({ a, b, curName, prevName, spans, replay }: {
  a: LiveSession[]; b: LiveSession[]; curName: string; prevName: string; spans?: OwnerSpan[]; replay: string;
}) {
  const [view, setView] = useState<"group" | "account">("group");
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const { groups, accounts } = breakdownRows(a, b, spans ?? null);
  if (!groups.length) return null;
  // ช่วงก่อนไม่มีไลฟ์ (เช่น ทั้งปี 2026 ไม่มีข้อมูลปี 2025) = แสดงเฉพาะช่วงนี้ · มีข้อมูลเมื่อไรเทียบให้เอง
  const single = !b.length;
  const v = (t: Totals, k: MetricKey) => (t.lives ? metricOf(k).value(t) : null);
  const cols: { key: MetricKey; label: string }[] = [
    { key: "duration", label: "ชม." }, { key: "gmvPerHour", label: "GMV/ชม." }, { key: "viewers", label: "Viewers" }, { key: "viewersPerHour", label: "Viewers/ชม." },
    { key: "gmvPerViewer", label: "GMV/Viewer" }, { key: "impressions", label: "Impressions" }, { key: "ctr", label: "CTR" }, { key: "co", label: "CO" },
    { key: "orders", label: "ออเดอร์" }, { key: "aov", label: "AOV" },
  ];
  const table = (title: string, rows: BreakdownRow[]) => (
    <>
      <h3 className="mt-3 mb-1 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            {single ? (
              <TableRow>
                <TableHead className={STICKY_HEAD}>{title.replace("แยก", "")}</TableHead>
                <TableHead className="text-right">ไลฟ์</TableHead><TableHead className="text-right">GMV</TableHead>
                {cols.map((c) => <TableHead key={c.key} className="text-right">{c.label}</TableHead>)}
              </TableRow>
            ) : (
              <TableRow>
                <TableHead className={STICKY_HEAD}>{title.replace("แยก", "")}</TableHead>
                <TableHead className="text-right">GMV {prevName}</TableHead><TableHead className="text-right">GMV {curName}</TableHead>
                <TableHead className="text-right">ส่วนต่าง</TableHead><TableHead className="text-right">GMV</TableHead>
                {cols.map((c) => <TableHead key={c.key} className="text-right">{c.label}</TableHead>)}
                <TableHead>ขาที่ทำให้เปลี่ยนมากสุด</TableHead>
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const name = (
                <TableCell className={cn(STICKY_CELL, r.level === "platform" && "bg-muted", r.level === "group" && "pl-5")}>
                  {r.level === "account" ? <span className="block text-[11px] text-muted-foreground">{r.platform}</span> : null}{r.label}
                </TableCell>
              );
              if (single) return (
                <TableRow key={r.key} className={cn(r.level === "platform" && "bg-muted/50 font-semibold hover:bg-muted/50")}>
                  {name}
                  <TableCell className="text-right tabular-nums">{r.a.lives || "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMetric("baht", v(r.a, "gmv"))}</TableCell>
                  {cols.map((c) => <TableCell key={c.key} className="text-right tabular-nums">{fmtMetric(metricOf(c.key).kind, v(r.a, c.key))}</TableCell>)}
                </TableRow>
              );
              const leg = mainLeg(r.a, r.b);
              const gap = r.a.lives && r.b.lives ? r.a.gmv - r.b.gmv : null;
              return (
                <TableRow key={r.key} className={cn(r.level === "platform" && "bg-muted/50 font-semibold hover:bg-muted/50")}>
                  {name}
                  <TableCell className="text-right tabular-nums">{fmtMetric("baht", v(r.b, "gmv"))}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMetric("baht", v(r.a, "gmv"))}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", gap !== null && gap < 0 && "text-destructive")}>{gap === null ? "-" : `${gap > 0 ? "+" : gap < 0 ? "−" : ""}${fmtMetric("baht", Math.abs(gap))}`}</TableCell>
                  <TableCell className="text-right"><ChangeText cur={v(r.a, "gmv")} prev={v(r.b, "gmv")} /></TableCell>
                  {cols.map((c) => <TableCell key={c.key} className="text-right"><ChangeText cur={v(r.a, c.key)} prev={v(r.b, c.key)} /></TableCell>)}
                  <TableCell className={cn("text-xs whitespace-nowrap", leg && (leg.gmv < 0 ? "font-semibold text-destructive" : "text-success"))}>
                    {leg ? `${leg.label} ${leg.change > 0 ? "▲" : "▼"} ${(Math.abs(leg.change) * 100).toFixed(1)}%` : "-"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
  const groupRows = groups.filter((r) => r.level === "group");
  const hasGroups = groupRows.length > 0;
  const byGroup = view === "group" && hasGroups;
  const pair = (rows: BreakdownRow[], k: MetricKey) => [
    { name: curName, color: CUR, values: rows.map((r) => v(r.a, k)) },
    ...(single ? [] : [{ name: prevName, color: PREV, values: rows.map((r) => v(r.b, k)) }]),
  ];
  const pctTxt = (c: number) => `${c > 0 ? "▲" : "▼"} ${(Math.abs(c) * 100).toFixed(1)}%`;
  // ชื่อใต้แท่ง: ตัด "Agency " และชื่อบัญชียาวเกิน 12 ตัว · ชื่อเต็มอยู่ในกล่องตัวเลข
  const short = (r: BreakdownRow) => { const s = r.label.replace(/^Agency /, ""); return s.length > 12 ? `${s.slice(0, 11)}…` : s; };
  const def = metricOf(metric);
  /** ฝั่งของแพลตฟอร์มเดียว: หัว + ค่ารวมของตัวชี้วัดที่เลือก · กราฟ · ขาที่ทำให้ GMV เปลี่ยน */
  const panel = (total: BreakdownRow) => {
    const p = total.platform;
    const rows = (byGroup ? groupRows : accounts).filter((r) => r.platform === p);
    if (!rows.length) return null;
    const titles = rows.map((r) => `${p} · ${r.label}`);
    const legs = rows.flatMap((r) => { const leg = mainLeg(r.a, r.b); return leg ? [{ name: r.label, leg }] : []; });
    const none = rows.every((r) => v(r.a, metric) === null && v(r.b, metric) === null);
    const cur = v(total.a, metric), prev = v(total.b, metric);
    return (
      <div key={p} className="min-w-0 space-y-3">
        <div className="rounded-xl border p-2.5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="text-base font-bold">{p}</h3>
            {none ? null : (
              <span className="text-xs text-muted-foreground tabular-nums">
                {def.label} รวม {fmtMetric(def.kind, cur)}{single ? null : <> vs {fmtMetric(def.kind, prev)} <ChangeText cur={cur} prev={prev} /></>}
              </span>
            )}
          </div>
          {none ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{p} ไม่มีข้อมูล {def.label} ในไฟล์ Export</p>
          ) : (
            <BarChart
              key={`${p}|${metric}|${view}|${replay}`} label={`${p} ${def.label} ${byGroup ? "แยกกลุ่ม" : "แยกบัญชี"} ${curName}${single ? "" : ` เทียบ ${prevName}`}`} height={240}
              categories={rows.map(short)} tooltipTitles={titles} series={pair(rows, metric)}
              format={(x) => fmtMetric(def.kind, x)} formatAxis={(x) => fmtMetric(def.kind === "hours" ? "int" : def.kind, x, true)}
            />
          )}
        </div>
        {legs.length ? (
          <div>
            <h4 className="text-sm font-semibold">ขาที่ทำให้ GMV เปลี่ยนมากสุด</h4>
            <ul className="mt-1 space-y-1 text-sm">
              {legs.map(({ name, leg }) => (
                <li key={name}>
                  <span className="font-semibold">{name}</span>{" "}
                  <span className="text-muted-foreground tabular-nums">GMV {pctTxt(leg.gmv)}</span>{" → "}
                  <span className={cn("tabular-nums", leg.gmv < 0 ? "font-semibold text-destructive" : "text-success")}>{leg.label} {pctTxt(leg.change)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <section className="my-4 rounded-2xl border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{single ? `รายกลุ่มและรายบัญชี: ${curName}` : `เทียบรายกลุ่มและรายบัญชี: ${curName} vs ${prevName}`}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={metric} onValueChange={(x) => setMetric(x as MetricKey)}>
            <SelectTrigger aria-label="ตัวชี้วัดที่เทียบ" className="h-8 min-w-36 rounded-full bg-card text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              {BREAKDOWN_METRICS.map((k) => <SelectItem key={k} value={k}>{metricOf(k).label}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasGroups ? (
            <ToggleGroup type="single" spacing={1} value={view} onValueChange={(x) => { if (x) setView(x as "group" | "account"); }} aria-label="เทียบตาม" className="rounded-full border bg-card p-0.5">
              {[["group", "แยกกลุ่ม"], ["account", "แยกบัญชี"]].map(([id, text]) => (
                <ToggleGroupItem key={id} value={id} className="h-7 rounded-full! px-2.5 text-xs font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!">{text}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
        </div>
      </div>
      {single ? (
        <p className="text-xs text-muted-foreground">
          เลือกตัวชี้วัดจากดรอปดาวน์ · ชี้ / แตะแท่งดูตัวเลข{def.note ? ` · ${def.label}: ${def.note}` : ""} · ยังไม่มีข้อมูลไลฟ์ {prevName} จึงยังเทียบไม่ได้ มีข้อมูลเมื่อไรจะขึ้นแท่งเทียบให้เอง
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            เลือกตัวชี้วัดจากดรอปดาวน์ · ชี้ / แตะแท่งดูตัวเลขและ % ที่เปลี่ยน{def.note ? ` · ${def.label}: ${def.note}` : ""} · ขาที่ทำให้ GMV เปลี่ยน: GMV = ชั่วโมงไลฟ์ × Viewers/ชม. × GMV/Viewer ขาที่ลดมากสุดคือจุดที่ควรแก้ก่อน
          </p>
          <div className="mt-1"><Legend series={pair([], "gmv")} /></div>
        </>
      )}
      <div className="mt-2 grid gap-x-4 gap-y-6 lg:grid-cols-2">
        {groups.filter((r) => r.level === "platform").map(panel)}
      </div>
      <TableView title="ดูตัวเลขเป็นตาราง">
        {hasGroups ? table("แยกกลุ่ม", groups) : null}
        {table("แยกบัญชี", accounts)}
      </TableView>
      {spans ? <p className="mt-1 text-xs text-muted-foreground">กลุ่ม: ไลฟ์ที่คร่อมหลายกลุ่มแบ่งตัวเลขตามนาที · ไม่ใช่ Agency = ทีมเรา (TikTok ของเรา / Shopee In house)</p> : null}
    </section>
  );
}

/** GMV/ชม. เส้นละกลุ่ม รวมแพลตฟอร์ม (บวกกันไม่ได้ จึงแยกจากกราฟแท่ง ไม่ใช้สองแกน) + ตาราง GMV/ชม. และชั่วโมง */
function AgencyLines({ trend: byPlatform, categories, titles, label, rowHead, replay }: {
  trend: AgencyTrend[]; categories: string[]; titles: string[]; label: string; rowHead: string; replay: string;
}) {
  const trend = mergePlatforms(byPlatform);
  const series = trend.map((t) => ({ name: t.label, color: agencyColor(t.key), values: t.perHour }));
  const baht = (v: number | null) => fmtMetric("baht", v);
  const hrs = (v: number | null) => (v === null ? "-" : v.toFixed(1));
  const hasRow = (i: number) => trend.some((t) => t.gmv[i] !== null);
  return (
    <>
      <LineChart
        key={`agency|${replay}`} label={label} categories={categories} tooltipTitles={titles} series={series}
        format={baht} formatAxis={(v) => fmtMetric("baht", v, true)}
      />
      {trend.length > 1 ? <div className="mt-1"><Legend series={series} line /></div> : null}
      <p className="mt-1 text-xs text-muted-foreground">{agencyNote(trend, true)}</p>
      <TableView title="ดูเป็นตาราง">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{rowHead}</TableHead>
              {trend.map((t) => <TableHead key={t.key} className="text-right">GMV/ชม. {t.label}</TableHead>)}
              {trend.map((t) => <TableHead key={t.key} className="text-right">ชม. {t.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((c, i) => (hasRow(i) ? (
              <TableRow key={c}>
                <TableCell>{titles[i]}</TableCell>
                {trend.map((t) => <TableCell key={t.key} className="text-right tabular-nums">{baht(t.perHour[i])}</TableCell>)}
                {trend.map((t) => <TableCell key={t.key} className="text-right tabular-nums">{hrs(t.hours[i])}</TableCell>)}
              </TableRow>
            ) : null))}
          </TableBody>
        </Table>
      </TableView>
    </>
  );
}

/**
 * ตารางแยก GMV ตามกลุ่มผู้ไลฟ์ต่อช่อง: กลุ่มที่บันทึกไว้กับไลฟ์ / เทียบเวลาไลฟ์ในไฟล์กับแพลนหน้า Plan Slot Live (src/lib/live-owners.ts)
 *   เดือนที่ไม่มีข้อมูลกลุ่มของช่องนั้น = ไม่นับ · กราฟแยกกลุ่มอยู่ในแท็บ "แยก Agency" ของการ์ดกราฟด้านบน
 */
/**
 * แถบสัดส่วน GMV ของแต่ละกลุ่มในช่องเดียว (ผู้ใช้ขอ 2026-11-10) · สีตามกลุ่มแบบเดียวกับกราฟแยก Agency
 *   ช่องว่าง 2px สีพื้นคั่นแต่ละส่วน · ชื่อ + % อยู่ใต้แถบ (ไม่ใช้สีอย่างเดียว)
 */
function ShareBar({ c }: { c: ChannelSplit }) {
  const parts = c.rows.filter((r) => r.gmv > 0);
  const pct = (gmv: number) => `${((gmv / c.gmv) * 100).toFixed(1)}%`;
  const color = (owner: string | null) => agencyColor(!owner || owner === "In house" ? AGENCY_OURS : owner);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{c.label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">GMV {fmtMetric("baht", c.gmv)}</span>
      </div>
      <div
        role="img" aria-label={`สัดส่วน GMV ${c.label}: ${parts.map((r) => `${r.label} ${pct(r.gmv)}`).join(", ")}`}
        className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full"
      >
        {parts.map((r) => (
          <div key={r.owner ?? ""} className="h-full min-w-0.5" style={{ width: `${(r.gmv / c.gmv) * 100}%`, background: color(r.owner) }} title={`${r.label} ${fmtMetric("baht", r.gmv)} · ${pct(r.gmv)}`} />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {parts.map((r) => (
          <li key={r.owner ?? ""} className="inline-flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color(r.owner) }} aria-hidden />
            <span className="text-muted-foreground">{r.label}</span><span className="font-semibold tabular-nums">{pct(r.gmv)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OwnerTable({ owners, sessions }: { owners: { spans?: OwnerSpan[]; error?: string }; sessions: LiveSession[] }) {
  if (owners.error) return <Notice variant="warning">โหลดแพลนของกลุ่มไม่สำเร็จ จึงยังแยก GMV ตามกลุ่มไม่ได้: {owners.error}</Notice>;
  if (!owners.spans) return null;
  const channels = splitByOwner(sessions, owners.spans);
  if (!channels.length) return null;
  const splitLives = channels.reduce((a, c) => a + c.splitLives, 0), splitGmv = channels.reduce((a, c) => a + c.splitGmv, 0);
  const fixed = sessions.filter((s) => s.liveOwner).length, counted = channels.reduce((a, c) => a + c.lives, 0);
  const howText = !fixed ? "เทียบเวลาไลฟ์ในไฟล์กับเวลาในหน้าแพลน แก้แพลนแล้วตัวเลขเปลี่ยนตาม"
    : fixed === counted ? "ใช้กลุ่มที่ยืนยันไว้กับแต่ละไลฟ์ แก้แพลนแล้วตัวเลขไม่เปลี่ยน"
    : "เดือนก่อนมีแพลนในเว็บใช้กลุ่มที่ยืนยันไว้กับแต่ละไลฟ์ · เดือนที่มีแพลนเทียบเวลาไลฟ์กับหน้าแพลน · เดือนที่ไม่มีข้อมูลกลุ่มไม่นับ";
  const perHour = (gmv: number, sec: number) => fmtMetric("baht", sec ? gmv / (sec / 3600) : null);
  const pct = (gmv: number, total: number) => (total ? `${((gmv / total) * 100).toFixed(1)}%` : "-");
  return (
    <section className="my-4">
      <h2 className="mb-2 text-lg font-bold">แยกตามกลุ่มผู้ไลฟ์</h2>
      <div className="mb-3 grid gap-x-6 gap-y-4 rounded-xl border bg-card p-3 sm:grid-cols-2">
        {channels.map((c) => <ShareBar key={c.channel} c={c} />)}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>กลุ่ม</TableHead><TableHead className="hidden text-right sm:table-cell">ไลฟ์</TableHead><TableHead className="hidden text-right sm:table-cell">ชม.</TableHead>
              <TableHead className="text-right">GMV</TableHead><TableHead className="text-right max-sm:pr-3">สัดส่วน</TableHead><TableHead className="hidden text-right sm:table-cell">GMV/ชม.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.flatMap((c) => [
              <TableRow key={c.channel} className="bg-muted/50 font-semibold hover:bg-muted/50">
                <TableCell>
                  {c.label}
                  <span className="block text-xs font-normal text-muted-foreground tabular-nums sm:hidden">{c.lives} ไลฟ์ · {(c.sec / 3600).toFixed(1)} ชม.</span>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.lives}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{(c.sec / 3600).toFixed(1)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMetric("baht", c.gmv)}</TableCell>
                <TableCell className="text-right tabular-nums max-sm:pr-3">100%</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{perHour(c.gmv, c.sec)}</TableCell>
              </TableRow>,
              ...c.rows.map((r) => (
                <TableRow key={`${c.channel}|${r.owner ?? ""}`}>
                  <TableCell className="whitespace-normal pl-5 sm:whitespace-nowrap">
                    {r.label}
                    <span className="block text-xs text-muted-foreground tabular-nums sm:hidden">{r.lives} ไลฟ์ · {(r.sec / 3600).toFixed(1)} ชม. · {perHour(r.gmv, r.sec)}/ชม.</span>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.lives}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{(r.sec / 3600).toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMetric("baht", r.gmv)}</TableCell>
                  <TableCell className="text-right tabular-nums max-sm:pr-3">{pct(r.gmv, c.gmv)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{perHour(r.gmv, r.sec)}</TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {howText} · ยอดด้านบนยังรวมทุกกลุ่ม
        {splitLives ? ` · มี ${splitLives} ไลฟ์คร่อมหลายกลุ่ม (รวม ${fmtMetric("baht", splitGmv)}) แบ่งยอดตามนาที เป็นตัวเลขประมาณ` : ""}
      </p>
    </section>
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
      {/* มือถือ: ซ่อนคอลัมน์ ไลฟ์ / ชม. / GMV/ชม. / CO ย้ายไปใต้ชื่อบัญชี ให้เห็น GMV + vs เดือนก่อน โดยไม่ต้องเลื่อน */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>บัญชี</TableHead><TableHead className="hidden text-right sm:table-cell">ไลฟ์</TableHead><TableHead className="hidden text-right sm:table-cell">ชม.</TableHead>
              <TableHead className="text-right">GMV</TableHead><TableHead className="text-right">vs {prevLabel}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">GMV/ชม.</TableHead><TableHead className="hidden text-right sm:table-cell">CO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const t = totalsOf(cur.filter((s) => `${s.platform}|${s.accountId}` === a.key));
              const p = totalsOf(prev.filter((s) => `${s.platform}|${s.accountId}` === a.key));
              return (
                <TableRow key={a.key}>
                  <TableCell className="whitespace-normal sm:whitespace-nowrap">
                    {a.name !== a.platform ? <><span className="text-xs text-muted-foreground">{a.platform}</span><br /></> : null}{a.name}
                    <span className="block text-xs text-muted-foreground tabular-nums sm:hidden">
                      {t.lives} ไลฟ์ · {(t.durationSec / 3600).toFixed(1)} ชม. · CO {fmtMetric("pct", co.value(t))}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{t.lives}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{(t.durationSec / 3600).toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMetric("baht", t.gmv)}</TableCell>
                  <TableCell className="text-right"><ChangeText cur={t.lives ? t.gmv : null} prev={p.lives ? p.gmv : null} /></TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtMetric("baht", perHour.value(t))}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtMetric("pct", co.value(t))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>
                รวม
                <span className="block text-xs font-normal text-muted-foreground tabular-nums sm:hidden">{all.lives} ไลฟ์ · {(all.durationSec / 3600).toFixed(1)} ชม.</span>
              </TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{all.lives}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{(all.durationSec / 3600).toFixed(1)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtMetric("baht", gmv.value(all))}</TableCell>
              <TableCell className="text-right"><ChangeText cur={all.gmv} prev={prev.length ? totalsOf(prev).gmv : null} /></TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtMetric("baht", perHour.value(all))}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtMetric("pct", co.value(all))}</TableCell>
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

/** +12.7% / -1.14pp สีเขียว/แดง (ไม่มีข้อมูล = -) */
function Delta({ kind, a, b, className }: { kind: (typeof METRICS)[number]["kind"]; a: number | null; b: number | null; className?: string }) {
  const d = deltaOf(kind, a, b);
  if (!d) return <span className={cn("text-muted-foreground", className)}>-</span>;
  const flat = Math.abs(d.value) < (kind === "pct" ? 0.005 : 0.0005);
  return <span className={cn("font-semibold tabular-nums", flat ? "text-muted-foreground" : d.value > 0 ? "text-success" : "text-destructive", className)}>{d.text}</span>;
}

/** "YYYY-MM-DD" เลื่อนไป n เดือน วันที่เดิม (เดือนนั้นมีวันน้อยกว่า = วันสุดท้ายของเดือน) เช่น 31 ต.ค. -1 = 30 ก.ย. */
function shiftMonthDay(k: string, n: number) {
  const [y, m, d] = k.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
/** ช่วงวันสั้น เช่น "19–22 ก.ค." / "28 ก.ย.–3 ต.ค." */
function dayRangeShort(a: string, b: string) {
  const da = new Date(`${a}T12:00:00Z`), db = new Date(`${b}T12:00:00Z`);
  return a.slice(0, 7) === b.slice(0, 7) ? `${+a.slice(8)}–${fmtRangeDay.format(db)}` : `${fmtRangeDay.format(da)}–${fmtRangeDay.format(db)}`;
}

/**
 * เทียบหลายเดือน (ไม่เกิน 12): ค่าของทุกเดือน + เดือนหลัก vs เดือนอื่นทีละเดือน (เช่น ก.ย. vs ก.ค. / ก.ย. vs ส.ค.)
 *   เดือนหลัก = เดือนสุดท้ายของช่วง (ค่าเริ่มต้น) / เลือกเองได้ / GMV สูงสุด (ไม่นับเดือนที่ยังไม่จบ)
 *   CTR / CO เทียบเป็น pp ค่าอื่นเป็น %
 *   days = เทียบเฉพาะช่วงวันเดียวกันของแต่ละเดือน (เช่น 19–22 ก.ค. / ส.ค. / ก.ย. / ต.ค.) จากโหมด "ช่วงวันที่"
 *     ช่วงที่เลือกเป็นเดือนหลัก (ค่าเริ่มต้น) · ค่าเริ่มต้น = 3 เดือนก่อนหน้า ถึงเดือนของช่วงที่เลือก
 */
function MultiMonthView({ dataMonths, version, days }: { dataMonths: string[]; version: number; days?: { a: string; b: string } }) {
  const sorted = dataMonths.slice().sort();
  const base = days ? days.a.slice(0, 7) : null;
  const last = base ?? (sorted.length ? sorted[sorted.length - 1] : monthKey());
  const [range, setRange] = useState<MonthRange>(() => ({ from: monthKey(days ? -3 : -2, last), to: last }));
  const [focusPick, setFocusPick] = useState<string>(base ?? "last"); // "last" / "best" / "YYYY-MM"
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const filter = useFilter();
  const n = monthsIn(range);
  const keys = Array.from({ length: n }, (_, i) => monthKey(i, range.from));
  // ช่วงของแต่ละเดือน: ทั้งเดือน หรือ ช่วงวันเดียวกัน (เลื่อนจากช่วงที่เลือกทีละเดือน)
  const dayWin = (k: string) => (days ? [shiftMonthDay(days.a, monthDiff(base!, k)), shiftMonthDay(days.b, monthDiff(base!, k))] as const : null);
  const win = (k: string): Period => { const w = dayWin(k); return w ? rangePeriod(w[0], w[1]) : { ...monthWindow(k), name: monthLabel(k) }; };
  const nowIso = new Date().toISOString();
  // ยังไม่จบ: เดือนปัจจุบัน / ช่วงวันที่ยังไม่จบ
  const open = (k: string) => (days ? win(k).to > nowIso : k === monthKey());
  const long = (k: string) => (days ? win(k).name.replace(/ \(\d+ วัน\)$/, "") : monthLabel(k));
  const { data, error, retry } = useSessions(n ? win(keys[0]).from : null, n ? win(keys[n - 1]).to : null, version);
  // ช่วงวันอาจล้นไปต้นเดือนถัดไป = โหลดแพลนเผื่อไว้อีกเดือน
  const owners = useOwnerSpans(n ? `from=${range.from}&to=${monthKey(1, range.to)}` : null, version);
  const [split, setSplit] = useState<Split>("platform");

  const controls = (
    <div className="my-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">
            {days ? `เดือนที่จะเทียบ (กดเดือนเริ่ม แล้วกดเดือนสุดท้าย) — นับเฉพาะวันที่ ${dayRangeShort(days.a, days.b).replace(/ .*$/, "")} ของแต่ละเดือน` : "ช่วงเดือน (กดเดือนเริ่ม แล้วกดเดือนสุดท้าย)"}
          </span>
          <MonthPicker mode="range" value={range} onChange={(r) => { setRange(r); setFocusPick(base && r.from <= base && base <= r.to ? base : "last"); }} marked={dataMonths} className="w-full justify-start" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">{days ? "ช่วงหลัก (เทียบกับเดือนอื่นทีละเดือน)" : "เดือนหลัก (เทียบกับเดือนอื่นทีละเดือน)"}</span>
          <Select value={focusPick} onValueChange={setFocusPick}>
            <SelectTrigger aria-label="เดือนหลัก" className="h-9 w-full rounded-full bg-card font-semibold"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="last">เดือนสุดท้าย ({shortMonth(range.to).split(" ")[0]})</SelectItem>
              <SelectItem value="best">{days ? "ช่วงที่ GMV สูงสุด" : "เดือนที่ GMV สูงสุด"}</SelectItem>
              {keys.map((k) => <SelectItem key={k} value={k}>{long(k)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
  if (n < 2) return <>{controls}<StateBox title="เลือกอย่างน้อย 2 เดือน">กดเดือนเริ่ม แล้วกดเดือนสุดท้าย เช่น ก.ค. ถึง ก.ย.</StateBox></>;
  if (!data) return <>{controls}{error ? <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={retry} /> : <LoadingBlock />}</>;

  const list = filterSessions(data, filter.platform, filter.account);
  const byMonth = new Map<string, LiveSession[]>(keys.map((k) => [k, []]));
  // รายวันของแต่ละเดือน (โหมดช่วงวัน): วันที่ 1, 2, ... ของช่วง นับจากวันเริ่มของช่วงในเดือนนั้น
  const nDays = days ? dayCount(days.a, days.b) : 0;
  const dayLabels = days ? Array.from({ length: nDays }, (_, i) => `วันที่ ${+dayKeyShift(days.a, i).slice(8)}`) : [];
  const byDay = new Map<string, LiveSession[][]>(keys.map((k) => [k, Array.from({ length: nDays }, () => [])]));
  if (days) {
    const wins = keys.map((k) => ({ k, from: Date.parse(win(k).from), to: Date.parse(win(k).to) }));
    for (const s of list) {
      const t = Date.parse(s.startedAt);
      const w = wins.find((x) => t >= x.from && t < x.to);
      if (!w) continue;
      byMonth.get(w.k)!.push(s);
      byDay.get(w.k)![Math.min(nDays - 1, Math.floor((t - w.from) / 86400_000))]?.push(s);
    }
  } else {
    for (const s of list) byMonth.get(monthOf(s.startedAt))?.push(s);
  }
  const totals = new Map(keys.map((k) => [k, totalsOf(byMonth.get(k)!)]));
  const valueAt = (k: string, mk: MetricKey) => { const t = totals.get(k)!; return t.lives ? metricOf(mk).value(t) : null; };
  // เดือน / ช่วงที่จบแล้วและมีข้อมูล (ใช้หาสูงสุด / ต่ำสุด)
  const complete = keys.filter((k) => !open(k) && totals.get(k)!.lives);
  const now = keys.find(open) ?? "";
  const bestBy = (mk: MetricKey, dir = 1) => complete.reduce<string | null>((b, k) => (b === null || dir * ((valueAt(k, mk) ?? 0) - (valueAt(b, mk) ?? 0)) > 0 ? k : b), null);
  const focus = focusPick === "best" ? bestBy("gmv") ?? range.to : focusPick === "last" ? range.to : keys.includes(focusPick) ? focusPick : range.to;
  const others = keys.filter((k) => k !== focus);
  const short = (k: string) => {
    const w = dayWin(k);
    if (w) return `${dayRangeShort(w[0], w[1])}${k.slice(0, 4) !== range.to.slice(0, 4) ? ` ${k.slice(2, 4)}` : ""}${open(k) ? "*" : ""}`;
    return `${shortMonth(k).split(" ")[0]}${k.slice(0, 4) !== range.to.slice(0, 4) ? ` ${k.slice(2, 4)}` : ""}${open(k) ? "*" : ""}`;
  };
  const rangeText = days ? `วันที่ ${dayRangeShort(days.a, days.b).replace(/ .*$/, "")} ของ ${rangeLabel(range)}` : rangeLabel(range);
  const metrics = MULTI_ORDER.map((mk) => metricOf(mk));

  const best = bestBy("gmv"), worst = bestBy("gmv", -1);
  const gmvSum = complete.reduce((s, k) => s + (valueAt(k, "gmv") ?? 0), 0);
  const firstDone = complete[0], lastDone = complete[complete.length - 1];
  const def = metricOf(metric);
  const chartBest = keys.indexOf(bestBy(metric) ?? "");
  const exportFilter = { platform: filter.platform, account: filter.account, sessions: data };
  const replay = `${range.from}|${range.to}|${filter.platform}|${filter.account}`;
  const agency = owners.spans ? agencyTrend(keys.map((k) => byMonth.get(k)!), owners.spans) : null;
  const byAgency = split === "agency" && hasAgency(agency);
  const unitWord = days ? "แต่ละช่วง" : "รายเดือน";

  return (
    <>
      {controls}
      {now ? <Notice>{long(now)} ยังไม่จบ{days ? "ช่วง" : "เดือน"} (*) ตัวเลขนับเฉพาะไลฟ์ที่อัปโหลดแล้ว และไม่นับเป็นสูงสุด/ต่ำสุด</Notice> : null}
      <FilterBar filter={filter} sessions={data}>
        <div className="flex flex-wrap gap-2">
          <ExportMenu size="sm" label="ส่งออก" build={async () => multiBook({
            rangeText, monthLabel: long, shortLabel: short, keys, focus, byMonth, filter: exportFilter,
            ...(days && nDays > 1 ? { daily: { labels: dayLabels, byDay } } : {}),
            crew: await loadCrew(keys.flatMap((k) => byMonth.get(k) ?? [])),
            extras: agency ? { agency: [{ name: "แยก Agency", first: days ? "ช่วง" : "เดือน", labels: keys.map(long), trend: agency }] } : undefined,
          })} />
          <SlidesMenu label="สไลด์" title={`GLORY เทียบหลายเดือน ${rangeText}`} build={(target) => buildMultiDeck({
            rangeText, keys, focus, label: short, longLabel: long, byMonth, now,
            filterText: filterText(exportFilter).join(" · "), exportedAt: bkkStamp(new Date().toISOString()),
            ...(days && nDays > 1 ? { daily: { labels: dayLabels, byDay } } : {}),
            agency: agency ? [{ title: `GMV ${unitWord} แยก Agency`, labels: keys.map(short), trend: agency, lineTitle: `GMV/ชม. ${unitWord} แยก Agency` }] : undefined,
          }, target)} />
        </div>
      </FilterBar>

      {complete.length ? (
        <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ["GMV สูงสุด", best ? long(best) : "-", best ? fmtMetric("baht", valueAt(best, "gmv")) : ""],
            ["GMV ต่ำสุด", worst ? long(worst) : "-", worst ? fmtMetric("baht", valueAt(worst, "gmv")) : ""],
            [days ? "GMV เฉลี่ยต่อช่วง" : "GMV เฉลี่ยต่อเดือน", fmtMetric("baht", gmvSum / complete.length), `${complete.length} ${days ? "ช่วง" : "เดือน"}ที่จบแล้ว`],
            ["แนวโน้ม", firstDone && lastDone && firstDone !== lastDone ? `${short(firstDone)} → ${short(lastDone)}` : "-", ""],
          ] as const).map(([label, big, sub], i) => (
            <div key={label} className="rounded-xl border bg-card px-3 py-2.5">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="font-bold">{big}</div>
              {i === 3 && firstDone && lastDone && firstDone !== lastDone
                ? <Delta kind="baht" a={valueAt(lastDone, "gmv")} b={valueAt(firstDone, "gmv")} className="text-sm" />
                : <div className="text-sm tabular-nums text-muted-foreground">{sub}</div>}
            </div>
          ))}
        </div>
      ) : null}

      <section className="my-4">
        <h2 className="mb-2 text-lg font-bold">เทียบทุกตัวชี้วัด <span className="text-sm font-normal text-muted-foreground">{days ? "ช่วงหลัก" : "เดือนหลัก"}: {long(focus)}</span></h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Total</TableHead>
                {keys.map((k) => <TableHead key={k} className={cn("text-right", k === focus && "text-foreground")}>{short(k)}</TableHead>)}
                {others.map((k) => <TableHead key={k} className="border-l text-right whitespace-nowrap">{short(focus)} vs {short(k)}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((m) => (
                <TableRow key={m.key}>
                  <TableCell className="font-semibold whitespace-nowrap">{m.label}{m.note && m.note.length <= 8 ? <span className="text-xs font-normal text-muted-foreground"> · {m.note}</span> : null}</TableCell>
                  {keys.map((k) => (
                    <TableCell key={k} className={cn("text-right tabular-nums whitespace-nowrap", k === focus && "font-bold")}>{fmtMetric(m.kind, valueAt(k, m.key))}</TableCell>
                  ))}
                  {others.map((k) => (
                    <TableCell key={k} className="border-l text-right whitespace-nowrap"><Delta kind={m.kind} a={valueAt(focus, m.key)} b={valueAt(k, m.key)} /></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">CTR / CO เทียบเป็น pp (ผลต่างของ %) · ค่าอื่นเป็น % ที่เปลี่ยน · CO รวมสองแพลตฟอร์มไม่คำนวณ เลือก TikTok หรือ Shopee เพื่อดู</p>
      </section>

      <section className="my-4 rounded-2xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{byAgency ? `GMV ${unitWord} แยก Agency` : `${def.label} รายเดือน`}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {hasAgency(agency) ? <SplitTabs value={byAgency ? "agency" : "platform"} onChange={setSplit} /> : null}
            {byAgency ? null : <MetricSelect value={metric} onChange={setMetric} />}
          </div>
        </div>
        {byAgency ? (
          <AgencyBars trend={agency!} categories={keys.map(short)} titles={keys.map(long)} label={`GMV ${unitWord} แยก Agency`} rowHead={days ? "ช่วง" : "เดือน"} replay={replay} />
        ) : (
          <>
            <PlatformBars
              series={platformLines(keys.map((k) => byMonth.get(k)!), metric)} metric={metric} replay={replay}
              label={`${def.label} รายเดือน`}
              categories={keys.map(short)}
              titles={keys.map(long)}
              highlight={chartBest >= 0 ? chartBest : undefined}
            />
            {chartBest >= 0 ? <p className="mt-1 text-xs text-muted-foreground">ชื่อตัวหนา = {days ? "ช่วง" : "เดือน"}ที่ {def.label} สูงสุด ({long(keys[chartBest])})</p> : null}
          </>
        )}
      </section>

      <TrendSection
        title={`${def.label} แนวโน้ม${days ? "ของแต่ละช่วง" : "รายเดือน"}`}
        label={`แนวโน้ม ${def.label} ${rangeText}`}
        rowHead={days ? "ช่วง" : "เดือน"}
        categories={keys.map(short)}
        titles={keys.map(long)}
        series={trendLines(keys.map((k) => byMonth.get(k)!), metric)}
        metric={metric}
        onMetric={setMetric}
        replay={replay}
        table={false}
        agency={{ trend: agency, title: `GMV/ชม. ${unitWord} แยก Agency` }}
      />

      {days && nDays > 1 ? (
        <DailyByMonth
          keys={keys} focus={focus} labels={dayLabels} byDay={byDay} short={short} long={long}
          metric={metric} onMetric={setMetric} replay={replay}
        />
      ) : null}

      <section className="my-4">
        <h2 className="mb-2 text-lg font-bold">GMV แยกตามบัญชี</h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>บัญชี</TableHead>
                {keys.map((k) => <TableHead key={k} className="text-right">{short(k)}</TableHead>)}
                {others.map((k) => <TableHead key={k} className="border-l text-right whitespace-nowrap">{short(focus)} vs {short(k)}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {accountsOf(keys.flatMap((k) => byMonth.get(k)!)).map((acc) => {
                const g = (k: string) => { const t = totalsOf(byMonth.get(k)!.filter((s) => `${s.platform}|${s.accountId}` === acc.key)); return t.lives ? t.gmv : null; };
                return (
                  <TableRow key={acc.key}>
                    <TableCell className="whitespace-nowrap">{acc.name}</TableCell>
                    {keys.map((k) => <TableCell key={k} className={cn("text-right tabular-nums whitespace-nowrap", k === focus && "font-bold")}>{fmtMetric("baht", g(k))}</TableCell>)}
                    {others.map((k) => <TableCell key={k} className="border-l text-right whitespace-nowrap"><Delta kind="baht" a={g(focus)} b={g(k)} /></TableCell>)}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}

/** สีของแต่ละเดือนในกราฟรายวัน: ช่วงหลัก = สีหลัก · ที่เหลือวนตามลำดับ */
const MONTH_COLORS = [PREV, "var(--p1)", "var(--p3)", "var(--p2)", "var(--p0)"];

/**
 * รายวันของแต่ละเดือน (โหมดช่วงวันเดียวกันหลายเดือน): กราฟแท่งวันละกลุ่ม (เดือนละแท่ง) + กราฟเส้นเดือนละเส้น + ตาราง วัน × เดือน + ช่วงหลัก vs เดือนอื่น
 *   ใช้ตัวชี้วัดเดียวกับกราฟรายเดือน (เปลี่ยนได้ที่นี่ด้วย)
 */
function DailyByMonth({ keys, focus, labels, byDay, short, long, metric, onMetric, replay }: {
  keys: string[]; focus: string; labels: string[]; byDay: Map<string, LiveSession[][]>;
  short: (k: string) => string; long: (k: string) => string; metric: MetricKey; onMetric: (m: MetricKey) => void; replay: string;
}) {
  const def = metricOf(metric);
  const val = (list: LiveSession[] | undefined) => { const t = totalsOf(list ?? []); return t.lives ? def.value(t) : null; };
  const others = keys.filter((k) => k !== focus);
  let c = 0;
  const colorOf = new Map(keys.map((k) => [k, k === focus ? CUR : MONTH_COLORS[c++ % MONTH_COLORS.length]]));
  const fmt = (v: number | null) => fmtMetric(def.kind, v);
  const series = keys.map((k) => ({ name: short(k), color: colorOf.get(k)!, values: byDay.get(k)!.map((d) => val(d)) }));
  const categories = labels.map((l) => l.replace("วันที่ ", ""));
  return (
    <>
    <section className="my-4 rounded-2xl border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{def.label} รายวันของแต่ละเดือน</h2>
        <MetricSelect value={metric} onChange={onMetric} />
      </div>
      <BarChart
        key={`${metric}|${replay}`}
        label={`${def.label} รายวันของแต่ละเดือน`}
        categories={categories}
        tooltipTitles={labels}
        series={series}
        format={fmt}
        formatAxis={(x) => fmtMetric(def.kind === "hours" ? "int" : def.kind, x, true)}
      />
      <Legend series={keys.map((k) => ({ name: long(k), color: colorOf.get(k)! }))} />
      <div className="mt-3 overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>วัน</TableHead>
              {keys.map((k) => <TableHead key={k} className={cn("text-right whitespace-nowrap", k === focus && "text-foreground")}>{short(k)}</TableHead>)}
              {others.map((k) => <TableHead key={k} className="border-l text-right whitespace-nowrap">{short(focus)} vs {short(k)}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {labels.map((l, i) => (
              <TableRow key={l}>
                <TableCell className="font-semibold whitespace-nowrap">{l}</TableCell>
                {keys.map((k) => <TableCell key={k} className={cn("text-right tabular-nums whitespace-nowrap", k === focus && "font-bold")}>{fmt(val(byDay.get(k)![i]))}</TableCell>)}
                {others.map((k) => (
                  <TableCell key={k} className="border-l text-right whitespace-nowrap">
                    <Delta kind={def.kind} a={val(byDay.get(focus)![i])} b={val(byDay.get(k)![i])} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>รวม</TableCell>
              {keys.map((k) => <TableCell key={k} className={cn("text-right tabular-nums whitespace-nowrap", k === focus && "font-bold")}>{fmt(val(byDay.get(k)!.flat()))}</TableCell>)}
              {others.map((k) => (
                <TableCell key={k} className="border-l text-right whitespace-nowrap">
                  <Delta kind={def.kind} a={val(byDay.get(focus)!.flat())} b={val(byDay.get(k)!.flat())} />
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">วันที่เดียวกันของแต่ละเดือน (เช่น วันที่ 19 ก.ค. / ส.ค. / ก.ย. / ต.ค.) · เดือนที่ไม่มีวันนั้น = วันสุดท้ายของเดือน</p>
    </section>
    <TrendSection
      title={`${def.label} แนวโน้มรายวันของแต่ละเดือน`}
      label={`แนวโน้ม ${def.label} รายวันของแต่ละเดือน`}
      rowHead="วัน"
      categories={categories}
      titles={labels}
      series={series}
      metric={metric}
      onMetric={onMetric}
      replay={replay}
      table={false}
    />
    </>
  );
}

// ---------- เทียบช่วงวันที่ (เลือกวันเริ่ม–วันจบเอง) ----------

/** ช่วงยาวสุดที่เลือกได้ (โหลดไลฟ์ทั้งช่วงมาในเครื่อง) */
const RANGE_MAX_DAYS = 92;
const dayCount = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000) + 1;
const fmtRangeDay = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", timeZone: "UTC" });
/** ช่วงวัน "YYYY-MM-DD" ถึง "YYYY-MM-DD" (รวมวันจบ) -> ช่วงเวลาไทย + ชื่อ เช่น "19–23 ต.ค. 2026 (5 วัน)" */
function rangePeriod(a: string, b: string): Period {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  const da = new Date(`${a}T12:00:00Z`), db = new Date(`${b}T12:00:00Z`);
  const n = dayCount(a, b);
  const name = a === b ? dayPeriod(a).name
    : `${m1 === m2 && y1 === y2 ? String(d1) : fmtRangeDay.format(da)}–${fmtRangeDay.format(db)} ${y2}${y1 !== y2 ? ` (เริ่ม ${y1})` : ""} (${n} วัน)`;
  return { from: bkkIso(y1, m1, d1), to: bkkIso(y2, m2, d2 + 1), name };
}
type RangeVs = "none" | "prev" | "month" | "months" | "custom";

/**
 * เทียบช่วงวันที่: เลือกวันเริ่ม–วันจบเอง (ไม่เกิน 92 วัน) ดูตัวเลขรวมของช่วง (GMV / Viewers / ออเดอร์ ...) + กราฟรายวัน
 *   เทียบกับ: ไม่เทียบ / ช่วงก่อนหน้า (ยาวเท่ากัน ต่อกันพอดี) / ช่วงเดียวกันเดือนก่อน / เลือกช่วงเอง
 *     / หลายเดือน (ช่วงวันเดียวกันของแต่ละเดือน เช่น 19–22 ก.ค. ส.ค. ก.ย. ต.ค. — ตารางแบบแท็บหลายเดือน · ช่วงไม่เกิน 31 วัน)
 */
function RangeCompare({ dataMonths, version }: { dataMonths: string[]; version: number }) {
  // ค่าเริ่มต้น: 7 วันล่าสุดถึงเมื่อวาน (เดือนนี้ยังไม่มีข้อมูล = 7 วันสุดท้ายของเดือนล่าสุดที่มีข้อมูล)
  const [init] = useState(() => {
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const latestMonth = dataMonths.slice().sort().at(-1);
    const end = !latestMonth || latestMonth >= today.slice(0, 7) ? dayKeyShift(today, -1) : dayKeyShift(`${monthKey(1, latestMonth)}-01`, -1);
    return { today, from: dayKeyShift(end, -6), to: end };
  });
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [vs, setVs] = useState<RangeVs>("none");
  const [cFrom, setCFrom] = useState(() => dayKeyShift(init.from, -7));
  const [cTo, setCTo] = useState(() => dayKeyShift(init.to, -7));
  // เลือกวันจบก่อนวันเริ่ม = สลับให้
  const a = from <= to ? from : to, b = from <= to ? to : from;
  const ca = cFrom <= cTo ? cFrom : cTo, cb = cFrom <= cTo ? cTo : cFrom;
  const n = dayCount(a, b);
  const prevRange = vs === "prev" ? [dayKeyShift(a, -n), dayKeyShift(a, -1)]
    : vs === "month" ? [sameDayLastMonth(a), sameDayLastMonth(b)]
      : vs === "custom" ? [ca, cb] : null;
  const months = vs === "months";
  const tooLong = n > (months ? 31 : RANGE_MAX_DAYS) || (!!prevRange && dayCount(prevRange[0], prevRange[1]) > RANGE_MAX_DAYS);
  const picker = (value: string, onChange: (v: string) => void, label: string, swatch?: string) => (
    <div className="min-w-0 flex-1">
      <span className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">{swatch ? <span className={cn("size-2.5 rounded-[3px]", swatch)} /> : null}{label}</span>
      <DatePicker value={value} onChange={(v) => v && onChange(v)} aria-label={label} className="w-full" />
    </div>
  );
  const VS: [RangeVs, string][] = [
    ["none", "ไม่เทียบ (ดูช่วงเดียว)"], ["prev", `${n} วันก่อนหน้า`], ["month", "ช่วงเดียวกันเดือนก่อน"],
    ["months", "ช่วงเดียวกันหลายเดือน"], ["custom", "เลือกช่วงเทียบเอง"],
  ];
  const cur = rangePeriod(a, b);
  const prev = prevRange ? rangePeriod(prevRange[0], prevRange[1]) : null;

  return (
    <>
      <div className="my-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap gap-3 sm:flex-nowrap">
          {picker(from, setFrom, "วันเริ่ม", "bg-viz-cur")}
          {picker(to, setTo, "วันจบ (รวมวันนี้)")}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{cur.name}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {VS.map(([id, text]) => (
            <Button key={id} variant={vs === id ? "secondary" : "outline"} size="sm" className="rounded-full" aria-pressed={vs === id} onClick={() => setVs(id)}>
              {text}
            </Button>
          ))}
        </div>
        {vs === "custom" ? (
          <div className="mt-3 flex flex-wrap gap-3 sm:flex-nowrap">
            {picker(cFrom, setCFrom, "เทียบกับ: วันเริ่ม", "bg-viz-prev")}
            {picker(cTo, setCTo, "วันจบ")}
          </div>
        ) : prev ? <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2.5 rounded-[3px] bg-viz-prev" />เทียบกับ {prev.name}</p> : null}
      </div>
      {!months && (b >= init.today || (!!prevRange && prevRange[1] >= init.today)) ? <Notice>ช่วงที่เลือกมีวันนี้ (ยังไม่จบวัน) ตัวเลขนับเฉพาะไลฟ์ที่อัปโหลดแล้ว</Notice> : null}
      {tooLong ? (
        months ? <StateBox title="เทียบหลายเดือนได้ทีละไม่เกิน 31 วัน">เลือกวันเริ่ม–วันจบให้อยู่ในช่วง 1 เดือน เช่น 19–22</StateBox>
          : <StateBox title={`เลือกได้ไม่เกิน ${RANGE_MAX_DAYS} วันต่อช่วง`}>ช่วงยาวกว่านี้ ใช้แท็บ &ldquo;หลายเดือน&rdquo; หรือ &ldquo;ไตรมาส&rdquo; แทน</StateBox>
      ) : months ? (
        // เปลี่ยนวันเริ่ม / วันจบ = ตั้งช่วงเดือนใหม่ (นับจากเดือนของช่วงที่เลือก)
        <MultiMonthView key={`${a}|${b}`} dataMonths={dataMonths} version={version} days={{ a, b }} />
      )
        : prevRange && prevRange[0] === a && prevRange[1] === b ? <StateBox title="เลือกช่วงที่ต่างกัน">ช่วงที่เทียบต้องไม่ใช่ช่วงเดียวกัน</StateBox>
          : (
            <PeriodCompare
              report={prev ? `เทียบช่วงวันที่ (${VS.find(([id]) => id === vs)?.[1]})` : "ดูช่วงวันที่"}
              cur={cur} prev={prev} unit={n > 1 ? "day" : "hour"} dataMonths={dataMonths} version={version} fixHint="หรือเลือกช่วงอื่น" />
          )}
    </>
  );
}

// ---------- เทียบรายวัน (DoD) ----------

const DAY_SINGLE_KEY = "glory_live_day_single";
export const dayKeyShift = (k: string, by: number) => new Date(Date.parse(`${k}T00:00:00Z`) + by * 86400_000).toISOString().slice(0, 10);
/** วันเดียวกันของเดือนก่อน (เดือนก่อนมีวันน้อยกว่า = วันสุดท้ายของเดือนนั้น) เช่น 31 ต.ค. -> 30 ก.ย. */
function sameDayLastMonth(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 2, Math.min(d, last))).toISOString().slice(0, 10);
}
const fmtWeekday = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { weekday: "long", timeZone: "UTC" });
const fmtDayDate = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** วัน "YYYY-MM-DD" -> ช่วง 00:00–24:00 เวลาไทย */
export function dayPeriod(k: string): Period {
  const [y, m, d] = k.split("-").map(Number);
  // ชื่อช่วง เช่น "อาทิตย์ 6 ก.ย. 2026" (Intl ให้ "วันอาทิตย์" ตัดคำว่า "วัน" ออก)
  const date = new Date(`${k}T12:00:00Z`);
  return { from: bkkIso(y, m, d), to: bkkIso(y, m, d + 1), name: `${fmtWeekday.format(date).replace(/^วัน/, "")} ${fmtDayDate.format(date)}` };
}

/**
 * เทียบรายวัน: วันหลัก vs วันที่เลือก (ค่าเริ่มต้น = เมื่อวาน vs วันก่อนหน้า หรือวันสุดท้ายของเดือนล่าสุดที่มีข้อมูล)
 *   ปุ่มลัด: วันก่อน (DoD) / วันเดียวกันสัปดาห์ก่อน (WoW) / วันเดียวกันเดือนก่อน · กราฟแบ่งรายชั่วโมงได้
 */
function DayCompare({ dataMonths, version }: { dataMonths: string[]; version: number }) {
  // คิดครั้งเดียวตอนเปิด: วันนี้ (เวลาไทย) และวันเริ่มต้น = เมื่อวาน (ถ้าเดือนนี้มีข้อมูล) ไม่งั้นวันสุดท้ายของเดือนล่าสุดที่มีข้อมูล
  const [init] = useState(() => {
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const latestMonth = dataMonths.slice().sort().at(-1);
    const start = !latestMonth || latestMonth >= today.slice(0, 7)
      ? dayKeyShift(today, -1)
      : dayKeyShift(`${monthKey(1, latestMonth)}-01`, -1);
    return { today, start };
  });
  const today = init.today;
  const [a, setA] = useState(init.start);
  const [b, setB] = useState(() => dayKeyShift(init.start, -1));
  // ไม่เทียบ = ดูตัวเลขของวันเดียว (จำไว้ในเครื่อง)
  const single = useLocal(DAY_SINGLE_KEY) === "1";
  const setSingle = (v: boolean) => writeLocal(DAY_SINGLE_KEY, v ? "1" : "0");
  const presets: [string, string][] = [
    [dayKeyShift(a, -1), "วันก่อน (DoD)"],
    [dayKeyShift(a, -7), "วันเดียวกันสัปดาห์ก่อน (WoW)"],
    [sameDayLastMonth(a), "วันเดียวกันเดือนก่อน"],
  ];
  const kindOf = (v: string) =>
    v === dayKeyShift(a, -1) ? "DoD" : v === dayKeyShift(a, -7) ? "WoW" : v === sameDayLastMonth(a) ? "วันเดียวกันเดือนก่อน" : "เลือกเอง";
  const picker = (value: string, onChange: (v: string) => void, label: string, swatch: string) => (
    <div className="min-w-0 flex-1">
      <span className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("size-2.5 rounded-[3px]", swatch)} />{label}</span>
      <DatePicker value={value} onChange={(v) => v && onChange(v)} aria-label={label} className="w-full" />
    </div>
  );

  return (
    <>
      <div className="my-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap gap-3 sm:flex-nowrap">
          {picker(a, setA, "วัน", "bg-viz-cur")}
          {single ? null : picker(b, setB, "เทียบกับ", "bg-viz-prev")}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant={single ? "secondary" : "outline"} size="sm" className="rounded-full" aria-pressed={single} onClick={() => setSingle(true)}>
            ไม่เทียบ (ดูวันเดียว)
          </Button>
          {presets.map(([k, text]) => {
            const on = !single && b === k;
            return (
              <Button key={text} variant={on ? "secondary" : "outline"} size="sm" className="rounded-full" aria-pressed={on} onClick={() => { setB(k); setSingle(false); }}>
                {text}
              </Button>
            );
          })}
        </div>
      </div>
      {a === today || (!single && b === today) ? <Notice>วันนี้ยังไม่จบวัน ตัวเลขนับเฉพาะไลฟ์ที่อัปโหลดแล้ว</Notice> : null}
      {single ? (
        <PeriodCompare report="ดูรายวัน" cur={dayPeriod(a)} prev={null} unit="hour" dataMonths={dataMonths} version={version} fixHint="หรือเลือกวันอื่น" targetDay={a} />
      ) : a === b ? <StateBox title="เลือกวันที่ต่างกัน">เลือกวันในช่อง &ldquo;เทียบกับ&rdquo; หรือกดปุ่มลัดด้านบน</StateBox> : (
        <PeriodCompare
          report={`เทียบวัน (${kindOf(b)})`}
          cur={dayPeriod(a)} prev={dayPeriod(b)} unit="hour" dataMonths={dataMonths} version={version} fixHint="หรือเลือกวันอื่น" targetDay={a} />
      )}
    </>
  );
}

function PairCompare({ kind, dataMonths, version }: { kind: PeriodKind; dataMonths: string[]; version: number }) {
  const sorted = dataMonths.slice().sort();
  const k = PERIOD_KINDS[kind];
  const now = k.of(monthKey());
  const latest = sorted.length ? k.of(sorted[sorted.length - 1]) : now;
  // ช่วงที่เลือกของแต่ละหน่วย (สลับไปมาแล้วค่าเดิมยังอยู่) ยังไม่เลือก = ช่วงล่าสุดที่มีข้อมูล vs ช่วงก่อนหน้า
  const [picked, setPicked] = useState<Partial<Record<PeriodKind, { a: string; b: string }>>>({});
  const { a, b } = picked[kind] ?? { a: latest, b: k.shift(latest, -1) };
  const setA = (v: string) => setPicked((p) => ({ ...p, [kind]: { a: v, b } }));
  const setB = (v: string) => setPicked((p) => ({ ...p, [kind]: { a, b: v } }));
  // ปฏิทินเลือกเดือน / ไตรมาส (จุดใต้ชื่อ = มีข้อมูลแล้ว)
  const toRange = (v: string): MonthRange => kind === "month" ? { from: v, to: v } : { from: firstMonthOfQuarter(v), to: monthKey(2, firstMonthOfQuarter(v)) };
  const picker = (value: string, onChange: (q: string) => void, label: string, swatch: string) => (
    <div className="min-w-0 flex-1">
      <span className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("size-2.5 rounded-[3px]", swatch)} />{label}</span>
      <MonthPicker
        mode={kind === "month" ? "single" : "quarter"}
        value={toRange(value)}
        onChange={(r) => onChange(kind === "month" ? r.from : quarterOf(r.from))}
        marked={dataMonths}
        label={k.label(value)}
        className="w-full justify-start"
      />
    </div>
  );

  return (
    <>
      <div className="my-3 rounded-xl border bg-card p-3">
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

function CampaignView({ campaigns, dataMonths, version, readOnly, onChanged }: {
  campaigns: Campaign[];
  dataMonths: string[];
  version: number;
  readOnly: boolean;
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
            <SelectContent position="popper" className="max-h-80">
              {/* จากตาราง slot (ชื่อ Campaign ที่ตั้งในหน้า Plan Slot Live) ก่อน แล้วตามด้วยที่ตั้งเอง */}
              {[["auto", "จากตาราง slot (อัตโนมัติ)"], ["manual", "ตั้งเองในหน้านี้"]].map(([g, title]) => {
                const list = campaigns.filter((x) => (g === "auto") === !!x.auto);
                return list.length ? (
                  <SelectGroup key={g}>
                    <SelectLabel className="text-xs text-muted-foreground">{title}</SelectLabel>
                    {list.map((x) => (
                      <SelectItem key={x.id} value={String(x.id)}>{x.name} <span className="text-muted-foreground">· {bkkDate.format(new Date(x.startsAt))}</span></SelectItem>
                    ))}
                  </SelectGroup>
                ) : null;
              })}
            </SelectContent>
          </Select>
        ) : null}
        {c && !c.auto && !readOnly ? (
          <>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing(c)}><PencilIcon />แก้ไข</Button>
            <Button variant="outline" size="sm" className="rounded-full text-destructive" onClick={() => remove(c)}><Trash2Icon />ลบ</Button>
          </>
        ) : null}
        {readOnly ? null : <Button size="sm" className="rounded-full" onClick={() => setEditing("new")}><PlusIcon />เพิ่มแคมเปญเอง</Button>}
      </div>
      {c?.auto ? (
        <p className="mb-1 text-xs text-muted-foreground">
          แคมเปญนี้อ่านจากชื่อ Campaign ใน slot (หน้า Plan Slot Live) ช่วงวัน = วันแรกถึงวันสุดท้ายที่ตั้งชื่อนี้ · เทียบกับรอบก่อนของประเภทเดียวกัน · ข้อมูลชุดเดียวกับหน้าเจ้าของ &gt; ผลงาน Mc
        </p>
      ) : null}
      {c ? <CampaignCompare key={c.id} c={c} all={campaigns} dataMonths={dataMonths} version={version} /> : (
        <StateBox title="ยังไม่มีแคมเปญ" action={readOnly ? undefined : <Button onClick={() => setEditing("new")}><PlusIcon />เพิ่มแคมเปญ</Button>}>
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
  // แคมเปญที่ใหม่กว่าเป็นช่วงหลักเสมอ: VS / เปลี่ยน % = ใหม่ เทียบ เก่า (เช่น 10.10 vs 9.9) แม้ตั้ง "เทียบกับ" ไว้ที่แคมเปญเก่า
  const picked: Period = { from: c.startsAt, to: c.endsAt, name: c.name };
  const other: Period = { from: cmp.from, to: cmp.to, name: cmp.name };
  const swapped = Date.parse(other.from) > Date.parse(picked.from);
  const [cur, prev] = swapped ? [other, picked] : [picked, other];
  return (
    <>
      <div className="my-3 grid gap-2 rounded-xl border bg-card p-3 text-sm sm:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-[3px] bg-viz-cur" />{swapped ? `ช่วงหลัก: ${cur.name}` : "ช่วงแคมเปญ"}
          </span>
          <div className="font-semibold">{windowText(cur.from, cur.to)}</div>
        </div>
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-[3px] bg-viz-prev" />เทียบกับ {swapped ? prev.name : cmp.auto ? `(อัตโนมัติ: ${cmp.auto})` : prev.name}
          </span>
          <div className="font-semibold">{windowText(prev.from, prev.to)}</div>
        </div>
        {swapped ? (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {cur.name} ใหม่กว่า จึงเป็นช่วงหลัก — เปลี่ยน % / VS ในหน้านี้ ไฟล์ส่งออก และสไลด์ = {cur.name} เทียบ {prev.name}
          </p>
        ) : null}
      </div>
      <PeriodCompare
        report="Campaign on Campaign"
        cur={cur}
        prev={prev}
        // แคมเปญไม่เกิน 1 วัน: แบ่งรายชั่วโมง (รายวันจะเหลือจุดเดียว กราฟเส้นไม่มีอะไรให้ดู)
        unit={Date.parse(cur.to) - Date.parse(cur.from) <= 86400_000 ? "hour" : "day"}
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
 *   prev = null: ดูช่วงเดียว ไม่เทียบ (เช่น ดูรายวัน) — ไม่มี % เปลี่ยน / ไฟล์ส่งออกไม่มีคอลัมน์เทียบ
 */
export function PeriodCompare({ report, cur: pc, prev: pp, unit, dataMonths, version, fixHint, given, initialFilter, targetDay }: {
  /** ชื่อรายงานในไฟล์ที่ส่งออก เช่น "เทียบเดือน (MoM)" / "Campaign on Campaign" */
  report: string;
  cur: Period;
  prev: Period | null;
  unit: "hour" | "day" | "month";
  dataMonths: string[];
  version: number;
  fixHint: string;
  /** ไลฟ์ของทั้งสองช่วงที่โหลดมาแล้ว (หน้า CEO Live) = ไม่ต้องโหลดเอง */
  given?: { cur: LiveSession[]; prev: LiveSession[] };
  /** แพลตฟอร์ม / บัญชีที่เลือกไว้ตอนเปิด (ไม่ใส่ = ทุกบัญชี) */
  initialFilter?: { platform?: Platform | ""; account?: string };
  /** ดูรายวัน: วัน "YYYY-MM-DD" ของ cur = แสดง % achieve ของวันนั้น (ไม่ใส่ = ไม่แสดง) */
  targetDay?: string;
}) {
  const filter = useFilter(initialFilter);
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const [groupBy, setGroupBy] = useState<"account" | "time" | "agency">("account");
  const curQ = useSessions(given ? null : pc.from, given ? null : pc.to, version);
  const prevQ = useSessions(given ? null : pp?.from ?? null, given ? null : pp?.to ?? null, version);
  // แพลนกลุ่มไว้แยก Agency (CEO Live ส่งไลฟ์มาเอง = ไม่ใช่ไลฟ์ของทีม ไม่แยก)
  const owners = useOwnerSpans(given ? null : ownerQueryOf(pp ? [pc, pp] : [pc]), version);
  const single = !pp;
  const error = curQ.error || prevQ.error;
  const curData = given?.cur ?? curQ.data;
  const prevData = single ? [] : given?.prev ?? prevQ.data;
  if (!curData || !prevData) {
    return error ? <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={() => { curQ.retry(); prevQ.retry(); }} /> : <LoadingBlock />;
  }

  const cur = filterSessions(curData, filter.platform, filter.account);
  const prev = filterSessions(prevData, filter.platform, filter.account);
  const tc = totalsOf(cur), tp = totalsOf(prev);
  const def = metricOf(metric);
  const fmt = (v: number | null) => fmtMetric(def.kind, v);
  const curName = pc.name, prevName = pp?.name ?? "";
  const allData = [...curData, ...prevData];
  const timeText = unit === "hour" ? "รายชั่วโมง" : unit === "day" ? "รายวัน" : "รายเดือน";
  const stepMs = unit === "hour" ? 3600_000 : 86400_000;
  const replay = `${pc.from}|${pp?.from ?? ""}|${filter.platform}|${filter.account}`;

  // กลุ่มในกราฟ: แยกบัญชี หรือ ชั่วโมง/วัน/เดือนที่ 1, 2, ... นับจากต้นของแต่ละช่วง
  const steps = unit === "month"
    ? monthDiff(monthOf(pc.from), lastMonthOf(pc)) + 1
    : Math.ceil((Date.parse(pc.to) - Date.parse(pc.from)) / stepMs);
  const byTime = groupBy === "time" && steps > 1;
  const stepOf = (s: LiveSession, start: string) => unit === "month"
    ? monthDiff(monthOf(start), monthOf(s.startedAt))
    : Math.floor((Date.parse(s.startedAt) - Date.parse(start)) / stepMs);
  const stepLabel = (start: string, i: number) => unit === "hour"
    ? `${String(bkkParts(new Date(Date.parse(start) + i * stepMs).toISOString()).h).padStart(2, "0")}:00`
    : unit === "day" ? bkkDate.format(new Date(Date.parse(start) + i * stepMs))
      : shortMonth(monthKey(i, monthOf(start)));
  // ชั่วโมง/วัน/เดือนที่ 1, 2, ... ของทั้งสองช่วง (ใช้ทั้งกราฟและไฟล์ที่ส่งออก)
  const timeGroups = Array.from({ length: steps > 1 ? steps : 0 }, (_, i) => ({
    short: stepLabel(pc.from, i),
    label: unit === "hour"
      ? `${stepLabel(pc.from, i)}–${stepLabel(pc.from, i + 1)} น.`
      : `${unit === "day" ? "วันที่" : "เดือนที่"} ${i + 1}: ${stepLabel(pc.from, i)}${pp ? ` vs ${stepLabel(pp.from, i)}` : ""}`,
    a: cur.filter((s) => stepOf(s, pc.from) === i),
    b: pp ? prev.filter((s) => stepOf(s, pp.from) === i) : [],
  }));
  let categories: string[], titles: string[], curGroups: LiveSession[][], prevGroups: LiveSession[][];
  const val = (list: LiveSession[]) => (list.length ? def.value(totalsOf(list)) : null);
  if (byTime) {
    categories = timeGroups.map((g) => g.short);
    titles = timeGroups.map((g) => g.label);
    curGroups = timeGroups.map((g) => g.a);
    prevGroups = timeGroups.map((g) => g.b);
  } else {
    const accounts = accountsOf([...cur, ...prev]);
    categories = accounts.map((a) => a.name);
    titles = accounts.map(accountLabel);
    const of = (list: LiveSession[], key: string) => list.filter((s) => `${s.platform}|${s.accountId}` === key);
    curGroups = accounts.map((a) => of(cur, a.key));
    prevGroups = accounts.map((a) => of(prev, a.key));
  }
  const curVals = curGroups.map(val), prevVals = prevGroups.map(val);
  const chartSeries = single ? [{ name: curName, color: CUR, values: curVals }]
    : [{ name: curName, color: CUR, values: curVals }, { name: prevName, color: PREV, values: prevVals }];
  // แยก Agency: เทียบ 2 ช่วง = ช่วงละกลุ่ม (เก่า -> ใหม่) · ช่วงเดียว = ตามเวลา (มีช่วงเดียว = กลุ่มเดียว)
  const agencyCats = single ? (steps > 1 ? timeGroups.map((g) => g.short) : [curName]) : [prevName, curName];
  const agencyTitles = single ? (steps > 1 ? timeGroups.map((g) => g.label) : [curName]) : [prevName, curName];
  const agencyData = owners.spans ? agencyTrend(single ? (steps > 1 ? timeGroups.map((g) => g.a) : [cur]) : [prev, cur], owners.spans) : null;
  const byAgency = groupBy === "agency" && hasAgency(agencyData);
  const splitOptions = [["account", "บัญชี"], ...(steps > 1 ? [["time", timeText]] : []), ...(hasAgency(agencyData) ? [["agency", "แยก Agency"]] : [])];
  const agencySlides = agencyData && hasAgency(agencyData) ? [{
    title: single && steps > 1 ? `GMV ${timeText} แยก Agency` : "GMV แยก Agency", labels: agencyCats, trend: agencyData,
    ...(single && steps > 1 ? { lineTitle: `GMV/ชม. ${timeText} แยก Agency` } : {}),
  }] : undefined;
  const missing = [...new Set([...missingMonths(pc.from, pc.to, dataMonths), ...(pp ? missingMonths(pp.from, pp.to, dataMonths) : [])])];
  const title = single ? `GLORY ${report} ${curName}` : `GLORY ${report} ${curName} vs ${prevName}`;
  const exportFilter = { platform: filter.platform, account: filter.account, sessions: allData };

  // ให้ครบเหมือนหน้าเว็บ: เทียบรายกลุ่ม / รายบัญชี + แยก Agency (ช่วงเดียว = ตามเวลา)
  const exportExtras = {
    spans: owners.spans ?? null,
    breakdown: single ? undefined : { b: prev, aName: curName, bName: prevName },
    agency: agencyData && hasAgency(agencyData) ? [{ name: "แยก Agency", first: single && steps > 1 ? timeText : "ช่วง", labels: agencyTitles, trend: agencyData }] : undefined,
  };
  const exportBook = async () => (pp
    ? compareBook({
      title, report, aName: curName, bName: prevName,
      aRange: windowText(pc.from, pc.to), bRange: windowText(pp.from, pp.to), a: cur, b: prev,
      timeName: timeText, time: timeGroups, filter: exportFilter, crew: await loadCrew([...cur, ...prev]), extras: exportExtras,
    })
    : singleBook({
      title, report, aName: curName, aRange: windowText(pc.from, pc.to), a: cur,
      timeName: timeText, time: timeGroups, filter: exportFilter, crew: await loadCrew(cur), extras: exportExtras,
    }));

  return (
    <>
      <FilterBar filter={filter} sessions={allData}>
        <div className="flex flex-wrap gap-2">
          <ExportMenu size="sm" label="ส่งออก" build={exportBook} />
          <SlidesMenu label="สไลด์" title={title} build={(target) => buildCompareDeck({
            report, aName: curName, bName: prevName, aRange: windowText(pc.from, pc.to), bRange: pp ? windowText(pp.from, pp.to) : "",
            a: cur, b: prev, timeName: timeText, time: timeGroups,
            filterText: filterText(exportFilter).join(" · "),
            exportedAt: bkkStamp(new Date().toISOString()),
            ...(single ? { single: true, cover: { kicker: report, headline: curName } } : {}),
            // เทียบ 2 ช่วง: หน้าเทียบรายกลุ่ม (แท่งคู่ช่วงนี้ vs ช่วงก่อน เหมือนเว็บ) แทนแท่งซ้อนแยก Agency · ช่วงเดียว = แยก Agency ตามเวลา
            agency: single ? agencySlides : undefined,
            breakdown: single ? undefined : { spans: owners.spans ?? null },
          }, target)} />
        </div>
      </FilterBar>
      {targetDay ? <DayTarget date={targetDay} sessions={curData} platform={filter.platform} account={filter.account} /> : null}
      {missing.length ? (
        <Notice variant="warning" icon title={`ยังไม่ได้อัปโหลดข้อมูลเดือน ${missing.join(", ")}`}>
          {haveText(dataMonths)} · อัปโหลดไฟล์ของเดือนนั้นที่แท็บ &ldquo;อัปโหลด&rdquo; {fixHint}
        </Notice>
      ) : null}
      {!tc.lives && !tp.lives ? (
        <StateBox title={single ? `ไม่มีไลฟ์ใน ${curName}` : "ไม่มีไลฟ์ในทั้งสองช่วง"}>ไลฟ์นับตามเวลาเริ่มไลฟ์ (เวลาไทย)</StateBox>
      ) : (
        <>
          <div className="mt-3 mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{single ? `สรุปทุกตัวชี้วัด ${curName}` : "สรุปเทียบทุกตัวชี้วัด"}</h2>
            {single ? null : <Legend series={chartSeries} />}
          </div>
          {single ? <KpiGrid cur={tc} compare={[]} /> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {METRICS.map((m) => (
                <PairBars key={m.key} label={m.label} note={m.note} cur={tc.lives ? m.value(tc) : null} prev={tp.lives ? m.value(tp) : null}
                  format={(v) => fmtMetric(m.kind, v)} curName={curName} prevName={prevName} diff={(g) => gapText(m.kind, g)} />
              ))}
            </div>
          )}

          <section className="my-4 rounded-2xl border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">{byAgency ? `GMV แยก Agency${single && steps > 1 ? ` ${timeText}` : ""}` : `${def.label} ${byTime ? timeText : "แยกตามบัญชี"}`}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {splitOptions.length > 1 ? (
                  <ToggleGroup type="single" spacing={1} value={byAgency ? "agency" : byTime ? "time" : "account"} onValueChange={(v) => { if (v) setGroupBy(v as "account" | "time" | "agency"); }}
                    aria-label="แบ่งกราฟตาม" className="rounded-full border bg-card p-0.5">
                    {splitOptions.map(([id, text]) => (
                      <ToggleGroupItem key={id} value={id} className="h-7 rounded-full! px-2.5 text-xs font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!">{text}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : null}
                {byAgency ? null : <MetricSelect value={metric} onChange={setMetric} />}
              </div>
            </div>
            {byAgency && !single ? (
              <AgencyCompare trend={agencyData!} curName={curName} prevName={prevName} replay={replay} />
            ) : byAgency ? (
              <AgencyBars trend={agencyData!} categories={agencyCats} titles={agencyTitles} label={`GMV แยก Agency ${curName}`} rowHead={steps > 1 ? (unit === "hour" ? "ช่วงเวลา" : unit === "day" ? "วัน" : "เดือน") : "ช่วง"} replay={replay} />
            ) : <>
            {single ? null : <Legend series={chartSeries} />}
            <div className="mt-2">
              {/* ดูช่วงเดียว: แยกสีตามแพลตฟอร์ม · เทียบ 2 ช่วง: สีบอกช่วงเวลา จึงไม่ซ้อนแพลตฟอร์ม */}
              {single ? (
                <PlatformBars
                  series={platformLines(curGroups, metric)} metric={metric} replay={`${groupBy}|${replay}`}
                  label={`${def.label} ${curName}`} categories={categories} titles={titles}
                />
              ) : (
                <BarChart key={`${metric}|${groupBy}|${replay}`} label={`${def.label} ${curName} เทียบ ${prevName}`} categories={categories} tooltipTitles={titles} series={chartSeries}
                  format={fmt} formatAxis={(v) => fmtMetric(def.kind === "hours" ? "int" : def.kind, v, true)} />
              )}
            </div>
            <TableView title="ดูเป็นตาราง">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{byTime ? (unit === "hour" ? "ช่วงเวลา" : unit === "day" ? "วัน" : "เดือน") : "บัญชี"}</TableHead>
                    <TableHead className="text-right">{curName}</TableHead>
                    {single ? null : <><TableHead className="text-right">{prevName}</TableHead><TableHead className="text-right">เปลี่ยน</TableHead></>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat, i) => (
                    <TableRow key={i}>
                      <TableCell>{titles[i]}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(curVals[i])}</TableCell>
                      {single ? null : (
                        <>
                          <TableCell className="text-right tabular-nums">{fmt(prevVals[i])}</TableCell>
                          <TableCell className="text-right"><ChangeText cur={curVals[i]} prev={prevVals[i]} /></TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableView>
            </>}
          </section>

          {/* กราฟเส้นตามเวลาเสมอ (กราฟแท่งด้านบนสลับเป็นแยกบัญชีได้) ช่วงสั้นเกินจนมีจุดเดียว = ไม่มีเส้นให้ดู */}
          {steps > 1 ? (
            <TrendSection
              title={`${def.label} แนวโน้ม${timeText}`}
              label={single ? `แนวโน้ม ${def.label} ${curName}` : `แนวโน้ม ${def.label} ${curName} เทียบ ${prevName}`}
              rowHead={unit === "hour" ? "ช่วงเวลา" : unit === "day" ? "วัน" : "เดือน"}
              categories={timeGroups.map((g) => g.short)}
              titles={timeGroups.map((g) => g.label)}
              // รายชั่วโมง: ไลฟ์แต่ละชั่วโมงมักมีแพลตฟอร์มเดียว เส้นรวมจึงแค่ลากเชื่อมจุดของคนละแพลตฟอร์ม ไม่แสดง
              series={single
                ? (unit === "hour" ? platformLines : trendLines)(timeGroups.map((g) => g.a), metric)
                : [{ name: curName, color: CUR, values: timeGroups.map((g) => val(g.a)) }, { name: prevName, color: PREV, values: timeGroups.map((g) => val(g.b)) }]}
              metric={metric}
              onMetric={setMetric}
              replay={replay}
              compare={!single}
              // เส้นแยก Agency ตามเวลา: เฉพาะดูช่วงเดียว (เทียบ 2 ช่วง = เส้นละช่วงอยู่แล้ว)
              agency={single ? { trend: agencyData, title: `GMV/ชม. ${timeText} แยก Agency` } : undefined}
            />
          ) : null}

          {single ? null : <BreakdownSection a={cur} b={prev} curName={curName} prevName={prevName} spans={owners.spans} replay={replay} />}

          <SessionList title={`ไลฟ์ใน ${curName} (${cur.length})`} sessions={cur} />
          {single ? null : <SessionList title={`ไลฟ์ใน ${prevName} (${prev.length})`} sessions={prev} />}
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
              {all.filter((x) => x.id !== campaign?.id && !x.auto).map((x) => <SelectItem key={x.id} value={String(x.id)}>แคมเปญ {x.name}</SelectItem>)}
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

  // ลบข้อมูลเดือน: เลือกได้ว่าทุกบัญชี หรือเฉพาะบัญชีเดียว (เดิมลบทุกบัญชีของแพลตฟอร์มโดยไม่บอก)
  const [removing, setRemoving] = useState<{ platform: string; month: string; lives: number } | null>(null);
  async function removeMonth(platform: string, month: string, lives: number, account: { id: string; name: string } | null, all: string[]) {
    if (!(await confirm({
      title: account ? `ลบข้อมูล ${platform} บัญชี ${account.name} ${monthLabel(month)}?` : `ลบข้อมูล ${platform} ทุกบัญชี ${monthLabel(month)}?`,
      description: account
        ? `ลบ ${lives} ไลฟ์ของบัญชีนี้ในเดือนนี้ (บัญชีอื่นไม่หาย) กู้คืนไม่ได้`
        : `ลบ ${lives} ไลฟ์ของทุกบัญชี${all.length ? ` (${all.join(", ")})` : ""} ในเดือนนี้ (ใช้เมื่ออัปไฟล์ผิด แล้วอัปไฟล์ที่ถูกใหม่) กู้คืนไม่ได้`,
      confirmText: "ลบ", destructive: true,
    }))) return;
    try {
      const res = await api<{ deleted: number }>("/api/live-stats", { platform, month, ...(account ? { accountId: account.id, accountName: account.name } : {}) }, "DELETE");
      if (!res.ok) throw new Error(res.message);
      toast(`ลบแล้ว ${res.deleted} ไลฟ์`);
      sessionCache.clear(); // ข้อมูลที่โหลดเก็บไว้ (รวมรายชื่อบัญชีในหน้าต่างลบ) ไม่ตรงแล้ว
      setRemoving(null);
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
                              className="text-muted-foreground hover:text-destructive" onClick={() => setRemoving({ platform: p, month: m, lives: row.lives })}>
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
      {removing ? <RemoveMonthDialog {...removing} onClose={() => setRemoving(null)} onPick={removeMonth} /> : null}
    </>
  );
}

/** เลือกว่าจะลบข้อมูลเดือนนี้ของทุกบัญชี หรือเฉพาะบัญชีเดียว (โหลดรายชื่อบัญชีของเดือนนั้นก่อน) */
function RemoveMonthDialog({ platform, month, lives, onClose, onPick }: {
  platform: string; month: string; lives: number; onClose: () => void;
  onPick: (platform: string, month: string, lives: number, account: { id: string; name: string } | null, all: string[]) => Promise<void>;
}) {
  const { from, to } = monthWindow(month);
  const { data, error, retry } = useSessions(from, to, 0);
  const [busy, setBusy] = useState(false);
  const accounts = data
    ? accountsOf(data.filter((s) => s.platform === platform)).map((a) => ({
      id: a.key.slice(platform.length + 1), name: a.name, lives: data.filter((s) => `${s.platform}|${s.accountId}` === a.key).length,
    }))
    : [];
  const names = accounts.map((a) => a.name);
  const run = async (account: { id: string; name: string; lives: number } | null) => {
    setBusy(true);
    try { await onPick(platform, month, account ? account.lives : lives, account, names); } finally { setBusy(false); }
  };
  return (
    <AppDialog open onClose={onClose} busy={busy} title={`ลบข้อมูล ${platform} ${monthLabel(month)}`} description="เลือกว่าจะลบของบัญชีไหน (กู้คืนไม่ได้)">
      <DialogBody className="space-y-2">
        {!data ? (error ? <LoadError title="โหลดรายชื่อบัญชีไม่สำเร็จ" message={error} onRetry={retry} /> : <LoadingBlock />) : (
          <>
            {accounts.length > 1 ? accounts.map((a) => (
              <Button key={a.id} variant="outline" className="h-auto w-full justify-between py-2 text-left whitespace-normal pointer-coarse:min-h-10"
                disabled={busy} onClick={() => run(a)}>
                <span>ลบเฉพาะบัญชี <strong>{a.name}</strong></span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{a.lives} ไลฟ์</span>
              </Button>
            )) : null}
            <Button variant="destructive" className="h-auto w-full justify-between py-2 text-left whitespace-normal pointer-coarse:min-h-10"
              disabled={busy} onClick={() => run(null)}>
              <span>ลบทุกบัญชี{names.length ? <span className="block text-xs font-normal">{names.join(", ")}</span> : null}</span>
              <span className="shrink-0 tabular-nums">{lives} ไลฟ์</span>
            </Button>
          </>
        )}
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={busy} onClick={onClose}>ยกเลิก</Button>
      </DialogActions>
    </AppDialog>
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
