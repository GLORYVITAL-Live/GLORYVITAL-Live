"use client";

import { useEffect, useState, type ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import {
  SOURCE_NOTE, SPLIT_NOTE, STATUS_TEXT, baht, dayText, hrs, inMonth, monShort, monText, monthSeries, prevNote, rateOf, shiftMonth, slotGmv, slotRate, slotTime, summary,
  type MyGmvAgg, type MyGmvData, type MyGmvSlot,
} from "@/lib/my-gmv";
import { BarChart, ChangeBadge, TableView } from "@/components/LiveCharts";
import { ExportMenu, SlidesMenu } from "@/components/ExportMenu";
import { AppDialog, DialogBody, MonthNav, api } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * ตารางของฉัน > ยอดขายของฉัน (เฉพาะ Mc ประจำ · ผู้ใช้ขอ 2026-11-26 ให้ Mc ประจำทำสไลด์ส่วนตัวไว้ present)
 *   เห็นเฉพาะ slot ของตัวเอง · ตัวเลขชุดเดียวกับสไลด์ / Excel (src/lib/my-gmv.ts)
 */

/** ตัวเลขบนแกน: ฿1.2M / ฿350K */
const compact = (v: number) => (v >= 1_000_000 ? `฿${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : v >= 1_000 ? `฿${Math.round(v / 1_000)}K` : `฿${Math.round(v)}`);
const fmtBaht = (v: number | null) => baht(v);
/** เวลาส่งออก (เวลาไทย) เช่น 2026-11-26 15:04 */
const stampNow = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

/** โหลดยอดขายจาก url (null = ยังไม่โหลด) · เปลี่ยน url = โหลดใหม่ */
function useGmvData(url: string | null) {
  const [state, setState] = useState<{ url: string; data: MyGmvData | null; error: string } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    api<MyGmvData>(url)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) setState({ url, data: res, error: "" });
      })
      .catch((err) => { if (alive) setState({ url, data: null, error: (err as Error).message }); });
    return () => { alive = false; };
  }, [url, tick]);
  const cur = state && state.url === url ? state : null;
  return { data: cur?.data ?? null, error: cur?.error ?? "", retry: () => { setState(null); setTick((n) => n + 1); } };
}

/** เลือกเดือน + รายงาน · dialog = เลือกเดือนอยู่นอกส่วนที่เลื่อนได้ (ติดหัวหน้าต่าง) */
function GmvView({ data, dialog = false }: { data: MyGmvData; dialog?: boolean }) {
  const [month, setMonth] = useState(data.last);
  const go = (by: number) => {
    const next = shiftMonth(month, by);
    if (next >= data.first && next <= data.last) setMonth(next);
  };
  const nav = <MonthNav label={monText(month)} onPrev={() => go(-1)} onNext={() => go(1)} />;
  return dialog
    ? <>{nav}<DialogBody><Report data={data} month={month} /></DialogBody></>
    : <>{nav}<Report data={data} month={month} /></>;
}

function GmvState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return error ? (
    <div className="py-6 text-center text-sm text-muted-foreground">
      <strong className="block text-foreground">โหลดยอดขายไม่สำเร็จ</strong>
      {error}
      <br />
      <Button variant="outline" className="mt-3" onClick={onRetry}>ลองใหม่</Button>
    </div>
  ) : (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Spinner />กำลังโหลดยอดขาย…</div>
  );
}

export function MyGmv({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, error, retry } = useGmvData(open ? "/api/my/gmv" : null);
  return (
    <AppDialog open={open} onClose={onClose} title="ยอดขายของฉัน" className="sm:max-w-[720px]">
      {data ? <GmvView data={data} dialog /> : <GmvState error={error} onRetry={retry} />}
    </AppDialog>
  );
}

type McOption = { id: number; name: string; salaried: boolean; platform: string };
const OWNER_GMV_KEY = "glory_owner_gmv_mc";

/**
 * หน้าเจ้าของ > ผลงาน Mc > ยอดขายราย Mc (ผู้ใช้ขอ 2026-11-26: Owner ดึงสไลด์ชุดเดียวกับที่ Mc ประจำเห็นได้)
 *   เลือก Mc (Mc ประจำขึ้นก่อน · จำคนล่าสุด) -> รายงาน + สไลด์ / Excel ของคนนั้น
 */
export function McGmvPanel() {
  const [mcs, setMcs] = useState<McOption[] | null>(null);
  const [listError, setListError] = useState("");
  useEffect(() => {
    let alive = true;
    api<{ mcs: McOption[] }>("/api/owner/mc-gmv")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) setMcs(res.mcs);
      })
      .catch((err) => { if (alive) setListError((err as Error).message); });
    return () => { alive = false; };
  }, []);
  const saved = Number(useLocal(OWNER_GMV_KEY)) || null;
  const id = mcs?.some((m) => m.id === saved) ? saved : mcs?.[0]?.id ?? null;
  const { data, error, retry } = useGmvData(id ? `/api/owner/mc-gmv?id=${id}` : null);

  if (listError) return <div className="mt-4"><GmvState error={listError} onRetry={() => location.reload()} /></div>;
  return (
    <div className="mt-4 max-w-3xl space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">ยอดขายราย Mc</h2>
        {mcs ? (
          <Select value={id ? String(id) : undefined} onValueChange={(v) => writeLocal(OWNER_GMV_KEY, v)}>
            <SelectTrigger aria-label="เลือก Mc" className="h-9 min-w-48 rounded-full bg-card"><SelectValue placeholder="เลือก Mc" /></SelectTrigger>
            <SelectContent position="popper" className="max-h-80">
              {mcs.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>{m.name}{m.salaried ? " · Mc ประจำ" : ""}{m.platform === "shopee" ? " · Shopee" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        ชุดเดียวกับที่ Mc ประจำเห็นใน &quot;ตารางของฉัน &gt; ยอดขายของฉัน&quot; · กดปุ่มสไลด์เพื่อดึง PowerPoint / Google Slides
      </p>
      <div className="rounded-xl border bg-card p-3 sm:p-4">
        {data && id ? <GmvView key={id} data={data} /> : <GmvState error={error} onRetry={retry} />}
      </div>
    </div>
  );
}

function Report({ data, month }: { data: MyGmvData; month: string }) {
  const sum = summary(data, month);
  const base = sum.prevSame ?? sum.prev;
  const months = monthSeries(data, data.last);
  const at = months.findIndex((m) => m.month === month);
  const note = prevNote(sum);
  const list = inMonth(data.slots, month);
  const title = `${data.name} ยอดขาย ${monShort(month)}`;

  return (
    <div className="space-y-4 pb-2">
      <div className="flex flex-wrap gap-2">
        <SlidesMenu
          label="สไลด์" title={title} variant="default"
          build={async () => (await import("@/lib/my-gmv-slides")).buildMyGmvDeck(data, month, stampNow())}
        />
        <ExportMenu label="ไฟล์ตัวเลข" size="sm" build={async () => (await import("@/lib/my-gmv-slides")).myGmvBook(data, month)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Kpi label="GMV" value={baht(sum.cur.gmv)} cur={sum.cur.gmv} prev={base.gmv || null} sub={note} big />
        <Kpi label="GMV ต่อชั่วโมง" value={baht(rateOf(sum.cur))} cur={rateOf(sum.cur)} prev={rateOf(base)} sub={note} big />
        <Kpi label="ชั่วโมงที่มียอด" value={hrs(sum.cur.hours)} cur={sum.cur.hours} prev={base.hours || null} sub={`ทั้งเดือน ${hrs(sum.planned.hours)}`} />
        <Kpi
          label="คิวที่นับยอด" value={`${sum.cur.slots} คิว`} cur={sum.cur.slots} prev={base.slots || null}
          sub={sum.upcoming.slots ? `รอไลฟ์อีก ${sum.upcoming.slots} คิว` : "ไลฟ์ครบทุกคิวแล้ว"}
        />
      </div>

      {sum.missing.length || sum.cur.estimated > 0 ? (
        <div className="space-y-1 rounded-xl border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          {sum.cur.estimated > 0 ? (
            <p className="flex gap-1.5">
              <InfoIcon className="mt-px size-3.5 shrink-0" />
              ประมาณจากไฟล์ Export {baht(sum.cur.estimated)} ({Math.round((sum.cur.estimated / (sum.cur.gmv || 1)) * 100)}% ของ GMV) — คิวที่ไม่ได้กรอกยอดใน slot
            </p>
          ) : null}
          {sum.missing.length ? (
            <p className="flex gap-1.5 text-foreground">
              <InfoIcon className="mt-px size-3.5 shrink-0 text-warning-foreground" />
              ไลฟ์แล้วแต่ยังไม่มียอด {sum.missing.length} คิว (ไม่ได้กรอก และยังไม่มีไฟล์ Export) ยังไม่รวมในตัวเลข:{" "}
              {sum.missing.slice(0, 4).map((s) => `${dayText(s.date)} ${s.start}`).join(", ")}{sum.missing.length > 4 ? " …" : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {months.length > 1 ? (
        <Section title="GMV รายเดือน" note="แท่งลายทแยง = เดือนที่ยังไม่จบ · ชี้ / แตะที่แท่งเพื่อดูตัวเลข">
          <BarChart
            label="GMV รายเดือน" categories={months.map((m) => monShort(m.month))} tooltipTitles={months.map((m) => monText(m.month))}
            series={[{ name: "GMV", color: "var(--viz-cur)", values: months.map((m) => m.gmv) }]}
            format={fmtBaht} formatAxis={compact} highlight={at >= 0 ? at : undefined} hatched={months.map((m) => m.partial)}
            extra={(i) => <span className="text-muted-foreground">{hrs(months[i].hours)} · {baht(rateOf(months[i]))}/ชม.</span>}
          />
          <TableView title="ดูเป็นตาราง">
            <AggTable rows={months.map((m) => ({ ...m, label: monText(m.month) + (m.partial ? " (ยังไม่จบ)" : "") }))} />
          </TableView>
        </Section>
      ) : null}

      <Section title={`GMV รายวัน ${monText(month)}`} note={SPLIT_NOTE}>
        <BarChart
          label="GMV รายวัน" categories={sum.days.map((d) => String(Number(d.date.slice(8, 10))))} tooltipTitles={sum.days.map((d) => dayText(d.date))}
          series={[{ name: "GMV", color: "var(--viz-cur)", values: sum.days.map((d) => (d.gmv > 0 ? d.gmv : null)) }]}
          format={fmtBaht} formatAxis={compact} height={180}
          extra={(i) => (sum.days[i].hours ? <span className="text-muted-foreground">{sum.days[i].slots} คิว · {hrs(sum.days[i].hours)}</span> : null)}
        />
      </Section>

      {sum.bands.length || sum.kinds.length ? (
        <Section title="ขายดีช่วงไหน" note={`GMV ต่อชั่วโมง ตามช่วงเวลาที่เริ่มคิว (เช้า 07–11 · บ่าย 11–15 · เย็น 15–19 · ไพรม์ 19–23 · ดึก 23–07) · ${SPLIT_NOTE}`}>
          <AggTable rows={[...sum.bands, ...sum.kinds, ...sum.campaigns.map((c) => ({ ...c, label: `· ${c.label}` }))]} bars />
        </Section>
      ) : null}

      {sum.top.length ? (
        <Section title={`Top ${sum.top.length} คิวยอดสูงสุด`}>
          <SlotList list={sum.top} unitTime />
        </Section>
      ) : null}

      <Section title={`ทุกคิวของ${monText(month)}`} note={SOURCE_NOTE}>
        {list.length ? <SlotList list={list} /> : <p className="py-3 text-center text-sm text-muted-foreground">เดือนนี้ยังไม่มีคิว</p>}
      </Section>
    </div>
  );
}

function Kpi({ label, value, cur, prev, sub, big = false }: {
  label: string; value: string; cur: number | null; prev: number | null; sub: string; big?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-1.5">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <ChangeBadge cur={cur} prev={prev} />
      </div>
      <div className={cn("truncate font-bold tabular-nums", big ? "text-xl text-primary" : "text-lg")}>{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border px-3 py-2.5">
      <h3 className="text-sm font-bold">{title}</h3>
      {note ? <p className="mb-1.5 text-[11px] text-muted-foreground">{note}</p> : <div className="mb-1.5" />}
      {children}
    </section>
  );
}

/** ตารางกลุ่ม: GMV · ชม. · GMV/ชม. (bars = แถบยาวตาม GMV/ชม.) */
function AggTable({ rows, bars = false }: { rows: (MyGmvAgg & { label: string })[]; bars?: boolean }) {
  const max = Math.max(0, ...rows.map((r) => rateOf(r) ?? 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="border-b text-right">
            <th className="py-1 text-left font-medium">กลุ่ม</th>
            <th className="py-1 font-medium">คิว</th>
            <th className="py-1 font-medium">ชม.</th>
            <th className="py-1 font-medium">GMV</th>
            <th className="py-1 pl-2 font-medium">GMV/ชม.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key + r.label} className="border-b last:border-0 text-right">
              <td className="py-1.5 pr-2 text-left whitespace-nowrap">{r.label}</td>
              <td className="py-1.5">{r.slots}</td>
              <td className="py-1.5">{Number.isInteger(r.hours) ? r.hours : r.hours.toFixed(1)}</td>
              <td className="py-1.5 pl-2">{baht(r.gmv)}</td>
              <td className="py-1.5 pl-2 font-semibold">
                {bars && max ? (
                  <span className="flex items-center justify-end gap-1.5">
                    <span className="hidden h-1.5 rounded-full bg-viz-cur sm:block" style={{ width: `${Math.round(((rateOf(r) ?? 0) / max) * 64)}px` }} aria-hidden />
                    {baht(rateOf(r))}
                  </span>
                ) : baht(rateOf(r))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_CLASS: Partial<Record<MyGmvSlot["status"], string>> = {
  estimated: "border-viz-prev/40 bg-viz-prev/10 text-viz-prev",
  none: "border-warning-border bg-warning text-warning-foreground",
};

/** unitTime = เวลาเต็มของยอด (ยอดรวมหลายคิว = ตั้งแต่คิวแรก · ใช้กับ Top 5) */
function SlotList({ list, unitTime = false }: { list: MyGmvSlot[]; unitTime?: boolean }) {
  return (
    <ul className="divide-y text-sm">
      {list.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
          <span className="min-w-0">
            <span className="block truncate font-medium">{dayText(s.date)} · {unitTime ? slotTime(s) : `${s.start}–${s.end}`}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {s.platform}{s.campaign ? <> · <span className="text-primary">{s.campaign}</span></> : null}
              {s.status === "entered" || s.status === "estimated" ? ` · ${hrs(s.gmvHours)}` : ""}
              {s.merged ? ` · กรอกรวม ${s.merged} คิว` : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className={cn("block tabular-nums", s.gmv !== null ? "font-semibold" : "text-xs text-muted-foreground")}>{slotGmv(s)}</span>
            {s.gmv !== null ? <span className="block text-[11px] text-muted-foreground tabular-nums">{slotRate(s)}/ชม.</span> : null}
            {s.status !== "entered" && s.status !== "covered" ? (
              <Badge variant="outline" className={cn("mt-0.5 h-4 px-1 text-[10px]", STATUS_CLASS[s.status])}>{STATUS_TEXT[s.status]}</Badge>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
