"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LazyMotion, MotionConfig, animate, domAnimation, m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * แอนิเมชันของหน้าแดชบอร์ด (หน้าแรก / สถิติไลฟ์) — ใช้เฉพาะหน้าที่โหลดแยก (dynamic) หน้าจองคิวจึงไม่ต้องโหลดไลบรารีนี้
 *   เครื่องที่ตั้ง "ลดการเคลื่อนไหว" = ไม่เลื่อน / ไม่นับตัวเลข (MotionConfig reducedMotion="user" + useReducedMotion)
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** ค่อยๆ ขึ้น + เลื่อนขึ้นเล็กน้อยตอนแสดงครั้งแรก · index = ลำดับในกลุ่ม (ทยอยทีละใบ) */
export function Reveal({ children, index = 0, className }: { children: ReactNode; index?: number; className?: string }) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 10) * 0.04, ease: EASE }}
    >
      {children}
    </m.div>
  );
}

/** ตัวเลขนับขึ้นจากค่าเดิม (ครั้งแรกนับจาก 0) · format = รูปแบบที่แสดง */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) {
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.8, ease: EASE,
      onUpdate: (n) => { from.current = n; setShown(n); },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return <span className={cn("tabular-nums", className)}>{format(reduce ? value : shown)}</span>;
}
