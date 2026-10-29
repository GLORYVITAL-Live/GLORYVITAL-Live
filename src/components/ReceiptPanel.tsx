"use client";

import { useEffect, useState } from "react";
import {
  ChevronDownIcon, CircleCheckIcon, ExternalLinkIcon, FolderOpenIcon, ReceiptTextIcon, RefreshCwIcon, RotateCcwIcon, TriangleAlertIcon, XIcon,
} from "lucide-react";
import { PersonPicker } from "@/components/SlotManager";
import { AppDialog, DialogActions, DialogBody, api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RECEIPT_REASON_MAX } from "@/lib/receipts";
import { tawiMonthLabel } from "@/lib/tawi-name";
import type { OwnerReceiptPerson, OwnerReceipts, ReceiptDriveFile, TawiPerson } from "@/lib/types";
import { cn } from "@/lib/utils";

type Scan = { files: number; added: number; removed: number; matched: number; unmatched: number; skipped: number };
const fileUrl = (id: number) => `/api/receipts/file?id=${id}&inline=1`;
/** ไฟล์เดิมใน Drive (receipt_files) */
const driveUrl = (id: number) => `/api/receipts/file?file=${id}&inline=1`;
/** "19 ต.ค. 14:05" (เวลาไทย) */
const when = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** ชื่อที่อ่านได้จากไฟล์: "Mc มะลิ (ชื่อจริง)" */
const fileWho = (f: ReceiptDriveFile) =>
  `${f.role === "mc" ? "Mc" : "Admin"} ${f.nick || f.realName || "?"}${f.nick && f.realName ? ` (${f.realName})` : ""}`;

/**
 * เอกสารยืนยันการรับเงิน (หน้าเจ้าของ > สรุปรายเดือน — เฉพาะ Owner ที่ดูเอกสารทำเบิกได้)
 *   ต่อเดือน: ส่งแล้ว X / ต้องส่ง Y (ต้องส่ง = คนที่มีใบ 50 ทวิเดือนนั้น) · รายชื่อที่ยังไม่ส่ง · เปิดไฟล์ · ไม่ผ่าน + เหตุผล
 *   ไฟล์เดิมที่ทีมบัญชีอัปไว้ใน Drive: ตรวจไฟล์ + จับคู่กับรายชื่อ (จับคู่แล้ว = นับว่าส่งแล้ว · ใช้กับไฟล์ชื่อเดียวกันทุกเดือน)
 */
