"use client";

import { useEffect, useState } from "react";
import { CheckCircle2Icon, MapPinCheckIcon } from "lucide-react";
import { lateCut } from "@/lib/pay";
import { cn } from "@/lib/utils";
import { api, useConfirm, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";

/**
 * Admin: ปุ่ม "มาถึงแล้ว" ด้านบนทุกหน้า เมื่อมีคิวที่จะเริ่มภายใน 2 ชม. / กำลังไลฟ์ (/api/my/arrive · src/lib/arrival.ts)
 *   ระบบบันทึกเวลาเซิร์ฟเวอร์ตอนกด → นาทีสาย = เวลาที่กด − เวลาเริ่มคิว (หักตามกฎเดิม เมื่อทีมไม่ได้ใส่สายในชีต)
 *   คิวที่ต่อกันกดครั้งเดียว · ไม่มีคิว / ยังไม่ได้รัน SQL = ไม่แสดง
 */

type ArriveSlot = { id: number; platform: string; start: string; end: string; startMs: number; endMs: number; arrivedAt: string | null; late: number | null };
const timeOf = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });

export function ArrivalBanner() {
  const toast = useToast();
  const confirm = useConfirm();
  const [slot, setSlot] = useState<ArriveSlot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ slot: ArriveSlot | null }>("/api/my/arrive")
      .then((res) => { if (alive && res.ok) { setSlot(res.slot); setNow(Date.now()); } })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [tick]);
  // ดูใหม่ทุกนาที (คิวถัดไปเข้าช่วง 2 ชม. / คิวจบ) และตอนกลับมาที่หน้าเว็บ
  useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    const t = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(t); window.removeEventListener("focus", refresh); };
  }, []);

  if (!slot) return null;
  const label = `${slot.start}–${slot.end} ${slot.platform}`;

  async function arrive(s: ArriveSlot) {
    const ok = await confirm({
      title: "ยืนยันว่ามาถึงที่ทำงานแล้ว?",
      description: `ระบบบันทึกเวลาตอนนี้ (${timeOf.format(new Date())}) ใช้คิดเวลามาสายของคิว ${label} · กดแล้วแก้เองไม่ได้`,
      confirmText: "มาถึงแล้ว",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api<{ slot: ArriveSlot }>("/api/my/arrive", { id: s.id });
      if (!res.ok) throw new Error(res.message);
      setSlot(res.slot);
      const late = res.slot.late ?? 0;
      toast(lateCut(late) > 0 ? `บันทึกแล้ว: มาถึง ${timeOf.format(new Date(res.slot.arrivedAt!))} สาย ${late} นาที` : `บันทึกแล้ว: มาถึง ${timeOf.format(new Date(res.slot.arrivedAt!))}`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (slot.arrivedAt) {
    const late = slot.late ?? 0, cut = lateCut(late);
    return (
      <div role="status" className={cn("mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-2 text-sm", cut > 0 ? "border-warning-border bg-warning text-warning-foreground" : "bg-card")}>
        <CheckCircle2Icon className={cn("size-4 shrink-0", cut > 0 ? "" : "text-success")} />
        <span className="min-w-0 flex-1 leading-snug">
          <b>มาถึง {timeOf.format(new Date(slot.arrivedAt))}</b> · คิว {label}
          {cut > 0 ? <> · สาย {late} นาที หัก {Math.round(cut * 100)}%</> : <span className="text-success"> · ตรงเวลา</span>}
        </span>
      </div>
    );
  }

  const started = now >= slot.startMs;
  const mins = Math.max(1, Math.round(Math.abs(slot.startMs - now) / 60_000));
  return (
    <div role="alert" className={cn("mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm", started ? "border-warning-border bg-warning text-warning-foreground" : "bg-card")}>
      <MapPinCheckIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 leading-snug">
        <b>คิว {label}</b>
        <span className="block text-xs">
          {started ? `เริ่มไปแล้ว ${mins} นาที — ยังไม่ได้กดมาถึง` : `เริ่มในอีก ${mins} นาที — ถึงที่ทำงานแล้วกดปุ่มนี้`}
        </span>
      </span>
      <Button size="sm" className="rounded-full pointer-coarse:h-10" disabled={busy} onClick={() => arrive(slot)}>
        {busy ? "กำลังบันทึก..." : "มาถึงแล้ว"}
      </Button>
    </div>
  );
}
