"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetHead, api, btn } from "@/components/ui";
import { LATE_TIERS } from "@/lib/pay";
import { defaultRules } from "@/lib/rules";

// กฎมาสายมาจาก src/lib/pay.ts (ตัวเดียวกับที่ใช้คิดเงิน)
const TIERS = LATE_TIERS.map((t) => [
  t.label,
  t.cut ? `หัก ${Math.round(t.cut * 100)}%` : "ไม่หัก",
  !t.cut ? "bg-ok/15 text-ok" : t.cut < 0.5 ? "bg-warn-bg text-warn-ink" : "bg-err/15 text-err",
] as const);

/** กฎการทำงาน (เด้งวันละครั้งหลัง login และเปิดดูได้จาก "ตารางของฉัน") */
export function RulesDialog({ open, onClose, role, who }: {
  open: boolean;
  onClose: () => void;
  role: "mc" | "admin";
  who: string;
}) {
  // ส่วน "อื่นๆ" Owner แก้ได้ผ่านเว็บ (ระหว่างโหลดแสดงข้อความเริ่มต้น)
  const [loaded, setLoaded] = useState<{ role: string; items: string[] } | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<{ items: string[] }>(`/api/rules?role=${role}`)
      .then((res) => { if (alive && res.ok) setLoaded({ role, items: res.items }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, role]);
  const items = loaded?.role === role ? loaded.items : defaultRules(role);

  return (
    <Sheet open={open} onClose={onClose} labelledBy="rulesTitle">
      <SheetHead id="rulesTitle" title="กฎการทำงาน" note={`สวัสดี ${who} โปรดอ่านและปฏิบัติตามกฎทุกครั้ง`} />
      <div className="flex-1 overflow-y-auto text-sm">
        <h3 className="mb-2 font-bold">การมาสาย</h3>
        <ul className="mb-4 space-y-1.5">
          {TIERS.map(([time, cut, cls]) => (
            <li key={time} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <span>{time}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{cut}</span>
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
