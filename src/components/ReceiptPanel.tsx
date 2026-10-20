"use client";

import { useEffect, useState } from "react";
import { CircleCheckIcon, ExternalLinkIcon, ReceiptTextIcon, RotateCcwIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { AppDialog, DialogActions, DialogBody, api, useConfirm, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RECEIPT_REASON_MAX } from "@/lib/receipts";
import { tawiMonthLabel } from "@/lib/tawi-name";
import type { OwnerReceiptPerson, OwnerReceipts } from "@/lib/types";
import { cn } from "@/lib/utils";

const fileUrl = (id: number) => `/api/receipts/file?id=${id}&inline=1`;
/** "19 ต.ค. 14:05" (เวลาไทย) */
const when = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * เอกสารยืนยันการรับเงิน (หน้าพนักงาน — เฉพาะ Owner ที่ดูเอกสารทำเบิกได้)
 *   ต่อเดือน: ส่งแล้ว X / ต้องส่ง Y (ต้องส่ง = คนที่มีใบ 50 ทวิเดือนนั้น) · รายชื่อที่ยังไม่ส่ง · เปิดไฟล์ · ไม่ผ่าน + เหตุผล
 */
export function ReceiptPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<OwnerReceipts | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<OwnerReceiptPerson | null>(null);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api<OwnerReceipts>(`/api/owner/receipts${month ? `?month=${month}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [month, tick]);

  async function unreject(p: OwnerReceiptPerson) {
    if (!p.receipt) return;
    const ok = await confirm({
      title: `ยกเลิก "ไม่ผ่าน" ของ ${p.label}?`,
      description: `เอกสารเดือน ${tawiMonthLabel(p.receipt.month)} กลับเป็นผ่าน เจ้าตัวดาวน์โหลดใบ 50 ทวิเดือนนี้ได้`,
      confirmText: "ยกเลิกไม่ผ่าน",
    });
    if (!ok) return;
    setBusy(p.receipt.id);
    try {
      const res = await api("/api/owner/receipts", { action: "unreject", id: p.receipt.id, seenAt: p.receipt.uploadedAt });
      if (!res.ok) throw new Error(res.message);
      toast(res.message ?? "บันทึกแล้ว");
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  // ยังไม่ได้รัน SQL / โหลดไม่สำเร็จ = แถบสั้นๆ (ไม่บังรายชื่อ)
  if (!data) {
    return error ? (
      <p className="my-2 flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground">
        <ReceiptTextIcon className="size-4 shrink-0" />เอกสารรับเงิน: {error}
        <Button size="xs" variant="outline" className="ml-auto" onClick={reload}>ลองใหม่</Button>
      </p>
    ) : null;
  }
  if (!data.ready) {
    return (
      <p className="my-2 flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground">
        <ReceiptTextIcon className="size-4 shrink-0" />เอกสารยืนยันการรับเงิน: ต้องรัน SQL 20261101000000_pay_receipts ใน Supabase ก่อน (ระหว่างนี้ยังไม่บังคับ)
      </p>
    );
  }

  const on = data.folderSet && !!data.requiredFrom;
  const cur = data.months.find((m) => m.month === data.month);
  const missing = data.people.filter((p) => p.required && !p.receipt);
  const sent = data.people.filter((p) => p.receipt);
  const late = cur ? cur.required - cur.sent : 0;

  return (
    <section className={cn("my-2 rounded-xl border text-sm", on && (late || cur?.rejected) ? "border-warning-border bg-warning text-warning-foreground" : "bg-card")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
      >
        <ReceiptTextIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {!on ? (
            <b>เอกสารรับเงิน: ยังไม่บังคับ{data.folderSet ? " (ไม่ได้ตั้งเดือนเริ่ม)" : " (ยังไม่ได้ตั้งโฟลเดอร์ Google Drive)"}</b>
          ) : cur ? (
            <>
              <b>เอกสารรับเงิน {tawiMonthLabel(cur.month)}</b>: ส่งแล้ว {cur.sent}/{cur.required}
              {late ? <> · ยังไม่ส่ง {late}</> : null}
              {cur.rejected ? <> · <b className="text-destructive">ไม่ผ่าน {cur.rejected}</b></> : null}
            </>
          ) : (
            <b>เอกสารรับเงิน: ยังไม่มีเดือนที่ต้องส่ง</b>
          )}
        </span>
        <span className="shrink-0 text-xs font-semibold underline">{open ? "ซ่อน" : "ดู / ตรวจ"}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-inherit p-2 text-foreground">
          {!data.folderSet ? (
            <p className="rounded-lg bg-card p-2.5 text-xs leading-relaxed">
              ตั้ง id โฟลเดอร์หลัก &quot;เอกสารยืนยันการรับเงิน&quot; ใน Supabase ที่ settings.receipt_drive_folder (แชร์ให้บัญชีระบบเป็นผู้แก้ไข)
              — ระหว่างนี้ Mc / Admin ยังส่งไม่ได้ จึงยังไม่บังคับ ดาวน์โหลดใบ 50 ทวิได้ตามเดิม
            </p>
          ) : !data.requiredFrom ? (
            <p className="rounded-lg bg-card p-2.5 text-xs leading-relaxed">
              ยังไม่ได้ตั้งเดือนเริ่มบังคับ (settings.receipt_required_from เช่น 2026-06) — ดาวน์โหลดใบ 50 ทวิได้ตามเดิม
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              บังคับตั้งแต่ใบ 50 ทวิเดือน {tawiMonthLabel(data.requiredFrom)} · ต้องส่ง = คนที่มีใบ 50 ทวิเดือนนั้น · ส่งแล้วดาวน์โหลดได้ทันที
            </p>
          )}

          {data.months.length ? (
            <Select value={data.month ?? undefined} onValueChange={setMonth}>
              <SelectTrigger aria-label="เดือน" className="h-9 w-full bg-card sm:w-auto sm:min-w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.months.map((m) => (
                  <SelectItem key={m.month} value={m.month}>
                    {tawiMonthLabel(m.month)} (ส่งแล้ว {m.sent}/{m.required}{m.rejected ? ` · ไม่ผ่าน ${m.rejected}` : ""})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {missing.length ? (
            <div className="rounded-lg border bg-card p-2.5">
              <p className="mb-1.5 text-xs font-semibold">ยังไม่ส่ง ({missing.length} คน)</p>
              <ul className="flex flex-wrap gap-1.5">
                {missing.map((p) => (
                  <li key={p.key} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                    {p.label}{p.hasEmail ? "" : <span className="text-destructive"> · ไม่มีอีเมล</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {sent.length ? (
            <div className="overflow-hidden rounded-lg border bg-card">
              {sent.map((p) => (
                <ReceiptRow
                  key={p.key} person={p} busy={busy === p.receipt!.id} disabled={busy !== null}
                  onReject={() => setRejecting(p)} onUnreject={() => unreject(p)}
                />
              ))}
            </div>
          ) : data.month ? (
            <p className="rounded-lg bg-card p-3 text-center text-xs text-muted-foreground">ยังไม่มีใครส่งเอกสารของเดือนนี้</p>
          ) : null}
        </div>
      ) : null}

      {rejecting ? (
        <RejectDialog
          person={rejecting}
          onClose={(done) => { setRejecting(null); if (done) reload(); }}
        />
      ) : null}
    </section>
  );
}

/** 1 คนที่ส่งแล้ว: ชื่อ + เวลาส่ง + เปิดไฟล์ + ไม่ผ่าน / ยกเลิกไม่ผ่าน */
function ReceiptRow({ person, busy, disabled, onReject, onUnreject }: {
  person: OwnerReceiptPerson; busy: boolean; disabled: boolean; onReject: () => void; onUnreject: () => void;
}) {
  const r = person.receipt!;
  const rejected = r.status === "rejected";
  return (
    <div className="border-b px-2.5 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* จอแคบ: ชื่อกว้างอย่างน้อย 10rem ไม่พอ = ปุ่มลงบรรทัดใหม่ (ไม่บีบชื่อ) */}
        <span className="min-w-40 flex-1">
          <span className="block font-semibold break-words">{person.label}</span>
          <span className={cn("block text-[11px]", rejected ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {rejected
              ? <TriangleAlertIcon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              : <CircleCheckIcon className="mr-1 inline size-3.5 align-[-2px] text-success" aria-hidden />}
            {rejected ? "ไม่ผ่าน · รอส่งใหม่" : `ส่งเมื่อ ${when(r.uploadedAt)}`}{r.pdf ? " · PDF" : " · รูป"}
            {person.required ? "" : " · ไม่มีใบ 50 ทวิเดือนนี้"}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
          <Button size="sm" variant="ghost" className="pointer-coarse:min-h-9" asChild>
            <a href={fileUrl(r.id)} target="_blank" rel="noopener"><ExternalLinkIcon />เปิดไฟล์</a>
          </Button>
          {rejected ? (
            <Button size="sm" variant="outline" className="pointer-coarse:min-h-9" disabled={disabled} onClick={onUnreject}>
              <RotateCcwIcon />{busy ? "กำลังบันทึก..." : "ยกเลิกไม่ผ่าน"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="text-destructive pointer-coarse:min-h-9" disabled={disabled} onClick={onReject}>
              <XIcon />ไม่ผ่าน
            </Button>
          )}
        </span>
      </div>
      {rejected && r.reason ? <p className="mt-1 text-xs break-words text-destructive">เหตุผล: {r.reason}</p> : null}
    </div>
  );
}

/** ใส่เหตุผลที่ไม่ผ่าน (เจ้าตัวเห็นในแจ้งเตือน + หน้าตารางของฉัน) */
function RejectDialog({ person, onClose }: { person: OwnerReceiptPerson; onClose: (done: boolean) => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const r = person.receipt!;

  async function submit() {
    setBusy(true);
    try {
      const res = await api("/api/owner/receipts", { action: "reject", id: r.id, reason, seenAt: r.uploadedAt });
      if (!res.ok) throw new Error(res.message);
      toast(res.message ?? "บันทึกแล้ว");
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  }

  return (
    <AppDialog
      open busy={busy} onClose={() => onClose(false)}
      title={`ไม่ผ่าน: ${person.label}`}
      description={`เอกสารรับเงินเดือน ${tawiMonthLabel(r.month)} — ใบ 50 ทวิเดือนนี้จะล็อกอีกครั้ง และแจ้งเจ้าตัวให้ส่งใหม่`}
    >
      <DialogBody className="space-y-1.5 text-sm">
        <Label htmlFor="receipt-reject-reason" className="font-semibold">เหตุผล (เจ้าตัวจะเห็นข้อความนี้)</Label>
        <Textarea
          id="receipt-reject-reason" rows={3} value={reason} maxLength={RECEIPT_REASON_MAX} disabled={busy}
          onChange={(e) => setReason(e.target.value)} placeholder="เช่น รูปไม่ชัด / ยังไม่ได้เซ็นชื่อ / ยอดเงินไม่ตรงกับเดือนนี้"
        />
        <a href={fileUrl(r.id)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline">
          <ExternalLinkIcon className="size-3.5" />เปิดไฟล์ดูอีกครั้ง
        </a>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={busy} onClick={() => onClose(false)}>ยกเลิก</Button>
        <Button variant="danger" size="lg" disabled={busy || reason.trim().length < 3} onClick={submit}>
          {busy ? "กำลังบันทึก..." : "ไม่ผ่าน"}
        </Button>
      </DialogActions>
    </AppDialog>
  );
}
