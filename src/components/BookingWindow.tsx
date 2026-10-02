"use client";

import { useEffect, useState } from "react";
import { PersonPicker } from "@/components/SlotManager";
import { api, btn, useToast } from "@/components/ui";
import type { OwnerScope } from "@/lib/types";
import {
  bookRange, cleanPeriod, cleanWindow, rangeText, windowPresets, type BookWindow, type Period, type WindowMode as Mode,
} from "@/lib/window";

type Person = { id: number; name: string };
type Data = {
  today: string;
  cutoffMonth: string;
  cutoffDate: string | null;
  canCutoff: boolean;
  mc?: BookWindow | null;
  admin?: BookWindow | null;
  people: { mc: Person[]; admin: Person[] };
};
/** ค่าที่กำลังแก้ในฟอร์ม (วันที่ว่าง = "") */
type Draft = { mode: Mode; from: string; to: string };

const LABEL = { mc: "Mc", admin: "Admin เสริม" } as const;
const field = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";

const monthLabel = (m: string) => {
  const [y, mon] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, mon - 1, 1)));
};

const toDraft = (p: Period | null | undefined): Draft => ({ mode: p?.mode ?? "off", from: p?.from ?? "", to: p?.to ?? "" });

/** ข้อความผิดของช่วงที่กรอก ("" = ใช้ได้) */
const invalidOf = (d: Draft) =>
  d.mode !== "range" ? "" : !d.from && !d.to ? "ใส่วันที่อย่างน้อยหนึ่งช่อง" : d.from && d.to && d.from > d.to ? "วันเริ่มต้องไม่เกินวันสุดท้าย" : "";

/** "จองได้ 2 – 15 ต.ค. 2026" / "ปิดจอง" */
function effectText(p: Period | null, d: Data) {
  const r = bookRange(p, d.today, d.cutoffDate);
  return r.empty ? "ปิดจอง" : `จองได้ ${rangeText(r)}`;
}

/** สรุปบรรทัดเดียวของฝั่งนั้น (แสดงบนหัวข้อ "ช่วงเปิดจอง") */
function summaryText(w: BookWindow | null, d: Data) {
  const general = effectText(w, d);
  return w?.only.length ? `${general} · จองก่อน ${w.only.length} คน: ${effectText(w.early, d)}` : general;
}

/** หน้าเจ้าของ > จัดการ slot: ตั้งช่วงที่ Mc / Admin เสริม จองได้ (เฉพาะฝั่งที่มีสิทธิ์) */
export function BookingWindowEditor({ scope }: { scope: OwnerScope }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<Data>("/api/owner/booking-window")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick]);

  if (!data) {
    return error
      ? <p className="my-3 rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-ink">โหลดช่วงเปิดจองไม่สำเร็จ: {error}</p>
      : <div className="my-3 h-11 animate-pulse rounded-xl bg-line/70" />;
  }
  const roles = (["mc", "admin"] as const).filter((r) => scope[r]);
  const reload = () => setTick((n) => n + 1);

  return (
    <details className="my-3 rounded-xl border border-line bg-surface">
      <summary className="cursor-pointer px-3 py-2.5 text-sm">
        <strong>ช่วงเปิดจอง</strong>
        <span className="text-muted"> — {roles.map((r) => `${LABEL[r]}: ${summaryText(data[r] ?? null, data)}`).join(" | ")}</span>
      </summary>
      <div className="space-y-4 border-t border-line p-3">
        {roles.map((r) => <RoleWindow key={`${r}${JSON.stringify(data[r] ?? null)}`} role={r} data={data} onSaved={reload} />)}
        <CutoffMonth key={data.cutoffMonth} data={data} onSaved={reload} />
      </div>
    </details>
  );
}

