"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { FrameMedia } from "@/components/FrameMedia";
import { LoadError, LoadingBlock, Notice, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtDayMonth, parseKey, todayKey } from "@/lib/format";
import { briefKey } from "@/lib/frames";
import { shrinkImage } from "@/lib/image";
import { platformLabel } from "@/lib/platform";
import { LOOK_GENDERS, type BriefView, type FrameView, type FramesResponse, type LookGender, type LooksResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * เทรนนิ่ง > เฟรมไลฟ์ (Owner ที่จัดการ Mc ได้ + Admin ที่ติ๊กสิทธิ์บรีฟการแต่งตัว)
 *   Look แต่งหน้า/แต่งตัว (รูป Ref ผู้หญิง / ผู้ชาย ใช้ทุกไลฟ์) อยู่บนสุด → Mc / Admin เห็นในโปรไฟล์ (src/components/LookGuide.tsx)
 *   เฟรมจากแท็บ "Frame live" ในชีตวางแผน (แก้เฟรมที่ชีต — เว็บอ่านใหม่ทุก 10 นาที / กดรีเฟรช)
 *   บรีฟการแต่งตัว (ข้อความ + รูปชุดตัวอย่าง) 1 ชุดต่อช่วงวัน ใช้กับทุกช่อง (ส่วนใหญ่แคมเปญเดียวกัน เฟรมคล้ายกัน)
 *     → Mc / Admin เห็นในรายละเอียด slot ของตัวเอง
 */

const MAX_IMAGES = 12;

/** ชื่อช่องแบบสั้น (ปุ่มกรองบนมือถือ): Cherry Glory → Cherry · Skin Expert → Skin · GLORY VITAL คงเดิม */
const shortName = (label: string) => (/^glory\b/i.test(label) ? label : label.split(" ")[0]);

/** "25–31 ต.ค." / "9 ต.ค." / "28 ต.ค. – 3 พ.ย." */
function rangeText(from: string, to: string) {
  if (from === to) return fmtDayMonth.format(parseKey(from));
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${fmtDayMonth.format(parseKey(to))}`;
  return `${fmtDayMonth.format(parseKey(from))} – ${fmtDayMonth.format(parseKey(to))}`;
}

export function LiveFrames() {
  return <><LookEditors /><FramesList /></>;
}

function FramesList() {
  const [data, setData] = useState<FramesResponse | null>(null);
  const [error, setError] = useState("");
  const [past, setPast] = useState(false);
  const [platform, setPlatform] = useState("all");
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef(false);

  useEffect(() => {
    let alive = true;
    const q = [past ? "past=1" : "", refresh.current ? "refresh=1" : ""].filter(Boolean).join("&");
    refresh.current = false;
    api<FramesResponse>(`/api/frames${q ? `?${q}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); })
      .finally(() => { if (alive) setRefreshing(false); });
    return () => { alive = false; };
  }, [past, tick]);
  const reload = () => setTick((n) => n + 1);

  if (!data) return error ? <LoadError title="โหลดเฟรมไลฟ์ไม่สำเร็จ" message={error} onRetry={reload} /> : <LoadingBlock />;
  if (!data.ready) return <Notice variant="warning" icon title="ยังเปิดเฟรมไลฟ์ไม่ได้">{data.message}</Notice>;

  const today = todayKey();
  const platforms = [...new Set(data.frames.map((f) => f.platform))];
  const shown = data.frames.filter((f) => platform === "all" || f.platform === platform);
  // จัดกลุ่มตามช่วงวัน (ช่วงเดียวกันหลายช่อง อยู่ด้วยกัน)
  const groups = new Map<string, FrameView[]>();
  for (const f of shown) groups.set(`${f.from}|${f.to}`, [...(groups.get(`${f.from}|${f.to}`) ?? []), f]);

  return (
    <div>
      <h2 className="mb-1 text-base font-bold">เฟรมไลฟ์ + บรีฟการแต่งตัว</h2>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        เฟรมมาจากแท็บ &quot;Frame live&quot; ในชีตวางแผน (แก้ / เพิ่มเฟรมที่ชีต) · เขียนบรีฟการแต่งตัว + แนบรูปชุดตัวอย่าง 1 ชุดต่อช่วงวัน ใช้กับทุกช่อง
        — Mc / Admin เห็นเฟรมและบรีฟในรายละเอียด slot ของตัวเอง (ตารางของฉัน)
      </p>
      {data.message ? <Notice variant="warning" icon className="mb-3" title="อ่านชีตเฟรม">{data.message}</Notice> : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={platform} onValueChange={(v) => { if (v) setPlatform(v); }} aria-label="ช่อง" className="no-scrollbar max-w-full overflow-x-auto bg-card">
          <ToggleGroupItem value="all" className="text-xs font-semibold">ทุกช่อง</ToggleGroupItem>
          {platforms.map((p) => (
            <ToggleGroupItem key={p} value={p} aria-label={platformLabel(p)} className="text-xs font-semibold">
              <span className="sm:hidden">{shortName(platformLabel(p))}</span><span className="max-sm:hidden">{platformLabel(p)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="bg-card" onClick={() => setPast(!past)} aria-pressed={past}>{past ? "ซ่อนช่วงที่ผ่านมา" : "ดูช่วงที่ผ่านมา"}</Button>
          <Button
            size="sm" variant="outline" className="bg-card" disabled={refreshing} aria-label="อ่านชีตเฟรมใหม่"
            onClick={() => { refresh.current = true; setRefreshing(true); reload(); }}
          >
            <RefreshCwIcon className={cn(refreshing && "animate-spin")} />รีเฟรช
          </Button>
        </span>
      </div>

      {!groups.size ? <Notice>ยังไม่มีเฟรม{past ? "ในชีต" : "ของช่วงนี้ / ช่วงถัดไปในชีต"}</Notice> : null}
      <div className="space-y-5">
        {[...groups.entries()].map(([k, list]) => {
          const [from, to] = k.split("|");
          const now = from <= today && today <= to;
          return (
            <section key={k}>
              <h2 className="mb-2 flex items-center gap-2 text-base font-bold">
                {rangeText(from, to)}
                {now ? <Badge>ตอนนี้</Badge> : to < today ? <Badge variant="outline" className="text-muted-foreground">ผ่านแล้ว</Badge> : null}
              </h2>
              {/* บรีฟเดียวของช่วงวันนี้ ใช้กับทุกช่อง (นับช่องจากเฟรมทั้งหมด ไม่ใช่เฉพาะที่กรองอยู่) */}
              <BriefEditor
                key={k} apiKey={briefKey(from, to)} brief={data.briefs?.[k] ?? null}
                count={data.frames.filter((f) => f.from === from && f.to === to).length} onChanged={reload}
              />
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {list.map((f) => <FrameCard key={f.key} f={f} />)}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** 1 ช่อง + ช่วงวัน: พรีวิวเฟรม */
function FrameCard({ f }: { f: FrameView }) {
  return (
    <li className="rounded-xl border bg-card p-3">
      <b className="mb-2 block text-sm">{platformLabel(f.platform)}</b>
      {f.frame ? <FrameMedia file={f.frame} /> : <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">ยังไม่มีลิงก์เฟรมในชีต</p>}
    </li>
  );
}

/** ข้อความในกล่องแก้บรีฟ (บรีฟการแต่งตัวของช่วงวัน = ค่าเริ่มต้น / Look แต่งหน้า-แต่งตัว ใช้ข้อความของตัวเอง) */
type EditorText = { title: string; hint: string; placeholder: string; save: string; images: string; alt: string; remove: string };
const BRIEF_TEXT: EditorText = {
  title: "บรีฟการแต่งตัว", hint: "ใช้กับทุกช่องในช่วงนี้", save: "บันทึกบรีฟ", images: "รูปชุดตัวอย่าง", alt: "ชุดตัวอย่าง",
  remove: "ลบรูปชุดตัวอย่างนี้?", placeholder: "เช่น โทนสีชมพู-ขาว ให้เข้ากับเฟรม · เสื้อแขนยาว ไม่มีลาย · ห้ามสีเขียว",
};
const LOOK_TEXT: Record<LookGender, EditorText> = {
  female: {
    title: "Look ผู้หญิง", hint: "แต่งหน้า + แต่งตัว ใช้ทุกไลฟ์", save: "บันทึก", images: "รูป Ref", alt: "Look ผู้หญิง",
    remove: "ลบรูป Ref นี้?", placeholder: "เช่น ผิวฉ่ำ บลัชกลางแก้ม ปากแดงเบลอๆ · ชุดโทนขาว / สีอ่อน",
  },
  male: {
    title: "Look ผู้ชาย", hint: "แต่งหน้า + แต่งตัว ใช้ทุกไลฟ์", save: "บันทึก", images: "รูป Ref", alt: "Look ผู้ชาย",
    remove: "ลบรูป Ref นี้?", placeholder: "เช่น ผิวใสเป็นธรรมชาติ ปากชมพูอ่อน · ชุดโทนขาว",
  },
};

/** Look แต่งหน้า/แต่งตัว (รูป Ref) ผู้หญิง / ผู้ชาย — Mc / Admin เห็นในโปรไฟล์ของตัวเอง */
function LookEditors() {
  const [data, setData] = useState<LooksResponse | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<LooksResponse>("/api/looks")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick]);
  const reload = () => setTick((n) => n + 1);

  return (
    <section className="mb-6">
      <h2 className="mb-1 text-base font-bold">Look แต่งหน้า / แต่งตัว</h2>
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
        โทนการแต่งหน้าแต่งตัวที่ใช้ทุกไลฟ์ (ไม่ขึ้นกับเฟรม) — Mc / Admin เห็นในโปรไฟล์ของตัวเอง (ตารางของฉัน → Look แต่งหน้า/แต่งตัว)
      </p>
      {!data ? (
        error ? <LoadError title="โหลด Look ไม่สำเร็จ" message={error} onRetry={reload} /> : <LoadingBlock className="h-24" />
      ) : !data.ready ? (
        <Notice variant="warning" icon title="ยังเปิด Look ไม่ได้">{data.message}</Notice>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {LOOK_GENDERS.map((g) => (
            <BriefEditor
              key={g} apiKey={g} brief={data.looks[g]} onChanged={reload}
              endpoint="/api/looks" text={LOOK_TEXT[g]}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * กล่องแก้ข้อความ + รูป
 *   บรีฟการแต่งตัวของช่วงวัน (/api/frames) ใช้กับทุกช่องในช่วงนี้ · count = จำนวนช่องที่มีเฟรมช่วงนี้
 *   Look แต่งหน้า/แต่งตัว (/api/looks · apiKey = female / male)
 */
function BriefEditor({ apiKey, brief, count = 0, onChanged, endpoint = "/api/frames", text = BRIEF_TEXT }: {
  apiKey: string; brief: BriefView | null; count?: number; onChanged: () => void; endpoint?: string; text?: EditorText;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const saved = brief?.note ?? "";
  const [note, setNote] = useState(saved);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const images = brief?.images ?? [];
  const id = `brief-${apiKey}`;

  async function saveNote() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>(endpoint, { key: apiKey, note }, "PATCH");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  /** ย่อรูปในเครื่องก่อนส่ง (ไฟล์เล็ก ส่งเร็ว) แล้วส่งทีละรูป */
  async function addImages(list: FileList | null) {
    const picked = [...(list ?? [])].slice(0, MAX_IMAGES - images.length);
    if (!picked.length) return;
    setBusy(true);
    let done = 0;
    try {
      for (const p of picked) {
        const fd = new FormData();
        fd.append("key", apiKey);
        fd.append("photo", await shrinkImage(p, 1600), "brief.jpg");
        const res = await fetch(endpoint, { method: "POST", body: fd });
        const json = await res.json().catch(() => null) as { ok?: boolean; message?: string } | null;
        if (!json?.ok) throw new Error(json?.message ?? `เพิ่มรูปไม่สำเร็จ (HTTP ${res.status})`);
        done++;
      }
      toast(`เพิ่มรูปแล้ว ${done} รูป`);
    } catch (err) {
      toast(`${done ? `เพิ่มได้ ${done} รูป · ` : ""}${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
      if (done) onChanged();
    }
  }

  async function removeImage(path: string) {
    if (!(await confirm({ title: text.remove, confirmText: "ลบรูป", destructive: true }))) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>(endpoint, { key: apiKey, path }, "DELETE");
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <label htmlFor={id} className="text-sm font-semibold">{text.title}</label>
        <span className="text-xs text-muted-foreground">{text.hint}{count > 1 ? ` (${count} ช่อง)` : ""}</span>
        {brief?.updatedBy ? <span className="ml-auto truncate text-[11px] text-muted-foreground">แก้ล่าสุด {brief.updatedBy}</span> : null}
      </div>
      <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} placeholder={text.placeholder} />
      <div className="mt-1.5 flex justify-end">
        <Button size="sm" disabled={busy || note.trim() === saved.trim()} onClick={saveNote}>{text.save}</Button>
      </div>

      <span className="mt-2 mb-1 block text-sm font-semibold">{text.images} <span className="font-normal text-muted-foreground">({images.length}/{MAX_IMAGES})</span></span>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {images.map((img) => (
          <div key={img.path} className="relative">
            <a href={img.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element -- ลิงก์ชั่วคราวจาก Supabase Storage */}
              <img src={img.url} alt={text.alt} loading="lazy" className="aspect-square w-full object-cover" />
            </a>
            <button
              type="button" disabled={busy} onClick={() => removeImage(img.path)} aria-label="ลบรูปนี้"
              className="absolute top-1 right-1 grid size-7 cursor-pointer place-items-center rounded-full bg-black/60 text-white disabled:opacity-50 [&_svg]:size-4"
            >
              <XIcon />
            </button>
          </div>
        ))}
        {images.length < MAX_IMAGES ? (
          <button
            type="button" disabled={busy} onClick={() => file.current?.click()}
            className="grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <span className="grid place-items-center gap-1 [&_svg]:size-5"><ImagePlusIcon />{busy ? "กำลังส่ง..." : "เพิ่มรูป"}</span>
          </button>
        ) : null}
      </div>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => void addImages(e.target.files)} />
    </div>
  );
}
