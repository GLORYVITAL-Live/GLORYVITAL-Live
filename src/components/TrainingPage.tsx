"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, MaximizeIcon, MinimizeIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, PresentationIcon,
  RefreshCwIcon, RotateCcwIcon, RotateCwIcon, Settings2Icon, Trash2Icon, UsersIcon, VideoIcon, Volume2Icon, VolumeXIcon, XIcon,
} from "lucide-react";
import { AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, Notice, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Training, TrainingGroup, TrainingVideo, TrainingViews } from "@/lib/types";
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
  const [tab, setTab] = useState<"video" | "slides" | "views">("video");
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

  // บันทึกการเข้าหน้า (ครั้งแรกที่โหลดสำเร็จ)
  const loaded = !!data?.ready;
  useEffect(() => { if (loaded) track("page"); }, [loaded]);

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
    if (playing?.ref !== v.ref) track("video", v);
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
          onValueChange={(v) => {
            if (!v) return;
            if (v === "slides" && tab !== "slides") track("slides");
            setTab(v as typeof tab);
          }}
        >
          {/* Owner มี 3 แท็บ: จอมือถือใช้ชื่อสั้น */}
          <ToggleGroupItem value="video" className="flex-1 font-semibold sm:flex-none">
            <VideoIcon />{canManage ? <><span className="sm:hidden">วิดีโอ</span><span className="max-sm:hidden">วิดีโอเทรนนิ่ง</span></> : "วิดีโอเทรนนิ่ง"} ({shown})
          </ToggleGroupItem>
          <ToggleGroupItem value="slides" className="flex-1 font-semibold sm:flex-none">
            <PresentationIcon />{canManage ? <><span className="sm:hidden">สไลด์</span><span className="max-sm:hidden">สไลด์บรีฟโปรดักต์</span></> : "สไลด์บรีฟโปรดักต์"}
          </ToggleGroupItem>
          {canManage ? <ToggleGroupItem value="views" className="flex-1 font-semibold sm:flex-none"><UsersIcon />ผู้เข้าชม</ToggleGroupItem> : null}
        </ToggleGroup>
        {canManage && tab === "video" ? (
          <Button variant={manage ? "default" : "outline"} className="rounded-full sm:ml-auto" onClick={() => setManage(!manage)} aria-pressed={manage}>
            <Settings2Icon />{manage ? "เสร็จสิ้น" : "จัดการคลิป"}
          </Button>
        ) : null}
      </div>

      {tab === "views" && canManage ? <ViewsPanel /> : tab === "slides" ? (
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
                {playing.kind === "drive" ? (
                  <VideoPlayer key={playing.ref} id={playing.id} title={playing.title} />
                ) : (
                  <Frame
                    key={playing.ref} src={playerUrl(playing)} title={playing.title}
                    footer={(
                      <>
                        <b className="w-full text-sm break-words sm:w-auto sm:flex-1">{playing.title}</b>
                        <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground" asChild>
                          <a href={openUrl(playing)} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />เปิดใน YouTube</a>
                        </Button>
                      </>
                    )}
                  />
                )}
              </div>
            ) : count ? (
              <p className="mb-3 text-sm text-muted-foreground">แตะวิดีโอเพื่อเล่นในหน้านี้</p>
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

/** บันทึกการเข้าชม (เงียบ — พลาดไม่เป็นไร ไม่แจ้งผู้ใช้) */
function track(kind: "page" | "video" | "slides", v?: TrainingVideo) {
  fetch("/api/training", {
    method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ action: "view", kind, ref: v?.ref, title: v?.title }),
  }).catch(() => undefined);
}

