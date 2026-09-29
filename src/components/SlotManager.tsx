"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtDayLong, fmtWeekShort, parseKey, relLabel, todayKey } from "@/lib/format";
import { Icon, IconBtn, Sheet, SheetHead, StateBox, Tag, api, btn, useToast } from "@/components/ui";

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

const addDays = (k: string, n: number) => new Date(parseKey(k).getTime() + n * 86400_000).toISOString().slice(0, 10);

/** หน้าจัดการ slot สำหรับเจ้าของ: ดูรายวัน / เพิ่ม / กำหนดคน / เปลี่ยนสถานะ / ลบ */
export function SlotManager() {
  const toast = useToast();
  const [date, setDate] = useState(() => todayKey());
  const [data, setData] = useState<DayData | null>(null);
  const [failed, setFailed] = useState<{ date: string; message: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // key ของ slot ที่กำลังบันทึก
  const [createOpen, setCreateOpen] = useState(false);
  const reload = () => setTick((n) => n + 1);
  const [syncing, setSyncing] = useState(false);

  async function syncFromSheet() {
    setSyncing(true);
    try {
      type Stat = { updated: number; created: number };
      const res = await api<{ mc: Stat; admin: Stat }>("/api/owner/sync-sheet", {});
      if (!res.ok) throw new Error(res.message);
      const changed = res.mc.updated + res.admin.updated, created = res.mc.created + res.admin.created;
      toast(changed || created ? `ซิงค์แล้ว: แก้ ${changed} slot, เพิ่มใหม่ ${created} slot` : "ข้อมูลในเว็บตรงกับชีตแล้ว");
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
    if (!confirm(`ลบ slot ${slot.platform} ${slot.start}–${slot.end} ?`)) return;
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

  const counts = day ? {
    total: day.slots.length,
    mcOpen: day.slots.filter((s) => s.mc && !s.mc.personId).length,
    adminOpen: day.slots.filter((s) => s.admin?.extra && !s.admin.personId).length,
  } : null;

  return (
    <div className="pb-10">
      <div className="my-2 flex flex-wrap items-center gap-2">
        <IconBtn label="วันก่อนหน้า" onClick={() => setDate(addDays(date, -1))}><Icon.left /></IconBtn>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="เลือกวันที่"
          className="h-9 rounded-full border border-line bg-surface px-3 text-sm"
        />
        <IconBtn label="วันถัดไป" onClick={() => setDate(addDays(date, 1))}><Icon.right /></IconBtn>
        <button type="button" className={`${btn.ghost} !py-1.5`} onClick={() => setDate(todayKey())}>วันนี้</button>
        <div className="ml-auto flex gap-2">
          <button type="button" className={btn.ghost} disabled={syncing} onClick={syncFromSheet} title="อ่านทุกแถวในชีตมาอัปเดตเว็บ (ใช้เมื่อแก้ในชีตแล้วเว็บไม่เปลี่ยน)">
            {syncing ? "กำลังซิงค์..." : "ซิงค์จากชีตทั้งหมด"}
          </button>
          <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)}>+ เพิ่ม slot</button>
        </div>
      </div>

      <h2 className="mt-3 flex flex-wrap items-center gap-2 font-bold">
        {fmtDayLong.format(parseKey(date))}
        {relLabel(date) ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-brand-ink">{relLabel(date)}</span> : null}
        {counts ? (
          <span className="ml-auto text-xs font-medium text-muted">
            {counts.total} slot · Mc ว่าง {counts.mcOpen} · รอ Admin เสริม {counts.adminOpen}
          </span>
        ) : null}
      </h2>

      {error && !day ? (
        <StateBox title="โหลดข้อมูลไม่สำเร็จ">
          {error}
          <br />
          <button type="button" className={`${btn.ghost} mt-3`} onClick={reload}>ลองอีกครั้ง</button>
        </StateBox>
      ) : !day ? (
        <div className="my-4 h-40 animate-pulse rounded-2xl bg-line/70" />
      ) : !day.slots.length ? (
        <StateBox title="วันนี้ยังไม่มี slot">กด &quot;+ เพิ่ม slot&quot; เพื่อสร้าง slot ใหม่</StateBox>
      ) : (
        <div className="mt-2 space-y-2">
          {day.slots.map((s) => (
            <SlotRow
              key={s.key}
              slot={s}
              staff={day.staff}
              tagIndex={platformIndex[s.platform] ?? 0}
              busy={busy === s.key}
              onPatch={(table, id, change) => patch(s, table, id, change)}
              onDelete={() => remove(s)}
            />
          ))}
        </div>
      )}

      {createOpen ? (
        <CreateDialog
          defaultDate={date}
          platforms={day?.platforms ?? []}
          onClose={(created) => { setCreateOpen(false); if (created) reload(); }}
        />
      ) : null}
    </div>
  );
}

const selectCls = "h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm disabled:opacity-60";

function SlotRow({ slot, staff, tagIndex, busy, onPatch, onDelete }: {
  slot: Slot;
  staff: DayData["staff"];
  tagIndex: number;
  busy: boolean;
  onPatch: (table: "mc_slots" | "admin_slots", id: number, change: object) => void;
  onDelete: () => void;
}) {
  const empty = !slot.mc?.personId && !slot.admin?.personId && !slot.mc?.onCalendar && !slot.admin?.onCalendar;
  const cancelled = slot.mc?.cancelled || slot.admin?.cancelled;

  return (
    <div className={`rounded-xl border border-line bg-surface p-3 shadow-card ${busy ? "opacity-60" : ""} ${cancelled ? "border-err/40" : ""}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold tabular-nums">{slot.start} – {slot.end}</span>
        <Tag name={slot.platform || "Live"} index={tagIndex} />
        {empty ? (
          <button type="button" disabled={busy} onClick={onDelete} className="ml-auto text-xs font-semibold text-err hover:underline">
            ลบ slot
          </button>
        ) : null}
      </div>

      {slot.mc ? (
        <SideRow
          label="Mc"
          side={slot.mc}
          people={staff.mc}
          busy={busy}
          onPerson={(pid) => onPatch("mc_slots", slot.mc!.id, { personId: pid })}
          onStatus={(st) => onPatch("mc_slots", slot.mc!.id, { status: st })}
        />
      ) : <p className="text-xs text-muted">ไม่มีแถว Mc ของ slot นี้</p>}

      {slot.admin ? (
        <>
          <SideRow
            label="Admin"
            side={slot.admin}
            people={staff.admin}
            busy={busy}
            onPerson={(pid) => onPatch("admin_slots", slot.admin!.id, { personId: pid })}
            onStatus={(st) => onPatch("admin_slots", slot.admin!.id, { status: st })}
          />
          <label className="mt-1.5 flex items-center gap-2 pl-14 text-xs text-muted">
            <input
              type="checkbox"
              checked={slot.admin.extra}
              disabled={busy}
              onChange={(e) => onPatch("admin_slots", slot.admin!.id, { extraAdmin: e.target.checked })}
              className="size-4 accent-[var(--brand)]"
            />
            เปิดให้ Admin เสริมรับคิวผ่านเว็บ
          </label>
        </>
      ) : <p className="mt-1 text-xs text-muted">ไม่มีแถว Admin ของ slot นี้</p>}
    </div>
  );
}

function SideRow({ label, side, people, busy, onPerson, onStatus }: {
  label: string;
  side: Side;
  people: Person[];
  busy: boolean;
  onPerson: (personId: number | null) => void;
  onStatus: (status: string) => void;
}) {
  const statuses = STATUSES.includes(side.status) ? STATUSES : [...STATUSES, side.status];
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs font-semibold text-muted">{label}</span>
      <select
        aria-label={`${label} ของ slot นี้`}
        value={side.personId ?? ""}
        disabled={busy}
        onChange={(e) => onPerson(e.target.value ? Number(e.target.value) : null)}
        className={selectCls}
      >
        <option value="">— ว่าง —</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {label === "Mc" ? `Mc ${p.name}` : p.name}{p.extra ? " (เสริม)" : ""}{p.hasEmail ? "" : " · ไม่มีอีเมล"}
          </option>
        ))}
      </select>
      <select
        aria-label={`สถานะ ${label}`}
        value={side.status}
        disabled={busy}
        onChange={(e) => onStatus(e.target.value)}
        className={`${selectCls} max-w-28 flex-none ${side.cancelled ? "text-err" : ""}`}
      >
        {statuses.map((st) => <option key={st} value={st}>{st || "สถานะ —"}</option>)}
      </select>
    </div>
  );
}

// ---------- เพิ่ม slot ----------

function CreateDialog({ defaultDate, platforms, onClose }: {
  defaultDate: string;
  platforms: string[];
  onClose: (created: boolean) => void;
}) {
  const toast = useToast();
  const [platform, setPlatform] = useState(platforms[0] ?? "");
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [times, setTimes] = useState([{ start: "09:30", end: "11:30" }]);
  const [extraAdmin, setExtraAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const field = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";
  return (
    <Sheet open onClose={() => onClose(false)} busy={saving} labelledBy="createTitle">
      <SheetHead id="createTitle" title="เพิ่ม slot" note="สร้างได้ทีละหลายวันและหลายช่วงเวลา slot ที่มีอยู่แล้ว (แพลตฟอร์ม + วัน + เวลาเดียวกัน) จะถูกข้าม" />
      <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1 text-sm">
        <label className="block">
          <span className="mb-1 block font-semibold">แพลตฟอร์ม</span>
          <input list="platform-list" value={platform} onChange={(e) => setPlatform(e.target.value)} className={field} placeholder="เช่น Shopee, TikTok" />
          <datalist id="platform-list">{platforms.map((p) => <option key={p} value={p} />)}</datalist>
        </label>

        <div>
          <span className="mb-1 block font-semibold">วันที่</span>
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} className={field} aria-label="ตั้งแต่วันที่" />
            <span className="text-muted">ถึง</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={field} aria-label="ถึงวันที่" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="เฉพาะวัน">
            {WEEKDAYS.map((w, i) => {
              const on = weekdays.has(i);
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { const n = new Set(weekdays); if (on) n.delete(i); else n.add(i); setWeekdays(n); }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}
                >
                  {w}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted">
            {tooMany ? "เลือกได้ไม่เกิน 62 วันต่อครั้ง" : dates.length
              ? `${dates.length} วัน: ${dates.slice(0, 4).map((d) => `${fmtWeekShort.format(parseKey(d))} ${parseKey(d).getUTCDate()}`).join(", ")}${dates.length > 4 ? " ..." : ""}`
              : "ไม่มีวันที่ตรงกับที่เลือก"}
          </p>
        </div>

        <div>
          <span className="mb-1 block font-semibold">ช่วงเวลา</span>
          <div className="space-y-2">
            {times.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="time" value={t.start} onChange={(e) => setTime(i, "start", e.target.value)} className={field} aria-label={`เวลาเริ่ม ช่วงที่ ${i + 1}`} />
                <span className="text-muted">–</span>
                <input type="time" value={t.end} onChange={(e) => setTime(i, "end", e.target.value)} className={field} aria-label={`เวลาจบ ช่วงที่ ${i + 1}`} />
                <IconBtn label="ลบช่วงเวลานี้" onClick={() => setTimes(times.filter((_, j) => j !== i))}><Icon.close /></IconBtn>
              </div>
            ))}
          </div>
          <button type="button" onClick={addTime} className="mt-2 text-sm font-semibold text-brand hover:underline">+ เพิ่มช่วงเวลา (ต่อจากช่วงสุดท้าย)</button>
          <p className="mt-1 text-xs text-muted">เวลาจบก่อนเวลาเริ่ม = ข้ามเที่ยงคืน เช่น 23:30–02:30</p>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={extraAdmin} onChange={(e) => setExtraAdmin(e.target.checked)} className="size-4 accent-[var(--brand)]" />
          เปิดให้ Admin เสริมรับคิวผ่านเว็บ (หมายเหตุ &quot;Admin เสริม&quot;)
        </label>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="mr-auto text-sm text-muted">จะสร้าง {tooMany ? 0 : total} slot</span>
        <button type="button" className={btn.ghost} disabled={saving} onClick={() => onClose(false)}>ยกเลิก</button>
        <button type="button" className={btn.primary} disabled={saving || !platform.trim() || !total || tooMany} onClick={submit}>
          {saving ? "กำลังสร้าง..." : "สร้าง slot"}
        </button>
      </div>
    </Sheet>
  );
}
