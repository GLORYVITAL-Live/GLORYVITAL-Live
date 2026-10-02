"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetHead, api, btn } from "@/components/ui";
import { money } from "@/lib/format";
import { BONUS_TIERS, LATE_TIERS } from "@/lib/pay";
import { defaultRules } from "@/lib/rules";

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

  const pill = "rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap";
  return (
    <Sheet open={open} onClose={onClose} labelledBy="rulesTitle">
      <SheetHead id="rulesTitle" title="กฎการทำงาน" note={`สวัสดี ${who} โปรดอ่านและปฏิบัติตามกฎทุกครั้ง`} />
      <div className="flex-1 overflow-y-auto text-sm">
        <h3 className="mb-1 font-bold">การมาสาย</h3>
        {rate ? <p className="mb-2 text-xs text-muted">ตัวเลขบาทคิดจาก slot {slotHours} ชม. ตามค่าจ้างของคุณ {money(rate)} บาท/ชม.</p> : null}
        <ul className="mb-4 space-y-1.5">
          {LATE_TIERS.map((t) => (
            <li key={t.label} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <span>{t.label}</span>
              <span className={`${pill} ${!t.cut ? "bg-ok/15 text-ok" : t.cut < 0.5 ? "bg-warn-bg text-warn-ink" : "bg-err/15 text-err"}`}>
                {t.cut ? `หัก ${Math.round(t.cut * 100)}%` : "ไม่หัก"}
                {t.cut && rate ? ` (−${money(rate * slotHours * t.cut)})` : ""}
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mb-1 font-bold">ไลฟ์ชดเชย (ไลฟ์ต่อแทนคนถัดไปที่มาสาย)</h3>
        <p className="mb-2 text-xs text-muted">
          ได้เงินเพิ่มตามค่าจ้าง/ชม.{rate ? ` ของคุณ ${money(rate)} บาท` : ""} · เกิน 1 ชม. = ชั่วโมงเต็ม + เศษคิดตามขั้นเดียวกัน
          {mine?.hasCommit ? " · ถ้าเดือนนั้นถึงขั้น Commit ใช้ราคาตาม Commit" : ""}
        </p>
        <ul className="mb-4 space-y-1.5">
          {BONUS_TIERS.map((t) => (
            <li key={t.label} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <span>{t.label}</span>
              <span className={`${pill} bg-ok/15 text-ok`}>
                ได้ {t.share}{rate ? ` (+${money(rate * t.hours)})` : ""}
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mb-2 font-bold">อื่นๆ</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {items.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" className={btn.primary} onClick={onClose}>รับทราบ</button>
      </div>
    </Sheet>
  );
}
