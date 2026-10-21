"use client";

import { useEffect, useRef, useState } from "react";
import {
  ExternalLinkIcon, EyeIcon, EyeOffIcon, MaximizeIcon, PencilIcon, PlayIcon, PlusIcon, PresentationIcon, RefreshCwIcon, Settings2Icon, Trash2Icon, VideoIcon,
} from "lucide-react";
import { AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, Notice, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Training, TrainingGroup, TrainingVideo } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * หน้าเทรนนิ่ง: วิดีโอ product training + สไลด์บรีฟโปรดักต์ — เล่น / เปิดในหน้าเว็บด้วยตัวเล่นของ Google / YouTube (ไม่ต้องไปที่ไดรฟ์)
 *   โหลดตัวเล่นวิดีโอทีละ 1 ตัว (ตัวที่เลือก)
 *   Owner ที่จัดการได้: โหมด "จัดการคลิป" = ซ่อน / แสดง คลิปหรือทั้งกลุ่ม · แก้ชื่อที่แสดง · เพิ่มคลิปจากลิงก์ · รีเฟรชจากไดรฟ์
 */

const playerUrl = (v: TrainingVideo) =>
  v.kind === "youtube" ? `https://www.youtube-nocookie.com/embed/${v.id}?rel=0` : `https://drive.google.com/file/d/${v.id}/preview`;
const openUrl = (v: TrainingVideo) => (v.kind === "youtube" ? `https://www.youtube.com/watch?v=${v.id}` : `https://drive.google.com/file/d/${v.id}/view`);
const thumbUrl = (v: TrainingVideo) =>
  v.kind === "youtube" ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : `https://drive.google.com/thumbnail?id=${v.id}&sz=w480`;
const slidesUrl = (id: string) => `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false`;

type Rename = { ref: string; title: string; original: string; required: boolean; kind: "clip" | "group" };