const ROLE_LABEL: Record<string, string> = { mc: "Mc", admin: "Admin", owner: "Owner", marketing: "Marketing" };
/** "21 ต.ค. 14:05" (เวลาไทย) */
const when = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** ประวัติการเข้าชม (Owner ที่จัดการได้): ต่อคน — เข้าหน้า / เปิดสไลด์ / คลิปที่เล่น + Mc / Admin ที่ยังไม่เคยเข้า */
function ViewsPanel() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<TrainingViews | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<TrainingViews>(`/api/training?views=${days}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [days, tick]);

  const current = data && String(data.days) === days ? data : null;
  if (!current) return error ? <LoadError title="โหลดประวัติการเข้าชมไม่สำเร็จ" message={error} onRetry={() => setTick((n) => n + 1)} /> : <LoadingBlock />;
  if (!current.ready) return <Notice variant="warning" icon title="ยังดูประวัติการเข้าชมไม่ได้">{current.message}</Notice>;

  const plays = current.people.reduce((n, p) => n + p.plays.reduce((m, c) => m + c.count, 0), 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" spacing={0} size="sm" value={days} aria-label="ช่วงเวลา" className="bg-card" onValueChange={(v) => { if (v) setDays(v); }}>
          <ToggleGroupItem value="7">7 วัน</ToggleGroupItem>
          <ToggleGroupItem value="30">30 วัน</ToggleGroupItem>
          <ToggleGroupItem value="0">ทั้งหมด</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-sm text-muted-foreground">เข้าชม <b className="text-foreground">{current.people.length}</b> คน · เล่นคลิป <b className="text-foreground">{plays}</b> ครั้ง</span>
      </div>

      {current.people.length ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {current.people.map((p) => {
            const isOpen = open === p.email;
            return (
              <li key={p.email}>
                <button
                  type="button" onClick={() => setOpen(isOpen ? null : p.email)} aria-expanded={isOpen}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2.5 text-left hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <b className="truncate text-sm">{p.who}</b>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">{ROLE_LABEL[p.role] ?? p.role}</Badge>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      ล่าสุด {when(p.lastAt)} · เข้าหน้า {p.pages} ครั้ง · เล่น {p.plays.length} คลิป{p.slides ? ` · เปิดสไลด์ ${p.slides} ครั้ง` : ""}
                    </span>
                  </span>
                  {p.plays.length ? <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} /> : null}
                </button>
                {isOpen && p.plays.length ? (
                  <ul className="space-y-1 bg-muted/30 px-3 py-2 text-xs">
                    {p.plays.map((c) => (
                      <li key={c.ref} className="flex gap-2">
                        <PlayIcon className="mt-0.5 size-3 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 break-words">{c.title}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">{c.count > 1 ? `${c.count} ครั้ง · ` : ""}{when(c.lastAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <Notice>ยังไม่มีคนเข้าชมในช่วงนี้</Notice>}

      {current.never.length ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">
            ยังไม่เคยเข้าดู{current.days ? `ใน ${current.days} วัน` : ""} <span className="font-normal text-muted-foreground">({current.never.length} คน · Mc / Admin ที่มีอีเมล)</span>
          </h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {current.never.map((n) => <li key={n} className="rounded-full border bg-card px-2.5 py-0.5 text-xs">{n}</li>)}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-muted-foreground">นับเมื่อเปิดหน้าเทรนนิ่ง / กดเล่นคลิป / เปิดสไลด์ (ครั้งเดิมภายใน 30 นาทีนับครั้งเดียว) — บอกว่ากดเล่น ไม่ได้บอกว่าดูจนจบ</p>
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

/** สไลด์ Google Slides: สูง = สไลด์ 16:9 + แถบปุ่มของ Google (~37px) — ไม่งั้นสไลด์หดมีขอบดำ (เห็นชัดบนมือถือ) */
function SlidesView({ id }: { id: string }) {
  return (
    <Frame
      src={slidesUrl(id)} title="สไลด์บรีฟโปรดักต์" extra={37}
      footer={<p className="min-w-0 flex-1 text-xs text-muted-foreground">แตะสไลด์ หรือกดลูกศร &lt; &gt; ใต้สไลด์เพื่อเปลี่ยนหน้า</p>}
    />
  );
}

/** วิดีโอในไดรฟ์ ส่งผ่านเซิร์ฟเวอร์ของเว็บทีละช่วง (Google บล็อกไม่ให้เว็บอื่นดึงจากลิงก์ไดรฟ์ตรงๆ) */
const streamUrl = (id: string) => `/api/training/video?id=${encodeURIComponent(id)}`;
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const POS_KEY = (id: string) => `glory_training_pos_${id}`;
/** "1:02:03" / "4:05" */
const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};

/**
 * ตัวเล่นวิดีโอของเว็บ (คลิปในไดรฟ์) — ควบคุมได้ทั้งหมด: เล่น / หยุด (แตะที่ภาพได้) · แถบเลื่อนเวลา · ย้อน / ข้าม 10 วิ
 *   · ความเร็ว · ปิดเสียง · เต็มจอ (iPhone = ตัวเล่นเต็มจอของ iPhone เอง) · เล่นต่อจากที่ดูค้าง (จำในเครื่อง)
 *   ปุ่มซ่อนเองหลังเล่น 3 วินาที (แตะ / ขยับเมาส์ = แสดง) · คีย์บอร์ด: เว้นวรรค = เล่น / หยุด · ← → = 10 วิ
 *   เล่นไม่ได้ (Google จำกัดการดาวน์โหลดชั่วคราว / เน็ตหลุด) = ข้อความ + ปุ่มเปิดในไดรฟ์
 */
function VideoPlayer({ id, title }: { id: string; title: string }) {
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const hideAt = useRef(0);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [shown, setShown] = useState(true);
  const [isFull, setIsFull] = useState(false);

  const poke = () => { hideAt.current = Date.now() + 3000; setShown(true); };
  useEffect(() => {
    // ซ่อนปุ่มเมื่อเล่นอยู่และไม่ได้แตะ 3 วินาที
    const t = window.setInterval(() => { if (Date.now() > hideAt.current) setShown(false); }, 500);
    const onFs = () => setIsFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => { window.clearInterval(t); document.removeEventListener("fullscreenchange", onFs); };
  }, []);

  const v = () => vid.current;
  const toggle = () => {
    const el = v();
    if (!el) return;
    if (el.paused) el.play().catch(() => setPaused(true));
    else el.pause();
    poke();
  };
  const seekTo = (s: number) => { const el = v(); if (el) el.currentTime = Math.max(0, Math.min(dur || el.duration || 0, s)); poke(); };
  const skip = (d: number) => seekTo((v()?.currentTime ?? 0) + d);
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    if (v()) v()!.playbackRate = next;
    setSpeed(next);
    poke();
  };
  const toggleMute = () => { const el = v(); if (el) { el.muted = !el.muted; setMuted(el.muted); } poke(); };
  function fullscreen() {
    const el = v() as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => undefined); return; }
    // iPhone: เต็มจอได้เฉพาะตัว video (ตัวเล่นของ iPhone มีปุ่มครบ) · อื่นๆ = เต็มจอทั้งกรอบ (ใช้ปุ่มของเว็บ)
    if (document.fullscreenEnabled && box.current) box.current.requestFullscreen().catch(() => el?.webkitEnterFullscreen?.());
    else el?.webkitEnterFullscreen?.();
  }

  // จำตำแหน่งที่ดูไว้ (ทุก 5 วินาที / ตอนหยุด) — ดูจบ = ลบ
  const lastSave = useRef(0);
  const savePos = (t: number, d: number) => {
    try {
      if (d && t > d - 15) localStorage.removeItem(POS_KEY(id));
      else if (t > 10) localStorage.setItem(POS_KEY(id), String(Math.floor(t)));
    } catch { /* ไม่มีที่เก็บ = ไม่จำ */ }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); skip(-10); }
    else if (e.key === "ArrowRight") { e.preventDefault(); skip(10); }
  };
  const showUi = shown || paused || failed;
  const iconBtn = "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-white hover:bg-white/15 [&_svg]:size-5";

  return (
    <div>
      <div className="mx-auto w-full max-w-[calc((100svh-120px)*16/9)]">
        <div
          ref={box} tabIndex={0} onKeyDown={onKeyDown} onMouseMove={poke}
          className={cn("group relative w-full overflow-hidden bg-black outline-none select-none", isFull ? "h-full" : "aspect-video rounded-xl border shadow-card", !showUi && "cursor-none")}
        >
          <video
            ref={vid} src={streamUrl(id)} playsInline preload="metadata" autoPlay title={title}
            className="absolute inset-0 size-full object-contain" onClick={toggle}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              setDur(el.duration);
              try {
                const at = Number(localStorage.getItem(POS_KEY(id)));
                if (at > 10 && at < el.duration - 15) { el.currentTime = at; toast(`เล่นต่อจาก ${clock(at)}`); }
              } catch { /* ไม่มีที่เก็บ */ }
            }}
            onDurationChange={(e) => setDur(e.currentTarget.duration)}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              setTime(el.currentTime);
              if (Date.now() - lastSave.current > 5000) { lastSave.current = Date.now(); savePos(el.currentTime, el.duration); }
            }}
            onPlay={() => { setPaused(false); poke(); }}
            onPause={(e) => { setPaused(true); savePos(e.currentTarget.currentTime, e.currentTarget.duration); }}
            onEnded={(e) => { setPaused(true); savePos(e.currentTarget.duration, e.currentTarget.duration); }}
            onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)} onPlaying={() => setBuffering(false)}
            onError={() => { setFailed(true); setBuffering(false); }}
          />

          {/* กลางจอ: กำลังโหลด / ปุ่มเล่นใหญ่ / เล่นไม่ได้ */}
          {failed ? (
            <div className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-sm text-white">
              <div>
                <p className="font-semibold">เล่นวิดีโอนี้ในเว็บไม่ได้ตอนนี้</p>
                <p className="mt-1 text-xs text-white/70">Google อาจจำกัดการเปิดไฟล์นี้ชั่วคราว (คนเปิดพร้อมกันเยอะ) หรือเน็ตหลุด</p>
                <Button size="sm" variant="secondary" className="mt-3" asChild>
                  <a href={`https://drive.google.com/file/d/${id}/view`} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />เปิดในไดรฟ์</a>
                </Button>
              </div>
            </div>
          ) : buffering && !paused ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="size-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
            </div>
          ) : paused ? (
            <button
              type="button" onClick={toggle} aria-label="เล่น"
              className="absolute inset-0 m-auto grid size-12 -translate-y-5 cursor-pointer place-items-center rounded-full bg-black/55 text-white sm:size-16 sm:-translate-y-4 [&_svg]:size-6 sm:[&_svg]:size-8"
            >
              {buffering && !dur ? <span className="size-6 animate-spin rounded-full border-4 border-white/30 border-t-white" /> : <PlayIcon className="fill-current" />}
            </button>
          ) : null}

          {/* แถบปุ่มด้านล่าง */}
          {!failed ? (
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pt-6 pb-1 transition-opacity",
                showUi ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              onClick={poke}
            >
              <div className="flex items-center gap-2 px-1 text-[11px] font-semibold text-white tabular-nums">
                <span>{clock(time)}</span>
                <input
                  type="range" min={0} max={dur || 0} step={0.1} value={Math.min(time, dur || 0)} aria-label="เลื่อนเวลา"
                  onChange={(e) => seekTo(Number(e.target.value))}
                  className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
                />
                <span>{clock(dur)}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <button type="button" className={iconBtn} onClick={toggle} aria-label={paused ? "เล่น" : "หยุด"}>
                  {paused ? <PlayIcon className="fill-current" /> : <PauseIcon className="fill-current" />}
                </button>
                <button type="button" className={cn(iconBtn, "relative")} onClick={() => skip(-10)} aria-label="ย้อน 10 วินาที">
                  <RotateCcwIcon /><span className="absolute inset-0 grid place-items-center pt-px text-[8px] font-bold">10</span>
                </button>
                <button type="button" className={cn(iconBtn, "relative")} onClick={() => skip(10)} aria-label="ข้าม 10 วินาที">
                  <RotateCwIcon /><span className="absolute inset-0 grid place-items-center pt-px text-[8px] font-bold">10</span>
                </button>
                <button type="button" className={iconBtn} onClick={toggleMute} aria-label={muted ? "เปิดเสียง" : "ปิดเสียง"}>
                  {muted ? <VolumeXIcon /> : <Volume2Icon />}
                </button>
                <span className="flex-1" />
                <button type="button" onClick={cycleSpeed} aria-label="ความเร็ว" className="h-8 shrink-0 cursor-pointer rounded-full px-2.5 text-xs font-bold text-white tabular-nums hover:bg-white/15">
                  {speed}x
                </button>
                <button type="button" className={iconBtn} onClick={fullscreen} aria-label={isFull ? "ออกจากเต็มจอ" : "เต็มจอ"}>
                  {isFull ? <MinimizeIcon /> : <MaximizeIcon />}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <b className="w-full text-sm break-words sm:w-auto sm:flex-1">{title}</b>
        <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground" asChild>
          <a href={`https://drive.google.com/file/d/${id}/view`} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />เปิดในไดรฟ์</a>
        </Button>
      </div>
    </div>
  );
}

