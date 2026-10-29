"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheetIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { ceoInsights, planSheet, targetText } from "@/lib/ceo-insights";
import { hasCeoSheet, parseCeoSheet, splitCsv, splitPasted } from "@/lib/ceo-parse";
import {
  bkkDay, ceoBlocks, ceoBook, ceoDays, CEO_SCOPES, fmtCell, scopeText, shiftDay, shortDay, type CeoDay, type CeoScope,
} from "@/lib/ceo-report";
import { buildCeoDeck } from "@/lib/ceo-slides";
import { useLocal, writeLocal } from "@/lib/hooks";
import { bkkStamp } from "@/lib/live-export";
import { fmtMetric, metricOf, readXlsxSheets, totalsOf, type LiveSession } from "@/lib/live-stats";
import type { CeoEvent, CeoLiveData, CeoSession } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/date-picker";
import { ExportMenu, SlidesMenu } from "@/components/ExportMenu";
import { BarChart, ChangeText, Legend } from "@/components/LiveCharts";
import { dayPeriod, PeriodCompare } from "@/components/LiveStats";
import {
  AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, Notice, StateBox, api, useConfirm, useToast,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// หน้า CEO Live (Marketing / Owner)
//   ภาพรวมหลายวัน (เลือกช่วงวัน / ติ๊กวันออกได้): ก่อน CEO Live | รอบ CEO Live (ข้อมูลที่ track) | วัน CEO Live — แบบตารางที่ทีมใช้
//   ส่งออก Excel / Google Sheet / สไลด์ · รายละเอียดทีละวัน (กราฟรายชั่วโมง / แยกบัญชี เทียบวันก่อน)
//   Owner ที่จัดการ Data analytics ได้: อัปโหลด / วางตาราง "Session Ceo Live" จากชีต

const SCOPE_KEY = "glory_ceo_scope";
const CUR = "var(--viz-cur)";
const PREV = "var(--viz-prev)";
const fmtLong = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const longDay = (d: string) => fmtLong.format(new Date(`${d}T12:00:00Z`));
const timesText = (e: CeoEvent) => e.times.map((t) => `${t.platform} ${t.start}–${t.end}`).join(" · ");

export function CeoLive() {
  const [data, setData] = useState<CeoLiveData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    api<CeoLiveData>("/api/ceo-live")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [attempt]);

  if (error) return <LoadError title="โหลดข้อมูล CEO Live ไม่สำเร็จ" message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data) return <LoadingBlock />;
  return <CeoLiveView data={data} onChanged={() => setAttempt((n) => n + 1)} />;
}

