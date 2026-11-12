"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChangeBadge } from "@/components/LiveCharts";
import { CountUp } from "@/components/motion";
import { cn } from "@/lib/utils";

/**
 * การ์ดตัวเลข (หน้าแรก / สถิติไลฟ์ / Cost) แบบคลิปตัวอย่างที่ผู้ใช้ส่งมา 2026-11-12
 *   ไอคอนในวงกลม + ชื่อ · ป้าย ▲▼% มุมขวาบน · ตัวเลขนับขึ้น · บรรทัดบอกว่าเทียบกับอะไร · เส้นแนวโน้มเล็กด้านล่าง
 *   ทยอยขึ้นตามลำดับ (index) และลอยตอนชี้เมาส์ (globals.css .rise / .lift)
 */

export type KpiChange = { cur: number | null; prev: number | null; neutral?: boolean; goodDown?: boolean };

export function KpiCard({ icon: Icon, label, note, value, format, unit, empty, change, children, spark, index = 0, className }: {
  icon?: LucideIcon;
  label: ReactNode;
  /** ใต้ชื่อ เช่น "เฉพาะ TikTok" */
  note?: ReactNode;
  value: number | null;
  format: (n: number) => string;
  unit?: string;
  /** แสดงแทนตัวเลขเมื่อไม่มีค่า */
  empty?: ReactNode;
  change?: KpiChange | null;
  /** บรรทัดใต้ตัวเลข: เทียบกับอะไร / หมายเหตุ */
  children?: ReactNode;
  /** ค่าตามลำดับเวลา (รายวัน / รายเดือน) ไม่มีค่า = null */
  spark?: (number | null)[];
  index?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("@container rise lift flex min-w-0 flex-col rounded-2xl border bg-card p-3", className)}
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
    >
      {/* แถวบน: ไอคอน (ซ้าย) + ป้าย % (ขวา) · ชื่ออยู่บรรทัดถัดไปเต็มความกว้าง — การ์ดแคบแค่ไหนชื่อกับป้ายก็ไม่ทับกัน (เดิมอยู่แถวเดียวกันแล้วทับ) */}
      <div className="flex items-start justify-between gap-2">
        {Icon ? (
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-primary [&_svg]:size-4">
            <Icon />
          </span>
        ) : <span />}
        {change ? <ChangeBadge {...change} /> : null}
      </div>
      <span className="mt-2 block text-xs leading-tight text-muted-foreground">
        {label}
        {note ? <span className="block text-[11px] opacity-80">{note}</span> : null}
      </span>
      {/* การ์ดแคบ (ต่ำกว่า 11rem) ตัวเลขเล็กลงหนึ่งขั้น ยอดเงิน 7 หลักไม่ล้นการ์ด */}
      <div className="mt-0.5 text-lg leading-tight font-bold @[11rem]:text-xl">
        {value === null ? <span className="text-muted-foreground">{empty ?? "–"}</span> : <CountUp value={value} format={format} />}
        {unit && value !== null ? <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span> : null}
      </div>
      {children ? <div className="mt-0.5 text-xs leading-snug">{children}</div> : null}
      {spark ? <Sparkline values={spark} className="mt-auto pt-2" /> : null}
    </div>
  );
}

/** ความกว้างจริงของกล่อง (วาดเส้นเป็นพิกเซลจริง เส้นจึงหนาเท่ากันทุกทิศ) */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * เส้นแนวโน้มเล็กในการ์ด (ไม่มีแกน — ตัวเลขจริงอยู่ในการ์ด / กราฟด้านล่างของหน้า)
 *   ช่องที่ไม่มีค่าลากข้าม · ค่าน้อยกว่า 2 จุด = ไม่วาด · เส้นวาดจากซ้ายไปขวา + พื้นไล่สีจางเข้า
 */
export function Sparkline({ values, color = "var(--viz-cur)", height = 30, className }: {
  values: (number | null)[]; color?: string; height?: number; className?: string;
}) {
  const [ref, width] = useWidth();
  const gid = `spark${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const pts = values.flatMap((v, i) => (v === null || !Number.isFinite(v) ? [] : [[i, v] as const]));
  // กล่องอยู่เสมอ (วัดความกว้างได้ตั้งแต่แรก) แค่ไม่วาดเมื่อจุดไม่พอ
  if (pts.length < 2) return <div ref={ref} aria-hidden />;
  const nums = pts.map((p) => p[1]);
  const max = Math.max(...nums), min = Math.min(0, ...nums);
  const n = values.length;
  const x = (i: number) => 1 + (n > 1 ? (i / (n - 1)) * (width - 2) : (width - 2) / 2);
  const y = (v: number) => 2 + (height - 4) * (1 - (v - min) / (max - min || 1));
  const line = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const [last] = pts.slice(-1);
  return (
    <div ref={ref} className={cn("w-full", className)} aria-hidden>
      {width > 0 ? (
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.22} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${line}L${x(last[0]).toFixed(1)},${height}L${x(pts[0][0]).toFixed(1)},${height}Z`} fill={`url(#${gid})`} className="fade-in" />
          <path d={line} pathLength={1} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" className="line-draw" />
          <circle cx={x(last[0])} cy={y(last[1])} r={2.5} fill={color} className="dot-pop" />
        </svg>
      ) : <div style={{ height }} />}
    </div>
  );
}
