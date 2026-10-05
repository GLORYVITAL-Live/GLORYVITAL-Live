"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, type LucideIcon } from "lucide-react";
import { th } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseKey, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";

// ค่าวันที่ในเว็บเป็นข้อความ "YYYY-MM-DD" / เดือน "YYYY-MM" (เหมือน <input type="date|month">)
// ปฏิทินใช้ Date เวลาท้องถิ่น จึงแปลงตรงๆ ทีละช่อง ไม่ผ่าน UTC (กันวันเลื่อน)

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d || 1);
};
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const opts = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "UTC", ...o });
const fmtDate = opts({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtMonth = opts({ month: "long", year: "numeric" });
const fmtMonthShort = opts({ month: "short" });

/** ปุ่มเปิดตัวเลือก: ไอคอน + ข้อความทางซ้าย ลูกศรลงทางขวา (แบบ shadcn-studio date-picker-03) */
function PickerTrigger({ text, empty, disabled, label, className, icon: Icon = CalendarIcon }: {
  text: string;
  empty: boolean;
  disabled?: boolean;
  label: string;
  className?: string;
  icon?: LucideIcon;
}) {
  return (
    <PopoverTrigger asChild>
      <Button
        variant="outline"
        disabled={disabled}
        aria-label={`${label}: ${empty ? "ยังไม่เลือก" : text}`}
        className={cn("h-9 w-full min-w-0 justify-between bg-card font-normal", className)}
      >
        <span className={cn("flex min-w-0 items-center", empty && "text-muted-foreground")}>
          <Icon className="mr-2 text-muted-foreground" />
          <span className="truncate">{text}</span>
        </span>
        <ChevronDownIcon className="text-muted-foreground" />
      </Button>
    </PopoverTrigger>
  );
}

/** ช่วงปีในตัวเลือกปี: ย้อนหลัง 2 ปี ถึงล่วงหน้า 3 ปี */
function yearRange() {
  const y = new Date().getFullYear();
  return { startMonth: new Date(y - 2, 0), endMonth: new Date(y + 3, 11) };
}

/** เลือกวันที่ (กดเปิดปฏิทิน) — value "" = ยังไม่เลือก (ใช้ได้เมื่อ clearable) */
export function DatePicker({ value, onChange, min, disabled, clearable = false, placeholder = "เลือกวันที่", className, ...aria }: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  disabled?: boolean;
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label": string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? toDate(value) : undefined;
  const minDate = min ? toDate(min) : undefined;
  const text = value ? fmtDate.format(parseKey(value)) : placeholder;
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  const today = todayKey();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger text={text} empty={!value} disabled={disabled} label={aria["aria-label"]} className={className} />
      <PopoverContent align="start" className="w-auto overflow-hidden p-0">
        <Calendar
          mode="single"
          required
          locale={th}
          captionLayout="dropdown"
          {...yearRange()}
          selected={selected}
          defaultMonth={selected ?? minDate}
          disabled={minDate ? { before: minDate } : undefined}
          onSelect={(d) => pick(toKey(d))}
        />
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button variant="ghost" size="sm" disabled={!!min && today < min} onClick={() => pick(today)}>วันนี้</Button>
          {clearable && value ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => pick("")}>ล้าง</Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** เลือกเดือน (ปี + 12 เดือน) — value "YYYY-MM" หรือ "" = ยังไม่เลือก */
export function MonthPicker({ value, onChange, disabled, placeholder = "เลือกเดือน", className, ...aria }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label": string;
}) {
  const [open, setOpen] = useState(false);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(() => (value ? Number(value.slice(0, 4)) : thisYear));
  const text = value ? fmtMonth.format(parseKey(`${value}-01`)) : placeholder;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setYear(value ? Number(value.slice(0, 4)) : thisYear);
        setOpen(next);
      }}
    >
      <PickerTrigger text={text} empty={!value} disabled={disabled} label={aria["aria-label"]} className={className} />
      <PopoverContent align="start" className="w-64 overflow-hidden p-2">
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" size="icon-sm" aria-label="ปีก่อนหน้า" onClick={() => setYear(year - 1)}><ChevronLeftIcon /></Button>
          <span className="text-sm font-semibold tabular-nums" aria-live="polite">{year}</span>
          <Button variant="ghost" size="icon-sm" aria-label="ปีถัดไป" onClick={() => setYear(year + 1)}><ChevronRightIcon /></Button>
        </div>
        <div className="grid grid-cols-3 gap-1" role="grid" aria-label={`เดือนของปี ${year}`}>
          {Array.from({ length: 12 }, (_, i) => {
            const key = `${year}-${pad(i + 1)}`;
            const on = key === value;
            return (
              <Button
                key={key}
                variant={on ? "default" : "ghost"}
                size="sm"
                aria-pressed={on}
                onClick={() => { onChange(key); setOpen(false); }}
                className={cn("font-normal", !on && key === todayKey().slice(0, 7) && "bg-muted")}
              >
                {fmtMonthShort.format(parseKey(`${key}-01`))}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5));

/** เลือกเวลา "HH:MM" (24 ชม.): คอลัมน์ชั่วโมง + นาที (ทีละ 5 นาที) กดนาทีแล้วปิดเอง */
export function TimePicker({ value, onChange, disabled, placeholder = "เลือกเวลา", className, ...aria }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label": string;
}) {
  const [open, setOpen] = useState(false);
  const [h = "", m = ""] = value ? value.split(":") : [];
  // นาทีที่ไม่ลงตัว 5 (เช่นค่าเดิม 09:32) ยังแสดงให้เลือกได้
  const minutes = !m || MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger icon={ClockIcon} text={value || placeholder} empty={!value} disabled={disabled} label={aria["aria-label"]} className={cn("tabular-nums", className)} />
      <PopoverContent align="start" className="w-auto overflow-hidden p-0">
        <div className="flex divide-x">
          <TimeColumn title="ชั่วโมง" items={HOURS} current={h} onPick={(v) => onChange(`${v}:${m || "00"}`)} />
          <TimeColumn title="นาที" items={minutes} current={m} onPick={(v) => { onChange(`${h || "00"}:${v}`); setOpen(false); }} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TimeColumn({ title, items, current, onPick }: {
  title: string;
  items: string[];
  current: string;
  onPick: (v: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // เปิดแล้ว (คอลัมน์ถูกสร้าง) เลื่อนให้ค่าที่เลือกอยู่กลางคอลัมน์ — ทำครั้งเดียว ไม่เลื่อนตามตอนกดเลือก
  useLayoutEffect(() => {
    const el = listRef.current;
    const sel = el?.querySelector<HTMLElement>("[data-selected=true]");
    if (el && sel) el.scrollTop = sel.offsetTop - el.clientHeight / 2 + sel.clientHeight / 2;
  }, []);

  // ป๊อปอัปที่เปิดในหน้าต่าง (Dialog) ถูกระบบล็อกการเลื่อนของหน้าต่างกินล้อเมาส์ จึงเลื่อนเองแทน
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="flex flex-col">
      <div className="border-b px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">{title}</div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={title}
        onTouchMove={(e) => e.stopPropagation()}
        className="no-scrollbar relative flex h-56 w-16 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1"
      >
        {items.map((v) => (
          <Button
            key={v}
            role="option"
            aria-selected={v === current}
            data-selected={v === current}
            variant={v === current ? "default" : "ghost"}
            size="sm"
            onClick={() => onPick(v)}
            className="shrink-0 font-normal tabular-nums"
          >
            {v}
          </Button>
        ))}
      </div>
    </div>
  );
}
