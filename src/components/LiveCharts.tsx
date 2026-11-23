"use client";

import { Fragment, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { changeOf } from "@/lib/live-stats";
import { cn } from "@/lib/utils";

// กราฟของหน้าสถิติไลฟ์ / Cost (SVG ล้วน): สีจาก --viz-* / --cost-* ใน globals.css

/** ตารางใต้กราฟ: พับไว้ กดดูเมื่อต้องการตัวเลขละเอียด */
export function TableView({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="group/tv mt-2">
      <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 rounded text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:py-2">
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/tv:rotate-180" />{title}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * faded = แท่งที่ยังไม่ใช่ตัวเลขจริง (เช่น คิวที่จองไว้ข้างหน้า) วาดสีจางของชุดเดียวกัน — ใส่ใน Legend ด้วย fadedColor()
 * stack = ชื่อกองของแท่งซ้อน (เช่น TikTok / Shopee): หลายกอง = วางแท่งซ้อนคู่กันในแต่ละกลุ่ม
 */
export type Series = {
  name: string; color: string; values: (number | null)[]; faded?: boolean[]; stack?: string;
  /** กราฟเส้น: เส้นประ (ช่วงก่อนที่เทียบ) · area = พื้นไล่สีใต้เส้น (ช่วงนี้) */
  dash?: boolean; area?: boolean;
};

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

/** สัญลักษณ์เส้นใน Legend / กล่องตัวเลข · dash = เส้นประ */
function LineSwatch({ color, dash, className }: { color: string; dash?: boolean; className?: string }) {
  return dash
    ? <span className={cn("h-0 w-3.5 border-t-2 border-dashed", className)} style={{ borderColor: color }} aria-hidden />
    : <span className={cn("h-0.5 w-3.5 rounded-full", className)} style={{ background: color }} aria-hidden />;
}

/** สีพื้นสัญลักษณ์ลายทแยง (แท่งที่ตัวเลขยังไม่จบ) — ลายเดียวกับในกราฟ */
const HATCH_BG = "repeating-linear-gradient(135deg, var(--muted-foreground) 0 1.5px, transparent 1.5px 4px)";

/**
 * line = กราฟเส้น (สัญลักษณ์เป็นเส้นตามเส้นในกราฟ · ชุดที่ dash = เส้นประ)
 *   hatch = ความหมายของแท่งลายทแยงในกราฟนี้ (เช่น "ยังไม่จบเดือน") · avg = ความหมายของเส้นประแนวนอน
 */
export function Legend({ series, line = false, hatch, avg }: {
  series: (Pick<Series, "name" | "color"> & { dash?: boolean })[]; line?: boolean; hatch?: string; avg?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          {line ? <LineSwatch color={s.color} dash={s.dash} /> : <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />}
          {s.name}
        </span>
      ))}
      {hatch ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] border border-muted-foreground/50" style={{ background: HATCH_BG }} aria-hidden />{hatch}
        </span>
      ) : null}
      {avg ? <span className="inline-flex items-center gap-1.5"><LineSwatch color="var(--muted-foreground)" dash />{avg}</span> : null}
    </div>
  );
}

/**
 * กราฟแท่งแนวตั้ง 1–2 ชุด (ชุดที่ 2 = ช่วงเทียบ) ชี้ที่กลุ่มเพื่อดูตัวเลข
 *   highlight = ลำดับกลุ่มที่เน้น (ชุดเดียว: กลุ่มอื่นจางลง)
 *   stacked = แท่งเดียวซ้อนทุกชุด (ใช้กับค่าที่บวกกันได้เท่านั้น) กล่องตัวเลขบอกสัดส่วน + ยอดรวม
 *     ชุดมี stack หลายค่า = แท่งซ้อนวางคู่กัน (ตามลำดับที่เจอ) แต่ละแท่งซ้อนเฉพาะชุดของกองตัวเอง กล่องตัวเลขแยกกอง + ยอดต่อกอง
 *   compare = false: 2 ชุดไม่ใช่ช่วงที่เทียบกัน (เช่น TikTok / Shopee) กล่องตัวเลขไม่แสดง % ที่เปลี่ยน
 *   hatched = กลุ่มที่ตัวเลขยังไม่จบ (เดือนที่ยังไม่จบ / มี Forecast) วาดลายทแยงทับแท่ง · avg = เส้นประค่าเฉลี่ย + ป้าย
 *   extra = บรรทัดเพิ่มท้ายกล่องตัวเลขของกลุ่มนั้น (เช่น จำนวนไลฟ์ · MoM)
 */