export function CeoLiveView({ data, onChanged }: { data: CeoLiveData; onChanged?: () => void }) {
  const saved = useLocal(SCOPE_KEY);
  const scope: CeoScope = saved === "ceo" || saved === "all" ? saved : "tiktok";
  // วันที่ถึงแล้ว เก่าไปใหม่ (ซ้ายไปขวาแบบชีต)
  const past = useMemo(() => data.events.filter((e) => e.date <= data.today).sort((a, b) => a.date.localeCompare(b.date)), [data]);
  const next = data.events.filter((e) => e.date > data.today).at(-1);
  const [from, setFrom] = useState(past[0]?.date ?? "");
  const [to, setTo] = useState(past.at(-1)?.date ?? "");
  const [off, setOff] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const inRange = past.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  const chosen = inRange.filter((e) => !off.has(e.date));
  const days = ceoDays(chosen, data.sessions, data.tracked, scope);
  const detail = past.find((e) => e.date === picked) ?? chosen.at(-1) ?? past.at(-1);
  const rangeText = chosen.length ? `${shortDay(chosen[0].date)} – ${shortDay(chosen.at(-1)!.date)} (${chosen.length} ครั้ง)` : "";
  const toggle = (d: string) => setOff((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });

  if (!past.length) {
    return (
      <>
        {data.canEdit ? <UploadBar data={data} onOpen={() => setUploading(true)} /> : null}
        <StateBox title="ยังไม่มี CEO Live">ระบบนับจาก slot Mc ที่ชื่อแคมเปญมีคำว่า CEO และวันที่มีข้อมูลรอบ CEO ที่อัปโหลด</StateBox>
        {uploading ? <UploadDialog data={data} onClose={(changed) => { setUploading(false); if (changed) onChanged?.(); }} /> : null}
      </>
    );
  }

  return (
    <div className="pb-10">
      {next ? (
        <Notice icon title={`CEO Live ครั้งถัดไป: ${longDay(next.date)}`} className="my-3">
          {next.label}{next.times.length ? ` · ${timesText(next)}` : ""}
        </Notice>
      ) : null}
      {data.canEdit ? <UploadBar data={data} onOpen={() => setUploading(true)} /> : null}

      <section className="my-3 rounded-2xl border bg-card p-3">
        <h2 className="text-lg font-bold">ภาพรวม CEO Live</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-36 flex-1">
            <span className="mb-1 block text-xs text-muted-foreground">ตั้งแต่วันที่</span>
            <DatePicker value={from} onChange={(v) => setFrom(v)} aria-label="ตั้งแต่วันที่" className="w-full" />
          </div>
          <div className="min-w-36 flex-1">
            <span className="mb-1 block text-xs text-muted-foreground">ถึงวันที่</span>
            <DatePicker value={to} onChange={(v) => setTo(v)} min={from} aria-label="ถึงวันที่" className="w-full" />
          </div>
          <Button variant="outline" size="sm" className="mb-0.5 rounded-full" onClick={() => { setFrom(past[0].date); setTo(past.at(-1)!.date); setOff(new Set()); }}>
            ทั้งหมด
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="วัน CEO Live ที่นับ">
          {inRange.map((e) => {
            const on = !off.has(e.date);
            return (
              <button
                key={e.date} type="button" onClick={() => toggle(e.date)} aria-pressed={on} title={e.label}
                className={cn(
                  "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors pointer-coarse:px-3 pointer-coarse:py-2",
                  on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground line-through",
                )}
              >
                {shortDay(e.date)}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">กดวันเพื่อเอาออก / ใส่กลับ</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" spacing={1} value={scope} onValueChange={(v) => { if (v) writeLocal(SCOPE_KEY, v); }}
            aria-label="ยอดทั้งวันนับ" className="rounded-full border bg-card p-1">
            {CEO_SCOPES.map(([id, text]) => (
              <ToggleGroupItem key={id} value={id} className="rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!">
                {text}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {days.length ? (
            <div className="ml-auto flex flex-wrap gap-2">
              <ExportMenu size="sm" label="ส่งออก" build={() => {
                const book = ceoBook(days, scope, { rangeText, exportedAt: bkkStamp(new Date().toISOString()) });
                return { ...book, sheets: [book.sheets[0], planSheet(ceoInsights(days, { next })), ...book.sheets.slice(1)] };
              }} />
              <SlidesMenu label="สไลด์" title={`GLORY CEO Live ${rangeText}`} build={() => buildCeoDeck({ days, scope, rangeText, exportedAt: bkkStamp(new Date().toISOString()), next })} />
            </div>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">ยอดทั้งวันนับ: {scopeText(scope, days[0]?.event)} · ไลฟ์นับตามเวลาเริ่มไลฟ์ (เวลาไทย)</p>
      </section>

      {!days.length ? <StateBox title="ไม่ได้เลือกวัน">เลือกช่วงวัน หรือกดวันที่ต้องการ</StateBox> : (
        <>
          <Overview days={days} scope={scope} onPick={(d) => { setPicked(d); document.getElementById("ceo-detail")?.scrollIntoView({ behavior: "smooth" }); }} />
          {!data.trackedReady ? (
            <Notice variant="warning" icon title="ยังไม่มีที่เก็บข้อมูลรอบ CEO">ต้องรัน SQL 20261021000000_marketing ใน Supabase ก่อน</Notice>
          ) : !data.tracked.length ? (
            <Notice>ยังไม่มีข้อมูลรอบ CEO (ช่วงที่ CEO ไลฟ์){data.canEdit ? " — กด \"อัปโหลดข้อมูลรอบ CEO\" ด้านบน" : ""}</Notice>
          ) : null}
          <PlanCard days={days} next={next ?? null} />
        </>
      )}

      {detail ? (
        <section id="ceo-detail" className="mt-6 scroll-mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">รายละเอียดทีละวัน</h2>
            <Select value={detail.date} onValueChange={setPicked}>
              <SelectTrigger aria-label="เลือกวัน CEO Live" className="h-9 min-w-48 rounded-full bg-card"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {[...past].reverse().map((e) => <SelectItem key={e.date} value={e.date}>{shortDay(e.date)} · {e.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <EventDetail key={`${detail.date}|${scope}`} day={ceoDays([detail], data.sessions, data.tracked, scope)[0]} scope={scope}
            today={data.today} months={data.months} sessions={data.sessions} />
        </section>
      ) : null}

      {uploading ? <UploadDialog data={data} onClose={(changed) => { setUploading(false); if (changed) onChanged?.(); }} /> : null}
    </div>
  );
}

/** กราฟ GMV ทั้งวัน (วัน CEO เทียบวันก่อน) + ตาราง 3 ส่วนแบบชีตที่ทีมใช้ */
function Overview({ days, scope, onPick }: { days: CeoDay[]; scope: CeoScope; onPick: (date: string) => void }) {
  const blocks = ceoBlocks(days, scope);
  const series = [
    { name: "วัน CEO Live", color: CUR, values: days.map((d) => (d.day.length ? totalsOf(d.day).gmv : null)) },
    { name: "วันก่อน", color: PREV, values: days.map((d) => (d.before.length ? totalsOf(d.before).gmv : null)) },
  ];
  return (
    <>
      <section className="my-4 rounded-2xl border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">GMV ทั้งวัน: วัน CEO Live เทียบวันก่อน</h2>
          <Legend series={series} />
        </div>
        <BarChart label="GMV ทั้งวัน วัน CEO Live เทียบวันก่อน" categories={days.map((d) => shortDay(d.event.date, false))}
          tooltipTitles={days.map((d) => `${shortDay(d.event.date)} ${d.event.label} (วันก่อน ${shortDay(shiftDay(d.event.date, -1))})`)}
          series={series} format={(v) => fmtMetric("baht", v)} formatAxis={(v) => fmtMetric("baht", v, true)} />
      </section>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-card">CEO Live</TableHead>
              {days.map((d) => (
                <TableHead key={d.event.date} className="text-right">
                  <button type="button" onClick={() => onPick(d.event.date)} className="font-semibold whitespace-nowrap text-primary underline-offset-2 hover:underline">
                    {shortDay(d.event.date)}
                  </button>
                  <span className="block max-w-28 truncate text-[11px] font-normal text-muted-foreground" title={d.event.label}>{d.event.label}</span>
                </TableHead>
              ))}
              <TableHead className="text-right">เฉลี่ยต่อครั้ง</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocks.map((b) => (
              <BlockRows key={b.key} block={b} days={days} />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">กดวันที่หัวตารางเพื่อดูรายละเอียด · เฉลี่ยต่อครั้ง: GMV / ชม. CTR CO คิดจากยอดรวมทุกวัน</p>
    </>
  );
}

function BlockRows({ block, days }: { block: ReturnType<typeof ceoBlocks>[number]; days: CeoDay[] }) {
  const sub = block.key === "before" ? days.map((d) => shortDay(shiftDay(d.event.date, -1))) : null;
  return (
    <>
      <TableRow className="bg-primary/10 hover:bg-primary/10">
        <TableCell className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] font-bold whitespace-normal" colSpan={1}>
          {block.title.split(":")[0]}
          <span className="block text-[11px] font-normal text-muted-foreground">{block.title.split(":").slice(1).join(":").trim()}</span>
        </TableCell>
        {days.map((d, i) => (
          <TableCell key={d.event.date} className="text-right text-[11px] text-muted-foreground">{sub ? sub[i] : ""}</TableCell>
        ))}
        <TableCell />
      </TableRow>
      {block.rows.map((r) => (
        <TableRow key={r.label}>
          <TableCell className="sticky left-0 z-10 bg-card whitespace-nowrap">{r.label}</TableCell>
          {r.values.map((v, i) => (
            <TableCell key={i} className={cn("text-right tabular-nums", r.delta && typeof v === "number" && (v > 0 ? "font-semibold text-success" : v < 0 ? "font-semibold text-destructive" : ""))}>
              {fmtCell(r.kind, v, r.delta)}
            </TableCell>
          ))}
          <TableCell className="text-right font-semibold tabular-nums">{fmtCell(r.kind, r.avg, r.delta)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

/** แผนต่อยอด: สิ่งที่เห็นจากข้อมูล / ข้อเสนอแนะครั้งถัดไป / เป้าครั้งถัดไป (เหมือนในสไลด์ / ไฟล์ส่งออก) */
function PlanCard({ days, next }: { days: CeoDay[]; next: CeoEvent | null }) {
  const plan = ceoInsights(days, { next });
  if (!plan.findings.length && !plan.actions.length) return null;
  return (
    <section className="my-5 rounded-2xl border bg-card p-3">
      <h2 className="text-lg font-bold">แผนต่อยอด CEO Live</h2>
      <p className="text-xs text-muted-foreground">คิดอัตโนมัติจากตัวเลขของวันที่เลือกด้านบน (กฎตายตัว ไม่ใช่ AI) · อยู่ในไฟล์ส่งออกและสไลด์ด้วย</p>
      {plan.findings.length ? (
        <>
          <h3 className="mt-3 mb-1 text-sm font-semibold">สิ่งที่เห็นจากข้อมูล</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">{plan.findings.map((t) => <li key={t}>{t}</li>)}</ul>
        </>
      ) : null}
      {plan.actions.length ? (
        <div className="mt-3 rounded-xl bg-primary/10 p-3">
          <h3 className="mb-1 text-sm font-semibold text-primary">ข้อเสนอแนะครั้งถัดไป</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">{plan.actions.map((t) => <li key={t}>{t}</li>)}</ol>
        </div>
      ) : null}
      {plan.targets.length ? (
        <>
          <h3 className="mt-3 mb-1 text-sm font-semibold">เป้าครั้งถัดไป{next ? `: ${shortDay(next.date)} ${next.label}` : ""}</h3>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ตัวชี้วัด</TableHead><TableHead className="text-right">ขั้นต่ำ (เฉลี่ย)</TableHead>
                  <TableHead className="text-right">ท้าทาย (ดีที่สุด)</TableHead><TableHead className="text-right">ครั้งที่ดีที่สุด</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.targets.map((t) => (
                  <TableRow key={t.label}>
                    <TableCell className="whitespace-nowrap">{t.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{targetText(t, t.avg)}</TableCell>
                    <TableCell className="text-right font-semibold text-primary tabular-nums">{targetText(t, t.best)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{t.bestDay || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function NoData() {
  return <span className="text-xs text-muted-foreground">ยังไม่มีข้อมูล</span>;
}

/** CEO Live วันเดียว: รอบ CEO (ที่ track) + ทั้งวันเทียบวันก่อน + กราฟ / ตาราง / ส่งออก */
function EventDetail({ day, scope, today, months, sessions }: {
  day: CeoDay; scope: CeoScope; today: string; months: string[]; sessions: LiveSession[];
}) {
  const { event, session } = day;
  const before = shiftDay(event.date, -1);
  const ta = totalsOf(day.day), tb = totalsOf(day.before);
  const metrics = (["gmv", "orders", "viewers", "lives"] as const).map(metricOf);
  // ไลฟ์ทุกบัญชีของสองวันนี้ (กราฟด้านล่างกรองแพลตฟอร์ม / บัญชีเองได้)
  const all = (d: string) => sessions.filter((s) => bkkDay(s.startedAt) === d);
  const firstAccount = event.accounts[0] ?? "";
  return (
    <>
      <div className="mt-2 rounded-2xl border bg-card p-3">
        <h3 className="text-lg font-bold">{event.label} · {longDay(event.date)}</h3>
        {event.times.length ? <p className="text-sm text-muted-foreground">CEO ไลฟ์ (slot): {timesText(event)}</p> : null}
        {event.date === today ? <p className="mt-1 text-xs text-warning-foreground">วันนี้ยังไม่จบวัน ตัวเลขนับเฉพาะไลฟ์ที่อัปโหลดแล้ว</p> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border px-3 py-2.5">
            <div className="mb-1 text-sm font-semibold">รอบ CEO Live{session?.timeRange ? ` · ${session.timeRange}` : ""}</div>
            {!session ? <NoData /> : (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {([
                  ["GMV", fmtMetric("baht", session.gmv)],
                  ["GMV / ชม.", fmtMetric("baht", session.gmv !== null && session.durationHr ? session.gmv / session.durationHr : null)],
                  ["ออเดอร์", fmtMetric("int", session.orders)],
                  ["ชั่วโมงไลฟ์", fmtMetric("hours", session.durationHr)],
                  ["Views", fmtMetric("int", session.views)],
                  ["Peak Viewers", `${fmtMetric("int", session.peakViewers)}${session.peakTime ? ` (${session.peakTime})` : ""}`],
                  ["CTR", fmtMetric("pct", session.ctr)],
                  ["CO", fmtMetric("pct", session.co)],
                ] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-bold tabular-nums">{v}</dd></div>
                ))}
              </dl>
            )}
          </div>
          <div className="rounded-xl border px-3 py-2.5">
            <div className="mb-1 text-sm font-semibold">ทั้งวัน เทียบวันก่อน ({shortDay(before)}) · {scopeText(scope, event)}</div>
            {!day.day.length ? <NoData /> : (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {metrics.map((m) => (
                  <div key={m.key}>
                    <dt className="text-xs text-muted-foreground">{m.label}</dt>
                    <dd className="font-bold tabular-nums">{fmtMetric(m.kind, m.value(ta))}</dd>
                    <dd><ChangeText cur={m.value(ta)} prev={day.before.length ? m.value(tb) : null} suffix="vs วันก่อน" /></dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">กราฟรายชั่วโมง / แยกบัญชี ทั้งวัน เทียบวันก่อน · เลือกแพลตฟอร์ม / บัญชีได้ · ส่งออกเป็นไฟล์ / สไลด์ได้</p>
      <PeriodCompare
        report="CEO Live"
        cur={{ ...dayPeriod(event.date), name: `วัน CEO Live ${shortDay(event.date)}` }}
        prev={{ ...dayPeriod(before), name: `วันก่อน ${shortDay(before)}` }}
        unit="hour"
        dataMonths={months}
        version={0}
        fixHint=""
        given={{ cur: all(event.date), prev: all(before) }}
        initialFilter={scope === "tiktok" ? { platform: "TikTok" } : scope === "ceo" && firstAccount ? { account: firstAccount } : {}}
      />
    </>
  );
}

/** แถบสำหรับ Owner: อัปโหลดข้อมูลรอบ CEO */
function UploadBar({ data, onOpen }: { data: CeoLiveData; onOpen: () => void }) {
  return (
    <div className="my-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm">
      <span className="min-w-56 flex-1 leading-snug">
        <b>ข้อมูลรอบ CEO (ที่ track แยก)</b> — มีแล้ว {data.tracked.length} วัน
        <span className="block text-xs text-muted-foreground">เห็นปุ่มนี้เฉพาะ Owner ที่จัดการ Data analytics ได้ · Marketing ดูได้อย่างเดียว</span>
      </span>
      <Button size="sm" onClick={onOpen}><UploadIcon />อัปโหลดข้อมูลรอบ CEO</Button>
    </div>
  );
}

/** วางตาราง "Session Ceo Live" จาก Google Sheet หรือเลือกไฟล์ Excel -> ตรวจ -> บันทึก (วันเดิม = แทนที่) + ลบทีละวัน */
function UploadDialog({ data, onClose }: { data: CeoLiveData; onClose: (changed?: boolean) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const thisYear = Number(data.today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [text, setText] = useState("");
  /** ข้อมูลมาจากไฟล์ไหน / ชีตไหน (วางเอง = ว่าง) */
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [list, setList] = useState(data.tracked);
  const existing = new Set(list.map((t) => t.date));

  const parsed = useMemo(() => {
    if (!rows) return null;
    try { return { ...parseCeoSheet(rows, year), error: "" }; } catch (err) { return { sessions: [] as CeoSession[], warnings: [], error: (err as Error).message }; }
  }, [rows, year]);

  /** ไฟล์ .xlsx (หาแท็บที่มีตาราง Session Ceo Live เอง) หรือ .csv */
  async function pickFile(file: File | undefined) {
    if (!file) return;
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".csv")) {
        setRows(splitCsv(await file.text()));
        setSource(`ไฟล์ ${file.name}`);
      } else if (name.endsWith(".xlsx")) {
        const sheets = readXlsxSheets(new Uint8Array(await file.arrayBuffer()));
        const hit = sheets.find((s) => hasCeoSheet(s.rows, year)) ?? sheets.find((s) => s.rows.length) ?? sheets[0];
        setRows(hit?.rows ?? []);
        setSource(`ไฟล์ ${file.name} · ชีต "${hit?.name ?? ""}"${sheets.length > 1 ? ` (จาก ${sheets.length} ชีต)` : ""}`);
      } else {
        throw new Error(`อ่านไฟล์ ${file.name} ไม่ได้ — ใช้ไฟล์ Excel (.xlsx) หรือ .csv (Google Sheet: ไฟล์ > ดาวน์โหลด) หรือคัดลอกตารางมาวางแทน`);
      }
      setText("");
    } catch (err) {
      setRows(null);
      setSource("");
      toast((err as Error).message, "error");
    }
  }

  async function save() {
    if (!parsed?.sessions.length) return;
    setSaving(true);
    try {
      const res = await api<{ saved: number }>("/api/ceo-live", { sessions: parsed.sessions });
      if (!res.ok) throw new Error(res.message);
      toast(`บันทึกข้อมูลรอบ CEO ${res.saved} วันแล้ว`);
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  }

  async function remove(date: string) {
    if (!(await confirm({ title: `ลบข้อมูลรอบ CEO วันที่ ${shortDay(date)}?`, description: "ลบเฉพาะข้อมูลที่ track แยก ยอดทั้งวันจากไฟล์ Export ไม่หาย", confirmText: "ลบ", destructive: true }))) return;
    const res = await api("/api/ceo-live", { date }, "DELETE").catch((err) => ({ ok: false, message: (err as Error).message }));
    if (!res.ok) { toast(res.message ?? "ลบไม่สำเร็จ", "error"); return; }
    toast("ลบแล้ว");
    setChanged(true);
    setList((l) => l.filter((t) => t.date !== date));
  }

  return (
    <AppDialog open onClose={() => onClose(changed)} busy={saving} title="อัปโหลดข้อมูลรอบ CEO"
      description={"คัดลอกตาราง \"Session Ceo Live\" จาก Google Sheet (ตั้งแต่แถวหัวจนถึงแถว CO หรือทั้งชีตก็ได้) แล้ววางในช่องด้านล่าง"}>
      <DialogBody className="space-y-3 text-sm">
        {!data.trackedReady ? <Notice variant="warning" icon title="ต้องรัน SQL ก่อน">รัน SQL 20261021000000_marketing ใน Supabase ก่อน ถึงจะบันทึกได้</Notice> : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="ceo-paste" className="mb-1">วางตารางจากชีต</Label>
            <Textarea id="ceo-paste" rows={4} value={text} placeholder={"Session Ceo Live\t3 Mar ceo live\t...\nGMV\t132,456\t..."}
              onChange={(e) => { setText(e.target.value); setSource(""); setRows(e.target.value.trim() ? splitPasted(e.target.value) : null); }} className="max-h-32 font-mono text-xs" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <FileSpreadsheetIcon />หรือเลือกไฟล์ (.xlsx / .csv)
              {/* ล้างค่าหลังเลือก = เลือกไฟล์เดิมซ้ำได้ (เช่น แก้ไฟล์แล้วอัปใหม่) */}
              <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </Button>
          <span className="text-xs text-muted-foreground">{source || "หาแท็บที่มีตาราง Session Ceo Live เอง"}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">ปีของหัวตาราง</span>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger aria-label="ปีของหัวตาราง" className="h-8 w-24"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                {[thisYear - 1, thisYear, thisYear + 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </span>
        </div>

        {parsed?.error ? <Notice variant="warning" icon>{parsed.error}</Notice> : null}
        {parsed?.warnings.length ? (
          <Notice variant="warning" icon title="บางส่วนอ่านไม่ได้ (ข้าม)">
            {parsed.warnings.slice(0, 6).map((w) => <span key={w} className="block">{w}</span>)}
          </Notice>
        ) : null}
        {parsed?.sessions.length ? (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วัน</TableHead><TableHead>ชื่อ</TableHead><TableHead className="text-right">GMV</TableHead>
                  <TableHead className="text-right">ชม.</TableHead><TableHead className="text-right">ออเดอร์</TableHead>
                  <TableHead className="text-right">CTR</TableHead><TableHead className="text-right">CO</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.sessions.map((s) => (
                  <TableRow key={s.date}>
                    <TableCell className="whitespace-nowrap font-semibold">
                      {shortDay(s.date)}
                      {existing.has(s.date) ? <span className="block text-[11px] font-normal text-warning-foreground">แทนที่ของเดิม</span> : null}
                    </TableCell>
                    <TableCell>{s.title || "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMetric("baht", s.gmv)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMetric("hours", s.durationHr)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMetric("int", s.orders)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMetric("pct", s.ctr)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMetric("pct", s.co)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {list.length ? (
          <div>
            <span className="mb-1 block font-semibold">ข้อมูลที่มีแล้ว ({list.length} วัน)</span>
            <div className="flex flex-wrap gap-1.5">
              {[...list].reverse().map((t) => (
                <span key={t.date} className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2.5 text-xs">
                  {shortDay(t.date)}
                  <Button variant="ghost" size="icon-xs" className="size-6 rounded-full text-muted-foreground hover:text-destructive" aria-label={`ลบข้อมูลรอบ CEO ${shortDay(t.date)}`} onClick={() => remove(t.date)}>
                    <Trash2Icon />
                  </Button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          ระบบอ่านแถว GMV / Duration / Order / Viewers / Views / Peak Viewers / Peak time / time / impressions / CTR / CO
          · GMV / ชม. คิดเองจาก GMV ÷ ชั่วโมง · ตาราง Before / Ceo Live (ทั้งวัน) ระบบคิดเองจากไฟล์ Export ไม่ต้องอัปโหลด
        </p>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={saving} onClick={() => onClose(changed)}>ปิด</Button>
        <Button size="lg" disabled={saving || !parsed?.sessions.length || !data.trackedReady} onClick={save}>
          {saving ? "กำลังบันทึก..." : `บันทึก ${parsed?.sessions.length ?? 0} วัน`}
        </Button>
      </DialogActions>
    </AppDialog>
  );
}
