"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { OwnerDetail, OwnerPerson, OwnerSummary, ProofInfo } from "@/lib/types";
import { fmtDayMonth, fmtDayShort, monthKey, monthLabel, money, num, parseKey } from "@/lib/format";
import { fmtGmv } from "@/lib/gmv";
import { bonusPaidMinutes, lateCut, tiersLabel } from "@/lib/pay";
import { ChevronRightIcon } from "lucide-react";
import { BANDS, windowText } from "@/lib/campaign";
import { MIN_RANK_HOURS, rankCells, type McRank, type RankPart, type RankPeriod, type RankReport, type Tier } from "@/lib/mc-rank";
import { useLocal, writeLocal } from "@/lib/hooks";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SortHead, sortRows, type SortState } from "@/components/SortHead";
import type { Cell, ExportBook } from "@/lib/export";
import { ExportMenu, SlidesMenu } from "@/components/ExportMenu";
import { bkkStamp } from "@/lib/live-export";
import { LoadError, LoadingBlock, MonthNav, Notice, Stats, api } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Type = "Mc" | "Admin";

/** อัตราค่าจ้างต่อชั่วโมง: รายคน ถ้าไม่มีใช้ค่าเริ่มต้น */
function rateOf(data: OwnerSummary, type: Type, name: string) {
  const own = type === "Mc" ? data.rates.mc : data.rates.admin;
  return own[name] || (type === "Mc" ? data.rates.defaultMc : data.rates.defaultAdmin) || 0;
}

