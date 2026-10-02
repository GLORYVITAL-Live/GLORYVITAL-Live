"use client";

import { useEffect, useState } from "react";
import { api, btn, useToast } from "@/components/ui";
import type { OwnerScope } from "@/lib/types";
import { bookRange, cleanWindow, rangeText, windowPresets, type BookWindow } from "@/lib/window";

type Data = {
  today: string;
  cutoffMonth: string;
  cutoffDate: string | null;
  canCutoff: boolean;
  mc?: BookWindow | null;
  admin?: BookWindow | null;
};
type Mode = "off" | "week" | "range";

const LABEL = { mc: "Mc", admin: "Admin เสริม" } as const;
const field = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";

const monthLabel = (m: string) => {
  const [y, mon] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, mon - 1, 1)));
};

/** "จองได้ 2 – 15 ต.ค. 2026" / "ปิดจอง" */
function effectText(w: BookWindow | null, d: Data) {
  const r = bookRange(w, d.today, d.cutoffDate);
  return r.empty ? "ปิดจอง" : `จองได้ ${rangeText(r)}`;
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
        <span className="text-muted"> — {roles.map((r) => `${LABEL[r]}: ${effectText(data[r] ?? null, data)}`).join(" · ")}</span>
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
  const [mode, setMode] = useState<Mode>(saved ? saved.mode : "off");
  const [from, setFrom] = useState(saved?.mode === "range" ? saved.from ?? "" : "");
  const [to, setTo] = useState(saved?.mode === "range" ? saved.to ?? "" : "");
  const [saving, setSaving] = useState(false);

  const w: BookWindow | null = mode === "off" ? null : mode === "week" ? { mode: "week" } : cleanWindow({ mode: "range", from, to });
  const invalid = mode === "range" && (!w ? "ใส่วันที่อย่างน้อยหนึ่งช่อง" : from && to && from > to ? "วันเริ่มต้องไม่เกินวันสุดท้าย" : "");
  const r = bookRange(w, data.today, data.cutoffDate);
  const overCutoff = !!data.cutoffDate && w?.mode === "range" && !!w.to && w.to > data.cutoffDate;
  const changed = JSON.stringify(w) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ message: string }>("/api/owner/booking-window", { role, window: w }, "PUT");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const modes: [Mode, string][] = [["off", "ไม่จำกัด"], ["week", "สัปดาห์นี้"], ["range", "กำหนดช่วงวัน"]];
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold">{LABEL[role]}</h3>
      <div role="radiogroup" aria-label={`ช่วงเปิดจอง ${LABEL[role]}`} className="flex gap-1 rounded-full border border-line bg-bg p-1">
        {modes.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            disabled={saving}
            onClick={() => setMode(id)}
            className={`flex-1 rounded-full px-2 py-1.5 text-[13px] font-semibold whitespace-nowrap transition ${
              mode === id ? "bg-brand text-brand-ink" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mt-1.5 text-xs text-muted">
        {mode === "off" ? "จองได้ตั้งแต่วันนี้ ถึงสิ้นเดือนสุดท้ายที่เปิดจอง (ด้านล่าง)"
          : mode === "week" ? "จองได้เฉพาะสัปดาห์ปัจจุบัน (จันทร์–อาทิตย์) ทุกวันจันทร์ระบบเปิดสัปดาห์ใหม่ให้เอง"
            : "จองได้เฉพาะวันในช่วงนี้ ไม่ใส่วันเริ่ม = ตั้งแต่วันนี้ / ไม่ใส่วันสุดท้าย = ถึงสิ้นเดือนที่เปิดจอง"}
      </p>

      {mode === "range" ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {windowPresets(data.today).map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={saving}
                onClick={() => { setFrom(p.from); setTo(p.to); }}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                  from === p.from && to === p.to ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input type="date" value={from} disabled={saving} onChange={(e) => setFrom(e.target.value)} className={field} aria-label="ตั้งแต่วันที่" />
            <span className="text-sm text-muted">ถึง</span>
            <input type="date" value={to} min={from || undefined} disabled={saving} onChange={(e) => setTo(e.target.value)} className={field} aria-label="ถึงวันที่" />
          </div>
        </>
      ) : null}

      <div className={`mt-2 rounded-lg px-3 py-2 text-sm ${invalid || r.empty ? "border border-warn-line bg-warn-bg text-warn-ink" : "bg-brand-soft text-info-ink"}`}>
        {invalid ? invalid
          : r.empty ? `ผลลัพธ์: ตอนนี้ ${LABEL[role]} จะไม่เห็น slot ให้จองเลย`
            : <>ผลลัพธ์: {LABEL[role]} <strong>{effectText(w, data)}</strong></>}
        {overCutoff && !invalid ? (
          <span className="mt-1 block text-xs">
            วันสุดท้ายเกินเดือนที่เปิดจอง ระบบจะตัดที่สิ้นเดือน {monthLabel(data.cutoffMonth)} — ถ้าจะเปิดเกินนั้นให้แก้ &quot;เดือนสุดท้ายที่เปิดจอง&quot; ด้านล่าง
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className={btn.ghost}
          disabled={saving || !changed}
          onClick={() => { setMode(saved ? saved.mode : "off"); setFrom(saved?.mode === "range" ? saved.from ?? "" : ""); setTo(saved?.mode === "range" ? saved.to ?? "" : ""); }}
        >
          ยกเลิกที่แก้
        </button>
        <button type="button" className={btn.primary} disabled={saving || !changed || !!invalid} onClick={save}>
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </section>
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
