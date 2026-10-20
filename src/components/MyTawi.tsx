"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronDownIcon, CircleCheckIcon, DownloadIcon, FileTextIcon, FileUpIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { shrinkImage } from "@/lib/image";
import { RECEIPT_MAX_BYTES } from "@/lib/receipts";
import { tawiMonthLabel } from "@/lib/tawi-name";
import { TAWI_VERIFY_MAX_FAILS } from "@/lib/tawi-verify";
import type { MyTawi as MyTawiData, ReceiptView, TawiDoc } from "@/lib/types";
import { cn } from "@/lib/utils";

const fileUrl = (id: number) => `/api/tawi/file?id=${id}`;
const receiptUrl = (id: number) => `/api/receipts/file?id=${id}&inline=1`;

/**
 * ใบ 50 ทวิของฉัน (ใน "ตารางของฉัน"): ใบล่าสุด + ดาวน์โหลด · ดูเดือนอื่นได้
 *   ใบที่ทีมงานจับคู่ให้แล้วแต่ยังไม่ยืนยัน = กรอกชื่อ-นามสกุลจริงยืนยันตัวตนก่อน (ครั้งเดียว — ใบที่ชื่อต่างไปต้องยืนยันใหม่)
 *   เดือนที่บังคับ (ตั้งแต่ receiptFrom) = ส่งเอกสารยืนยันการรับเงินของเดือนนั้นก่อน (ส่งแล้วโหลดได้ทันที · ไม่ผ่าน = ส่งใหม่)
 *   ยังไม่มีใบ = แค่บอกว่ายังไม่มี (การกรอกชื่อไม่จับคู่ใบให้) · ยังไม่ได้รัน SQL = ไม่แสดง
 */