/** ชั่วโมงรายวันของคนหนึ่ง (ไม่นับคิวที่ยกเลิก) */
function dailyOf(data: OwnerSummary, type: Type, name: string) {
  const byDate = new Map<string, { date: string; slots: number; hours: number }>();
  for (const d of data.details) {
    if (d.type !== type || d.name !== name || d.cancelled) continue;
    const x = byDate.get(d.date) ?? { date: d.date, slots: 0, hours: 0 };
    x.slots++;
    x.hours += d.hours;
    byDate.set(d.date, x);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const shortTime = (t: string) => String(t || "").replace(/^0(\d):/, "$1:");
const round2 = (n: number) => Math.round(n * 100) / 100;

// หลักฐานไลฟ์: เวลาเริ่ม–จบจริง (เวลาไทย) + ลิงก์เปิดรูป
const hms = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const proofTime = (p: ProofInfo) => `${hms.format(new Date(p.startedAt))}–${hms.format(new Date(p.endedAt))}`;
const proofUrl = (p: ProofInfo) => `/api/proofs/image?id=${p.id}`;

/** นาทีสายสำหรับไฟล์ที่ส่งออก เช่น "12" / "10 (จากหลักฐาน)" */
const lateText = (d: OwnerDetail) => (d.lateMinutes ? `${d.lateMinutes}${d.lateFromProof ? " (จากหลักฐาน)" : ""}` : "");

/** ลิงก์โฟลเดอร์ Drive ที่รวมหลักฐานทั้งเดือนของ Mc (จากคิวไหนก็ได้ที่อัปขึ้น Drive แล้ว) */
const monthFolderOf = (items: OwnerDetail[]) => items.find((d) => d.proof?.driveFolderUrl)?.proof?.driveFolderUrl ?? null;
const monthFolderText = (items: OwnerDetail[]) =>
  monthFolderOf(items)
    ?? (items.length && items.every((d) => d.noProof) ? "ไม่ต้องแนบ (Mc ประจำ)"
      : items.some((d) => d.proof?.driveUrl) ? "อยู่ใน Drive แล้ว (ดูลิงก์รายคิว)"
        : items.some((d) => d.proof) ? "ยังไม่ได้อัปขึ้น Drive" : "ยังไม่มีหลักฐาน");

/** คิวที่ไม่ถูกยกเลิกของคนหนึ่ง เรียงตามเวลา */
const slotsOf = (data: OwnerSummary, type: Type, name: string) =>
  data.details.filter((d) => d.type === type && d.name === name && !d.cancelled).sort((a, b) => a.startMs - b.startMs);
/** ยอด GMV รวมของคิว (เฉพาะ slot ที่กรอกแล้ว) count = จำนวน slot ที่กรอก หรือรวมอยู่ในยอดของ slot ถัดไป (ไลฟ์ต่อเนื่องคนเดียว) */
const gmvOf = (items: OwnerDetail[]) => {
  const filled = items.filter((d) => d.gmv !== null);
  return { total: filled.reduce((a, d) => a + d.gmv!, 0), count: filled.length + items.filter((d) => d.gmv === null && d.gmvCoveredBy).length };
};

// ---------- ส่งออก (Microsoft Excel / Google Sheet ผ่าน ExportMenu) ----------

/** ตารางเดียว -> ไฟล์ (แผ่นงานเดียว แถวแรกเป็นหัวตาราง) */
const book = (title: string, sheet: string, rows: unknown[][]): ExportBook =>
  ({ title, sheets: [{ name: sheet, rows: rows as Cell[][] }] });

// เฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์ (ใช้ทั้งตารางบนหน้าจอและไฟล์ที่ส่งออก)
const groups = (data: OwnerSummary): [Type, OwnerPerson[]][] => {
  const out: [Type, OwnerPerson[]][] = [];
  if (data.scope?.mc !== false) out.push(["Mc", data.mc]);
  if (data.scope?.admin !== false) out.push(["Admin", data.admin]);
  return out;
};

function summaryBook(data: OwnerSummary) {
  const rows: unknown[][] = [["ประเภท", "ชื่อ", "จำนวน slot", "ชั่วโมงรวม", "จำนวนวัน", "ยกเลิก", "slot ที่สาย", "ไลฟ์ชดเชย (นาที)", "ชั่วโมงที่ได้เงิน", "Commit", "ค่าจ้าง/ชม.", "ยอดเงิน"]];
  for (const [type, people] of groups(data)) for (const r of people) {
    const rate = rateOf(data, type, r.name);
    const commit = r.commit
      ? `${tiersLabel(r.commit.baseRate, r.commit.tiers)} (${r.commit.tier ? `ถึง ${r.commit.tier.hours}+ ชม.` : "ยังไม่ถึงเทียร์แรก"})`
      : "";
    rows.push([type, r.name, r.slots, r.hours, r.days, r.cancelled, r.lateSlots, r.bonusMinutes || "", r.paidHours, commit, rate || "", rate ? Math.round(r.paidHours * rate) : ""]);
  }
  return book(`GLORY สรุป ${data.month}`, "สรุป", rows);
}

// ใบสรุปค่าจ้างรายคน: ทุกคิวของแต่ละคน + แถวรวมต่อคน (ไม่นับคิวที่ยกเลิก หักมาสายตามกฎ + ไลฟ์ชดเชย)
function payrollBook(data: OwnerSummary) {
  const rows: unknown[][] = [["ชื่อ", "Platform", "วันที่", "เริ่ม", "จบ", "ชั่วโมง", "สาย (นาที)", "หัก", "ชดเชย (นาที)", "ค่าจ้าง/ชม.", "ยอดเงิน", "GMV", "ไลฟ์จริง (หลักฐาน)", "แนบโดย", "ลิงก์หลักฐาน (Google Drive)"]];
  for (const [type, people] of groups(data)) {
    let groupHours = 0, groupMoney = 0, groupGmv = 0, groupGmvCount = 0;
    for (const p of people) {
      const rate = rateOf(data, type, p.name);
      const items = slotsOf(data, type, p.name);
      if (!items.length) continue;
      const gmv = gmvOf(items);
      let h = 0, paid = 0;
      for (const d of items) {
        const hrs = round2(d.hours);
        const cut = lateCut(d.lateMinutes);
        const bonus = bonusPaidMinutes(d.bonusMinutes);
        const slotPaid = hrs * (1 - cut) + bonus / 60;
        h += hrs;
        paid += slotPaid;
        rows.push([
          p.name, d.platform, fmtDayMonth.format(parseKey(d.date)), shortTime(d.start), shortTime(d.end), hrs,
          lateText(d), cut ? `${Math.round(cut * 100)}%` : "",
          bonus ? `+${d.bonusMinutes} (คิด ${bonus})${d.bonusFromProof ? " จากหลักฐาน" : ""}` : "", rate || "", rate ? Math.round(slotPaid * rate) : "",
          d.gmv ?? (d.gmvCoveredBy ? `รวมในคิว ${d.gmvCoveredBy}` : ""),
          d.proof ? proofTime(d.proof) : d.noProof ? "ไม่ต้องแนบ (Mc ประจำ)" : "ยังไม่มีหลักฐาน",
          d.proof?.by ?? "",
          d.proof ? d.proof.driveUrl ?? "ยังไม่ได้อัปขึ้น Drive" : "",
        ]);
      }
      const m = rate ? Math.round(paid * rate) : 0;
      rows.push([
        `รวม ${p.name}`, `${items.length} slot`, "", "", "", round2(h), "", "", "", "", rate ? m : "",
        gmv.count ? round2(gmv.total) : "", "", "",
        // คอลัมน์ O: โฟลเดอร์รวมหลักฐานทั้งเดือนของ Mc คนนี้ใน Google Drive
        type === "Mc" ? monthFolderText(items) : "",
      ], []);
      groupHours += h;
      groupMoney += m;
      groupGmv += gmv.total;
      groupGmvCount += gmv.count;
    }
    rows.push([
      `รวม ${type} ทั้งหมด`, "", "", "", "", round2(groupHours), "", "", "", "", groupMoney || "", groupGmvCount ? round2(groupGmv) : "",
    ], []);
  }
  return book(`GLORY ใบสรุปค่าจ้างรายคน ${data.month}`, "ค่าจ้างรายคน", rows);
}

// ตาราง คน x วันที่: แต่ละช่อง = ชั่วโมงของวันนั้น, ท้ายแถว = รวมชั่วโมงและจำนวนวัน
function dailyBook(data: OwnerSummary) {
  const [y, m] = data.month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const header: unknown[] = ["ประเภท", "ชื่อ"];
  for (let d = 1; d <= daysInMonth; d++) header.push(`${d}/${m}`);
  header.push("รวมชั่วโมง", "จำนวนวัน", "จำนวน slot");
  const rows = [header];
  for (const [type, people] of groups(data)) for (const p of people) {
    const perDay: Record<number, number> = {};
    for (const x of dailyOf(data, type, p.name)) perDay[Number(x.date.slice(8, 10))] = x.hours;
    const line: unknown[] = [type, p.name];
    for (let d = 1; d <= daysInMonth; d++) line.push(perDay[d] ? round2(perDay[d]) : "");
    line.push(p.hours, p.days, p.slots);
    rows.push(line);
  }
  return book(`GLORY รายคน-รายวัน ${data.month}`, "รายคน-รายวัน", rows);
}

function detailBook(data: OwnerSummary) {
  const rows: unknown[][] = [["ประเภท", "ชื่อ", "วันที่", "เริ่ม", "จบ", "Platform", "ชั่วโมง", "คู่ (Admin/Mc)", "สถานะ", "สาย (นาที)", "ชดเชย (นาที)", "ไลฟ์จริง (หลักฐาน)", "แนบโดย", "ลิงก์หลักฐาน (Google Drive)"]];
  for (const d of data.details) {
    rows.push([
      d.type, d.name, d.date, d.start, d.end, d.platform, d.hours, d.pair, d.cancelled ? d.status || "ยกเลิก" : d.status || "",
      lateText(d), d.bonusMinutes ? `+${d.bonusMinutes}${d.bonusFromProof ? " (จากหลักฐาน)" : ""}` : "", d.proof ? proofTime(d.proof) : d.noProof ? "ไม่ต้องแนบ (Mc ประจำ)" : "", d.proof?.by ?? "", d.proof?.driveUrl ?? "",
    ]);
  }
  return book(`GLORY รายละเอียด ${data.month}`, "รายละเอียด", rows);
}

// อันดับ Mc: GMV/ชม. เทียบ "ค่าที่คาดหวังของ slot นั้น" (ช่อง x แคมเปญ x ช่วงเวลา) ตามช่วงที่เลือก — src/lib/mc-rank.ts
const pct = (x: number | null | undefined) => (x == null ? "" : Math.round(x * 1000) / 10);
const TIER_TEXT: Record<Tier, string> = { A: "เหนือเกณฑ์", B: "ใกล้เกณฑ์", C: "ต่ำกว่าเกณฑ์" };
const TIER_CLASS: Record<Tier, string> = {
  A: "border-success/40 bg-success/15 text-success",
  B: "border-border bg-secondary text-muted-foreground",
  C: "border-destructive/40 bg-destructive/10 text-destructive",
};
const RANK_PERIOD_KEY = "glory_rank_period";
const RANK_PERIODS: [RankPeriod, string][] = [["month", "เดือนที่เลือก"], ["30", "30 วันล่าสุด"], ["90", "90 วันล่าสุด"]];

const periodText = (r: RankReport) => (r.period === "month" ? monthLabel(r.month) : `${r.period} วันล่าสุด (${windowText(r.from, r.to)})`);
const prevPeriodText = (r: RankReport) => (r.period === "month" ? monthLabel(monthKey(-1, r.month)) : `${r.period} วันก่อนหน้า`);
/** undefined = ช่วงก่อนไม่มีข้อมูลให้เทียบ (ไม่แสดง) / null = ไม่มีอันดับในช่วงก่อน */
const moveText = (m: number | null | undefined) => (m === undefined ? "" : m === null ? "ใหม่" : m > 0 ? `▲${m}` : m < 0 ? `▼${-m}` : "–");

/** สถานะช่วงที่ยังไม่จบ (เดือนนี้): ไลฟ์ไปแล้วกี่ชั่วโมง / แคมเปญที่ยังไม่เริ่ม */
function partialNote(r: RankReport) {
  if (!r.partial || r.period !== "month") return "";
  const p = r.progress;
  const waiting = p.campaigns.filter((c) => c.past < c.total).map((c) => (c.past ? `${c.label} ${num(c.past)}/${num(c.total)} ชม.` : `${c.label} ยังไม่เริ่ม (${num(c.total)} ชม.)`));
  return `ไลฟ์ไปแล้ว ${num(Math.round(p.past))}/${num(Math.round(p.total))} ชม. (${p.total ? Math.round((p.past / p.total) * 100) : 0}%) · กรอกยอดแล้ว ${num(Math.round(p.entered))} ชม.${waiting.length ? ` · ${waiting.join(" · ")}` : ""}`;
}

function rankBook(r: RankReport, rows: McRank[], moves: Map<string, number | null>): ExportBook {
  const partCells = (p: RankPart | null) => (p ? [round2(p.hours), round2(p.perHour), pct(p.index)] : ["", "", ""]);
  const ranking: unknown[][] = [[
    "อันดับ", `เทียบ${prevPeriodText(r)}`, "ระดับ", "Mc", "ชม. ที่มียอด", "GMV", "GMV/ชม.",
    "แคมเปญ: ชม.", "แคมเปญ: GMV/ชม.", "แคมเปญ: ดัชนี (%)", "วันปกติ: ชม.", "วันปกติ: GMV/ชม.", "วันปกติ: ดัชนี (%)",
    "คะแนนรวม (%)", "ความมั่นใจ", "ยอดที่กรอกจริง (% ของชม.)", "หมายเหตุ",
  ]];
  for (const x of rows) {
    ranking.push([
      x.rank ?? "", x.ranked ? moveText(moves.size ? moves.get(x.name) ?? null : undefined) : "", x.tier ? `${x.tier} ${TIER_TEXT[x.tier]}` : "", x.name, round2(x.hours), round2(x.gmv), round2(x.perHour),
      ...partCells(x.campaign), ...partCells(x.normal), pct(x.score), x.confidence, Math.round(x.exact * 100),
      x.ranked ? "" : `ข้อมูลน้อย (ต่ำกว่า ${MIN_RANK_HOURS} ชม.) ยังไม่จัดอันดับ`,
    ]);
  }
  const expect: unknown[][] = [["แคมเปญ", "ช่อง", "จำนวน slot", ...BANDS.map((b) => `${b} (GMV/ชม.)`)]];
  for (const e of r.expect) expect.push([e.label, e.platform, e.slots, ...BANDS.map((b) => (e.rates[b] == null ? "" : Math.round(e.rates[b]!)))]);
  const detail: unknown[][] = [["Mc", "แคมเปญ", "ช่อง", "ชม.", "GMV", "GMV/ชม.", "ที่คาดหวัง GMV/ชม.", "ดัชนี (%)", "ที่มายอด"]];
  for (const x of rows) for (const c of [...(x.campaign?.cells ?? []), ...(x.normal?.cells ?? [])]) {
    detail.push([x.name, c.label, c.platform, round2(c.hours), round2(c.gmv), round2(c.gmv / c.hours), round2(c.expected / c.hours), pct(c.actual / c.expected),
      c.exact >= 0.7 ? "ยอดที่กรอกใน slot" : c.exact > 0 ? "กรอกบางส่วน + ประมาณจาก Export" : "ประมาณจากไฟล์ Export"]);
  }
  const note = partialNote(r);
  return {
    title: `GLORY อันดับ Mc ${periodText(r)}`,
    sheets: [
      { name: "อันดับ Mc", rows: [...(note ? [[`อันดับชั่วคราว: ${note}`], []] : []), ...ranking] as Cell[][] },
      { name: "ค่าที่คาดหวัง", rows: expect as Cell[][] },
      { name: "รายแคมเปญ", rows: detail as Cell[][] },
    ],
  };
}

/** ดัชนี (% เทียบค่าที่คาดหวัง): เขียว = 100% ขึ้นไป แดง = ต่ำกว่า */
function IndexText({ index, className }: { index: number | null | undefined; className?: string }) {
  if (index == null) return <span className="text-muted-foreground">–</span>;
  return <span className={cn("font-semibold tabular-nums", index >= 0.995 ? "text-success" : "text-destructive", className)}>{pct(index)}%</span>;
}

function PartCell({ part }: { part: RankPart | null }) {
  return (
    <TableCell className="px-3 text-right tabular-nums">
      {part ? (
        <span title={`ก่อนดึงเข้าหา 100%: ${pct(part.ratio)}%`}>
          <IndexText index={part.index} />
          <span className="block text-[11px] text-muted-foreground">฿{money(part.perHour)}/ชม. · {num(round2(part.hours))} ชม.</span>
        </span>
      ) : <span className="text-muted-foreground">–</span>}
    </TableCell>
  );
}

const RANK_COLS: [string, string][] = [["hours", "ชม. ที่มียอด"], ["gmv", "GMV"], ["perHour", "GMV/ชม."], ["campaign", "แคมเปญ"], ["normal", "วันปกติ"], ["score", "คะแนนรวม"]];

function McRankPanel({ month }: { month: string }) {
  const saved = useLocal(RANK_PERIOD_KEY);
  const period: RankPeriod = saved === "month" || saved === "30" ? saved : "90";
  // 30 / 90 วันล่าสุด ไม่ขึ้นกับเดือนที่เลือก
  const key = period === "month" ? `month|${month}` : period;
  const [cache, setCache] = useState<Record<string, RankReport>>({});
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [excludeCeo, setExcludeCeo] = useState(false);
  const report = cache[key];
  const error = failed?.key === key ? failed.message : "";

  useEffect(() => {
    if (report) return;
    api<{ report: RankReport }>(`/api/owner/rank?period=${period}&month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        setCache((c) => ({ ...c, [key]: res.report }));
        setFailed(null);
      })
      .catch((err) => setFailed({ key, message: (err as Error).message }));
  }, [key, report, period, month, attempt]);

  const all = useMemo(() => (report ? rankCells(report.cells, { excludeCeo }) : []), [report, excludeCeo]);
  const moves = useMemo(() => {
    const prev = new Map(report ? rankCells(report.prevCells, { excludeCeo }).filter((x) => x.ranked).map((x) => [x.name, x.rank!]) : []);
    // ช่วงก่อนไม่มีใครมีอันดับ (เช่น ก่อน ส.ค. 2026 ยังไม่มีข้อมูลรายไลฟ์) = ไม่เทียบ ไม่แสดงลูกศร
    if (!prev.size) return new Map<string, number | null>();
    return new Map(all.map((x) => [x.name, x.rank != null && prev.has(x.name) ? prev.get(x.name)! - x.rank : null]));
  }, [report, all, excludeCeo]);

  const valueOf = (r: McRank, k: string): number | string | null => {
    switch (k) {
      case "rank": return r.rank;
      case "name": return r.name;
      case "hours": return r.hours;
      case "gmv": return r.gmv;
      case "perHour": return r.perHour;
      case "campaign": return r.campaign?.index ?? null;
      case "normal": return r.normal?.index ?? null;
      case "score": return r.score;
      default: return null;
    }
  };
  const rows = sortRows(all, sort, valueOf);
  const hasNames = new Set(all.map((r) => r.name));
  const none = report ? Object.entries(report.progress.perMc).filter(([n, p]) => p.past > 0 && !hasNames.has(n)).map(([n]) => n) : [];
  const note = report ? partialNote(report) : "";
  const exact = (() => {
    const h = all.reduce((a, r) => a + r.hours, 0);
    return h ? all.reduce((a, r) => a + r.exact * r.hours, 0) / h : 0;
  })();

  return (
    <section className="mt-5">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 className="flex flex-wrap items-baseline gap-2 text-lg font-bold">
          อันดับ Mc
          <span className="text-xs font-normal text-muted-foreground">
            GMV/ชม. เทียบค่าที่คาดหวังของ slot แบบเดียวกัน (ช่อง · แคมเปญ · ช่วงเวลา) · คะแนนรวม = แคมเปญ 50% + วันปกติ 50% · 100% ขึ้นไป = เหนือค่าที่คาดหวัง
          </span>
        </h2>
        {report && all.length ? (
          <div className="flex flex-wrap gap-2">
            <ExportMenu label="อันดับ Mc" size="sm" build={() => rankBook(report, all, moves)} />
            <SlidesMenu
              label="สไลด์"
              title={`GLORY อันดับ Mc ${periodText(report)}`}
              build={async () => {
                const { buildRankDeck } = await import("@/lib/campaign-slides");
                return buildRankDeck({
                  periodText: periodText(report), prevText: prevPeriodText(report), partialNote: note, exactShare: exact,
                  exportedAt: bkkStamp(new Date().toISOString()), rows: all, moves, expect: report.expect, excludeCeo,
                });
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single" spacing={1} value={period}
          onValueChange={(v) => { if (v) writeLocal(RANK_PERIOD_KEY, v); }}
          aria-label="ช่วงที่ใช้จัดอันดับ" className="rounded-full border bg-card p-1"
        >
          {RANK_PERIODS.map(([id, text]) => (
            <ToggleGroupItem key={id} value={id} className="rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!">
              {id === "month" ? `${text} (${monthLabel(month)})` : text}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {report ? (
          <span className="text-xs text-muted-foreground">
            {periodText(report)} · {moves.size ? `เทียบอันดับกับ${prevPeriodText(report)}` : `${prevPeriodText(report)}ยังไม่มีข้อมูลรายไลฟ์ให้เทียบอันดับ`}{all.length ? ` · ยอดที่กรอกจริง ${Math.round(exact * 100)}% ของชั่วโมง ที่เหลือ ≈ ประมาณจากไฟล์ Export` : ""}
            {report.from < "2026-08-01" ? " · ข้อมูล Export รายไลฟ์มีตั้งแต่ 1 ส.ค. 2026" : ""}
          </span>
        ) : null}
      </div>
      {note ? (
        <Notice variant="warning" title={`อันดับชั่วคราว: ${monthLabel(report!.month)} ยังไม่จบเดือน`} className="mb-2">
          {note} · ดูภาพรวมที่ &quot;90 วันล่าสุด&quot; ได้
        </Notice>
      ) : null}
      {!report ? (
        error ? <LoadError title="โหลดอันดับไม่สำเร็จ" message={error} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} /> : <LoadingBlock className="h-32" />
      ) : !all.length ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          ยังไม่มียอดที่คิดคะแนนได้ในช่วงนี้ (ไฟล์ Export รายไลฟ์มีตั้งแต่ ส.ค. 2026 · ยอดที่กรอกใน slot มีตั้งแต่ ต.ค. 2026)
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="min-w-[780px]">
            <TableHeader className="bg-secondary">
              <TableRow className="hover:bg-transparent">
                <SortHead k="rank" label="#" sort={sort} setSort={setSort} text className="w-14" />
                <SortHead k="name" label="Mc" text sort={sort} setSort={setSort} />
                {RANK_COLS.map(([k, h]) => <SortHead key={k} k={k} label={h} sort={sort} setSort={setSort} />)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isOpen = open === r.name;
                const cells = [...(r.campaign?.cells ?? []), ...(r.normal?.cells ?? [])];
                const mv = moves.get(r.name);
                const prog = report.period === "month" && report.partial ? report.progress.perMc[r.name] : undefined;
                return (
                  <Fragment key={r.name}>
                    <TableRow
                      tabIndex={0}
                      aria-expanded={isOpen}
                      data-state={isOpen ? "selected" : undefined}
                      onClick={() => setOpen(isOpen ? null : r.name)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : r.name); } }}
                      className={cn("cursor-pointer data-[state=selected]:bg-secondary", !r.ranked && "text-muted-foreground")}
                    >
                      <TableCell className="px-3 tabular-nums">
                        <b>{r.rank ?? "–"}</b>
                        {r.ranked && moveText(mv) ? (
                          <span
                            className={cn("block text-[11px] font-semibold", mv == null ? "text-primary" : mv > 0 ? "text-success" : mv < 0 ? "text-destructive" : "text-muted-foreground")}
                            title={mv == null ? `ไม่มีอันดับใน${prevPeriodText(report)}` : `เทียบ${prevPeriodText(report)}`}
                          >
                            {moveText(mv)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-3">
                        <ChevronRightIcon className={cn("mr-0.5 inline size-4 text-muted-foreground transition-transform", isOpen && "rotate-90 text-primary")} />
                        {r.name}
                        {!r.ranked ? (
                          <Badge variant="outline" className="ml-1.5 text-[11px] text-muted-foreground" title={`ต้องมียอด GMV อย่างน้อย ${MIN_RANK_HOURS} ชม. ถึงเข้าอันดับ`}>
                            ข้อมูลน้อย (&lt; {MIN_RANK_HOURS} ชม.)
                          </Badge>
                        ) : null}
                        {r.exact < 0.3 ? <span className="ml-1.5 text-[11px] text-muted-foreground" title="ยอดส่วนใหญ่ประมาณจากไฟล์ Export (ยอดที่กรอกใน slot น้อยกว่า 30% ของชั่วโมง)">≈</span> : null}
                        {prog ? <span className="block pl-5 text-[11px] text-muted-foreground">ไลฟ์ไปแล้ว {num(round2(prog.past))}/{num(round2(prog.total))} ชม.</span> : null}
                      </TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{num(round2(r.hours))}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{money(r.gmv)}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{money(r.perHour)}</TableCell>
                      <PartCell part={r.campaign} />
                      <PartCell part={r.normal} />
                      <TableCell className="px-3 text-right">
                        {r.score === null || !r.tier ? <span className="text-muted-foreground">–</span> : (
                          <>
                            <IndexText index={r.score} className="text-base" />
                            <span className="mt-0.5 flex items-center justify-end gap-1">
                              <span className={cn("rounded-full border px-1.5 text-[11px] font-bold", TIER_CLASS[r.tier])} title={TIER_TEXT[r.tier]}>{r.tier}</span>
                              <span className="text-[11px] text-muted-foreground" title="ความมั่นใจตามจำนวนชั่วโมงที่มียอด">มั่นใจ{r.confidence}</span>
                            </span>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="bg-secondary hover:bg-secondary">
                        <TableCell colSpan={8} className="px-3 pt-1 pb-3 pl-8 whitespace-normal">
                          <ul className="space-y-1 text-xs">
                            {cells.map((c) => (
                              <li key={c.key} className="flex flex-wrap items-baseline gap-x-2">
                                <b className={cn("font-semibold", c.label !== "วันปกติ" && "text-primary")}>{c.label}</b>
                                <span className="text-muted-foreground">{c.platform}</span>
                                <span className="tabular-nums">
                                  {num(round2(c.hours))} ชม. · ฿{money(c.gmv / c.hours)}/ชม. (คาดหวัง ฿{money(c.expected / c.hours)}/ชม.)
                                </span>
                                <IndexText index={c.actual / c.expected} />
                                {c.exact < 0.7 ? <span className="text-muted-foreground">≈ ประมาณ</span> : null}
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={excludeCeo} onChange={(e) => setExcludeCeo(e.target.checked)} className="size-3.5 accent-primary" />
              ไม่นับ slot ที่มี CEO ไลฟ์ในคะแนนรายคน (ค่าเริ่มต้น = นับ)
            </label>
            <span>
              ระดับ A ≥ 110% · B 95–110% · C &lt; 95% · ข้อมูลน้อยถูกดึงเข้าหา 100% · ≈ = ประมาณจากไฟล์ Export
              {report.skipped ? ` · ข้าม ${report.skipped} หน่วยที่ไม่มีค่าเทียบ` : ""}
            </span>
          </div>
          <details className="border-t px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold">ค่าที่คาดหวัง GMV/ชม. แยกแคมเปญ · ช่อง · ช่วงเวลา ({report.expect.length} กลุ่ม)</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1 pr-2 text-left font-semibold">แคมเปญ</th>
                    <th className="py-1 pr-2 text-left font-semibold">ช่อง</th>
                    <th className="py-1 pl-2 text-right font-semibold">slot</th>
                    {BANDS.map((b) => <th key={b} className="py-1 pl-2 text-right font-semibold">{b}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {report.expect.map((e) => (
                    <tr key={`${e.label}|${e.platform}`} className="border-b last:border-0">
                      <td className={cn("py-1 pr-2", e.label !== "วันปกติ" && "font-semibold text-primary")}>{e.label}</td>
                      <td className="py-1 pr-2">{e.platform}</td>
                      <td className="py-1 pl-2 text-right tabular-nums">{e.slots}</td>
                      {BANDS.map((b) => (
                        <td key={b} className="py-1 pl-2 text-right tabular-nums">{e.rates[b] == null ? <span className="text-muted-foreground">–</span> : money(e.rates[b]!)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted-foreground">
                ค่าที่คาดหวัง = GMV/ชม. เฉลี่ยของ slot แบบเดียวกันจากทุกไลฟ์ในไฟล์ Export ย้อนหลังไม่เกิน 120 วัน (ไม่ใช่ยอดที่กรอกรายคน) · ช่วงเวลา: เช้า 07–11 · บ่าย 11–15 · เย็น 15–19 · ไพรม์ 19–23 · ดึก 23–07 · &quot;–&quot; = กลุ่มนั้นมี slot น้อยกว่า 6 ใช้ค่ากลุ่มกว้างกว่าแทน/เทียบไม่ได้
              </p>
            </div>
          </details>
        </div>
      )}
      {none.length ? <p className="mt-2 text-xs text-muted-foreground">ไลฟ์แล้วแต่ยังไม่มียอดที่คิดคะแนนได้: {none.join(", ")}</p> : null}
    </section>
  );
}

// ---------- หน้าจอ ----------

export function OwnerView() {
  const [month, setMonth] = useState(() => monthKey());
  const [cache, setCache] = useState<Record<string, OwnerSummary>>({});
  const [failed, setFailed] = useState<{ month: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const data = cache[month];
  const error = failed?.month === month ? failed.message : "";
  const loaded = !!data;

  useEffect(() => {
    if (loaded) return;
    api<OwnerSummary>(`/api/owner?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        setCache((c) => ({ ...c, [month]: res }));
        setFailed(null);
      })
      .catch((err) => setFailed({ month, message: (err as Error).message }));
  }, [month, loaded, attempt]);

  const nav = <MonthNav label={monthLabel(month)} onPrev={() => setMonth(monthKey(-1, month))} onNext={() => setMonth(monthKey(1, month))} />;
  if (!data) {
    return (
      <div className="pb-10">
        {nav}
        {error ? (
          <LoadError title="โหลดสรุปไม่สำเร็จ" message={error} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} />
        ) : <LoadingBlock />}
      </div>
    );
  }

  const r0 = data.rates;
  const noRates = !r0.defaultMc && !r0.defaultAdmin && !Object.keys(r0.mc).length && !Object.keys(r0.admin).length;
  const sum = (rows: OwnerPerson[], k: "hours" | "slots") => rows.reduce((a, r) => a + r[k], 0);
  const onlyAdmin = data.scope?.mc === false;
  const onlyMc = data.scope?.admin === false;

  return (
    <div className="pb-10">
      {nav}
      <Stats items={onlyAdmin
        ? [[num(sum(data.admin, "hours")), "ชม. Admin"], [String(sum(data.admin, "slots")), "slot Admin"], [String(data.admin.length), "คน"]]
        : onlyMc
          ? [[num(sum(data.mc, "hours")), "ชม. Mc"], [String(sum(data.mc, "slots")), "slot Mc"], [String(data.mc.length), "คน"]]
          : [[num(sum(data.mc, "hours")), "ชม. Mc"], [num(sum(data.admin, "hours")), "ชม. Admin"], [String(sum(data.mc, "slots")), "slot Mc"]]} />
      {noRates ? (
        <Notice>
          ยังไม่ได้ตั้งค่าจ้าง: ใส่ค่าจ้างต่อชั่วโมงเริ่มต้นในตาราง settings (default_mc_rate / default_admin_rate) หรือรายคนที่ staff.hourly_rate
        </Notice>
      ) : null}
      <div className="my-3 flex flex-wrap gap-2">
        <ExportMenu variant="default" label="ใบสรุปค่าจ้างรายคน" build={() => payrollBook(data)} />
        <ExportMenu label="รายคน-รายวัน" build={() => dailyBook(data)} />
        <ExportMenu label="สรุป" build={() => summaryBook(data)} />
        <ExportMenu label="รายละเอียด" build={() => detailBook(data)} />
      </div>
      {data.scope?.mc !== false ? <McRankPanel month={data.month} /> : null}
      {groups(data).map(([type, rows]) => (
        <section key={type} className="mt-5">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-lg font-bold">
            {type}
            <span className="text-xs font-normal text-muted-foreground">กดที่ชื่อเพื่อดูรายวัน · ไม่นับคิวที่ยกเลิก · ยอดเงินหักมาสาย + รวมไลฟ์ชดเชยแล้ว</span>
          </h2>
          <SumTable data={data} type={type} rows={rows} />
        </section>
      ))}
    </div>
  );
}

