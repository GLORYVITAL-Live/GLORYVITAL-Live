"use client";

import { useEffect, useState } from "react";
import { ExternalLinkIcon, FolderOpenIcon, ReceiptTextIcon, RefreshCwIcon } from "lucide-react";
import { PersonPicker } from "@/components/SlotManager";
import { api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OwnerSlip, OwnerSlips, SlipScan } from "@/lib/types";
import { cn } from "@/lib/utils";

const fileUrl = (id: number) => `/api/slips/file?id=${id}&inline=1`;
const sideText = (role: OwnerSlip["role"]) => (role === "mc" ? "Mc" : "Admin");

/**
 * สลิปโอนเงิน (หน้าเจ้าของ > สรุปรายเดือน — Owner ที่จัดการฝั่ง Mc / Admin ได้)
 *   ฝ่ายบัญชีอัปสลิปลงโฟลเดอร์ Slip ใน Drive แบบเดิม → ระบบตรวจทุกชั่วโมง จับคู่ชื่อในไฟล์กับรายชื่อ → เจ้าตัวดาวน์โหลดใน "ตารางของฉัน"
 *   ชื่อไม่ตรง = รอจับคู่ (เลือกคนครั้งเดียว ระบบจำไว้ทุกรอบ) · จับคู่ผิด = เลือกคนใหม่ได้
 */
