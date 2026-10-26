"use client";

import { useEffect, useState } from "react";
import { TrophyIcon } from "lucide-react";
import { fmtMonthShort, num } from "@/lib/format";
import { nextTierGap, QUOTA_A, QUOTA_B, QUOTA_C, SCORE_TOP, SETTLE_DAYS, type MyRank as MyRankData, type RankEntry } from "@/lib/mc-quota";
import { CAP, TIER_A, TIER_B, type Tier } from "@/lib/mc-rank";
import { cn } from "@/lib/utils";
import { api } from "@/components/shared";

/**
 * แร็งค์ของ Mc ในโปรไฟล์ (ตารางของฉัน): เดือนที่แล้ว + เดือนนี้ถึงตอนนี้ + วิธีคิดแบบอ่านง่าย
 *   เห็นเฉพาะของตัวเอง (src/lib/mc-quota-db.ts myRank) · สูตรจริงอยู่ที่ src/lib/mc-rank.ts
 */

const TIER_TEXT: Record<Tier, string> = { A: "เหนือเกณฑ์", B: "ตามเกณฑ์", C: "ต่ำกว่าเกณฑ์" };
const TIER_CLASS: Record<Tier, string> = {
  A: "border-success/40 bg-success/15 text-success",
  B: "border-border bg-secondary text-foreground",
  C: "border-destructive/40 bg-destructive/10 text-destructive",
};
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const mon = (m: string) => fmtMonthShort.format(new Date(`${m}-01T12:00:00Z`));
const day = (d: string) => `${Number(d.slice(8, 10))} ${mon(d.slice(0, 7))}`;

