"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronDownIcon, DownloadIcon, FileTextIcon, LockIcon } from "lucide-react";
import { api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { tawiMonthLabel } from "@/lib/tawi-name";
import { TAWI_VERIFY_MAX_FAILS } from "@/lib/tawi-verify";
import type { MyTawi as MyTawiData, TawiDoc } from "@/lib/types";
import { cn } from "@/lib/utils";

const fileUrl = (id: number) => `/api/tawi/file?id=${id}`;

/**
 * ใบ 50 ทวิของฉัน (ใน "ตารางของฉัน"): ใบล่าสุด + ดาวน์โหลด · ดูเดือนอื่นได้
 *   ใบที่ทีมงานจับคู่ให้แล้วแต่ยังไม่ยืนยัน = กรอกชื่อ-นามสกุลจริงยืนยันตัวตนก่อน (ครั้งเดียว — ใบที่ชื่อต่างไปต้องยืนยันใหม่)
 *   ยังไม่มีใบ = แค่บอกว่ายังไม่มี (การกรอกชื่อไม่จับคู่ใบให้) · ยังไม่ได้รัน SQL = ไม่แสดง
 */
export function MyTawi({ open }: { open: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<MyTawiData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<MyTawiData>("/api/my/tawi")
      .then((res) => { if (alive && res.ok) setData(res); })
      .catch(() => undefined); // โหลดไม่ได้ = ไม่แสดงส่วนนี้ (ไม่กวนตารางคิว)
    return () => { alive = false; };
  }, [open]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await api<MyTawiData & { message: string }>("/api/my/tawi", { name });
      if (!res.ok) {
        setError(res.message ?? "ยืนยันตัวตนไม่สำเร็จ");
        // ผิดครบจำนวนแล้ว = โหลดสถานะใหม่ให้ช่องกรอกเปลี่ยนเป็นข้อความล็อก
        const fresh = await api<MyTawiData>("/api/my/tawi").catch(() => null);
        if (fresh?.ok) setData(fresh);
        return;
      }
      setData(res);
      setName("");
      toast(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!data?.ready) return null;
  const [latest, ...older] = data.docs;
  const pending = data.verifyReady && data.docs.some((d) => !d.verified);
  const verifiedSome = data.docs.some((d) => d.verified);

  return (
    <div className="rounded-xl border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <FileTextIcon className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 leading-snug">
          <b>ใบ 50 ทวิ</b>
          <span className="block text-xs text-muted-foreground">
            {latest ? `ล่าสุด ${tawiMonthLabel(latest.month)}` : "ยังไม่มีใบ 50 ทวิ"}
          </span>
        </span>
        {latest ? <DocAction doc={latest} ready={data.verifyReady} /> : null}
      </div>

      {latest && !data.verifyReady ? (
        <p className="mt-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
          ระบบใบ 50 ทวิกำลังอัปเดต ยังดาวน์โหลดไม่ได้ชั่วคราว ลองใหม่ภายหลัง
        </p>
      ) : null}

      {pending ? (
        data.locked ? (
          <p role="alert" className="mt-2 rounded-lg border border-warning-border bg-warning px-2.5 py-1.5 text-xs leading-relaxed text-warning-foreground">
            กรอกชื่อไม่ตรงครบ {TAWI_VERIFY_MAX_FAILS} ครั้งแล้ววันนี้ ลองใหม่พรุ่งนี้ หรือแจ้งแอดมินให้ตรวจการจับคู่
          </p>
        ) : (
          <form onSubmit={verify} className="mt-2 space-y-1.5">
            <label htmlFor="tawi-verify-name" className="block text-xs leading-snug font-semibold">
              {verifiedSome ? "ใบใหม่ต้องยืนยันตัวตนอีกครั้ง: " : ""}กรอกชื่อ-นามสกุลจริง (ตามบัตรประชาชน) เพื่อยืนยันตัวตนก่อนดาวน์โหลด
            </label>
            <div className="flex gap-2">
              <Input
                id="tawi-verify-name" value={name} maxLength={120} autoComplete="name"
                onChange={(e) => { setName(e.target.value); setError(""); }}
                placeholder="เช่น สมใจ ใจดี" className="h-9 min-w-0 flex-1"
                aria-invalid={!!error} aria-describedby={error ? "tawi-verify-error" : "tawi-verify-help"}
              />
              <Button type="submit" className="h-9 shrink-0" disabled={saving || name.trim().length < 4}>
                {saving ? <Spinner /> : null}ยืนยัน
              </Button>
            </div>
            {error ? (
              <p id="tawi-verify-error" role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>
            ) : (
              <p id="tawi-verify-help" className="text-[11px] leading-relaxed text-muted-foreground">
                ไม่ต้องใส่ นาย / นางสาว · ตัวสะกดต้องตรงกับในเอกสาร · ยืนยันครั้งเดียว ครั้งหน้าดาวน์โหลดได้เลย
              </p>
            )}
          </form>
        )
      ) : null}

      {older.length ? (
        <>
          <button
            type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
            className="mt-1 flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary pointer-coarse:min-h-8"
          >
            เดือนอื่น ({older.length})<ChevronDownIcon className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
          {expanded ? (
            <ul className="scroll-thin mt-1 max-h-44 space-y-1 overflow-y-auto">
              {older.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-2.5 py-1">
                  <span className="tabular-nums">{tawiMonthLabel(d.month)}</span>
                  <DocAction doc={d} ready={data.verifyReady} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** ยืนยันแล้ว = ปุ่มดาวน์โหลด · ยัง = ป้ายล็อก (ปุ่มจะได้ไม่พาไปหน้า error) */
function DocAction({ doc, ready }: { doc: TawiDoc; ready: boolean }) {
  if (!ready || !doc.verified) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <LockIcon className="size-3.5" aria-hidden />{ready ? "รอยืนยันตัวตน" : "ยังดาวน์โหลดไม่ได้"}
      </span>
    );
  }
  return (
    <Button size="sm" variant="outline" className="shrink-0 pointer-coarse:min-h-9" asChild>
      <a href={fileUrl(doc.id)} download aria-label={`ดาวน์โหลดใบ 50 ทวิ ${tawiMonthLabel(doc.month)}`}>
        <DownloadIcon />ดาวน์โหลด
      </a>
    </Button>
  );
}
