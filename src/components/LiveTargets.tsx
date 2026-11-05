"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, TargetIcon, XIcon } from "lucide-react";
import { accountLabel, accountsOf, filterSessions, fmtMetric, monthOf, type LiveSession, type Platform } from "@/lib/live-stats";
import { cleanTarget, dailyOf, monthDays, targetKey, targetReport, targetsInScope, type LiveTarget } from "@/lib/live-targets";
import { fmtDayMonth, monthKey, monthLabel, parseKey } from "@/lib/format";
import { CountUp } from "@/components/motion";
import { AppDialog, DialogActions, DialogBody, IconButton, LoadingBlock, api, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// เป้า GMV + % achieve ของหน้าสถิติไลฟ์ (สูตรอยู่ที่ src/lib/live-targets.ts)

const baht = (v: number | null) => fmtMetric("baht", v);
const pctText = (v: number | null) => (v === null ? "-" : `${(v * 100).toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const dayText = (d: string) => fmtDayMonth.format(parseKey(d));

/** เป้าของเดือนนี้ · ready false = ยังไม่ได้รัน SQL · targets null = กำลังโหลด */
function useTargets(month: string) {
  const [state, setState] = useState<{ month: string; ready?: boolean; targets?: LiveTarget[]; error?: string }>({ month: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ ready: boolean; targets: LiveTarget[] }>(`/api/live-stats/targets?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) setState({ month, ready: res.ready, targets: res.targets });
      })
      .catch((err) => { if (alive) setState({ month, error: (err as Error).message }); });
    return () => { alive = false; };
  }, [month, tick]);
  const cur = state.month === month ? state : null;
  return { ready: cur?.ready ?? true, targets: cur?.targets ?? null, error: cur?.error, reload: () => setTick((n) => n + 1) };
}

