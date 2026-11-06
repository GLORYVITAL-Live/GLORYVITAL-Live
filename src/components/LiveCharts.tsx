"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { changeOf } from "@/lib/live-stats";
import { cn } from "@/lib/utils";

// กราฟของหน้าสถิติไลฟ์ (SVG ล้วน): สีจาก --viz-cur / --viz-prev ใน globals.css

/** faded = แท่งที่ยังไม่ใช่ตัวเลขจริง (เช่น คิวที่จองไว้ข้างหน้า) วาดสีจางของชุดเดียวกัน — ใส่ใน Legend ด้วย fadedColor() */
export type Series = { name: string; color: string; values: (number | null)[]; faded?: boolean[] };

/** สีจางของชุด (แท่งที่ faded + จุดใน Legend ใช้สีเดียวกัน) */
export const fadedColor = (color: string) => `color-mix(in srgb, ${color} 38%, transparent)`;

/** ความกว้างจริงของกล่อง (กราฟวาดตามจอ ตัวหนังสือไม่ย่อตาม) */
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

/** ค่าสูงสุดของแกนแบบปัดเลขสวย + เส้นแบ่ง 4 ช่อง */
function niceTicks(max: number) {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

/** แท่งปลายมน 4px ด้านบน ฐานเรียบติดแกน */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** line = กราฟเส้น (สัญลักษณ์เป็นเส้นตามเส้นในกราฟ) */
export function Legend({ series, line = false }: { series: Pick<Series, "name" | "color">[]; line?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <span className={line ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]"} style={{ background: s.color }} aria-hidden />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/**
 * กราฟแท่งแนวตั้ง 1–2 ชุด (ชุดที่ 2 = ช่วงเทียบ) ชี้ที่กลุ่มเพื่อดูตัวเลข
 *   highlight = ลำดับกลุ่มที่เน้น (ชุดเดียว: กลุ่มอื่นจางลง)
 */
export function BarChart({ categories, tooltipTitles, series, format, formatAxis, highlight, height = 220, label }: {
  categories: string[];
  /** หัวข้อในกล่องตัวเลข (ไม่ใส่ = ใช้ชื่อแกน) */
  tooltipTitles?: string[];
  series: Series[];
  format: (v: number | null) => string;
  formatAxis: (v: number) => string;
  highlight?: number;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = categories.length;
  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;

  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const groupW = n ? plotW / n : 0;
  const k = series.length;
  const gap = 2;
  const barW = Math.max(2, Math.min(28, (groupW * 0.72 - gap * (k - 1)) / k));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  // ป้ายแกนล่างเบียดกัน = แสดงเว้นช่อง
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));

  return (
    <div ref={ref} className="relative w-full select-none" onMouseLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-muted-foreground/40" : "stroke-border"} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{formatAxis(t)}</text>
            </g>
          ))}
          {categories.map((c, i) => {
            const gx = pad.l + i * groupW;
            const inner = barW * k + gap * (k - 1);
            const dim = (hover !== null && hover !== i) || (hover === null && highlight !== undefined && k === 1 && highlight !== i);
            return (
              <g key={i}>
                {hover === i ? <rect x={gx} y={pad.t} width={groupW} height={plotH} className="fill-muted" /> : null}
                {series.map((s, j) => {
                  const v = s.values[i];
                  if (v === null || v <= 0) return null;
                  const bx = gx + (groupW - inner) / 2 + j * (barW + gap);
                  // แท่งโตขึ้นจากแกนตอนข้อมูลมาถึง ทยอยจากซ้าย (ลดการเคลื่อนไหว = ไม่โต · globals.css .bar-grow)
                  return (
                    <path
                      key={j} d={barPath(bx, y(v), barW, y(0) - y(v))} fill={s.faded?.[i] ? fadedColor(s.color) : s.color} opacity={dim ? 0.45 : 1}
                      className="bar-grow" style={{ animationDelay: `${Math.min(i * 12, 360)}ms` }}
                    />
                  );
                })}
                {i % every === 0 ? (
                  <text x={gx + groupW / 2} y={height - 8} textAnchor="middle" className={cn("fill-muted-foreground text-[11px]", highlight === i && "fill-foreground font-semibold")}>
                    {c}
                  </text>
                ) : null}
                {/* พื้นที่ชี้ใหญ่กว่าแท่ง */}
                <rect x={gx} y={pad.t} width={groupW} height={plotH + pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      ) : <div style={{ height }} />}
      {hover !== null && width > 0 ? (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border bg-popover px-2.5 py-2 text-xs shadow-card"
          style={pad.l + (hover + 0.5) * groupW > width / 2
            ? { right: width - (pad.l + hover * groupW) + 6 }
            : { left: pad.l + (hover + 1) * groupW + 6 }}
        >
          <div className="mb-1 font-semibold">{tooltipTitles?.[hover] ?? categories[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />{s.name}
              </span>
              <span className="font-semibold tabular-nums">{format(s.values[hover])}</span>
            </div>
          ))}
          {k === 2 ? <ChangeText cur={series[0].values[hover]} prev={series[1].values[hover]} className="mt-1 block text-right" /> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * กราฟเส้นแนวโน้ม 1 แกน · ชี้ / แตะตรงไหนก็ได้ เส้นตั้งจะจับวันที่ใกล้สุด แล้วแสดงค่าทุกเส้นของวันนั้น (ทุกค่าต้องมีตารางคู่กันด้วย)
 *   ค่าที่ไม่มี = เส้นขาด ไม่ลากข้าม · จุดเดี่ยวที่ไม่มีเพื่อนบ้านวาดเป็นจุดให้เห็น · หลายเส้น = ป้ายชื่อปลายเส้น (ปลายเส้นเบียดกัน = เหลือแค่ Legend)
 *   เส้นวาดจากซ้ายไปขวา (ลดการเคลื่อนไหว = ไม่ขยับ · globals.css .line-draw / .dot-pop)
 */
export function LineChart({ categories, tooltipTitles, series, format, formatAxis, height = 260, label }: {
  categories: string[];
  tooltipTitles?: string[];
  series: Pick<Series, "name" | "color" | "values">[];
  format: (v: number | null) => string;
  formatAxis: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = categories.length;
  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const top = ticks[ticks.length - 1] || 1;
  const pad = { l: 52, r: series.length > 1 ? 56 : 12, t: 10, b: 26 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));

  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = Math.min(n - 1, Math.max(0, n > 1 ? Math.round(((px - pad.l) / plotW) * (n - 1)) : 0));
    // วันที่ไม่มีค่าเลย (เช่น วันที่ยังไม่ถึง) ไม่ต้องแสดงกล่องตัวเลข
    setHover(series.some((s) => s.values[i] !== null) ? i : null);
  };
  /** เส้นต่อเนื่องเป็นช่วงๆ (ขาดตรงที่ไม่มีค่า) */
  const pathOf = (values: (number | null)[]) => {
    const parts: string[] = [];
    let open = false;
    values.forEach((v, i) => {
      if (v === null) { open = false; return; }
      parts.push(`${open ? "L" : "M"}${x(i)},${y(v)}`);
      open = true;
    });
    return parts.join("");
  };
  const lastOf = (values: (number | null)[]) => values.reduce<number>((a, v, i) => (v === null ? a : i), -1);
  // ป้ายปลายเส้น: ปลายเส้นห่างกันไม่ถึง 14px = ป้ายทับกัน ไม่แสดง (Legend + กล่องตัวเลขบอกอยู่แล้ว)
  const ends = series.map((s) => ({ s, i: lastOf(s.values) }));
  const endLabels = series.length > 1 && ends.every(({ s, i }, k) => ends.every((o, j) => j === k
    || Math.abs(x(i) - x(o.i)) > 60 || Math.abs(y(s.values[i] ?? 0) - y(o.s.values[o.i] ?? 0)) >= 14));

  return (
    <div ref={ref} className="relative w-full select-none">
      {width > 0 ? (
        <svg
          width={width} height={height} role="img" aria-label={label} className="block overflow-visible" style={{ touchAction: "pan-y" }}
          onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-muted-foreground/40" : "stroke-border"} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{formatAxis(t)}</text>
            </g>
          ))}
          {categories.map((c, i) => (i % every === 0 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">{c}</text>
          ) : null))}
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + plotH} className="stroke-muted-foreground/50" strokeWidth={1} /> : null}
          {series.map((s) => (
            <path key={s.name} d={pathOf(s.values)} pathLength={1} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="line-draw" />
          ))}
          {series.flatMap((s) => s.values.map((v, i) => {
            const alone = v !== null && (s.values[i - 1] ?? null) === null && (s.values[i + 1] ?? null) === null;
            const end = i === lastOf(s.values);
            if (v === null || (!alone && !end && hover !== i)) return null;
            return <circle key={`${s.name}|${i}`} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={s.color} stroke="var(--card)" strokeWidth={2} className={hover === i ? undefined : "dot-pop"} />;
          }))}
          {endLabels ? ends.map(({ s, i }) => (i < 0 ? null : (
            <text key={s.name} x={x(i) + 8} y={y(s.values[i]!)} dy="0.32em" className="fill-foreground text-[11px] font-semibold">{s.name}</text>
          ))) : null}
        </svg>
      ) : <div style={{ height }} />}
      {hover !== null && width > 0 ? (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border bg-popover px-2.5 py-2 text-xs shadow-card"
          style={x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }}
        >
          <div className="mb-1 font-semibold">{tooltipTitles?.[hover] ?? categories[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />{s.name}
              </span>
              <span className="font-semibold tabular-nums">{format(s.values[hover])}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ▲ 12.3% / ▼ 4.0% (ไม่มีฐานเทียบ = ข้อความแจ้ง)
 *   neutral = ขึ้น / ลงไม่ได้แปลว่าดี / แย่ (เช่น ค่าจ้างรวม) ใช้สีเทา · goodDown = ลดลงคือดี (เช่น ค่าจ้างต่อยอดขาย)
 */
export function ChangeText({ cur, prev, suffix, className, neutral = false, goodDown = false }: {
  cur: number | null; prev: number | null; suffix?: ReactNode; className?: string; neutral?: boolean; goodDown?: boolean;
}) {
  const c = changeOf(cur, prev);
  if (c === null) return <span className={cn("text-xs text-muted-foreground", className)}>ไม่มีข้อมูลเทียบ{suffix ? <> {suffix}</> : null}</span>;
  const up = c > 0, flat = Math.abs(c) < 0.0005;
  const Icon = up ? ArrowUpIcon : ArrowDownIcon;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums", flat || neutral ? "text-muted-foreground" : up !== goodDown ? "text-success" : "text-destructive", className)}>
      {flat ? null : <Icon className="size-3" aria-label={up ? "เพิ่มขึ้น" : "ลดลง"} />}
      {flat ? "เท่าเดิม" : `${(Math.abs(c) * 100).toFixed(1)}%`}
      {suffix ? <span className="font-normal text-muted-foreground">&nbsp;{suffix}</span> : null}
    </span>
  );
}

/** การ์ดเทียบตัวชี้วัด: แท่งแนวนอน ช่วงนี้ vs ช่วงก่อน (ยาวตามค่าที่มากกว่า) */
export function PairBars({ label, note, cur, prev, format, curName, prevName }: {
  label: string;
  note?: string;
  cur: number | null;
  prev: number | null;
  format: (v: number | null) => string;
  curName: string;
  prevName: string;
}) {
  const max = Math.max(cur ?? 0, prev ?? 0) || 1;
  const rows = [[curName, cur, "var(--viz-cur)"], [prevName, prev, "var(--viz-prev)"]] as const;
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <ChangeText cur={cur} prev={prev} />
      </div>
      {note ? <div className="text-[11px] text-muted-foreground">{note}</div> : null}
      <div className="mt-2 space-y-1.5">
        {rows.map(([name, v, color]) => (
          <div key={name} className="grid grid-cols-[1fr_auto] items-center gap-2">
            <div className="h-3 rounded-r-[4px] bg-muted" title={name}>
              <div className="bar-fill h-full rounded-r-[4px]" style={{ width: `${((v ?? 0) / max) * 100}%`, background: color }} />
            </div>
            <span className="min-w-20 text-right text-xs tabular-nums">{format(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
