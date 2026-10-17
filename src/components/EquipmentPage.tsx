"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CameraIcon, LayoutGridIcon, PackageIcon, PlusIcon, Rows3Icon, SearchIcon, Trash2Icon } from "lucide-react";
import { useLocal, writeLocal } from "@/lib/hooks";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EQUIPMENT_STATUSES, type Equipment, type EquipmentStatus } from "@/lib/types";
import { SPEC_FIELDS, isComputer, specLine } from "@/lib/equipment";
import { money, parseKey } from "@/lib/format";
import { shrinkImage } from "@/lib/image";
import type { ExportBook } from "@/lib/export";
import { ExportMenu } from "@/components/ExportMenu";
import { AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, StateBox, Stats, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * อุปกรณ์โปรดักชั่น: ทะเบียนว่ามีอะไรบ้าง อยู่ที่ไหน สถานะ รูป ยี่ห้อ/รุ่น/Serial วันที่ซื้อ ราคา
 *   ค้นหา / กรองหมวด + สถานะ / เพิ่ม แก้ ลบ / ส่งออก Excel · Google Sheet
 */

const ALL = "__all";
const NO_CAT = "ไม่ระบุหมวด";
const NO_PLACE = "ไม่ระบุที่เก็บ";
const VIEW_KEY = "glory_equipment_view";
const STATUS_TONE: Record<EquipmentStatus, string> = {
  "ใช้งานได้": "bg-success/15 text-success",
  "ชำรุด": "bg-destructive/10 text-destructive",
  "ส่งซ่อม": "border-warning-border bg-warning text-warning-foreground",
  "หาย": "bg-destructive text-white",
  "เลิกใช้": "bg-muted text-muted-foreground",
};
/** จุดสีบนปุ่มกรองสถานะ */
const STATUS_DOT: Record<string, string> = {
  "ใช้งานได้": "bg-success", "ชำรุด": "bg-destructive", "ส่งซ่อม": "bg-amber-500", "หาย": "bg-destructive", "เลิกใช้": "bg-muted-foreground",
};
// ปี ค.ศ. แบบทั้งเว็บ (th-TH เฉยๆ = ปี พ.ศ.)
const fmtDate = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateText = (d: string | null) => (d ? fmtDate.format(parseKey(d)) : "");
/** เวลา ISO -> วันที่ตามเวลาไทย "YYYY-MM-DD" (slice ตรงๆ = วันตาม UTC แก้หลังเที่ยงคืนไทยจะได้วันก่อนหน้า) */
const bkkDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);
const valueOf = (x: Equipment) => (x.price ?? 0) * x.quantity;
/** ลิงก์รูปจาก API หมดอายุใน 1 ชม. -> กลับมาที่แท็บหลังนานกว่านี้ = โหลดรายการใหม่ */
const PHOTO_REFRESH_MS = 50 * 60_000;
const codeKey = (c: string) => c.trim().toUpperCase();