/**
 * ตัวเล่นที่ฝังมาจาก Google / YouTube (คลิป YouTube + สไลด์) 16:9 + ปุ่ม "เต็มจอ" ของเว็บ
 *   ความสูงกรอบ = กว้าง × 9/16 + extra (px) — แถบปุ่มของ Google ที่อยู่นอกภาพ (สไลด์ 37px)
 *   กว้างไม่เกินที่ทำให้สูงพอดีจอ (มือถือแนวนอน: เดิมกรอบสูงเกินจอ ต้องเลื่อนดูภาพล่าง)
 *   เต็มจอ: Safari บน iPhone สั่งเต็มจอให้กรอบที่ฝังมาไม่ได้ → ขยายกรอบเดิมให้เต็มหน้าจอเอง (ไม่สร้างใหม่ เล่นต่อ) + เบราว์เซอร์ที่รองรับ = เต็มจอจริงด้วย
 *     ใหญ่สุดที่พอดีจอแบบ 16:9 อยู่กลางจอ · เผื่อแค่รอยบาก / ขอบจอ (safe area) · ปุ่มออกลอยมุมซ้ายบน (พื้นที่ดำข้างกรอบ)
 *   คลิปในไดรฟ์ใช้ VideoPlayer (ตัวเล่นของเว็บเอง — ตัวเล่นที่ฝังมาจากไดรฟ์ควบคุมไม่ได้)
 */
