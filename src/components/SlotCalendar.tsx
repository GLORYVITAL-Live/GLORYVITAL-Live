"use client";

import { useState } from "react";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDayLong, monthKey, monthLabel, parseKey, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEK = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/**
 * ปุ่มปฏิทินท้ายแถบเลื่อนวัน (หน้าจองคิว Mc / Admin): ดูทั้งเดือนว่าวันไหนมี slot ว่าง แตะวันเพื่อเลื่อนไปที่วันนั้น
 *   counts = จำนวน slot ที่แสดงอยู่ต่อวัน (ตามตัวกรองช่องเดียวกับแถบ) · full = วันที่เลือกไม่ได้แล้ว (ครบโควต้า)
 *   picked = วันที่มี slot ที่เลือกไว้ (จุดชมพูแบบเดียวกับแถบ) · active = วันที่กำลังดูอยู่
 */
export function SlotCalendar({ counts, full, picked, active, onPick }: {
  counts: Map<string, number>;
  full: Set<string>;
  picked: Set<string>;
  active: string;
  onPick: (date: string) => void;
}) {
  const keys = [...counts.keys()].sort();
  const first = keys[0]?.slice(0, 7) ?? monthKey();
  const last = keys[keys.length - 1]?.slice(0, 7) ?? first;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(first);
  const today = todayKey();

  const [y, m] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const total = days.reduce((a, k) => a + (counts.get(k) ?? 0), 0);

  return (
    <Popover
      open={open}
      // เปิด = แสดงเดือนของวันที่กำลังดูอยู่
      onOpenChange={(next) => { if (next) setMonth((active || keys[0] || today).slice(0, 7)); setOpen(next); }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline" aria-label="เปิดปฏิทิน ดูวันที่มี slot ทั้งเดือน"
          // สูงเท่าชิปวันที่ในแถบ (แถวเดียวกัน stretch) · mb-1 = ระยะเผื่อแถบเลื่อนของแถบวัน
          className="mb-1 h-auto w-14 shrink-0 flex-col gap-1 self-stretch rounded-xl bg-card px-1 py-1.5 text-[11px] font-normal [&_svg:not([class*='size-'])]:size-5"
        >
          <CalendarDaysIcon className="text-primary" />ปฏิทิน
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <Button size="icon" variant="ghost" aria-label="เดือนก่อน" disabled={month <= first} onClick={() => setMonth(monthKey(-1, month))}>
            <ChevronLeftIcon />
          </Button>
          <span className="text-center leading-tight">
            <strong className="block text-sm">{monthLabel(month)}</strong>
            <span className="text-[11px] text-muted-foreground">{total ? `ว่าง ${total} slot` : "ไม่มี slot ว่างในเดือนนี้"}</span>
          </span>
          <Button size="icon" variant="ghost" aria-label="เดือนถัดไป" disabled={month >= last} onClick={() => setMonth(monthKey(1, month))}>
            <ChevronRightIcon />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEK.map((w) => <span key={w} aria-hidden className="text-[11px] text-muted-foreground">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} aria-hidden />)}
          {days.map((k) => {
            const n = counts.get(k) ?? 0;
            const on = k === active;
            const isFull = full.has(k);
            return (
              <button
                key={k} type="button" disabled={!n}
                onClick={() => { setOpen(false); onPick(k); }}
                aria-current={on ? "date" : undefined}
                aria-label={`${fmtDayLong.format(parseKey(k))} · ${!n ? "ไม่มี slot" : isFull ? "ครบแล้ว" : `${n} slot`}${picked.has(k) ? " · เลือกไว้แล้ว" : ""}`}
                className={cn(
                  "relative flex h-11 flex-col items-center justify-center rounded-lg text-sm leading-none tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  !n ? "text-muted-foreground/40"
                    : on ? "cursor-pointer border border-primary bg-primary/10 font-bold text-primary"
                      : "cursor-pointer border bg-card font-semibold hover:bg-muted",
                  k === today && !on && "ring-1 ring-primary/60",
                )}
              >
                {picked.has(k) ? <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-brand-glow" /> : null}
                {Number(k.slice(8))}
                {n ? (
                  <span className={cn("mt-1 text-[10px] font-normal", isFull ? "font-semibold text-destructive" : !on && "text-muted-foreground")}>
                    {isFull ? "ครบ" : `${n} slot`}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          แตะวันเพื่อไปที่วันนั้น · วันสีจาง = ไม่มี slot ว่าง · <span className="font-semibold text-destructive">ครบ</span> = เลือกเพิ่มไม่ได้แล้ว
          {picked.size ? <> · <span aria-hidden className="inline-block size-1.5 rounded-full bg-brand-glow align-middle" /> = มี slot ที่เลือกไว้</> : null}
        </p>
      </PopoverContent>
    </Popover>
  );
}
