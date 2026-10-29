"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, EyeIcon, LayoutGridIcon, Rows3Icon } from "lucide-react";
import type { ActionResult, BookingLimits, Me, OpenSlot, SlotsResponse } from "@/lib/types";
import {
  fmtDayLong, fmtDayShort, fmtHours, fmtMonthShort, fmtWeekShort, hoursOf, monthLabel, parseKey, platformOf, relLabel,
} from "@/lib/format";
import { quotaBlock, type MyQuota } from "@/lib/mc-quota";
import {
  AppDialog, DayBadge, DialogActions, DialogBody, LoadError, Notice, NoticeStrip, PlatformBadge, StateBox, api, useToast,
} from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PAGE_KEY, useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { CalendarGuideDialog } from "@/components/CalendarGuide";
import { SlotCalendar } from "@/components/SlotCalendar";

// ค่าสำรองเมื่อเซิร์ฟเวอร์ไม่ได้ส่งโควต้ามา (ปกติใช้ค่าจาก settings ใน DB และฝั่ง server เช็คซ้ำอีกชั้นเสมอ)
// ช่วง (blocks) = slot ที่ต่อกัน เช่น 09:30–11:30 + 11:30–13:30 นับเป็น 1 ช่วง
const DEFAULT_LIMITS: Record<"mc" | "admin", BookingLimits> = {
  mc: { slotsPerDay: 2, hoursPerDay: 4, blocksPerDay: null, perRequest: 10 },
  admin: { slotsPerDay: 4, hoursPerDay: 8, blocksPerDay: 2, perRequest: 10 },
};
type Span = { startMs: number; endMs: number };
const spanHours = (s: Span) => (s.endMs - s.startMs) / 3600_000;