function RoleWindow({ role, data, onSaved }: { role: "mc" | "admin"; data: Data; onSaved: () => void }) {
  const toast = useToast();
  const saved = data[role] ?? null;
  const people = data.people[role];
  const [general, setGeneral] = useState<Draft>(toDraft(saved));
  const [early, setEarly] = useState<Draft>(toDraft(saved?.early));
  // รายชื่อจองก่อน: หนึ่งแถว = หนึ่งคน (null = แถวที่กด + แล้วยังไม่ได้เลือกชื่อ)
  const [rows, setRows] = useState<(number | null)[]>(saved?.only ?? []);
  const [saving, setSaving] = useState(false);

  const only = rows.filter((id): id is number => id !== null);
  const w = cleanWindow({ ...general, only, early });
  const invalid = invalidOf(general) || (only.length ? invalidOf(early) : "");
  const changed = JSON.stringify(w) !== JSON.stringify(saved);
  const label = (p: Person) => (role === "mc" ? `Mc ${p.name}` : p.name);
  const nameOf = (id: number) => {
    const p = people.find((x) => x.id === id);
    return p ? label(p) : "(ถูกลบแล้ว)";
  };
  const generalP = cleanPeriod(general);
  const earlyP = cleanPeriod(early);
  const overCutoff = !!data.cutoffDate && [generalP, ...(only.length ? [earlyP] : [])]
    .some((p) => p.mode === "range" && !!p.to && p.to > data.cutoffDate!);
  const reset = () => {
    setGeneral(toDraft(saved));
    setEarly(toDraft(saved?.early));
    setRows(saved?.only ?? []);
  };

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ message: string }>("/api/owner/booking-window", { role, window: { ...general, only, early } }, "PUT");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const generalEmpty = bookRange(generalP, data.today, data.cutoffDate).empty;
  return (
    <section className="rounded-xl border border-line p-3">
      <h3 className="mb-2 font-bold">{LABEL[role]}</h3>

      <div className="text-sm font-semibold">ช่วงของ {LABEL[role]} ทั่วไป</div>
      <PeriodPicker
        label={`ช่วงเปิดจอง ${LABEL[role]} ทั่วไป`}
        value={general}
        onChange={setGeneral}
        today={data.today}
        disabled={saving}
        withClosed
      />

      <div className="mt-4 text-sm font-semibold">ให้บางคนจองก่อน (ใช้ช่วงของตัวเอง)</div>
      <p className="text-xs text-muted">
        คนในรายชื่อใช้ &quot;ช่วงของคนที่จองก่อน&quot; คนอื่นใช้ช่วงทั่วไปด้านบน · หน้าจองของแต่ละคนแสดงแค่ช่วงวันของตัวเอง ไม่บอกว่ามีรายชื่อจองก่อน
      </p>
      <div className="mt-1.5 space-y-1.5">
        {rows.map((id, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-muted">{i + 1}.</span>
            <PersonPicker
              label={`${LABEL[role]} ที่จองก่อน`}
              value={id}
              // ตัดคนที่อยู่แถวอื่นแล้วออก กันเลือกซ้ำ
              options={people.filter((p) => p.id === id || !rows.includes(p.id)).map((p) => ({ id: p.id, text: label(p) }))}
              disabled={saving}
              emptyText={`— พิมพ์หรือเลือกชื่อ ${LABEL[role]} —`}
              hideEmpty
              onChange={(next) => setRows(rows.map((x, j) => (j === i ? next : x)))}
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              aria-label={`ลบแถวที่ ${i + 1}`}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-muted hover:text-ink"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving || rows.includes(null) || only.length >= people.length}
            onClick={() => setRows([...rows, null])}
            className="h-9 rounded-lg border border-dashed border-line px-3 text-sm font-semibold text-muted hover:text-ink disabled:opacity-50"
          >
            + เพิ่ม {LABEL[role]}{rows.length ? " อีกคน" : ""}
          </button>
          {rows.length ? (
            <button type="button" disabled={saving} onClick={() => setRows([])} className="text-xs font-semibold text-muted hover:underline">
              ล้างรายชื่อ (ทุกคนใช้ช่วงทั่วไป)
            </button>
          ) : null}
        </div>
      </div>

      {only.length ? (
        <div className="mt-3 rounded-lg bg-bg p-2.5">
          <div className="text-sm font-semibold">ช่วงของคนที่จองก่อน</div>
          <PeriodPicker
            label={`ช่วงเปิดจอง ${LABEL[role]} ที่จองก่อน`}
            value={early}
            onChange={setEarly}
            today={data.today}
            disabled={saving}
          />
        </div>
      ) : null}

      <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${invalid ? "border border-warn-line bg-warn-bg text-warn-ink" : "bg-brand-soft text-info-ink"}`}>
        {invalid ? invalid : (
          <ul className="space-y-0.5">
            <li>
              {only.length ? `${LABEL[role]} ทั่วไป` : `${LABEL[role]} ทุกคน`}: <strong>{effectText(generalP, data)}</strong>
              {generalEmpty ? " (ไม่เห็น slot เลย)" : ""}
            </li>
            {only.length ? (
              <li>{only.map(nameOf).join(", ")}: <strong>{effectText(earlyP, data)}</strong></li>
            ) : null}
          </ul>
        )}
        {overCutoff && !invalid ? (
          <span className="mt-1 block text-xs">
            วันสุดท้ายเกินเดือนที่เปิดจอง ระบบจะตัดที่สิ้นเดือน {monthLabel(data.cutoffMonth)} — ถ้าจะเปิดเกินนั้นให้แก้ &quot;เดือนสุดท้ายที่เปิดจอง&quot; ด้านล่าง
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className={btn.ghost} disabled={saving || !changed} onClick={reset}>ยกเลิกที่แก้</button>
        <button type="button" className={btn.primary} disabled={saving || !changed || !!invalid} onClick={save}>
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </section>
  );
}

/** เลือกช่วง: ไม่จำกัด / สัปดาห์นี้ / กำหนดช่วงวัน (/ ปิดจอง) */
function PeriodPicker({ label, value, onChange, today, disabled, withClosed = false }: {
  label: string;
  value: Draft;
  onChange: (d: Draft) => void;
  today: string;
  disabled: boolean;
  withClosed?: boolean;
}) {
  const modes: [Mode, string][] = [
    ["off", "ไม่จำกัด"], ["week", "สัปดาห์นี้"], ["range", "กำหนดช่วงวัน"],
    ...(withClosed ? [["closed", "ปิดจอง"] as [Mode, string]] : []),
  ];
  const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
  return (
    <>
      <div role="radiogroup" aria-label={label} className="mt-1 flex gap-1 rounded-full border border-line bg-surface p-1">
        {modes.map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value.mode === id}
            disabled={disabled}
            onClick={() => set({ mode: id })}
            className={`flex-1 rounded-full px-1.5 py-1.5 text-[13px] font-semibold whitespace-nowrap transition ${
              value.mode === id ? "bg-brand text-brand-ink" : "text-muted hover:text-ink"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {value.mode === "off" ? "จองได้ตั้งแต่วันนี้ ถึงสิ้นเดือนสุดท้ายที่เปิดจอง (ด้านล่าง)"
          : value.mode === "week" ? "จองได้เฉพาะสัปดาห์ปัจจุบัน (จันทร์–อาทิตย์) ทุกวันจันทร์ระบบเปิดสัปดาห์ใหม่ให้เอง"
            : value.mode === "closed" ? "ไม่เห็น slot และจองไม่ได้ (หน้าจองขึ้นว่า \"ตอนนี้ยังไม่เปิดจอง\")"
              : "จองได้เฉพาะวันในช่วงนี้ ไม่ใส่วันเริ่ม = ตั้งแต่วันนี้ / ไม่ใส่วันสุดท้าย = ถึงสิ้นเดือนที่เปิดจอง"}
      </p>
      {value.mode === "range" ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {windowPresets(today).map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={disabled}
                onClick={() => set({ from: p.from, to: p.to })}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                  value.from === p.from && value.to === p.to ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input type="date" value={value.from} disabled={disabled} onChange={(e) => set({ from: e.target.value })} className={field} aria-label={`${label}: ตั้งแต่วันที่`} />
            <span className="text-sm text-muted">ถึง</span>
            <input type="date" value={value.to} min={value.from || undefined} disabled={disabled} onChange={(e) => set({ to: e.target.value })} className={field} aria-label={`${label}: ถึงวันที่`} />
          </div>
        </>
      ) : null}
    </>
  );
}

function CutoffMonth({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(data.cutoffMonth);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ message: string }>("/api/owner/booking-window", { cutoffMonth: month }, "PUT");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-line pt-3">
      <h3 className="text-sm font-bold">เดือนสุดท้ายที่เปิดจอง (ใช้ทั้ง Mc และ Admin)</h3>
      <p className="mb-2 text-xs text-muted">
        ขอบนอกสุดของการจอง ช่วงด้านบนเปิดเกินเดือนนี้ไม่ได้ · ตอนนี้: <strong>{data.cutoffMonth ? `ถึงสิ้นเดือน ${monthLabel(data.cutoffMonth)}` : "ไม่จำกัด"}</strong>
      </p>
      {data.canCutoff ? (
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={month} disabled={saving} onChange={(e) => setMonth(e.target.value)} className={`${field} max-w-48`} aria-label="เดือนสุดท้ายที่เปิดจอง" />
          {month ? (
            <button type="button" className="text-sm font-semibold text-muted hover:underline" disabled={saving} onClick={() => setMonth("")}>ไม่จำกัด</button>
          ) : null}
          <button type="button" className={`${btn.primary} ml-auto`} disabled={saving || month === data.cutoffMonth} onClick={save}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">แก้ได้เฉพาะเจ้าของที่มีสิทธิ์ทั้ง Mc และ Admin</p>
      )}
    </section>
  );
}
