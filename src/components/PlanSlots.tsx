"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  ChevronLeftIcon, ChevronRightIcon, CopyIcon, PlusIcon, TagIcon, Trash2Icon, Undo2Icon, WandSparklesIcon, XIcon,
} from "lucide-react";
import {
  AppDialog, DialogActions, DialogBody, IconButton, LoadError, LoadingBlock, Notice, PlatformBadge, StateBox, api,
  useConfirm, useToast,
} from "@/components/shared";
import { DatePicker, MonthPicker, TimePicker } from "@/components/date-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtDayLong, fmtWeekShort, monthKey, monthLabel, num, parseKey, todayKey } from "@/lib/format";
import { readLocal, useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// ---------- ข้อมูล ----------

type Side = { id: number; name: string; cancelled: boolean; free: boolean };
type Existing = {
  key: string; date: string; platform: string; start: string; end: string; campaign: string;
  mc: Side | null; admin: (Side & { extra: boolean }) | null;
};
type PlanData = { month: string; slots: Existing[]; platforms: string[]; campaigns: string[] };
type NewSlot = { date: string; platform: string; start: string; end: string; campaign: string };
/** ร่างของเดือน: slot ใหม่ / Campaign ที่แก้ของ slot เดิม (ตาม key) / slot เดิมที่จะลบ (key) */
type Draft = { add: NewSlot[]; campaign: Record<string, string>; del: string[] };
/** slot หนึ่งแถวในหน้า (ทั้งที่มีอยู่แล้วและร่างใหม่) */
type Item = {
  key: string; date: string; platform: string; start: string; end: string; campaign: string;
  existing: Existing | null; deleting: boolean; campaignChanged: boolean; overlap: boolean;
};

const EMPTY: Draft = { add: [], campaign: {}, del: [] };
const DRAFT_KEY = "glory_plan_draft_";
const MONTH_KEY = "glory_plan_month";
const VIEW_KEY = "glory_plan_view";
const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const ALL = "__all";

const keyOf = (s: { platform: string; date: string; start: string; end: string }) => `${s.platform}|${s.date}|${s.start}|${s.end}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmtMin = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
/** ความยาว slot เป็นนาที (เวลาจบก่อนเวลาเริ่ม = ข้ามเที่ยงคืน) */
const lenOf = (s: { start: string; end: string }) => (toMin(s.end) - toMin(s.start) + 1440) % 1440;
const canDelete = (s: Existing) => (!s.mc || s.mc.free) && (!s.admin || s.admin.free);
const fmtDayNum = (d: string) => `${fmtWeekShort.format(parseKey(d))} ${parseKey(d).getUTCDate()}`;

function daysOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function parseDraft(raw: string | null): Draft | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw);
    return {
      add: Array.isArray(v?.add) ? v.add : [],
      campaign: v?.campaign && typeof v.campaign === "object" ? v.campaign : {},
      del: Array.isArray(v?.del) ? v.del : [],
    };
  } catch {
    return null;
  }
}

/** ร่างของเดือนนี้ เก็บในเครื่อง (ปิดหน้าแล้วกลับมาทำต่อได้) ใช้ localStorage ไม่ได้ = จำไว้ในหน้าอย่างเดียว */
function useDraft(month: string) {
  const key = DRAFT_KEY + month;
  const raw = useLocal(key);
  const [mem, setMem] = useState<Record<string, Draft>>({});
  const draft = useMemo(() => parseDraft(raw) ?? mem[month] ?? EMPTY, [raw, mem, month]);
  const update = (fn: (d: Draft) => Draft) => {
    const next = fn(parseDraft(readLocal(key)) ?? mem[month] ?? EMPTY);
    setMem((m) => ({ ...m, [month]: next }));
    writeLocal(key, JSON.stringify(next));
  };
  return [draft, update] as const;
}

// ---------- หน้า ----------

/** หน้า Plan Slot Live: แพลน slot ทั้งเดือน (ร่างก่อน) แล้วกดบันทึกลงชีตทั้ง Deal Mc + Admin เสริม */
export function PlanSlots() {
  const toast = useToast();
  const confirm = useConfirm();
  const savedMonth = useLocal(MONTH_KEY);
  const month = savedMonth && /^\d{4}-\d{2}$/.test(savedMonth) ? savedMonth : monthKey();
  const setMonth = (m: string) => writeLocal(MONTH_KEY, m);
  const view = useLocal(VIEW_KEY) === "sheet" ? "sheet" : "matrix";
  const [data, setData] = useState<PlanData | null>(null);
  const [error, setError] = useState<{ month: string; message: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [draft, update] = useDraft(month);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api<PlanData>(`/api/plan?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(null); }
      })
      .catch((err) => { if (alive) setError({ month, message: (err as Error).message }); });
    return () => { alive = false; };
  }, [month, tick]);

  const plan = data?.month === month ? data : null;
  const existingMap = useMemo(() => new Map((plan?.slots ?? []).map((s) => [s.key, s])), [plan]);

  // รวม slot เดิม + ร่างใหม่ เรียงตามชีต (วัน > แพลตฟอร์ม > เวลา) และหาเวลาที่ทับกันในแพลตฟอร์มเดียวกัน
  const items = useMemo<Item[]>(() => {
    if (!plan) return [];
    const del = new Set(draft.del);
    const list: Item[] = [
      ...plan.slots.map((s) => {
        const campaign = draft.campaign[s.key] ?? s.campaign;
        return {
          key: s.key, date: s.date, platform: s.platform, start: s.start, end: s.end, campaign,
          existing: s, deleting: del.has(s.key), campaignChanged: !!s.mc && campaign !== s.campaign, overlap: false,
        };
      }),
      ...draft.add.filter((s) => s.date.startsWith(month) && !existingMap.has(keyOf(s))).map((s) => ({
        ...s, key: keyOf(s), existing: null, deleting: false, campaignChanged: false, overlap: false,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform) || a.start.localeCompare(b.start));
    const live = list.filter((x) => !x.deleting && !x.existing?.mc?.cancelled);
    for (let i = 1; i < live.length; i++) {
      const a = live[i - 1], b = live[i];
      if (a.date === b.date && a.platform === b.platform && toMin(b.start) < toMin(a.start) + lenOf(a)) a.overlap = b.overlap = true;
    }
    return list;
  }, [plan, draft, month, existingMap]);

  const platforms = useMemo(() => {
    const used = new Set(items.map((x) => x.platform));
    const order = plan?.platforms ?? [];
    return [...used].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b));
  }, [items, plan]);
  const tagIndex = (p: string) => Math.max(0, (plan?.platforms ?? []).indexOf(p)) % 4;

  // สิ่งที่จะบันทึก
  const changes = useMemo(() => {
    const create = items.filter((x) => !x.existing);
    const campaigns = items.filter((x) => x.existing?.mc && x.campaignChanged && !x.deleting)
      .map((x) => ({ mcId: x.existing!.mc!.id, campaign: x.campaign }));
    const deletes = items.filter((x) => x.deleting && x.existing && canDelete(x.existing)).map((x) => x.existing!);
    return { create, campaigns, deletes, total: create.length + campaigns.length + deletes.length };
  }, [items]);

  // เพิ่ม slot ลงร่าง (ข้ามที่มีอยู่แล้ว / ซ้ำในร่าง ถ้าเป็น slot เดิมที่กดลบไว้ = ยกเลิกการลบ)
  function addSlots(list: NewSlot[]) {
    const del = new Set(draft.del);
    const taken = new Set(draft.add.map(keyOf));
    const add = [...draft.add];
    const undel = new Set<string>();
    let added = 0, skipped = 0;
    for (const s of list) {
      const k = keyOf(s);
      if (existingMap.has(k)) {
        if (del.has(k)) { undel.add(k); added++; } else skipped++;
        continue;
      }
      if (taken.has(k)) { skipped++; continue; }
      taken.add(k);
      add.push(s);
      added++;
    }
    update((d) => ({ ...d, add, del: d.del.filter((k) => !undel.has(k)) }));
    return { added, skipped };
  }
  const report = ({ added, skipped }: { added: number; skipped: number }) =>
    toast(added ? `เพิ่มลงร่าง ${added} slot${skipped ? ` (ข้าม ${skipped} ที่มีอยู่แล้ว)` : ""}` : "ไม่มี slot ใหม่ (มีอยู่แล้วทั้งหมด)");

  const removeNew = (key: string) => update((d) => ({ ...d, add: d.add.filter((s) => keyOf(s) !== key) }));
  const toggleDelete = (key: string) =>
    update((d) => ({ ...d, del: d.del.includes(key) ? d.del.filter((k) => k !== key) : [...d.del, key] }));

  /** ตั้ง Campaign ให้หลาย slot (ร่างใหม่ = แก้ในร่าง / slot เดิม = จดว่าจะแก้) */
  function setCampaign(keys: string[], campaign: string) {
    const want = new Set(keys);
    update((d) => {
      const next = { ...d.campaign };
      for (const k of want) {
        const s = existingMap.get(k);
        if (!s?.mc) continue;
        if (campaign === s.campaign) delete next[k];
        else next[k] = campaign;
      }
      return { ...d, add: d.add.map((s) => (want.has(keyOf(s)) ? { ...s, campaign } : s)), campaign: next };
    });
  }

  async function copyPrevMonth() {
    const prev = monthKey(-1, month);
    try {
      const res = await api<PlanData>(`/api/plan?month=${prev}`);
      if (!res.ok) throw new Error(res.message);
      // ช่วงเวลาที่ใช้บ่อยของแต่ละวันในสัปดาห์ (อย่างน้อยครึ่งหนึ่งของวันนั้นๆ ที่มีไลฟ์แพลตฟอร์มนั้น)
      const days = new Map<string, Set<string>>();
      const freq = new Map<string, number>();
      for (const s of res.slots) {
        if (s.mc?.cancelled) continue;
        const pk = `${s.platform}|${parseKey(s.date).getUTCDay()}`;
        days.set(pk, (days.get(pk) ?? new Set()).add(s.date));
        const tk = `${pk}|${s.start}|${s.end}`;
        freq.set(tk, (freq.get(tk) ?? 0) + 1);
      }
      const pattern = [...freq.entries()]
        .filter(([k, n]) => n >= Math.max(1, Math.ceil((days.get(k.split("|").slice(0, 2).join("|"))?.size ?? 0) / 2)))
        .map(([k]) => { const [platform, wd, start, end] = k.split("|"); return { platform, wd: Number(wd), start, end }; });
      if (!pattern.length) { toast(`${monthLabel(prev)} ไม่มี slot ให้คัดลอก`, "error"); return; }
      const from = month === todayKey().slice(0, 7) ? todayKey() : `${month}-01`;
      const list = daysOf(month).filter((d) => d >= from).flatMap((d) => {
        const wd = parseKey(d).getUTCDay();
        return pattern.filter((p) => p.wd === wd).map((p) => ({ date: d, platform: p.platform, start: p.start, end: p.end, campaign: "" }));
      });
      const ok = await confirm({
        title: `คัดลอกรูปแบบจาก ${monthLabel(prev)}?`,
        description: `ใช้ช่วงเวลาที่ไลฟ์ประจำของแต่ละวันในสัปดาห์ (${[...new Set(pattern.map((p) => p.platform))].join(", ")}) `
          + `มาเติมลงร่าง${from > `${month}-01` ? "ตั้งแต่วันนี้" : "ทั้งเดือน"} ประมาณ ${list.length} slot (slot ที่มีอยู่แล้วจะถูกข้าม) แก้ในร่างได้ก่อนบันทึก`,
        confirmText: "เติมลงร่าง",
      });
      if (ok) report(addSlots(list));
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function save() {
    const { create, campaigns, deletes } = changes;
    const ok = await confirm({
      title: `บันทึกแพลน ${monthLabel(month)} ลงชีต?`,
      description: [
        create.length ? `สร้าง ${create.length} slot (เขียนทั้งแท็บ Deal Mc และ Admin เสริม)` : "",
        campaigns.length ? `แก้ Campaign ${campaigns.length} slot` : "",
        deletes.length ? `ลบ ${deletes.length} slot ที่ยังว่าง` : "",
      ].filter(Boolean).join(" · "),
      confirmText: "บันทึกลงชีต",
    });
    if (!ok) return;
    setSaving(true);
    try {
      if (deletes.length) {
        const res = await api<{ deleted: number; kept: number }>("/api/plan", {
          slots: deletes.map((s) => ({ mcId: s.mc?.id, adminId: s.admin?.id })),
        }, "DELETE");
        if (!res.ok) throw new Error(res.message);
        update((d) => ({ ...d, del: [] }));
        if (res.kept) toast(`มี ${res.kept} slot ที่มีคนจองแล้ว ไม่ได้ลบ`, "error");
      }
      if (create.length || campaigns.length) {
        const res = await api<{ created: number; skipped: number; updated: number }>("/api/plan", {
          create: create.map((s) => ({ date: s.date, platform: s.platform, start: s.start, end: s.end, campaign: s.campaign })),
          campaigns,
        });
        if (!res.ok) throw new Error(res.message);
      }
      update(() => EMPTY);
      toast("บันทึกแล้ว ระบบกำลังเขียนลงชีต (อาจใช้เวลา 1–2 นาที)");
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function clearDraft() {
    if (!(await confirm({ title: "ล้างร่างของเดือนนี้ทั้งหมด?", description: "slot ที่บันทึกลงชีตแล้วไม่หาย", confirmText: "ล้างร่าง", destructive: true }))) return;
    update(() => EMPTY);
  }

  const live = items.filter((x) => !x.deleting && !x.existing?.mc?.cancelled);
  const hours = live.reduce((h, x) => h + lenOf(x) / 60, 0);
  const days = daysOf(month);
  const overlaps = items.filter((x) => x.overlap).length;

  return (
    <div className="pb-28">
      <div className="my-2 flex flex-wrap items-center gap-2">
        <IconButton label="เดือนก่อนหน้า" onClick={() => setMonth(monthKey(-1, month))}><ChevronLeftIcon /></IconButton>
        <MonthPicker value={month} onChange={setMonth} aria-label="เลือกเดือน" className="w-auto rounded-full" />
        <IconButton label="เดือนถัดไป" onClick={() => setMonth(monthKey(1, month))}><ChevronRightIcon /></IconButton>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={view}
          onValueChange={(v) => { if (v) writeLocal(VIEW_KEY, v); }}
          aria-label="มุมมอง"
          className="ml-auto bg-card"
        >
          <ToggleGroupItem value="matrix" className="font-semibold">ภาพรวมทั้งเดือน</ToggleGroupItem>
          <ToggleGroupItem value="sheet" className="font-semibold">แบบชีต</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {error?.month === month && !plan ? (
        <LoadError title="โหลดแพลนไม่สำเร็จ" message={error.message} onRetry={reload} />
      ) : !plan ? (
        <LoadingBlock />
      ) : (
        <>
          <PatternPanel
            key={month}
            month={month}
            platforms={plan.platforms}
            campaigns={plan.campaigns}
            onAdd={(list) => report(addSlots(list))}
            onCopyPrev={copyPrevMonth}
          />
          <CampaignPanel key={`c-${month}`} month={month} items={items} platforms={platforms} onApply={setCampaign} />
          <datalist id="plan-campaigns">{plan.campaigns.map((c) => <option key={c} value={c} />)}</datalist>
          <datalist id="plan-platforms">{plan.platforms.map((p) => <option key={p} value={p} />)}</datalist>

          <div className="mt-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <strong className="text-base">{monthLabel(month)}</strong>
            <span className="text-muted-foreground tabular-nums">{live.length} slot · {num(hours)} ชม.</span>
            {platforms.map((p) => {
              const mine = live.filter((x) => x.platform === p);
              return (
                <span key={p} className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                  <PlatformBadge name={p} index={tagIndex(p)} />{mine.length} slot · {num(mine.reduce((h, x) => h + lenOf(x) / 60, 0))} ชม.
                </span>
              );
            })}
          </div>
          <Legend />
          {overlaps ? (
            <Notice variant="warning">มี {overlaps} slot ที่เวลาทับกันในแพลตฟอร์มเดียวกัน (กรอบสีส้ม) ตรวจดูก่อนบันทึก</Notice>
          ) : null}

          {!items.length ? (
            <StateBox title={`${monthLabel(month)} ยังไม่มี slot`}>
              ใช้ &quot;เติมทั้งเดือน&quot; ด้านบน หรือคัดลอกรูปแบบจากเดือนก่อน แล้วกด &quot;บันทึกลงชีต&quot;
            </StateBox>
          ) : view === "matrix" ? (
            <MatrixView days={days} items={items} platforms={platforms} tagIndex={tagIndex} onOpenDay={setOpenDay} />
          ) : (
            <SheetView items={items} tagIndex={tagIndex} onOpenDay={setOpenDay} />
          )}
          {view === "matrix" && items.length ? (
            <p className="mt-2 text-xs text-muted-foreground">แตะที่วันเพื่อเพิ่ม / ลบ slot หรือใส่ Campaign ของวันนั้น</p>
          ) : null}
        </>
      )}

      {openDay && plan ? (
        <DayDialog
          key={openDay}
          date={openDay}
          items={items.filter((x) => x.date === openDay)}
          platforms={platforms.length ? platforms : plan.platforms}
          tagIndex={tagIndex}
          onAdd={(s) => addSlots([s])}
          onRemoveNew={removeNew}
          onToggleDelete={toggleDelete}
          onCampaign={setCampaign}
          onMove={(n) => setOpenDay(days[days.indexOf(openDay) + n] ?? openDay)}
          onClose={() => setOpenDay(null)}
        />
      ) : null}

      {changes.total ? (
        <div className="slot-bar-open fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-[1200px] items-center gap-2">
            <div className="min-w-0 flex-1 text-sm">
              <strong>ร่าง {monthLabel(month)}</strong>
              <span className="block truncate text-xs text-muted-foreground">
                {[
                  changes.create.length ? `+${changes.create.length} slot ใหม่` : "",
                  changes.campaigns.length ? `แก้ Campaign ${changes.campaigns.length}` : "",
                  changes.deletes.length ? `ลบ ${changes.deletes.length}` : "",
                ].filter(Boolean).join(" · ")} — ยังไม่ลงชีตจนกว่าจะกดบันทึก
              </span>
            </div>
            <Button variant="outline" size="lg" disabled={saving} onClick={clearDraft}>ล้างร่าง</Button>
            <Button size="lg" disabled={saving} onClick={save}>
              {saving ? <><Spinner />กำลังบันทึก...</> : "บันทึกลงชีต"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- ชิ้นส่วนแสดงผล ----------

function chipClass(x: Item) {
  return cn(
    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums",
    x.deleting ? "border-destructive/60 bg-destructive/10 text-destructive line-through"
      : !x.existing ? "border-dashed border-primary bg-primary/10 font-semibold text-primary"
        : x.existing.mc?.cancelled ? "bg-muted text-muted-foreground line-through"
          : x.existing.mc?.name ? "border-transparent bg-secondary text-secondary-foreground"
            : "bg-card",
    x.overlap && "ring-2 ring-warning-border",
  );
}

const chipTitle = (x: Item) => [
  `${x.platform} ${x.start}–${x.end}`,
  x.campaign ? `Campaign: ${x.campaign}` : "",
  !x.existing ? "ร่างใหม่ (ยังไม่ลงชีต)"
    : `Mc: ${x.existing.mc?.name || "ว่าง"} · Admin: ${x.existing.admin?.name || "ว่าง"}${x.existing.mc?.cancelled ? " · แคน" : ""}`,
  x.deleting ? "จะลบตอนบันทึก" : "",
].filter(Boolean).join("\n");

function Legend() {
  const sample = (cls: string, text: string) => (
    <span className="flex items-center gap-1"><span className={cn("inline-block h-3.5 w-6 rounded border", cls)} />{text}</span>
  );
  return (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {sample("bg-card", "มีในชีตแล้ว (ยังว่าง)")}
      {sample("border-transparent bg-secondary", "มีคนจองแล้ว")}
      {sample("border-dashed border-primary bg-primary/10", "ร่างใหม่")}
      {sample("border-destructive/60 bg-destructive/10", "จะลบ")}
    </div>
  );
}

/** ภาพรวมทั้งเดือน: แถว = วัน, คอลัมน์ = แพลตฟอร์ม, ช่อง = ช่วงเวลา */
function MatrixView({ days, items, platforms, tagIndex, onOpenDay }: {
  days: string[];
  items: Item[];
  platforms: string[];
  tagIndex: (p: string) => number;
  onOpenDay: (d: string) => void;
}) {
  const byCell = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const x of items) m.set(`${x.date}|${x.platform}`, [...(m.get(`${x.date}|${x.platform}`) ?? []), x]);
    return m;
  }, [items]);
  const today = todayKey();
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs">
            <th className="sticky left-0 z-10 w-20 bg-muted px-2 py-2 font-semibold">วันที่</th>
            {platforms.map((p) => (
              <th key={p} className="px-2 py-2 font-semibold"><PlatformBadge name={p} index={tagIndex(p)} /></th>
            ))}
            <th className="w-40 px-2 py-2 font-semibold">Campaign</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const wd = parseKey(d).getUTCDay();
            const mine = items.filter((x) => x.date === d && !x.deleting);
            const camps = [...new Set(mine.map((x) => x.campaign).filter(Boolean))];
            return (
              <tr
                key={d}
                onClick={() => onOpenDay(d)}
                className={cn("cursor-pointer border-b align-top last:border-b-0 hover:bg-muted/60", (wd === 0 || wd === 6) && "bg-muted/30")}
              >
                <th scope="row" className={cn("sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-semibold whitespace-nowrap", d === today && "text-primary")}>
                  <button type="button" className="outline-none focus-visible:underline" onClick={(e) => { e.stopPropagation(); onOpenDay(d); }}>
                    {fmtDayNum(d)}
                  </button>
                </th>
                {platforms.map((p) => (
                  <td key={p} className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {(byCell.get(`${d}|${p}`) ?? []).map((x) => (
                        <span key={x.key} className={chipClass(x)} title={chipTitle(x)}>{x.start}–{x.end}</span>
                      ))}
                    </div>
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {camps.map((c) => <Badge key={c} variant="secondary" className="text-[11px]">{c}</Badge>)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** แบบชีต: เรียงและคอลัมน์เหมือนแท็บ "ลงตาราง Deal Mc" (Admin เพิ่มเป็นอีกคอลัมน์) */
function SheetView({ items, tagIndex, onOpenDay }: { items: Item[]; tagIndex: (p: string) => number; onOpenDay: (d: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs">
            {["Platform", "วันที่", "เวลาเริ่ม", "เวลาจบ", "Campaign", "Mc", "Admin", ""].map((h, i) => (
              <th key={i} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr
              key={x.key}
              onClick={() => onOpenDay(x.date)}
              className={cn(
                "cursor-pointer border-b last:border-b-0 hover:bg-muted/60",
                !x.existing && "bg-primary/5",
                x.deleting && "text-destructive line-through",
                x.overlap && "bg-warning",
              )}
            >
              <td className="px-2 py-1.5"><PlatformBadge name={x.platform} index={tagIndex(x.platform)} /></td>
              <td className="px-2 py-1.5 whitespace-nowrap">{fmtDayNum(x.date)}</td>
              <td className="px-2 py-1.5 tabular-nums">{x.start}</td>
              <td className="px-2 py-1.5 tabular-nums">{x.end}</td>
              <td className={cn("px-2 py-1.5", x.campaignChanged && "font-semibold text-primary")}>{x.campaign}</td>
              <td className="px-2 py-1.5">{x.existing ? (x.existing.mc?.name ? `Mc ${x.existing.mc.name}` : <span className="text-muted-foreground">ว่าง</span>) : ""}</td>
              <td className="px-2 py-1.5">
                {x.existing ? (x.existing.admin?.name || <span className="text-muted-foreground">{x.existing.admin ? "ว่าง" : "–"}</span>) : ""}
              </td>
              <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap">
                {x.deleting ? <Badge variant="destructive">จะลบ</Badge>
                  : !x.existing ? <Badge>ร่างใหม่</Badge>
                    : x.existing.mc?.cancelled ? <Badge variant="secondary">แคน</Badge>
                      : x.campaignChanged ? <Badge variant="outline">แก้ Campaign</Badge> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- เติมทั้งเดือน ----------

function PatternPanel({ month, platforms, campaigns, onAdd, onCopyPrev }: {
  month: string;
  platforms: string[];
  campaigns: string[];
  onAdd: (list: NewSlot[]) => void;
  onCopyPrev: () => void;
}) {
  const ids = { platform: useId(), campaign: useId() };
  const days = daysOf(month);
  const first = days[0], last = days[days.length - 1];
  const today = todayKey();
  const [platform, setPlatform] = useState(platforms[0] ?? "");
  const [from, setFrom] = useState(today > first && today <= last ? today : first);
  const [to, setTo] = useState(last);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [times, setTimes] = useState([{ start: "09:30", end: "11:30" }]);
  const [campaign, setCampaign] = useState("");
  // เติมช่วงต่อกัน เช่น 09:30 ถึง 23:30 ช่วงละ 2 ชม. = 7 ช่วง
  const [span, setSpan] = useState({ start: "09:30", end: "23:30", hours: "2" });

  const dates = days.filter((d) => d >= from && d <= to && weekdays.has(parseKey(d).getUTCDay()));
  const valid = times.filter((t) => t.start && t.end && t.start !== t.end);
  const total = dates.length * valid.length;

  function setTime(i: number, field: "start" | "end", value: string) {
    setTimes(times.map((t, j) => (j === i ? { ...t, [field]: value } : t)));
  }
  function addTime() {
    const lastT = times[times.length - 1];
    if (!lastT) { setTimes([{ start: "09:30", end: "11:30" }]); return; }
    const len = lenOf(lastT) || 120;
    setTimes([...times, { start: lastT.end, end: fmtMin(toMin(lastT.end) + len) }]);
  }
  function fillSpan() {
    const step = Math.round(Number(span.hours) * 60);
    if (!(step >= 15) || !span.start || !span.end) return;
    const totalLen = (toMin(span.end) - toMin(span.start) + 1440) % 1440 || 1440;
    const out: { start: string; end: string }[] = [];
    for (let m = 0; m + step <= totalLen && out.length < 24; m += step) {
      out.push({ start: fmtMin(toMin(span.start) + m), end: fmtMin(toMin(span.start) + m + step) });
    }
    if (out.length) setTimes(out);
  }

  return (
    <Card className="my-3 shadow-card">
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="flex items-center gap-1.5 text-base"><WandSparklesIcon className="size-4 text-primary" />เติมทั้งเดือน</strong>
          <Button variant="outline" onClick={onCopyPrev}><CopyIcon />คัดลอกรูปแบบจาก {monthLabel(monthKey(-1, month))}</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Label htmlFor={ids.platform} className="mb-1.5 font-semibold">แพลตฟอร์ม</Label>
              <Input id={ids.platform} list="plan-platforms" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="เช่น Shopee, TikTok" />
              {platforms.length > 1 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {platforms.slice(0, 6).map((p) => (
                    <Button key={p} size="xs" variant={p === platform ? "default" : "outline"} onClick={() => setPlatform(p)}>{p}</Button>
                  ))}
                </div>
              ) : null}
            </div>
            <div>
              <span className="mb-1.5 block font-semibold">วันที่</span>
              <div className="flex items-center gap-2">
                <DatePicker value={from} min={first} onChange={(v) => { if (v) { setFrom(v < first ? first : v > last ? last : v); if (v > to) setTo(v > last ? last : v); } }} aria-label="ตั้งแต่วันที่" className="flex-1" />
                <span className="text-muted-foreground">ถึง</span>
                <DatePicker value={to} min={from} onChange={(v) => { if (v) setTo(v > last ? last : v); }} aria-label="ถึงวันที่" className="flex-1" />
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
              <p className="mt-1 text-xs text-muted-foreground">{dates.length} วัน</p>
            </div>
            <div>
              <Label htmlFor={ids.campaign} className="mb-1.5 font-semibold">Campaign (ไม่บังคับ)</Label>
              <Input id={ids.campaign} list="plan-campaigns" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="เช่น Pay Day" />
              {campaigns.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {campaigns.slice(0, 6).map((c) => (
                    <Button key={c} size="xs" variant={c === campaign ? "default" : "outline"} onClick={() => setCampaign(c === campaign ? "" : c)}>{c}</Button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block font-semibold">ช่วงเวลา ({valid.length})</span>
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
            <div className="mt-2 rounded-lg border border-dashed p-2">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">หรือแบ่งช่วงต่อกันอัตโนมัติ</span>
              <div className="flex flex-wrap items-center gap-2">
                <TimePicker value={span.start} onChange={(v) => setSpan({ ...span, start: v })} aria-label="แบ่งช่วง: ตั้งแต่" className="w-28" />
                <span className="text-muted-foreground">ถึง</span>
                <TimePicker value={span.end} onChange={(v) => setSpan({ ...span, end: v })} aria-label="แบ่งช่วง: ถึง" className="w-28" />
                <span className="text-muted-foreground">ช่วงละ</span>
                <Input inputMode="decimal" value={span.hours} onChange={(e) => setSpan({ ...span, hours: e.target.value })} aria-label="ช่วงละกี่ชั่วโมง" className="w-14" />
                <span className="text-muted-foreground">ชม.</span>
                <Button variant="outline" size="sm" onClick={fillSpan}>แบ่ง</Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">เวลาจบก่อนเวลาเริ่ม = ข้ามเที่ยงคืน เช่น 23:30–01:30</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {total ? `${dates.length} วัน × ${valid.length} ช่วง = ${total} slot (slot ที่มีอยู่แล้วจะถูกข้าม)` : "เลือกวันและช่วงเวลา"}
          </span>
          <Button
            disabled={!platform.trim() || !total}
            onClick={() => onAdd(dates.flatMap((d) => valid.map((t) => ({ date: d, platform: platform.trim(), start: t.start, end: t.end, campaign: campaign.trim() }))))}
          >
            <PlusIcon />เพิ่มลงร่าง
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Campaign ตามช่วงวัน ----------

function CampaignPanel({ month, items, platforms, onApply }: {
  month: string;
  items: Item[];
  platforms: string[];
  onApply: (keys: string[], campaign: string) => void;
}) {
  const toast = useToast();
  const id = useId();
  const days = daysOf(month);
  const [from, setFrom] = useState(days[0]);
  const [to, setTo] = useState(days[days.length - 1]);
  const [platform, setPlatform] = useState(ALL);
  const [campaign, setCampaign] = useState("");
  const targets = items.filter((x) => x.date >= from && x.date <= to && (platform === ALL || x.platform === platform)
    && !x.deleting && (!x.existing || x.existing.mc));

  return (
    <Card className="my-3 shadow-card">
      <CardContent className="space-y-3 text-sm">
        <strong className="flex items-center gap-1.5 text-base"><TagIcon className="size-4 text-primary" />ตั้ง Campaign ตามช่วงวัน</strong>
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker value={from} min={days[0]} onChange={(v) => { if (v) { setFrom(v); if (v > to) setTo(v); } }} aria-label="Campaign ตั้งแต่วันที่" className="w-auto" />
          <span className="text-muted-foreground">ถึง</span>
          <DatePicker value={to} min={from} onChange={(v) => { if (v) setTo(v); }} aria-label="Campaign ถึงวันที่" className="w-auto" />
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger aria-label="แพลตฟอร์ม" className="w-auto min-w-36"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ALL}>ทุกแพลตฟอร์ม</SelectItem>
              {platforms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input id={id} list="plan-campaigns" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="ชื่อ Campaign (ว่าง = ล้าง)" aria-label="ชื่อ Campaign" className="w-48 flex-1" />
          <Button
            variant="outline"
            disabled={!targets.length}
            onClick={() => { onApply(targets.map((x) => x.key), campaign.trim()); toast(`ตั้ง Campaign ${targets.length} slot ในร่างแล้ว`); }}
          >
            ใช้กับ {targets.length} slot
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">ใช้ได้ทั้ง slot ร่างใหม่และ slot ที่มีในชีตแล้ว (แก้คอลัมน์ Campaign ในแท็บ Deal Mc ตอนกดบันทึก)</p>
      </CardContent>
    </Card>
  );
}

// ---------- แก้รายวัน ----------

function DayDialog({ date, items, platforms, tagIndex, onAdd, onRemoveNew, onToggleDelete, onCampaign, onMove, onClose }: {
  date: string;
  items: Item[];
  platforms: string[];
  tagIndex: (p: string) => number;
  onAdd: (s: NewSlot) => { added: number; skipped: number };
  onRemoveNew: (key: string) => void;
  onToggleDelete: (key: string) => void;
  onCampaign: (keys: string[], campaign: string) => void;
  onMove: (n: number) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const ids = { platform: useId(), campaign: useId(), dayCampaign: useId() };
  const lastItem = items.filter((x) => !x.deleting).at(-1);
  const [platform, setPlatform] = useState(lastItem?.platform ?? platforms[0] ?? "");
  const [start, setStart] = useState(lastItem?.end ?? "09:30");
  const [end, setEnd] = useState(lastItem ? fmtMin(toMin(lastItem.end) + (lenOf(lastItem) || 120)) : "11:30");
  const dayCamp = [...new Set(items.filter((x) => !x.deleting).map((x) => x.campaign))];
  const [campaign, setCampaign] = useState(dayCamp.length === 1 ? dayCamp[0] : "");
  const [allCampaign, setAllCampaign] = useState(dayCamp.length === 1 ? dayCamp[0] : "");
  const editable = items.filter((x) => !x.deleting && (!x.existing || x.existing.mc));
  const groups = [...new Set([...platforms.filter((p) => items.some((x) => x.platform === p)), ...items.map((x) => x.platform)])];

  function add() {
    if (!platform.trim() || !start || !end || start === end) return;
    const res = onAdd({ date, platform: platform.trim(), start, end, campaign: campaign.trim() });
    if (!res.added) { toast("มี slot นี้อยู่แล้ว", "error"); return; }
    const len = lenOf({ start, end }) || 120;
    setStart(end);
    setEnd(fmtMin(toMin(end) + len));
  }

  return (
    <AppDialog open onClose={onClose} title={fmtDayLong.format(parseKey(date))} description={'แก้ในร่าง ยังไม่ลงชีตจนกว่าจะกด "บันทึกลงชีต"'} className="sm:max-w-xl">
      <DialogBody className="space-y-4 text-sm">
        {!items.length ? <p className="text-muted-foreground">วันนี้ยังไม่มี slot</p> : groups.map((p) => (
          <section key={p}>
            <PlatformBadge name={p} index={tagIndex(p)} className="mb-1.5" />
            <div className="divide-y rounded-lg border">
              {items.filter((x) => x.platform === p).map((x) => {
                const ex = x.existing;
                const locked = !!ex && !canDelete(ex);
                return (
                  <div key={x.key} className={cn("flex flex-wrap items-center gap-2 px-2 py-1.5", x.deleting && "bg-destructive/5", x.overlap && "bg-warning")}>
                    <span className={cn(chipClass(x), "text-sm")}>{x.start}–{x.end}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {!ex ? "ร่างใหม่"
                        : `Mc ${ex.mc?.name || "ว่าง"} · Admin ${ex.admin?.name || "ว่าง"}${ex.mc?.cancelled ? " · แคน" : ""}${x.deleting ? " · จะลบ" : ""}`}
                    </span>
                    {!x.deleting && (!ex || ex.mc) ? (
                      <Input
                        list="plan-campaigns"
                        value={x.campaign}
                        onChange={(e) => onCampaign([x.key], e.target.value)}
                        placeholder="Campaign"
                        aria-label={`Campaign ${x.start}–${x.end}`}
                        className={cn("h-8 w-36", x.campaignChanged && "border-primary")}
                      />
                    ) : null}
                    {!ex ? (
                      <IconButton label="เอาออกจากร่าง" variant="ghost" className="text-muted-foreground" onClick={() => onRemoveNew(x.key)}><XIcon /></IconButton>
                    ) : x.deleting ? (
                      <IconButton label="ยกเลิกการลบ" variant="ghost" onClick={() => onToggleDelete(x.key)}><Undo2Icon /></IconButton>
                    ) : (
                      <IconButton
                        label={locked ? "มีคนจองแล้ว ลบไม่ได้ (เอาคนออกที่หน้าจัดการ slot ก่อน)" : "ลบ slot นี้ (ตอนบันทึก)"}
                        variant="ghost"
                        disabled={locked}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onToggleDelete(x.key)}
                      >
                        <Trash2Icon />
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {editable.length > 1 ? (
          <div className="flex items-center gap-2">
            <Input id={ids.dayCampaign} list="plan-campaigns" value={allCampaign} onChange={(e) => setAllCampaign(e.target.value)} placeholder="Campaign ทั้งวัน" aria-label="Campaign ทั้งวัน" />
            <Button variant="outline" className="shrink-0" onClick={() => onCampaign(editable.map((x) => x.key), allCampaign.trim())}>
              ใช้กับทั้งวัน ({editable.length})
            </Button>
          </div>
        ) : null}

        <div className="rounded-lg border border-dashed p-3">
          <span className="mb-2 block font-semibold">เพิ่ม slot</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input id={ids.platform} list="plan-platforms" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="แพลตฟอร์ม" aria-label="แพลตฟอร์ม" />
            <Input id={ids.campaign} list="plan-campaigns" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Campaign (ไม่บังคับ)" aria-label="Campaign" />
            <div className="flex items-center gap-2 sm:col-span-2">
              <TimePicker value={start} onChange={setStart} aria-label="เวลาเริ่ม" className="flex-1" />
              <span className="text-muted-foreground">–</span>
              <TimePicker value={end} onChange={setEnd} aria-label="เวลาจบ" className="flex-1" />
              <Button disabled={!platform.trim() || !start || !end || start === end} onClick={add}><PlusIcon />เพิ่ม</Button>
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogActions>
        <IconButton label="วันก่อนหน้า" variant="outline" className="mr-auto" onClick={() => onMove(-1)}><ChevronLeftIcon /></IconButton>
        <IconButton label="วันถัดไป" variant="outline" onClick={() => onMove(1)}><ChevronRightIcon /></IconButton>
        <Button size="lg" onClick={onClose}>เสร็จ</Button>
      </DialogActions>
    </AppDialog>
  );
}
