"use client";

import { useEffect, useState } from "react";
import { monthKey, monthLabel, num, todayKey } from "@/lib/format";
import { QUOTA_A, QUOTA_B, QUOTA_C, SETTLE_DAYS, SCORE_TOP, type QuotaReport, type QuotaRow } from "@/lib/mc-quota";
import { MIN_RANK_HOURS, type Tier } from "@/lib/mc-rank";
import { cn } from "@/lib/utils";
import {
  AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, MonthNav, Notice, api, useConfirm, useToast,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * หน้าเจ้าของ > ผลงาน Mc > สิทธิ์จอง: สิทธิ์จองคิวของ Mc ต่อเดือนตามแร็งค์ผลงานเดือนก่อน (src/lib/mc-quota.ts)
 *   Owner ที่จัดการได้ทั้ง Mc + Admin หรือติ๊ก "กำหนดสิทธิ์จอง Mc" = เปิดปิด / ตั้งสิทธิ์เพิ่มพิเศษ / คำนวณใหม่ได้
 */

const TIER_CLASS: Record<Tier, string> = {
  A: "border-success/40 bg-success/15 text-success",
  B: "border-border bg-secondary text-muted-foreground",
  C: "border-destructive/40 bg-destructive/10 text-destructive",
};
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const dateText = (d: string) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const stampText = (iso: string) => new Intl.DateTimeFormat("th-TH", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
}).format(new Date(iso));

