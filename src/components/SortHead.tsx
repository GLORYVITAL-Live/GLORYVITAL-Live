"use client";

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------- เรียงตาราง (กดหัวคอลัมน์) ----------

export type SortState = { key: string; desc: boolean } | null;

/** เรียงแถว: ค่าว่าง (null) อยู่ท้ายเสมอ ไม่ว่าจะเรียงทางไหน */
export function sortRows<T>(rows: T[], sort: SortState, value: (r: T, key: string) => number | string | null): T[] {
  if (!sort) return rows;
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = value(a, sort.key), y = value(b, sort.key);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (typeof x === "string" ? x.localeCompare(String(y), "th") : x - (y as number)) * dir;
  });
}

/** หัวคอลัมน์กดเรียง: ครั้งแรก = มากไปน้อย (ชื่อ = ก–ฮ) / ครั้งที่สอง = กลับด้าน / ครั้งที่สาม = ลำดับเดิม */
export function SortHead({ k, label, sort, setSort, text = false, className }: {
  k: string; label: string; sort: SortState; setSort: (s: SortState) => void; text?: boolean; className?: string;
}) {
  const active = sort?.key === k;
  const firstDesc = !text;
  const next = () => setSort(!active ? { key: k, desc: firstDesc } : sort.desc === firstDesc ? { key: k, desc: !firstDesc } : null);
  const Icon = !active ? ArrowUpDownIcon : sort.desc ? ArrowDownIcon : ArrowUpIcon;
  return (
    <TableHead
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}
      className={cn("px-3 text-xs font-semibold text-muted-foreground", !text && "text-right", className)}
    >
      <button
        type="button"
        onClick={next}
        title="กดเพื่อเรียง (มากไปน้อย / น้อยไปมาก / ลำดับเดิม)"
        className={cn("inline-flex cursor-pointer items-center gap-0.5 whitespace-nowrap hover:text-foreground", active && "text-primary")}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </TableHead>
  );
}