/** แถบความคืบหน้า: เต็มที่ 100% · mark = ขีดเป้าถึงวันนี้ (สัดส่วนของเป้าเดือน) */
function Meter({ pct, mark }: { pct: number | null; mark?: number | null }) {
  const width = Math.min(1, Math.max(0, pct ?? 0)) * 100;
  return (
    <div aria-hidden className="relative mt-2 h-2 rounded-full bg-muted">
      <div className="bar-fill h-full rounded-full" style={{ width: `${width}%`, background: "var(--viz-cur)" }} />
      {mark ? <span className="absolute -top-0.5 h-3 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${Math.min(1, mark) * 100}%` }} /> : null}
    </div>
  );
}

/** การ์ด % achieve 1 ช่วง: ตัวเลขใหญ่ + แถบ + ทำได้ / เป้า */
function AchieveTile({ title, pct, gmv, target, mark, children }: {
  title: ReactNode; pct: number | null; gmv: number; target: number; mark?: number | null; children?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
        <span className="text-xl font-bold tabular-nums">{pct === null ? "-" : <CountUp value={pct} format={pctText} />}</span>
        {pct !== null && pct >= 1 ? <Badge className="bg-success/15 font-semibold text-success">✓ ถึงเป้า</Badge> : null}
      </div>
      <Meter pct={pct} mark={mark} />
      <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">{baht(gmv)} / เป้า {baht(target)}</div>
      {children}
    </div>
  );
}

function TableToggle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="group/tv mt-2">
      <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 rounded text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:py-2">
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/tv:rotate-180" />{title}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * เป้าหมาย GMV ของเดือน (ภาพรวม > รายเดือน): % achieve เดือน / ถึงวันล่าสุด / รายวัน + แยกช่อง + ตารางรายวัน + ปุ่มตั้งเป้า
 *   sessions = ไลฟ์ทุกบัญชีที่โหลดไว้ (ใช้หารายชื่อช่อง) · lastDay = วันล่าสุดที่มีข้อมูลของเดือนที่ยังไม่จบ (0 = ไม่ตัด)
 */
export function TargetPanel({ month, sessions, platform, account, lastDay, readOnly }: {
  month: string; sessions: LiveSession[]; platform: Platform | ""; account: string; lastDay: number; readOnly: boolean;
}) {
  const { ready, targets, error, reload } = useTargets(month);
  const [editing, setEditing] = useState(false);
  const [dayPick, setDayPick] = useState<string | null>(null);

  const names = new Map(accountsOf(sessions).map((a) => [a.key, a]));
  const nameOf = (key: string) => {
    const a = names.get(key);
    return a ? accountLabel(a) : key.split("|").slice(1).join("|");
  };
  const scope = targets ? targetsInScope(targets, platform, account) : [];
  const list = filterSessions(sessions, platform, account);
  const r = targetReport(scope, list, month, lastDay);
  const dates = r.days.map((d) => d.date);
  const fallback = lastDay ? dates[lastDay - 1] : r.days.filter((d) => d.gmv > 0).at(-1)?.date ?? dates[0];
  const day = dayPick?.startsWith(month) ? dayPick : fallback;
  const dayRow = r.days.find((d) => d.date === day) ?? r.days[0];
  const dayAt = dates.indexOf(day);
  // ช่องที่มียอดเดือนนี้แต่ยังไม่ตั้งเป้า: ไม่นับใน % (บอกให้รู้)
  const keys = new Set(scope.map(targetKey));
  const noTarget = accountsOf(list.filter((s) => monthOf(s.startedAt) === month)).filter((a) => !keys.has(a.key)).map(accountLabel);
  const future = (d: string) => lastDay > 0 && Number(d.slice(8)) > lastDay;

  // ช่องที่ตั้งเป้าได้: มีไลฟ์ใน 3 เดือนล่าสุดนับจากเดือนนี้ (ไม่มีเลย = ทุกช่องที่โหลดไว้) + ช่องที่ตั้งเป้าไว้แล้ว
  const recent = [month, monthKey(-1, month), monthKey(-2, month)];
  const base = sessions.filter((s) => recent.includes(monthOf(s.startedAt)));
  const editable = accountsOf(base.length ? base : sessions).map((a) => ({ key: a.key, platform: a.platform as string, label: accountLabel(a) }));
  for (const t of targets ?? []) {
    if (!editable.some((a) => a.key === targetKey(t))) editable.push({ key: targetKey(t), platform: t.platform, label: nameOf(targetKey(t)) });
  }

  return (
    <section className="my-3 rounded-2xl border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-bold"><TargetIcon aria-hidden className="size-4 text-muted-foreground" />เป้าหมาย GMV {monthLabel(month)}</h2>
        {!readOnly && ready && targets ? (
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing(true)}>
            <PencilIcon />{targets.length ? "แก้เป้า" : "ตั้งเป้า"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-sm text-muted-foreground">
          โหลดเป้าไม่สำเร็จ: {error} <Button variant="link" size="xs" className="h-auto px-0" onClick={reload}>ลองใหม่</Button>
        </p>
      ) : !ready ? (
        <p className="mt-2 text-sm text-muted-foreground">ต้องรัน SQL 20261122000000_live_targets ใน Supabase ก่อน ถึงจะตั้งเป้าได้</p>
      ) : !targets ? (
        <LoadingBlock className="my-2 h-20 rounded-xl" />
      ) : !scope.length ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {targets.length ? "ช่องที่เลือกยังไม่ได้ตั้งเป้าเดือนนี้" : "เดือนนี้ยังไม่ได้ตั้งเป้า"}{readOnly ? "" : ' กด "ตั้งเป้า" เพื่อดู % achieve'}
        </p>
      ) : (
        <>
          <div className={cn("mt-2 grid gap-2", r.toDate ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            <AchieveTile
              title={`% Achieve เดือน${r.toDate ? " (เทียบเป้าทั้งเดือน)" : ""}`} pct={r.pct} gmv={r.gmv} target={r.monthly}
              mark={r.toDate && r.monthly ? r.toDate.target / r.monthly : null}
            >
              {r.toDate ? <div className="mt-0.5 text-[11px] text-muted-foreground">ขีดบนแถบ = เป้าถึงวันที่ {lastDay}</div> : null}
            </AchieveTile>
            {r.toDate ? (
              <AchieveTile title={`% Achieve ถึงวันที่ ${lastDay}`} pct={r.toDate.pct} gmv={r.gmv} target={r.toDate.target}>
                <div className={cn("mt-0.5 text-xs font-semibold tabular-nums", r.toDate.gap >= 0 ? "text-success" : "text-destructive")}>
                  {r.toDate.gap >= 0 ? `เกินเป้าถึงวันนี้ ${baht(r.toDate.gap)}` : `ขาดจากเป้าถึงวันนี้ ${baht(-r.toDate.gap)}`}
                </div>
              </AchieveTile>
            ) : null}
            <AchieveTile
              title={(
                <span className="flex items-center justify-between gap-1">
                  <span className="truncate">% Achieve วัน {dayText(day)}{dayRow.manual ? " · เป้าใส่เอง" : ""}</span>
                  <span className="flex shrink-0 gap-1">
                    <IconButton label="วันก่อนหน้า" className="size-6" disabled={dayAt <= 0} onClick={() => setDayPick(dates[dayAt - 1])}><ChevronLeftIcon /></IconButton>
                    <IconButton label="วันถัดไป" className="size-6" disabled={dayAt >= dates.length - 1} onClick={() => setDayPick(dates[dayAt + 1])}><ChevronRightIcon /></IconButton>
                  </span>
                </span>
              )}
              pct={future(day) ? null : dayRow.pct} gmv={dayRow.gmv} target={dayRow.target}
            />
          </div>

          {r.toDate ? (
            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              {r.remaining > 0
                ? `เหลืออีก ${baht(r.remaining)}${r.daysLeft ? ` ใน ${r.daysLeft} วัน · เฉลี่ยวันละ ${baht(r.perDayLeft)}` : ""}`
                : "ถึงเป้าเดือนแล้ว"}
            </p>
          ) : null}
          {noTarget.length ? <p className="mt-1 text-xs text-muted-foreground">ยังไม่ตั้งเป้า (ไม่นับใน % นี้): {noTarget.join(", ")}</p> : null}

          {scope.length > 1 ? (
            <TableToggle title="แยกตามช่องไลฟ์">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ช่อง</TableHead><TableHead className="text-right">เป้าเดือน</TableHead><TableHead className="text-right">GMV</TableHead>
                    <TableHead className="text-right">% เดือน</TableHead>{r.toDate ? <TableHead className="text-right">% ถึงวันที่ {lastDay}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.accounts.map((a) => (
                    <TableRow key={a.key}>
                      <TableCell>{nameOf(a.key)}</TableCell>
                      <TableCell className="text-right tabular-nums">{baht(a.monthly)}</TableCell>
                      <TableCell className="text-right tabular-nums">{baht(a.gmv)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{pctText(a.pct)}</TableCell>
                      {r.toDate ? <TableCell className="text-right tabular-nums">{pctText(a.toDatePct)}</TableCell> : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableToggle>
          ) : null}
          <TableToggle title="ดูรายวัน">
            <Table>
              <TableHeader>
                <TableRow><TableHead>วัน</TableHead><TableHead className="text-right">เป้า</TableHead><TableHead className="text-right">GMV</TableHead><TableHead className="text-right">% Achieve</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {r.days.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell>{dayText(d.date)}{d.manual ? <span className="text-xs text-muted-foreground"> · ใส่เอง</span> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{baht(d.target)}</TableCell>
                    <TableCell className="text-right tabular-nums">{future(d.date) ? "-" : baht(d.gmv)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{future(d.date) ? "-" : pctText(d.pct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableToggle>
        </>
      )}

      {editing && targets ? (
        <TargetDialog month={month} accounts={editable} targets={targets} onClose={(saved) => { setEditing(false); if (saved) reload(); }} />
      ) : null}
    </section>
  );
}

/** % achieve ของวันเดียว (เทียบช่วง > รายวัน) · ช่องในตัวกรองยังไม่ตั้งเป้า = ไม่แสดง */
export function DayTarget({ date, sessions, platform, account }: { date: string; sessions: LiveSession[]; platform: Platform | ""; account: string }) {
  const month = date.slice(0, 7);
  const { targets } = useTargets(month);
  const scope = targets ? targetsInScope(targets, platform, account) : [];
  if (!scope.length) return null;
  const row = targetReport(scope, filterSessions(sessions, platform, account), month).days.find((d) => d.date === date);
  if (!row) return null;
  return (
    <div className="my-3">
      <AchieveTile title={`% Achieve วัน ${dayText(date)} (ช่องที่ตั้งเป้า)${row.manual ? " · เป้าใส่เอง" : ""}`} pct={row.pct} gmv={row.gmv} target={row.target} />
    </div>
  );
}

type Draft = { monthly: string; days: { date: string; value: string }[] };
const amount = (s: string) => Number(s.replace(/[,\s฿]/g, ""));

/** ตั้งเป้าเดือนนี้: ใส่เป้าเดือนรายช่อง + เป้าเฉพาะวัน (เช่น 11.11) วันที่เหลือเฉลี่ยให้ */
function TargetDialog({ month, accounts, targets, onClose }: {
  month: string; accounts: { key: string; platform: string; label: string }[]; targets: LiveTarget[]; onClose: (saved: boolean) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(accounts.map((a) => {
    const t = targets.find((x) => targetKey(x) === a.key);
    return [a.key, {
      monthly: t ? String(t.monthly) : "",
      days: t ? Object.entries(t.days).sort(([x], [y]) => x.localeCompare(y)).map(([date, v]) => ({ date, value: String(v) })) : [],
    }];
  })));
  const allDays = monthDays(month);
  const patch = (key: string, next: Partial<Draft>) => setDrafts({ ...drafts, [key]: { ...drafts[key], ...next } });

  async function save() {
    const items = [];
    for (const a of accounts) {
      const d = drafts[a.key];
      const days = Object.fromEntries(d.days.map((x) => [x.date, x.value]));
      const c = cleanTarget(month, a.label, d.monthly, days);
      if ("error" in c) { toast(c.error, "error"); return; }
      items.push({ platform: a.platform, accountId: a.key.split("|").slice(1).join("|"), name: a.label, monthly: c.monthly, days: c.days });
    }
    setSaving(true);
    try {
      const res = await api<{ message: string }>("/api/live-stats/targets", { month, items }, "PUT");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  }

  return (
    <AppDialog open onClose={() => onClose(false)} busy={saving} title={`ตั้งเป้า GMV ${monthLabel(month)}`} description="ใส่เป้าเดือนรายช่อง ระบบเฉลี่ยเป็นรายวันให้ · วันแคมเปญกด &quot;เพิ่มเป้ารายวัน&quot; ใส่เองได้ วันที่เหลือเฉลี่ยจากยอดที่เหลือ · เว้นว่าง = ไม่ตั้งเป้าช่องนั้น">
      <DialogBody className="space-y-3 text-sm">
        {accounts.map((a) => {
          const d = drafts[a.key];
          const monthly = amount(d.monthly) || 0;
          const manual = Object.fromEntries(d.days.map((x) => [x.date, amount(x.value) || 0]));
          const avg = monthly ? dailyOf({ month, monthly, days: manual }) : null;
          const restDay = allDays.find((x) => manual[x] === undefined);
          const used = new Set(d.days.map((x) => x.date));
          const over = Object.values(manual).reduce((s, v) => s + v, 0) > monthly;
          const inputId = `target-${a.key}`;
          return (
            <div key={a.key} className="rounded-xl border p-2.5">
              <Label htmlFor={inputId} className="mb-1 font-semibold">{a.label}</Label>
              <Input id={inputId} inputMode="decimal" value={d.monthly} disabled={saving} placeholder="เป้าเดือน (บาท)" onChange={(e) => patch(a.key, { monthly: e.target.value })} />
              {avg && restDay ? (
                <span className={cn("mt-1 block text-xs tabular-nums", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
                  {over ? "เป้ารายวันที่ใส่เองรวมกันเกินเป้าเดือน" : `${baht(monthly)} · ${d.days.length ? "วันที่เหลือ" : ""}เฉลี่ยวันละ ${baht(avg.get(restDay) ?? 0)}`}
                </span>
              ) : null}
              {d.days.map((x, i) => (
                <div key={x.date} className="mt-2 flex items-center gap-2">
                  <Select
                    value={x.date} disabled={saving}
                    onValueChange={(v) => patch(a.key, { days: d.days.map((y, j) => (j === i ? { ...y, date: v } : y)) })}
                  >
                    <SelectTrigger aria-label="วัน" className="h-9 w-28 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent position="popper">
                      {allDays.filter((o) => o === x.date || !used.has(o)).map((o) => <SelectItem key={o} value={o}>{dayText(o)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    inputMode="decimal" value={x.value} disabled={saving} placeholder="เป้าวันนี้ (บาท)" aria-label={`เป้าวันที่ ${dayText(x.date)}`}
                    onChange={(e) => patch(a.key, { days: d.days.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) })}
                  />
                  <IconButton label={`ลบเป้าวันที่ ${dayText(x.date)}`} disabled={saving} onClick={() => patch(a.key, { days: d.days.filter((_, j) => j !== i) })}><XIcon /></IconButton>
                </div>
              ))}
              {restDay ? (
                <Button
                  variant="link" size="xs" className="mt-1 h-auto px-0 font-semibold pointer-coarse:py-2" disabled={saving || !monthly}
                  onClick={() => patch(a.key, { days: [...d.days, { date: restDay, value: "" }] })}
                >
                  <PlusIcon />เพิ่มเป้ารายวัน
                </Button>
              ) : null}
            </div>
          );
        })}
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={saving} onClick={() => onClose(false)}>ยกเลิก</Button>
        <Button size="lg" disabled={saving} onClick={save}>{saving ? "กำลังบันทึก..." : "บันทึกเป้า"}</Button>
      </DialogActions>
    </AppDialog>
  );
}
