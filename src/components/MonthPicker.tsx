"use client";

import { useState } from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { fmtMonthShort, monthKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** ช่วงเดือน "YYYY-MM" (from <= to) */
export type MonthRange = { from: string; to: string };

const short = (k: string) => fmtMonthShort.format(new Date(`${k}-01T12:00:00Z`));
const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/** จุดบอกว่ามีข้อมูล (มุมล่างของปุ่มเดือน) */
function Dot({ on }: { on: boolean }) {
  return <span aria-label="มีข้อมูล" className={cn("absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full", on ? "bg-primary-foreground" : "bg-primary")} />;
}

/** ข้อความช่วงเดือน: "ปี 2026" / "ม.ค.–มิ.ย. 2026" / "พ.ย. 2025 – ม.ค. 2026" / "ส.ค. 2026" */
export function rangeLabel({ from, to }: MonthRange) {
  const fy = from.slice(0, 4), ty = to.slice(0, 4);
  if (from === to) return `${short(from)} ${fy}`;
  if (fy === ty && from.endsWith("-01") && to.endsWith("-12")) return `ปี ${fy}`;
  return fy === ty ? `${short(from)}–${short(to)} ${fy}` : `${short(from)} ${fy} – ${short(to)} ${ty}`;
}

/** จำนวนเดือนในช่วง (รวมทั้งสองข้าง) */
export const monthsIn = ({ from, to }: MonthRange) =>
  (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1;

/**
 * เลือกเดือนแบบปฏิทิน (กดที่ปุ่มแล้วเลือกเดือน)
 *   single = เลือกเดือนเดียว / range = กดเดือนเริ่ม แล้วกดเดือนสุดท้าย (ไม่เกิน maxMonths เดือน) + ปุ่มลัด ทั้งปี / ครึ่งปี / ไตรมาส
 *   quarter = เลือกไตรมาส (คืนช่วง 3 เดือนของไตรมาสนั้น)
 *   marked = เดือนที่มีข้อมูลแล้ว (มีจุดใต้ชื่อเดือน)
 */
export function MonthPicker({ mode, value, onChange, maxMonths = 12, marked, label, className }: {
  mode: "single" | "range" | "quarter";
  value: MonthRange;
  onChange: (v: MonthRange) => void;
  maxMonths?: number;
  marked?: string[];
  /** ข้อความบนปุ่ม (ไม่ใส่ = ชื่อช่วงเดือน) */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(+value.to.slice(0, 4));
  // range: กดเดือนแรกแล้ว รอเดือนสุดท้าย
  const [start, setStart] = useState<string | null>(null);
  const now = monthKey();

  function openChange(next: boolean) {
    setOpen(next);
    if (next) { setYear(+value.to.slice(0, 4)); setStart(null); }
  }
  function done(v: MonthRange) {
    onChange(v);
    setOpen(false);
    setStart(null);
  }
  function pick(k: string) {
    if (mode === "single") return done({ from: k, to: k });
    if (!start) return setStart(k);
    const [from, last] = start <= k ? [start, k] : [k, start];
    done({ from, to: monthsIn({ from, to: last }) > maxMonths ? monthKey(maxMonths - 1, from) : last });
  }

  const shown = start ? { from: start, to: start } : value;
  const presets: [string, MonthRange][] = mode === "range" ? [
    ["ทั้งปี", { from: key(year, 1), to: key(year, 12) }],
    ["H1", { from: key(year, 1), to: key(year, 6) }],
    ["H2", { from: key(year, 7), to: key(year, 12) }],
    ...[1, 2, 3, 4].map((q): [string, MonthRange] => [`Q${q}`, { from: key(year, q * 3 - 2), to: key(year, q * 3) }]),
  ] : [];

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-9 gap-2 rounded-full bg-card px-4 font-bold", className)} aria-label="เลือกเดือน">
          <CalendarIcon className="text-muted-foreground" /><span className="truncate">{label ?? rangeLabel(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" size="icon-sm" aria-label="ปีก่อนหน้า" onClick={() => setYear(year - 1)}><ChevronLeftIcon /></Button>
          <strong aria-live="polite">{year}</strong>
          <Button variant="ghost" size="icon-sm" aria-label="ปีถัดไป" onClick={() => setYear(year + 1)}><ChevronRightIcon /></Button>
        </div>
        {mode === "quarter" ? (
          <div className="grid grid-cols-2 gap-1.5" role="grid">
            {[1, 2, 3, 4].map((q) => {
              const from = key(year, q * 3 - 2), to = key(year, q * 3);
              const on = value.from === from;
              const has = marked?.some((m) => m >= from && m <= to);
              return (
                <Button
                  key={q}
                  variant="ghost"
                  aria-pressed={on}
                  onClick={() => done({ from, to })}
                  className={cn(
                    "relative h-auto flex-col gap-0 rounded-lg py-2",
                    on && "bg-primary! text-primary-foreground!",
                    now >= from && now <= to && !on && "ring-1 ring-primary/40",
                  )}
                >
                  <span className="font-bold">Q{q}</span>
                  <span className={cn("text-[11px] font-normal", on ? "opacity-90" : "text-muted-foreground")}>{short(from)}–{short(to)}</span>
                  {has ? <Dot on={on} /> : null}
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5" role="grid">
            {Array.from({ length: 12 }, (_, i) => {
              const k = key(year, i + 1);
              const inRange = k >= shown.from && k <= shown.to;
              const edge = k === shown.from || k === shown.to;
              return (
                <Button
                  key={k}
                  variant="ghost"
                  size="sm"
                  aria-pressed={inRange}
                  onClick={() => pick(k)}
                  className={cn(
                    "relative h-9 rounded-lg text-[13px] font-semibold",
                    inRange && "bg-secondary text-secondary-foreground",
                    edge && "bg-primary! text-primary-foreground!",
                    k === now && !inRange && "ring-1 ring-primary/40",
                  )}
                >
                  {short(k)}
                  {marked?.includes(k) ? <Dot on={edge} /> : null}
                </Button>
              );
            })}
          </div>
        )}
        {marked ? <p className="mt-2 text-[11px] text-muted-foreground">• = มีข้อมูลแล้ว</p> : null}
        {mode === "range" ? (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              {start ? `เริ่ม ${short(start)} ${start.slice(0, 4)} · กดเดือนสุดท้าย` : `กดเดือนเริ่ม แล้วกดเดือนสุดท้าย (ไม่เกิน ${maxMonths} เดือน)`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {presets.map(([label, v]) => (
                <Button key={label} variant="outline" size="xs" className="rounded-full" onClick={() => done(v)}>{label}</Button>
              ))}
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