function Frame({ src, title, extra = 0, footer }: { src: string; title: string; extra?: number; footer?: React.ReactNode }) {
  const [full, setFull] = useState(false);
  const add = extra;
  // เต็มจอ (cq = ขนาดกรอบเต็มจอ): พื้นที่ใช้ได้ = จอ - safe area → กว้าง / สูงพอดีแบบ 16:9 (+ add) อยู่กลาง
  const sT = "env(safe-area-inset-top)", sB = "env(safe-area-inset-bottom)", sL = "env(safe-area-inset-left)", sR = "env(safe-area-inset-right)";
  const aw = `(100cqw - ${sL} - ${sR})`, ah = `(100cqh - ${sT} - ${sB})`;
  const fw = `min(${aw}, (${ah} - ${add}px) * 16 / 9)`;
  const fh = `min(${ah}, ${aw} * 9 / 16 + ${add}px)`;
  const fullStyle = {
    width: `calc(${fw})`, height: `calc(${fh})`,
    left: `calc(${sL} + (${aw} - ${fw}) / 2)`, top: `calc(${sT} + (${ah} - ${fh}) / 2)`,
  };
  const box = useRef<HTMLDivElement>(null);
  function enter() {
    setFull(true);
    if (document.fullscreenEnabled) box.current?.requestFullscreen().catch(() => undefined);
  }
  function exit() {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }
  useEffect(() => {
    if (!full) return;
    // ออกจากเต็มจอของเบราว์เซอร์ (ปุ่ม Esc / ปัดกลับ) = ออกจากโหมดเต็มจอของเว็บด้วย · Esc · ล็อกการเลื่อนหน้าหลัง
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [full]);
  return (
    <>
      {/* โครงเดิมทั้งสองโหมด (เปลี่ยนแค่ class) — iframe ไม่ถูกสร้างใหม่ วิดีโอไม่เริ่มใหม่ */}
      <div
        className={full ? "fixed inset-0 z-[70] bg-black" : "mx-auto w-full"}
        style={full ? undefined : { maxWidth: `calc((100svh - 120px - ${add}px) * 16 / 9)` }}
      >
        <div
          ref={box} className={full ? "absolute inset-0 bg-black" : "relative w-full overflow-hidden rounded-xl border bg-black shadow-card"}
          style={full ? { containerType: "size" } : { paddingBottom: `calc(56.25% + ${add}px)` }}
        >
          {full ? (
            <button
              type="button" onClick={exit} aria-label="ออกจากเต็มจอ"
              className="absolute top-[calc(env(safe-area-inset-top)+8px)] left-[calc(env(safe-area-inset-left)+8px)] z-10 flex cursor-pointer items-center gap-1 rounded-full bg-white/20 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur [&_svg]:size-4"
            >
              <XIcon />ออก
            </button>
          ) : null}
          <iframe
            src={src} title={title} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen
            className={full ? "absolute" : "absolute inset-0 size-full"} style={full ? fullStyle : undefined}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {footer}
        <Button size="sm" variant="outline" className="ml-auto" onClick={enter}><MaximizeIcon />เต็มจอ</Button>
      </div>
    </>
  );
}

/** รูปตัวอย่างวิดีโอ (โหลดไม่ได้ = ไอคอน) */
function Thumb({ src }: { src: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return <span className="grid size-full place-items-center text-muted-foreground [&_svg]:size-6"><VideoIcon /></span>;
  // eslint-disable-next-line @next/next/no-img-element -- รูปจาก Google Drive / YouTube (ไม่ผ่านตัวย่อรูปของ Next)
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="size-full object-cover" />;
}
