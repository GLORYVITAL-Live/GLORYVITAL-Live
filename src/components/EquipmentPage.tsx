"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CameraIcon, PackageIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { EQUIPMENT_STATUSES, type Equipment, type EquipmentStatus } from "@/lib/types";
import { SPEC_FIELDS, isComputer, specLine } from "@/lib/equipment";
import { money } from "@/lib/format";
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
const STATUS_TONE: Record<EquipmentStatus, string> = {
  "ใช้งานได้": "bg-success/15 text-success",
  "ชำรุด": "bg-destructive/10 text-destructive",
  "ส่งซ่อม": "border-warning-border bg-warning text-warning-foreground",
  "หาย": "bg-destructive text-white",
  "เลิกใช้": "bg-muted text-muted-foreground",
};
const fmtDate = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
const dateText = (d: string | null) => (d ? fmtDate.format(new Date(`${d}T12:00:00Z`)) : "");
const valueOf = (x: Equipment) => (x.price ?? 0) * x.quantity;

export function EquipmentPage() {
  const [items, setItems] = useState<Equipment[] | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [editing, setEditing] = useState<Equipment | "new" | null>(null);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api<{ items: Equipment[] }>("/api/equipment")
      .then((res) => {
        if (!alive) return;
        if (res.ok) { setItems(res.items); setError(""); } else setError(res.message ?? "โหลดไม่สำเร็จ");
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick]);

  const categories = useMemo(() => [...new Set((items ?? []).map((x) => x.category || NO_CAT))].sort((a, b) => a.localeCompare(b, "th")), [items]);
  const locations = useMemo(() => [...new Set((items ?? []).map((x) => x.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [items]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? []).filter((x) => (cat === ALL || (x.category || NO_CAT) === cat) && (status === ALL || x.status === status)
      && (!q || [x.code, x.name, x.brand, x.model, x.serial, x.location, x.note, x.category, ...Object.values(x.specs)].some((v) => v.toLowerCase().includes(q))));
  }, [items, search, cat, status]);

  if (!items) return error ? <LoadError title="โหลดรายการอุปกรณ์ไม่สำเร็จ" message={error} onRetry={reload} /> : <LoadingBlock />;

  const groups = categories.map((c) => [c, list.filter((x) => (x.category || NO_CAT) === c)] as const).filter(([, l]) => l.length);
  const problems = items.filter((x) => x.status === "ชำรุด" || x.status === "ส่งซ่อม" || x.status === "หาย").length;

  return (
    <div className="pb-10">
      <Stats items={[
        [String(items.length), "รายการ"],
        [String(items.reduce((a, x) => a + x.quantity, 0)), "ชิ้น"],
        [money(items.reduce((a, x) => a + valueOf(x), 0)), "มูลค่ารวม (บาท)"],
      ]} />
      {problems ? <p className="mt-1 text-sm font-semibold text-warning-foreground">ชำรุด / ส่งซ่อม / หาย {problems} รายการ</p> : null}

      <div className="my-3 flex flex-wrap items-center gap-2">
        <InputGroup className="h-9 min-w-48 flex-1 bg-card">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหารหัส ชื่อ ยี่ห้อ รุ่น ที่เก็บ" aria-label="ค้นหา" />
        </InputGroup>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger aria-label="หมวด" className="w-auto min-w-32 bg-card"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ALL}>ทุกหมวด</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="สถานะ" className="w-auto min-w-32 bg-card"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ALL}>ทุกสถานะ</SelectItem>
            {EQUIPMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="lg" onClick={() => setEditing("new")}><PlusIcon />เพิ่มอุปกรณ์</Button>
        <ExportMenu label="ส่งออกรายการ" build={() => exportBook(list)} />
      </div>

      {!items.length ? (
        <StateBox title="ยังไม่มีอุปกรณ์">กด &quot;เพิ่มอุปกรณ์&quot; เพื่อเริ่มทำทะเบียน</StateBox>
      ) : !list.length ? (
        <StateBox title="ไม่พบอุปกรณ์">ลองค้นหาด้วยคำอื่น หรือเปลี่ยนตัวกรอง</StateBox>
      ) : groups.map(([c, rows]) => (
        <section key={c} className="mt-4">
          <h2 className="mb-2 flex items-baseline gap-2 font-bold">
            {c}
            <span className="text-xs font-normal text-muted-foreground">{rows.length} รายการ · {rows.reduce((a, x) => a + x.quantity, 0)} ชิ้น</span>
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rows.map((x) => (
              <button
                key={x.id} type="button" onClick={() => setEditing(x)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-2.5 text-left shadow-card transition outline-none hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {x.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.photoUrl} alt="" className="size-14 shrink-0 rounded-lg border object-cover" loading="lazy" />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground"><PackageIcon className="size-6" /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{x.name}</span>
                    {x.quantity !== 1 ? <span className="shrink-0 text-sm text-muted-foreground">x{x.quantity}</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[[x.brand, x.model].filter(Boolean).join(" "), x.location].filter(Boolean).join(" · ") || "ไม่ระบุยี่ห้อ / ที่เก็บ"}
                  </span>
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
        <EquipmentDialog item={editing === "new" ? null : editing} onClose={(changed) => { setEditing(null); if (changed) reload(); }} />
      ) : null}
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

function EquipmentDialog({ item, onClose }: { item: Equipment | null; onClose: (changed?: boolean) => void }) {
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
      const json = await res.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!json?.ok) throw new Error(json?.message ?? `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      toast(json.message ?? "บันทึกแล้ว");
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
      description={item?.updatedBy ? `แก้ล่าสุด ${dateText(item.updatedAt.slice(0, 10))} โดย ${item.updatedBy}` : undefined}
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
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label="รหัส">{(id) => <Input id={id} value={f.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} placeholder="เช่น CM01" autoComplete="off" className="font-mono" />}</Field>
          <Field label="ชื่ออุปกรณ์ *">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="เช่น Nanlite FS-150" />}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="หมวด">{(id) => <Input id={id} list="equip-categories" value={f.category} onChange={(e) => set("category")(e.target.value)} placeholder="เช่น ไฟ / กล้อง / ไมค์" />}</Field>
          <Field label="ที่เก็บ">{(id) => <Input id={id} list="equip-locations" value={f.location} onChange={(e) => set("location")(e.target.value)} placeholder="เช่น ห้องไลฟ์ GLORY VITAL" />}</Field>
          <Field label="จำนวน">{(id) => <Input id={id} inputMode="numeric" value={f.quantity} onChange={(e) => set("quantity")(e.target.value)} />}</Field>
          <Field label="สถานะ">
            {(id) => (
              <Select value={f.status} onValueChange={set("status")}>
                <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
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
