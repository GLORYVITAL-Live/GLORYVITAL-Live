"use client";

import { useState } from "react";
import { lateCut } from "@/lib/pay";
import { cn } from "@/lib/utils";
import { AppDialog, DialogActions, DialogBody, api, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * เจ้าของใส่สถานะ "มาสาย" ให้ Admin ของคิว (/api/owner/admin-late) — เขียนลงชีตคอลัมน์ M แล้วหักเงินตามกฎเดิม
 *   target.late = นาทีที่ใส่ไว้แล้ว (แก้ / ลบได้)
 */
export type AdminLateTarget = { slotId: number; who: string; when: string; late: number | null };

const QUICK = [10, 15, 20, 30, 45, 60];

export function AdminLateDialog({ target, onClose, onSaved }: { target: AdminLateTarget | null; onClose: () => void; onSaved: (late: number | null) => void }) {
  return (
    <AppDialog open={!!target} onClose={onClose} title={target ? `${target.who} มาสาย` : "มาสาย"}>
      {target ? <LateForm key={target.slotId} target={target} onClose={onClose} onSaved={onSaved} /> : null}
    </AppDialog>
  );
}

function LateForm({ target, onClose, onSaved }: { target: AdminLateTarget; onClose: () => void; onSaved: (late: number | null) => void }) {
  const toast = useToast();
  const [value, setValue] = useState(target.late ? String(target.late) : "");
  const [busy, setBusy] = useState(false);
  const minutes = Number(value);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 300;
  const cut = valid ? lateCut(minutes) : 0;

  async function save(m: number | null) {
    setBusy(true);
    try {
      const res = await api<{ message: string; late: number | null }>("/api/owner/admin-late", { id: target.slotId, minutes: m });
      if (!res.ok) throw new Error(res.message);
      toast(res.message);
      onSaved(res.late);
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogBody>
        <p className="text-sm text-muted-foreground">{target.when}</p>
        <p className="mt-3 text-sm font-semibold">สายกี่นาที</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {QUICK.map((m) => (
            <Button
              key={m} type="button" size="sm" variant={minutes === m ? "selected" : "outline"} className="rounded-full tabular-nums"
              aria-pressed={minutes === m} onClick={() => setValue(String(m))}
            >
              {m} นาที
            </Button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">หรือพิมพ์</span>
          <Input
            inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 3))}
            className="h-9 w-24 tabular-nums" aria-label="นาทีที่สาย"
          />
          <span className="text-muted-foreground">นาที</span>
        </label>
        <p className={cn("mt-3 text-xs", cut > 0 ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {!valid ? "ใส่ 1–300 นาที" : cut > 0 ? `หักเงิน ${Math.round(cut * 100)}% ของชั่วโมง ตามกฎการทำงาน` : "สายไม่เกิน 5 นาที ไม่หักเงิน"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">ระบบเขียนลงชีต (แท็บ Admin เสริม คอลัมน์ M) ให้ · Admin เห็นในตารางของฉัน</p>
      </DialogBody>
      <DialogActions>
        {target.late ? (
          <Button variant="outline" className="mr-auto text-destructive" disabled={busy} onClick={() => save(null)}>ลบสถานะมาสาย</Button>
        ) : null}
        <Button variant="outline" disabled={busy} onClick={onClose}>ยกเลิก</Button>
        <Button disabled={busy || !valid} onClick={() => save(minutes)}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
      </DialogActions>
    </>
  );
}