/** จำนวนช่วงเวลาต่อเนื่อง (slot ที่เวลาจบ = เวลาเริ่มของอีก slot นับเป็นช่วงเดียวกัน) */
function blocksOf(list: Span[]) {
  const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
  return sorted.filter((x, i) => i === 0 || sorted[i - 1].endMs !== x.startMs).length;
}
/** "25 นาที" / "1 ชม. 5 นาที" */
const durText = (ms: number) => {
  const m = Math.max(1, Math.floor(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} ชม.${m % 60 ? ` ${m % 60} นาที` : ""}` : `${m} นาที`;
};
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
  // แชร์ปฏิทิน: คู่มือ + ปุ่ม "แชร์แล้ว เช็กเลย"
  const [guideOpen, setGuideOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  // วันที่จองครบโควต้าแล้ว: แถว slot พับไว้ กดเพื่อดู
  const [openFull, setOpenFull] = useState<Set<string>>(new Set());

  async function checkCalendar() {
    setChecking(true);
    try {
      const res = await api<{ access: string; message: string }>("/api/my/calendar", { role });
      if (!res.ok) throw new Error(res.message);
      const fine = res.access === "ok" || res.access === "skip";
      toast(res.message, fine ? undefined : "error");
      if (fine) { setGuideOpen(false); setTick((n) => n + 1); }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setChecking(false);
    }
  }

  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(0);
  const pickedRef = useRef(picked);
  const dialogRef = useRef(dialog);
  useEffect(() => { pickedRef.current = picked; dialogRef.current = dialog; }, [picked, dialog]);

  // โหลดครั้งแรกของหน้า: ให้ระบบเช็กว่าแชร์ปฏิทินแล้วหรือยัง (แชร์แล้วลงคิวที่ค้างให้เอง) รอบรีเฟรชอัตโนมัติไม่ต้องเช็ก
  const firstLoad = useRef(true);
  useEffect(() => {
    let alive = true;
    const check = firstLoad.current && !preview ? "&check=1" : "";
    firstLoad.current = false;
    api<SlotsResponse>(`/api/slots?role=${role}${check}`)
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
  }, [role, tick, toast, t.verb, preview]);

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
  const limits = data?.limits ?? DEFAULT_LIMITS[role];
  // สิทธิ์จองต่อเดือนตามแร็งค์ (Mc · ไม่ส่งมา = ไม่จำกัด)
  const quotaByMonth = useMemo(() => new Map((data?.quota ?? []).map((q) => [q.month, q])), [data]);
  // คิวที่จองไว้แล้ว (นับรวมโควต้าต่อวัน + เวลาทับ) แยกตามวัน
  const mineByDay = useMemo(() => {
    const m = new Map<string, Span[]>();
    for (const x of data?.mine ?? []) m.set(x.date, [...(m.get(x.date) ?? []), x]);
    return m;
  }, [data]);

  // สีประจำแพลตฟอร์ม ตามลำดับที่เจอ
  const platformIndex = useMemo(() => {
    const idx: Record<string, number> = {};
    for (const s of slots) { const p = platformOf(s); if (!(p in idx)) idx[p] = Object.keys(idx).length % 4; }
    return idx;
  }, [slots]);
  const platforms = Object.keys(platformIndex);
  // ตัวกรองที่ยังใช้ได้: แพลตฟอร์มที่เลือกไว้แต่ไม่มี slot แล้ว (มีคนจองหมด / ทีมงานลบ) ล้างออกเอง ไม่ค้างจนหน้าว่าง
  const activeFilters = useMemo(
    () => new Set(platforms.length > 1 ? [...filters].filter((p) => p in platformIndex) : []),
    [filters, platformIndex, platforms.length],
  );

  const visible = useMemo(
    () => slots.filter((s) => activeFilters.size === 0 || activeFilters.has(platformOf(s))),
    [slots, activeFilters],
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

  /** เกินโควต้าต่อวันไหม (sameDay = คิวของวันนั้นที่นับแล้ว) "" = ยังไม่เกิน */
  function quotaReason(s: OpenSlot, sameDay: Span[]) {
    if (sameDay.length >= limits.slotsPerDay) return `${role === "admin" ? "รับ" : "จอง"}ได้สูงสุด ${limits.slotsPerDay} slot ต่อวัน`;
    if (sameDay.reduce((a, x) => a + spanHours(x), 0) + spanHours(s) > limits.hoursPerDay) return `รวมแล้วเกิน ${limits.hoursPerDay} ชม. ต่อวัน`;
    if (limits.blocksPerDay && blocksOf([...sameDay, s]) > limits.blocksPerDay) {
      return `แบ่งได้ไม่เกิน ${limits.blocksPerDay} ช่วงต่อวัน เลือก slot ที่ต่อกับช่วงเดิม`;
    }
    return "";
  }

  /**
   * เหตุผลที่เลือก slot นี้ไม่ได้ ("" = เลือกได้) นับทั้ง slot ที่เลือกอยู่และคิวที่จองไว้แล้วของวันนั้น
   *   full = ข้อความเต็ม (แจ้งตอนกด) / short = ใต้แถว (หัววันบอก "มีคิวแล้ว N" อยู่แล้ว ไม่ต้องซ้ำทุกแถว)
   */
  function blockReason(s: OpenSlot): { full: string; short: string } {
    const same = (x: string) => ({ full: x, short: x });
    if (isLocked) return same(t.lockMsg);
    if (data?.training) return same(`ดูคลิปเทรนนิ่งที่บังคับให้ครบก่อน (${data.training.done}/${data.training.total})`);
    const chosen = [...selected.values()];
    const booked = mineByDay.get(s.date) ?? [];
    const hit = (x: Span) => s.startMs < x.endMs && s.endMs > x.startMs;
    // ทับกับคิวเดิม (ดูทุกวัน เผื่อ slot ข้ามเที่ยงคืน)
    if ((data?.mine ?? []).some(hit)) return same(`เวลานี้ทับกับคิวที่คุณ${t.verb}ไว้แล้ว`);
    if (chosen.some(hit)) return same("เวลานี้ทับกับ slot ที่เลือกไว้แล้ว");
    if (chosen.length >= limits.perRequest) return same(`เลือกได้ครั้งละไม่เกิน ${limits.perRequest} slot`);
    const month = s.date.slice(0, 7);
    const mq = quotaBlock(quotaByMonth.get(month), chosen.filter((x) => x.date.slice(0, 7) === month).length);
    if (mq) return same(mq);
    const q = quotaReason(s, [...chosen.filter((x) => x.date === s.date), ...booked]);
    if (!q) return same("");
    return { full: `${q}${booked.length ? ` (คุณมีคิววันนี้แล้ว ${booked.length} slot)` : ""}`, short: q };
  }

  /** วันที่คิวที่จองไว้แล้วเต็มโควต้า (ทุก slot ของวันนั้นเลือกไม่ได้เพราะโควต้า) -> เหตุผล บอกครั้งเดียวที่หัววัน + พับแถว */
  const fullDays = new Map<string, string>();
  if (!isLocked && !preview) {
    for (const [k, list] of groups) {
      // ครบสิทธิ์จองของเดือนนั้นแล้ว = ทั้งวันเลือกไม่ได้
      const mq = quotaBlock(quotaByMonth.get(k.slice(0, 7)), 0);
      if (mq) { fullDays.set(k, mq); continue; }
      const booked = mineByDay.get(k) ?? [];
      if (!booked.length) continue;
      const reasons = list.map((s) => quotaReason(s, booked));
      if (reasons.every(Boolean)) fullDays.set(k, `${reasons[0]} (คุณมีคิวในวันนั้นแล้ว ${booked.length} slot)`);
    }
  }

  // เวลาอ้างอิง = ตอนโหลดล่าสุด (โหลดใหม่ทุก 15 วินาที) ใช้ป้าย "ใกล้เริ่ม" / "เริ่มไปแล้ว"
  const now = updatedAt;
  const cancelH = data?.cancelMinHours ?? 6;
  /** ป้ายเวลา: เริ่มไปแล้ว (ยังไม่จบ = ยังจองได้ มาช่วยกลางไลฟ์) / ใกล้เริ่ม (จองแล้วยกเลิกผ่านเว็บไม่ได้) */
  const timeTag = (s: OpenSlot): { text: string; started: boolean } | null => {
    if (!now) return null;
    if (s.startMs <= now && now < s.endMs) return { text: `เริ่มไปแล้ว ${durText(now - s.startMs)}`, started: true };
    const left = s.startMs - now;
    if (left > 0 && left <= cancelH * 3600_000) return { text: `ใกล้เริ่ม · อีก ${durText(left)}`, started: false };
    return null;
  };

  function toggle(s: OpenSlot) {
    if (preview) { toast("โหมดดูอย่างเดียว (เจ้าของ) จองแทนไม่ได้"); return; }
    if (selected.has(s.id)) {
      const next = new Map(selected);
      next.delete(s.id);
      setSelected(next);
      return;
    }
    const reason = blockReason(s).full;
    if (reason) { toast(reason, "error"); return; }
    setSelected(new Map(selected).set(s.id, s));
  }

  function toggleFilter(p: string | null) {
    const next = new Set(activeFilters);
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

  function openConfirm() {
    setResults(null);
    setLostResponse(false);
    setDialog("confirm");
  }

  function closeDialog() {
    const wasDone = dialog === "done";
    setDialog("closed");
    // ผลการจองเก็บไว้จนเปิดหน้าต่างครั้งถัดไป: ระหว่างหน้าต่างค่อยๆ ปิด หัวข้อไม่แวบเป็น "ยืนยันการจอง 0 slot"
    if (wasDone) {
      setSelected(new Map());
      reload();
    }
  }

  const okCount = results?.filter((r) => r.success).length ?? 0;
  const showDone = dialog === "done" || (dialog === "closed" && (results !== null || lostResponse));
  // slot ที่เลือกซึ่งใกล้เริ่ม / เริ่มไปแล้ว: จองแล้วยกเลิกผ่านเว็บไม่ได้
  const lateCount = sorted.filter((s) => timeTag(s)).length;
  const dlgTitle = showDone
    ? lostResponse
      ? "ไม่ได้รับคำตอบจากระบบ"
      : okCount === results!.length ? `${t.verb}สำเร็จ ${okCount} slot`
        : okCount === 0 ? `${t.verb}ไม่สำเร็จ` : `${t.verb}สำเร็จ ${okCount} จาก ${results!.length} slot`
    : `ยืนยันการ${t.verb} ${selected.size} slot`;
  const dlgNote = showDone
    ? lostResponse
      ? `การ${t.verb}อาจสำเร็จแล้ว กด "เสร็จสิ้น" เพื่อโหลดรายการใหม่ ถ้า slot หายไปจากรายการแปลว่าสำเร็จ`
      : okCount > 0 ? t.doneNote : "ดูเหตุผลด้านล่าง แล้วเลือก slot อื่น"
    : (
      <>
        <span className="block">
          {role === "admin"
            ? `รับคิวในชื่อ ${me.admin?.name} ระบบจะใส่ชื่อและเบอร์โทรในปฏิทินของ Mc ให้`
            : `จองในนาม Mc ${me.mc?.name} ระบบจะลงปฏิทินให้อัตโนมัติ`}
        </span>
        {/* ย้ำกฎยกเลิก (ค่าเดียวกับที่ระบบใช้ตอนกดยกเลิก) */}
        <span className="mt-1 block font-semibold text-foreground">
          ยกเลิกผ่านเว็บได้ก่อนไลฟ์อย่างน้อย {cancelH} ชม. เท่านั้น
          {lateCount ? ` — ${lateCount} slot ที่เลือกใกล้เริ่ม / เริ่มไปแล้ว จองแล้วยกเลิกผ่านเว็บไม่ได้ ต้องติดต่อแอดมิน` : " หลังจากนั้นต้องติดต่อแอดมิน"}
        </span>
      </>
    );
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
      {/* ป้ายแจ้งแบบแถบเล็ก (มือถือ: รายละเอียดกดดูได้) จอแรกจะได้เห็น slot */}
      {data?.scheduleNotice ? <NoticeStrip title={<span className="font-medium">{data.scheduleNotice}</span>} /> : null}
      {!preview && data?.calendarMissing ? (
        <NoticeStrip
          variant="warning" title={`คิว ${data.calendarMissing} คิวยังไม่ขึ้น Google Calendar`}
          action={(
            <>
              <Button size="xs" variant="outline" className="bg-card" onClick={() => setGuideOpen(true)}>วิธีแชร์</Button>
              <Button size="xs" disabled={checking} onClick={checkCalendar}>{checking ? "กำลังเช็ก..." : "แชร์แล้ว เช็กเลย"}</Button>
            </>
          )}
        >
          แชร์ปฏิทินให้ระบบครั้งเดียว ต่อไปทุกคิวที่จอง / ยกเลิก จะขึ้นในปฏิทินของคุณเองภายใน 1–2 นาที (กด &quot;วิธีแชร์&quot; มีรูปประกอบ)
        </NoticeStrip>
      ) : null}
      <CalendarGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} onCheck={checkCalendar} checking={checking} />
      {!preview && data?.training ? (
        <NoticeStrip
          variant="warning" title={`ดูคลิปเทรนนิ่งที่บังคับให้ครบก่อน${t.verb} (ดูแล้ว ${data.training.done}/${data.training.total})`}
          action={<Button size="xs" onClick={() => writeLocal(PAGE_KEY, "training")} className="pointer-coarse:h-8 pointer-coarse:px-3">ไปดูคลิป</Button>}
        >
          ยังไม่ได้ดู: {data.training.missing.slice(0, 5).join(" · ")}{data.training.missing.length > 5 ? ` และอีก ${data.training.missing.length - 5} คลิป` : ""}
          {" "}— ดูจนจบในหน้าเทรนนิ่ง ระบบนับให้อัตโนมัติ ครบแล้วกลับมา{t.verb}ได้เลย
        </NoticeStrip>
      ) : null}
      {data && slots.length ? (
        <p className="my-1 text-xs text-muted-foreground">
          {role === "admin" ? "รับคิว" : "จอง"}ได้ไม่เกิน {limits.slotsPerDay} slot และ {limits.hoursPerDay} ชม. ต่อวัน
          {limits.blocksPerDay ? ` · แบ่งได้ไม่เกิน ${limits.blocksPerDay} ช่วงต่อวัน` : ""} (นับรวมคิวที่มีอยู่แล้ว)
          {role === "admin" ? " · เวลาห้ามทับกันแม้คนละแพลตฟอร์ม" : ""}
        </p>
      ) : null}
      {data?.quota?.length && slots.length ? <QuotaStrip quota={data.quota} picked={sorted} /> : null}
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
          {/* แถบเลื่อนวัน (เฉพาะวันที่มี slot) + ปุ่มปฏิทินดูทั้งเดือน (อยู่กับที่ ไม่เลื่อนตามแถบ) */}
          <div className="flex gap-2">
          <nav
            ref={stripRef}
            aria-label="เลือกวันที่"
            className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1"
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
                  <span className={cn("text-[10px]", !active && (fullDays.has(k) ? "font-semibold text-destructive" : "text-muted-foreground"))}>
                    {fullDays.has(k) ? "ครบแล้ว" : `${list.length} slot`}
                  </span>
                </Button>
              );
            })}
          </nav>
          <SlotCalendar
            counts={new Map(groups.map(([k, list]) => [k, list.length]))}
            full={new Set(fullDays.keys())}
            picked={selectedDates}
            active={activeDate}
            onPick={(k) => { document.getElementById(`day-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setActiveDate(k); }}
          />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            {platforms.length > 1 ? (
              <div role="group" aria-label="กรองตามแพลตฟอร์ม" className="no-scrollbar flex gap-1.5 overflow-x-auto">
                {[null, ...platforms].map((p) => (
                  <Toggle
                    key={p ?? "all"}
                    variant="outline"
                    size="sm"
                    pressed={p === null ? activeFilters.size === 0 : activeFilters.has(p)}
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
        {groups.map(([k, list]) => {
          const full = fullDays.get(k);
          const folded = !!full && !openFull.has(k);
          return (
          <section key={k} id={`day-${k}`} data-date={k} className="scroll-mt-40 pt-5">
            <h2 className="mb-2 flex flex-wrap items-center gap-2 font-bold">
              {/* มือถือ: วันที่แบบสั้น (แถบเลือกวันด้านบนบอกวันอยู่แล้ว) ป้ายกับจำนวน slot จะได้อยู่บรรทัดเดียวกัน */}
              <span className="sm:hidden">{fmtDayShort.format(parseKey(k))}</span>
              <span className="hidden sm:inline">{fmtDayLong.format(parseKey(k))}</span>
              <DayBadge label={relLabel(k)} />
              {mineByDay.get(k)?.length ? (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  <span className="sm:hidden">มีคิวแล้ว {mineByDay.get(k)!.length}</span>
                  <span className="hidden sm:inline">คุณมีคิวแล้ว {mineByDay.get(k)!.length} slot</span>
                </span>
              ) : null}
              <span className="ml-auto text-xs font-medium text-muted-foreground">{t.countLbl} {list.length} slot</span>
            </h2>
            {/* จองครบโควต้าของวันนี้แล้ว: บอกครั้งเดียวที่หัววัน แล้วพับแถว (กดดูได้) */}
            {full ? (
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1"><b className="text-foreground">{t.verb}ครบโควต้าแล้ว</b> — {full}</span>
                <Button
                  variant="link" size="xs" className="h-auto px-0"
                  onClick={() => setOpenFull((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                >
                  {folded ? `ดู ${list.length} slot` : "ซ่อน"}
                </Button>
              </div>
            ) : null}
            <div className={cn(view === "card" ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "overflow-hidden rounded-xl border bg-card", folded && "hidden")}>
              {list.map((s) => {
                const isSel = selected.has(s.id);
                const reason = isSel || preview ? "" : blockReason(s).short;
                const blocked = !!reason;
                const tag = timeTag(s);
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
                      blocked && "opacity-60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold tabular-nums">{s.start} – {s.end}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <PlatformBadge name={platformOf(s)} index={platformIndex[platformOf(s)]} />
                        <span>{fmtHours(hoursOf(s))}</span>
                        {role === "admin" && s.pairName ? <span className="font-medium text-foreground">{s.pairName}</span> : null}
                        {tag ? <TimeTag {...tag} /> : null}
                      </span>
                      {/* บอกเหตุผลที่เลือกไม่ได้เลย ไม่ต้องกดก่อนถึงรู้ (วันที่ครบโควต้าบอกที่หัววันแล้ว) */}
                      {blocked && !isLocked && !full ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{reason}</span> : null}
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
          );
        })}
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
          <Button size="lg" className="rounded-full px-4" onClick={openConfirm}>{t.verb} {selected.size} slot</Button>
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
                    {s ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {fmtDayShort.format(parseKey(s.date))} | {platformOf(s)}
                        {!r && timeTag(s) ? <TimeTag {...timeTag(s)!} /> : null}
                      </div>
                    ) : null}
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

/** สิทธิ์จองต่อเดือนตามแร็งค์ผลงานเดือนก่อน: จองแล้ว / เลือกอยู่ / สิทธิ์ทั้งหมด */
function QuotaStrip({ quota, picked }: { quota: MyQuota[]; picked: OpenSlot[] }) {
  return (
    <div className="my-1 flex flex-wrap gap-1.5 text-xs">
      {quota.map((q) => {
        const chosen = picked.filter((s) => s.date.slice(0, 7) === q.month).length;
        const left = Math.max(0, q.max - q.used - chosen);
        return (
          <span
            key={q.month}
            className={cn("rounded-full border px-2.5 py-1", left ? "bg-card" : "border-destructive/40 bg-destructive/10 text-destructive")}
            title={q.settled ? "คิดจากผลงานเดือนก่อน" : "ชั่วคราว: คิดจากผลงานเดือนก่อนถึงตอนนี้ อาจเปลี่ยนได้จนจบเดือน"}
          >
            สิทธิ์จอง{monthLabel(q.month)}
            {q.tier ? ` (แร็งค์ ${q.tier})` : ""}: <b className="tabular-nums">{q.used + chosen}/{q.max}</b> slot
            {chosen ? ` · เลือกอยู่ ${chosen}` : ""} · {left ? `เหลือ ${left}` : "ครบแล้ว"}
            {!q.settled ? <span className="text-muted-foreground"> · ชั่วคราว</span> : null}
          </span>
        );
      })}
    </div>
  );
}

/** ป้ายเวลา: เริ่มไปแล้ว (แดง) / ใกล้เริ่ม (ส้ม) */
function TimeTag({ text, started }: { text: string; started: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
        started ? "bg-destructive/10 text-destructive" : "border border-warning-border bg-warning text-warning-foreground",
      )}
    >
      {text}
    </span>
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
