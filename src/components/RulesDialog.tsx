"use client";

import { Sheet, SheetHead, btn } from "@/components/ui";

const CANCEL_MIN_HOURS = 6;

const TIERS = [
  ["สายไม่เกิน 5 นาที", "ไม่หัก", "bg-ok/15 text-ok"],
  ["สาย 5 – 30 นาที", "หัก 30%", "bg-warn-bg text-warn-ink"],
  ["สายเกิน 30 นาที ถึง 1 ชั่วโมง", "หัก 50%", "bg-err/15 text-err"],
] as const;

/** กฎการทำงาน (เด้งวันละครั้งหลัง login และเปิดดูได้จาก "ตารางของฉัน") */
export function RulesDialog({ open, onClose, role, who }: {
  open: boolean;
  onClose: () => void;
  role: "mc" | "admin";
  who: string;
}) {
  const items: string[] = role === "mc"
    ? [
        `ยกเลิกคิวผ่านเว็บได้ก่อนเวลาไลฟ์อย่างน้อย ${CANCEL_MIN_HOURS} ชั่วโมง และต้องทักแชทแจ้งแอดมินทุกครั้ง`,
        `ถ้าเหลือน้อยกว่า ${CANCEL_MIN_HOURS} ชั่วโมง ยกเลิกผ่านเว็บไม่ได้ ต้องติดต่อแอดมินโดยตรง`,
      ]
    : [
        "รับได้สูงสุด 4 slot (8 ชม.) ต่อวัน แบ่งได้ไม่เกิน 2 ช่วง (ช่วง = slot ที่ต่อกัน) และเวลาห้ามทับกันแม้คนละแพลตฟอร์ม",
        `Admin เสริม ยกเลิกคิวผ่านเว็บได้ก่อนเวลาไลฟ์อย่างน้อย ${CANCEL_MIN_HOURS} ชั่วโมง (ใน "ตารางของฉัน") และต้องทักแชทแจ้งแอดมินทุกครั้ง`,
        `ถ้าเหลือน้อยกว่า ${CANCEL_MIN_HOURS} ชั่วโมง หรือเป็น Admin ประจำ ต้องติดต่อทีมงานโดยตรง`,
      ];
  items.push("ปฏิทิน Google จะแจ้งเตือนก่อนไลฟ์ 1 วัน และก่อนไลฟ์ 10 นาที (ตั้งค่าการแจ้งเตือนในปฏิทินของตัวเองตามที่ทีมงานแนะนำ)");

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
