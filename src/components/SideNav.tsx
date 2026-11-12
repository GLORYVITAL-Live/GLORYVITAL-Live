"use client";

import { useEffect, useRef, useState } from "react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, type LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

/**
 * เมนูด้านซ้ายบนจอคอม (ตั้งแต่ 1024px · เฟส 3 ตามคลิปตัวอย่าง 2026-11-12) — จอเล็กกว่านั้นใช้แถบบน / แถบล่างเดิม
 *   จัดกลุ่มหน้า · พื้นชมพูอ่อนเลื่อนตามหน้าที่เลือก · ป้ายตัวเลขงานค้าง (src/lib/badges.ts)
 *   ย่อเหลือไอคอนได้ (จำไว้ในเครื่อง) · ย่อแล้วป้ายตัวเลขเป็นจุดบนไอคอน + ชื่อหน้าอยู่ใน tooltip
 */

export type SideItem = { id: string; label: string; icon: LucideIcon; badge?: number; badgeTitle?: string; group: string };

export const SIDE_W = { open: 240, closed: 72 } as const;

export function SideNav({ items, active, onPick, collapsed, onToggle }: {
  items: SideItem[];
  active: string | null;
  onPick: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  // วัดตำแหน่งปุ่มที่เลือก (ResizeObserver เรียกครั้งแรกทันทีที่เริ่มดู + ทุกครั้งที่เมนูเปลี่ยนขนาด เช่น ย่อ / ขยาย)
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const on = el.querySelector<HTMLElement>('[aria-current="page"]');
      setPill(on ? { top: on.offsetTop, height: on.offsetHeight } : null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, items.length, collapsed]);

  const groups = [...new Set(items.map((i) => i.group))];
  const labelled = items.length > 4 && groups.length > 1;

  return (
    <aside
      aria-label="เมนูหลัก"
      className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-card transition-[width] duration-300 ease-out motion-reduce:transition-none lg:flex"
      style={{ width: collapsed ? SIDE_W.closed : SIDE_W.open }}
    >
      {/* หัวเมนู: โลโก้ (สูงเท่าปุ่มย่อ) + ปุ่มย่อ · เส้นคั่นก่อนรายการเมนู (ไม่มีชื่อหน้าใต้โลโก้ — ซ้ำกับเมนูที่เลือกอยู่) */}
      <div className={cn("mb-3 flex h-16 shrink-0 items-center gap-2 border-b", collapsed ? "justify-center px-2" : "justify-between pr-3 pl-5")}>
        {collapsed ? null : <BrandLogo className="h-7 sm:h-7" />}
        <button
          type="button" onClick={onToggle}
          aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"} title={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[18px]"
        >
          {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
        </button>
      </div>

      <nav aria-label="เมนูหน้า" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div ref={list} className="relative">
          {pill ? (
            <span
              aria-hidden className="absolute inset-x-0 rounded-xl bg-tint transition-[top,height] duration-300 ease-out motion-reduce:transition-none"
              style={{ top: pill.top, height: pill.height }}
            />
          ) : null}
          {groups.map((g, gi) => (
            <div key={g} className={cn(gi > 0 && "mt-3")}>
              {labelled ? (
                collapsed
                  ? (gi > 0 ? <div aria-hidden className="mx-2 mb-3 border-t" /> : null)
                  : <div className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/80">{g}</div>
              ) : null}
              {items.filter((i) => i.group === g).map((i) => {
                const on = i.id === active;
                const Icon = i.icon;
                const count = i.badge ?? 0;
                return (
                  <button
                    key={i.id} type="button" onClick={() => onPick(i.id)} aria-current={on ? "page" : undefined}
                    title={collapsed ? `${i.label}${count ? ` · ${i.badgeTitle ?? "งานค้าง"} ${count}` : ""}` : count ? `${i.badgeTitle ?? "งานค้าง"} ${count}` : undefined}
                    className={cn(
                      "press relative mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-xl py-2 text-sm font-semibold transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0",
                      collapsed ? "justify-center px-0" : "px-3",
                      on ? cn("text-tint-foreground", !pill && "bg-tint") : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="relative">
                      <Icon />
                      {collapsed && count ? <span aria-hidden className="absolute -top-1 -right-1.5 size-2 rounded-full bg-primary ring-2 ring-card" /> : null}
                    </span>
                    {collapsed ? <span className="sr-only">{i.label}</span> : <span className="min-w-0 flex-1 truncate text-left">{i.label}</span>}
                    {!collapsed && count ? <CountBadge n={count} /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}

/** ป้ายตัวเลขงานค้าง (99+ เมื่อมากกว่า 99) */
export function CountBadge({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-primary px-1 text-[11px] leading-none font-semibold text-primary-foreground tabular-nums", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
