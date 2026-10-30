"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, ListChecksIcon, MaximizeIcon, PencilIcon, PlayIcon, PlusIcon, PresentationIcon,
  RefreshCwIcon, Settings2Icon, ShirtIcon, SquarePlayIcon, Trash2Icon, UsersIcon, VideoIcon, XIcon,
} from "lucide-react";
import { LiveFrames } from "@/components/LiveFrames";
import { AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, Notice, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Training, TrainingGroup, TrainingProgress, TrainingVideo, TrainingViews } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * หน้าเทรนนิ่ง: วิดีโอ product training + สไลด์บรีฟโปรดักต์ — เล่น / เปิดในหน้าเว็บด้วยตัวเล่นของ Google / YouTube (ไม่ต้องไปที่ไดรฟ์)
 *   โหลดตัวเล่นวิดีโอทีละ 1 ตัว (ตัวที่เลือก) · วิดีโอไม่ผ่านเซิร์ฟเวอร์ของเว็บ (กันปริมาณส่งข้อมูลของ Vercel เกินโควตา)
 *   คลิป YouTube = นับดูจบอัตโนมัติ (YouTubePlayer) · คลิปในไดรฟ์ = ตัวเล่นของ Google กด "ดูจบแล้ว" เอง → Owner ย้ายไป YouTube ได้ในโหมดจัดการคลิป
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
  const [tab, setTab] = useState<"video" | "slides" | "views" | "frames">("video");
  const [playing, setPlaying] = useState<TrainingVideo | null>(null);
  const [manage, setManage] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rename, setRename] = useState<Rename | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<TrainingVideo | null>(null);
  // คลิปที่ดูจบแล้วในรอบนี้ (รวมกับที่เซิร์ฟเวอร์ส่งมา) — ป้าย "ดูแล้ว" ขึ้นทันทีไม่ต้องโหลดใหม่
  const [justDone, setJustDone] = useState<string[]>([]);
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
  const toggleRequired = (ref: string, required: boolean) => run(`req${ref}`, { action: "required", ref, required });
  // คลิปบังคับก่อนจองคิว (ที่ทีมเห็น) + ดูจบแล้วกี่คลิป
  const gate = data.gate;
  const done = new Set([...(gate?.done ?? []), ...justDone]);
  const requiredClips = data.groups.filter((g) => !g.hidden).flatMap((g) => g.videos.filter((v) => !v.hidden && v.required));
  const requiredDone = requiredClips.filter((v) => done.has(v.ref)).length;
  const markDone = (v: TrainingVideo) => {
    if (done.has(v.ref)) return;
    track("done", v);
    setJustDone((d) => [...d, v.ref]);
    if (v.required) toast(`ดูจบแล้ว: ${v.title}`);
  };
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
          {/* Owner / คนที่จัดการบรีฟได้ มี 3–4 แท็บ: จอมือถือใช้ชื่อสั้น */}
          <ToggleGroupItem value="video" aria-label="วิดีโอเทรนนิ่ง" className="flex-1 font-semibold sm:flex-none">
            <VideoIcon />{canManage || data.frames ? <><span className="sm:hidden">วิดีโอ</span><span className="max-sm:hidden">วิดีโอเทรนนิ่ง</span></> : "วิดีโอเทรนนิ่ง"} ({shown})
          </ToggleGroupItem>
          <ToggleGroupItem value="slides" aria-label="สไลด์บรีฟโปรดักต์" className="flex-1 font-semibold sm:flex-none">
            <PresentationIcon />{canManage || data.frames ? <><span className="sm:hidden">สไลด์</span><span className="max-sm:hidden">สไลด์บรีฟโปรดักต์</span></> : "สไลด์บรีฟโปรดักต์"}
          </ToggleGroupItem>
          {data.frames ? (
            <ToggleGroupItem value="frames" aria-label="เฟรมไลฟ์ + บรีฟการแต่งตัว" className="flex-1 font-semibold sm:flex-none">
              <ShirtIcon /><span className="sm:hidden">เฟรม</span><span className="max-sm:hidden">เฟรมไลฟ์</span>
            </ToggleGroupItem>
          ) : null}
          {canManage ? <ToggleGroupItem value="views" aria-label="ผู้เข้าชม" className="flex-1 font-semibold sm:flex-none"><UsersIcon /><span className="sm:hidden">คนดู</span><span className="max-sm:hidden">ผู้เข้าชม</span></ToggleGroupItem> : null}
        </ToggleGroup>
        {canManage && tab === "video" ? (
          <Button variant={manage ? "selected" : "outline"} className="rounded-full sm:ml-auto" onClick={() => setManage(!manage)} aria-pressed={manage}>
            <Settings2Icon />{manage ? "เสร็จสิ้น" : "จัดการคลิป"}
          </Button>
        ) : null}
      </div>

      {tab === "frames" && data.frames ? <LiveFrames /> : tab === "views" && canManage ? <><RequiredProgress /><ViewsPanel /></> : tab === "slides" ? (
        data.slides ? (
          // อ่านทีละหน้าในเว็บ (นับหน้าได้) · อ่านสไลด์ผ่าน API ไม่ได้ = กรอบของ Google แบบเดิม
          data.deck ? (
            <SlideReader
              id={data.slides} deck={data.deck}
              required={!!(gate?.on && gate.slides && !gate.passed)} doneBefore={!!gate?.done.includes(`slides:${data.slides}`)}
            />
          ) : <SlidesView id={data.slides} />
        ) : <Notice>ยังไม่ได้ตั้งสไลด์บรีฟโปรดักต์ (settings.training_slides)</Notice>
      ) : (
        <>
          {data.message ? <Notice variant="warning" icon title="อ่านรายชื่อวิดีโอไม่สำเร็จ">{data.message}</Notice> : null}
          {/* Admin เสริมใหม่: อ่านสไลด์ครบก่อนรับคิว (อยู่แท็บสไลด์) */}
          {!editing && gate?.on && gate.slides && !gate.passed && data.slides && !gate.done.includes(`slides:${data.slides}`) ? (
            <Notice variant="warning" icon className="mb-3" title="อ่านสไลด์บรีฟโปรดักต์ให้ครบทุกหน้าก่อนรับคิว">
              <Button size="sm" className="mt-1 pointer-coarse:h-9" onClick={() => { track("slides"); setTab("slides"); }}>ไปอ่านสไลด์</Button>
            </Notice>
          ) : null}
          {/* Mc ใหม่ (ยังไม่มีคิว): คลิปบังคับก่อนจองคิว */}
          {!editing && gate?.on && gate.applies && requiredClips.length ? (
            gate.passed || requiredDone >= requiredClips.length ? (
              <Notice className="mb-3" title={gate.passed ? "ผ่านเทรนนิ่งแล้ว (ทีมงานให้ผ่าน)" : `ดูคลิปบังคับครบแล้ว ${requiredDone}/${requiredClips.length} ✓`}>จองคิวได้ตามปกติ</Notice>
            ) : (
              <Notice variant="warning" icon className="mb-3" title={`ดูคลิปที่มีป้าย "บังคับ" ให้ครบก่อนจองคิว — ดูแล้ว ${requiredDone}/${requiredClips.length}`}>
                เล่นในหน้านี้จนจบ ระบบนับให้อัตโนมัติ (คลิปที่ขึ้นปุ่ม &quot;ดูจบแล้ว&quot; ใต้คลิป กดเองเมื่อดูจบ) ครบแล้วกลับไปจองได้เลย
              </Notice>
            )
          ) : null}
          {editing ? (
            data.manage?.ready ? (
              <div className="mb-4 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  ซ่อน = ทีมไม่เห็นในหน้าเทรนนิ่ง (ไฟล์ในไดรฟ์ไม่ถูกลบ กดแสดงกลับได้) · แก้ชื่อ = เปลี่ยนเฉพาะชื่อที่แสดงในเว็บ
                  · คลิปใหม่ในโฟลเดอร์ไดรฟ์ขึ้นเองภายใน 10 นาที (กดรีเฟรชให้ขึ้นทันที)
                  · ย้ายไป YouTube = อัปโหลดคลิปขึ้น YouTube แบบ &quot;ไม่เป็นสาธารณะ&quot; แล้ววางลิงก์ — ระบบนับดูจบให้อัตโนมัติ (คลิปในไดรฟ์ต้องกดดูจบเอง)
                  · บังคับ = Mc ใหม่ (ยังไม่มีคิว) ต้องดูจบก่อนจองคิว (ติ๊กที่คลิป หรือทั้งกลุ่ม)
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" disabled={!!busy} onClick={() => setAdding(true)}><PlusIcon />เพิ่มคลิปจากลิงก์</Button>
                  <Button size="sm" variant="outline" className="bg-card" disabled={!!busy} onClick={() => run("refresh", { action: "refresh" })}>
                    <RefreshCwIcon className={cn(busy === "refresh" && "animate-spin")} />{busy === "refresh" ? "กำลังอ่าน..." : "รีเฟรชจากไดรฟ์"}
                  </Button>
                </div>
                <GateToggle on={!!gate?.on} count={requiredClips.length} onChanged={() => setAttempt((n) => n + 1)} />
              </div>
            ) : <Notice variant="warning" icon title="ยังจัดการคลิปในเว็บไม่ได้">{data.manage?.message}</Notice>
          ) : null}

          <div ref={player} className="scroll-mt-4">
            {playing ? (
              <div className="mb-4">
                {playing.kind === "youtube" ? (
                  <YouTubePlayer key={playing.ref} video={playing} done={done.has(playing.ref)} onDone={() => markDone(playing)} />
                ) : (
                  <Frame
                    key={playing.ref} src={playerUrl(playing)} title={playing.title}
                    footer={(
                      <>
                        <b className="w-full text-sm break-words sm:w-auto sm:flex-1">{playing.title}</b>
                        <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground" asChild>
                          <a href={openUrl(playing)} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />เปิดในไดรฟ์</a>
                        </Button>
                        {/* ตัวเล่นของไดรฟ์: เว็บรู้ไม่ได้ว่าดูจบหรือยัง → กดเองเมื่อดูจบ (คลิปบังคับ) */}
                        {playing.required ? (
                          <Button size="sm" variant={done.has(playing.ref) ? "outline" : "default"} disabled={done.has(playing.ref)} onClick={() => markDone(playing)}>
                            <CheckIcon />{done.has(playing.ref) ? "ดูจบแล้ว" : "ดูจบแล้ว กดยืนยัน"}
                          </Button>
                        ) : null}
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
                  {editing && g.required ? <Badge className="text-[11px]">บังคับทั้งกลุ่ม</Badge> : null}
                  {editing && g.ref ? (
                    <span className="ml-auto flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => toggleRequired(g.ref!, !g.required)}>
                        <ListChecksIcon />{g.required ? "เลิกบังคับกลุ่ม" : "บังคับทั้งกลุ่ม"}
                      </Button>
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
                          {(editing && (v.hidden || v.added)) || v.required || done.has(v.ref) ? (
                            <span className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                              {v.required ? <span className="rounded bg-warning px-1.5 text-[11px] font-semibold text-warning-foreground">บังคับ</span> : null}
                              {done.has(v.ref) ? <span className="rounded bg-success px-1.5 text-[11px] font-semibold text-white">ดูแล้ว ✓</span> : null}
                              {editing && v.hidden ? <span className="rounded bg-black/70 px-1.5 text-[11px] font-semibold text-white">ซ่อนอยู่</span> : null}
                              {editing && v.added ? <span className="rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{v.kind === "youtube" ? "YouTube" : "เพิ่มจากลิงก์"}</span> : null}
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
                          {/* บังคับทั้งกลุ่มอยู่ = ตั้งที่หัวกลุ่ม */}
                          {!g.required ? (
                            <ClipButton
                              label="บังคับ" aria-pressed={v.required} title={v.required ? "กดเพื่อเลิกบังคับ" : "ต้องดูจบก่อนจองคิว"}
                              disabled={!!busy} onClick={() => toggleRequired(v.ref, !v.required)}
                              className={cn(v.required && "bg-warning text-warning-foreground hover:bg-warning")}
                            ><ListChecksIcon /></ClipButton>
                          ) : null}
                          {v.kind === "drive" && !v.added ? (
                            <ClipButton label="YouTube" title="ย้ายไปเล่นจาก YouTube (นับดูจบอัตโนมัติ)" disabled={!!busy} onClick={() => setMoving(v)}><SquarePlayIcon /></ClipButton>
                          ) : null}
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
      <MoveDialog
        video={moving} busy={!!busy} onClose={() => setMoving(null)}
        onMove={async (url) => {
          if (!moving || !(await run(`yt${moving.ref}`, { action: "youtube", ref: moving.ref, url }))) return;
          if (playing?.ref === moving.ref) setPlaying(null);
          setMoving(null);
        }}
      />
    </div>
  );
}

/** บันทึกการเข้าชม (เงียบ — พลาดไม่เป็นไร ไม่แจ้งผู้ใช้) · done = ดูคลิปจบ / อ่านสไลด์ครบ (นับเทรนนิ่งก่อนจอง) */
function track(kind: "page" | "video" | "slides" | "done", v?: Pick<TrainingVideo, "ref" | "title">) {
  fetch("/api/training", {
    method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ action: "view", kind, ref: v?.ref, title: v?.title }),
  }).catch(() => undefined);
}

/** โหมดจัดการ: เปิด / ปิด บังคับดูคลิปก่อนจองคิว */
function GateToggle({ on, count, onChanged }: { on: boolean; count: number; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  async function set(next: boolean) {
    if (next && !(await confirm({
      title: "เปิดบังคับดูคลิปก่อนจองคิว?",
      description: `Mc ใหม่ (ยังไม่มีคิว) ที่ยังดูคลิปบังคับ (${count} คลิป) ไม่ครบ จะจองคิวผ่านเว็บไม่ได้จนกว่าจะดูครบ · Mc ที่มีคิวแล้วจองได้ตามปกติ — ระบบแจ้งเตือนคนที่ยังไม่ครบให้ · ให้ผ่านรายคนได้ที่แท็บ "ผู้เข้าชม"`,
      confirmText: "เปิดใช้",
    }))) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/training", { action: "gate", on: next });
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
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-primary/20 pt-3">
      <span className="min-w-0 flex-1 leading-snug">
        <b>บังคับดูก่อนจองคิว: {on ? "เปิดอยู่" : "ปิดอยู่"}</b>
        <span className="block text-xs text-muted-foreground">
          {count ? `คลิปบังคับ ${count} คลิป` : "ยังไม่มีคลิปบังคับ — กด \"บังคับ\" ใต้คลิป หรือ \"บังคับทั้งกลุ่ม\" ที่หัวกลุ่ม"}
          {on ? " · Mc ใหม่ (ยังไม่มีคิว) ที่ยังดูไม่ครบจองคิวไม่ได้ · Mc ที่มีคิวแล้วไม่ต้องดู" : ""}
        </span>
      </span>
      <Button size="sm" variant={on ? "outline" : "default"} className={cn("pointer-coarse:h-10", on && "bg-card")} disabled={busy || (!on && !count)} onClick={() => set(!on)}>
        {busy ? "กำลังบันทึก..." : on ? "ปิดใช้" : "เปิดใช้"}
      </Button>
    </div>
  );
}

/** แท็บผู้เข้าชม: ดูคลิปบังคับครบกี่คน + ให้ผ่านรายคน (เทรนนอกเว็บแล้ว) */
function RequiredProgress() {
  const toast = useToast();
  const [data, setData] = useState<TrainingProgress | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    api<TrainingProgress>("/api/training?progress=1")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick]);

  if (error) return <Notice variant="warning" icon className="mb-4" title="โหลดความคืบหน้าคลิปบังคับไม่สำเร็จ">{error}</Notice>;
  if (!data || (!data.total && !data.people.some((p) => p.need === "slides"))) return null;
  async function pass(id: number, passed: boolean) {
    setBusy(id);
    try {
      const res = await api<{ message: string }>("/api/training", { action: "pass", staffId: id, passed });
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      setTick((n) => n + 1);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  // Mc ใหม่ = คลิปบังคับ (ไม่มีคลิปบังคับ = ไม่ต้องดู) · Admin เสริมใหม่ = อ่านสไลด์ครบ (done 1)
  const goal = (p: TrainingProgress["people"][number]) => (p.need === "slides" ? 1 : data.total);
  const finished = (p: TrainingProgress["people"][number]) => p.done >= goal(p);
  const ok = (p: TrainingProgress["people"][number]) => p.passed || finished(p);
  const people = [...data.people].sort((a, b) => Number(ok(a)) - Number(ok(b)) || a.who.localeCompare(b.who, "th"));
  return (
    <section className="mb-5">
      <h3 className="text-sm font-semibold">
        เทรนนิ่งก่อนจองคิว (คนใหม่) · ผ่านแล้ว {data.people.filter(ok).length}/{data.people.length} คน
        <span className="font-normal text-muted-foreground">
          {" "}· {data.on ? "เปิดใช้อยู่" : "ยังไม่เปิดใช้ (เปิดที่ จัดการคลิป)"} · Mc ใหม่ = คลิปบังคับ {data.total} คลิป · Admin เสริมใหม่ = อ่านสไลด์ครบทุกหน้า
          · คนที่มีคิวแล้วไม่ต้อง ไม่อยู่ในรายชื่อ
        </span>
      </h3>
      <ul className="scroll-thin mt-1.5 max-h-80 divide-y overflow-y-auto rounded-xl border bg-card">
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{p.who}</span>
            <span className={cn("text-xs font-semibold tabular-nums", ok(p) ? "text-success" : "text-destructive")}>
              {p.passed ? "ให้ผ่านแล้ว"
                : p.need === "slides" ? (finished(p) ? "อ่านสไลด์ครบ ✓" : "สไลด์ยังไม่ครบ")
                  : `คลิป ${p.done}/${data.total}${finished(p) ? " ✓" : ""}`}
            </span>
            {!finished(p) ? (
              <Button size="xs" variant="outline" disabled={busy === p.id} onClick={() => pass(p.id, !p.passed)} className="pointer-coarse:h-9 pointer-coarse:px-3">
                {p.passed ? "ยกเลิกให้ผ่าน" : "ให้ผ่าน"}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted-foreground">
        ดูจบ = คลิป YouTube เล่นในเว็บจริงเกิน 85% ของคลิป (เลื่อนข้ามไม่นับ) · คลิปในไดรฟ์ = กด &quot;ดูจบแล้ว&quot; เอง
        · อ่านสไลด์ครบ = เปิดในเว็บครบทุกหน้า (หน้าละอย่างน้อย 3 วินาที) · ให้ผ่าน = จองได้โดยไม่ต้องดู (เช่น เทรนนอกเว็บแล้ว)
      </p>
    </section>
  );
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
                  className={cn("cursor-pointer rounded-full border px-2 py-0.5 text-[11px]", group === n ? "border-tint-border bg-tint text-tint-foreground" : "bg-card hover:border-primary")}
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

/** ย้ายคลิปในไดรฟ์ไปเล่นจาก YouTube: วางลิงก์คลิปที่อัปโหลดแล้ว (แบบไม่เป็นสาธารณะ) */
function MoveDialog({ video, busy, onClose, onMove }: { video: TrainingVideo | null; busy: boolean; onClose: () => void; onMove: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState<string | null>(null);
  // เปิดหน้าต่างใหม่ = ล้างช่องลิงก์
  if (video && video.ref !== ref) { setRef(video.ref); setUrl(""); }
  if (!video && ref) setRef(null);
  return (
    <AppDialog
      open={!!video} onClose={onClose} busy={busy} title="ย้ายคลิปไปเล่นจาก YouTube"
      description={video ? <>คลิป: {video.title}</> : undefined}
    >
      <DialogBody className="space-y-2 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li>
            <a href={video ? openUrl(video) : undefined} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">
              ดาวน์โหลดคลิปจากไดรฟ์
            </a>{" "}แล้วอัปโหลดขึ้น YouTube ตั้งค่าการเผยแพร่เป็น <b className="text-foreground">&quot;ไม่เป็นสาธารณะ&quot; (Unlisted)</b>
          </li>
          <li>คัดลอกลิงก์คลิปจาก YouTube มาวางด้านล่าง</li>
        </ol>
        <Label htmlFor="training-yt" className="mb-1.5">ลิงก์ YouTube</Label>
        <Input id="training-yt" value={url} inputMode="url" placeholder="https://youtu.be/…" onChange={(e) => setUrl(e.target.value)} autoFocus />
        <p className="text-xs text-muted-foreground">
          คลิป YouTube ได้ชื่อ + ป้ายบังคับเหมือนเดิม และระบบนับดูจบให้อัตโนมัติ · คลิปในไดรฟ์จะถูกซ่อน (ไม่ลบ) · คนที่ดูจบแล้วไม่ต้องดูซ้ำ
        </p>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" disabled={busy} onClick={onClose}>ยกเลิก</Button>
        <Button disabled={busy || !url.trim()} onClick={() => onMove(url)}>{busy ? "กำลังย้าย..." : "ย้ายไป YouTube"}</Button>
      </DialogActions>
    </AppDialog>
  );
}

/** รูปสไลด์หน้า i (เริ่ม 0) ของรุ่นนี้ — เซิร์ฟเวอร์ดึงจาก Google ครั้งแรกแล้วเก็บไว้ */
const slideUrl = (i: number, rev: string) => `/api/training/slide?i=${i}&r=${encodeURIComponent(rev)}`;
/** อ่านหน้านี้นานเท่านี้ขึ้นไป = นับว่าอ่านแล้ว */
const SLIDE_READ_MS = 3000;
const SLIDE_POS_KEY = (id: string) => `glory_slides_pos_${id}`;
const SLIDE_SEEN_KEY = (id: string, rev: string) => `glory_slides_seen_${id}_${rev}`;

/**
 * สไลด์บรีฟอ่านทีละหน้าในเว็บ (นับหน้าที่อ่านแล้วได้ — Admin เสริมใหม่ต้องอ่านครบทุกหน้าก่อนรับคิว)
 *   อ่านแล้ว = หน้านั้นขึ้นจอครบ 3 วินาที · จำหน้าที่อ่านแล้ว / หน้าล่าสุดไว้ในเครื่อง (แก้สไลด์ = รุ่นใหม่ นับใหม่)
 *   ครบทุกหน้า = บันทึก "อ่านครบ" (done 'slides:<id>') ครั้งเดียว · ลูกศร / ปัดซ้ายขวา / คีย์ ← → = เปลี่ยนหน้า
 *   required = คนดูอยู่ต้องอ่านครบก่อนรับคิว · doneBefore = เคยอ่านครบแล้ว (บันทึกในระบบ)
 */
function SlideReader({ id, deck, required, doneBefore }: { id: string; deck: { pages: number; rev: string }; required: boolean; doneBefore: boolean }) {
  const toast = useToast();
  const total = deck.pages;
  const read = <T,>(key: string, fallback: T, parse: (s: string) => T) => {
    try { const s = localStorage.getItem(key); return s === null ? fallback : parse(s); } catch { return fallback; }
  };
  const [index, setIndex] = useState(() => Math.min(total - 1, Math.max(0, read(SLIDE_POS_KEY(id), 0, Number) || 0)));
  const [seen, setSeen] = useState<Set<number>>(() => new Set(read<number[]>(SLIDE_SEEN_KEY(id, deck.rev), [], (s) => JSON.parse(s) as number[])));
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  const go = (i: number) => {
    const next = Math.max(0, Math.min(total - 1, i));
    if (next === index) return;
    setIndex(next);
    setLoaded(false);
    setFailed(false);
    try { localStorage.setItem(SLIDE_POS_KEY(id), String(next)); } catch { /* ไม่มีที่เก็บ = ไม่จำ */ }
  };

  // หน้านี้ขึ้นจอครบ 3 วินาที = อ่านแล้ว
  useEffect(() => {
    if (!loaded || seen.has(index)) return;
    const t = window.setTimeout(() => {
      setSeen((prev) => {
        const next = new Set(prev).add(index);
        try { localStorage.setItem(SLIDE_SEEN_KEY(id, deck.rev), JSON.stringify([...next])); } catch { /* นับเฉพาะรอบนี้ */ }
        return next;
      });
    }, SLIDE_READ_MS);
    return () => window.clearTimeout(t);
  }, [loaded, index, seen, id, deck.rev]);

  // ครบทุกหน้า = บันทึกครั้งเดียว (เคยครบในเครื่องนี้แต่บันทึกไม่ทัน = ส่งใหม่ตอนเปิด)
  const all = seen.size >= total;
  const done = doneBefore || all;
  const sent = useRef(doneBefore);
  useEffect(() => {
    if (!all || sent.current) return;
    sent.current = true;
    track("done", { ref: `slides:${id}`, title: "สไลด์บรีฟโปรดักต์" });
    if (required) toast("อ่านสไลด์ครบทุกหน้าแล้ว รับคิวได้เลย");
  }, [all, id, required, toast]);

  // โหลดหน้าถัดไปรอไว้ (เปลี่ยนหน้าแล้วขึ้นทันที)
  useEffect(() => {
    if (!loaded || index + 1 >= total) return;
    const img = new Image();
    img.src = slideUrl(index + 1, deck.rev);
  }, [loaded, index, total, deck.rev]);

  const firstUnseen = Array.from({ length: total }, (_, i) => i).find((i) => !seen.has(i));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
  };
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else box.current?.requestFullscreen().catch(() => undefined);
  }
  const navBtn = "absolute top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-black/45 text-white transition-opacity hover:bg-black/65 disabled:pointer-events-none disabled:opacity-0 [&_svg]:size-6";

  return (
    <div>
      {required && !done ? (
        <Notice variant="warning" icon className="mb-3" title={`อ่านสไลด์ให้ครบทุกหน้าก่อนรับคิว — อ่านแล้ว ${seen.size}/${total} หน้า`}>
          เปิดทีละหน้าจนครบ (หน้าละอย่างน้อย 3 วินาที) ระบบนับให้อัตโนมัติ · อ่านค้างไว้ได้ กลับมาอ่านต่อในเครื่องเดิม
        </Notice>
      ) : required ? (
        <Notice className="mb-3" title="อ่านสไลด์ครบทุกหน้าแล้ว ✓">รับคิวได้ตามปกติ</Notice>
      ) : null}
      <div className="mx-auto w-full max-w-[calc((100svh-160px)*16/9)]">
        <div
          ref={box} tabIndex={0} onKeyDown={onKeyDown}
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const dx = touchX.current === null ? 0 : e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
          }}
          className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl border bg-black shadow-card outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {failed ? (
            <div className="p-4 text-center text-sm text-white">
              โหลดหน้านี้ไม่สำเร็จ
              <Button size="sm" variant="secondary" className="mt-2 block mx-auto" onClick={() => { setFailed(false); setLoaded(false); setIndex((i) => i); }}>ลองใหม่</Button>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- รูปจาก API ของเว็บเอง (ต้องส่ง cookie) ไม่ผ่าน next/image
            <img
              key={`${index}-${failed}`} src={slideUrl(index, deck.rev)} alt={`สไลด์บรีฟโปรดักต์ หน้า ${index + 1}`}
              className={cn("size-full object-contain transition-opacity", loaded ? "opacity-100" : "opacity-0")}
              onLoad={() => setLoaded(true)} onError={() => setFailed(true)} draggable={false}
            />
          )}
          {!loaded && !failed ? <span className="absolute text-sm text-white/80">กำลังโหลดหน้า {index + 1}...</span> : null}
          <button type="button" aria-label="หน้าก่อน" className={cn(navBtn, "left-2")} disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeftIcon /></button>
          <button type="button" aria-label="หน้าถัดไป" className={cn(navBtn, "right-2")} disabled={index >= total - 1} onClick={() => go(index + 1)}><ChevronRightIcon /></button>
          {seen.has(index) ? (
            <span className="absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white"><CheckIcon className="mr-0.5 inline size-3" />อ่านแล้ว</span>
          ) : null}
        </div>
        {/* แถบความคืบหน้า: หน้าที่อ่านแล้ว */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(seen.size / total) * 100}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Button variant="outline" size="icon" aria-label="หน้าก่อน" disabled={index === 0} onClick={() => go(index - 1)} className="pointer-coarse:size-10"><ChevronLeftIcon /></Button>
          <span className="font-semibold tabular-nums">หน้า {index + 1}/{total}</span>
          <Button variant="outline" size="icon" aria-label="หน้าถัดไป" disabled={index >= total - 1} onClick={() => go(index + 1)} className="pointer-coarse:size-10"><ChevronRightIcon /></Button>
          <span className={cn("text-xs tabular-nums", all ? "font-semibold text-success" : "text-muted-foreground")}>
            อ่านแล้ว {seen.size}/{total}{all ? " ✓" : ""}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {firstUnseen !== undefined && firstUnseen !== index ? (
              <Button size="sm" variant="outline" onClick={() => go(firstUnseen)} className="pointer-coarse:h-9">ไปหน้าที่ยังไม่ได้อ่าน ({firstUnseen + 1})</Button>
            ) : null}
            <Button variant="ghost" size="icon" aria-label="เต็มจอ" onClick={fullscreen} className="pointer-coarse:size-10"><MaximizeIcon /></Button>
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          ปัดซ้าย / ขวา หรือกดลูกศรเพื่อเปลี่ยนหน้า ·{" "}
          <a href={`https://docs.google.com/presentation/d/${id}/view`} target="_blank" rel="noreferrer" className="underline underline-offset-2">เปิดใน Google Slides</a>
          {required ? " (อ่านใน Google Slides ไม่นับหน้า)" : ""}
        </p>
      </div>
    </div>
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

const POS_KEY = (id: string) => `glory_training_pos_${id}`;
/** วินาทีที่เล่นจริงสะสม (เลื่อนข้ามไม่นับ) ใช้ตัดสินว่าดูจบ — จำในเครื่องนี้ ดูต่อวันอื่นได้ */
const WATCH_KEY = (id: string) => `glory_training_watched_${id}`;
/** เล่นจริงเกินเท่านี้ของความยาวคลิป = ดูจบ */
const DONE_RATIO = 0.85;
const readNum = (key: string) => {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
};

/** YouTube IFrame API (โหลดสคริปต์ครั้งเดียว) — อ่านเวลาที่เล่นของคลิป YouTube ที่ฝังในหน้า */
type YTPlayer = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number };
type YTApi = { loaded?: number; Player: new (el: HTMLIFrameElement, opts: { events: Record<string, (e: { data: number }) => void> }) => YTPlayer };
let ytApi: Promise<YTApi> | null = null;
function loadYouTubeApi() {
  const w = window as unknown as { YT?: YTApi; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.loaded) return Promise.resolve(w.YT);
  ytApi ??= new Promise<YTApi>((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT!); };
    const el = document.createElement("script");
    el.src = "https://www.youtube.com/iframe_api";
    el.async = true;
    el.onerror = () => { ytApi = null; el.remove(); reject(new Error("โหลด YouTube API ไม่ได้")); };
    document.head.appendChild(el);
  });
  return ytApi;
}

/**
 * คลิป YouTube: ตัวเล่นของ YouTube (วิดีโอไม่ผ่านเซิร์ฟเวอร์ของเว็บ) + นับเวลาที่เล่นจริงทุก 1 วินาที (YouTube IFrame API)
 *   เล่นต่อเนื่อง = นับ (เล่นเร็วถึง 2x ได้ · แท็บพื้นหลังที่เบราว์เซอร์หน่วงเวลาก็นับ) · เลื่อนข้าม / หยุด = ไม่นับ
 *   ครบ 85% ของคลิป = onDone ครั้งเดียว · จำเวลาที่นับ + ตำแหน่งที่ดูค้างในเครื่องนี้ (เปิดอีกครั้งเล่นต่อจากเดิม)
 *   โหลดตัวนับไม่ได้ (เน็ต / ส่วนขยายบล็อก) = ปุ่ม "ดูจบแล้ว" ให้กดเอง (คลิปบังคับ)
 */
function YouTubePlayer({ video, done, onDone }: { video: TrainingVideo; done: boolean; onDone: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [pct, setPct] = useState(0);
  const [noApi, setNoApi] = useState(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });
  // เริ่มจากที่ดูค้าง (อ่านครั้งเดียว — src ไม่เปลี่ยนระหว่างเล่น)
  const [src] = useState(() => {
    const at = readNum(POS_KEY(video.id));
    const q = new URLSearchParams({ rel: "0", playsinline: "1", enablejsapi: "1", origin: window.location.origin, ...(at > 10 ? { start: String(Math.floor(at)) } : {}) });
    return `https://www.youtube-nocookie.com/embed/${video.id}?${q}`;
  });

  useEffect(() => {
    const id = video.id;
    let player: YTPlayer | null = null;
    let timer = 0, alive = true, sent = false, saved = 0;
    let watched = readNum(WATCH_KEY(id));
    let last: { t: number; at: number } | null = null;
    const save = (t: number, d: number) => {
      try {
        localStorage.setItem(WATCH_KEY(id), String(Math.floor(watched)));
        if (d && t > d - 15) localStorage.removeItem(POS_KEY(id));
        else if (t > 10) localStorage.setItem(POS_KEY(id), String(Math.floor(t)));
      } catch { /* ไม่มีที่เก็บ = นับเฉพาะรอบนี้ */ }
    };
    const tick = (force = false) => {
      if (!player) return;
      try {
        const t = player.getCurrentTime(), d = player.getDuration(), now = Date.now();
        // เวลาในคลิปเดินไปไม่เกินเวลาจริงที่ผ่านไป x2 (+1 วิ) = เล่นต่อเนื่อง · เกินนั้น = เลื่อนข้าม
        if (last && player.getPlayerState() === 1) {
          const step = t - last.t;
          if (step > 0 && step <= ((now - last.at) / 1000) * 2 + 1) watched = Math.min(d || Infinity, watched + step);
        }
        last = { t, at: now };
        if (d) setPct(Math.min(100, Math.floor((watched / d) * 100)));
        if (!sent && d && watched >= d * DONE_RATIO) { sent = true; onDoneRef.current(); }
        if (force || now - saved > 5000) { saved = now; save(t, d); }
      } catch { /* ตัวเล่นยังไม่พร้อม */ }
    };
    loadYouTubeApi().then((YT) => {
      if (!alive || !frame.current) return;
      player = new YT.Player(frame.current, {
        events: {
          onReady: () => { timer = window.setInterval(() => tick(), 1000); },
          // หยุด / จบ = นับ + จำตำแหน่งทันที · เริ่มเล่น = เริ่มนับจากตรงนี้
          onStateChange: (e) => { if (e.data === 1) last = null; else tick(true); },
        },
      });
    }).catch(() => { if (alive) setNoApi(true); });
    return () => { alive = false; window.clearInterval(timer); tick(true); };
  }, [video.id]);

  return (
    <Frame
      src={src} title={video.title} frameRef={frame}
      footer={(
        <>
          <b className="w-full text-sm break-words sm:w-auto sm:flex-1">{video.title}</b>
          <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground" asChild>
            <a href={openUrl(video)} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />เปิดใน YouTube</a>
          </Button>
          {video.required ? (
            done ? <Badge className="bg-success text-white">ดูจบแล้ว ✓</Badge>
              : noApi ? (
                <Button size="sm" onClick={onDone}><CheckIcon />ดูจบแล้ว กดยืนยัน</Button>
              ) : (
                <span className="text-xs text-muted-foreground tabular-nums" title="ต้องเล่นจริงเกิน 85% ของคลิป (เลื่อนข้ามไม่นับ)">
                  นับดูแล้ว {pct}% / {Math.round(DONE_RATIO * 100)}%
                </span>
              )
          ) : null}
        </>
      )}
    />
  );
}

/**
 * ตัวเล่นที่ฝังมาจาก Google / YouTube (คลิป YouTube / คลิปในไดรฟ์ + สไลด์) 16:9 + ปุ่ม "เต็มจอ" ของเว็บ
 *   ความสูงกรอบ = กว้าง × 9/16 + extra (px) — แถบปุ่มของ Google ที่อยู่นอกภาพ (สไลด์ 37px)
 *   กว้างไม่เกินที่ทำให้สูงพอดีจอ (มือถือแนวนอน: เดิมกรอบสูงเกินจอ ต้องเลื่อนดูภาพล่าง)
 *   เต็มจอ: Safari บน iPhone สั่งเต็มจอให้กรอบที่ฝังมาไม่ได้ → ขยายกรอบเดิมให้เต็มหน้าจอเอง (ไม่สร้างใหม่ เล่นต่อ) + เบราว์เซอร์ที่รองรับ = เต็มจอจริงด้วย
 *     ใหญ่สุดที่พอดีจอแบบ 16:9 อยู่กลางจอ · เผื่อแค่รอยบาก / ขอบจอ (safe area) · ปุ่มออกลอยมุมซ้ายบน (พื้นที่ดำข้างกรอบ)
 *   คลิป YouTube ใช้ผ่าน YouTubePlayer (frameRef = ต่อ IFrame API นับเวลาที่ดู)
 */
function Frame({ src, title, extra = 0, footer, frameRef }: {
  src: string; title: string; extra?: number; footer?: React.ReactNode; frameRef?: React.Ref<HTMLIFrameElement>;
}) {
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
            ref={frameRef} src={src} title={title} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen
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