export function McQuotaPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  // ครึ่งหลังของเดือน = ส่วนใหญ่กำลังจองเดือนหน้า
  const [month, setMonth] = useState(() => monthKey(Number(todayKey().slice(8, 10)) >= 15 ? 1 : 0));
  const [cache, setCache] = useState<Record<string, QuotaReport>>({});
  const [failed, setFailed] = useState<{ month: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<QuotaRow | null>(null);
  const report = cache[month];
  const error = failed?.month === month ? failed.message : "";

  useEffect(() => {
    if (report) return;
    api<{ report: QuotaReport }>(`/api/owner/quota?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        setCache((c) => ({ ...c, [month]: res.report }));
        setFailed(null);
      })
      .catch((err) => setFailed({ month, message: (err as Error).message }));
  }, [month, report, attempt]);

  const reload = () => { setCache({}); setAttempt((n) => n + 1); };

  async function toggle() {
    if (!report) return;
    const on = !report.on;
    if (!(await confirm({
      title: on ? "เปิดการจำกัดสิทธิ์จองตามแร็งค์?" : "ปิดการจำกัดสิทธิ์จอง?",
      description: on
        ? "Mc จะจองได้ไม่เกินสิทธิ์ของแต่ละเดือน (นับรวมคิวที่มีอยู่แล้ว) · คิวที่จองไว้เกินสิทธิ์แล้วไม่หาย แค่จองเพิ่มไม่ได้ · Mc ประจำ / ทีม Shopee ไม่จำกัด · Mc จะได้รับแจ้งเตือนสิทธิ์ + แร็งค์ของตัวเอง และเห็นแร็งค์ใน \"ตารางของฉัน\""
        : "Mc จะจองได้ไม่จำกัดจำนวนต่อเดือน (ยังจำกัดต่อวันตามเดิม) · กล่องแร็งค์ใน \"ตารางของฉัน\" จะซ่อน",
      confirmText: on ? "เปิดใช้" : "ปิด",
      destructive: !on,
    }))) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/owner/quota", { action: "toggle", on });
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      const res = await api<{ report: QuotaReport }>("/api/owner/quota", { action: "refresh", month });
      if (!res.ok) throw new Error(res.message);
      setCache((c) => ({ ...c, [month]: res.report }));
      toast("คำนวณแร็งค์ใหม่แล้ว (สิทธิ์เพิ่มพิเศษไม่เปลี่ยน)");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const rows = report?.rows ?? [];
  const over = rows.filter((r) => r.used > r.total).length;
  const tierCount = (t: Tier | null) => rows.filter((r) => r.tier === t).length;

  return (
    <section className="mt-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 className="flex flex-wrap items-baseline gap-2 text-lg font-bold">
          สิทธิ์จองคิว Mc ต่อเดือน
          <span className="text-xs font-normal text-muted-foreground">
            ตามแร็งค์ผลงานเดือนก่อน (หน้าอันดับ Mc) · A {QUOTA_A[0]}–{QUOTA_A[1]} slot (110%→{Math.round(SCORE_TOP * 100)}%) · B {QUOTA_B[0]}–{QUOTA_B[1]} slot (95%→110%) · C / ยังไม่มีอันดับ {QUOTA_C} slot · + สิทธิ์เพิ่มพิเศษ
          </span>
        </h2>
      </div>
      <MonthNav label={monthLabel(month)} onPrev={() => setMonth(monthKey(-1, month))} onNext={() => setMonth(monthKey(1, month))} />

      {!report ? (
        error ? <LoadError title="โหลดสิทธิ์จองไม่สำเร็จ" message={error} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} /> : <LoadingBlock className="h-32" />
      ) : (
        <>
          <div className={cn("mb-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm", report.on ? "border-success/40 bg-success/10" : "bg-card")}>
            <span className="min-w-0 flex-1">
              <b>{report.on ? "เปิดใช้อยู่" : "ปิดอยู่"}</b>
              <span className="text-muted-foreground">
                {report.on ? " — Mc จองได้ไม่เกินสิทธิ์ของเดือนนั้น (นับรวมคิวที่มีอยู่แล้ว)" : " — Mc จองได้ไม่จำกัดต่อเดือน (ตัวเลขด้านล่าง = ถ้าเปิดใช้)"}
              </span>
            </span>
            {report.canEdit ? (
              <Button size="sm" variant={report.on ? "outline" : "default"} disabled={busy} onClick={toggle}>
                {report.on ? "ปิดการจำกัด" : "เปิดใช้"}
              </Button>
            ) : null}
          </div>

          <Notice variant={report.settled ? "info" : "warning"} className="mb-2">
            แร็งค์จากผลงาน <b>{monthLabel(report.source)}</b>
            {report.settled
              ? ` (ล็อกแล้ว · คำนวณล่าสุด ${report.computedAt ? stampText(report.computedAt) : "–"})`
              : ` — ชั่วคราว: ${monthLabel(report.source)} ยังไม่จบ ระบบอัปเดตเองทุก 1 ชม. และล็อกวันที่ ${dateText(report.settleDate)} (จบเดือน + ${SETTLE_DAYS} วันให้กรอกยอด) · คำนวณล่าสุด ${report.computedAt ? stampText(report.computedAt) : "–"}`}
            {" "}· A {tierCount("A")} · B {tierCount("B")} · C {tierCount("C")} · ยังไม่มีอันดับ {tierCount(null)} คน
            {over ? <b className="text-destructive"> · จองเกินสิทธิ์ {over} คน (คิวเดิมไม่หาย จองเพิ่มไม่ได้)</b> : null}
          </Notice>

          {!rows.length ? (
            <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">ยังไม่มี Mc ที่ใช้สิทธิ์จอง (ต้องมีอีเมล ไม่ใช่ Mc ประจำ ไม่ใช่ทีม Shopee)</div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {/* มือถือ: 5 คอลัมน์พอดีจอ (อัตโนมัติ / เพิ่มพิเศษ อยู่ใต้สิทธิ์รวม) */}
              <Table>
                <TableHeader className="bg-secondary">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-2 sm:px-3">Mc</TableHead>
                    <TableHead className="px-2 text-right sm:px-3">แร็งค์</TableHead>
                    <TableHead className="px-2 text-right sm:px-3">สิทธิ์</TableHead>
                    <TableHead className="px-2 text-right sm:px-3">จองแล้ว</TableHead>
                    {report.canEdit ? <TableHead className="w-12 px-2 sm:px-3" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.staffId}>
                      <TableCell className="px-2 whitespace-normal sm:px-3">
                        <span className="font-medium">{r.name}</span>
                        {r.note ? <span className="block text-[11px] text-muted-foreground">{r.note}</span> : null}
                      </TableCell>
                      <TableCell className="px-2 text-right whitespace-normal sm:px-3">
                        {r.tier && r.score !== null ? (
                          <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5">
                            <span className="text-xs tabular-nums text-muted-foreground">{pct(r.score)}</span>
                            <span className={cn("rounded-full border px-1.5 text-[11px] font-bold", TIER_CLASS[r.tier])}>{r.tier}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground" title={`ชม. ที่มียอดน้อยกว่า ${MIN_RANK_HOURS} ชม. / Mc ใหม่`}>
                            ยังไม่มีอันดับ{r.hours ? ` (${num(Math.round(r.hours * 10) / 10)} ชม.)` : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 text-right sm:px-3">
                        <b className="tabular-nums">{r.total}</b>
                        {r.extra ? (
                          <span className={cn("block text-[11px] tabular-nums", r.extra > 0 ? "text-success" : "text-destructive")}>
                            {r.auto} {r.extra > 0 ? `+${r.extra}` : `−${-r.extra}`}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className={cn("px-2 text-right tabular-nums sm:px-3", r.used > r.total ? "font-semibold text-destructive" : r.used === r.total ? "font-semibold" : "")}>
                        {r.used}/{r.total}
                      </TableCell>
                      {report.canEdit ? (
                        <TableCell className="px-2 text-right sm:px-3">
                          <Button size="xs" variant="outline" onClick={() => setEditing(r)}>แก้</Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                <span>
                  สิทธิ์ = อัตโนมัติตามแร็งค์ ± เพิ่มพิเศษ · จองแล้ว = คิวทั้งเดือน (รวมที่ Owner ลงให้ ไม่นับที่ยกเลิก) · Mc ประจำ / ทีม Shopee / Mc ที่ยังไม่มีอีเมล ไม่จำกัด ไม่อยู่ในรายการ
                  {!report.canEdit ? " · ตั้งสิทธิ์เพิ่มได้เฉพาะ Owner ที่จัดการได้ทั้ง Mc + Admin หรือติ๊ก \"กำหนดสิทธิ์จอง Mc\"" : ""}
                </span>
                {report.canEdit ? <Button size="xs" variant="outline" disabled={busy} onClick={refresh}>{busy ? "กำลังคำนวณ..." : "คำนวณแร็งค์ใหม่"}</Button> : null}
              </div>
            </div>
          )}
        </>
      )}

      {editing && report ? (
        <ExtraDialog
          month={report.month} row={editing}
          onClose={(saved) => { setEditing(null); if (saved) { toast("บันทึกแล้ว"); reload(); } }}
        />
      ) : null}
    </section>
  );
}

function ExtraDialog({ month, row, onClose }: { month: string; row: QuotaRow; onClose: (saved: boolean) => void }) {
  const toast = useToast();
  const [extra, setExtra] = useState(row.extra ? String(row.extra) : "");
  const [note, setNote] = useState(row.note);
  const [saving, setSaving] = useState(false);
  const n = extra.trim() === "" ? 0 : Number(extra);
  const valid = Number.isInteger(n) && n >= -100 && n <= 200;

  async function save() {
    setSaving(true);
    try {
      const res = await api("/api/owner/quota", { month, staffId: row.staffId, extra: n, note }, "PATCH");
      if (!res.ok) throw new Error(res.message);
      onClose(true);
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  }

  return (
    <AppDialog
      open onClose={() => onClose(false)} busy={saving}
      title={`สิทธิ์จอง ${row.name} · ${monthLabel(month)}`}
      description={`อัตโนมัติ ${row.auto} slot${row.tier ? ` (แร็งค์ ${row.tier})` : " (ยังไม่มีอันดับ)"} · จองแล้ว ${row.used} slot`}
    >
      <DialogBody className="space-y-3">
        <div>
          <Label htmlFor="quota-extra" className="mb-1">เพิ่มพิเศษ (slot) — ติดลบ = ลดสิทธิ์</Label>
          <Input id="quota-extra" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value.replace(/[^\d-]/g, ""))} placeholder="0" />
          <p className={cn("mt-1 text-xs", valid ? "text-muted-foreground" : "text-destructive")}>
            {valid ? `สิทธิ์รวม ${Math.max(0, row.auto + n)} slot` : "ใส่จำนวนเต็ม -100 ถึง 200"}
          </p>
        </div>
        <div>
          <Label htmlFor="quota-note" className="mb-1">หมายเหตุ (ไม่บังคับ)</Label>
          <Input id="quota-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น แคมเปญ 11.11 ขอเพิ่ม" />
        </div>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" disabled={saving} onClick={() => onClose(false)}>ยกเลิก</Button>
        <Button size="lg" disabled={saving || !valid} onClick={save}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
      </DialogActions>
    </AppDialog>
  );
}
