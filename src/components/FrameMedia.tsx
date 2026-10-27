"use client";

import { useState } from "react";
import { ExternalLinkIcon, Loader2Icon, PlayIcon } from "lucide-react";
import type { FrameFile } from "@/lib/types";
import { cn } from "@/lib/utils";

/** ไฟล์เฟรม / รูปสินค้าในไดรฟ์ผ่านเซิร์ฟเวอร์ของเว็บ (src/app/api/frames/media) · thumb = ภาพปก */
export const frameUrl = (id: string, thumb = false) => `/api/frames/media?id=${encodeURIComponent(id)}${thumb ? "&thumb=1" : ""}`;
export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/**
 * พรีวิวเฟรมไลฟ์: วิดีโอ (ส่วนใหญ่เป็นพื้นหลังเคลื่อนไหว ไฟล์ละหลายสิบ MB) / รูป
 *   วิดีโอแสดงภาพปกก่อน แตะเพื่อเล่นวนแบบปิดเสียง — ไม่โหลดวิดีโอจนกว่าจะกด (ประหยัดเน็ตมือถือ / หน้าที่มีหลายเฟรม)
 */
export function FrameMedia({ file, className }: { file: FrameFile; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [bad, setBad] = useState(false);
  const box = cn("relative w-full overflow-hidden rounded-lg border bg-black", className);
  if (bad || file.kind === "file") {
    return (
      <a href={driveViewUrl(file.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline">
        <ExternalLinkIcon className="size-4" />เปิดไฟล์เฟรมใน Google Drive
      </a>
    );
  }
  if (file.kind === "image") {
    return (
      <a href={frameUrl(file.id)} target="_blank" rel="noopener noreferrer" className={cn(box, "block")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์จาก Google Drive ผ่านเซิร์ฟเวอร์ของเว็บ (ไม่ผ่านตัวย่อรูปของ Next) */}
        <img src={frameUrl(file.id)} alt={file.name || "เฟรมไลฟ์"} loading="lazy" onError={() => setBad(true)} className="max-h-96 w-full object-contain" />
      </a>
    );
  }
  return (
    <div className={box}>
      <video
        src={frameUrl(file.id)} poster={frameUrl(file.id, true)} muted loop playsInline preload="none" title={file.name || "เฟรมไลฟ์"}
        onPlaying={() => { setPlaying(true); setWaiting(false); }} onWaiting={() => setWaiting(true)}
        onPause={() => { setPlaying(false); setWaiting(false); }} onError={() => setBad(true)}
        onClick={(e) => {
          const v = e.currentTarget;
          if (!v.paused) return v.pause();
          setWaiting(true);
          void v.play().catch(() => setWaiting(false));
        }}
        className="max-h-96 w-full cursor-pointer object-contain"
      />
      {!playing || waiting ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid size-11 place-items-center rounded-full bg-black/55 text-white [&_svg]:size-5">
            {waiting ? <Loader2Icon className="animate-spin" /> : <PlayIcon className="fill-current" />}
          </span>
        </span>
      ) : null}
    </div>
  );
}
