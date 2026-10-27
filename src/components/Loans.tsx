"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarClockIcon, MapPinIcon, MinusIcon, PackageIcon, PhoneIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  LOAN_STATUS_TEXT, OPEN, canAct, companionsFor, isOverdue, leftOf, lightRole, loanLiveClashes, roomInfo, shortages,
  type CatalogItem, type Hold, type LiveBlock, type Loan, type LoanAction, type LoanStatus, type Stock,
} from "@/lib/loans";
import { todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DatePicker, TimePicker } from "@/components/date-picker";
import { AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, Notice, StateBox, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * ขอยืมอุปกรณ์จากทีมอื่น (src/lib/loans.ts · /api/loans)
 *   BorrowPage  = บัญชีทีมอื่น: ฟอร์มขอยืม (วันเวลายืม / คืน → เลือกอุปกรณ์ที่ว่าง + จำนวน → สถานที่ใช้งาน) + คำขอของฉัน
 *   LoanManager = คนที่เข้าหน้าอุปกรณ์ได้ (หน้าอุปกรณ์ > คำขอยืม): อนุมัติ / ไม่อนุมัติ → ส่งของ → รับคืน
 */

type LoansData = {
  manage: boolean; loans: Loan[]; catalog: CatalogItem[]; holds: Hold[];
  /** ช่วงที่ห้องไลฟ์มีไลฟ์ (ไฟ / กล้องประจำห้องต้องเหลือไว้) — เว็บเก่าไม่ส่ง = ไม่มี */
  live?: LiveBlock[];
  me: { name: string; team: string; phone: string } | null;
};
const stockOf = (d: LoansData): Stock => ({ catalog: d.catalog, holds: d.holds, live: d.live ?? [] });

const fmtWhen = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const when = (iso: string) => fmtWhen.format(new Date(iso));
const STATUS_CLASS: Record<LoanStatus, string> = {
  pending: "border-warning-border bg-warning text-warning-foreground",
  approved: "border-primary/40 bg-primary/10 text-primary",
  borrowed: "border-p2/40 bg-p2/15 text-p2",
  returned: "border-success/40 bg-success/15 text-success",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
};

/** โหลดคำขอ + อุปกรณ์ · now = เวลาที่โหลด (ใช้ตัดสินเลยกำหนดคืน) · mine = เฉพาะคำขอของตัวเอง (หน้าขอยืม) */
function useLoans(mine = false) {
  const [data, setData] = useState<(LoansData & { now: number }) | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api<LoansData>(mine ? "/api/loans?mine=1" : "/api/loans")
      .then((res) => { if (!alive) return; if (res.ok) { setData({ ...res, now: Date.now() }); setError(""); } else setError(res.message ?? "โหลดไม่สำเร็จ"); })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick, mine]);
  return { data, error, reload: () => setTick((n) => n + 1) };
}

/** วัน + เวลา (ปฏิทิน / เวลาแบบเดียวกับหน้าอื่นของเว็บ) "YYYY-MM-DD" + "HH:MM" → เวลาเครื่อง */
type When = { day: string; time: string };
const msOf = (w: When) => (w.day && w.time ? Date.parse(`${w.day}T${w.time}`) : NaN);

/** กำหนดการยืม / คืน: ปฏิทิน + เวลา (ชั่วโมง / นาที) */
function WhenField({ label, value, min, onChange }: { label: string; value: When; min?: string; onChange: (w: When) => void }) {
  return (
    <div>
      <Label className="mb-1">{label}</Label>
      <div className="flex gap-2">
        <DatePicker value={value.day} min={min} onChange={(day) => onChange({ ...value, day })} aria-label={`${label}: วันที่`} className="h-10 flex-1" />
        <TimePicker value={value.time} onChange={(time) => onChange({ ...value, time })} aria-label={`${label}: เวลา`} className="h-10 w-28 shrink-0" />
      </div>
    </div>
  );
}

// ---------- บัญชีทีมอื่น ----------

