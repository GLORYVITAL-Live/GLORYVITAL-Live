"use client";

import { useState } from "react";
import { TableIcon } from "lucide-react";
import { api, useToast } from "@/components/shared";
import { openWhenReady } from "@/components/ExportMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Res = { url: string; title: string; placed: number; written: boolean; summary: number; skipped: string[] };

/**
 * ปุ่ม "ลงตารางห้องไลฟ์" (หน้า Plan Slot Live): เขียนแท็บ "Live <เดือน> <ปี> (เว็บ)" ในชีตตารางไลฟ์ของแอดมินประจำทันที
 *   แล้วเปิดแท็บนั้นในแท็บใหม่ · ปกติเว็บอัปเดตให้เองทุกชั่วโมง (src/lib/room-sheet-sync.ts)
 */
export function RoomSheetButton({ month, className }: { month: string; className?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      let res: Res | null = null;
      await openWhenReady("ตารางห้องไลฟ์", async () => {
        const r = await api<Res>("/api/plan/rooms", { month });
        if (!r.ok) throw new Error(r.message);
        res = r;
        return r.url;
      });
      const r = res as Res | null;
      if (r) {
        toast(`${r.written || r.summary ? "อัปเดต" : "ไม่มีอะไรเปลี่ยน —"} แท็บ "${r.title}" (${r.placed} คิว)`
          + (r.summary ? ` · กรอกจำนวนคิวในสรุปวันหยุดแอดมิน ${r.summary} ช่อง` : "")
          + (r.skipped.length ? ` · ลงไม่ได้ ${r.skipped.length} คิว (เวลาทับกันในห้องเดียวกัน): ${r.skipped.join(", ")}` : ""), r.skipped.length ? "error" : undefined);
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="outline" size="lg" disabled={busy} onClick={run} className={cn("bg-card", className)}
      title="เขียนตารางห้อง 1–3 (Mc + เวลา + แอดมิน) ลงชีตตารางไลฟ์ของแอดมินประจำ — เว็บอัปเดตให้เองทุกชั่วโมงอยู่แล้ว"
    >
      <TableIcon />{busy ? "กำลังลงตาราง…" : "ลงตารางห้องไลฟ์"}
    </Button>
  );
}
