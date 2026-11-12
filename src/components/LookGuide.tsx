"use client";

import { useEffect, useState } from "react";
import { AppDialog, DialogBody, LoadError, LoadingBlock, Notice, api } from "@/components/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LOOK_GENDERS, type LookGender, type LooksResponse } from "@/lib/types";

/**
 * Look แต่งหน้า + แต่งตัว (รูป Ref) ในโปรไฟล์ Mc / Admin (ตารางของฉัน → Look แต่งหน้า/แต่งตัว)
 *   แยกผู้หญิง / ผู้ชาย · จำแท็บที่เลือกไว้ในเครื่อง · แก้ได้ที่ เทรนนิ่ง > เฟรมไลฟ์ (src/components/LiveFrames.tsx)
 */

const LABEL: Record<LookGender, string> = { female: "ผู้หญิง", male: "ผู้ชาย" };
const TAB_KEY = "look-tab";

function savedTab(): LookGender {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === "male" ? "male" : "female";
  } catch {
    return "female";
  }
}

export function LookDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<LooksResponse | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  // หน้าต่างปิดอยู่ตอนโหลดหน้า (ไม่ได้วาดฝั่งเซิร์ฟเวอร์) อ่านแท็บที่จำไว้ได้เลย
  const [tab, setTab] = useState<LookGender>(savedTab);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<LooksResponse>("/api/looks")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [open, tick]);

  const pick = (v: string) => {
    if (v !== "female" && v !== "male") return;
    setTab(v);
    try { localStorage.setItem(TAB_KEY, v); } catch { /* เครื่องที่ปิดที่เก็บข้อมูล = ไม่จำ */ }
  };
  const look = data?.looks[tab] ?? null;

  return (
    <AppDialog open={open} onClose={onClose} title="Look แต่งหน้า / แต่งตัว" description="โทนการแต่งหน้าแต่งตัวที่ใช้ทุกไลฟ์ ดูรูป Ref แล้วแต่งให้ใกล้เคียง">
      <ToggleGroup type="single" variant="outline" spacing={0} value={tab} onValueChange={pick} aria-label="Look" className="w-full bg-card">
        {LOOK_GENDERS.map((g) => (
          <ToggleGroupItem key={g} value={g} className="flex-1 font-semibold">{LABEL[g]}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      <DialogBody>
        {!data ? (
          error ? <LoadError title="โหลด Look ไม่สำเร็จ" message={error} onRetry={() => setTick((n) => n + 1)} /> : <LoadingBlock />
        ) : !data.ready ? (
          <Notice variant="warning" icon title="ยังเปิด Look ไม่ได้">{data.message}</Notice>
        ) : !look || (!look.note && !look.images.length) ? (
          <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มี Look {LABEL[tab]} — ทีมงานกำลังเตรียม</p>
        ) : (
          <div className="pt-2">
            {look.note ? <p className="mb-3 rounded-xl border bg-card px-3 py-2 text-sm leading-relaxed whitespace-pre-line">{look.note}</p> : null}
            {/* รูปเต็มไม่ครอป (รูป Ref มีทั้งแนวตั้ง / แนวนอน) · กดรูป = เปิดรูปใหญ่ */}
            <div className="columns-2 gap-2">
              {look.images.map((img, i) => (
                <a
                  key={img.path} href={img.url} target="_blank" rel="noopener noreferrer"
                  className="mb-2 block break-inside-avoid overflow-hidden rounded-xl border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- ลิงก์ชั่วคราวจาก Supabase Storage */}
                  <img src={img.url} alt={`Look ${LABEL[tab]} รูปที่ ${i + 1}`} loading="lazy" className="block h-auto w-full" />
                </a>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">กดที่รูปเพื่อดูรูปใหญ่</p>
          </div>
        )}
      </DialogBody>
    </AppDialog>
  );
}
