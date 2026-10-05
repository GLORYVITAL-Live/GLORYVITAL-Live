"use client";

import { useEffect, useState } from "react";
import { AppDialog, DialogActions, DialogBody, api } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import { BONUS_TIERS, LATE_TIERS } from "@/lib/pay";
import { defaultRules } from "@/lib/rules";
import { cn } from "@/lib/utils";

type Loaded = { role: string; items: string[]; rate: number; hasCommit: boolean };

/**
 * กฎการทำงาน (เด้งวันละครั้งหลัง login และเปิดดูได้จาก "ตารางของฉัน")
 * กฎมาสาย / ไลฟ์ชดเชย มาจาก src/lib/pay.ts (ตัวเดียวกับที่ใช้คิดเงิน) แสดงเป็นบาทตามค่าจ้างของคนที่เปิดดู
 */
export function RulesDialog({ open, onClose, role, who }: {
  open: boolean;
  onClose: () => void;
  role: "mc" | "admin";
  who: string;
}) {
  // ส่วน "อื่นๆ" Owner แก้ได้ผ่านเว็บ (ระหว่างโหลดแสดงข้อความเริ่มต้น)
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<Omit<Loaded, "role">>(`/api/rules?role=${role}`)
      .then((res) => { if (alive && res.ok) setLoaded({ role, items: res.items, rate: res.rate, hasCommit: res.hasCommit }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, role]);
  const mine = loaded?.role === role ? loaded : null;
  const items = mine?.items ?? defaultRules(role);
  const rate = mine?.rate ?? 0;
  const slotHours = 2; // ตัวอย่างหักมาสาย คิดจาก slot 2 ชม.

  const row = "flex items-center justify-between gap-3 rounded-xl border px-3 py-2";
  const pill = "h-auto px-2.5 py-0.5 font-bold";
  return (
    <AppDialog open={open} onClose={onClose} title="กฎการทำงาน" description={`สวัสดี ${who} โปรดอ่านและปฏิบัติตามกฎทุกครั้ง`}>
      <DialogBody className="text-sm">
        <h3 className="mb-1 font-bold">การมาสาย</h3>
        {rate ? <p className="mb-2 text-xs text-muted-foreground">ตัวเลขบาทคิดจาก slot {slotHours} ชม. ตามค่าจ้างของคุณ {money(rate)} บาท/ชม.</p> : null}
        <ul className="mb-4 space-y-1.5">
          {LATE_TIERS.map((t) => (
            <li key={t.label} className={row}>
              <span>{t.label}</span>
              <Badge
                className={cn(
                  pill,
                  !t.cut ? "bg-success/15 text-success" : t.cut < 0.5 ? "bg-warning text-warning-foreground" : "bg-destructive/15 text-destructive",
                )}
              >
                {t.cut ? `หัก ${Math.round(t.cut * 100)}%` : "ไม่หัก"}
                {t.cut && rate ? ` (−${money(rate * slotHours * t.cut)})` : ""}
              </Badge>
            </li>
          ))}
        </ul>

        <h3 className="mb-1 font-bold">ไลฟ์ชดเชย (ไลฟ์ต่อแทนคนถัดไปที่มาสาย)</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          ได้เงินเพิ่มตามค่าจ้าง/ชม.{rate ? ` ของคุณ ${money(rate)} บาท` : ""} · เกิน 1 ชม. = ชั่วโมงเต็ม + เศษคิดตามขั้นเดียวกัน
          {mine?.hasCommit ? " · ถ้าเดือนนั้นถึงขั้น Commit ใช้ราคาตาม Commit" : ""}
        </p>
        <ul className="mb-4 space-y-1.5">
          {BONUS_TIERS.map((t) => (
            <li key={t.label} className={row}>
              <span>{t.label}</span>
              <Badge className={cn(pill, "bg-success/15 text-success")}>
                ได้ {t.share}{rate ? ` (+${money(rate * t.hours)})` : ""}
              </Badge>
            </li>
          ))}
        </ul>

        <h3 className="mb-2 font-bold">อื่นๆ</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {items.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </DialogBody>
      <DialogActions>
        <Button size="lg" onClick={onClose}>รับทราบ</Button>
      </DialogActions>
    </AppDialog>
  );
}
