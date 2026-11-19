"use client";

import { useEffect, useState } from "react";
import { LockIcon, LockOpenIcon, RefreshCwIcon } from "lucide-react";
import { FORECAST_LOCK_DAY, shiftMonth, type ForecastStatus } from "@/lib/cost-forecast";
import { fmtDayMonth, money, monthLabel, num, parseKey } from "@/lib/format";
import { Notice, api, useConfirm, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// Forecast ค่าใช้จ่ายของเดือนที่เลือก (แท็บ "Sum 2" ในชีตของทีม · src/lib/cost-forecast.ts)
//   ก่อนวันที่ 20 ของเดือนก่อนหน้า: เว็บอัปเดตตามแพลนทุกวัน 23:00 น. · สิ้นวันที่ 20 ล็อคอัตโนมัติ (กดล็อคก่อนได้)

/** เวลา (ms) -> "20 พ.ย. 23:59 น." เวลาไทย */
function stamp(ms: number) {
  const t = new Date(ms + 7 * 3600_000).toISOString();
  return `${fmtDayMonth.format(parseKey(t.slice(0, 10)))} ${t.slice(11, 16)} น.`;
}

export function CostForecast({ month, canEdit, onChanged }: { month: string; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<{ month: string; status?: ForecastStatus; error?: string }>({ month: "" });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<"" | "update" | "lock" | "unlock">("");

  useEffect(() => {
    let alive = true;
    api<{ status: ForecastStatus }>(`/api/cost/forecast?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) setState({ month, status: res.status });
      })
      .catch((err) => { if (alive) setState({ month, error: (err as Error).message }); });
    return () => { alive = false; };
  }, [month, tick]);

  const s = state.month === month ? state.status : undefined;
  if (!s) return null; // โหลดอยู่ / โหลดไม่ได้ = ไม่แสดงกล่องนี้ (ส่วนอื่นของหน้ายังใช้ได้)
  const label = monthLabel(month);
  const lockDay = fmtDayMonth.format(parseKey(`${shiftMonth(month, -1)}-${FORECAST_LOCK_DAY}`));
  const sheetDiff = s.locked && s.sheet && Math.round(s.sheet.total) !== Math.round(s.locked.total);
  // เดือนที่ผ่านไปนานแล้วและไม่เคยล็อค: ไม่มีอะไรให้ทำ ไม่ต้องแสดง
  if (!s.locked && s.due && !s.sheet && !s.error) return null;

  async function run(action: "update" | "lock" | "unlock") {
    if (action === "lock" && !(await confirm({
      title: `ล็อค Forecast ${label}?`,
      description: s!.sheet
        ? `เก็บตัวเลขในชีตตอนนี้ (฿${money(s!.sheet.total)} · ${num(s!.sheet.hours)} ชม.) เป็นชุดที่ล็อค เว็บจะไม่อัปเดตคอลัมน์นี้อีก · ปลดล็อคได้ถึงสิ้นวันที่ ${lockDay}`
        : "เก็บตัวเลข Forecast ในชีตตอนนี้เป็นชุดที่ล็อค",
      confirmText: "ล็อค Forecast",
    }))) return;
    if (action === "unlock" && !(await confirm({
      title: `ปลดล็อค Forecast ${label}?`,
      description: `เว็บจะกลับไปอัปเดตตามแพลนทุกวัน และล็อคอัตโนมัติสิ้นวันที่ ${lockDay}`,
      confirmText: "ปลดล็อค",
    }))) return;
    setBusy(action);
    try {
      const res = await api<{ written?: number; warnings?: string[] }>("/api/cost/forecast", { month, action });
      if (!res.ok) throw new Error(res.message);
      toast(action === "update" ? (res.written ? `อัปเดตชีตแล้ว ${res.written} ช่อง` : "ตัวเลขในชีตตรงกับแพลนอยู่แล้ว") : action === "lock" ? "ล็อค Forecast แล้ว" : "ปลดล็อคแล้ว");
      for (const w of res.warnings ?? []) toast(w, "error");
      setTick((n) => n + 1);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="my-4 space-y-2 rounded-2xl border bg-card p-3 text-sm">
      <h2 className="flex items-center gap-2 text-base font-bold">
        {s.locked ? <LockIcon className="size-4 text-success" aria-hidden /> : <LockOpenIcon className="size-4 text-muted-foreground" aria-hidden />}
        Forecast {label}
      </h2>
      {s.locked ? (
        <p>
          <strong className="text-success">ล็อคแล้ว</strong> {stamp(Date.parse(s.locked.lockedAt))} ({s.locked.lockedBy ? "กดล็อคเอง" : "อัตโนมัติ"})
          {" · "}เงินรวม <strong className="tabular-nums">฿{money(s.locked.total)}</strong> · ไลฟ์ <strong className="tabular-nums">{num(s.locked.hours)} ชม.</strong>
          <span className="block text-xs text-muted-foreground">
            หน้า Cost ใช้ชุดที่ล็อคนี้ · แพลนที่เปลี่ยนหลังล็อคให้ไปอยู่ใน Actual
            {sheetDiff ? ` · ตัวเลขในชีตตอนนี้ ฿${money(s.sheet!.total)} (มีคนแก้หลังล็อค)` : ""}
          </span>
        </p>
      ) : s.due ? (
        <p>
          <strong className="text-warning-foreground">เลยวันล็อค ({lockDay}) แล้ว</strong> · เว็บจะล็อคตัวเลขในชีตให้ภายใน 1 ชม.
          {s.sheet ? <> · ในชีตตอนนี้ ฿{money(s.sheet.total)} · {num(s.sheet.hours)} ชม.</> : " · ในชีตยังไม่มีตัวเลข Forecast ของเดือนนี้"}
        </p>
      ) : (
        <p>
          <strong>ยังไม่ล็อค</strong> · เว็บอัปเดตคอลัมน์ Forecast ในชีตตามแพลนทุกวัน 23:00 น. และ<strong>ล็อคอัตโนมัติสิ้นวันที่ {lockDay}</strong>
          <span className="block text-xs text-muted-foreground">
            {s.sheet ? `ในชีตตอนนี้ ฿${money(s.sheet.total)} · ${num(s.sheet.hours)} ชม.` : "ในชีตยังไม่มีตัวเลข Forecast ของเดือนนี้"}
            {" · "}Agency ใช้เรทในเว็บ · In-house ใช้เรทเดิมในสูตรของชีต · แถว Admin ทีมกรอกเอง
          </span>
        </p>
      )}
      {s.last ? <p className="text-xs text-muted-foreground">ล่าสุด: {stamp(Date.parse(s.last.at))} · {s.last.action.replace(/^Forecast \d{4}-\d{2}: /, "")}</p> : null}
      {s.error ? <Notice variant="warning" className="my-0 text-xs">{s.error}</Notice> : null}
      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          {!s.locked && !s.due ? (
            <Button variant="outline" disabled={!!busy} onClick={() => run("update")}>
              {busy === "update" ? <Spinner /> : <RefreshCwIcon />}อัปเดตจากแพลนตอนนี้
            </Button>
          ) : null}
          {!s.locked ? (
            <Button disabled={!!busy || !s.sheet} onClick={() => run("lock")}>
              {busy === "lock" ? <Spinner /> : <LockIcon />}ล็อคเลย
            </Button>
          ) : !s.due ? (
            <Button variant="outline" disabled={!!busy} onClick={() => run("unlock")}>
              {busy === "unlock" ? <Spinner /> : <LockOpenIcon />}ปลดล็อค
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