/** โหลดแร็งค์ตอนเปิดตารางของฉัน (โหลดไม่สำเร็จ = null ไม่แสดง ส่วนอื่นใช้ได้ตามปกติ) */
export function useMyRank(open: boolean) {
  const [data, setData] = useState<MyRankData | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<{ rank: MyRankData }>("/api/my/rank")
      .then((res) => { if (alive && res.ok) setData(res.rank); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [open]);
  return data;
}

export const RANK_ANCHOR = "my-rank";

/** ป้ายแร็งค์ข้างชื่อ (แร็งค์เดือนที่แล้ว · ยังไม่มี = เดือนนี้ถึงตอนนี้) กดแล้วเลื่อนไปกล่องแร็งค์ */
export function RankChip({ data }: { data: MyRankData }) {
  const e = data.last?.tier ? data.last : data.current?.tier ? data.current : null;
  return (
    <button
      type="button"
      onClick={() => document.getElementById(RANK_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 text-[11px] font-bold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
        e?.tier ? TIER_CLASS[e.tier] : "text-muted-foreground",
      )}
      title={e ? `แร็งค์ ${mon(e.month)}${e === data.current ? " (ชั่วคราว)" : ""} — กดดูรายละเอียด` : "ยังไม่มีแร็งค์ — กดดูวิธีได้แร็งค์"}
    >
      {e?.tier ? `แร็งค์ ${e.tier}` : "แร็งค์ –"}
    </button>
  );
}

export function MyRank({ data }: { data: MyRankData }) {
  const quotaShown = !!(data.last?.quota || data.current?.quota);

  return (
    <section id={RANK_ANCHOR} aria-label="แร็งค์ของฉัน" className="scroll-mt-2 rounded-xl border px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold">
        <TrophyIcon className="size-4 text-primary" />แร็งค์ของฉัน
      </h3>
      {data.last ? <RankLine entry={data.last} title={`${mon(data.last.month)} (เดือนที่แล้ว)`} minHours={data.minHours} /> : null}
      {data.current ? <RankLine entry={data.current} title={`${mon(data.current.month)} ถึงตอนนี้`} minHours={data.minHours} current /> : null}

      <details className="mt-2 border-t pt-2 text-xs">
        <summary className="cursor-pointer font-semibold text-primary">แร็งค์คิดยังไง?</summary>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>
            <b className="text-foreground">เทียบกับไลฟ์แบบเดียวกัน</b> — ทุก slot มี &quot;ยอดที่ควรได้ต่อชั่วโมง&quot; = ยอดเฉลี่ยของไลฟ์ช่องเดียวกัน
            ช่วงเวลาเดียวกัน (เช้า / บ่าย / เย็น / ไพรม์ / ดึก) และเป็นวันแคมเปญหรือวันปกติเหมือนกัน ย้อนหลัง 4 เดือน
            ไลฟ์ช่วงเช้าจึงไม่ถูกเทียบกับไพรม์ไทม์
          </li>
          <li><b className="text-foreground">คะแนน = ยอดของคุณ ÷ ยอดที่ควรได้</b> — 100% = เท่าค่าเฉลี่ย · 120% = เกินค่าเฉลี่ย 20%</li>
          <li><b className="text-foreground">วันแคมเปญ 50% + วันปกติ 50%</b> — คิดแยกกันแล้วเฉลี่ย (เดือนนั้นไลฟ์แบบเดียว = ใช้แบบนั้น)</li>
          <li>
            <b className="text-foreground">ไลฟ์น้อย คะแนนจะใกล้ 100%</b> — กันฟลุค · ยิ่งไลฟ์มาก คะแนนยิ่งตรงกับฝีมือจริง
          </li>
          <li>ไลฟ์ที่ยอดพุ่งเกิน {CAP} เท่าของที่ควรได้ นับแค่ {CAP} เท่า · slot สแตนด์บายไม่นับ</li>
          <li>ต้องมีไลฟ์ที่มียอดอย่างน้อย {data.minHours} ชม. ในเดือนนั้น ถึงได้แร็งค์</li>
          <li>ยอดใช้ GMV ที่กรอกใน slot ก่อน · slot ที่ไม่ได้กรอก ใช้ยอดจากระบบของช่อง แบ่งตามนาทีที่ไลฟ์</li>
        </ol>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          {(["A", "B", "C"] as Tier[]).map((t) => (
            <div key={t} className={cn("rounded-lg border px-1.5 py-1", TIER_CLASS[t])}>
              <b className="block text-sm">{t}</b>
              <span className="block text-[11px]">
                {t === "A" ? `${pct(TIER_A)} ขึ้นไป` : t === "B" ? `${pct(TIER_B)}–${pct(TIER_A)}` : `ต่ำกว่า ${pct(TIER_B)}`}
              </span>
              {quotaShown ? (
                <span className="block text-[11px] font-semibold">
                  จองได้ {t === "A" ? `${QUOTA_A[0]}–${QUOTA_A[1]}` : t === "B" ? `${QUOTA_B[0]}–${QUOTA_B[1]}` : QUOTA_C} slot
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-muted-foreground">
          {quotaShown
            ? `แร็งค์เดือนไหน = สิทธิ์จองของเดือนถัดไป · A ได้ ${QUOTA_A[0]} slot ที่ ${pct(TIER_A)} เพิ่มตามคะแนนจนถึง ${QUOTA_A[1]} slot ที่ ${pct(SCORE_TOP)} · B ได้ ${QUOTA_B[0]} slot ที่ ${pct(TIER_B)} ถึง ${QUOTA_B[1]} slot ที่ ${pct(TIER_A)} · ยังไม่มีแร็งค์ = ${QUOTA_C} slot · ทีมงานเพิ่มสิทธิ์พิเศษให้ได้ · `
            : ""}
          แร็งค์ล็อกหลังจบเดือน {SETTLE_DAYS} วัน (รอกรอกยอดครบ) ก่อนหน้านั้นเป็นแร็งค์ชั่วคราว อัปเดตทุก 1 ชม.
        </p>
      </details>
    </section>
  );
}

function RankLine({ entry: e, title, minHours, current = false }: { entry: RankEntry; title: string; minHours: number; current?: boolean }) {
  const gap = current ? nextTierGap(e.tier, e.score) : null;
  const parts = [
    e.detail?.campaign ? `วันแคมเปญ ${pct(e.detail.campaign.index)} (${num(Math.round(e.detail.campaign.hours * 10) / 10)} ชม.)` : "",
    e.detail?.normal ? `วันปกติ ${pct(e.detail.normal.index)} (${num(Math.round(e.detail.normal.hours * 10) / 10)} ชม.)` : "",
  ].filter(Boolean);
  return (
    <div className="mt-2 flex items-start gap-2.5">
      {e.tier ? (
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg border text-lg font-bold", TIER_CLASS[e.tier])}>{e.tier}</span>
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-dashed text-lg font-bold text-muted-foreground">–</span>
      )}
      <div className="min-w-0 flex-1 text-xs leading-snug">
        <div className="text-[13px]">
          <b>{title}</b>
          {!e.settled ? <span className="text-muted-foreground"> · {current ? "ชั่วคราว" : `ชั่วคราว ล็อก ${day(e.settleDate)}`}</span> : null}
        </div>
        {e.tier && e.score !== null ? (
          <div>
            คะแนน <b className="tabular-nums">{pct(e.score)}</b> · {TIER_TEXT[e.tier]}
            {gap ? <span className="text-muted-foreground"> · อีก {pct(gap.gap)} ถึง {gap.tier}</span> : null}
          </div>
        ) : (
          <div className="text-muted-foreground">
            ยังไม่มีแร็งค์ — ไลฟ์ที่มียอด {num(Math.round(e.hours * 10) / 10)}/{minHours} ชม.
          </div>
        )}
        {parts.length ? <div className="text-muted-foreground">{parts.join(" · ")}</div> : null}
        {e.quota ? (
          <div className="font-semibold text-primary">
            {current ? `ถ้าจบเดือนแบบนี้ สิทธิ์จอง ${mon(e.quota.month)} ≈ ${e.quota.total} slot` : `สิทธิ์จอง ${mon(e.quota.month)}: ${e.quota.total} slot`}
            {e.quota.extra ? <span className="font-normal text-muted-foreground"> (แร็งค์ {e.quota.auto} {e.quota.extra > 0 ? `+ พิเศษ ${e.quota.extra}` : `− ${-e.quota.extra}`})</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