export function SlipPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OwnerSlips | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // งานที่กำลังทำ: "scan" / "s<id สลิป>"
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api<OwnerSlips>("/api/owner/slips")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick]);

  async function scan() {
    setBusy("scan");
    try {
      const res = await api<{ scan: SlipScan }>("/api/owner/slips", { action: "scan" });
      if (!res.ok) throw new Error(res.message);
      const s = res.scan;
      toast(`ตรวจแล้ว ${s.files} ไฟล์ · ใหม่ ${s.added}${s.removed ? ` · หายไป ${s.removed}` : ""} · จับคู่อัตโนมัติ ${s.matched} · รอจับคู่ ${s.unmatched}${s.notified ? ` · แจ้งเจ้าตัว ${s.notified} คน` : ""}`);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  /** จับคู่สลิป (person null = ไม่ใช่คนในระบบ) — ใช้กับไฟล์ชื่อเดียวกันทุกรอบ */
  async function assign(slip: OwnerSlip, person: OwnerSlips["people"][number] | null) {
    const ok = await confirm({
      title: person ? `สลิป "${slip.fileName}" เป็นของ ${person.label}?` : `"${slip.fileName}" ไม่ใช่คนในระบบ?`,
      description: person
        ? `ใช้กับไฟล์ชื่อนี้ทุกรอบ (ระบบจำไว้ รอบถัดไปจับคู่เอง) ${person.label} เปิด / ดาวน์โหลดสลิปได้ใน "ตารางของฉัน" — ตรวจให้แน่ใจ สลิปมีชื่อและเลขบัญชีของคนรับเงิน`
        : "ไฟล์ชื่อนี้ทุกรอบจะไม่ขึ้นให้ใครดาวน์โหลด (เลือกคนที่ถูกได้ภายหลัง) ไฟล์ใน Drive ไม่ถูกแตะ",
      confirmText: person ? "จับคู่" : "ยืนยัน",
      destructive: !person,
    });
    if (!ok) return;
    setBusy(`s${slip.id}`);
    try {
      const res = await api<{ changed: number }>("/api/owner/slips", { action: "assign", id: slip.id, staffId: person?.id ?? null });
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
        <ReceiptTextIcon className="size-4 shrink-0" />สลิปโอนเงิน: {error}
        <Button size="xs" variant="outline" className="ml-auto" onClick={reload}>ลองใหม่</Button>
      </p>
    ) : null;
  }

  const pending = data.slips.filter((s) => !s.staffId && !s.by);
  const ignored = data.slips.filter((s) => !s.staffId && s.by === "owner");
  const rounds = [...new Map(data.slips.map((s) => [s.round, s.label])).entries()];
  const cur = round ?? rounds[0]?.[0] ?? null;
  const inRound = data.slips.filter((s) => s.round === cur && s.staffId);

  return (
    <section className={cn("my-2 rounded-xl border text-sm", pending.length ? "border-warning-border bg-warning text-warning-foreground" : "bg-card")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
      >
        <ReceiptTextIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {!data.configured ? (
            <b>สลิปโอนเงิน: ยังไม่ได้ตั้งโฟลเดอร์ Google Drive</b>
          ) : (
            <>
              <b>สลิปโอนเงิน</b>: {data.slips.length - pending.length - ignored.length}/{data.slips.length} ไฟล์ขึ้นให้เจ้าตัวดาวน์โหลดแล้ว
              {pending.length ? <> · <b>รอจับคู่ {pending.length}</b></> : null}
            </>
          )}
        </span>
        <span className="shrink-0 text-xs font-semibold underline">{open ? "ซ่อน" : "ดู / ตรวจ"}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-inherit p-2 text-foreground">
          {!data.configured ? (
            <p className="rounded-lg bg-card p-2.5 text-xs leading-relaxed">
              ตั้ง id โฟลเดอร์ &quot;Slip&quot; ใน Supabase ที่ settings.pay_slip_drive_folder (แชร์ให้บัญชีระบบเป็นผู้แก้ไข)
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              ฝ่ายบัญชีอัปสลิปลงโฟลเดอร์ Slip แบบเดิม (รอบ &gt; กลุ่ม &gt; &quot;...-Mc ชื่อ.pdf&quot;) ระบบตรวจทุกชั่วโมง จับคู่ชื่อในไฟล์กับรายชื่อ
              แล้วเจ้าตัวเปิด / ดาวน์โหลดได้ใน &quot;ตารางของฉัน&quot; (สลิปที่เพิ่งอัปแจ้งเตือนเจ้าตัวด้วย)
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {rounds.length ? (
              <Select value={cur ?? undefined} onValueChange={setRound}>
                <SelectTrigger aria-label="รอบ" className="h-9 min-w-48 flex-1 bg-card sm:max-w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rounds.map(([r, text]) => (
                    <SelectItem key={r} value={r}>{text} ({data.slips.filter((s) => s.round === r).length} ไฟล์)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {data.configured ? (
              <Button variant="outline" className="bg-card pointer-coarse:min-h-9" disabled={!!busy} onClick={scan}>
                <RefreshCwIcon className={cn(busy === "scan" && "animate-spin")} />{busy === "scan" ? "กำลังตรวจ..." : "ตรวจสลิปใน Drive"}
              </Button>
            ) : null}
          </div>

          {pending.length ? (
            <SlipList title={`รอจับคู่ (${pending.length}) — ชื่อในไฟล์ไม่ตรงกับรายชื่อ`} slips={pending} data={data} busy={busy} onAssign={assign} />
          ) : null}
          {inRound.length ? (
            <SlipList title={`${rounds.find(([r]) => r === cur)?.[1] ?? ""} · จับคู่แล้ว ${inRound.length} ไฟล์`} slips={inRound} data={data} busy={busy} onAssign={assign} />
          ) : data.slips.length ? (
            <p className="rounded-lg bg-card p-3 text-center text-xs text-muted-foreground">รอบนี้ยังไม่มีสลิปที่จับคู่แล้ว</p>
          ) : data.configured ? (
            <p className="rounded-lg bg-card p-3 text-center text-xs text-muted-foreground">ยังไม่พบสลิป กด &quot;ตรวจสลิปใน Drive&quot;</p>
          ) : null}
          {ignored.length ? (
            <SlipList title={`ไม่ใช่คนในระบบ (${ignored.length})`} slips={ignored} data={data} busy={busy} onAssign={assign} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** รายการสลิป: ชื่อไฟล์ + กลุ่ม + เปิดไฟล์ + คนที่จับคู่ (เลือกเปลี่ยนได้) */
function SlipList({ title, slips, data, busy, onAssign }: {
  title: string; slips: OwnerSlip[]; data: OwnerSlips; busy: string | null;
  onAssign: (slip: OwnerSlip, person: OwnerSlips["people"][number] | null) => void;
}) {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <p className="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-xs font-semibold">
        <FolderOpenIcon className="size-3.5 shrink-0" aria-hidden />{title}
      </p>
      {slips.map((s) => {
        // ฝั่งเดียวกับสลิปขึ้นก่อน
        const options = [...data.people.filter((p) => p.role === s.role), ...data.people.filter((p) => p.role !== s.role)]
          .map((p) => ({ id: p.id, text: p.label }));
        return (
          <div key={s.id} className="border-t px-2.5 py-2 first:border-t-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold break-words">
                  {s.who ?? <span className="text-muted-foreground">ยังไม่มีเจ้าของ</span>}
                  {s.by ? (
                    <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">{s.by === "owner" ? "Owner เลือก" : "ระบบจับคู่"}</Badge>
                  ) : null}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground" title={`${s.label} / ${s.group} / ${s.fileName}`}>
                  {sideText(s.role)} · {s.label}{s.group ? ` · ${s.group}` : ""} · {s.fileName}
                </span>
              </span>
              <Button size="sm" variant="ghost" className="shrink-0 pointer-coarse:min-h-9" asChild>
                <a href={fileUrl(s.id)} target="_blank" rel="noopener"><ExternalLinkIcon />เปิดไฟล์</a>
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <div className="flex min-w-48 flex-1">
                <PersonPicker
                  label="คน" value={s.staffId} options={options} disabled={!!busy} hideEmpty
                  emptyText={busy === `s${s.id}` ? "กำลังบันทึก..." : s.staffId ? "เปลี่ยนคน..." : "เลือกคน..."}
                  onChange={(id) => { const p = id ? byId.get(id) : null; if (p && p.id !== s.staffId) onAssign(s, p); }}
                />
              </div>
              {s.staffId || !s.by ? (
                <Button size="sm" variant="outline" className="pointer-coarse:min-h-9" disabled={!!busy} onClick={() => onAssign(s, null)}>
                  ไม่ใช่คนในระบบ
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
