"use client";

import { useEffect, useState } from "react";
import {
  CircleCheckIcon, ClockIcon, ExternalLinkIcon, FileTextIcon, RefreshCwIcon, RotateCcwIcon, TriangleAlertIcon, XIcon,
} from "lucide-react";
import { PersonPicker } from "@/components/SlotManager";
import { api, useConfirm, useToast } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { tawiMonthLabel } from "@/lib/tawi-name";
import type { OwnerTawi, TawiOwnerDoc, TawiPerson, TawiVerifyState } from "@/lib/types";
import { cn } from "@/lib/utils";

type Scan = { added: number; removed: number; matched: number; unmatched: number; notified: number; files: number };
// self = เจ้าตัวกรอกชื่อจับคู่เอง (แบบเดิม เลิกใช้แล้ว — แสดงไว้เผื่อมีข้อมูลเก่า)
const BY_LABEL = { auto: "ระบบจับคู่", owner: "Owner จับคู่", self: "เจ้าตัวกรอกชื่อ" } as const;
const fileUrl = (id: number) => `/api/tawi/file?id=${id}&inline=1`;

/**
 * ใบ 50 ทวิ (หน้าพนักงาน — เฉพาะ Owner ที่ดูเอกสารทำเบิกได้): ตรวจไฟล์ใน Drive + จับคู่ไฟล์กับรายชื่อเอง
 *   จับคู่ / ยกเลิก = ใช้กับทุกเดือนที่ชื่อในไฟล์เดียวกัน (ระบบจำชื่อจริงไว้ เดือนถัดไปจับคู่เอง)
 */