export function ReceiptPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<OwnerReceipts | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  // งานที่กำลังทำ: "scan" / "r<id เอกสาร>" / "f<id ไฟล์ใน Drive>"
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<OwnerReceiptPerson | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
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
    setBusy(`r${p.receipt.id}`);
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

  async function scan() {
    setBusy("scan");
    try {
      const res = await api<{ scan: Scan }>("/api/owner/receipts", { action: "scan" });
      if (!res.ok) throw new Error(res.message);
      const s = res.scan;
      toast(`ตรวจแล้ว ${s.files} ไฟล์ · ใหม่ ${s.added}${s.removed ? ` · หายไป ${s.removed}` : ""} · จับคู่อัตโนมัติ ${s.matched} · รอจับคู่ ${s.unmatched}`);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  /** จับคู่ไฟล์เดิมใน Drive (person null = ไม่ใช่คนในระบบ / จับคู่ผิด) — ใช้กับไฟล์ชื่อเดียวกันทุกเดือน */
  async function assign(fileId: number, who: string, person: TawiPerson | null, wrong = false) {
    const ok = await confirm({
      title: person ? `จับคู่ "${who}" กับ ${person.label}?` : wrong ? `ยกเลิกการจับคู่ "${who}"?` : `"${who}" ไม่ใช่คนในระบบ?`,
      description: person
        ? `ใช้กับไฟล์ใน Drive ชื่อนี้ทุกเดือน (ระบบจำไว้ เดือนถัดไปจับคู่เอง) นับว่า ${person.label} ส่งเอกสารรับเงินของเดือนนั้นแล้ว — เดือนที่ส่งผ่านเว็บแล้วใช้ไฟล์ที่ส่งผ่านเว็บ${person.hasEmail ? "" : " · รายชื่อนี้ยังไม่มีอีเมล จึงยังเข้าเว็บไม่ได้"}`
        : "ไฟล์ชื่อนี้ทุกเดือนจะไม่นับเป็นของใคร (ย้ายไปอยู่ \"ไม่ใช่คนในระบบ\" — เลือกคนที่ถูกได้ภายหลัง) ไฟล์ใน Drive ไม่ถูกแตะ",
      confirmText: person ? "จับคู่" : "ยืนยัน",
      destructive: !person,
    });
    if (!ok) return;
    setBusy(`f${fileId}`);
    try {
      const res = await api<{ changed: number }>("/api/owner/receipts", { action: "assign", fileId, staffId: person?.id ?? null });
      if (!res.ok) throw new Error(res.message);
      toast(person ? `จับคู่กับ ${person.label} แล้ว (${res.changed} ไฟล์)` : `ตั้งว่าไม่ใช่คนในระบบแล้ว (${res.changed} ไฟล์)`);
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
  const done = (p: OwnerReceiptPerson) => !!p.receipt || p.driveFiles.length > 0;
  const missing = data.people.filter((p) => p.required && !done(p));
  const sent = data.people.filter(done);
  const late = cur ? cur.required - cur.sent : 0;
  const pending = data.drive.files.filter((f) => !f.ignored);
  const ignored = data.drive.files.filter((f) => f.ignored);
  const monthText = (m: OwnerReceipts["months"][number]) =>
    `${m.required ? `ส่งแล้ว ${m.sent}/${m.required}` : `มีเอกสาร ${m.received} คน`}${m.rejected ? ` · ไม่ผ่าน ${m.rejected}` : ""}${m.unmatched ? ` · รอจับคู่ ${m.unmatched}` : ""}`;

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
              <b>เอกสารรับเงิน {tawiMonthLabel(cur.month)}</b>: {cur.required ? `ส่งแล้ว ${cur.sent}/${cur.required}` : `มีเอกสาร ${cur.received} คน`}
              {late ? <> · ยังไม่ส่ง {late}</> : null}
              {cur.rejected ? <> · <b className="text-destructive">ไม่ผ่าน {cur.rejected}</b></> : null}
              {cur.unmatched ? <> · ไฟล์รอจับคู่ {cur.unmatched}</> : null}
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
          {data.folderSet && !data.drive.ready ? (
            <p className="rounded-lg bg-card p-2.5 text-xs leading-relaxed text-muted-foreground">
              ดึงไฟล์เดิมที่ทีมบัญชีอัปไว้ใน Drive: ต้องรัน SQL 20261102000000_receipt_files ใน Supabase ก่อน
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {data.months.length ? (
              <Select value={data.month ?? undefined} onValueChange={(v) => { setMonth(v); setShowIgnored(false); }}>
                <SelectTrigger aria-label="เดือน" className="h-9 min-w-56 flex-1 bg-card sm:max-w-96">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.months.map((m) => (
                    <SelectItem key={m.month} value={m.month}>{tawiMonthLabel(m.month)} ({monthText(m)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {data.folderSet && data.drive.ready ? (
              <Button variant="outline" className="bg-card pointer-coarse:min-h-9" disabled={!!busy} onClick={scan}>
                <RefreshCwIcon className={cn(busy === "scan" && "animate-spin")} />{busy === "scan" ? "กำลังตรวจ..." : "ตรวจไฟล์ใน Drive"}
              </Button>
            ) : null}
          </div>

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

          {pending.length || ignored.length ? (
            <div className="overflow-hidden rounded-lg border bg-card">
              <p className="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-xs font-semibold">
                <FolderOpenIcon className="size-3.5 shrink-0" aria-hidden />ไฟล์ใน Drive ที่ยังไม่จับคู่ ({pending.length})
              </p>
              {pending.map((f) => (
                <DriveFileRow
                  key={f.id} file={f} people={data.drive.people} busy={busy === `f${f.id}`} disabled={!!busy}
                  onAssign={(p) => assign(f.id, fileWho(f), p)}
                />
              ))}
              {!pending.length ? <p className="px-2.5 py-2 text-xs text-muted-foreground">จับคู่ครบทุกไฟล์ของเดือนนี้แล้ว</p> : null}
              {ignored.length ? (
                <>
                  <button
                    type="button" aria-expanded={showIgnored} onClick={() => setShowIgnored(!showIgnored)}
                    className="flex w-full cursor-pointer items-center gap-1 border-t px-2.5 py-1.5 text-left text-xs font-semibold text-muted-foreground pointer-coarse:min-h-9"
                  >
                    ไม่ใช่คนในระบบ ({ignored.length})
                    <ChevronDownIcon className={cn("size-3.5 transition-transform", showIgnored && "rotate-180")} />
                  </button>
                  {showIgnored ? ignored.map((f) => (
                    <DriveFileRow
                      key={f.id} file={f} people={data.drive.people} busy={busy === `f${f.id}`} disabled={!!busy}
                      onAssign={(p) => assign(f.id, fileWho(f), p)}
                    />
                  )) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {sent.length ? (
            <div className="overflow-hidden rounded-lg border bg-card">
              {sent.map((p) => (
                <ReceiptRow
                  key={p.key} person={p} busy={busy} disabled={!!busy}
                  onReject={() => setRejecting(p)} onUnreject={() => unreject(p)}
                  onUnmatch={(id, name) => assign(id, name, null, true)}
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

/** 1 คนที่ส่งแล้ว: ชื่อ + ที่มา (ส่งผ่านเว็บ / จาก Drive) + เวลาส่ง + เปิดไฟล์ + ไม่ผ่าน / ยกเลิกไม่ผ่าน + ไฟล์เดิมใน Drive ที่จับคู่ไว้ */
function ReceiptRow({ person, busy, disabled, onReject, onUnreject, onUnmatch }: {
  person: OwnerReceiptPerson; busy: string | null; disabled: boolean;
  onReject: () => void; onUnreject: () => void; onUnmatch: (fileId: number, name: string) => void;
}) {
  const r = person.receipt;
  const rejected = r?.status === "rejected";
  const fromDrive = r ? r.source === "drive" : true;
  return (
    <div className="border-b px-2.5 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* จอแคบ: ชื่อกว้างอย่างน้อย 10rem ไม่พอ = ปุ่มลงบรรทัดใหม่ (ไม่บีบชื่อ) */}
        <span className="min-w-40 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 font-semibold break-words">
            {person.label}
            <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">{fromDrive ? "จาก Drive" : "ส่งผ่านเว็บ"}</Badge>
          </span>
          <span className={cn("block text-[11px]", rejected ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {rejected
              ? <TriangleAlertIcon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              : <CircleCheckIcon className="mr-1 inline size-3.5 align-[-2px] text-success" aria-hidden />}
            {!r ? "ไฟล์เดิมใน Drive (รายชื่อนี้ไม่มีอีเมล)" : rejected ? "ไม่ผ่าน · รอส่งใหม่" : `${fromDrive ? "อัปเมื่อ" : "ส่งเมื่อ"} ${when(r.uploadedAt)}`}
            {r ? (r.pdf ? " · PDF" : " · รูป") : ""}
            {person.required ? "" : " · ไม่มีใบ 50 ทวิเดือนนี้"}
          </span>
        </span>
        {r ? (
          <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" className="pointer-coarse:min-h-9" asChild>
              <a href={fileUrl(r.id)} target="_blank" rel="noopener"><ExternalLinkIcon />เปิดไฟล์</a>
            </Button>
            {rejected ? (
              <Button size="sm" variant="outline" className="pointer-coarse:min-h-9" disabled={disabled} onClick={onUnreject}>
                <RotateCcwIcon />{busy === `r${r.id}` ? "กำลังบันทึก..." : "ยกเลิกไม่ผ่าน"}
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="text-destructive pointer-coarse:min-h-9" disabled={disabled} onClick={onReject}>
                <XIcon />ไม่ผ่าน
              </Button>
            )}
          </span>
        ) : null}
      </div>
      {rejected && r?.reason ? <p className="mt-1 text-xs break-words text-destructive">เหตุผล: {r.reason}</p> : null}
      {person.driveFiles.length ? (
        <ul className="mt-1 space-y-0.5">
          {person.driveFiles.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate" title={f.fileName}>
                ไฟล์ใน Drive{f.matchedBy === "auto" ? " (ระบบจับคู่)" : ""}: {f.fileName}
              </span>
              <a href={driveUrl(f.id)} target="_blank" rel="noopener" className="font-semibold text-primary underline-offset-2 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-8 pointer-coarse:items-center">
                เปิด
              </a>
              <button
                type="button" disabled={disabled} onClick={() => onUnmatch(f.id, f.fileName)}
                className="cursor-pointer font-semibold text-destructive underline-offset-2 hover:underline disabled:opacity-50 pointer-coarse:min-h-8"
              >
                {busy === `f${f.id}` ? "กำลังบันทึก..." : "จับคู่ผิด"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** ไฟล์เดิมใน Drive ที่ยังไม่จับคู่: ชื่อที่อ่านได้ + เปิดไฟล์ + "ใช่ X?" (ชื่อใกล้เคียง) + เลือกคน / ไม่ใช่คนในระบบ */
function DriveFileRow({ file, people, busy, disabled, onAssign }: {
  file: ReceiptDriveFile; people: TawiPerson[]; busy: boolean; disabled: boolean; onAssign: (person: TawiPerson | null) => void;
}) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const suggested = file.suggest.map((s) => byId.get(s.id)).filter((p): p is TawiPerson => !!p);
  const options = [
    ...suggested.map((p) => ({ id: p.id, text: `★ ${p.label}${p.legalName ? ` (${p.legalName})` : ""}` })),
    ...people.filter((p) => !suggested.includes(p))
      .map((p) => ({ id: p.id, text: `${p.label}${p.legalName ? ` (${p.legalName})` : ""}${p.hasEmail ? "" : " · ไม่มีอีเมล"}` })),
  ];
  return (
    <div className="border-t px-2.5 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold break-words">{fileWho(file)}</span>
          <span className="block truncate text-[11px] text-muted-foreground" title={`${file.path} / ${file.fileName}`}>
            {file.path} / {file.fileName}
          </span>
        </span>
        <Button size="sm" variant="ghost" className="shrink-0 pointer-coarse:min-h-9" asChild>
          <a href={driveUrl(file.id)} target="_blank" rel="noopener"><ExternalLinkIcon />เปิดไฟล์</a>
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {suggested.map((p) => (
          <Button key={p.id} size="sm" variant="secondary" className="max-w-full pointer-coarse:min-h-9" disabled={disabled} onClick={() => onAssign(p)}>
            <span className="truncate">ใช่ {p.label}?</span>
          </Button>
        ))}
        <div className="flex min-w-48 flex-1">
          <PersonPicker
            label="คน" value={null} options={options} disabled={disabled} hideEmpty
            emptyText={busy ? "กำลังบันทึก..." : "เลือกคน..."}
            onChange={(id) => { const p = id ? byId.get(id) : null; if (p) onAssign(p); }}
          />
        </div>
        {!file.ignored ? (
          <Button size="sm" variant="outline" className="pointer-coarse:min-h-9" disabled={disabled} onClick={() => onAssign(null)}>
            ไม่ใช่คนในระบบ
          </Button>
        ) : null}
      </div>
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
