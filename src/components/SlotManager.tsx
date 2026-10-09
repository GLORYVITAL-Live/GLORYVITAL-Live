"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  CalendarSyncIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsUpDownIcon, PlusIcon, RefreshCwIcon, Trash2Icon, XIcon,
} from "lucide-react";
import { fmtDayLong, fmtWeekShort, parseKey, relLabel, todayKey } from "@/lib/format";
import {
  AppDialog, DayBadge, DialogActions, DialogBody, IconButton, LoadError, LoadingBlock, Notice, PlatformBadge, StateBox,
  TAG_COLORS, api, useConfirm, useToast,
} from "@/components/shared";
import { DatePicker, TimePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLocal, writeLocal } from "@/lib/hooks";
import type { OwnerScope } from "@/lib/types";
import { platformLabel, platformRaw } from "@/lib/platform";
import { cn } from "@/lib/utils";

type Side = {
  id: number; personId: number | null; name: string; status: string;
  cancelled: boolean; confirmed: boolean | null; onCalendar: boolean;
};
type Slot = {
  key: string; platform: string; start: string; end: string; startMs: number;
  mc: Side | null; admin: (Side & { extra: boolean }) | null;
};
type Person = { id: number; name: string; hasEmail: boolean; extra?: boolean };
type DayData = { date: string; slots: Slot[]; staff: { mc: Person[]; admin: Person[] }; platforms: string[] };

const STATUSES = ["", "เรียบร้อย", "แคน"];
const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const HIDE_PLATFORMS_KEY = "glory_slot_hide_platforms";

const addDays = (k: string, n: number) => new Date(parseKey(k).getTime() + n * 86400_000).toISOString().slice(0, 10);

/**
 * หน้าจัดการ slot สำหรับเจ้าของ: ดูรายวัน / เพิ่ม / กำหนดคน / เปลี่ยนสถานะ / ลบ
 * scope = ฝั่งที่เห็น / edit = ฝั่งที่แก้ได้ (ฝั่งที่ดูได้อย่างเดียว = เห็นชื่อ + สถานะ ไม่มีปุ่มแก้)
 */