export function TawiPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<OwnerTawi | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<"todo" | "done">("todo");
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api<OwnerTawi>(`/api/owner/tawi${month ? `?month=${month}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [month, tick]);

  async function scan() {
    setBusy("scan");
    try {
      const res = await api<{ scan: Scan }>("/api/owner/tawi", { action: "scan" });
      if (!res.ok) throw new Error(res.message);
      const s = res.scan;
      toast(`ตรวจแล้ว ${s.files} ไฟล์ · ใหม่ ${s.added}${s.removed ? ` · ลบ ${s.removed}` : ""} · จับคู่อัตโนมัติ ${s.matched} · ยังไม่จับคู่ ${s.unmatched}${s.notified ? ` · แจ้งเจ้าของ ${s.notified} คน` : ""}`);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function resetVerify(doc: TawiOwnerDoc, person: TawiPerson) {
    const ok = await confirm({
      title: `รีเซ็ตการยืนยันตัวตนของ ${person.label}?`,
      description: "ล้างการยืนยันและจำนวนครั้งที่กรอกไม่ตรง เจ้าตัวต้องกรอกชื่อ-นามสกุลจริงยืนยันใหม่ก่อนดาวน์โหลดใบ 50 ทวิทุกใบ",
      confirmText: "รีเซ็ต",
      destructive: true,
    });
    if (!ok) return;
    setBusy(`doc${doc.id}`);
    try {
      const res = await api<{ reset: number }>("/api/owner/tawi", { action: "reset-verify", staffId: person.id });
      if (!res.ok) throw new Error(res.message);
      toast(`รีเซ็ตการยืนยันของ ${person.label} แล้ว`);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function assign(doc: TawiOwnerDoc, person: TawiPerson | null) {
    // ไฟล์ที่ยังไม่มีเจ้าของ + ไม่เลือกคน = ตั้งว่าไม่ใช่คนในทีม (ไม่ขึ้นเป็นงานค้างในหน้าแรก)
    const outsider = !person && !doc.staffId;
    const ok = await confirm({
      title: person ? `จับคู่ "${doc.realName}" กับ ${person.label}?` : outsider ? `"${doc.realName}" ไม่ใช่คนในทีม?` : `ยกเลิกการจับคู่ "${doc.realName}"?`,
      description: person
        ? `ใช้กับใบ 50 ทวิทุกเดือนที่ชื่อนี้ ${person.label} จะดาวน์โหลดได้ที่ "ตารางของฉัน" หลังกรอกชื่อจริงยืนยันตัวตน${person.legalName ? "" : " และระบบจำชื่อนี้เป็นชื่อจริงของคนนี้ (เดือนถัดไปจับคู่เอง)"}${person.hasEmail ? "" : " — รายชื่อนี้ยังไม่มีอีเมล จึงยังเข้าเว็บดาวน์โหลดไม่ได้"}`
        : outsider
          ? "ใช้กับทุกเดือนที่ชื่อนี้ — ไม่ขึ้นเป็นงานค้างในหน้าแรกอีก และระบบจะไม่จับคู่ชื่อนี้อัตโนมัติ (เลือกคนทีหลังได้)"
          : "ทุกเดือนที่ชื่อนี้จะกลับไปเป็น \"ยังไม่จับคู่\" และระบบจะไม่จับคู่ชื่อนี้อัตโนมัติอีก (เลือกคนใหม่ได้)",
      confirmText: person ? "จับคู่" : outsider ? "ไม่ใช่คนในทีม" : "ยกเลิกการจับคู่",
      destructive: !person && !outsider,
    });
    if (!ok) return;
    setBusy(`doc${doc.id}`);
    try {
      const res = await api<{ changed: number }>("/api/owner/tawi", person ? { action: "assign", docId: doc.id, staffId: person.id } : { action: "unassign", docId: doc.id });
      if (!res.ok) throw new Error(res.message);
      toast(person ? `จับคู่กับ ${person.label} แล้ว (${res.changed} ไฟล์)` : outsider ? `ตั้งว่าไม่ใช่คนในทีมแล้ว (${res.changed} ไฟล์)` : `ยกเลิกแล้ว (${res.changed} ไฟล์)`);
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
        <FileTextIcon className="size-4 shrink-0" />ใบ 50 ทวิ: {error}
        <Button size="xs" variant="outline" className="ml-auto" onClick={reload}>ลองใหม่</Button>
      </p>
    ) : null;
  }
  if (!data.ready) {
    return (
      <p className="my-2 flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground">
        <FileTextIcon className="size-4 shrink-0" />ใบ 50 ทวิ: ต้องรัน SQL 20261029000000_tawi50 ใน Supabase ก่อน
      </p>
    );
  }

  const cur = data.months.find((m) => m.month === data.month);
  const people = new Map(data.people.map((p) => [p.id, p]));
  const todo = data.docs.filter((d) => !d.staffId);
  const done = data.docs.filter((d) => d.staffId);
  const selfCount = done.filter((d) => d.matchedBy === "self").length;
  const list = view === "todo" ? todo : done;
  // สถานะยืนยันตัวตนต่อคน (หลายใบ: กรอกไม่ตรง > รอยืนยัน > ยืนยันแล้ว)
  const rank = { fail: 2, wait: 1, ok: 0 } as const;
  const perPerson = new Map<number, keyof typeof rank>();
  for (const d of done) {
    if (!d.staffId || !d.verify) continue;
    const prev = perPerson.get(d.staffId);
    if (!prev || rank[d.verify.status] > rank[prev]) perPerson.set(d.staffId, d.verify.status);
  }
  const countOf = (s: keyof typeof rank) => [...perPerson.values()].filter((v) => v === s).length;

  return (
    <section className={cn("my-2 rounded-xl border text-sm", todo.length ? "border-warning-border bg-warning text-warning-foreground" : "bg-card")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
      >
        <FileTextIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {!data.folderSet ? (
            <b>ใบ 50 ทวิ: ยังไม่ได้ตั้งโฟลเดอร์ Google Drive</b>
          ) : cur ? (
            <>
              <b>ใบ 50 ทวิ {tawiMonthLabel(cur.month)}</b>: จับคู่แล้ว {cur.matched} · ยังไม่จับคู่ {cur.total - cur.matched}
              {countOf("fail") ? <> · <b className="text-destructive">กรอกชื่อไม่ตรง {countOf("fail")} คน</b></> : null}
            </>
          ) : (
            <b>ใบ 50 ทวิ: ยังไม่มีไฟล์ (กดตรวจไฟล์ใน Drive)</b>
          )}
        </span>
        <span className="shrink-0 text-xs font-semibold underline">{open ? "ซ่อน" : "ดู / จับคู่"}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-inherit p-2 text-foreground">
          {!data.folderSet ? (
            <p className="rounded-lg bg-card p-2.5 text-xs leading-relaxed">
              ตั้ง id โฟลเดอร์หลักของใบ 50 ทวิ (โฟลเดอร์ที่มีโฟลเดอร์ย่อยรายเดือน เช่น 09Sep) ใน Supabase ที่ settings.tawi_drive_folder
              แล้วแชร์โฟลเดอร์นั้นให้บัญชีระบบ จากนั้นกด &quot;ตรวจไฟล์ใน Drive&quot;
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {data.months.length ? (
              <Select value={data.month ?? undefined} onValueChange={(v) => { setMonth(v); setView("todo"); }}>
                <SelectTrigger aria-label="เดือน" className="h-9 min-w-40 flex-1 bg-card sm:flex-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.months.map((m) => (
                    <SelectItem key={m.month} value={m.month}>
                      {tawiMonthLabel(m.month)} ({m.matched}/{m.total})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button variant="outline" className="bg-card pointer-coarse:min-h-9" disabled={!!busy || !data.folderSet} onClick={scan}>
              <RefreshCwIcon className={cn(busy === "scan" && "animate-spin")} />{busy === "scan" ? "กำลังตรวจ..." : "ตรวจไฟล์ใน Drive"}
            </Button>
          </div>

          {data.docs.length ? (
            <>
              <ToggleGroup
                type="single" variant="outline" spacing={0} value={view}
                onValueChange={(v) => { if (v) setView(v as "todo" | "done"); }}
                aria-label="รายการ" className="bg-card"
              >
                <ToggleGroupItem value="todo" className="font-semibold">ยังไม่จับคู่ ({todo.length})</ToggleGroupItem>
                <ToggleGroupItem value="done" className="font-semibold">จับคู่แล้ว ({done.length})</ToggleGroupItem>
              </ToggleGroup>
              {!data.verifyReady && done.length ? (
                <p className="rounded-lg bg-card p-2 text-xs leading-relaxed text-destructive">
                  ต้องรัน SQL 20261030000000_tawi_verify ใน Supabase ก่อน — ระหว่างนี้เจ้าตัวดาวน์โหลดไม่ได้ (Owner เปิดไฟล์ได้)
                </p>
              ) : null}
              {view === "done" && perPerson.size ? (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-semibold">ยืนยันตัวตน:</span>
                  <VerifyBadge status="ok" text={`ยืนยันแล้ว ${countOf("ok")} คน`} />
                  <VerifyBadge status="wait" text={`รอเจ้าตัวยืนยัน ${countOf("wait")} คน`} />
                  <VerifyBadge status="fail" text={`กรอกไม่ตรง ${countOf("fail")} คน`} />
                </p>
              ) : null}
              {view === "done" && selfCount ? (
                <p className="text-xs text-muted-foreground">เจ้าตัวกรอกชื่อเอง {selfCount} ไฟล์ — ตรวจว่าเป็นคนนั้นจริง (ชื่อจริงใช้ปลดล็อกเอกสารภาษี)</p>
              ) : null}
              {!list.length ? (
                <p className="rounded-lg bg-card p-3 text-center text-xs text-muted-foreground">
                  {view === "todo" ? "จับคู่ครบทุกไฟล์ของเดือนนี้แล้ว" : "ยังไม่มีไฟล์ที่จับคู่"}
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border bg-card">
                  {list.map((d) => (
                    <DocRow
                      key={d.id} doc={d} people={data.people} owner={d.staffId ? people.get(d.staffId) ?? null : null}
                      busy={busy === `doc${d.id}`} disabled={!!busy}
                      onAssign={(p) => assign(d, p)} onReset={(p) => resetVerify(d, p)}
                    />
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                ไฟล์ที่ผู้รับเป็นบริษัท / ไม่ใช่ PDF ไม่แสดง · คนนอกทีม กด &quot;ไม่ใช่คนในทีม&quot; (ไม่ขึ้นเป็นงานค้างในหน้าแรก)
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** "19 ต.ค. 14:05" (เวลาไทย) */
const when = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const VERIFY_STYLE = {
  ok: { icon: CircleCheckIcon, className: "text-success" },
  wait: { icon: ClockIcon, className: "text-muted-foreground" },
  fail: { icon: TriangleAlertIcon, className: "text-destructive font-semibold" },
} as const;

/** ป้ายสถานะยืนยันตัวตนของเจ้าของไฟล์ */
function VerifyBadge({ status, text }: { status: TawiVerifyState["status"]; text: string }) {
  const { icon: Icon, className } = VERIFY_STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />{text}
    </span>
  );
}

/** 1 ไฟล์: ชื่อในไฟล์ + เลือกคน (แนะนำชื่อใกล้เคียงไว้บนสุด) / คนที่จับคู่แล้ว + เปลี่ยน / ยกเลิก */
function DocRow({ doc, people, owner, busy, disabled, onAssign, onReset }: {
  doc: TawiOwnerDoc;
  people: TawiPerson[];
  owner: TawiPerson | null;
  busy: boolean;
  disabled: boolean;
  onAssign: (person: TawiPerson | null) => void;
  onReset: (person: TawiPerson) => void;
}) {
  const [changing, setChanging] = useState(false);
  const byId = new Map(people.map((p) => [p.id, p]));
  const suggested = doc.suggest.map((s) => byId.get(s.id)).filter((p): p is TawiPerson => !!p);
  const options = [
    ...suggested.map((p) => ({ id: p.id, text: `★ ${p.label}${p.legalName ? ` (${p.legalName})` : ""}` })),
    ...people.filter((p) => !suggested.includes(p) && p.id !== owner?.id)
      .map((p) => ({ id: p.id, text: `${p.label}${p.legalName ? ` (${p.legalName})` : ""}${p.hasEmail ? "" : " · ไม่มีอีเมล"}` })),
  ];
  const picker = (
    <PersonPicker
      label="คน" value={null} options={options} disabled={disabled} hideEmpty
      emptyText={busy ? "กำลังบันทึก..." : "เลือกคน..."}
      onChange={(id) => { const p = id ? byId.get(id) : null; if (p) { setChanging(false); onAssign(p); } }}
    />
  );
  return (
    <div className="border-b px-2.5 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold break-words">{doc.realName}</span>
          <span className="block truncate text-[11px] text-muted-foreground" title={doc.fileName}>{doc.fileName}</span>
        </span>
        <Button size="sm" variant="ghost" className="shrink-0 pointer-coarse:min-h-9" asChild>
          <a href={fileUrl(doc.id)} target="_blank" rel="noopener"><ExternalLinkIcon />เปิดไฟล์</a>
        </Button>
      </div>
      {owner ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-primary">{owner.label}</span>
          {doc.matchedBy ? (
            <Badge variant="outline" className={cn("text-[11px]", doc.matchedBy === "self" ? "border-warning-border bg-warning text-warning-foreground" : "text-muted-foreground")}>
              {BY_LABEL[doc.matchedBy]}
            </Badge>
          ) : null}
          {!owner.hasEmail ? <Badge variant="outline" className="text-[11px] text-destructive">ไม่มีอีเมล</Badge> : null}
          {doc.verify ? (
            <VerifyBadge
              status={doc.verify.status}
              text={doc.verify.status === "ok" ? "ยืนยันแล้ว" : doc.verify.status === "wait" ? "รอเจ้าตัวยืนยัน"
                : `กรอกไม่ตรง ${doc.verify.fails} ครั้ง${doc.verify.failedAt ? ` · ล่าสุด ${when(doc.verify.failedAt)}` : ""}`}
            />
          ) : null}
          <span className="ml-auto flex flex-wrap justify-end gap-1">
            {doc.verify && doc.verify.status !== "wait" ? (
              <Button size="sm" variant="outline" className="pointer-coarse:min-h-9" disabled={disabled} onClick={() => onReset(owner)}>
                <RotateCcwIcon />รีเซ็ตการยืนยัน
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="pointer-coarse:min-h-9" disabled={disabled} onClick={() => setChanging(!changing)}>
              {changing ? "ไม่เปลี่ยน" : "เปลี่ยน"}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive pointer-coarse:min-h-9" disabled={disabled} onClick={() => onAssign(null)}>
              <XIcon />ยกเลิก
            </Button>
          </span>
          {changing ? <div className="flex w-full">{picker}</div> : null}
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {doc.matchedBy === "owner" ? (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">ไม่ใช่คนในทีม</Badge>
          ) : (
            <Button size="sm" variant="outline" className="pointer-coarse:min-h-9" disabled={disabled} onClick={() => onAssign(null)}>
              <XIcon />ไม่ใช่คนในทีม
            </Button>
          )}
          {suggested.map((p) => (
            <Button key={p.id} size="sm" variant="secondary" className="max-w-full pointer-coarse:min-h-9" disabled={disabled} onClick={() => onAssign(p)}>
              <span className="truncate">ใช่ {p.label}?</span>
            </Button>
          ))}
          <div className="flex min-w-48 flex-1">{picker}</div>
        </div>
      )}
    </div>
  );
}
