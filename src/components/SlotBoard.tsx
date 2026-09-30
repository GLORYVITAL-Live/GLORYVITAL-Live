"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionResult, Me, OpenSlot, SlotsResponse } from "@/lib/types";
import {
  fmtDayLong, fmtDayShort, fmtHours, fmtMonthShort, fmtWeekShort, hoursOf, parseKey, platformOf, relLabel,
} from "@/lib/format";
import { Icon, Sheet, SheetHead, StateBox, Tag, api, btn, useLocal, useToast, writeLocal } from "@/components/ui";

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

export function SlotBoard({ me, role }: { me: Me; role: "mc" | "admin" }) {
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

      {data?.siteNotice ? (
        <div role="status" className="my-2 rounded-xl border border-warn-line bg-warn-bg px-3 py-2.5 text-sm font-medium text-warn-ink">
          ⚠️ {data.siteNotice}
        </div>
      ) : null}
      {data?.scheduleNotice ? (
        <div className="my-2 rounded-xl bg-info-bg px-3 py-2.5 text-sm text-info-ink">{data.scheduleNotice}</div>
      ) : null}
      {data && updatedAt ? (
        <div className="my-1 flex items-center justify-end gap-2 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={`size-1.5 rounded-full ${loadError ? "bg-err" : "animate-pulse bg-ok"}`} />
            {loadError ? "เชื่อมต่อไม่สำเร็จ แสดงข้อมูลล่าสุดเมื่อ" : "อัปเดตอัตโนมัติ ล่าสุด"} {fmtClock.format(updatedAt)}
          </span>
          <button
            type="button"
            onClick={reload}
            disabled={refreshing}
            className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-medium text-ink hover:border-accent disabled:opacity-50"
          >
            {refreshing ? "กำลังโหลด..." : "รีเฟรช"}
          </button>
        </div>
      ) : null}

      {!data && !loadError ? <Skeleton /> : null}
      {loadError && !data ? (
        <StateBox title="โหลดข้อมูลไม่สำเร็จ">
          {loadError}
          <br />
          <button type="button" className={`${btn.ghost} mt-3`} onClick={reload}>ลองอีกครั้ง</button>
        </StateBox>
      ) : null}
      {data && !slots.length ? <StateBox title={t.empty[0]}>{t.empty[1]}</StateBox> : null}

      {slots.length ? (
        <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-bg/95 px-4 pt-2 pb-2 backdrop-blur">
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
                <button
                  key={k}
                  id={`chip-${k}`}
                  type="button"
                  onClick={() => { document.getElementById(`day-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setActiveDate(k); }}
                  className={`relative flex min-w-[64px] shrink-0 flex-col items-center rounded-xl border px-2 py-1.5 leading-tight transition ${
                    active ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface hover:border-accent"
                  }`}
                >
                  {selectedDates.has(k) ? <span className="absolute top-1 right-1 size-2 rounded-full bg-accent ring-2 ring-surface" /> : null}
                  <span className="text-[11px]">{relLabel(k) || fmtWeekShort.format(d)}</span>
                  <span className="text-lg font-bold">{d.getUTCDate()}</span>
                  <span className="text-[11px]">{fmtMonthShort.format(d)}</span>
                  <span className={`text-[10px] ${active ? "" : "text-muted"}`}>{list.length} slot</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-2 flex items-center justify-between gap-2">
            {platforms.length > 1 ? (
              <div role="group" aria-label="กรองตามแพลตฟอร์ม" className="no-scrollbar flex gap-1.5 overflow-x-auto">
                {[null, ...platforms].map((p) => {
                  const pressed = p === null ? filters.size === 0 : filters.has(p);
                  return (
                    <button
                      key={p ?? "all"}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => toggleFilter(p)}
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        pressed ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-muted hover:border-accent"
                      }`}
                    >
                      {p ?? "ทั้งหมด"}
                    </button>
                  );
                })}
              </div>
            ) : <span />}
            <div role="group" aria-label="รูปแบบการแสดงผล" className="flex shrink-0 rounded-full border border-line bg-surface p-0.5">
              {(["card", "table"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  aria-label={v === "card" ? "แสดงแบบการ์ด" : "แสดงแบบตาราง"}
                  onClick={() => changeView(v)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium [&_svg]:size-3.5 ${
                    view === v ? "bg-brand-soft text-brand" : "text-muted"
                  }`}
                >
                  {v === "card" ? <Icon.grid /> : <Icon.rows />}
                  <span className="hidden sm:inline">{v === "card" ? "การ์ด" : "ตาราง"}</span>
                </button>
              ))}
            </div>
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
              {relLabel(k) ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-brand-ink">{relLabel(k)}</span> : null}
              <span className="ml-auto text-xs font-medium text-muted">{t.countLbl} {list.length} slot</span>
            </h2>
            <div className={view === "card" ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "overflow-hidden rounded-xl border border-line bg-surface"}>
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
                    className={`flex w-full items-center gap-3 text-left transition ${
                      view === "card"
                        ? `rounded-xl border bg-surface px-4 py-3 shadow-card ${isSel ? "border-brand ring-2 ring-brand/30" : "border-line hover:border-accent"}`
                        : `border-b border-line px-3 py-2.5 last:border-b-0 ${isSel ? "bg-brand-soft" : "hover:bg-bg"}`
                    } ${blocked ? "opacity-45" : ""}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold tabular-nums">{s.start} – {s.end}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <Tag name={platformOf(s)} index={platformIndex[platformOf(s)]} />
                        <span>{fmtHours(hoursOf(s))}</span>
                        {role === "admin" && s.pairName ? <span className="font-medium text-ink">{s.pairName}</span> : null}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={`grid size-6 shrink-0 place-items-center rounded-full border-2 [&_svg]:size-3.5 ${
                        isSel ? "border-brand bg-brand text-brand-ink" : "border-line text-transparent"
                      }`}
                    >
                      <Icon.check />
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
        className={`${barOpen ? "slot-bar-open translate-y-0" : "translate-y-full"} fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur transition-transform duration-200`}
      >
        <div className="mx-auto flex max-w-[760px] items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-bold">เลือกแล้ว {selected.size} slot</div>
            <div className="text-sm text-muted">รวม {fmtHours(totalHours)}</div>
          </div>
          <button type="button" className={btn.ghost} onClick={() => setSelected(new Map())}>ล้าง</button>
          <button type="button" className={btn.primary} onClick={() => setDialog("confirm")}>{t.verb} {selected.size} slot</button>
        </div>
      </div>

      <Sheet open={dialog !== "closed"} onClose={closeDialog} busy={dialog === "busy"} labelledBy="dlgTitle">
        <SheetHead id="dlgTitle" title={dlgTitle} note={dlgNote} />
        <ul className="-mx-1 flex-1 overflow-y-auto px-1">
          {(results && !lostResponse ? results.map((r) => ({ r, s: slots.find((x) => x.id === r.id) })) : sorted.map((s) => ({ s, r: resultById.get(s.id) })))
            .map(({ s, r }, i) => (
              <li key={s?.id ?? i} className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
                <div>
                  <div className="font-semibold tabular-nums">{s ? `${s.start} – ${s.end}` : "slot"}</div>
                  {s ? <div className="text-xs text-muted">{fmtDayShort.format(parseKey(s.date))} | {platformOf(s)}</div> : null}
                </div>
                <div className={`text-right text-sm ${r ? (r.success ? "font-semibold text-ok" : "text-err") : "text-muted"}`}>
                  {r ? (r.success ? t.done : r.message) : s ? fmtHours(hoursOf(s)) : ""}
                </div>
              </li>
            ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          {dialog === "done" ? (
            <button type="button" className={btn.primary} onClick={closeDialog}>เสร็จสิ้น</button>
          ) : (
            <>
              <button type="button" className={btn.ghost} disabled={dialog === "busy"} onClick={closeDialog}>ยกเลิก</button>
              <button type="button" className={btn.primary} disabled={dialog === "busy"} onClick={submit}>
                {dialog === "busy" ? `กำลัง${t.verb}...` : `ยืนยันการ${t.verb}`}
              </button>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

function Skeleton() {
  return (
    <div aria-label="กำลังโหลด slot ที่ว่าง" className="animate-pulse py-4">
      <div className="mb-3 h-5 w-40 rounded bg-line" />
      {Array.from({ length: 4 }, (_, i) => <div key={i} className="mb-2 h-16 rounded-xl bg-line/70" />)}
    </div>
  );
}