export function TrainingPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Training | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<"video" | "slides">("video");
  const [playing, setPlaying] = useState<TrainingVideo | null>(null);
  const [manage, setManage] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rename, setRename] = useState<Rename | null>(null);
  const [adding, setAdding] = useState(false);
  const player = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api<Training>("/api/training")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [attempt]);

  /** คำสั่งจัดการ → ได้รายชื่อใหม่กลับมา · คืน true = สำเร็จ */
  async function run(key: string, body: object) {
    setBusy(key);
    try {
      const res = await api<Training & { notice: string }>("/api/training", body);
      if (!res.ok) throw new Error(res.message);
      setData(res);
      toast(res.notice);
      return true;
    } catch (err) {
      toast((err as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return error ? <LoadError title="โหลดหน้าเทรนนิ่งไม่สำเร็จ" message={error} onRetry={() => setAttempt((n) => n + 1)} /> : <LoadingBlock />;
  }
  if (!data.ready) return <Notice variant="warning" icon title="ยังเปิดหน้าเทรนนิ่งไม่ได้">{data.message}</Notice>;

  const canManage = !!data.manage;
  const editing = canManage && manage && tab === "video";
  // โหมดดู: ไม่แสดงที่ซ่อน (เหมือนที่ทีมเห็น)
  const groups: TrainingGroup[] = editing ? data.groups : data.groups.filter((g) => !g.hidden)
    .map((g) => ({ ...g, videos: g.videos.filter((v) => !v.hidden) })).filter((g) => g.videos.length);
  const count = groups.reduce((n, g) => n + g.videos.length, 0);
  // จำนวนบนแท็บ = คลิปที่ทีมเห็น (โหมดจัดการไม่นับที่ซ่อน — ตัวเลขไม่กระโดด)
  const shown = data.groups.filter((g) => !g.hidden).reduce((n, g) => n + g.videos.filter((v) => !v.hidden).length, 0);
  const play = (v: TrainingVideo) => {
    setPlaying(v);
    requestAnimationFrame(() => player.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const toggleHidden = (ref: string, hidden: boolean) => run(`hide${ref}`, { action: "hide", ref, hidden });
  async function removeClip(v: TrainingVideo) {
    const ok = await confirm({
      title: `ลบ "${v.title}" ออกจากหน้าเทรนนิ่ง?`,
      description: "ลบเฉพาะในเว็บ ไฟล์ใน Google Drive / คลิปใน YouTube ไม่ถูกลบ (เพิ่มกลับได้ด้วยลิงก์เดิม)",
      confirmText: "ลบคลิป",
      destructive: true,
    });
    if (ok && (await run(`remove${v.ref}`, { action: "remove", ref: v.ref })) && playing?.ref === v.ref) setPlaying(null);
  }

  return (
    <div className="pb-10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single" variant="outline" spacing={0} value={tab} aria-label="เลือกหมวด" className="w-full bg-card sm:w-auto"
          onValueChange={(v) => { if (v) setTab(v as "video" | "slides"); }}
        >
          <ToggleGroupItem value="video" className="flex-1 font-semibold sm:flex-none"><VideoIcon />วิดีโอเทรนนิ่ง ({shown})</ToggleGroupItem>
          <ToggleGroupItem value="slides" className="flex-1 font-semibold sm:flex-none"><PresentationIcon />สไลด์บรีฟโปรดักต์</ToggleGroupItem>
        </ToggleGroup>
        {canManage && tab === "video" ? (
          <Button variant={manage ? "default" : "outline"} className="rounded-full sm:ml-auto" onClick={() => setManage(!manage)} aria-pressed={manage}>
            <Settings2Icon />{manage ? "เสร็จสิ้น" : "จัดการคลิป"}
          </Button>
        ) : null}
      </div>

      {tab === "slides" ? (
        data.slides ? (
          <SlidesView id={data.slides} />
        ) : <Notice>ยังไม่ได้ตั้งสไลด์บรีฟโปรดักต์ (settings.training_slides)</Notice>
      ) : (
        <>
          {data.message ? <Notice variant="warning" icon title="อ่านรายชื่อวิดีโอไม่สำเร็จ">{data.message}</Notice> : null}
          {editing ? (
            data.manage?.ready ? (
              <div className="mb-4 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  ซ่อน = ทีมไม่เห็นในหน้าเทรนนิ่ง (ไฟล์ในไดรฟ์ไม่ถูกลบ กดแสดงกลับได้) · แก้ชื่อ = เปลี่ยนเฉพาะชื่อที่แสดงในเว็บ
                  · คลิปใหม่ในโฟลเดอร์ไดรฟ์ขึ้นเองภายใน 10 นาที (กดรีเฟรชให้ขึ้นทันที)
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" disabled={!!busy} onClick={() => setAdding(true)}><PlusIcon />เพิ่มคลิปจากลิงก์</Button>
                  <Button size="sm" variant="outline" className="bg-card" disabled={!!busy} onClick={() => run("refresh", { action: "refresh" })}>
                    <RefreshCwIcon className={cn(busy === "refresh" && "animate-spin")} />{busy === "refresh" ? "กำลังอ่าน..." : "รีเฟรชจากไดรฟ์"}
                  </Button>
                </div>
              </div>
            ) : <Notice variant="warning" icon title="ยังจัดการคลิปในเว็บไม่ได้">{data.manage?.message}</Notice>
          ) : null}

          <div ref={player} className="scroll-mt-4">
            {playing ? (
              <div className="mb-4">
                <Frame key={playing.ref} src={playerUrl(playing)} title={playing.title} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <b className="min-w-0 flex-1 text-sm break-words">{playing.title}</b>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" asChild>
                    <a href={openUrl(playing)} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />เล่นไม่ได้? เปิดในแท็บใหม่</a>
                  </Button>
                </div>
              </div>
            ) : count ? (
              <p className="mb-3 text-sm text-muted-foreground">แตะวิดีโอเพื่อเล่นในหน้านี้ (กดปุ่มขยายในตัวเล่น = เต็มจอ)</p>
            ) : null}
          </div>
          {!count && !data.message ? <Notice>ยังไม่มีวิดีโอในหน้าเทรนนิ่ง</Notice> : null}

          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.ref ?? `added:${g.name}`} className={cn(editing && g.hidden && "rounded-xl border border-dashed p-2 opacity-60")}>
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="text-base font-bold">
                    {g.name} <span className="text-sm font-normal text-muted-foreground">({g.videos.length})</span>
                  </h2>
                  {editing && g.hidden ? <Badge variant="outline" className="text-[11px]">ซ่อนทั้งกลุ่ม</Badge> : null}
                  {editing && g.ref ? (
                    <span className="ml-auto flex gap-1">
                      <Button
                        size="sm" variant="ghost" disabled={!!busy}
                        onClick={() => setRename({ ref: g.ref!, title: g.name === g.folderName ? "" : g.name, original: g.folderName ?? "", required: false, kind: "group" })}
                      >
                        <PencilIcon />แก้ชื่อกลุ่ม
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => toggleHidden(g.ref!, !g.hidden)}>
                        {g.hidden ? <><EyeIcon />แสดงกลุ่ม</> : <><EyeOffIcon />ซ่อนกลุ่ม</>}
                      </Button>
                    </span>
                  ) : null}
                </div>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {g.videos.map((v) => (
                    <li key={v.ref} className={cn("flex flex-col overflow-hidden rounded-xl border bg-card", editing && v.hidden && "border-dashed opacity-60", playing?.ref === v.ref && "border-primary ring-2 ring-primary/30")}>
                      <button
                        type="button" onClick={() => play(v)} aria-current={playing?.ref === v.ref ? "true" : undefined}
                        className="group w-full flex-1 cursor-pointer text-left"
                      >
                        <span className="relative block aspect-video bg-muted">
                          <Thumb src={thumbUrl(v)} />
                          <span className="absolute inset-0 grid place-items-center">
                            <span className="grid size-10 place-items-center rounded-full bg-black/55 text-white transition-transform group-hover:scale-110 [&_svg]:size-5">
                              <PlayIcon className="fill-current" />
                            </span>
                          </span>
                          {v.minutes ? (
                            <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 text-[11px] font-semibold text-white tabular-nums">{v.minutes} นาที</span>
                          ) : null}
                          {editing && (v.hidden || v.added) ? (
                            <span className="absolute top-1.5 left-1.5 flex gap-1">
                              {v.hidden ? <span className="rounded bg-black/70 px-1.5 text-[11px] font-semibold text-white">ซ่อนอยู่</span> : null}
                              {v.added ? <span className="rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{v.kind === "youtube" ? "YouTube" : "เพิ่มจากลิงก์"}</span> : null}
                            </span>
                          ) : null}
                        </span>
                        <span className="line-clamp-2 px-2 pt-1.5 pb-1.5 text-xs font-semibold leading-snug group-hover:text-primary">{v.title}</span>
                      </button>
                      {editing ? (
                        <span className="flex border-t">
                          <ClipButton
                            label="แก้ชื่อ" disabled={!!busy}
                            onClick={() => setRename({ ref: v.ref, title: v.added || v.title === v.fileTitle ? (v.added ? v.title : "") : v.title, original: v.fileTitle, required: v.added, kind: "clip" })}
                          ><PencilIcon /></ClipButton>
                          <ClipButton label={v.hidden ? "แสดง" : "ซ่อน"} disabled={!!busy} onClick={() => toggleHidden(v.ref, !v.hidden)}>
                            {v.hidden ? <EyeIcon /> : <EyeOffIcon />}
                          </ClipButton>
                          {v.added ? (
                            <ClipButton label="ลบ" disabled={!!busy} className="text-destructive" onClick={() => removeClip(v)}><Trash2Icon /></ClipButton>
                          ) : null}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <RenameDialog
        value={rename} busy={!!busy} onClose={() => setRename(null)}
        onSave={async (title) => { if (rename && (await run(`rename${rename.ref}`, { action: "rename", ref: rename.ref, title }))) setRename(null); }}
      />
      <AddDialog
        open={adding} busy={!!busy} groups={data.groups.map((g) => g.name)} onClose={() => setAdding(false)}
        onAdd={async (body) => { if (await run("add", { action: "add", ...body })) setAdding(false); }}
      />
    </div>
  );
}

/** ปุ่มเล็กใต้การ์ดคลิป (โหมดจัดการ) */
function ClipButton({ label, className, children, ...props }: React.ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      className={cn(
        "flex flex-1 cursor-pointer items-center justify-center gap-1 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-9 [&_svg]:size-3.5 [&+&]:border-l",
        className,
      )}
      {...props}
    >
      {children}{label}
    </button>
  );
}

/** แก้ชื่อที่แสดง (คลิป / กลุ่ม) — ว่าง = ใช้ชื่อเดิม (ยกเว้นคลิปที่เพิ่มจากลิงก์) */
function RenameDialog({ value, busy, onClose, onSave }: { value: Rename | null; busy: boolean; onClose: () => void; onSave: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const [ref, setRef] = useState<string | null>(null);
  // เปิดหน้าต่างใหม่ = ตั้งค่าเริ่มต้นตามรายการที่เลือก
  if (value && value.ref !== ref) { setRef(value.ref); setTitle(value.title); }
  if (!value && ref) setRef(null);
  return (
    <AppDialog
      open={!!value} onClose={onClose} busy={busy} title={value?.kind === "group" ? "แก้ชื่อกลุ่ม" : "แก้ชื่อคลิป"}
      description={value?.original ? <>ชื่อเดิม: {value.original}{value.required ? "" : " (เว้นว่าง = ใช้ชื่อเดิม)"}</> : undefined}
    >
      <DialogBody>
        <Label htmlFor="training-title" className="mb-1.5">ชื่อที่แสดงในเว็บ</Label>
        <Input id="training-title" value={title} maxLength={120} placeholder={value?.original} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </DialogBody>
      <DialogActions>
        <Button variant="outline" disabled={busy} onClick={onClose}>ยกเลิก</Button>
        <Button disabled={busy || (!!value?.required && !title.trim())} onClick={() => onSave(title)}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
      </DialogActions>
    </AppDialog>
  );
}

/** เพิ่มคลิปจากลิงก์ Google Drive / YouTube เข้ากลุ่ม (เลือกกลุ่มเดิม หรือพิมพ์ชื่อกลุ่มใหม่) */
function AddDialog({ open, busy, groups, onClose, onAdd }: {
  open: boolean; busy: boolean; groups: string[]; onClose: () => void; onAdd: (body: { url: string; title: string; group: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  // เปิดใหม่ = ล้างฟอร์ม
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setUrl(""); setTitle(""); setGroup(""); }
  }
  const names = [...new Set(groups)];
  return (
    <AppDialog open={open} onClose={onClose} busy={busy} title="เพิ่มคลิปจากลิงก์" description="ลิงก์ไฟล์วิดีโอใน Google Drive (แชร์แบบทุกคนที่มีลิงก์ดูได้) หรือลิงก์ YouTube">
      <DialogBody className="space-y-3">
        <div>
          <Label htmlFor="training-url" className="mb-1.5">ลิงก์คลิป</Label>
          <Input id="training-url" value={url} inputMode="url" placeholder="วางลิงก์ Google Drive / YouTube" onChange={(e) => setUrl(e.target.value)} autoFocus />
        </div>
        <div>
          <Label htmlFor="training-new-title" className="mb-1.5">ชื่อคลิป <span className="font-normal text-muted-foreground">(เว้นว่าง = ใช้ชื่อไฟล์ / ชื่อใน YouTube)</span></Label>
          <Input id="training-new-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="training-group" className="mb-1.5">กลุ่มสินค้า <span className="font-normal text-muted-foreground">(เลือกกลุ่มเดิม หรือพิมพ์ชื่อกลุ่มใหม่)</span></Label>
          <Input id="training-group" value={group} maxLength={80} list="training-groups" onChange={(e) => setGroup(e.target.value)} />
          <datalist id="training-groups">{names.map((n) => <option key={n} value={n} />)}</datalist>
          {names.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {names.map((n) => (
                <button
                  key={n} type="button" onClick={() => setGroup(n)}
                  className={cn("cursor-pointer rounded-full border px-2 py-0.5 text-[11px]", group === n ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary")}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" disabled={busy} onClick={onClose}>ยกเลิก</Button>
        <Button disabled={busy || !url.trim() || !group.trim()} onClick={() => onAdd({ url, title, group })}>{busy ? "กำลังเพิ่ม..." : "เพิ่มคลิป"}</Button>
      </DialogActions>
    </AppDialog>
  );
}

/**
 * สไลด์ Google Slides: สูง = สไลด์ 16:9 + แถบปุ่มของ Google (~37px) — ไม่งั้นสไลด์หดมีขอบดำ (เห็นชัดบนมือถือ)
 *   ปุ่มเต็มจอของเว็บ (เบราว์เซอร์ที่รองรับ — iPhone ไม่รองรับเต็มจอแบบนี้ = ไม่แสดงปุ่ม ให้หมุนจอแนวนอนแทน)
 */
function SlidesView({ id }: { id: string }) {
  const box = useRef<HTMLDivElement>(null);
  // แสดงหลังโหลดข้อมูลแล้วเท่านั้น (ฝั่งเซิร์ฟเวอร์ไม่ได้วาดส่วนนี้) จึงอ่าน document ตอนเริ่มได้
  const [canFull] = useState(() => typeof document !== "undefined" && !!document.fullscreenEnabled);
  return (
    <div>
      <div ref={box} className="relative w-full overflow-hidden rounded-xl border bg-black shadow-card" style={{ paddingBottom: "calc(56.25% + 37px)" }}>
        <iframe src={slidesUrl(id)} title="สไลด์บรีฟโปรดักต์" className="absolute inset-0 size-full" allow="fullscreen" allowFullScreen />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">แตะสไลด์ หรือกดลูกศร &lt; &gt; ใต้สไลด์เพื่อเปลี่ยนหน้า{canFull ? "" : " · หมุนจอแนวนอนเพื่อดูใหญ่ขึ้น"}</p>
        {canFull ? (
          <Button size="sm" variant="outline" onClick={() => box.current?.requestFullscreen().catch(() => undefined)}>
            <MaximizeIcon />เต็มจอ
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** ตัวเล่นวิดีโอ ขนาด 16:9 */
function Frame({ src, title }: { src: string; title: string }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border bg-black shadow-card">
      <iframe src={src} title={title} className="size-full" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />
    </div>
  );
}

/** รูปตัวอย่างวิดีโอ (โหลดไม่ได้ = ไอคอน) */
function Thumb({ src }: { src: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return <span className="grid size-full place-items-center text-muted-foreground [&_svg]:size-6"><VideoIcon /></span>;
  // eslint-disable-next-line @next/next/no-img-element -- รูปจาก Google Drive / YouTube (ไม่ผ่านตัวย่อรูปของ Next)
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="size-full object-cover" />;
}
