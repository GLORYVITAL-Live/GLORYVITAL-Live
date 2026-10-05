"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, EyeIcon, LayoutGridIcon, Rows3Icon } from "lucide-react";
import type { ActionResult, Me, OpenSlot, SlotsResponse } from "@/lib/types";
import {
  fmtDayLong, fmtDayShort, fmtHours, fmtMonthShort, fmtWeekShort, hoursOf, parseKey, platformOf, relLabel,
} from "@/lib/format";
import {
  AppDialog, DayBadge, DialogActions, DialogBody, LoadError, Notice, PlatformBadge, StateBox, api, useToast,
} from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// ให้ตรงกับ settings ใน DB (ฝั่ง server เช็คซ้ำอีกชั้นเสมอ)
const MAX_SLOTS_PER_DAY = 2;
const MAX_HOURS_PER_DAY = 4;
const MAX_PER_REQUEST = 10;
const ADMIN_MAX_SLOTS_PER_DAY = 4;
const ADMIN_MAX_HOURS_PER_DAY = 8;
const ADMIN_MAX_BLOCKS_PER_DAY = 2; // ช่วง = slot ที่ต่อกัน เช่น 09:30–11:30 + 11:30–13:30

/** จำนวนช่วงเวลาต่อเนื่อง (slot ที่เวลาจบ = เวลาเริ่มของอีก slot นับเป็นช่วงเดียวกัน) */
function blocksOf(list: OpenSlot[]) {
  const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
  return sorted.filter((x, i) => i === 0 || sorted[i - 1].endMs !== x.startMs).length;
}
const VIEW_KEY = "glory_booking_view";
const POLL_MS = 15_000; // โหลด slot ใหม่อัตโนมัติระหว่างเปิดหน้าอยู่ (แก้/ลบในชีต มีคนจองไปแล้ว)
const fmtClock = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" });

const TEXT = {
  mc: {
    countLbl: "ว่าง", verb: "จอง", done: "✓ จองแล้ว", lockMsg: "ระบบปิดรับจองชั่วคราว",
    empty: ["ยังไม่มี slot ว่างให้จอง", "แวะกลับมาดูใหม่เมื่อทีมงานอัปเดตตาราง"],
    doneNote: "จองเรียบร้อย ระบบจะลงปฏิทินให้ภายใน 1–2 นาที",
  },
  admin: {
    countLbl: "รอ Admin", verb: "รับคิว", done: "✓ รับคิวแล้ว", lockMsg: "ระบบปิดรับจัดคิวชั่วคราว",
    empty: ["ตอนนี้ไม่มี slot ที่รอ Admin", "ทุก slot มี Admin ครบแล้ว แวะกลับมาดูใหม่ภายหลัง"],
    doneNote: "รับคิวเรียบร้อย ระบบจะลงปฏิทินของคุณและอัปเดตปฏิทินของ Mc ให้ภายใน 1–2 นาที",
  },
} as const;

type DialogState = "closed" | "confirm" | "busy" | "done";