const SUM_COLS: [string, string][] = [
  ["slots", "slot"], ["hours", "ชั่วโมง"], ["days", "วัน"], ["cancelled", "ยกเลิก"], ["late", "สาย"],
  ["bonus", "ชดเชย"], ["proof", "หลักฐาน"], ["gmv", "GMV"], ["pay", "ยอดเงิน"],
];

function SumTable({ data, type, rows: base }: { data: OwnerSummary; type: Type; rows: OwnerPerson[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>(null);
  if (!base.length) return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">ไม่มีคิวในเดือนนี้</div>;
  const valueOf = (r: OwnerPerson, k: string): number | string | null => {
    const items = slotsOf(data, type, r.name);
    switch (k) {
      case "name": return r.name;
      case "slots": return r.slots;
      case "hours": return r.hours;
      case "days": return r.days;
      case "cancelled": return r.cancelled;
      case "late": return r.lateSlots;
      case "bonus": return r.bonusMinutes;
      case "proof": {
        const need = items.filter((d) => !d.noProof);
        return need.length ? need.filter((d) => d.proof).length / need.length : null;
      }
      case "gmv": {
        const g = gmvOf(items);
        return g.count ? g.total : null;
      }
      case "pay": {
        const rate = rateOf(data, type, r.name);
        return rate ? rate * r.paidHours : null;
      }
      default: return null;
    }
  };
  const rows = sortRows(base, sort, valueOf);
  const toggle = (name: string) => {
    const next = new Set(open);
    if (next.has(name)) next.delete(name); else next.add(name);
    setOpen(next);
  };
  const ts = rows.reduce((a, r) => a + r.slots, 0);
  const th = rows.reduce((a, r) => a + r.hours, 0);
  const tm = rows.reduce((a, r) => a + rateOf(data, type, r.name) * r.paidHours, 0);
  const tl = rows.reduce((a, r) => a + r.lateSlots, 0);
  const tb = rows.reduce((a, r) => a + r.bonusMinutes, 0);
  const num_ = "text-right tabular-nums";
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="min-w-[680px]">
        <TableHeader className="bg-secondary">
          <TableRow className="hover:bg-transparent">
            <SortHead k="name" label="ชื่อ" text sort={sort} setSort={setSort} />
            {SUM_COLS.map(([k, h]) => <SortHead key={k} k={k} label={h} sort={sort} setSort={setSort} />)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const rate = rateOf(data, type, r.name);
            const isOpen = open.has(r.name);
            const daily = isOpen ? dailyOf(data, type, r.name) : [];
            const items = slotsOf(data, type, r.name);
            const need = items.filter((d) => !d.noProof); // ไม่นับคิวของ Mc ประจำ (ไม่ต้องแนบ)
            const proved = need.filter((d) => d.proof).length;
            const gmv = gmvOf(items);
            return (
              <Fragment key={r.name}>
                <TableRow
                  tabIndex={0}
                  aria-expanded={isOpen}
                  data-state={isOpen ? "selected" : undefined}
                  onClick={() => toggle(r.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(r.name); } }}
                  className="cursor-pointer data-[state=selected]:bg-secondary"
                >
                  <TableCell className="px-3">
                    <ChevronRightIcon className={cn("mr-0.5 inline size-4 text-muted-foreground transition-transform", isOpen && "rotate-90 text-primary")} />
                    {r.name}
                    {r.commit ? (
                      <Badge
                        title={`Commit: ${tiersLabel(r.commit.baseRate, r.commit.tiers)} (ทุกชั่วโมงของเดือนคิดราคาเทียร์ที่จองถึง)`}
                        variant={r.commit.tier ? "default" : "outline"}
                        className={cn("ml-1.5 text-[11px]", r.commit.tier ? "bg-success/15 text-success" : "text-muted-foreground")}
                      >
                        {r.commit.tier
                          ? `Commit ${num(r.commit.tier.hours)}+ ชม. ✓ ${money(r.commit.tier.rate)}/ชม.`
                          : `Commit ยังไม่ถึง ${num(r.commit.tiers[0].hours)} ชม. (${num(r.hours)})`}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className={num_}>{r.slots}</TableCell>
                  <TableCell className={num_}>{num(r.hours)}</TableCell>
                  <TableCell className={num_}>{r.days}</TableCell>
                  <TableCell className={num_}>{r.cancelled || "–"}</TableCell>
                  <TableCell className={cn(num_, r.lateSlots && "font-semibold text-destructive")}>{r.lateSlots || "–"}</TableCell>
                  <TableCell className={cn(num_, r.bonusMinutes && "font-semibold text-success")}>
                    {r.bonusMinutes ? `+${r.bonusMinutes} น.` : "–"}
                  </TableCell>
                  {need.length ? (
                    <TableCell
                      title="slot ที่มีหลักฐานไลฟ์ / slot ที่ต้องแนบ"
                      className={cn(num_, proved === need.length ? "text-success" : "font-semibold text-destructive")}
                    >
                      {proved}/{need.length}
                    </TableCell>
                  ) : (
                    <TableCell title="Mc ประจำ (เงินเดือน) ไม่ต้องแนบหลักฐาน" className={cn(num_, "text-xs text-muted-foreground")}>
                      {items.length ? "ไม่ต้องแนบ" : "–"}
                    </TableCell>
                  )}
                  <TableCell
                    title={gmv.count ? `กรอก GMV แล้ว ${gmv.count}/${items.length} slot` : "ยังไม่ได้กรอก GMV"}
                    className={num_}
                  >
                    {gmv.count ? fmtGmv(gmv.total) : "–"}
                  </TableCell>
                  <TableCell className={cn(num_, "px-3")}>{rate ? money(r.paidHours * rate) : "–"}</TableCell>
                </TableRow>
                {isOpen ? (
                  <TableRow className="bg-secondary hover:bg-secondary">
                    <TableCell colSpan={10} className="px-3 pt-1 pb-3 pl-8 whitespace-normal">
                      <div className="flex flex-wrap gap-1.5">
                        {daily.length ? daily.map((x) => (
                          <Badge key={x.date} variant="outline" className="h-auto bg-card px-2.5 py-1 font-normal">
                            <b className="font-semibold text-primary">{fmtDayShort.format(parseKey(x.date))}</b>
                            {` ${num(x.hours)} ชม.`}{x.slots > 1 ? ` (${x.slots} slot)` : ""}
                          </Badge>
                        )) : <span className="text-xs text-muted-foreground">ไม่มีคิวที่ไม่ถูกยกเลิก</span>}
                      </div>
                      {type === "Mc" && monthFolderOf(items) ? (
                        <a
                          href={monthFolderOf(items)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-xs font-semibold text-primary underline"
                        >
                          เปิดโฟลเดอร์หลักฐานทั้งเดือนใน Google Drive
                        </a>
                      ) : null}
                      {items.length ? (
                        <ul className="mt-2 space-y-1 text-xs">
                          {items.map((d) => (
                            <li key={`${d.startMs}|${d.platform}`} className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-semibold tabular-nums">
                                {fmtDayShort.format(parseKey(d.date))} {shortTime(d.start)}–{shortTime(d.end)}
                              </span>
                              <span className="text-muted-foreground">{d.platform}</span>
                              {lateCut(d.lateMinutes) > 0 ? (
                                <span className="font-semibold text-destructive">
                                  สาย {d.lateMinutes} น. −{Math.round(lateCut(d.lateMinutes) * 100)}%{d.lateFromProof ? " (จากหลักฐาน)" : ""}
                                </span>
                              ) : null}
                              {bonusPaidMinutes(d.bonusMinutes) > 0 ? (
                                <span className="font-semibold text-success">
                                  ชดเชย +{d.bonusMinutes} น.{d.bonusFromProof ? " (จากหลักฐาน)" : ""}
                                </span>
                              ) : null}
                              {d.proof ? (
                                <a href={proofUrl(d.proof)} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
                                  หลักฐาน: ไลฟ์จริง {proofTime(d.proof)}
                                </a>
                              ) : d.noProof ? <span className="text-muted-foreground">Mc ประจำ ไม่ต้องแนบหลักฐาน</span>
                                : <span className="font-semibold text-destructive">ยังไม่มีหลักฐาน</span>}
                              {d.gmv !== null ? <span className="font-semibold tabular-nums">GMV {fmtGmv(d.gmv)}</span>
                                : d.gmvCoveredBy ? <span className="text-success">GMV รวมในคิว {d.gmvCoveredBy}</span>
                                  : <span className="text-muted-foreground">ยังไม่ได้กรอก GMV</span>}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
        <TableFooter className="bg-transparent font-bold">
          <TableRow className="hover:bg-transparent">
            <TableCell className="px-3">รวม {rows.length} คน</TableCell>
            <TableCell className={num_}>{ts}</TableCell>
            <TableCell className={num_}>{num(th)}</TableCell>
            <TableCell />
            <TableCell />
            <TableCell className={num_}>{tl || "–"}</TableCell>
            <TableCell className={num_}>{tb ? `+${tb} น.` : "–"}</TableCell>
            <TableCell className={num_}>
              {(() => {
                const need = rows.flatMap((r) => slotsOf(data, type, r.name)).filter((d) => !d.noProof);
                return need.length ? `${need.filter((d) => d.proof).length}/${need.length}` : "–";
              })()}
            </TableCell>
            <TableCell className={num_}>
              {(() => {
                const g = gmvOf(rows.flatMap((r) => slotsOf(data, type, r.name)));
                return g.count ? fmtGmv(g.total) : "–";
              })()}
            </TableCell>
            <TableCell className={cn(num_, "px-3")}>{tm ? money(tm) : "–"}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