export function EquipmentPage() {
  const [items, setItems] = useState<Equipment[] | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [editing, setEditing] = useState<Equipment | "new" | null>(null);
  const reload = () => setTick((n) => n + 1);

  const loadedAt = useRef(0);
  useEffect(() => {
    let alive = true;
    api<{ items: Equipment[] }>("/api/equipment")
      .then((res) => {
        if (!alive) return;
        if (res.ok) { setItems(res.items); setError(""); loadedAt.current = Date.now(); } else setError(res.message ?? "โหลดไม่สำเร็จ");
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick]);

  // เปิดหน้าทิ้งไว้แล้วกลับมาที่แท็บ: ลิงก์รูปใกล้หมดอายุ = โหลดใหม่ (ไม่งั้นรูปขึ้นไม่ได้)
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible" && loadedAt.current && Date.now() - loadedAt.current > PHOTO_REFRESH_MS) {
        loadedAt.current = Date.now(); // กันโหลดซ้ำระหว่างรอ
        setTick((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

  const categories = useMemo(() => [...new Set((items ?? []).map((x) => x.category || NO_CAT))].sort((a, b) => a.localeCompare(b, "th")), [items]);
  const locations = useMemo(() => [...new Set((items ?? []).map((x) => x.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [items]);
  const [place, setPlace] = useState(ALL);
  const view = useLocal(VIEW_KEY) === "table" ? "table" : "card";
  // ตัวกรองแต่ละแบบ (ใช้ทั้งนับจำนวนบนปุ่ม และกรองรายการ)
  const q = search.trim().toLowerCase();
  const match = {
    cat: (x: Equipment) => cat === ALL || (x.category || NO_CAT) === cat,
    status: (x: Equipment) => status === ALL || x.status === status,
    place: (x: Equipment) => place === ALL || (x.location || NO_PLACE) === place,
    search: (x: Equipment) => !q || [x.code, x.name, x.brand, x.model, x.serial, x.location, x.note, x.category, ...Object.values(x.specs)].some((v) => v.toLowerCase().includes(q)),
  };
  const passAll = (x: Equipment, skip?: keyof typeof match) => (Object.keys(match) as (keyof typeof match)[]).every((k) => k === skip || match[k](x));
  const list = (items ?? []).filter((x) => passAll(x));

  if (!items) return error ? <LoadError title="โหลดรายการอุปกรณ์ไม่สำเร็จ" message={error} onRetry={reload} /> : <LoadingBlock />;

  const groups = categories.map((c) => [c, list.filter((x) => (x.category || NO_CAT) === c)] as const).filter(([, l]) => l.length);
  const problems = items.filter((x) => x.status === "ชำรุด" || x.status === "ส่งซ่อม" || x.status === "หาย").length;
  // จำนวนบนปุ่มกรอง = ตามตัวกรองอื่นที่เลือกอยู่
  const countBy = (skip: keyof typeof match, key: (x: Equipment) => string) => {
    const m = new Map<string, number>();
    for (const x of items) if (passAll(x, skip)) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
    return m;
  };
  const catCount = countBy("cat", (x) => x.category || NO_CAT);
  const statusCount = countBy("status", (x) => x.status);
  const placeCount = countBy("place", (x) => x.location || NO_PLACE);
  const filtered = cat !== ALL || status !== ALL || place !== ALL || !!q;

  return (
    <div className="pb-10">
      <Stats items={[
        [String(items.length), "รายการ"],
        [String(items.reduce((a, x) => a + x.quantity, 0)), "ชิ้น"],
        [items.some((x) => x.price !== null) ? money(items.reduce((a, x) => a + valueOf(x), 0)) : "–", "มูลค่ารวม (บาท)"],
      ]} />
      {problems ? <p className="mt-1 text-sm font-semibold text-warning-foreground">ชำรุด / ส่งซ่อม / หาย {problems} รายการ</p> : null}

      <div className="my-3 flex flex-wrap items-center gap-2">
        <InputGroup className="h-9 min-w-48 flex-1 bg-card">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหารหัส ชื่อ ยี่ห้อ รุ่น สเปค" aria-label="ค้นหา" />
        </InputGroup>
        <Button size="lg" onClick={() => setEditing("new")}><PlusIcon />เพิ่มอุปกรณ์</Button>
      </div>

      {/* ตัวกรอง: กดปุ่มได้เลย ตัวเลข = จำนวนรายการตามตัวกรองอื่นที่เลือกอยู่ */}
      <div className="space-y-1.5 rounded-xl border bg-card p-2.5">
        <ChipRow label="หมวด" value={cat} onChange={setCat} options={categories.filter((c) => catCount.has(c) || c === cat).map((c) => [c, catCount.get(c) ?? 0])} total={[...catCount.values()].reduce((a, b) => a + b, 0)} />
        <ChipRow label="สถานะ" value={status} onChange={setStatus} dot={STATUS_DOT}
          options={EQUIPMENT_STATUSES.filter((s) => statusCount.has(s) || s === status).map((s) => [s, statusCount.get(s) ?? 0])}
          total={[...statusCount.values()].reduce((a, b) => a + b, 0)} />
        {locations.length ? (
          <ChipRow label="ที่เก็บ" value={place} onChange={setPlace}
            options={[...locations, NO_PLACE].filter((l) => placeCount.has(l) || l === place).map((l) => [l, placeCount.get(l) ?? 0])}
            total={[...placeCount.values()].reduce((a, b) => a + b, 0)} />
        ) : null}
      </div>

      <div className="mt-3 mb-1 flex flex-wrap items-center gap-2">
        <span className="w-full min-w-0 text-sm text-muted-foreground sm:w-auto sm:flex-1">
          แสดง <b className="text-foreground">{list.length}</b> รายการ · {list.reduce((a, x) => a + x.quantity, 0)} ชิ้น
          {list.some((x) => x.price !== null) ? <> · {money(list.reduce((a, x) => a + valueOf(x), 0))} บาท</> : null}
          {filtered ? (
            <button type="button" className="ml-2 cursor-pointer font-semibold text-primary underline-offset-2 hover:underline"
              onClick={() => { setCat(ALL); setStatus(ALL); setPlace(ALL); setSearch(""); }}>ล้างตัวกรอง</button>
          ) : null}
        </span>
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={view} onValueChange={(v) => { if (v) writeLocal(VIEW_KEY, v); }} aria-label="รูปแบบการแสดงผล" className="bg-card">
          <ToggleGroupItem value="card" aria-label="แสดงแบบการ์ด" className="text-xs pointer-coarse:min-h-9 pointer-coarse:px-3"><LayoutGridIcon />การ์ด</ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="แสดงแบบตาราง" className="text-xs pointer-coarse:min-h-9 pointer-coarse:px-3"><Rows3Icon />ตาราง</ToggleGroupItem>
        </ToggleGroup>
        <ExportMenu label="ส่งออก" size="sm" build={() => exportBook(list)} />
      </div>

      {!items.length ? (
        <StateBox title="ยังไม่มีอุปกรณ์">กด &quot;เพิ่มอุปกรณ์&quot; เพื่อเริ่มทำทะเบียน</StateBox>
      ) : !list.length ? (
        <StateBox title="ไม่พบอุปกรณ์">ลองค้นหาด้วยคำอื่น หรือเปลี่ยนตัวกรอง</StateBox>
      ) : view === "table" ? (
        <div className="mt-2 overflow-x-auto rounded-xl border bg-card">
          {/* มือถือ: ซ่อนหมวด / ที่เก็บ / ราคา ให้ตารางพอดีจอ */}
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold sm:[&>th]:px-3">
                <th>รหัส</th><th>ชื่อ</th>
                {cat === ALL ? <th className="hidden sm:table-cell">หมวด</th> : null}
                <th className="text-right">จำนวน</th><th>สถานะ</th>
                <th className="hidden sm:table-cell">ที่เก็บ</th><th className="hidden text-right sm:table-cell">ราคา</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap(([, rows]) => rows).map((x) => (
                <tr key={x.id} onClick={() => setEditing(x)} className="cursor-pointer border-t hover:bg-muted/50 [&>td]:px-2 [&>td]:py-1.5 sm:[&>td]:px-3">
                  <td className="font-mono text-xs whitespace-nowrap">{x.code || "–"}</td>
                  <td>
                    <span className="font-medium">{x.name}</span>
                    {[x.brand, x.model].some(Boolean) || specLine(x.specs) ? (
                      <span className="block text-xs text-muted-foreground">{[[x.brand, x.model].filter(Boolean).join(" "), specLine(x.specs)].filter(Boolean).join(" · ")}</span>
                    ) : null}
                    {/* มือถือ: ที่เก็บอยู่ใต้ชื่อแทนคอลัมน์ */}
                    {x.location ? <span className="block text-xs text-muted-foreground sm:hidden">📍 {x.location}</span> : null}
                  </td>
                  {cat === ALL ? <td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{x.category || NO_CAT}</td> : null}
                  <td className="text-right tabular-nums">{x.quantity}</td>
                  <td><Badge className={cn("text-[11px]", STATUS_TONE[x.status])}>{x.status}</Badge></td>
                  <td className="hidden text-muted-foreground sm:table-cell">{x.location || "–"}</td>
                  <td className="hidden text-right whitespace-nowrap tabular-nums sm:table-cell">{x.price !== null ? money(x.price) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : groups.map(([c, rows]) => (
        <section key={c} className="mt-4">
          <h2 className="mb-2 flex items-baseline gap-2 font-bold">
            {c}
            <span className="text-xs font-normal text-muted-foreground">{rows.length} รายการ · {rows.reduce((a, x) => a + x.quantity, 0)} ชิ้น</span>
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((x) => (
              <button
                key={x.id} type="button" onClick={() => setEditing(x)}
                className="flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card p-2.5 text-left shadow-card transition outline-none hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {x.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.photoUrl} alt="" className="size-14 shrink-0 rounded-lg border object-cover" loading="lazy" />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground"><PackageIcon className="size-6" /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="line-clamp-2 font-semibold leading-snug">{x.name}</span>
                    {x.quantity !== 1 ? <span className="shrink-0 text-sm text-muted-foreground">x{x.quantity}</span> : null}
                  </span>
                  {[x.brand, x.model, x.location].some(Boolean) ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {[[x.brand, x.model].filter(Boolean).join(" "), x.location].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  {specLine(x.specs) ? <span className="block truncate text-xs text-foreground/80">{specLine(x.specs)}</span> : null}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    {x.code ? <Badge variant="outline" className="font-mono text-[11px]">{x.code}</Badge> : null}
                    <Badge className={cn("text-[11px]", STATUS_TONE[x.status])}>{x.status}</Badge>
                    {x.price !== null ? <span className="text-xs text-muted-foreground tabular-nums">{money(x.price)} บาท</span> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <datalist id="equip-categories">{categories.filter((c) => c !== NO_CAT).map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="equip-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
      {editing ? (
        <EquipmentDialog item={editing === "new" ? null : editing} items={items} onClose={(changed) => { setEditing(null); if (changed) reload(); }} />
      ) : null}
    </div>
  );
}

/** แถวปุ่มกรอง: "ทั้งหมด" + ตัวเลือก (จำนวน) กดซ้ำที่ตัวที่เลือกอยู่ = กลับเป็นทั้งหมด */
function ChipRow({ label, value, onChange, options, total, dot }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, number][]; total: number; dot?: Record<string, string>;
}) {
  const chip = (key: string, text: string, n: number) => {
    const on = value === key;
    return (
      <button
        key={key} type="button" aria-pressed={on} onClick={() => onChange(on && key !== ALL ? ALL : key)}
        className={cn(
          "flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors pointer-coarse:min-h-9 pointer-coarse:px-3",
          on ? "border-primary bg-primary text-primary-foreground" : cn("bg-background hover:border-primary/50", n === 0 && "opacity-50"),
        )}
      >
        {!on && dot?.[key] ? <span className={cn("size-2 rounded-full", dot[key])} /> : null}
        {text}<span className={cn("tabular-nums", on ? "opacity-80" : "text-muted-foreground")}>{n}</span>
      </button>
    );
  };
  return (
    <div className="flex items-start gap-2">
      <span className="w-11 shrink-0 pt-1.5 text-xs font-semibold text-muted-foreground pointer-coarse:pt-2.5">{label}</span>
      {/* ขึ้นบรรทัดใหม่แทนการเลื่อน → เห็นครบทุกตัวเลือกทีเดียว */}
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {chip(ALL, "ทั้งหมด", total)}
        {options.map(([k, n]) => chip(k, k, n))}
      </div>
    </div>
  );
}

function exportBook(list: Equipment[]): ExportBook {
  const rows = [
    ["หมวด", "รหัส", "ชื่อ", "ยี่ห้อ", "รุ่น", "Serial", "จำนวน", "สถานะ", "ที่เก็บ", "วันที่ซื้อ", "ราคาต่อชิ้น", "มูลค่ารวม", "หมายเหตุ",
      ...SPEC_FIELDS.map(([, l]) => `สเปค: ${l}`)],
    ...list.map((x) => [
      x.category, x.code, x.name, x.brand, x.model, x.serial, x.quantity, x.status, x.location, x.purchaseDate ?? "",
      x.price, x.price === null ? null : valueOf(x), x.note, ...SPEC_FIELDS.map(([k]) => x.specs[k] ?? ""),
    ]),
  ];
  return { title: `GLORY อุปกรณ์โปรดักชั่น ${new Date().toISOString().slice(0, 10)}`, sheets: [{ name: "อุปกรณ์", rows }] };
}

// ---------- เพิ่ม / แก้ ----------

function EquipmentDialog({ item, items, onClose }: { item: Equipment | null; items: Equipment[]; onClose: (changed?: boolean) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(() => ({
    code: item?.code ?? "", name: item?.name ?? "", category: item?.category ?? "", quantity: String(item?.quantity ?? 1), status: item?.status ?? "ใช้งานได้",
    location: item?.location ?? "", brand: item?.brand ?? "", model: item?.model ?? "", serial: item?.serial ?? "",
    purchaseDate: item?.purchaseDate ?? "", price: item?.price === null || item?.price === undefined ? "" : String(item.price), note: item?.note ?? "",
  }));
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  // สเปคคอมพิวเตอร์: ขึ้นเมื่อหมวดเป็นคอมพิวเตอร์ (หรือเคยกรอกไว้)
  const [specs, setSpecs] = useState<Record<string, string>>(() => ({ ...(item?.specs ?? {}) }));
  const showSpecs = isComputer(f.category) || Object.values(specs).some(Boolean);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const shown = photo?.url ?? (removePhoto ? null : item?.photoUrl ?? null);
  // รหัสซ้ำกับรายการอื่น (เช็กจากรายการที่โหลดไว้) = เตือน ไม่บล็อก
  const dupes = codeKey(f.code) ? items.filter((x) => x.id !== item?.id && codeKey(x.code) === codeKey(f.code)) : [];

  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await shrinkImage(file, 1400);
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      setPhoto({ blob, url });
      setRemovePhoto(false);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function save() {
    if (!f.name.trim()) return toast("กรุณาใส่ชื่ออุปกรณ์", "error");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("data", JSON.stringify({ ...f, specs, id: item?.id }));
      if (photo) fd.append("photo", photo.blob, "photo.jpg");
      if (removePhoto) fd.append("removePhoto", "1");
      const res = await fetch("/api/equipment", { method: item ? "PATCH" : "POST", body: fd });
      const json = await res.json().catch(() => null) as { ok?: boolean; message?: string; warning?: string } | null;
      if (!json?.ok) throw new Error(json?.message ?? `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      toast(json.message ?? "บันทึกแล้ว");
      if (json.warning) toast(json.warning, "error");
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  }

  async function remove() {
    if (!item || !(await confirm({ title: `ลบ "${item.name}" ออกจากทะเบียน?`, confirmText: "ลบ", destructive: true }))) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/equipment", { id: item.id }, "DELETE");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  }

  return (
    <AppDialog
      open onClose={() => onClose()} busy={busy}
      title={item ? `แก้ไข ${item.name}` : "เพิ่มอุปกรณ์"}
      description={item?.updatedBy ? `แก้ล่าสุด ${dateText(bkkDay(item.updatedAt))} โดย ${item.updatedBy}` : undefined}
    >
      <DialogBody className="space-y-3 text-sm">
        <div className="flex items-center gap-3">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="รูปอุปกรณ์" className="size-20 shrink-0 rounded-lg border object-cover" />
          ) : (
            <span className="grid size-20 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground"><PackageIcon className="size-8" /></span>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} asChild>
              <label className="cursor-pointer">
                <CameraIcon />{shown ? "เปลี่ยนรูป" : "เพิ่มรูป / ถ่ายรูป"}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            </Button>
            {shown ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setPhoto(null); setRemovePhoto(!!item?.photoUrl); }}>เอารูปออก</Button> : null}
            {/* สำเนารูปใน Google Drive (ระบบอัปให้หลังบันทึก) */}
            {item?.driveUrl && !photo && !removePhoto ? (
              <a href={item.driveUrl} target="_blank" rel="noopener noreferrer" className="basis-full text-xs text-primary underline-offset-2 hover:underline">เปิดรูปใน Google Drive</a>
            ) : item?.driveError && !photo && !removePhoto ? (
              <span className="basis-full text-xs text-muted-foreground">สำเนารูปขึ้น Drive ยังไม่สำเร็จ: {item.driveError} (ระบบลองใหม่ทุกเช้า)</span>
            ) : null}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label="รหัส">{(id) => <Input id={id} value={f.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} placeholder="เช่น CM01" autoComplete="off" className="font-mono" aria-invalid={dupes.length > 0} />}</Field>
          <Field label="ชื่ออุปกรณ์ *">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="เช่น Nanlite FS-150" />}</Field>
        </div>
        {dupes.length ? (
          <p role="alert" className="rounded-md border border-warning-border bg-warning px-2 py-1.5 text-xs font-semibold text-warning-foreground">
            รหัส {codeKey(f.code)} ซ้ำกับ {dupes.map((x) => `"${x.name}"`).join(", ")} — ตรวจว่าใส่รหัสถูกไหม (ยังบันทึกได้)
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="หมวด">{(id) => <Input id={id} list="equip-categories" value={f.category} onChange={(e) => set("category")(e.target.value)} placeholder="เช่น ไฟ / กล้อง / ไมค์" />}</Field>
          <Field label="ที่เก็บ">{(id) => <Input id={id} list="equip-locations" value={f.location} onChange={(e) => set("location")(e.target.value)} placeholder="เช่น ห้องไลฟ์ GLORY VITAL" />}</Field>
          <Field label="จำนวน">{(id) => <Input id={id} inputMode="numeric" value={f.quantity} onChange={(e) => set("quantity")(e.target.value)} />}</Field>
          <Field label="สถานะ">
            {(id) => (
              <Select value={f.status} onValueChange={set("status")}>
                <SelectTrigger id={id} className="w-full data-[size=default]:h-9"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">{EQUIPMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </Field>
          <Field label="ยี่ห้อ">{(id) => <Input id={id} value={f.brand} onChange={(e) => set("brand")(e.target.value)} />}</Field>
          <Field label="รุ่น">{(id) => <Input id={id} value={f.model} onChange={(e) => set("model")(e.target.value)} />}</Field>
          <Field label="Serial">{(id) => <Input id={id} value={f.serial} onChange={(e) => set("serial")(e.target.value)} autoComplete="off" />}</Field>
          <Field label="วันที่ซื้อ">{(id) => <Input id={id} type="date" value={f.purchaseDate} onChange={(e) => set("purchaseDate")(e.target.value)} />}</Field>
          <Field label="ราคาต่อชิ้น (บาท)">{(id) => <Input id={id} inputMode="decimal" value={f.price} onChange={(e) => set("price")(e.target.value)} placeholder="ไม่ทราบ = ว่าง" />}</Field>
        </div>
        {showSpecs ? (
          <fieldset className="rounded-lg border px-3 pt-1 pb-3">
            <legend className="px-1 font-semibold">สเปคคอมพิวเตอร์ <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {SPEC_FIELDS.map(([k, label, placeholder]) => (
                <Field key={k} label={label}>
                  {(id) => k === "other"
                    ? <Textarea id={id} rows={2} value={specs[k] ?? ""} onChange={(e) => setSpecs({ ...specs, [k]: e.target.value })} placeholder={placeholder} />
                    : <Input id={id} value={specs[k] ?? ""} onChange={(e) => setSpecs({ ...specs, [k]: e.target.value })} placeholder={placeholder} autoComplete="off" />}
                </Field>
              ))}
            </div>
          </fieldset>
        ) : null}
        <Field label="หมายเหตุ">{(id) => <Textarea id={id} rows={2} value={f.note} onChange={(e) => set("note")(e.target.value)} />}</Field>
      </DialogBody>
      <DialogActions>
        {item ? <Button variant="destructive" size="lg" className="mr-auto" disabled={busy} onClick={remove}><Trash2Icon />ลบ</Button> : null}
        <Button variant="outline" size="lg" disabled={busy} onClick={() => onClose()}>ยกเลิก</Button>
        <Button size="lg" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
      </DialogActions>
    </AppDialog>
  );
}

function Field({ label, children }: { label: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 font-semibold">{label}</Label>
      {children(id)}
    </div>
  );
}