export function SlotManager({ scope, edit }: { scope: OwnerScope; edit: OwnerScope }) {
  const canEdit = edit.mc || edit.admin;
  const toast = useToast();
  const confirm = useConfirm();
  const [date, setDate] = useState(() => todayKey());
  const [data, setData] = useState<DayData | null>(null);
  const [failed, setFailed] = useState<{ date: string; message: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // key ของ slot ที่กำลังบันทึก
  const [createOpen, setCreateOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);
  const reload = () => setTick((n) => n + 1);
  const [syncing, setSyncing] = useState(false);

  async function syncFromSheet() {
    setSyncing(true);
    try {
      type Stat = { updated: number; created: number; removed: number };
      const res = await api<{ mc: Stat; admin: Stat }>("/api/owner/sync-sheet", {});
      if (!res.ok) throw new Error(res.message);
      const changed = res.mc.updated + res.admin.updated, created = res.mc.created + res.admin.created;
      const removed = res.mc.removed + res.admin.removed;
      toast(changed || created || removed
        ? `ซิงค์แล้ว: แก้ ${changed} slot, เพิ่มใหม่ ${created} slot, ลบ ${removed} slot`
        : "ข้อมูลในเว็บตรงกับชีตแล้ว");
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    let alive = true;
    api<DayData>(`/api/owner/slots?date=${date}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setFailed(null); }
      })
      .catch((err) => { if (alive) setFailed({ date, message: (err as Error).message }); });
    return () => { alive = false; };
  }, [date, tick]);

  // กลับมาที่แท็บนี้ (เช่น ไปแก้ในชีตมา) -> โหลดใหม่ + โหลดใหม่ทุก 30 วินาทีระหว่างเปิดหน้าอยู่
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setTick((n) => n + 1); };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const day = data?.date === date ? data : null;
  const error = failed?.date === date ? failed.message : "";

  async function patch(slot: Slot, table: "mc_slots" | "admin_slots", id: number, change: object) {
    setBusy(slot.key);
    try {
      const res = await api("/api/owner/slots", { table, id, ...change }, "PATCH");
      if (!res.ok) throw new Error(res.message);
      toast("บันทึกแล้ว ระบบจะอัปเดตปฏิทินให้ภายใน 1 นาที");
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(slot: Slot) {
    const ok = await confirm({
      title: `ลบ slot ${platformLabel(slot.platform)} ${slot.start}–${slot.end} ?`,
      description: "ลบทั้งในเว็บและแถวในชีต",
      confirmText: "ลบ slot",
      destructive: true,
    });
    if (!ok) return;
    setBusy(slot.key);
    try {
      const res = await api("/api/owner/slots", { mcId: slot.mc?.id, adminId: slot.admin?.id }, "DELETE");
      if (!res.ok) throw new Error(res.message);
      toast("ลบ slot แล้ว");
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const platformIndex = useMemo(() => {
    const idx: Record<string, number> = {};
    for (const p of day?.platforms ?? []) idx[p] = Object.keys(idx).length % 4;
    return idx;
  }, [day]);

  // กรองแพลตฟอร์ม: จำแพลตฟอร์มที่ติ๊กออกไว้ในเครื่อง (ใช้กับทุกวัน)
  const hiddenRaw = useLocal(HIDE_PLATFORMS_KEY);
  const hidden = useMemo<string[]>(() => {
    try { const v = JSON.parse(hiddenRaw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  }, [hiddenRaw]);
  const dayPlatforms = day ? [...new Set(day.slots.map((s) => s.platform))] : [];
  const shown = day ? day.slots.filter((s) => !hidden.includes(s.platform)) : [];
  const togglePlatform = (p: string) =>
    writeLocal(HIDE_PLATFORMS_KEY, JSON.stringify(hidden.includes(p) ? hidden.filter((x) => x !== p) : [...hidden, p]));

  const counts = day ? {
    total: shown.length,
    mcOpen: shown.filter((s) => s.mc && !s.mc.personId).length,
    adminOpen: shown.filter((s) => s.admin?.extra && !s.admin.personId).length,
  } : null;

  return (
    <div className="pb-10">
      <div className="my-2 flex flex-wrap items-center gap-2">
        <IconButton label="วันก่อนหน้า" onClick={() => setDate(addDays(date, -1))}><ChevronLeftIcon /></IconButton>
        <DatePicker value={date} onChange={(v) => v && setDate(v)} aria-label="เลือกวันที่" className="w-auto rounded-full" />
        <IconButton label="วันถัดไป" onClick={() => setDate(addDays(date, 1))}><ChevronRightIcon /></IconButton>
        <Button variant="outline" size="lg" className="rounded-full bg-card" onClick={() => setDate(todayKey())}>วันนี้</Button>
        <div className={cn("ml-auto flex flex-wrap justify-end gap-2", !canEdit && "hidden")}>
          {edit.mc && edit.admin ? (
            <>
              <Button variant="outline" size="lg" className="bg-card" onClick={() => setResyncOpen(true)} title="เช็กทุกคิวตั้งแต่วันนี้กับปฏิทินจริง สร้าง event ที่หาย / แก้ที่ไม่ตรง">
                <CalendarSyncIcon />ซิงค์ปฏิทินใหม่ทั้งหมด
              </Button>
              <Button variant="outline" size="lg" className="bg-card" onClick={() => setCleanupOpen(true)} title="หา event ซ้ำ / ค้างในปฏิทินของพนักงาน แล้วลบ">
                <Trash2Icon />ล้าง event ซ้ำ
              </Button>
            </>
          ) : null}
          <Button variant="outline" size="lg" className="bg-card" disabled={syncing} onClick={syncFromSheet} title="อ่านทุกแถวในชีตมาอัปเดตเว็บ (ใช้เมื่อแก้ในชีตแล้วเว็บไม่เปลี่ยน)">
            {syncing ? <Spinner /> : <RefreshCwIcon />}{syncing ? "กำลังซิงค์..." : "ซิงค์จากชีตทั้งหมด"}
          </Button>
          <Button size="lg" onClick={() => setCreateOpen(true)}><PlusIcon />เพิ่ม slot</Button>
        </div>
      </div>

      <h2 className="mt-3 flex flex-wrap items-center gap-2 font-bold">
        {fmtDayLong.format(parseKey(date))}
        <DayBadge label={relLabel(date)} />
        {dayPlatforms.length > 1 ? (
          <span role="group" aria-label="กรองแพลตฟอร์ม" className="flex flex-wrap items-center gap-1.5 font-normal">
            {dayPlatforms.map((p) => (
              <Label
                key={p}
                className={cn(
                  "cursor-pointer gap-1.5 rounded-full px-2 py-1 text-xs font-semibold",
                  hidden.includes(p) ? "bg-muted text-muted-foreground line-through" : TAG_COLORS[platformIndex[p] ?? 0],
                )}
              >
                <Checkbox checked={!hidden.includes(p)} onCheckedChange={() => togglePlatform(p)} className="size-3.5 bg-card" />
                {platformLabel(p)}
              </Label>
            ))}
          </span>
        ) : null}
        {counts ? (
          <span className="ml-auto text-xs font-medium text-muted-foreground">
            {[`${counts.total} slot`, scope.mc ? `Mc ว่าง ${counts.mcOpen}` : "", scope.admin ? `รอ Admin เสริม ${counts.adminOpen}` : ""]
              .filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </h2>

      {error && !day ? (
        <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={reload} />
      ) : !day ? (
        <LoadingBlock />
      ) : !day.slots.length ? (
        <StateBox title="วันนี้ยังไม่มี slot">{canEdit ? <>กด &quot;เพิ่ม slot&quot; เพื่อสร้าง slot ใหม่</> : null}</StateBox>
      ) : !shown.length ? (
        <StateBox title="ไม่มี slot ของแพลตฟอร์มที่ติ๊กไว้">ติ๊กแพลตฟอร์มด้านบนเพื่อแสดง slot</StateBox>
      ) : (
        <div className="mt-2 space-y-2">
          {shown.map((s) => (
            <SlotRow
              key={s.key}
              slot={s}
              scope={scope}
              edit={edit}
              staff={day.staff}
              tagIndex={platformIndex[s.platform] ?? 0}
              busy={busy === s.key}
              onPatch={(table, id, change) => patch(s, table, id, change)}
              onDelete={() => remove(s)}
            />
          ))}
        </div>
      )}

      {cleanupOpen ? <CalendarCleanup onClose={() => setCleanupOpen(false)} /> : null}
      {resyncOpen ? <CalendarResync onClose={() => setResyncOpen(false)} /> : null}

      {createOpen ? (
        <CreateDialog
          scope={edit}
          defaultDate={date}
          platforms={day?.platforms ?? []}
          onClose={(created) => { setCreateOpen(false); if (created) reload(); }}
        />
      ) : null}
    </div>
  );
}

// Radix Select ใช้ค่าว่างเป็น value ไม่ได้ จึงแทน "ไม่มีสถานะ" ด้วยค่านี้
const NO_STATUS = "__none";

function SlotRow({ slot, scope, edit, staff, tagIndex, busy, onPatch, onDelete }: {
  slot: Slot;
  scope: OwnerScope;
  edit: OwnerScope;
  staff: DayData["staff"];
  tagIndex: number;
  busy: boolean;
  onPatch: (table: "mc_slots" | "admin_slots", id: number, change: object) => void;
  onDelete: () => void;
}) {
  const empty = !slot.mc?.personId && !slot.admin?.personId && !slot.mc?.onCalendar && !slot.admin?.onCalendar;
  const cancelled = slot.mc?.cancelled || slot.admin?.cancelled;

  return (
    <div className={cn("rounded-xl border bg-card p-3 shadow-card", busy && "opacity-60", cancelled && "border-destructive/40")}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold tabular-nums">{slot.start} – {slot.end}</span>
        <PlatformBadge name={slot.platform || "Live"} index={tagIndex} />
        {busy ? <Spinner className="text-muted-foreground" /> : null}
        {empty && (edit.mc || edit.admin) ? (
          <Button variant="destructive" size="xs" disabled={busy} onClick={onDelete} className="ml-auto">
            <Trash2Icon />ลบ slot
          </Button>
        ) : null}
      </div>

      {!scope.mc ? null : slot.mc ? (
        <SideRow
          label="Mc"
          side={slot.mc}
          people={staff.mc}
          busy={busy}
          readOnly={!edit.mc}
          onPerson={(pid) => onPatch("mc_slots", slot.mc!.id, { personId: pid })}
          onStatus={(st) => onPatch("mc_slots", slot.mc!.id, { status: st })}
        />
      ) : <p className="text-xs text-muted-foreground">ไม่มีแถว Mc ของ slot นี้</p>}

      {!scope.admin ? null : slot.admin ? (
        <>
          <SideRow
            label="Admin"
            side={slot.admin}
            people={staff.admin}
            busy={busy}
            readOnly={!edit.admin}
            onPerson={(pid) => onPatch("admin_slots", slot.admin!.id, { personId: pid })}
            onStatus={(st) => onPatch("admin_slots", slot.admin!.id, { status: st })}
          />
          <Label className={cn("mt-2 pl-14 text-xs font-normal text-muted-foreground", !edit.admin && "hidden")}>
            <Checkbox
              checked={slot.admin.extra}
              disabled={busy}
              onCheckedChange={(v) => onPatch("admin_slots", slot.admin!.id, { extraAdmin: v === true })}
            />
            เปิดให้ Admin เสริมรับคิวผ่านเว็บ
          </Label>
        </>
      ) : <p className="mt-1 text-xs text-muted-foreground">ไม่มีแถว Admin ของ slot นี้</p>}
    </div>
  );
}

function SideRow({ label, side, people, busy, readOnly, onPerson, onStatus }: {
  label: string;
  side: Side;
  people: Person[];
  busy: boolean;
  readOnly: boolean; // ดูได้อย่างเดียว: แสดงชื่อ + สถานะเป็นข้อความ
  onPerson: (personId: number | null) => void;
  onStatus: (status: string) => void;
}) {
  const statuses = STATUSES.includes(side.status) ? STATUSES : [...STATUSES, side.status];
  if (readOnly) {
    const p = people.find((x) => x.id === side.personId);
    return (
      <div className="mt-1.5 flex items-center gap-2 text-sm">
        <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
        <span className={cn("min-w-0 flex-1 truncate", !side.name && !p && "text-muted-foreground")}>
          {p ? `${label === "Mc" ? `Mc ${p.name}` : p.name}${p.extra ? " (เสริม)" : ""}` : side.name || "— ว่าง —"}
        </span>
        <span className={cn("shrink-0 text-xs", side.cancelled ? "text-destructive" : "text-muted-foreground")}>{side.status || "สถานะ —"}</span>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <PersonPicker
        label={label}
        value={side.personId}
        options={people.map((p) => ({
          id: p.id,
          text: `${label === "Mc" ? `Mc ${p.name}` : p.name}${p.extra ? " (เสริม)" : ""}${p.hasEmail ? "" : " · ไม่มีอีเมล"}`,
        }))}
        disabled={busy}
        onChange={onPerson}
      />
      <Select value={side.status || NO_STATUS} disabled={busy} onValueChange={(v) => onStatus(v === NO_STATUS ? "" : v)}>
        <SelectTrigger aria-label={`สถานะ ${label}`} className={cn("h-9! w-28 shrink-0 bg-card", side.cancelled && "text-destructive")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {statuses.map((st) => <SelectItem key={st || NO_STATUS} value={st || NO_STATUS}>{st || "สถานะ —"}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** เลือกคน: กดเปิดรายการ แล้วพิมพ์ชื่อเพื่อกรอง (คีย์บอร์ด: ↑ ↓ เลื่อน / Enter เลือก / Esc ปิด) */
export function PersonPicker({ label, value, options, disabled, onChange, emptyText = "— ว่าง —", hideEmpty = false }: {
  label: string;
  value: number | null;
  options: { id: number; text: string }[];
  disabled: boolean;
  onChange: (personId: number | null) => void;
  emptyText?: string; // ข้อความตอนยังไม่เลือก
  hideEmpty?: boolean; // ไม่มีตัวเลือก "ว่าง" ในรายการ
}) {
  const [open, setOpen] = useState(false);
  const all = [...(hideEmpty ? [] : [{ id: null as number | null, text: emptyText }]), ...options];
  const current = all.find((o) => o.id === value)?.text ?? emptyText;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${label}: ${current}`}
          disabled={disabled}
          className="h-9 min-w-0 flex-1 justify-between bg-card font-normal"
        >
          <span className={cn("truncate", value === null && "text-muted-foreground")}>{current}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <Command>
          <CommandInput placeholder={`พิมพ์ชื่อ ${label} เพื่อค้นหา...`} aria-label={`ค้นหา ${label}`} />
          <CommandList>
            <CommandEmpty>ไม่พบชื่อนี้</CommandEmpty>
            <CommandGroup>
              {all.map((o) => (
                <CommandItem
                  key={o.id ?? "none"}
                  value={String(o.id ?? "none")}
                  keywords={[o.text]}
                  data-checked={o.id === value}
                  onSelect={() => { setOpen(false); if (o.id !== value) onChange(o.id); }}
                  className={cn(o.id === null && "text-muted-foreground", o.id === value && "font-semibold")}
                >
                  <span className="truncate">{o.text}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------- ซิงค์ปฏิทินใหม่ทั้งหมด ----------

type ResyncStep = { queued: number; done: number; failed: number; noAccess: string[]; busy: boolean; remaining: number };
const SYSTEM_CALENDAR_ACCOUNT = "kunraroj.d@glorythailand.com"; // บัญชีที่ระบบใช้ลงปฏิทินให้ทุกคน

/** จดงานของทุกคิวตั้งแต่วันนี้ แล้วเรียกทำต่อเรื่อยๆ จนงานหมด (แต่ละครั้ง ~40 วินาที) */
function CalendarResync({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<"running" | "done" | "error">("running");
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [noAccess, setNoAccess] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      let first = true, busyTries = 0;
      while (alive) {
        try {
          const r = await api<ResyncStep>("/api/owner/calendar-resync", { start: first });
          if (!r.ok) throw new Error(r.message);
          if (!alive) return;
          if (first) setTotal(r.queued);
          first = false;
          setDone((n) => n + r.done);
          setFailed((n) => n + r.failed);
          setRemaining(r.remaining);
          if (r.noAccess?.length) setNoAccess((prev) => [...new Set([...prev, ...r.noAccess])].sort());
          if (r.remaining === 0) { setState("done"); return; }
          // มีงานปฏิทินอื่นถือล็อกอยู่ รอแล้วลองใหม่ (ไม่เกิน ~1 นาที)
          if (r.busy) {
            if (++busyTries > 20) throw new Error("มีงานลงปฏิทินอื่นทำอยู่นานเกินไป ลองใหม่อีกครั้งภายหลัง");
            await new Promise((ok) => setTimeout(ok, 3000));
          } else busyTries = 0;
        } catch (err) {
          if (alive) { setError((err as Error).message); setState("error"); }
          return;
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  const running = state === "running";
  const pct = total ? Math.max(0, Math.min(100, Math.round(((total - (remaining ?? total)) / total) * 100))) : 0;
  return (
    <AppDialog
      open
      onClose={onClose}
      title="ซิงค์ปฏิทินใหม่ทั้งหมด"
      description={running
        ? "กำลังเช็กทุกคิวตั้งแต่วันนี้กับปฏิทินของพนักงาน: สร้าง event ที่หาย แก้ที่ไม่ตรง ลบของคิวที่ไม่มีคนแล้ว (เปิดหน้านี้ค้างไว้จนเสร็จ)"
        : state === "done" ? "เสร็จแล้ว ปฏิทินตรงกับคิวในระบบ ถ้ายังมี event ซ้ำ ให้กด \"ล้าง event ซ้ำ\" ต่อ"
          : error}
    >
      <div className="text-sm">
        <Progress value={state === "done" ? 100 : pct} aria-label="ความคืบหน้า" />
        <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
          <span className="flex items-center gap-1.5">{running ? <Spinner className="size-3" /> : null}ทำแล้ว {done} งาน{failed ? ` · ไม่สำเร็จ ${failed}` : ""}</span>
          <span>{remaining === null ? "กำลังเริ่ม..." : `เหลือ ${remaining} งาน`}</span>
        </div>
        {noAccess.length ? (
          <Notice variant="warning" title={`ปฏิทินที่ระบบยังเขียนไม่ได้ (${noAccess.length} คน)`} className="mt-3 text-xs">
            ให้เจ้าของปฏิทินแชร์ปฏิทินให้ <b>{SYSTEM_CALENDAR_ACCOUNT}</b> แบบ &quot;ทำการเปลี่ยนแปลงกิจกรรม&quot;
            แล้วกด &quot;ซิงค์ปฏิทินใหม่ทั้งหมด&quot; อีกครั้ง
            <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5">
              {noAccess.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </Notice>
        ) : failed ? (
          <p className="mt-2 text-xs text-muted-foreground">งานที่ไม่สำเร็จด้วยสาเหตุอื่น ระบบจะลองใหม่เองอีกไม่เกิน 5 ครั้ง</p>
        ) : null}
      </div>
      <DialogActions>
        <Button variant={running ? "outline" : "default"} size="lg" onClick={onClose}>
          {running ? "ปิด (งานที่เหลือจะค่อยๆ ทำต่อเองช้าๆ)" : "ปิด"}
        </Button>
      </DialogActions>
    </AppDialog>
  );
}

// ---------- ล้าง event ซ้ำในปฏิทิน ----------

type CleanupResult = {
  dryRun: boolean; total: number; deleted: number; errors: string[];
  found: { email: string; name: string; summary: string; start: string }[];
};
const fmtEventTime = new Intl.DateTimeFormat("th-TH", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
});

/** ตรวจก่อน (แสดงรายการ) แล้วค่อยกดลบจริง */
function CalendarCleanup({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<"checking" | "ready" | "deleting" | "done" | "error">("checking");
  const [res, setRes] = useState<CleanupResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api<CleanupResult>("/api/owner/calendar-cleanup", { dryRun: true })
      .then((r) => {
        if (!alive) return;
        if (!r.ok) throw new Error(r.message);
        setRes(r);
        setState("ready");
      })
      .catch((err) => { if (alive) { setError((err as Error).message); setState("error"); } });
    return () => { alive = false; };
  }, []);

  async function run() {
    setState("deleting");
    try {
      const r = await api<CleanupResult>("/api/owner/calendar-cleanup", { dryRun: false });
      if (!r.ok) throw new Error(r.message);
      setRes(r);
      setState("done");
      toast(`ลบ event ซ้ำ/ค้างแล้ว ${r.deleted} รายการ`);
    } catch (err) {
      toast((err as Error).message, "error");
      setState("ready");
    }
  }

  const busy = state === "checking" || state === "deleting";
  const note = state === "checking" ? "กำลังตรวจปฏิทินของพนักงานทุกคน (อาจใช้เวลา 10–40 วินาที)..."
    : state === "deleting" ? "กำลังลบ..."
      : state === "error" ? error
        : state === "done" ? `ลบแล้ว ${res?.deleted ?? 0} รายการ`
          : res?.total
            ? `เจอ event ที่ไม่ตรงกับคิวจริง ${res.total} รายการ (ตั้งแต่วันนี้) ตรวจรายการด้านล่างก่อนกดลบ`
            : "ไม่เจอ event ซ้ำหรือค้าง ปฏิทินตรงกับคิวจริงแล้ว";

  return (
    <AppDialog open onClose={onClose} busy={busy} title="ล้าง event ซ้ำในปฏิทิน" description={note}>
      <DialogBody className="text-sm">
        {busy ? <div className="flex justify-center py-4"><Spinner className="size-6 text-primary" /></div> : null}
        {state === "ready" && res?.total ? (
          <Notice className="mt-0 mb-2 text-xs">
            นับเฉพาะ event ที่ชื่อรูปแบบเดียวกับที่ระบบสร้าง (&quot;แพลตฟอร์ม - Mc ชื่อ&quot; / &quot;Admin แพลตฟอร์ม - ชื่อ&quot;)
            แต่ไม่ใช่ event ของคิวที่ยังมีคนนั้นอยู่ = event ซ้ำ หรือคิวที่เอาคนออกแล้วแต่ event ยังค้าง
          </Notice>
        ) : null}
        {res?.found.length ? (
          <ul>
            {res.found.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{f.summary}</span>
                  <span className="block truncate text-xs text-muted-foreground">{f.email}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{f.start ? fmtEventTime.format(new Date(f.start)) : ""}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {res && res.total > res.found.length ? <p className="mt-2 text-xs text-muted-foreground">แสดง {res.found.length} จาก {res.total} รายการ</p> : null}
        {res?.errors.length ? (
          <Collapsible className="mt-3 text-xs text-muted-foreground">
            <CollapsibleTrigger className="group flex items-center gap-1 font-medium hover:text-foreground">
              <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
              ตรวจไม่ได้ {res.errors.length} ปฏิทิน (ยังไม่ได้แชร์ปฏิทินให้ระบบ)
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 list-disc pl-5">{res.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={busy} onClick={onClose}>{state === "done" ? "ปิด" : "ยกเลิก"}</Button>
        {state === "ready" && res?.total ? (
          <Button variant="danger" size="lg" onClick={run}><Trash2Icon />ลบ {res.total} รายการ</Button>
        ) : null}
      </DialogActions>
    </AppDialog>
  );
}

// ---------- เพิ่ม slot ----------

function CreateDialog({ scope, defaultDate, platforms, onClose }: {
  scope: OwnerScope;
  defaultDate: string;
  platforms: string[];
  onClose: (created: boolean) => void;
}) {
  const toast = useToast();
  const [platform, setPlatform] = useState(platforms[0] ?? ""); // ชื่อในชีต (แสดงเป็นชื่อที่แสดง)
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [times, setTimes] = useState([{ start: "09:30", end: "11:30" }]);
  const [extraAdmin, setExtraAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const platformId = useId();

  const dates = useMemo(() => {
    const out: string[] = [];
    if (!from || !to || to < from) return out;
    for (let d = from; d <= to && out.length <= 62; d = addDays(d, 1)) {
      if (weekdays.has(parseKey(d).getUTCDay())) out.push(d);
    }
    return out;
  }, [from, to, weekdays]);
  const validTimes = times.filter((t) => t.start && t.end && t.start !== t.end);
  const total = dates.length * validTimes.length;
  const tooMany = dates.length > 62;

  function setTime(i: number, field: "start" | "end", value: string) {
    setTimes(times.map((t, j) => (j === i ? { ...t, [field]: value } : t)));
  }
  // ช่วงถัดไปเริ่มต่อจากช่วงสุดท้าย (ยาวเท่าเดิม)
  function addTime() {
    const last = times[times.length - 1];
    if (!last) { setTimes([{ start: "09:30", end: "11:30" }]); return; }
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const len = ((toMin(last.end) - toMin(last.start)) + 1440) % 1440 || 120;
    const fmt = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    setTimes([...times, { start: last.end, end: fmt(toMin(last.end) + len) }]);
  }

  async function submit() {
    setSaving(true);
    try {
      const res = await api<{ created: number; skipped: number }>("/api/owner/slots", {
        platform, dates, times: validTimes, extraAdmin,
      });
      if (!res.ok) throw new Error(res.message);
      toast(`สร้าง ${res.created} slot${res.skipped ? ` (ข้าม ${res.skipped} ที่มีอยู่แล้ว)` : ""}`);
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  }

  return (
    <AppDialog
      open
      onClose={() => onClose(false)}
      busy={saving}
      title="เพิ่ม slot"
      description="สร้างได้ทีละหลายวันและหลายช่วงเวลา slot ที่มีอยู่แล้ว (แพลตฟอร์ม + วัน + เวลาเดียวกัน) จะถูกข้าม"
    >
      <DialogBody className="space-y-4 text-sm">
        <div>
          <Label htmlFor={platformId} className="mb-1.5 font-semibold">แพลตฟอร์ม</Label>
          <Input id={platformId} list="platform-list" value={platformLabel(platform)} onChange={(e) => setPlatform(platformRaw(e.target.value))} placeholder="เช่น Shopee, TikTok" />
          <datalist id="platform-list">{platforms.map((p) => <option key={p} value={platformLabel(p)} />)}</datalist>
        </div>

        <div>
          <span className="mb-1.5 block font-semibold">วันที่</span>
          <div className="flex items-center gap-2">
            <DatePicker value={from} onChange={(v) => { setFrom(v); if (v > to) setTo(v); }} aria-label="ตั้งแต่วันที่" className="flex-1" />
            <span className="text-muted-foreground">ถึง</span>
            <DatePicker value={to} min={from} onChange={setTo} aria-label="ถึงวันที่" className="flex-1" />
          </div>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={[...weekdays].map(String)}
            onValueChange={(v) => setWeekdays(new Set(v.map(Number)))}
            aria-label="เฉพาะวัน"
            className="mt-2 flex-wrap"
          >
            {WEEKDAYS.map((w, i) => (
              <ToggleGroupItem key={w} value={String(i)} className="min-w-10 rounded-full! text-xs font-semibold">{w}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="mt-1 text-xs text-muted-foreground">
            {tooMany ? "เลือกได้ไม่เกิน 62 วันต่อครั้ง" : dates.length
              ? `${dates.length} วัน: ${dates.slice(0, 4).map((d) => `${fmtWeekShort.format(parseKey(d))} ${parseKey(d).getUTCDate()}`).join(", ")}${dates.length > 4 ? " ..." : ""}`
              : "ไม่มีวันที่ตรงกับที่เลือก"}
          </p>
        </div>

        <div>
          <span className="mb-1.5 block font-semibold">ช่วงเวลา</span>
          <div className="space-y-2">
            {times.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <TimePicker value={t.start} onChange={(v) => setTime(i, "start", v)} aria-label={`เวลาเริ่ม ช่วงที่ ${i + 1}`} className="flex-1" />
                <span className="text-muted-foreground">–</span>
                <TimePicker value={t.end} onChange={(v) => setTime(i, "end", v)} aria-label={`เวลาจบ ช่วงที่ ${i + 1}`} className="flex-1" />
                <IconButton label="ลบช่วงเวลานี้" variant="ghost" className="text-muted-foreground" onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                  <XIcon />
                </IconButton>
              </div>
            ))}
          </div>
          <Button variant="link" onClick={addTime} className="mt-1 h-auto px-0 font-semibold"><PlusIcon />เพิ่มช่วงเวลา (ต่อจากช่วงสุดท้าย)</Button>
          <p className="mt-1 text-xs text-muted-foreground">เวลาจบก่อนเวลาเริ่ม = ข้ามเที่ยงคืน เช่น 23:30–02:30</p>
        </div>

        {scope.admin ? (
          <Label className="leading-snug font-normal">
            <Checkbox checked={extraAdmin} onCheckedChange={(v) => setExtraAdmin(v === true)} />
            เปิดให้ Admin เสริมรับคิวผ่านเว็บ (หมายเหตุ &quot;Admin เสริม&quot;)
          </Label>
        ) : null}
        {!(scope.mc && scope.admin) ? (
          <p className="text-xs text-muted-foreground">สร้างเฉพาะแถวฝั่ง {scope.mc ? "Mc (แท็บ Deal Mc)" : "Admin (แท็บ Admin เสริม)"} ตามสิทธิ์ของบัญชีนี้</p>
        ) : null}
      </DialogBody>

      <DialogActions>
        <span className="mr-auto text-sm text-muted-foreground">จะสร้าง {tooMany ? 0 : total} slot</span>
        <Button variant="outline" size="lg" disabled={saving} onClick={() => onClose(false)}>ยกเลิก</Button>
        <Button size="lg" disabled={saving || !platform.trim() || !total || tooMany} onClick={submit}>
          {saving ? <><Spinner />กำลังสร้าง...</> : "สร้าง slot"}
        </Button>
      </DialogActions>
    </AppDialog>
  );
}
