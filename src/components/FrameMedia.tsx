"use client";

import { useState } from "react";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import type { FrameFile } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * ไฟล์เฟรม / รูปสินค้าในไดรฟ์: เปิดจาก Google โดยตรง (รูปย่อ / ตัวเล่นของไดรฟ์) — ไม่ผ่านเซิร์ฟเวอร์ของเว็บ
 *   (เคยส่งไฟล์ผ่าน /api/frames/media → ปริมาณส่งข้อมูลของโฮสต์เกินโควตา) · ไฟล์ในชีตเฟรมต้องแชร์แบบ "ทุกคนที่มีลิงก์ดูได้"
 */
export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${id}/preview`;
/** รูปย่อจาก Google (กว้างไม่เกิน w px) */
const driveImageUrl = (id: string, w: number) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;

/** ลิงก์เปิดไฟล์ในไดรฟ์ (ใต้พรีวิว / เปิดในเว็บไม่ได้) */
function DriveLink({ id }: { id: string }) {
  return (
    <a href={driveViewUrl(id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline">
      <ExternalLinkIcon className="size-4" />เปิดไฟล์เฟรมใน Google Drive
    </a>
  );
}

/**
 * พรีวิวเฟรมไลฟ์: วิดีโอ (ส่วนใหญ่เป็นพื้นหลังเคลื่อนไหว ไฟล์ละหลายสิบ MB) / รูป
 *   วิดีโอแสดงภาพปกก่อน แตะ = ตัวเล่นของ Google Drive (ไม่โหลดวิดีโอจนกว่าจะกด — ประหยัดเน็ตมือถือ / หน้าที่มีหลายเฟรม)
 *   กรอบตัวเล่นใช้สัดส่วนของภาพปก (เฟรมแนวตั้งของ TikTok ไม่เป็นกรอบแนวนอน) · รูปโหลดไม่ได้ = ลิงก์เปิดในไดรฟ์
 */
export function FrameMedia({ file, className }: { file: FrameFile; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const [bad, setBad] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  const box = cn("relative w-full overflow-hidden rounded-lg border bg-black", className);
  if (file.kind === "file") return <DriveLink id={file.id} />;
  if (file.kind === "image") {
    return bad ? <DriveLink id={file.id} /> : (
      <a href={driveViewUrl(file.id)} target="_blank" rel="noopener noreferrer" className={cn(box, "block")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- รูปย่อจาก Google Drive (ไม่ผ่านตัวย่อรูปของ Next / เซิร์ฟเวอร์ของเว็บ) */}
        <img
          src={driveImageUrl(file.id, 1600)} alt={file.name || "เฟรมไลฟ์"} loading="lazy" referrerPolicy="no-referrer"
          onError={() => setBad(true)} className="max-h-96 w-full object-contain"
        />
      </a>
    );
  }
  // วิดีโอ: กรอบสัดส่วนเดียวกับภาพปก สูงไม่เกิน 24rem
  const r = ratio ?? 16 / 9;
  const frame = { aspectRatio: String(r), width: `min(100%, calc(24rem * ${r}))` };
  return (
    <div>
      <div className={box}>
        {playing ? (
          <div className="mx-auto" style={frame}>
            <iframe src={drivePreviewUrl(file.id)} title={file.name || "เฟรมไลฟ์"} allow="autoplay; fullscreen" allowFullScreen className="size-full" />
          </div>
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label="เล่นเฟรม" className="group relative block w-full cursor-pointer">
            {bad ? <span className="mx-auto block" style={frame} /> : (
              // eslint-disable-next-line @next/next/no-img-element -- ภาพปกจาก Google Drive
              <img
                src={driveImageUrl(file.id, 800)} alt={file.name || "เฟรมไลฟ์"} loading="lazy" referrerPolicy="no-referrer"
                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight); }}
                onError={() => setBad(true)} className="mx-auto max-h-96 w-full object-contain"
              />
            )}
            <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="grid size-11 place-items-center rounded-full bg-black/55 text-white transition-transform group-hover:scale-110 [&_svg]:size-5">
                <PlayIcon className="fill-current" />
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="mt-1"><DriveLink id={file.id} /></div>
    </div>
  );
}