export function BarChart({ categories, tooltipTitles, series, format, formatAxis, highlight, height = 220, label, stacked = false, compare = true, hatched, avg, extra }: {
  categories: string[];
  /** หัวข้อในกล่องตัวเลข (ไม่ใส่ = ใช้ชื่อแกน) */
  tooltipTitles?: string[];
  series: Series[];
  format: (v: number | null) => string;
  formatAxis: (v: number) => string;
  highlight?: number;
  height?: number;
  label: string;
  stacked?: boolean;
  compare?: boolean;
  hatched?: boolean[];
  avg?: { value: number; label: string } | null;
  extra?: (i: number) => ReactNode;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const hatchId = `hatch${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const n = categories.length;
  const totalAt = (i: number) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0);
  const stacks = stacked ? [...new Set(series.map((s) => s.stack ?? ""))] : [];
  const inStack = (st: string) => series.filter((s) => (s.stack ?? "") === st);
  const stackTotal = (st: string, i: number) => inStack(st).reduce((a, s) => a + (s.values[i] ?? 0), 0);
  const max = stacked
    ? Math.max(0, ...categories.flatMap((_, i) => stacks.map((st) => stackTotal(st, i))))
    : Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;

  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const groupW = n ? plotW / n : 0;
  const k = stacked ? Math.max(1, stacks.length) : series.length;
  const gap = 2;
  // แท่งคู่: ใช้ที่ในกลุ่มมากขึ้น (กราฟรายวันบนมือถือแท่งจะได้ไม่บางเกิน)
  const barW = Math.max(2, Math.min(28, (groupW * (k > 1 ? 0.84 : 0.72) - gap * (k - 1)) / k));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  // ป้ายแกนล่างเบียดกัน = แสดงเว้นช่อง
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));
  /** แถวในกล่องตัวเลข · total > 0 = แสดง % ของยอดนั้นด้วย */
  const tooltipRow = (s: Series, total: number, key: string) => (
    <div key={key} className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />{s.name}
      </span>
      <span className="tabular-nums">
        <span className="font-semibold">{format(s.values[hover ?? 0])}</span>
        {total ? <span className="text-muted-foreground"> · {(((s.values[hover ?? 0] ?? 0) / total) * 100).toFixed(0)}%</span> : null}
      </span>
    </div>
  );

  return (
    <div ref={ref} className="relative w-full select-none" onMouseLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {hatched?.some(Boolean) ? (
            <defs>
              {/* ลายทแยงสีพื้นการ์ด ทับบนแท่งสีเดิม (สีแพลตฟอร์ม / ประเภทยังอ่านออก) */}
              <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={2.4} height={6} fill="var(--card)" opacity={0.6} />
              </pattern>
            </defs>
          ) : null}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-muted-foreground/40" : "stroke-border"} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{formatAxis(t)}</text>
            </g>
          ))}
          {categories.map((c, i) => {
            const hatch = hatched?.[i] ? `url(#${hatchId})` : null;
            const gx = pad.l + i * groupW;
            const inner = barW * k + gap * (k - 1);
            // แท่งซ้อน: ไม่จางตาม highlight (สีแยกแพลตฟอร์มต้องอ่านออกทุกแท่ง) เน้นด้วยชื่อตัวหนาแทน
            const dim = (hover !== null && hover !== i) || (hover === null && highlight !== undefined && k === 1 && !stacked && highlight !== i);
            // ส่วนของแต่ละชุดในแท่งซ้อน (ล่าง -> บน) ส่วนบนสุดปลายมน คั่นด้วยช่องว่างสีพื้น 2px
            const partsOf = (list: Series[]) => {
              let base = 0;
              return list.flatMap((s) => {
                const v = s.values[i] ?? 0;
                const from = base;
                base += v;
                return v > 0 ? [{ name: s.name, color: s.color, top: y(from + v), bottom: y(from) }] : [];
              });
            };
            return (
              <g key={i}>
                {hover === i ? <rect x={gx} y={pad.t} width={groupW} height={plotH} className="fill-muted" /> : null}
                {stacked ? stacks.map((st, si) => {
                  const parts = partsOf(inStack(st));
                  const bx = gx + (groupW - inner) / 2 + si * (barW + gap);
                  return (
                    <g key={st} className="bar-grow" opacity={dim ? 0.45 : 1} style={{ animationDelay: `${Math.min(i * 12, 360)}ms` }}>
                      {parts.map((p, j) => {
                        const h = Math.max(1, p.bottom - p.top - (j > 0 ? gap : 0));
                        const d = j === parts.length - 1 ? barPath(bx, p.top, barW, h) : `M${bx},${p.top}h${barW}v${h}h${-barW}Z`;
                        return (
                          <Fragment key={p.name}>
                            <path d={d} fill={p.color} />
                            {hatch ? <path d={d} fill={hatch} /> : null}
                          </Fragment>
                        );
                      })}
                    </g>
                  );
                }) : series.map((s, j) => {
                  const v = s.values[i];
                  if (v === null || v <= 0) return null;
                  const bx = gx + (groupW - inner) / 2 + j * (barW + gap);
                  const d = barPath(bx, y(v), barW, y(0) - y(v));
                  // แท่งโตขึ้นจากแกนตอนข้อมูลมาถึง ทยอยจากซ้าย (ลดการเคลื่อนไหว = ไม่โต · globals.css .bar-grow)
                  return (
                    <g key={j} className="bar-grow" opacity={dim ? 0.45 : 1} style={{ animationDelay: `${Math.min(i * 12, 360)}ms` }}>
                      <path d={d} fill={s.faded?.[i] ? fadedColor(s.color) : s.color} />
                      {hatch ? <path d={d} fill={hatch} /> : null}
                    </g>
                  );
                })}
                {i % every === 0 ? (
                  <text x={gx + groupW / 2} y={height - 8} textAnchor="middle" className={cn("fill-muted-foreground text-[11px]", highlight === i && "fill-foreground font-bold")}>
                    {c}
                  </text>
                ) : null}
                {/* พื้นที่ชี้ใหญ่กว่าแท่ง */}
                <rect x={gx} y={pad.t} width={groupW} height={plotH + pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              </g>
            );
          })}
          {/* เส้นประค่าเฉลี่ย (ทับแท่ง · ไม่รับการชี้ แท่งด้านล่างยังชี้ได้) */}
          {avg && avg.value > 0 && avg.value <= top ? (
            <g className="fade-in pointer-events-none">
              <line x1={pad.l} x2={width - pad.r} y1={y(avg.value)} y2={y(avg.value)} stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={1.25} strokeDasharray="4 4" />
              <text
                x={width - pad.r} y={y(avg.value) - 5} textAnchor="end" stroke="var(--card)" strokeWidth={3} strokeLinejoin="round"
                className="fill-foreground text-[11px] font-semibold tabular-nums" style={{ paintOrder: "stroke" }}
              >
                {avg.label}
              </text>
            </g>
          ) : null}
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
          {stacks.length > 1 ? stacks.map((st) => {
            // แท่งซ้อนหลายกอง: หัวข้อกอง + ยอดกอง แล้วชุดในกอง (% ของกอง)
            const list = inStack(st).filter((s) => s.values[hover] !== null);
            return list.length ? (
              <div key={st} className="mt-1 first:mt-0">
                <div className="flex items-center justify-between gap-3 font-semibold">
                  <span>{st}</span><span className="tabular-nums">{format(stackTotal(st, hover))}</span>
                </div>
                {list.map((s) => tooltipRow(s, stackTotal(st, hover), `${st}|${s.name}`))}
              </div>
            ) : null;
          }) : (stacked ? series.filter((s) => s.values[hover] !== null) : series).map((s) => tooltipRow(s, stacked && series.length > 1 ? totalAt(hover) : 0, s.name))}
          {/* แท่งซ้อน: ชุดที่ไม่มีค่าในกลุ่มนี้ไม่ต้องแสดง (เช่น MCN ที่ไลฟ์แค่บางเดือน) */}
          {stacked && series.length > 1 ? (
            <div className="mt-1 flex items-center justify-between gap-3 border-t pt-1">
              <span className="text-muted-foreground">รวม</span><span className="font-semibold tabular-nums">{format(totalAt(hover))}</span>
            </div>
          ) : null}
          {k === 2 && compare ? <ChangeText cur={series[0].values[hover]} prev={series[1].values[hover]} className="mt-1 block text-right" /> : null}
          {extra ? <div className="mt-1 space-y-0.5 border-t pt-1">{extra(hover)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** บรรทัด "ชื่อ ... ค่า" ในกล่องตัวเลขของกราฟ (ใช้กับ extra) */
export function TipRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{children}</span>
    </div>
  );
}

/**
 * กราฟเส้นแนวโน้ม 1 แกน · ชี้ / แตะตรงไหนก็ได้ เส้นตั้งจะจับวันที่ใกล้สุด แล้วแสดงค่าทุกเส้นของวันนั้น (ทุกค่าต้องมีตารางคู่กันด้วย)
 *   ค่าที่ไม่มี = เส้นขาด ไม่ลากข้าม · จุดเดี่ยวที่ไม่มีเพื่อนบ้านวาดเป็นจุดให้เห็น · หลายเส้น = ป้ายชื่อปลายเส้น (ปลายเส้นเบียดกัน = เหลือแค่ Legend)
 *   เส้นวาดจากซ้ายไปขวา (ลดการเคลื่อนไหว = ไม่ขยับ · globals.css .line-draw / .dot-pop)
 *   compare = 2 เส้นเป็นช่วงที่เทียบกัน (กล่องตัวเลขแสดง % ที่เปลี่ยน)
 *   ชุดที่ dash = เส้นประ (ค่อยๆ วาดผ่าน mask เพราะ line-draw ใช้ dasharray อยู่แล้ว) · area = พื้นไล่สีใต้เส้นจางเข้า
 */
export function LineChart({ categories, tooltipTitles, series, format, formatAxis, height = 260, label, compare = false }: {
  categories: string[];
  tooltipTitles?: string[];
  series: Pick<Series, "name" | "color" | "values" | "dash" | "area">[];
  format: (v: number | null) => string;
  formatAxis: (v: number) => string;
  height?: number;
  label: string;
  compare?: boolean;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const n = categories.length;
  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const top = ticks[ticks.length - 1] || 1;
  // ป้ายปลายเส้นเฉพาะชื่อสั้น (เช่น TikTok) ชื่อช่วงเวลายาวเกินที่ว่างข้างกราฟ ใช้ Legend แทน
  const labelled = series.length > 1 && series.every((s) => s.name.length <= 8);
  const pad = { l: 52, r: labelled ? 56 : 12, t: 10, b: 26 };
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
  /** เส้นเชื่อมทุกจุดที่มีค่า ลากข้ามช่วงที่ไม่มีค่า (เช่น ชั่วโมงที่ไม่มีไลฟ์) · ก่อนจุดแรก / หลังจุดสุดท้ายไม่ลาก */
  const pathOf = (values: (number | null)[]) => values
    .flatMap((v, i) => (v === null ? [] : [`${x(i)},${y(v)}`]))
    .map((p, k) => `${k ? "L" : "M"}${p}`)
    .join("");
  const lastOf = (values: (number | null)[]) => values.reduce<number>((a, v, i) => (v === null ? a : i), -1);
  const painted = [...series].reverse();
  // ป้ายปลายเส้น: ปลายเส้นห่างกันไม่ถึง 14px = ป้ายทับกัน ไม่แสดง (Legend + กล่องตัวเลขบอกอยู่แล้ว)
  const ends = series.map((s) => ({ s, i: lastOf(s.values) }));
  const endLabels = labelled && ends.every(({ s, i }, k) => ends.every((o, j) => j === k
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
          {/* พื้นไล่สีใต้เส้น (ใต้ทุกเส้น) */}
          {series.map((s, k) => {
            const last = lastOf(s.values), first = s.values.findIndex((v) => v !== null);
            if (!s.area || first < 0 || last <= first) return null;
            return (
              <g key={`area${s.name}`} className="fade-in">
                <defs>
                  <linearGradient id={`${uid}a${k}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor={s.color} stopOpacity={0.2} />
                    <stop offset="1" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={`${pathOf(s.values)}L${x(last)},${pad.t + plotH}L${x(first)},${pad.t + plotH}Z`} fill={`url(#${uid}a${k})`} />
              </g>
            );
          })}
          {/* วาดจากเส้นท้าย เส้นแรกอยู่บนสุด: จุดที่ค่ารวมเท่าค่าแพลตฟอร์ม เส้นรวม (ท้ายสุด) จะไม่บังสีแพลตฟอร์ม */}
          {painted.map((s) => {
            const d = pathOf(s.values);
            if (!s.dash) return <path key={s.name} d={d} pathLength={1} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="line-draw" />;
            const mid = `${uid}m${series.indexOf(s)}`;
            return (
              <g key={s.name}>
                <mask id={mid} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
                  <path d={d} pathLength={1} fill="none" stroke="#fff" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" className="line-draw" />
                </mask>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" mask={`url(#${mid})`} />
              </g>
            );
          })}
          {painted.flatMap((s) => s.values.map((v, i) => {
            // จุด = ค่าจริงที่ติดกับช่วงที่ไม่มีค่า (ให้เห็นว่าเส้นตรงนั้นลากข้าม) + จุดท้ายเส้น · ช่วงที่มีค่าติดกันไม่ต้องมีจุด
            const first = s.values.findIndex((c) => c !== null) === i;
            const gapAfter = (s.values[i + 1] ?? null) === null, gapBefore = !first && (s.values[i - 1] ?? null) === null;
            if (v === null || (!gapAfter && !gapBefore && hover !== i)) return null;
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
                <LineSwatch color={s.color} dash={s.dash} className="w-3" />{s.name}
              </span>
              <span className="font-semibold tabular-nums">{format(s.values[hover])}</span>
            </div>
          ))}
          {compare && series.length === 2 ? <ChangeText cur={series[0].values[hover]} prev={series[1].values[hover]} className="mt-1 flex justify-end" /> : null}
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

/**
 * ป้าย % ที่เปลี่ยนแบบเม็ดยา (มุมขวาบนของการ์ดตัวเลข) — สีและความหมายเดียวกับ ChangeText · ไม่มีฐานเทียบ = ไม่แสดง
 *   บอกว่าเทียบกับอะไรในบรรทัดใต้ตัวเลขเสมอ (ป้ายไม่มีคำอธิบายในตัว)
 */
export function ChangeBadge({ cur, prev, neutral = false, goodDown = false, className }: {
  cur: number | null; prev: number | null; neutral?: boolean; goodDown?: boolean; className?: string;
}) {
  const c = changeOf(cur, prev);
  if (c === null) return null;
  const up = c > 0, flat = Math.abs(c) < 0.0005;
  const Icon = up ? ArrowUpIcon : ArrowDownIcon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums",
        flat || neutral ? "bg-muted text-muted-foreground" : up !== goodDown ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive",
        className,
      )}
    >
      {flat ? "เท่าเดิม" : <><Icon className="size-3" aria-label={up ? "เพิ่มขึ้น" : "ลดลง"} />{(Math.abs(c) * 100).toFixed(1)}%</>}
    </span>
  );
}

/**
 * โดนัทสัดส่วน (เช่น GMV แยกกลุ่มผู้ไลฟ์) · ช่องว่างสีพื้นคั่นแต่ละส่วน · ตรงกลาง = ยอดรวม
 *   แต่ละส่วนวาดตามเข็มนาฬิกา (globals.css .donut-arc) · ตัวเลขจริงอยู่ใน legend / ตารางคู่กันเสมอ
 */
export function Donut({ parts, size = 112, label, center, sub }: {
  parts: { key: string; value: number; color: string }[];
  size?: number;
  label: string;
  center?: ReactNode;
  sub?: ReactNode;
}) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const stroke = 14, r = (size - stroke) / 2;
  // ช่องว่างระหว่างส่วน (หน่วย pathLength 100) · ส่วนเดียว = วงเต็มไม่เว้น
  const shown = parts.filter((p) => p.value > 0);
  const gap = shown.length > 1 ? 1.2 : 0;
  let at = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        {total > 0 ? shown.map((p, i) => {
          const len = (p.value / total) * 100;
          const from = at;
          at += len;
          return (
            <circle
              key={p.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke} pathLength={100}
              strokeDasharray={`${Math.max(0.01, len - gap)} ${100 - Math.max(0.01, len - gap)}`} strokeDashoffset={-from}
              className="donut-arc" style={{ animationDelay: `${i * 80}ms` }}
            />
          );
        }) : null}
      </svg>
      {center !== undefined ? (
        <div className="absolute inset-0 grid place-content-center text-center leading-tight">
          <span className="text-sm font-bold tabular-nums">{center}</span>
          {sub ? <span className="text-[10px] text-muted-foreground">{sub}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * เกจครึ่งวงกลม (ผู้ใช้ขอ 2026-11-23 ตามคลิป Sales Dashboard) — ใช้กับ % achieve เป้ารวมตัวเดียวเท่านั้น (เป้าแยกช่องใช้แถบ เทียบหลายช่องแม่นกว่า)
 *   ส่วนโค้ง + ปุ่มกวาดจากซ้ายไปถึงค่าจริง (เกิน 100% = เต็มเกจ) · ขีดตามรัศมี = เส้นแบ่งทุก 5% ส่วนที่ทำได้แล้วเข้ม
 *   mark = ขีดเป้าถึงวันนี้ (สัดส่วนของเป้าเดือน) · center = ตัวเลขกลางเกจ (ตัวเลขจริงต้องอยู่ในข้อความคู่กันเสมอ)
 */
export function Gauge({ pct, mark, label, center, width = 240 }: {
  pct: number | null; mark?: number | null; label: string; center?: ReactNode; width?: number;
}) {
  const W = 240, H = 132, cx = 120, cy = 122, r = 94, sw = 14;
  const p = Math.min(1, Math.max(0, pct ?? 0));
  const arc = `M${cx - r},${cy}A${r},${r} 0 0 1 ${cx + r},${cy}`;
  // มุมจากซ้าย (0) ผ่านด้านบน ไปขวา (π) · ปัดทศนิยม 2 ตำแหน่ง (cos/sin ของเซิร์ฟเวอร์กับเบราว์เซอร์ต่างกันที่หลักท้าย = hydration ไม่ตรง)
  const round = (v: number) => Math.round(v * 100) / 100;
  const at = (t: number, rad: number) => [round(cx - rad * Math.cos(t * Math.PI)), round(cy - rad * Math.sin(t * Math.PI))] as const;
  return (
    <div className="relative mx-auto" style={{ width, maxWidth: "100%", aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block size-full overflow-visible" role="img" aria-label={label}>
        {Array.from({ length: 21 }, (_, i) => {
          // ขีดทุก 5% · ทุก 25% ยาวกว่า
          const t = i / 20;
          const [x1, y1] = at(t, r + sw / 2 + 4), [x2, y2] = at(t, r + sw / 2 + (i % 5 === 0 ? 12 : 8));
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.5} strokeLinecap="round" className={p > 0 && t <= p + 1e-9 ? "stroke-foreground/70" : "stroke-border"} />;
        })}
        <path d={arc} fill="none" strokeWidth={sw} strokeLinecap="round" className="stroke-muted" />
        {p > 0 ? (
          <path d={arc} pathLength={100} fill="none" stroke="var(--viz-cur)" strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${p * 100} 100`} className="gauge-sweep" />
        ) : null}
        {mark ? (() => {
          const [x1, y1] = at(Math.min(1, mark), r - sw / 2 - 4), [x2, y2] = at(Math.min(1, mark), r + sw / 2 + 4);
          return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--foreground)" strokeWidth={2.5} strokeLinecap="round" />;
        })() : null}
        {/* ปุ่มที่ปลายส่วนโค้ง: วางไว้ซ้ายสุดแล้วหมุนรอบจุดกลางไปตามค่า (หมุนพร้อมส่วนโค้ง) */}
        {pct !== null ? (
          <g className="gauge-turn" style={{ transform: `rotate(${p * 180}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
            <circle cx={cx - r} cy={cy} r={8} fill="var(--card)" stroke="var(--viz-cur)" strokeWidth={3.5} />
          </g>
        ) : null}
      </svg>
      {center !== undefined ? <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-tight">{center}</div> : null}
    </div>
  );
}

/**
 * แถบแบ่งสัดส่วนแนวนอน + รายการแต่ละส่วน (ผู้ใช้ขอ 2026-11-23 แทนโดนัท · อ่านบนมือถือง่ายกว่า)
 *   2 ส่วน = % ตัวใหญ่หัวท้ายแถบ (แบบคลิป "66% online · 34% in store") · ส่วนคั่นด้วยช่องว่างสีพื้น 2px
 *   แต่ละแถว: สีของส่วน + ชื่อ + บรรทัดรอง (sub) · ค่า + ป้าย (right) — ไม่ใช้สีอย่างเดียว
 */
export function SplitBar({ parts, label, format }: {
  parts: { key: string; label: ReactNode; value: number; color: string; sub?: ReactNode; right?: ReactNode }[];
  label: string;
  format: (v: number) => string;
}) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((a, p) => a + p.value, 0);
  if (!total) return null;
  const pctOf = (v: number) => `${((v / total) * 100).toFixed(v / total < 0.1 ? 1 : 0)}%`;
  const pair = shown.length === 2;
  return (
    <div className="min-w-0">
      {pair ? (
        <div className="flex items-baseline justify-between gap-3">
          {shown.map((p, i) => (
            <span key={p.key} className={cn("flex items-baseline gap-1.5", i === 1 && "flex-row-reverse")}>
              <span className="text-xl font-bold tabular-nums">{pctOf(p.value)}</span>
              <span className="text-xs text-muted-foreground">{p.label}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${shown.map((p) => `${typeof p.label === "string" ? p.label : p.key} ${pctOf(p.value)}`).join(", ")}`}>
        {shown.map((p) => <div key={p.key} className="bar-fill h-full first:rounded-l-full last:rounded-r-full" style={{ flex: `${p.value} 1 0`, background: p.color }} />)}
      </div>
      <ul className="mt-2.5 divide-y">
        {shown.map((p) => (
          <li key={p.key} className="flex items-start gap-2 py-1.5 text-sm">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.label}</span>
              {p.sub ? <span className="block text-xs text-muted-foreground">{p.sub}</span> : null}
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="font-semibold tabular-nums">{format(p.value)}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">{pair ? null : pctOf(p.value)}{p.right}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * การ์ดเทียบตัวชี้วัด: แท่งแนวนอน ช่วงนี้ vs ช่วงก่อน (ยาวตามค่าที่มากกว่า)
 *   diff = ส่วนต่างเป็นหน่วยจริง (ช่วงนี้ − ช่วงก่อน) ใต้ % ที่เปลี่ยน เช่น +฿1,303,474 · ค่าที่เป็น % ส่งมาเป็น pp
 */
export function PairBars({ label, note, cur, prev, format, curName, prevName, diff }: {
  label: string;
  note?: string;
  cur: number | null;
  prev: number | null;
  format: (v: number | null) => string;
  curName: string;
  prevName: string;
  diff?: (gap: number) => string;
}) {
  const max = Math.max(cur ?? 0, prev ?? 0) || 1;
  const rows = [[curName, cur, "var(--viz-cur)"], [prevName, prev, "var(--viz-prev)"]] as const;
  const gap = cur !== null && prev !== null ? cur - prev : null;
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <span className="flex flex-col items-end">
          <ChangeText cur={cur} prev={prev} />
          {diff && gap !== null ? <span className="text-xs tabular-nums text-muted-foreground">{gap > 0 ? "+" : gap < 0 ? "−" : "±"}{diff(Math.abs(gap))}</span> : null}
        </span>
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
