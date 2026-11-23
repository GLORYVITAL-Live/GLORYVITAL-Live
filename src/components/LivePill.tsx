import { cn } from "@/lib/utils";

/**
 * ป้าย "● กำลังไลฟ์ N ช่อง" จุดแดงกระพริบ (ผู้ใช้ขอ 2026-11-23 ตามคลิป "live now") — นับจากเวลาในตารางคิว ไม่ใช่สถานะสดจากแพลตฟอร์ม
 *   ไฟล์แยก ไม่มีไลบรารี motion (หัวเว็บโหลดทุกหน้า) · จุดกระพริบ = globals.css .live-dot
 *   onClick = ไปดูรายการคิวที่กำลังไลฟ์ · compact = มือถือ แสดงแค่จุด + ตัวเลข
 */
export function LivePill({ n, onClick, compact = false, className }: { n: number; onClick?: () => void; compact?: boolean; className?: string }) {
  const text = `กำลังไลฟ์ ${n} ช่อง`;
  const body = (
    <>
      <span aria-hidden className="live-dot size-2 shrink-0 rounded-full bg-destructive" />
      {compact ? <><span className="sr-only">{text}</span><span aria-hidden>{n}</span></> : text}
    </>
  );
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-foreground tabular-nums shadow-card",
    className,
  );
  return onClick
    ? <button type="button" onClick={onClick} title={text} className={cn(cls, "press cursor-pointer hover:border-primary")}>{body}</button>
    : <span title={text} className={cls}>{body}</span>;
}