export function BorrowPage() {
  const { data, error, reload } = useLoans(true);
  if (!data) return error ? <LoadError title="โหลดหน้าขอยืมไม่สำเร็จ" message={error} onRetry={reload} /> : <LoadingBlock />;
  const mine = data.loans;
  const open = mine.filter((l) => OPEN.includes(l.status));
  return (
    <div className="space-y-4 pb-10">
      <LoanForm data={data} onSent={reload} />
      <section>
        <h2 className="mb-2 text-lg font-bold">คำขอของฉัน {open.length ? <span className="text-sm font-normal text-muted-foreground">(ยังไม่จบ {open.length})</span> : null}</h2>
        {!mine.length ? <StateBox title="ยังไม่มีคำขอยืม">กรอกฟอร์มด้านบนแล้วกดส่งคำขอ ทีมงานจะอนุมัติและแจ้งเตือนกลับ</StateBox> : (
          <div className="space-y-2">{mine.map((l) => <LoanCard key={l.id} loan={l} now={data.now} actions={canAct(l.status, "cancel") ? ["cancel"] : []} onDone={reload} />)}</div>
        )}
      </section>
    </div>
  );
}

function LoanForm({ data, onSent }: { data: LoansData & { now: number }; onSent: () => void }) {
  const toast = useToast();
  // ค่าเริ่มต้น: พรุ่งนี้ 10:00 – 18:00
  const [start, setStart] = useState<When>(() => ({ day: todayKey(1), time: "10:00" }));
  const [end, setEnd] = useState<When>(() => ({ day: todayKey(1), time: "18:00" }));
  const [picked, setPicked] = useState<Map<number, number>>(new Map());
  const [location, setLocation] = useState("");
  const [purpose, setPurpose] = useState("");
  const [phone, setPhone] = useState(data.me?.phone ?? "");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const startMs = msOf(start), endMs = msOf(end);
  const validRange = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  // ว่างในช่วงนี้ = หักที่ถูกยืม + ไฟ / กล้องประจำห้องไลฟ์ที่ต้องเหลือไว้ตอนมีไลฟ์
  //   ของประจำห้องเดียวกัน (เช่น ไฟห้อง Cherry 3 ดวง ไลฟ์อยู่ ยืมได้รวม 1) = หักชิ้นอื่นในห้องที่เลือกไว้แล้วด้วย
  const stock = useMemo(() => stockOf(data), [data]);
  const left = (c: CatalogItem) => {
    if (!validRange) return c.quantity;
    const own = leftOf(stock, c, startMs, endMs), room = roomInfo(stock, c, startMs, endMs);
    if (!room) return own;
    const others = room.ids.filter((id) => id !== c.id).reduce((a, id) => a + (picked.get(id) ?? 0), 0);
    return Math.max(0, Math.min(own, room.left - others));
  };

  const q = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const list = data.catalog.filter((c) => !q || [c.name, c.code, c.category].some((v) => v.toLowerCase().includes(q)));
    const m = new Map<string, CatalogItem[]>();
    for (const c of list) m.set(c.category || "อื่นๆ", [...(m.get(c.category || "อื่นๆ") ?? []), c]);
    return [...m];
  }, [data.catalog, q]);
  const items = [...picked].filter(([, n]) => n > 0).map(([equipmentId, quantity]) => ({ equipmentId, quantity }));
  const short = validRange ? shortages(items, stock, startMs, endMs) : [];
  const byId = useMemo(() => new Map(data.catalog.map((c) => [c.id, c])), [data.catalog]);

  // ยืมไฟเป็นชุด: กด + ที่ไฟ = เพิ่มขา + Softbox (+ สายไฟที่แยกรายการ) ให้ด้วย (src/lib/loans.ts companionsFor)
  //   links = ไฟแต่ละดวง → ของที่เพิ่มคู่ให้ ทีละครั้งที่กด (กด − ที่ไฟ = เอาชุดล่าสุดออกด้วย)
  const [asSet, setAsSet] = useState(true);
  const [links, setLinks] = useState<Map<number, number[][]>>(new Map());
  /** เอาของที่เพิ่มคู่ไว้ออกจากชุด (ผู้ยืมลดเอง) */
  const unlink = (m: Map<number, number[][]>, id: number, all: boolean) => {
    const out = new Map(m);
    for (const [k, stack] of out) {
      if (!stack.some((set) => set.includes(id))) continue;
      out.set(k, stack.map((set) => (all ? set.filter((x) => x !== id) : set)));
      if (!all) {
        const i = stack.findLastIndex((set) => set.includes(id));
        out.set(k, stack.map((set, j) => (j === i ? set.filter((x, xi) => xi !== set.indexOf(id)) : set)));
        break;
      }
    }
    return out;
  };

  function add(c: CatalogItem) {
    const next = new Map(picked);
    next.set(c.id, (next.get(c.id) ?? 0) + 1);
    if (asSet && lightRole(c) === "light") {
      const set = companionsFor(c, data.catalog, (x) => left(x) - (next.get(x.id) ?? 0));
      for (const x of set.items) next.set(x.id, (next.get(x.id) ?? 0) + 1);
      setLinks((prev) => new Map(prev).set(c.id, [...(prev.get(c.id) ?? []), set.items.map((x) => x.id)]));
      const added = set.items.length ? `เพิ่มเป็นชุด: ${set.items.map((x) => x.name).join(" + ")}` : "";
      const lack = set.missing.length ? `ไม่มี${set.missing.join(" / ")}ว่างในช่วงนี้` : "";
      toast([added, lack].filter(Boolean).join(" · "), lack ? "error" : undefined);
    }
    setPicked(next);
  }
  function remove(c: CatalogItem) {
    const next = new Map(picked);
    next.set(c.id, Math.max(0, (next.get(c.id) ?? 0) - 1));
    const stack = links.get(c.id);
    if (stack?.length) {
      for (const id of stack[stack.length - 1]) next.set(id, Math.max(0, (next.get(id) ?? 0) - 1));
      setLinks((prev) => new Map(prev).set(c.id, stack.slice(0, -1)));
    } else {
      setLinks((prev) => unlink(prev, c.id, false));
    }
    setPicked(next);
  }
  /** เอาออกทั้งรายการ (ไฟ = เอาของที่เพิ่มคู่ไว้ออกด้วย) */
  function clear(id: number) {
    const next = new Map(picked);
    next.delete(id);
    for (const cid of (links.get(id) ?? []).flat()) next.set(cid, Math.max(0, (next.get(cid) ?? 0) - 1));
    setLinks((prev) => { const m = unlink(prev, id, true); m.delete(id); return m; });
    setPicked(next);
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/loans", {
        items, location, purpose, phone, team: data.me?.team ?? "",
        startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(),
      });
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      setPicked(new Map()); setLinks(new Map()); setLocation(""); setPurpose("");
      onSent();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const missing = !validRange ? "เลือกวันเวลายืม / คืนให้ถูกต้อง (คืนต้องหลังยืม)"
    : !items.length ? "เลือกอุปกรณ์อย่างน้อย 1 รายการ"
      : !location.trim() ? "ใส่สถานที่ใช้งาน"
        : short.length ? "ช่วงนี้ของบางรายการไม่พอ" : "";

  return (
    <section className="rounded-xl border bg-card p-3">
      <h2 className="text-lg font-bold">ส่งคำขอยืมใหม่</h2>
      <p className="text-xs text-muted-foreground">
        {data.me ? `ในนาม ${data.me.name}${data.me.team ? ` (${data.me.team})` : ""} · ` : ""}เลือกวันเวลาก่อน ระบบจะบอกว่าแต่ละรายการว่างกี่ชิ้นในช่วงนั้น
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <WhenField
          label="กำหนดการยืม (รับของ)" value={start} min={todayKey()}
          // เลื่อนวันยืมเลยวันคืน = เลื่อนวันคืนตาม
          onChange={(w) => { setStart(w); if (w.day > end.day) setEnd({ ...end, day: w.day }); }}
        />
        <WhenField label="กำหนดการส่งคืน" value={end} min={start.day} onChange={setEnd} />
      </div>
      {!validRange ? <p className="mt-1 text-xs text-destructive">วันเวลาคืนต้องหลังวันเวลายืม</p> : null}

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Label className="font-semibold">ยืมอะไร {items.length ? <span className="font-normal text-muted-foreground">· เลือกแล้ว {items.length} รายการ</span> : null}</Label>
          <InputGroup className="h-9 w-full bg-background sm:w-60">
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา เช่น ไฟ" aria-label="ค้นหาอุปกรณ์" />
          </InputGroup>
        </div>
        <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg bg-secondary px-2.5 py-2 text-xs leading-snug">
          <input type="checkbox" checked={asSet} onChange={(e) => setAsSet(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span>
            <b>ยืมไฟเป็นชุด</b> — กด + ที่ไฟ ระบบเพิ่ม <b>ขาไฟ + Softbox</b> ที่ว่างให้อัตโนมัติ (+ สายไฟ ถ้าแยกรายการ)
            <span className="block text-muted-foreground">ไม่ต้องการชิ้นไหน กด − ที่ชิ้นนั้นได้ · กด − ที่ไฟ = เอาทั้งชุดออก</span>
          </span>
        </label>
        {!data.catalog.length ? <p className="text-sm text-muted-foreground">ตอนนี้ยังไม่มีอุปกรณ์ที่ให้ยืมได้</p> : (
          <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-lg border p-2">
            {groups.map(([cat, list]) => (
              <div key={cat}>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">{cat}</div>
                <ul className="space-y-1">
                  {list.map((c) => {
                    const n = picked.get(c.id) ?? 0, free = left(c);
                    const room = validRange ? roomInfo(stock, c, startMs, endMs) : null;
                    // ของที่เพิ่มคู่กับไฟดวงนี้ (แสดงใต้ชื่อ)
                    const mates = [...new Set((links.get(c.id) ?? []).flat())].map((id) => byId.get(id)?.name).filter(Boolean);
                    return (
                      <li key={c.id} className={cn("flex items-center gap-2 rounded-lg px-1.5 py-1", n > 0 && "bg-secondary")}>
                        {c.photoUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={c.photoUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
                          : <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><PackageIcon className="size-4" /></span>}
                        <span className="min-w-0 flex-1 leading-tight">
                          {/* ชื่อยาว (รุ่น + สายไฟ) แสดงได้ 2 บรรทัด มือถือจะได้เห็นรุ่นครบ */}
                          <span className="line-clamp-2 text-sm font-medium break-words">{c.name}</span>
                          {/* ห้องไลฟ์ต้องเหลือไฟห้องละ 2 ชุด / กล้อง 1 ตัวตอนมีไลฟ์: ห้องไม่เหลือให้ยืม = ติดไลฟ์ / เหลือ = บอกว่ายืมรวมได้กี่ชิ้น */}
                          <span className={cn("block text-[11px]", free ? "text-muted-foreground" : "text-destructive")}>
                            {c.code ? `${c.code} · ` : ""}
                            {room && !room.left ? `ติดไลฟ์${room.room.replace(/^ห้องไลฟ์\s*/, "ห้อง ")}`
                              : free ? `ว่าง ${free}/${c.quantity}` : n ? "เลือกครบแล้ว" : "ไม่ว่างในช่วงนี้"}
                            {room && room.left ? (
                              <span className="text-warning-foreground"> · {room.room.replace(/^ห้องไลฟ์\s*/, "ห้อง ")} มีไลฟ์ ยืมรวมได้ {room.left}</span>
                            ) : null}
                          </span>
                          {n && mates.length ? <span className="block text-[11px] text-primary">+ {mates.join(" + ")}</span> : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {/* จอสัมผัส: ปุ่มใหญ่ขึ้น (36px) กดง่าย */}
                          <Button size="icon-sm" variant="outline" aria-label={`ลด ${c.name}`} disabled={!n} onClick={() => remove(c)} className="pointer-coarse:size-9"><MinusIcon /></Button>
                          <span className={cn("w-6 text-center text-sm tabular-nums", n > free && "font-bold text-destructive")}>{n}</span>
                          <Button size="icon-sm" variant="outline" aria-label={`เพิ่ม ${c.name}`} disabled={n >= free} onClick={() => add(c)} className="pointer-coarse:size-9"><PlusIcon /></Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {!groups.length ? <p className="py-3 text-center text-sm text-muted-foreground">ไม่พบอุปกรณ์ที่ค้นหา</p> : null}
          </div>
        )}
        {short.length ? (
          <p className="mt-1 text-xs text-destructive">ของไม่พอในช่วงนี้: {short.map((s) => `${s.name} เหลือ ${s.left} (เลือก ${s.want})`).join(" · ")}</p>
        ) : null}
        {/* สรุปที่เลือก (รายการยาว ของที่เพิ่มเป็นชุดอาจอยู่นอกจอ) */}
        {items.length ? (
          <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
            <div className="mb-1 text-xs font-semibold">เลือกแล้ว {items.length} รายการ · {items.reduce((a, i) => a + i.quantity, 0)} ชิ้น</div>
            <ul className="flex flex-wrap gap-1.5">
              {items.map((i) => {
                const c = byId.get(i.equipmentId);
                return (
                  <li key={i.equipmentId} className="flex items-center gap-1 rounded-full border bg-card py-0.5 pr-0.5 pl-2 text-xs">
                    <span className="max-w-48 truncate">{c?.name ?? "?"}</span>
                    {c?.code ? <span className="text-muted-foreground">{c.code}</span> : null}
                    <b className="tabular-nums">x{i.quantity}</b>
                    <button type="button" aria-label={`เอา ${c?.name ?? ""} ออก`} onClick={() => clear(i.equipmentId)}
                      className="grid size-5 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-7">
                      <XIcon className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="สถานที่ใช้งาน *">{(id) => <Input id={id} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="เช่น ห้องประชุมชั้น 3 / ออกบูธที่ ..." maxLength={200} />}</Field>
        <Field label="เบอร์ติดต่อ">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" />}</Field>
      </div>
      <div className="mt-3">
        <Field label="ใช้ทำอะไร (ไม่บังคับ)">{(id) => <Textarea id={id} value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} maxLength={500} placeholder="เช่น ถ่ายวิดีโอสินค้าใหม่" />}</Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {missing ? <span className="mr-auto text-xs text-muted-foreground">{missing}</span> : null}
        <Button size="lg" disabled={busy || !!missing} onClick={submit}>{busy ? "กำลังส่ง..." : "ส่งคำขอยืม"}</Button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = `loan-${label.replace(/\W+/g, "")}-${label.length}`;
  return (
    <div>
      <Label htmlFor={id} className="mb-1">{label}</Label>
      {children(id)}
    </div>
  );
}

// ---------- คนที่เข้าหน้าอุปกรณ์ได้ ----------

type ManageFilter = "todo" | "all";

export function LoanManager() {
  const { data, error, reload } = useLoans();
  const [filter, setFilter] = useState<ManageFilter>("todo");
  if (!data) return error ? <LoadError title="โหลดคำขอยืมไม่สำเร็จ" message={error} onRetry={reload} /> : <LoadingBlock />;
  const now = data.now;
  const count = (s: LoanStatus) => data.loans.filter((l) => l.status === s).length;
  const late = data.loans.filter((l) => isOverdue(l, now)).length;
  // ต้องจัดการ: รออนุมัติก่อน แล้วรอรับของ ยืมอยู่ (เลยกำหนดก่อน)
  const order: LoanStatus[] = ["pending", "approved", "borrowed"];
  const list = filter === "todo"
    ? data.loans.filter((l) => OPEN.includes(l.status))
      .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || a.startAt.localeCompare(b.startAt))
    : data.loans;
  const actionsOf = (l: Loan): LoanAction[] => (["approve", "reject", "handover", "return", "cancel"] as LoanAction[])
    .filter((a) => canAct(l.status, a) && !(a === "reject" && l.status === "approved"));

  return (
    <div className="space-y-3 pb-10">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge className={STATUS_CLASS.pending}>รออนุมัติ {count("pending")}</Badge>
        <Badge className={STATUS_CLASS.approved}>รอรับของ {count("approved")}</Badge>
        <Badge className={STATUS_CLASS.borrowed}>ยืมอยู่ {count("borrowed")}</Badge>
        {late ? <Badge className={STATUS_CLASS.rejected}>เลยกำหนดคืน {late}</Badge> : null}
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={filter} onValueChange={(v) => { if (v) setFilter(v as ManageFilter); }} aria-label="แสดง" className="ml-auto bg-card">
          <ToggleGroupItem value="todo" className="text-xs">ต้องจัดการ</ToggleGroupItem>
          <ToggleGroupItem value="all" className="text-xs">ทั้งหมด</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Notice>
        ทีมอื่นส่งคำขอได้เมื่อมีบัญชี (หน้าเจ้าของ &gt; พนักงาน &gt; ทีมอื่น) · ของที่อนุมัติแล้ว / ยืมอยู่ ถูกกันจำนวนไว้ในช่วงนั้น คำขอใหม่ขอเกินไม่ได้
      </Notice>
      {!list.length ? <StateBox title={filter === "todo" ? "ไม่มีคำขอที่ต้องจัดการ" : "ยังไม่มีคำขอยืม"}>คำขอใหม่จะแจ้งเตือนที่กระดิ่ง</StateBox> : (
        <div className="space-y-2">
          {list.map((l) => {
            const span = { startMs: Date.parse(l.startAt), endMs: Date.parse(l.endAt) };
            const short = l.status === "pending" ? shortages(l.items, stockOf(data), span.startMs, span.endMs, l.id) : [];
            // อนุมัติ / ยืมอยู่ แล้วมีไลฟ์เพิ่มทีหลังในช่วงนั้น = ไฟ / กล้องประจำห้องไม่พอ (ให้ผู้ยืมคืนก่อน หรือย้ายไลฟ์)
            const clash = (l.status === "approved" || l.status === "borrowed") && span.endMs > now
              ? loanLiveClashes(stockOf(data), { id: l.id, ...span, items: l.items }) : [];
            const warning = short.length ? `ของไม่พอแล้ว: ${short.map((s) => `${s.name} เหลือ ${s.left} (ขอ ${s.want})`).join(" · ")}`
              : clash.length ? `ชนไลฟ์ที่เพิ่มทีหลัง: ${clash.map((c) => `${c.room.replace(/^ห้องไลฟ์\s*/, "ห้อง ")} มีไลฟ์ ${c.what}ให้ยืมได้ ${c.left} แต่ยืมไป ${c.want}`).join(" · ")} — ติดต่อผู้ยืมให้คืนก่อน หรือย้ายเวลาไลฟ์`
                : "";
            return <LoanCard key={l.id} loan={l} now={now} manage actions={actionsOf(l)} warning={warning} onDone={reload} />;
          })}
        </div>
      )}
    </div>
  );
}

// ---------- การ์ดคำขอ ----------

const ACTION_BUTTON: Record<LoanAction, { text: string; variant: "default" | "outline" | "destructive" }> = {
  approve: { text: "อนุมัติ", variant: "default" },
  reject: { text: "ไม่อนุมัติ", variant: "outline" },
  handover: { text: "ส่งของให้ยืมแล้ว", variant: "default" },
  return: { text: "รับคืนแล้ว", variant: "default" },
  cancel: { text: "ยกเลิกคำขอ", variant: "outline" },
};

function LoanCard({ loan: l, now, manage = false, actions, warning = "", onDone }: {
  loan: Loan; now: number; manage?: boolean; actions: LoanAction[]; warning?: string; onDone: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [asking, setAsking] = useState<LoanAction | null>(null);
  const [busy, setBusy] = useState(false);
  const late = isOverdue(l, now);

  async function run(action: LoanAction, extra: { reason?: string; note?: string } = {}) {
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/loans", { id: l.id, action, ...extra }, "PATCH");
      if (!res.ok) throw new Error(res.message);
      toast(`${ACTION_BUTTON[action].text}แล้ว`);
      setAsking(null);
      onDone();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function press(action: LoanAction) {
    // ต้องใส่ข้อความ: ไม่อนุมัติ (เหตุผล) / รับคืน (สภาพของ) / ยกเลิกโดยทีมเรา (เหตุผล)
    if (action === "reject" || action === "return" || (action === "cancel" && manage)) { setAsking(action); return; }
    const ok = await confirm({
      title: action === "approve" ? "อนุมัติคำขอนี้?" : action === "handover" ? "ส่งของให้ผู้ยืมแล้ว?" : "ยกเลิกคำขอยืมนี้?",
      description: `${l.items.map((i) => `${i.name} x${i.quantity}`).join(", ")} · ${when(l.startAt)} – ${when(l.endAt)}`,
      confirmText: ACTION_BUTTON[action].text, destructive: action === "cancel",
    });
    if (ok) await run(action);
  }

  return (
    <article className={cn("rounded-xl border bg-card p-3", late && "border-destructive/50")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {manage ? (
            <div className="font-semibold">
              {l.requester.name}{l.requester.team ? <span className="font-normal text-muted-foreground"> · {l.requester.team}</span> : null}
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground">คำขอ #{l.id} · ส่งเมื่อ {when(l.createdAt)}</div>
        </div>
        <span className="flex flex-wrap gap-1">
          <Badge className={STATUS_CLASS[l.status]}>{LOAN_STATUS_TEXT[l.status]}</Badge>
          {late ? <Badge className={STATUS_CLASS.rejected}>เลยกำหนดคืน</Badge> : null}
        </span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {l.items.map((i) => (
          <li key={i.equipmentId} className="rounded-full border bg-background px-2 py-0.5 text-xs">
            {i.name}{i.code ? <span className="text-muted-foreground"> {i.code}</span> : null} <b className="tabular-nums">x{i.quantity}</b>
          </li>
        ))}
      </ul>
      <div className="mt-2 space-y-0.5 text-sm">
        <div className="flex items-start gap-1.5"><CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />ยืม {when(l.startAt)} → คืน {when(l.endAt)}</div>
        <div className="flex items-start gap-1.5"><MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{l.location}</div>
        {manage && l.requester.phone ? (
          <div className="flex items-start gap-1.5"><PhoneIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <a className="text-primary underline" href={`tel:${l.requester.phone.replace(/[^0-9+]/g, "")}`}>{l.requester.phone}</a>
          </div>
        ) : null}
        {l.purpose ? <p className="text-xs text-muted-foreground">ใช้ทำ: {l.purpose}</p> : null}
      </div>
      {/* ประวัติ */}
      <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        {l.decidedAt ? <div>{l.status === "rejected" ? "ไม่อนุมัติ" : "อนุมัติ"}โดย {l.decidedBy} · {when(l.decidedAt)}</div> : null}
        {l.rejectReason ? <div className="text-destructive">เหตุผล: {l.rejectReason}</div> : null}
        {l.handedAt ? <div>ส่งของโดย {l.handedBy} · {when(l.handedAt)}</div> : null}
        {l.returnedAt ? <div>รับคืนโดย {l.returnedBy} · {when(l.returnedAt)}{l.returnNote ? ` · สภาพ: ${l.returnNote}` : ""}</div> : null}
      </div>
      {warning ? <p className="mt-2 text-xs font-semibold text-destructive">{warning}</p> : null}
      {actions.length ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {actions.map((a) => (
            <Button key={a} size="sm" variant={ACTION_BUTTON[a].variant} disabled={busy || (a === "approve" && !!warning)} onClick={() => press(a)} className="pointer-coarse:h-10 pointer-coarse:px-4">
              {ACTION_BUTTON[a].text}
            </Button>
          ))}
        </div>
      ) : null}
      {asking ? <AskDialog action={asking} busy={busy} onClose={() => setAsking(null)} onSubmit={(text) => run(asking, asking === "return" ? { note: text } : { reason: text })} /> : null}
    </article>
  );
}

/** ใส่ข้อความก่อนกด: ไม่อนุมัติ (เหตุผล บังคับ) / ยกเลิก (เหตุผล) / รับคืน (สภาพของ) */
function AskDialog({ action, busy, onClose, onSubmit }: { action: LoanAction; busy: boolean; onClose: () => void; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const need = action === "reject";
  const label = action === "return" ? "สภาพตอนรับคืน (ไม่บังคับ)" : `เหตุผล${need ? "" : " (ไม่บังคับ)"} — ผู้ยืมจะเห็นข้อความนี้`;
  return (
    <AppDialog open onClose={onClose} busy={busy} title={ACTION_BUTTON[action].text}>
      <DialogBody>
        <Label htmlFor="loan-ask" className="mb-1">{label}</Label>
        <Textarea id="loan-ask" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={300}
          placeholder={action === "return" ? "เช่น ครบ สภาพดี / ไฟ 1 ดวงสายหลวม" : "เช่น ช่วงนั้นทีมไลฟ์ต้องใช้"} />
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={busy} onClick={onClose}>ยกเลิก</Button>
        <Button size="lg" variant={action === "return" ? "default" : "destructive"} disabled={busy || (need && !text.trim())} onClick={() => onSubmit(text.trim())}>
          {busy ? "กำลังบันทึก..." : ACTION_BUTTON[action].text}
        </Button>
      </DialogActions>
    </AppDialog>
  );
}