/** preview = Owner เปิดดูหน้านี้ (ไม่ได้เป็น Mc / Admin เอง) เห็นเหมือนกันแต่เลือก/จองไม่ได้ */
export function SlotBoard({ me, role, preview = false }: { me: Me; role: "mc" | "admin"; preview?: boolean }) {
  const toast = useToast();
  const t = TEXT[role];
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setSelected] = useState<Map<number, OpenSlot>>(new Map());
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const view = useLocal(VIEW_KEY) === "table" ? "table" : "card";
  const [shownDate, setActiveDate] = useState("");
  const [dialog, setDialog] = useState<DialogState>("closed");
  const [results, setResults] = useState<ActionResult[] | null>(null);
  const [lostResponse, setLostResponse] = useState(false);
  const stripRef = useRef<HTMLElement>(null);

  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(0);
  const pickedRef = useRef(picked);
  const dialogRef = useRef(dialog);
  useEffect(() => { pickedRef.current = picked; dialogRef.current = dialog; }, [picked, dialog]);

  useEffect(() => {
    let alive = true;
    api<SlotsResponse>(`/api/slots?role=${role}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (!alive) return;
        const now = Date.now();
        const fresh = res.slots.filter((s) => s.endMs > now);
        setData({ ...res, slots: fresh });
        setLoadError("");
        setUpdatedAt(now);
        // slot ที่เลือกไว้หายไป (มีคนจองไปก่อน / ทีมงานลบหรือแก้ในชีต)
        const ids = new Set(fresh.map((s) => s.id));
        const lost = [...pickedRef.current.keys()].filter((id) => !ids.has(id));
        if (lost.length) {
          setSelected((prev) => new Map([...prev].filter(([id]) => ids.has(id))));
          toast(`slot ที่เลือกไว้ ${lost.length} slot ไม่ว่างแล้ว (มีคน${t.verb}ไปก่อน หรือทีมงานแก้ตาราง)`, "error");
        }
      })
      .catch((err) => { if (alive) setLoadError((err as Error).message); })
      .finally(() => { if (alive) setRefreshing(false); });
    return () => { alive = false; };
  }, [role, tick, toast, t.verb]);

  // อัปเดตอัตโนมัติ: ทุก POLL_MS ระหว่างเปิดหน้าอยู่ + ทันทีที่กลับมาที่แท็บนี้ (ไม่รีเฟรชระหว่างเปิดหน้าต่างยืนยัน)
  useEffect(() => {
    let last = Date.now();
    const refresh = (force: boolean) => {
      if (document.visibilityState !== "visible" || dialogRef.current !== "closed") return;
      if (!force && Date.now() - last < POLL_MS - 1000) return;
      last = Date.now();
      setTick((n) => n + 1);
    };
    const timer = setInterval(() => refresh(false), POLL_MS);
    const onShow = () => { if (Date.now() - last > 3000) refresh(true); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, []);

  // โหลดใหม่จากปุ่ม/หลังจอง (แสดงแถบโหลดด้านบนระหว่างรอ)
  function reload() {
    setRefreshing(true);
    setTick((n) => n + 1);
  }

  const isLocked = !!data?.siteNotice;
  const slots = useMemo(() => data?.slots ?? [], [data]);

  // สีประจำแพลตฟอร์ม ตามลำดับที่เจอ
  const platformIndex = useMemo(() => {
    const idx: Record<string, number> = {};
    for (const s of slots) { const p = platformOf(s); if (!(p in idx)) idx[p] = Object.keys(idx).length % 4; }
    return idx;
  }, [slots]);
  const platforms = Object.keys(platformIndex);

  const visible = useMemo(
    () => slots.filter((s) => filters.size === 0 || filters.has(platformOf(s))),
    [slots, filters],
  );
  const groups = useMemo(() => {
    const g = new Map<string, OpenSlot[]>();
    for (const s of visible) g.set(s.date, [...(g.get(s.date) ?? []), s]);
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  // ไม่นับ slot ที่หายไปแล้ว (มีคนจองไปก่อน) ในรายการที่เลือกไว้
  const selected = useMemo(() => {
    const ids = new Set(slots.map((s) => s.id));
    return new Map([...picked].filter(([id]) => ids.has(id)));
  }, [picked, slots]);
  const activeDate = groups.some(([k]) => k === shownDate) ? shownDate : groups[0]?.[0] ?? "";

  // ชิปวันที่ที่ active ตามส่วนที่เลื่อนอยู่
  useEffect(() => {
    if (!groups.length) return;
    const obs = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActiveDate((top.target as HTMLElement).dataset.date!);
    }, { rootMargin: "-160px 0px -65% 0px" });
    document.querySelectorAll("section[data-date]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [groups]);

  useEffect(() => {
    const chip = document.getElementById(`chip-${activeDate}`);
    const strip = stripRef.current;
    if (chip && strip) strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
  }, [activeDate]);

  function blockReason(s: OpenSlot) {
    if (isLocked) return t.lockMsg;
    const chosen = [...selected.values()];
    if (chosen.some((x) => s.startMs < x.endMs && s.endMs > x.startMs)) return "เวลานี้ทับกับ slot ที่เลือกไว้แล้ว";
    if (chosen.length >= MAX_PER_REQUEST) return `เลือกได้ครั้งละไม่เกิน ${MAX_PER_REQUEST} slot`;
    const sameDay = chosen.filter((x) => x.date === s.date);
    if (role === "admin") {
      if (sameDay.length >= ADMIN_MAX_SLOTS_PER_DAY) return `รับได้สูงสุด ${ADMIN_MAX_SLOTS_PER_DAY} slot ต่อวัน`;
      if (sameDay.reduce((a, x) => a + hoursOf(x), 0) + hoursOf(s) > ADMIN_MAX_HOURS_PER_DAY) return `รวมแล้วเกิน ${ADMIN_MAX_HOURS_PER_DAY} ชม. ต่อวัน`;
      if (blocksOf([...sameDay, s]) > ADMIN_MAX_BLOCKS_PER_DAY) {
        return `แบ่งได้ไม่เกิน ${ADMIN_MAX_BLOCKS_PER_DAY} ช่วงต่อวัน เลือก slot ที่ต่อกับช่วงที่เลือกไว้`;
      }
      return "";
    }
    if (sameDay.length >= MAX_SLOTS_PER_DAY) return `เลือกได้สูงสุด ${MAX_SLOTS_PER_DAY} slot ต่อวัน`;
    if (sameDay.reduce((a, x) => a + hoursOf(x), 0) + hoursOf(s) > MAX_HOURS_PER_DAY) return `รวมแล้วเกิน ${MAX_HOURS_PER_DAY} ชม. ต่อวัน`;
    return "";
  }

  function toggle(s: OpenSlot) {
    if (preview) { toast("โหมดดูอย่างเดียว (เจ้าของ) จองแทนไม่ได้"); return; }
    if (selected.has(s.id)) {
      const next = new Map(selected);
      next.delete(s.id);
      setSelected(next);
      return;
    }
    const reason = blockReason(s);
    if (reason) { toast(reason, "error"); return; }
    setSelected(new Map(selected).set(s.id, s));
  }

  function toggleFilter(p: string | null) {
    const next = new Set(filters);
    if (p === null) next.clear();
    else if (next.has(p)) next.delete(p);
    else next.add(p);
    if (next.size === platforms.length) next.clear(); // เลือกครบ = ทั้งหมด
    setFilters(next);
  }

  function changeView(v: "card" | "table") {
    writeLocal(VIEW_KEY, v);
  }

  const sorted = [...selected.values()].sort((a, b) => a.startMs - b.startMs);
  const totalHours = sorted.reduce((a, s) => a + hoursOf(s), 0);
  const barOpen = selected.size > 0 && !isLocked;
  const selectedDates = new Set(sorted.map((s) => s.date));

  async function submit() {
    setDialog("busy");
    try {
      const res = await api<{ results: ActionResult[] }>("/api/book", { role, ids: sorted.map((s) => s.id) });
      if (!res.ok) {
        toast(res.message ?? "ไม่ทราบสาเหตุ", "error");
        if (res.authError) { setDialog("closed"); location.reload(); } else setDialog("confirm");
        return;
      }
      setResults(res.results);
      setLostResponse(false);
    } catch {
      // ไม่ลองจองซ้ำอัตโนมัติ เพราะคำขออาจถึงระบบแล้วแต่คำตอบหายระหว่างทาง
      setResults(null);
      setLostResponse(true);
    }
    setDialog("done");
  }

  function closeDialog() {
    const wasDone = dialog === "done";
    setDialog("closed");
    if (wasDone) {
      setSelected(new Map());
      setResults(null);
      reload();
    }
  }

  const okCount = results?.filter((r) => r.success).length ?? 0;
  const dlgTitle = dialog === "done"
    ? lostResponse
      ? "ไม่ได้รับคำตอบจากระบบ"
      : okCount === results!.length ? `${t.verb}สำเร็จ ${okCount} slot`
        : okCount === 0 ? `${t.verb}ไม่สำเร็จ` : `${t.verb}สำเร็จ ${okCount} จาก ${results!.length} slot`
    : `ยืนยันการ${t.verb} ${selected.size} slot`;
  const dlgNote = dialog === "done"
    ? lostResponse
      ? `การ${t.verb}อาจสำเร็จแล้ว กด "เสร็จสิ้น" เพื่อโหลดรายการใหม่ ถ้า slot หายไปจากรายการแปลว่าสำเร็จ`
      : okCount > 0 ? t.doneNote : "ดูเหตุผลด้านล่าง แล้วเลือก slot อื่น"
    : role === "admin"
      ? `รับคิวในชื่อ ${me.admin?.name} ระบบจะใส่ชื่อและเบอร์โทรในปฏิทินของ Mc ให้`
      : `จองในนาม Mc ${me.mc?.name} ระบบจะลงปฏิทินให้อัตโนมัติ`;
  const resultById = new Map((results ?? []).map((r) => [r.id, r]));

  return (
    <>
      {refreshing && data ? <div className="refresh-bar" /> : null}

      {preview ? (
        <Alert role="status" className="my-2 px-3 py-2.5">
          <EyeIcon />
          <AlertDescription className="text-foreground">
            <span>
              <strong>โหมดดูอย่างเดียว (เจ้าของ)</strong>
              <span className="text-muted-foreground">
                {" "}— เห็นหน้านี้แบบเดียวกับที่{role === "mc" ? " Mc " : " Admin เสริม "}เห็น แต่เลือกหรือจองแทนไม่ได้
              </span>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {data?.siteNotice ? <Notice variant="warning" icon className="font-medium">{data.siteNotice}</Notice> : null}
      {data?.scheduleNotice ? <Notice>{data.scheduleNotice}</Notice> : null}
      {data && updatedAt ? (
        <div className="my-1 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-1.5 rounded-full", loadError ? "bg-destructive" : "animate-pulse bg-success")} />
            {loadError ? "เชื่อมต่อไม่สำเร็จ แสดงข้อมูลล่าสุดเมื่อ" : "อัปเดตอัตโนมัติ ล่าสุด"} {fmtClock.format(updatedAt)}
          </span>
          <Button variant="outline" size="xs" className="rounded-full" onClick={reload} disabled={refreshing}>
            {refreshing ? "กำลังโหลด..." : "รีเฟรช"}
          </Button>
        </div>
      ) : null}

      {!data && !loadError ? <SlotSkeleton /> : null}
      {loadError && !data ? <LoadError title="โหลดข้อมูลไม่สำเร็จ" message={loadError} onRetry={reload} /> : null}
      {data && !slots.length ? <StateBox title={t.empty[0]}>{t.empty[1]}</StateBox> : null}

      {slots.length ? (
        <div className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 pt-2 pb-2 backdrop-blur">
          <nav
            ref={stripRef}
            aria-label="เลือกวันที่"
            className="no-scrollbar flex gap-2 overflow-x-auto pb-1"
            onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}
          >
            {groups.map(([k, list]) => {
              const d = parseKey(k);
              const active = k === activeDate;
              return (
                <Button
                  key={k}
                  id={`chip-${k}`}
                  variant={active ? "default" : "outline"}
                  aria-current={active ? "date" : undefined}
                  onClick={() => { document.getElementById(`day-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setActiveDate(k); }}
                  className={cn("relative h-auto min-w-[64px] flex-col gap-0 rounded-xl px-2 py-1.5 leading-tight font-normal", !active && "bg-card")}
                >
                  {selectedDates.has(k) ? <span className="absolute top-1 right-1 size-2 rounded-full bg-brand-glow ring-2 ring-card" /> : null}
                  <span className="text-[11px]">{relLabel(k) || fmtWeekShort.format(d)}</span>
                  <span className="text-lg font-bold">{d.getUTCDate()}</span>
                  <span className="text-[11px]">{fmtMonthShort.format(d)}</span>
                  <span className={cn("text-[10px]", !active && "text-muted-foreground")}>{list.length} slot</span>
                </Button>
              );
            })}
          </nav>
          <div className="mt-2 flex items-center justify-between gap-2">
            {platforms.length > 1 ? (
              <div role="group" aria-label="กรองตามแพลตฟอร์ม" className="no-scrollbar flex gap-1.5 overflow-x-auto">
                {[null, ...platforms].map((p) => (
                  <Toggle
                    key={p ?? "all"}
                    variant="outline"
                    size="sm"
                    pressed={p === null ? filters.size === 0 : filters.has(p)}
                    onPressedChange={() => toggleFilter(p)}
                    className="rounded-full bg-card text-xs font-semibold"
                  >
                    {p ?? "ทั้งหมด"}
                  </Toggle>
                ))}
              </div>
            ) : <span />}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={view}
              onValueChange={(v) => { if (v) changeView(v as "card" | "table"); }}
              aria-label="รูปแบบการแสดงผล"
              className="shrink-0 bg-card"
            >
              <ToggleGroupItem value="card" aria-label="แสดงแบบการ์ด" className="text-xs">
                <LayoutGridIcon /><span className="hidden sm:inline">การ์ด</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="table" aria-label="แสดงแบบตาราง" className="text-xs">
                <Rows3Icon /><span className="hidden sm:inline">ตาราง</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      ) : null}

      {slots.length && !visible.length ? (
        <StateBox title="ไม่มี slot ว่างของแพลตฟอร์มที่เลือก">ลองเลือก &quot;ทั้งหมด&quot; เพื่อดู slot อื่น</StateBox>
      ) : null}

      <main className={barOpen ? "pb-28" : "pb-8"}>
        {groups.map(([k, list]) => (
          <section key={k} id={`day-${k}`} data-date={k} className="scroll-mt-40 pt-5">
            <h2 className="mb-2 flex flex-wrap items-center gap-2 font-bold">
              {fmtDayLong.format(parseKey(k))}
              <DayBadge label={relLabel(k)} />
              <span className="ml-auto text-xs font-medium text-muted-foreground">{t.countLbl} {list.length} slot</span>
            </h2>
            <div className={view === "card" ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "overflow-hidden rounded-xl border bg-card"}>
              {list.map((s) => {
                const isSel = selected.has(s.id);
                const blocked = !isSel && !!blockReason(s);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={isSel}
                    aria-label={`${platformOf(s)} ${s.start} ถึง ${s.end}`}
                    onClick={() => toggle(s)}
                    className={cn(
                      "flex w-full items-center gap-3 text-left transition outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      view === "card"
                        ? cn("rounded-xl border bg-card px-4 py-3 shadow-card", isSel ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50")
                        : cn("border-b px-3 py-2.5 last:border-b-0", isSel ? "bg-secondary" : "hover:bg-muted"),
                      blocked && "opacity-45",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold tabular-nums">{s.start} – {s.end}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <PlatformBadge name={platformOf(s)} index={platformIndex[platformOf(s)]} />
                        <span>{fmtHours(hoursOf(s))}</span>
                        {role === "admin" && s.pairName ? <span className="font-medium text-foreground">{s.pairName}</span> : null}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full border-2 [&_svg]:size-3.5",
                        isSel ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
                      )}
                    >
                      <CheckIcon strokeWidth={3} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      <div
        aria-hidden={!barOpen}
        inert={!barOpen}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur transition-transform duration-200",
          barOpen ? "slot-bar-open translate-y-0" : "translate-y-full",
        )}
      >
        <div className="mx-auto flex max-w-[760px] items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-bold">เลือกแล้ว {selected.size} slot</div>
            <div className="text-sm text-muted-foreground">รวม {fmtHours(totalHours)}</div>
          </div>
          <Button variant="outline" size="lg" className="rounded-full px-4" onClick={() => setSelected(new Map())}>ล้าง</Button>
          <Button size="lg" className="rounded-full px-4" onClick={() => setDialog("confirm")}>{t.verb} {selected.size} slot</Button>
        </div>
      </div>

      <AppDialog open={dialog !== "closed"} onClose={closeDialog} busy={dialog === "busy"} title={dlgTitle} description={dlgNote}>
        <DialogBody>
          <ul>
            {(results && !lostResponse ? results.map((r) => ({ r, s: slots.find((x) => x.id === r.id) })) : sorted.map((s) => ({ s, r: resultById.get(s.id) })))
              .map(({ s, r }, i) => (
                <li key={s?.id ?? i} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0">
                  <div>
                    <div className="font-semibold tabular-nums">{s ? `${s.start} – ${s.end}` : "slot"}</div>
                    {s ? <div className="text-xs text-muted-foreground">{fmtDayShort.format(parseKey(s.date))} | {platformOf(s)}</div> : null}
                  </div>
                  <div className={cn("text-right text-sm", r ? (r.success ? "font-semibold text-success" : "text-destructive") : "text-muted-foreground")}>
                    {r ? (r.success ? t.done : r.message) : s ? fmtHours(hoursOf(s)) : ""}
                  </div>
                </li>
              ))}
          </ul>
        </DialogBody>
        <DialogActions>
          {dialog === "done" ? (
            <Button size="lg" onClick={closeDialog}>เสร็จสิ้น</Button>
          ) : (
            <>
              <Button variant="outline" size="lg" disabled={dialog === "busy"} onClick={closeDialog}>ยกเลิก</Button>
              <Button size="lg" disabled={dialog === "busy"} onClick={submit}>
                {dialog === "busy" ? `กำลัง${t.verb}...` : `ยืนยันการ${t.verb}`}
              </Button>
            </>
          )}
        </DialogActions>
      </AppDialog>
    </>
  );
}

function SlotSkeleton() {
  return (
    <div aria-label="กำลังโหลด slot ที่ว่าง" className="py-4">
      <Skeleton className="mb-3 h-5 w-40" />
      {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="mb-2 h-16 rounded-xl" />)}
    </div>
  );
}