export function MyTawi({ open }: { open: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<MyTawiData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // เดือนที่กำลังส่งเอกสารรับเงิน (ทีละเดือน)
  const [uploading, setUploading] = useState<string | null>(null);

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

  /** ส่ง / ส่งใหม่เอกสารรับเงินของเดือนนี้: รูปย่อในเครื่องก่อน (ไฟล์เล็ก ส่งเร็ว) PDF ส่งตามเดิม */
  async function upload(month: string, file: File | undefined) {
    if (!file || uploading) return;
    setUploading(month);
    try {
      let blob: Blob = file, name = "receipt.pdf";
      if (file.type === "application/pdf") {
        if (file.size > RECEIPT_MAX_BYTES) throw new Error("ไฟล์ PDF ใหญ่เกิน 4 MB ลองถ่ายรูปหรือแคปหน้าจอแทน");
      } else if (file.type.startsWith("image/") || !file.type) {
        blob = await shrinkImage(file, 1800);
        name = "receipt.jpg";
        if (blob.size > RECEIPT_MAX_BYTES) throw new Error("รูปใหญ่เกินไป ลองถ่ายใหม่ให้เห็นแค่เอกสาร");
      } else {
        throw new Error("รองรับเฉพาะรูป หรือไฟล์ PDF");
      }
      const fd = new FormData();
      fd.append("month", month);
      fd.append("file", blob, name);
      let res: Response;
      try {
        res = await fetch("/api/my/receipts", { method: "POST", body: fd });
      } catch {
        throw new Error("เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต");
      }
      const json = await res.json().catch(() => null) as { ok?: boolean; message?: string; tawi?: MyTawiData } | null;
      if (!json?.ok || !json.tawi) throw new Error(json?.message ?? `ส่งเอกสารไม่สำเร็จ (HTTP ${res.status})`);
      setData(json.tawi);
      toast(json.message ?? "ส่งเอกสารแล้ว");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setUploading(null);
    }
  }

  if (!data?.ready) return null;
  const [latest, ...older] = data.docs;
  const pending = data.verifyReady && data.docs.some((d) => !d.verified);
  const verifiedSome = data.docs.some((d) => d.verified);
  // เดือนที่ยืนยันตัวตนแล้วแต่ยังต้องส่งเอกสารรับเงิน (ไม่ผ่าน = ต้องส่งใหม่)
  const needMonths = data.verifyReady
    ? [...new Set(data.docs.filter((d) => d.verified && (d.receipt === "missing" || d.receipt === "rejected")).map((d) => d.month))]
    : [];
  const receipts = new Map(data.receipts.map((r) => [r.month, r]));
  // หลายใบในเดือนเดียว = เอกสารรับเงินชุดเดียว แสดงบรรทัดสถานะครั้งเดียว
  const firstOfMonth = new Set(data.docs.filter((d, i) => data.docs.findIndex((x) => x.month === d.month) === i).map((d) => d.id));
  const action = (d: TawiDoc) => (
    <DocAction doc={d} ready={data.verifyReady} uploading={uploading} onUpload={upload} />
  );
  const line = (d: TawiDoc) => (data.verifyReady && d.verified && firstOfMonth.has(d.id) ? (
    <ReceiptLine doc={d} receipt={receipts.get(d.month)} uploading={uploading} onUpload={upload} />
  ) : null);

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
        {latest ? action(latest) : null}
      </div>
      {latest ? line(latest) : null}

      {needMonths.length ? (
        <p className="mt-1.5 rounded-lg border border-warning-border bg-warning px-2.5 py-1.5 text-xs leading-relaxed text-warning-foreground">
          <b>ส่งเอกสารยืนยันการรับเงินก่อนดาวน์โหลด</b> ({needMonths.map(tawiMonthLabel).join(", ")})
          <span className="block">
            ตั้งแต่ใบเดือน {data.receiptFrom ? tawiMonthLabel(data.receiptFrom) : ""} ทีมบัญชีต้องมีหลักฐานว่าคุณได้รับเงินของเดือนนั้นแล้ว
            ส่งสลิปโอนเงิน หรือรูป / PDF ใบสำคัญรับเงินที่เซ็นแล้ว · ส่งแล้วดาวน์โหลดได้ทันที
          </span>
        </p>
      ) : null}

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
            เดือนอื่น ({older.length})
            {older.some((d) => needMonths.includes(d.month)) ? <span className="text-warning-foreground">· ต้องส่งเอกสาร</span> : null}
            <ChevronDownIcon className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
          {expanded ? (
            <ul className="scroll-thin mt-1 max-h-72 space-y-1 overflow-y-auto">
              {older.map((d) => (
                <li key={d.id} className="rounded-lg bg-muted px-2.5 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular-nums">{tawiMonthLabel(d.month)}</span>
                    {action(d)}
                  </div>
                  {line(d)}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type Upload = { uploading: string | null; onUpload: (month: string, file: File | undefined) => void };

/**
 * ปุ่มของใบนี้ (ลำดับ: ยืนยันตัวตน -> ส่งเอกสารรับเงิน -> ดาวน์โหลด)
 *   ยังไม่ยืนยัน = ป้ายล็อก (ปุ่มจะได้ไม่พาไปหน้า error) · ยังไม่ส่ง / ไม่ผ่าน = ปุ่มส่งเอกสารแทนปุ่มดาวน์โหลด
 */
function DocAction({ doc, ready, uploading, onUpload }: { doc: TawiDoc; ready: boolean } & Upload) {
  if (!ready || !doc.verified) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <LockIcon className="size-3.5" aria-hidden />{ready ? "รอยืนยันตัวตน" : "ยังดาวน์โหลดไม่ได้"}
      </span>
    );
  }
  if (doc.receipt === "missing" || doc.receipt === "rejected") {
    return (
      <UploadButton
        month={doc.month} uploading={uploading} onUpload={onUpload} variant="default"
        text={doc.receipt === "rejected" ? "ส่งเอกสารใหม่" : "ส่งเอกสารรับเงิน"}
      />
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

/** ปุ่มเลือกไฟล์ (รูป / PDF — มือถือเลือกถ่ายรูปได้) กำลังส่งเดือนไหนอยู่ = ปิดทุกปุ่ม */
function UploadButton({ month, text, variant, uploading, onUpload }: {
  month: string; text: string; variant: "default" | "outline" | "link";
} & Upload) {
  const busy = uploading === month;
  return (
    <Button
      size="sm" variant={variant} asChild
      className={cn("shrink-0", variant === "link" ? "h-auto px-0" : "pointer-coarse:min-h-9", uploading && "pointer-events-none opacity-60")}
    >
      <label aria-label={`${text} เดือน ${tawiMonthLabel(month)}`} className="cursor-pointer">
        {busy ? <Spinner /> : variant === "link" ? null : <FileUpIcon />}{busy ? "กำลังส่ง..." : text}
        {/* ล้างค่าหลังเลือก = เลือกไฟล์เดิมซ้ำได้ */}
        <input
          type="file" accept="image/*,application/pdf" className="sr-only" disabled={!!uploading}
          onChange={(e) => { onUpload(month, e.target.files?.[0]); e.target.value = ""; }}
        />
      </label>
    </Button>
  );
}

/** สถานะเอกสารรับเงินของเดือนนี้ (ใต้แถวใบ 50 ทวิ): ไม่ผ่าน + เหตุผล / ส่งแล้ว + ดูไฟล์ + ส่งใหม่ */
function ReceiptLine({ doc, receipt, uploading, onUpload }: { doc: TawiDoc; receipt: ReceiptView | undefined } & Upload) {
  if (doc.receipt === "none" || doc.receipt === "missing" || !receipt) return null;
  const view = (
    <a href={receiptUrl(receipt.id)} target="_blank" rel="noopener" className="font-semibold text-primary underline-offset-2 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-8 pointer-coarse:items-center">
      ดูไฟล์ที่ส่ง
    </a>
  );
  if (doc.receipt === "rejected") {
    return (
      <p role="alert" className="mt-1 text-xs leading-relaxed text-destructive">
        <TriangleAlertIcon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
        เอกสารรับเงินไม่ผ่าน{receipt.reason ? `: ${receipt.reason}` : ""} — ส่งใหม่ได้เลย · {view}
      </p>
    );
  }
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 text-success"><CircleCheckIcon className="size-3.5" aria-hidden />ส่งเอกสารรับเงินแล้ว</span>
      {view}
      <UploadButton month={doc.month} text="ส่งใหม่" variant="link" uploading={uploading} onUpload={onUpload} />
    </p>
  );
}
