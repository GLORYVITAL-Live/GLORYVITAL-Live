"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { DatePicker, MonthPicker } from "@/components/date-picker";
import { PersonPicker } from "@/components/SlotManager";
import { IconButton, Notice, api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OwnerScope } from "@/lib/types";
import { cn } from "@/lib/utils";
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

/** หน้าเจ้าของ > ตาราง slot: ตั้งช่วงที่ Mc / Admin เสริม จองได้ (เฉพาะฝั่งที่มีสิทธิ์ · ฝั่งที่ดูได้อย่างเดียว = เห็นแค่สรุป) */
export function BookingWindowEditor({ scope, edit }: { scope: OwnerScope; edit: OwnerScope }) {
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
      ? <Notice variant="warning" className="my-3">โหลดช่วงเปิดจองไม่สำเร็จ: {error}</Notice>
      : <Skeleton className="my-3 h-11 rounded-xl" />;
  }
  const roles = (["mc", "admin"] as const).filter((r) => scope[r]);
  const editable = roles.filter((r) => edit[r]);
  const reload = () => setTick((n) => n + 1);

  // ดูได้อย่างเดียวทุกฝั่ง: แสดงสรุปบรรทัดเดียว ไม่มีที่ตั้งค่า
  if (!editable.length) {
    return (
      <div className="my-3 rounded-xl border bg-card px-3 py-2.5 text-sm">
        <strong>ช่วงเปิดจอง</strong>
        <span className="text-muted-foreground"> — {roles.map((r) => `${LABEL[r]}: ${summaryText(data[r] ?? null, data)}`).join(" | ")}</span>
      </div>
    );
  }

  return (
    <Collapsible className="group/window my-3 rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-start gap-2 rounded-xl px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronDownIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/window:rotate-180" />
        <span>
          <strong>ช่วงเปิดจอง</strong>
          <span className="text-muted-foreground"> — {roles.map((r) => `${LABEL[r]}: ${summaryText(data[r] ?? null, data)}`).join(" | ")}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t p-3">
        {editable.map((r) => <RoleWindow key={`${r}${JSON.stringify(data[r] ?? null)}`} role={r} data={data} onSaved={reload} />)}
        {roles.filter((r) => !edit[r]).map((r) => (
          <p key={r} className="text-sm text-muted-foreground">{LABEL[r]}: {summaryText(data[r] ?? null, data)} (ดูได้อย่างเดียว)</p>
        ))}
        <CutoffMonth key={data.cutoffMonth} data={data} onSaved={reload} />
      </CollapsibleContent>
    </Collapsible>
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
    <section className="rounded-xl border p-3">
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
      <p className="text-xs text-muted-foreground">
        คนในรายชื่อใช้ &quot;ช่วงของคนที่จองก่อน&quot; คนอื่นใช้ช่วงทั่วไปด้านบน · หน้าจองของแต่ละคนแสดงแค่ช่วงวันของตัวเอง ไม่บอกว่ามีรายชื่อจองก่อน
      </p>
      <div className="mt-1.5 space-y-1.5">
        {rows.map((id, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
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
            <IconButton
              label={`ลบแถวที่ ${i + 1}`}
              disabled={saving}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="rounded-lg text-muted-foreground"
            >
              <XIcon />
            </IconButton>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="lg"
            disabled={saving || rows.includes(null) || only.length >= people.length}
            onClick={() => setRows([...rows, null])}
            className="border-dashed font-semibold text-muted-foreground"
          >
            <PlusIcon />เพิ่ม {LABEL[role]}{rows.length ? " อีกคน" : ""}
          </Button>
          {rows.length ? (
            <Button variant="link" size="sm" disabled={saving} onClick={() => setRows([])} className="px-0 text-muted-foreground">
              ล้างรายชื่อ (ทุกคนใช้ช่วงทั่วไป)
            </Button>
          ) : null}
        </div>
      </div>

      {only.length ? (
        <div className="mt-3 rounded-lg bg-muted p-2.5">
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

      <div className={cn("mt-3 rounded-lg px-3 py-2 text-sm", invalid ? "border border-warning-border bg-warning text-warning-foreground" : "bg-secondary text-secondary-foreground")}>
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
            เปิดเกินเดือนสุดท้ายที่เปิดจอง ({monthLabel(data.cutoffMonth)}) — ใช้ได้ตามวันที่ตั้ง เพราะใส่วันสุดท้ายเอง
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" size="lg" disabled={saving || !changed} onClick={reset}>ยกเลิกที่แก้</Button>
        <Button size="lg" disabled={saving || !changed || !!invalid} onClick={save}>
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </Button>
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
      <ToggleGroup
        type="single"
        spacing={1}
        value={value.mode}
        onValueChange={(v) => { if (v) set({ mode: v as Mode }); }}
        disabled={disabled}
        aria-label={label}
        className="mt-1 w-full rounded-full border bg-card p-1"
      >
        {modes.map(([id, text]) => (
          <ToggleGroupItem
            key={id}
            value={id}
            className="flex-1 rounded-full! px-1.5 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!"
          >
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {value.mode === "off" ? "จองได้ตั้งแต่วันนี้ ถึงสิ้นเดือนสุดท้ายที่เปิดจอง (ด้านล่าง)"
          : value.mode === "week" ? "จองได้เฉพาะสัปดาห์ปัจจุบัน (จันทร์–อาทิตย์) ทุกวันจันทร์ระบบเปิดสัปดาห์ใหม่ให้เอง"
            : value.mode === "closed" ? "ไม่เห็น slot และจองไม่ได้ (หน้าจองขึ้นว่า \"ตอนนี้ยังไม่เปิดจอง\")"
              : "จองได้เฉพาะวันในช่วงนี้ ไม่ใส่วันเริ่ม = ตั้งแต่วันนี้ / ไม่ใส่วันสุดท้าย = ถึงสิ้นเดือนที่เปิดจอง (ใส่วันสุดท้ายเอง = ใช้วันนั้น เกินเดือนที่เปิดจองได้)"}
      </p>
      {value.mode === "range" ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {windowPresets(today).map((p) => {
              const on = value.from === p.from && value.to === p.to;
              return (
                <Button
                  key={p.label}
                  variant={on ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => set({ from: p.from, to: p.to })}
                  className={cn("rounded-full text-xs font-semibold", on ? "border-primary/40" : "text-muted-foreground")}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <DatePicker
              value={value.from}
              disabled={disabled}
              clearable
              placeholder="ตั้งแต่วันนี้"
              onChange={(v) => set({ from: v })}
              aria-label={`${label}: ตั้งแต่วันที่`}
            />
            <span className="text-sm text-muted-foreground">ถึง</span>
            <DatePicker
              value={value.to}
              min={value.from || undefined}
              disabled={disabled}
              clearable
              placeholder="ถึงสิ้นเดือนที่เปิดจอง"
              onChange={(v) => set({ to: v })}
              aria-label={`${label}: ถึงวันที่`}
            />
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
    <section className="border-t pt-3">
      <h3 className="text-sm font-bold">เดือนสุดท้ายที่เปิดจอง (ใช้ทั้ง Mc และ Admin)</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        จองได้ถึงสิ้นเดือนนี้ สำหรับช่วงที่เป็น &quot;ไม่จำกัด&quot; / &quot;สัปดาห์นี้&quot; / ไม่ได้ใส่วันสุดท้าย
        (ช่วงที่ใส่วันสุดท้ายเองใช้วันที่ตั้งไว้ได้เลย) · ตอนนี้: <strong>{data.cutoffMonth ? `ถึงสิ้นเดือน ${monthLabel(data.cutoffMonth)}` : "ไม่จำกัด"}</strong>
      </p>
      {data.canCutoff ? (
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker value={month} disabled={saving} onChange={setMonth} placeholder="ไม่จำกัด" className="w-48" aria-label="เดือนสุดท้ายที่เปิดจอง" />
          {month ? (
            <Button variant="link" className="px-0 text-muted-foreground" disabled={saving} onClick={() => setMonth("")}>ไม่จำกัด</Button>
          ) : null}
          <Button size="lg" className="ml-auto" disabled={saving || month === data.cutoffMonth} onClick={save}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">แก้ได้เฉพาะเจ้าของที่มีสิทธิ์ทั้ง Mc และ Admin</p>
      )}
    </section>
  );
}
