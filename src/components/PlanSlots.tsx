"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, MinusIcon, PlusIcon, TagIcon, Trash2Icon, Undo2Icon, UserIcon,
  UserXIcon, WandSparklesIcon, XIcon,
} from "lucide-react";
import {
  AppDialog, DialogActions, DialogBody, IconButton, LoadError, LoadingBlock, Notice, PlatformBadge, StateBox, api,
  useConfirm, useToast,
} from "@/components/shared";
import { DatePicker, DateRangePicker, MonthPicker, TimePicker } from "@/components/date-picker";
import { ExportMenu } from "@/components/ExportMenu";
import type { Cell, ExportBook, ExportSheet, RowStyle } from "@/lib/export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtDayLong, fmtDayMonth, fmtWeekShort, monthKey, monthLabel, num, parseKey, todayKey } from "@/lib/format";
import { readLocal, useLocal, writeLocal } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// ---------- ข้อมูล ----------

/** personId = รหัส Mc / Admin ที่ลงชื่อใน slot นั้น (ว่าง = null) */
type Side = { id: number; personId?: number | null; name: string; cancelled: boolean; free: boolean };
type Existing = {
  key: string; date: string; platform: string; start: string; end: string; campaign: string;
  mc: Side | null; admin: (Side & { extra: boolean }) | null;
};
/** แพลนของ Agency (ตาราง agency_slots ไม่ลงชีต) */
type AgencySlot = { id: number; agency: string; platform: string; date: string; start: string; end: string };
type PlanData = {
  month: string; slots: Existing[]; platforms: string[]; campaigns: string[];
  agencySlots: AgencySlot[]; agencyReady: boolean; // agencyReady = false: ยังไม่ได้รัน SQL ตาราง agency_slots
  regulars?: { id: number; name: string }[]; // Mc ประจำ ที่เลือกลงชื่อตอนติ๊กได้
};
/** agency = แพลนของ Agency (เช่น "TDH") ไม่ระบุ / null = slot ของเรา (ลงชีต) / mcId = ลงชื่อ Mc ประจำไว้เลย */
type NewSlot = { date: string; platform: string; start: string; end: string; campaign: string; agency?: string | null; mcId?: number | null };
/** ช่วงวันที่ตั้ง Campaign ไว้ (slot ที่ติ๊กเพิ่มทีหลังในช่วงนี้ได้ Campaign นี้อัตโนมัติ) platform = ALL = ทุกแพลตฟอร์ม */
type CampaignRange = { from: string; to: string; platform: string; campaign: string };
/**
 * ร่างของเดือน: slot ใหม่ (ของเรา + Agency) / Campaign ที่แก้ของ slot เดิม (ตาม key) / slot เดิมที่จะลบ (key)
 *   / ช่วง Campaign / แพลน Agency เดิมที่จะลบ (key ของ Agency) / ลงชื่อ Mc ใน slot เดิมที่ยังว่าง (key -> รหัส Mc)
 */
type Draft = {
  add: NewSlot[]; campaign: Record<string, string>; del: string[]; ranges: CampaignRange[]; agencyDel: string[]; assign: Record<string, number>;
};
/** กลุ่มคอลัมน์ติ๊ก: แพลตฟอร์ม (+ Agency ที่ไลฟ์ผ่านช่องนั้น) */
type Column = { platform: string; agency?: string; times: { start: string; end: string }[] };
/** slot หนึ่งแถวในหน้า (ทั้งที่มีอยู่แล้วและร่างใหม่) agency = แพลนของ Agency (agencyId = มีในระบบแล้ว) */
type Item = {
  key: string; date: string; platform: string; start: string; end: string; campaign: string; agency: string | null;
  existing: Existing | null; agencyId: number | null; deleting: boolean; campaignChanged: boolean; overlap: boolean;
  /** Mc ประจำที่ลงชื่อในร่าง (ยังไม่บันทึก) */
  assign: { id: number; name: string } | null;
};

const EMPTY: Draft = { add: [], campaign: {}, del: [], ranges: [], agencyDel: [], assign: {} };
const DRAFT_KEY = "glory_plan_draft_";
const MONTH_KEY = "glory_plan_month";
const VIEW_KEY = "glory_plan_view";
const MODE_KEY = "glory_plan_mode";
const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const ALL = "__all";
const OURS = "__ours"; // ToggleGroup ใช้ค่าว่างไม่ได้ จึงแทน "ของเรา" ด้วยค่านี้

const keyOf = (s: { platform: string; date: string; start: string; end: string }) => `${s.platform}|${s.date}|${s.start}|${s.end}`;
/** key ของแพลน Agency (แยกจาก slot ของเราที่เวลาเดียวกัน) */
const agencyKey = (agency: string, k: string) => `@${agency}|${k}`;
/** key ของช่องติ๊ก: ของเรา = keyOf / Agency = agencyKey */
const ownKey = (k: string, agency: string | null | undefined) => (agency ? agencyKey(agency, k) : k);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmtMin = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
/** ความยาว slot เป็นนาที (เวลาจบก่อนเวลาเริ่ม = ข้ามเที่ยงคืน) */
const lenOf = (s: { start: string; end: string }) => (toMin(s.end) - toMin(s.start) + 1440) % 1440;
const canDelete = (s: Existing) => (!s.mc || s.mc.free) && (!s.admin || s.admin.free);
const fmtDayNum = (d: string) => `${fmtWeekShort.format(parseKey(d))} ${parseKey(d).getUTCDate()}`;
const fmtRange = (r: { from: string; to: string }) => r.from === r.to ? fmtDayMonth.format(parseKey(r.from))
  : `${parseKey(r.from).getUTCDate()}–${fmtDayMonth.format(parseKey(r.to))}`;
/** ช่วง 2 ชม. ที่เริ่มเวลานี้ */
const two = (start: string) => ({ start, end: fmtMin(toMin(start) + 120) });

/** หน้าแพลน: TikTok (ช่อง GLORY MALL / Skin Expert / Cherry Glory ลงชีต) หรือ Shopee (แพลนในเว็บ ไม่ลงชีต) */
type Mode = "tiktok" | "shopee";
const SHOPEE = "Shopee";
const modeOf = (platform: string): Mode => (platform.trim().toLowerCase() === "shopee" ? "shopee" : "tiktok");

/**
 * วันไลฟ์เริ่ม 07:30 (Shopee 06:00) แล้วไล่ไปจนข้ามเที่ยงคืน (หลังเที่ยงคืนยังนับเป็นวันเดิม เหมือนในชีต)
 * ใช้เรียงคอลัมน์เวลา: เวลาเริ่มวันก่อน ส่วนหลังเที่ยงคืนอยู่ท้าย
 */
const DAY_START = toMin("07:30");
const SHOPEE_START = toMin("06:00");
const dayStartOf = (platform: string) => (modeOf(platform) === "shopee" ? SHOPEE_START : DAY_START);
const dayOrder = (start: string, platform = "") => (toMin(start) - dayStartOf(platform) + 1440) % 1440;
/** ครบ 24 ชม.: ช่วงละ 2 ชม. ตั้งแต่ 07:30 ถึง 07:30 ของคืนนั้น (12 ช่วง) */
const DAY_TIMES = Array.from({ length: 12 }, (_, i) => two(fmtMin(DAY_START + i * 120)));
/** ช่วงเวลา Shopee ตามแท็บ "ลงตาราง MC Shopee" (ยาวไม่เท่ากัน รวม 20 ชม.) */
const SHOPEE_TIMES = [["06:00", "09:00"], ["09:00", "11:00"], ["11:00", "13:00"], ["13:00", "17:00"], ["17:00", "19:00"], ["19:00", "22:00"], ["22:00", "02:00"]]
  .map(([start, end]) => ({ start, end }));

/**
 * ช่องไลฟ์หลัก + ช่วงเวลาให้ติ๊ก เรียงตามคอลัมน์ในหน้า
 * ช่วงเวลาอื่นที่มีในเดือนนั้น / แพลตฟอร์มอื่นที่มี slot จะเพิ่มเป็นคอลัมน์ให้เอง
 * agency = กลุ่มที่แพลนในเว็บ ไม่ลงชีต (เช่น Agency TDH ผ่าน GLORY MALL / Shopee ทั้ง 3 กลุ่ม)
 *   ช่วงเวลาเดียวกันของช่องเดียวกันเป็นของกลุ่มใดกลุ่มหนึ่ง
 */
const CHANNELS: Column[] = [
  { platform: "GLORY MALL", times: DAY_TIMES },
  { platform: "GLORY MALL", agency: "TDH", times: DAY_TIMES },
  { platform: "Skin Expert", times: DAY_TIMES },
  { platform: "Cherry Glory", times: DAY_TIMES },
  { platform: SHOPEE, agency: "In house", times: SHOPEE_TIMES },
  { platform: SHOPEE, agency: "Infinite", times: SHOPEE_TIMES },
  { platform: SHOPEE, agency: "MCN", times: SHOPEE_TIMES },
];
/** ชื่อกลุ่มที่แสดง (ชื่อที่เก็บ -> ชื่อเต็ม) */
const OWNER_LABEL: Record<string, string> = { "In house": "In house", MCN: "MCN" };
const ownerLabel = (agency: string | null | undefined) => (!agency ? "ของเรา" : OWNER_LABEL[agency] ?? `Agency ${agency}`);

function daysOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function parseDraft(raw: string | null): Draft | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw);
    return {
      add: Array.isArray(v?.add) ? v.add : [],
      campaign: v?.campaign && typeof v.campaign === "object" ? v.campaign : {},
      del: Array.isArray(v?.del) ? v.del : [],
      ranges: Array.isArray(v?.ranges) ? v.ranges : [],
      agencyDel: Array.isArray(v?.agencyDel) ? v.agencyDel : [],
      assign: v?.assign && typeof v.assign === "object" ? v.assign : {},
    };
  } catch {
    return null;
  }
}

/** ร่างของเดือนนี้ เก็บในเครื่อง (ปิดหน้าแล้วกลับมาทำต่อได้) ใช้ localStorage ไม่ได้ = จำไว้ในหน้าอย่างเดียว */
function useDraft(month: string) {
  const key = DRAFT_KEY + month;
  const raw = useLocal(key);
  const [mem, setMem] = useState<Record<string, Draft>>({});
  const draft = useMemo(() => parseDraft(raw) ?? mem[month] ?? EMPTY, [raw, mem, month]);
  const update = (fn: (d: Draft) => Draft) => {
    const next = fn(parseDraft(readLocal(key)) ?? mem[month] ?? EMPTY);
    setMem((m) => ({ ...m, [month]: next }));
    writeLocal(key, JSON.stringify(next));
  };
  return [draft, update] as const;
}

// ---------- ส่งออก (Excel / Google Sheet) ----------

// ---------- ส่งออก Shopee แบบตารางส่งทีม (แบบที่ใช้ส่ง Agency / MCN) ----------

/** สีหัวกลุ่ม Shopee (เหมือนชีตที่ทีมใช้) */
const SHOPEE_COLORS: Record<string, string> = { Infinite: "00FFFF", MCN: "FF9900", "In house": "FFFF00" };
const SHOPEE_ORDER = ["Infinite", "MCN", "In house"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayEn = (d: string) => `${Number(d.slice(8))} ${MONTHS_EN[Number(d.slice(5, 7)) - 1]}`;
const clock = (t: string) => `${Number(t.slice(0, 2))}:${t.slice(3, 5)}`; // "08:00" -> "8:00"
const hmText = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

/** slot ของวันเดียวกันที่ต่อกัน (จบ = เริ่มของถัดไป) รวมเป็นช่วงเดียว เช่น 08:00–11:00 + 11:00–13:00 = 08:00–13:00 */
function mergedRanges(list: Item[]) {
  const out: { start: string; end: string; min: number }[] = [];
  for (const x of [...list].sort((a, b) => dayOrder(a.start, a.platform) - dayOrder(b.start, b.platform))) {
    const last = out.at(-1);
    if (last && last.end === x.start) { last.end = x.end; last.min += lenOf(x); }
    else out.push({ start: x.start, end: x.end, min: lenOf(x) });
  }
  return out;
}

/**
 * ตาราง Shopee แบบส่งทีม: หัวตาราง (ดำ) > หัวกลุ่ม (สีของกลุ่ม + ชั่วโมงรวม) > วันละแถว (ช่วงที่ต่อกันรวมเป็นช่วงเดียว)
 *   คอลัมน์: DATE / Time Start / Time End / ชั่วโมง (h:mm) / Total hrs
 */
function shopeeTeamSheet(name: string, groups: { agency: string; items: Item[] }[]): ExportSheet {
  const rows: Cell[][] = [["DATE", "Time Start", "Time End", "", "Total hrs"]];
  const rowStyles: Record<number, RowStyle> = { 0: { bg: "000000", color: "FFFFFF", bold: true } };
  groups.forEach((g, gi) => {
    if (gi > 0) rows.push([]);
    const total = g.items.reduce((m, x) => m + lenOf(x), 0);
    rowStyles[rows.length] = { bg: SHOPEE_COLORS[g.agency] ?? "D9D9D9", bold: true };
    rows.push([ownerLabel(g.agency), "", "", "", { v: total / 60, f: "money" }]);
    const dates = [...new Set(g.items.map((x) => x.date))].sort();
    for (const d of dates) {
      // สลับสีทีละสัปดาห์ (ชมพู / ฟ้า) ให้อ่านง่าย
      const week = Math.floor((Number(d.slice(8)) - 1) / 7);
      for (const r of mergedRanges(g.items.filter((x) => x.date === d))) {
        rowStyles[rows.length] = { bg: week % 2 ? "CFE2F3" : "EAD1DC" };
        rows.push([dayEn(d), clock(r.start), clock(r.end), hmText(r.min), { v: r.min / 60, f: "money" }]);
      }
    }
  });
  return { name, rows, rowStyles };
}

const groupName = (c: Pick<Column, "platform" | "agency">) => (c.agency ? `${c.platform} › ${ownerLabel(c.agency)}` : c.platform);
const hoursCell = (h: number): Cell => (h ? { v: h, f: "dec" } : null);

/**
 * แพลนทั้งเดือนตามที่เห็นในหน้า (รวมร่างที่ยังไม่บันทึก ไม่รวมที่จะลบ)
 *   ภาพรวม = แถววัน x ช่อง/ช่วงเวลา (✓ / ชื่อ Mc / ร่าง) + รวม ชม./วัน ของแต่ละกลุ่ม
 *   สรุปชั่วโมง = ชม./วัน ของแต่ละกลุ่ม / รายการ slot = แบบชีต (ของเรา + Agency)
 */
function planBook(month: string, columns: Column[], items: Item[], mode: Mode = "tiktok"): ExportBook {
  const days = daysOf(month);
  const live = items.filter((x) => !x.deleting && !x.existing?.mc?.cancelled);
  const own = (c: Column, x: Item) => x.platform === c.platform && x.agency === (c.agency ?? null);
  const byKey = new Map(live.map((x) => [x.key, x]));
  const hoursOf = (c: Column, d?: string) => live.filter((x) => own(c, x) && (!d || x.date === d)).reduce((h, x) => h + lenOf(x) / 60, 0);
  const dayText = (d: string) => fmtDayMonth.format(parseKey(d));
  const weekday = (d: string) => fmtWeekShort.format(parseKey(d));
  const mark = (x: Item | undefined) => !x ? ""
    : x.agency ? (x.agencyId ? "✓" : "✓ ร่าง")
      : x.assign ? `Mc ${x.assign.name} (ร่าง)`
        : !x.existing ? "✓ ร่าง"
          : x.existing.mc?.name ? `Mc ${x.existing.mc.name}` : "✓";

  // ภาพรวม: แถว 1 = ชื่อกลุ่ม, แถว 2 = ช่วงเวลา (หัวตาราง)
  const groupRow: Cell[] = ["", ""];
  const head: Cell[] = ["วันที่", "วัน"];
  for (const c of columns) {
    c.times.forEach((t, i) => { groupRow.push(i === 0 ? groupName(c) : ""); head.push(`${t.start}–${t.end}`); });
    groupRow.push("");
    head.push("รวม ชม.");
  }
  groupRow.push("");
  head.push("Campaign");
  const grid: Cell[][] = [groupRow, head];
  for (const d of days) {
    const row: Cell[] = [dayText(d), weekday(d)];
    for (const c of columns) {
      for (const t of c.times) row.push(mark(byKey.get(ownKey(keyOf({ platform: c.platform, date: d, start: t.start, end: t.end }), c.agency))));
      row.push(hoursCell(hoursOf(c, d)));
    }
    row.push([...new Set(live.filter((x) => x.date === d).map((x) => x.campaign).filter(Boolean))].join(", "));
    grid.push(row);
  }
  const totalRow: Cell[] = ["รวมทั้งเดือน", ""];
  for (const c of columns) {
    c.times.forEach((t) => totalRow.push(live.filter((x) => own(c, x) && x.start === t.start && x.end === t.end).length || ""));
    totalRow.push(hoursCell(hoursOf(c)));
  }
  grid.push(totalRow);

  // สรุปชั่วโมงต่อวัน
  const ourCols = columns.filter((c) => !c.agency);
  const sumHead: Cell[] = ["วันที่", "วัน", ...columns.map((c) => `${groupName(c)} (ชม.)`), "รวมของเรา (ชม.)", "รวมทั้งหมด (ชม.)"];
  const sumRow = (d?: string): Cell[] => {
    const ours = ourCols.reduce((h, c) => h + hoursOf(c, d), 0);
    return [...columns.map((c) => hoursCell(hoursOf(c, d))), hoursCell(ours), hoursCell(columns.reduce((h, c) => h + hoursOf(c, d), 0))];
  };
  const summary: Cell[][] = [sumHead, ...days.map((d) => [dayText(d), weekday(d), ...sumRow(d)]), ["รวมทั้งเดือน", "", ...sumRow()]];

  // รายการ slot แบบชีต เรียง: วัน > GLORY MALL ก่อน > แพลตฟอร์ม > เวลา (หลังเที่ยงคืนอยู่ท้ายวัน)
  const sorted = [...live].sort((a, b) => a.date.localeCompare(b.date)
    || Number(a.platform !== "GLORY MALL") - Number(b.platform !== "GLORY MALL") || a.platform.localeCompare(b.platform)
    || Number(!!a.agency) - Number(!!b.agency) || (a.agency ?? "").localeCompare(b.agency ?? "") || dayOrder(a.start, a.platform) - dayOrder(b.start, b.platform));
  const listHead: Cell[] = ["Platform", "วันที่", "วัน", "เวลาเริ่ม", "เวลาจบ", "ชม.", "ผู้ไลฟ์", "Campaign", "Mc", "Admin", "สถานะ"];
  const listRow = (x: Item): Cell[] => [
    x.platform, dayText(x.date), weekday(x.date), x.start, x.end, hoursCell(lenOf(x) / 60),
    ownerLabel(x.agency), x.campaign,
    x.assign ? `Mc ${x.assign.name} (ร่าง)` : x.existing?.mc?.name ? `Mc ${x.existing.mc.name}` : "", x.existing?.admin?.name ?? "",
    x.agency ? (x.agencyId ? "แพลนในเว็บ (ไม่ลงชีต)" : "ร่าง (แพลนในเว็บ)") : x.existing ? "มีในชีตแล้ว" : "ร่าง (ยังไม่บันทึก)",
  ];
  const totalOf = (list: Item[]): Cell[] => ["รวม", "", "", "", `${list.length} slot`, hoursCell(list.reduce((h, x) => h + lenOf(x) / 60, 0))];
  const list: Cell[][] = [listHead, ...sorted.map(listRow), totalOf(sorted)];

  // สรุปรายช่อง + Agency: จำนวน slot / ชั่วโมง / วันที่มีไลฟ์ / Mc จองแล้ว / ยังว่าง / ร่าง
  const used = columns.filter((c) => live.some((x) => own(c, x)));
  const stat = (name: string, list: Item[]): Cell[] => {
    const hours = list.reduce((h, x) => h + lenOf(x) / 60, 0);
    const liveDays = new Set(list.map((x) => x.date)).size;
    const booked = list.filter((x) => x.existing?.mc?.name).length;
    const drafts = list.filter((x) => (x.agency ? !x.agencyId : !x.existing)).length;
    return [
      name, list.length, hoursCell(hours), liveDays, liveDays ? { v: hours / liveDays, f: "dec" } : null,
      list.some((x) => x.agency) ? "" : booked, list.some((x) => x.agency) ? "" : list.length - booked - drafts, drafts,
    ];
  };
  const ourLive = live.filter((x) => !x.agency);
  const agencyLive = live.filter((x) => x.agency);
  const byChannel: Cell[][] = [
    ["ช่อง", "จำนวน slot", "ชั่วโมงรวม", "วันที่มีไลฟ์", "เฉลี่ย ชม./วัน", "Mc จองแล้ว (slot)", "Mc ยังว่าง (slot)", "ร่างยังไม่บันทึก (slot)"],
    ...used.filter((c) => !c.agency).map((c) => stat(c.platform, live.filter((x) => own(c, x)))),
    stat("รวมของเรา (ลงชีต)", ourLive),
    [],
    ...used.filter((c) => c.agency).map((c) => stat(`${ownerLabel(c.agency)} (${c.platform} ไม่ลงชีต)`, live.filter((x) => own(c, x)))),
    ...(agencyLive.length ? [stat("รวมแพลนในเว็บ (ไม่ลงชีต)", agencyLive), []] : []),
    stat("รวมทั้งหมด", live),
  ];

  // แผ่นงานแยกของแต่ละช่อง / Agency (รายการ slot ของกลุ่มนั้น + แถวรวม)
  const perGroup = used.map((c) => {
    const mine = sorted.filter((x) => own(c, x));
    return { name: c.agency ? `${c.platform === SHOPEE ? "Shopee " : ""}${ownerLabel(c.agency)}` : c.platform, rows: [listHead, ...mine.map(listRow), totalOf(mine)] };
  });

  const base: ExportSheet[] = [
    { name: "ภาพรวม", rows: grid, header: 1 },
    { name: "สรุปรายช่อง", rows: byChannel },
    { name: "สรุปชั่วโมงต่อวัน", rows: summary },
  ];
  if (mode === "shopee") {
    // Shopee: ตารางส่งทีมขึ้นก่อน (รวมทุกกลุ่ม + แยกกลุ่ม ไว้ส่งให้ Agency / MCN) แล้วตามด้วยสรุปแบบปกติ
    const agencies = [...new Set(live.filter((x) => x.agency).map((x) => x.agency!))]
      .sort((a, b) => (SHOPEE_ORDER.indexOf(a) + 1 || 99) - (SHOPEE_ORDER.indexOf(b) + 1 || 99));
    const groups = agencies.map((agency) => ({ agency, items: live.filter((x) => x.agency === agency) }));
    return {
      title: `Plan Slot Live Shopee ${monthLabel(month)}`,
      sheets: [
        shopeeTeamSheet("Shopee ทุกกลุ่ม", groups),
        ...groups.map((g) => shopeeTeamSheet(ownerLabel(g.agency), [g])),
        ...base,
        { name: "รายการ slot ทั้งหมด", rows: list },
      ],
    };
  }
  return {
    title: `Plan Slot Live ${monthLabel(month)}`,
    sheets: [...base, ...perGroup, { name: "รายการ slot ทั้งหมด", rows: list }],
  };
}

// ---------- หน้า ----------

/** หน้า Plan Slot Live: แพลน slot ทั้งเดือน (ร่างก่อน) แล้วกดบันทึกลงชีตทั้ง Deal Mc + Admin เสริม */
export function PlanSlots() {
  const toast = useToast();
  const confirm = useConfirm();
  const savedMonth = useLocal(MONTH_KEY);
  const month = savedMonth && /^\d{4}-\d{2}$/.test(savedMonth) ? savedMonth : monthKey();
  const setMonth = (m: string) => writeLocal(MONTH_KEY, m);
  const view = useLocal(VIEW_KEY) === "sheet" ? "sheet" : "tick";
  const mode: Mode = useLocal(MODE_KEY) === "shopee" ? "shopee" : "tiktok";
  const [data, setData] = useState<PlanData | null>(null);
  const [error, setError] = useState<{ month: string; message: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [draft, update] = useDraft(month);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api<PlanData>(`/api/plan?month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(null); }
      })
      .catch((err) => { if (alive) setError({ month, message: (err as Error).message }); });
    return () => { alive = false; };
  }, [month, tick]);

  const plan = data?.month === month ? data : null;
  // "ติ๊กเป็น": null = slot ว่าง (เปิดให้ Mc จอง) / รหัส Mc ประจำ = ลงชื่อ Mc คนนั้นในช่องที่ติ๊ก (เฉพาะ TikTok ช่องของเรา)
  const [brush, setBrush] = useState<number | null>(null);
  const regulars = plan?.regulars ?? [];
  const brushId = mode === "tiktok" && regulars.some((m) => m.id === brush) ? brush : null;
  const existingMap = useMemo(() => new Map((plan?.slots ?? []).map((s) => [s.key, s])), [plan]);
  const agencyMap = useMemo(() => new Map((plan?.agencySlots ?? []).map((s) => [agencyKey(s.agency, keyOf(s)), s])), [plan]);

  // รวม slot เดิม + ร่างใหม่ (ของเรา + แพลน Agency) เรียงตามชีต (วัน > แพลตฟอร์ม > เวลา) และหาเวลาที่ทับกันในแพลตฟอร์มเดียวกัน
  const items = useMemo<Item[]>(() => {
    if (!plan) return [];
    const del = new Set(draft.del);
    const agencyDel = new Set(draft.agencyDel);
    const regular = new Map((plan.regulars ?? []).map((m) => [m.id, m.name]));
    const assignOf = (id: number | null | undefined) => (id ? { id, name: regular.get(id) ?? `#${id}` } : null);
    const list: Item[] = [
      ...plan.slots.map((s) => {
        const campaign = draft.campaign[s.key] ?? s.campaign;
        return {
          key: s.key, date: s.date, platform: s.platform, start: s.start, end: s.end, campaign, agency: null,
          existing: s, agencyId: null, deleting: del.has(s.key), campaignChanged: !!s.mc && campaign !== s.campaign, overlap: false,
          assign: s.mc?.free ? assignOf(draft.assign[s.key]) : null,
        };
      }),
      ...plan.agencySlots.map((s) => {
        const key = agencyKey(s.agency, keyOf(s));
        return {
          key, date: s.date, platform: s.platform, start: s.start, end: s.end, campaign: "", agency: s.agency,
          existing: null, agencyId: s.id, deleting: agencyDel.has(key), campaignChanged: false, overlap: false, assign: null,
        };
      }),
      ...draft.add.filter((s) => s.date.startsWith(month) && (s.agency ? !agencyMap.has(agencyKey(s.agency, keyOf(s))) : !existingMap.has(keyOf(s))))
        .map((s) => ({
          ...s, campaign: s.agency ? "" : s.campaign, agency: s.agency ?? null, key: ownKey(keyOf(s), s.agency),
          existing: null, agencyId: null, deleting: false, campaignChanged: false, overlap: false, assign: s.agency ? null : assignOf(s.mcId),
        })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform) || dayOrder(a.start, a.platform) - dayOrder(b.start, b.platform));
    // เวลาทับกันในช่องเดียวกัน (รวมของเรากับ Agency เพราะไลฟ์ช่องเดียวกัน)
    const live = list.filter((x) => !x.deleting && !x.existing?.mc?.cancelled);
    for (let i = 1; i < live.length; i++) {
      const a = live[i - 1], b = live[i];
      if (a.date === b.date && a.platform === b.platform && dayOrder(b.start, b.platform) < dayOrder(a.start, a.platform) + lenOf(a)) a.overlap = b.overlap = true;
    }
    return list;
  }, [plan, draft, month, existingMap, agencyMap]);
  /** slot ของเรา (ลงชีต) — ใช้กับแบบชีต / Campaign / แก้รายวัน */
  const ours = useMemo(() => items.filter((x) => !x.agency), [items]);

  // คอลัมน์ติ๊ก: ช่องหลัก (+ ช่วงเวลาอื่นที่มีในเดือนนี้) แล้วต่อด้วยแพลตฟอร์มอื่นที่มี slot
  const columns = useMemo<Column[]>(() => {
    const cols = CHANNELS.map((c) => ({ platform: c.platform, agency: c.agency, set: new Set(c.times.map((t) => `${t.start}-${t.end}`)) }));
    for (const x of items) {
      let col = cols.find((c) => c.platform === x.platform && (c.agency ?? null) === x.agency);
      if (!col) cols.push(col = { platform: x.platform, agency: x.agency ?? undefined, set: new Set() });
      col.set.add(`${x.start}-${x.end}`);
    }
    return cols.map((c) => ({
      platform: c.platform, agency: c.agency,
      times: [...c.set].map((t) => ({ start: t.slice(0, 5), end: t.slice(6, 11) }))
        .sort((a, b) => dayOrder(a.start, c.platform) - dayOrder(b.start, c.platform) || lenOf(a) - lenOf(b)),
    }));
  }, [items]);
  const platforms = [...new Set(columns.map((c) => c.platform))];
  const tagIndex = (p: string) => Math.max(0, platforms.indexOf(p)) % 4;

  /** Campaign ของช่วงวันที่ตั้งไว้ (ช่วงที่ตั้งทีหลังชนะ) */
  const campaignFor = (date: string, platform: string) =>
    draft.ranges.findLast((r) => r.from <= date && date <= r.to && (r.platform === ALL || r.platform === platform))?.campaign ?? "";

  // สิ่งที่จะบันทึก
  const changes = useMemo(() => {
    const create = ours.filter((x) => !x.existing);
    const campaigns = ours.filter((x) => x.existing?.mc && x.campaignChanged && !x.deleting)
      .map((x) => ({ mcId: x.existing!.mc!.id, campaign: x.campaign }));
    const deletes = ours.filter((x) => x.deleting && x.existing && canDelete(x.existing)).map((x) => x.existing!);
    const agencyCreate = items.filter((x) => x.agency && !x.agencyId);
    const agencyDelete = items.filter((x) => x.agencyId && x.deleting).map((x) => x.agencyId!);
    // ลงชื่อ Mc ประจำใน slot เดิมที่ยังว่าง
    const assigns = ours.filter((x) => x.existing?.mc && x.assign && !x.deleting)
      .map((x) => ({ slotId: x.existing!.mc!.id, personId: x.assign!.id }));
    return {
      create, campaigns, deletes, agencyCreate, agencyDelete, assigns,
      total: create.length + campaigns.length + deletes.length + agencyCreate.length + agencyDelete.length + assigns.length,
    };
  }, [items, ours]);

  // ---------- ติ๊ก ----------
  // ช่องเดียวกัน (แพลตฟอร์ม + วัน + เวลา) เป็นของเรา (agency = null) หรือของ Agency อย่างใดอย่างหนึ่ง

  /** ช่อง k ของเจ้าของ agency ติ๊กอยู่ในร่าง d หรือไม่ */
  function isOn(d: Draft, k: string, agency: string | null) {
    if (agency) {
      const ak = agencyKey(agency, k);
      if (agencyMap.has(ak)) return !d.agencyDel.includes(ak);
      return d.add.some((s) => s.agency === agency && keyOf(s) === k);
    }
    if (existingMap.has(k)) return !d.del.includes(k);
    return d.add.some((s) => !s.agency && keyOf(s) === k);
  }
  /** เจ้าของอื่นที่ติ๊กช่อง k อยู่ (undefined = ไม่มี) ของเรา = null */
  function otherOwner(d: Draft, k: string, agency: string | null, platform: string): string | null | undefined {
    const owners = [null, ...CHANNELS.filter((c) => c.platform === platform && c.agency).map((c) => c.agency!)];
    for (const a of [...owners, ...d.add.filter((s) => s.agency && keyOf(s) === k).map((s) => s.agency!)]) {
      if (a !== agency && isOn(d, k, a)) return a;
    }
    return undefined;
  }
  /** ติ๊ก: ร่างใหม่ / ยกเลิกการลบ slot เดิม */
  function withOn(d: Draft, slot: Omit<NewSlot, "campaign">, agency: string | null, campaign?: string): Draft {
    const k = keyOf(slot);
    if (agency) {
      const ak = agencyKey(agency, k);
      if (agencyMap.has(ak)) return { ...d, agencyDel: d.agencyDel.filter((x) => x !== ak) };
      return { ...d, add: [...d.add, { ...slot, agency, campaign: "" }] };
    }
    if (existingMap.has(k)) return { ...d, del: d.del.filter((x) => x !== k) };
    return { ...d, add: [...d.add, { ...slot, agency: null, campaign: campaign ?? campaignFor(slot.date, slot.platform) }] };
  }
  /** เอาติ๊กออก: ร่างใหม่ = ลบจากร่าง / ของเดิม = ลบตอนบันทึก (ชื่อ Mc ที่ลงไว้ในร่างหายด้วย) */
  function withOff(d: Draft, k: string, agency: string | null): Draft {
    if (!agency && d.assign[k]) d = withMc(d, k, null);
    if (agency) {
      const ak = agencyKey(agency, k);
      if (agencyMap.has(ak)) return { ...d, agencyDel: d.agencyDel.includes(ak) ? d.agencyDel : [...d.agencyDel, ak] };
      return { ...d, add: d.add.filter((s) => !(s.agency === agency && keyOf(s) === k)) };
    }
    if (existingMap.has(k)) return { ...d, del: d.del.includes(k) ? d.del : [...d.del, k] };
    return { ...d, add: d.add.filter((s) => !(!s.agency && keyOf(s) === k)) };
  }
  /** slot ของเราที่มีคนจองแล้ว เอาออกไม่ได้ */
  const locked = (k: string, agency: string | null) => {
    const ex = agency ? undefined : existingMap.get(k);
    return !!ex && !canDelete(ex);
  };
  const lockedMsg = "slot นี้มีคนจองแล้ว แก้ไม่ได้ (เอาคนออกที่หน้าจัดการ slot ก่อน)";
  const ownerName = ownerLabel;

  // ---------- ลงชื่อ Mc ประจำตอนติ๊ก (เลือกที่ "ติ๊กเป็น") ----------

  /** Mc ที่ลงชื่อในร่างของช่อง k (slot ของเรา): ร่างใหม่ = mcId / slot เดิม = assign */
  function mcOf(d: Draft, k: string): number | null {
    if (existingMap.has(k)) return d.del.includes(k) ? null : d.assign[k] ?? null;
    return d.add.find((s) => !s.agency && keyOf(s) === k)?.mcId ?? null;
  }
  function withMc(d: Draft, k: string, mcId: number | null): Draft {
    if (existingMap.has(k)) {
      const assign = { ...d.assign };
      if (mcId) assign[k] = mcId;
      else delete assign[k];
      return { ...d, assign };
    }
    return { ...d, add: d.add.map((s) => (!s.agency && keyOf(s) === k ? { ...s, mcId } : s)) };
  }
  /** Mc คนนี้มีไลฟ์เวลาทับกันในวันนั้นแล้วหรือไม่ (ช่องอื่น) คืนข้อความแจ้ง */
  function mcBusy(d: Draft, mcId: number, slot: { date: string; platform: string; start: string; end: string }) {
    const k = keyOf(slot);
    const from = dayOrder(slot.start, slot.platform), to = from + lenOf(slot);
    const mine = [
      ...(plan?.slots ?? []).filter((s) => !d.del.includes(s.key) && !s.mc?.cancelled && (s.mc?.personId === mcId || d.assign[s.key] === mcId)),
      ...d.add.filter((s) => !s.agency && s.mcId === mcId),
    ];
    const hit = mine.find((s) => s.date === slot.date && keyOf(s) !== k
      && dayOrder(s.start, s.platform) < to && from < dayOrder(s.start, s.platform) + lenOf(s));
    return hit ? `Mc ${regulars.find((m) => m.id === mcId)?.name ?? ""} มีไลฟ์ ${hit.platform} ${hit.start}–${hit.end} วันนี้อยู่แล้ว (เวลาทับกัน)` : null;
  }
  /** ติ๊กด้วย Mc ประจำ: ช่องว่าง = สร้างพร้อมชื่อ / slot ว่าง = ลงชื่อ / ช่องที่ลงชื่อ Mc นี้ในร่างแล้ว = ยกเลิก */
  function brushCell(slot: { date: string; platform: string; start: string; end: string }, mcId: number) {
    const k = keyOf(slot);
    const ex = existingMap.get(k);
    const name = `Mc ${regulars.find((m) => m.id === mcId)?.name ?? ""}`;
    if (ex?.mc && !ex.mc.free) { toast(ex.mc.personId === mcId ? `slot นี้ ${name} อยู่แล้ว` : lockedMsg, "error"); return; }
    const on = isOn(draft, k, null);
    if (on && mcOf(draft, k) === mcId) {
      // กดซ้ำ: slot เดิม = เอาชื่อออก (slot ยังอยู่) / ร่างใหม่ = เอาออกจากร่าง
      update((d) => (ex ? withMc(d, k, null) : withOff(d, k, null)));
      return;
    }
    const busy = mcBusy(draft, mcId, slot);
    if (busy) { toast(busy, "error"); return; }
    const other = otherOwner(draft, k, null, slot.platform);
    if (other !== undefined) {
      if (locked(k, other)) { toast(`เวลานี้มี slot ${ownerName(other)}ที่มีคนจองแล้ว ย้ายไม่ได้`, "error"); return; }
      update((d) => withMc(withOn(withOff(d, k, other), slot, null), k, mcId));
      toast(`ย้าย ${slot.platform} ${slot.start}–${slot.end} จาก ${ownerName(other)} เป็น ${name}`);
      return;
    }
    update((d) => withMc(on ? d : withOn(d, slot, null), k, mcId));
  }
  /** หัวคอลัมน์ด้วย Mc ประจำ: ลงชื่อทุกวัน (ตั้งแต่วันนี้) ถ้าลงครบแล้ว = ยกเลิกทั้งหมด */
  function brushColumn(platform: string, t: { start: string; end: string }, mcId: number) {
    const today = todayKey();
    const slots = daysOf(month).filter((d) => d >= today).map((date) => ({ date, platform, start: t.start, end: t.end }));
    if (!slots.length) { toast("เดือนนี้ผ่านไปแล้ว", "error"); return; }
    const allOn = slots.every((s) => mcOf(draft, keyOf(s)) === mcId || existingMap.get(keyOf(s))?.mc?.personId === mcId);
    let kept = 0;
    let next = draft;
    for (const s of slots) {
      const k = keyOf(s);
      const ex = existingMap.get(k);
      if (allOn) {
        if (mcOf(next, k) === mcId) next = ex ? withMc(next, k, null) : withOff(next, k, null);
      } else if (mcOf(next, k) !== mcId) {
        if ((ex?.mc && !ex.mc.free) || otherOwner(next, k, null, platform) !== undefined || mcBusy(next, mcId, s)) kept++;
        else next = withMc(isOn(next, k, null) ? next : withOn(next, s, null), k, mcId);
      }
    }
    const result = next;
    update(() => result);
    const name = `Mc ${regulars.find((m) => m.id === mcId)?.name ?? ""}`;
    toast(`${allOn ? `ยกเลิก ${name}` : `ลงชื่อ ${name}`} ${platform} ${t.start}–${t.end} ตั้งแต่วันนี้ถึงสิ้นเดือน`
      + (kept ? ` (ข้าม ${kept} slot ที่มีคนจอง / เป็นของ Agency / เวลาทับ)` : ""));
  }

  /** ติ๊ก / เอาติ๊กออก 1 ช่อง ถ้าอีกฝั่งติ๊กเวลานี้อยู่ = ย้ายมาฝั่งนี้ (เอาออกจากอีกฝั่ง) */
  function toggleCell(date: string, platform: string, t: { start: string; end: string }, agency: string | null = null) {
    const slot = { date, platform, start: t.start, end: t.end };
    const k = keyOf(slot);
    if (!agency && brushId) { brushCell(slot, brushId); return; }
    if (isOn(draft, k, agency)) {
      if (locked(k, agency)) { toast(lockedMsg, "error"); return; }
      update((d) => withOff(d, k, agency));
      return;
    }
    const other = otherOwner(draft, k, agency, platform);
    if (other !== undefined) {
      if (locked(k, other)) { toast(`เวลานี้มี slot ${ownerName(other)}ที่มีคนจองแล้ว ย้ายไม่ได้`, "error"); return; }
      update((d) => withOn(withOff(d, k, other), slot, agency));
      toast(`ย้าย ${platform} ${t.start}–${t.end} จาก ${ownerName(other)} เป็น ${ownerName(agency)}`);
      return;
    }
    update((d) => withOn(d, slot, agency));
  }

  /** กดหัวคอลัมน์: ติ๊กเวลานี้ทุกวัน (ตั้งแต่วันนี้) ถ้าติ๊กครบแล้ว = เอาติ๊กออกทั้งหมด (slot ที่มีคนจอง / เป็นของอีกฝั่ง คงไว้) */
  function toggleColumn(platform: string, t: { start: string; end: string }, agency: string | null = null) {
    if (!agency && brushId) { brushColumn(platform, t, brushId); return; }
    const today = todayKey();
    const slots = daysOf(month).filter((d) => d >= today).map((date) => ({ date, platform, start: t.start, end: t.end }));
    if (!slots.length) { toast("เดือนนี้ผ่านไปแล้ว", "error"); return; }
    const allOn = slots.every((s) => isOn(draft, keyOf(s), agency));
    let kept = 0;
    let next = draft;
    for (const s of slots) {
      const k = keyOf(s);
      if (allOn) {
        if (locked(k, agency)) kept++;
        else next = withOff(next, k, agency);
      } else if (!isOn(next, k, agency)) {
        if (otherOwner(next, k, agency, platform) !== undefined) kept++; // เป็นของอีกฝั่งอยู่แล้ว ไม่ย้ายให้ทั้งคอลัมน์
        else next = withOn(next, s, agency);
      }
    }
    const result = next;
    update(() => result);
    toast(`${allOn ? "เอาติ๊กออก" : "ติ๊ก"} ${agency ? `${ownerLabel(agency)} ` : ""}${platform} ${t.start}–${t.end} ตั้งแต่วันนี้ถึงสิ้นเดือน`
      + (kept ? ` (คงไว้ ${kept} slot ที่มีคนจองแล้ว / เป็นของอีกฝั่ง)` : ""));
  }

  // เพิ่ม slot ลงร่าง (ข้ามที่มีอยู่แล้ว / เวลาที่อีกฝั่งใช้อยู่ ถ้าเป็นของเดิมที่กดลบไว้ = ยกเลิกการลบ)
  function addSlots(list: NewSlot[]) {
    let next = draft;
    let added = 0, skipped = 0;
    for (const s of list) {
      const k = keyOf(s);
      const agency = s.agency ?? null;
      if (isOn(next, k, agency) || otherOwner(next, k, agency, s.platform) !== undefined) { skipped++; continue; }
      next = withOn(next, s, agency, s.campaign);
      added++;
    }
    const result = next;
    update(() => result);
    return { added, skipped };
  }
  const report = ({ added, skipped }: { added: number; skipped: number }) =>
    toast(added ? `เพิ่มลงร่าง ${added} slot${skipped ? ` (ข้าม ${skipped} ที่มีอยู่แล้ว)` : ""}` : "ไม่มี slot ใหม่ (มีอยู่แล้วทั้งหมด)");

  const removeNew = (key: string) => update((d) => ({ ...d, add: d.add.filter((s) => s.agency || keyOf(s) !== key) }));
  const toggleDelete = (key: string) =>
    update((d) => ({ ...d, del: d.del.includes(key) ? d.del.filter((k) => k !== key) : [...d.del, key] }));

  /** ตั้ง Campaign ให้หลาย slot ของเรา (ร่างใหม่ = แก้ในร่าง / slot เดิม = จดว่าจะแก้) */
  const setCampaign = (keys: string[], campaign: string) => update(withCampaign(keys, campaign));
  function withCampaign(keys: string[], campaign: string) {
    const want = new Set(keys);
    return (d: Draft): Draft => {
      const next = { ...d.campaign };
      for (const k of want) {
        const s = existingMap.get(k);
        if (!s?.mc) continue;
        if (campaign === s.campaign) delete next[k];
        else next[k] = campaign;
      }
      return { ...d, add: d.add.map((s) => (!s.agency && want.has(keyOf(s)) ? { ...s, campaign } : s)), campaign: next };
    };
  }

  /** ตั้ง Campaign ทั้งช่วงวัน: slot ที่มีตอนนี้ + จำช่วงไว้ให้ slot ที่ติ๊กเพิ่มทีหลัง (ว่าง = ล้าง) */
  function applyRange(r: CampaignRange) {
    const keys = ours.filter((x) => x.date >= r.from && x.date <= r.to && (r.platform === ALL || x.platform === r.platform)
      && !x.deleting && (!x.existing || x.existing.mc)).map((x) => x.key);
    update((d) => {
      const n = withCampaign(keys, r.campaign)(d);
      const others = n.ranges.filter((x) => !(x.from === r.from && x.to === r.to && x.platform === r.platform));
      return { ...n, ranges: r.campaign ? [...others, r] : others };
    });
    toast(`ตั้ง Campaign ${keys.length} slot ในร่างแล้ว${r.campaign ? " — slot ที่ติ๊กเพิ่มในช่วงนี้จะได้ Campaign นี้ด้วย" : ""}`);
  }
  const removeRange = (i: number) => update((d) => ({ ...d, ranges: d.ranges.filter((_, j) => j !== i) }));

  async function copyPrevMonth() {
    const prev = monthKey(-1, month);
    try {
      const res = await api<PlanData>(`/api/plan?month=${prev}`);
      if (!res.ok) throw new Error(res.message);
      // ช่วงเวลาที่ใช้บ่อยของแต่ละวันในสัปดาห์ (อย่างน้อยครึ่งหนึ่งของวันนั้นๆ ที่มีไลฟ์แพลตฟอร์มนั้น)
      const days = new Map<string, Set<string>>();
      const freq = new Map<string, { platform: string; wd: number; start: string; end: string; agency: string | null; mcId: number | null; n: number }>();
      const prevSlots = [
        // Mc ประจำที่ลงชื่อเดือนก่อน คัดลอกชื่อมาด้วย (Mc ทั่วไปจองเองผ่านเว็บ)
        ...res.slots.filter((s) => !s.mc?.cancelled).map((s) => ({
          ...s, agency: null as string | null, mcId: regulars.some((m) => m.id === s.mc?.personId) ? s.mc!.personId! : null,
        })),
        ...(res.agencySlots ?? []).map((s) => ({ ...s, agency: s.agency as string | null, mcId: null as number | null })),
      ];
      for (const s of prevSlots) {
        const wd = parseKey(s.date).getUTCDay();
        const pk = `${s.platform}|${wd}`;
        days.set(pk, (days.get(pk) ?? new Set()).add(s.date));
        // เวลาเดียวกันแต่คนละเจ้าของ (ของเรา / Agency) นับแยกกัน
        const tk = `${pk}|${s.start}|${s.end}|${s.agency ?? ""}|${s.mcId ?? ""}`;
        const cur = freq.get(tk) ?? { platform: s.platform, wd, start: s.start, end: s.end, agency: s.agency, mcId: s.mcId, n: 0 };
        freq.set(tk, { ...cur, n: cur.n + 1 });
      }
      const pattern = [...freq.values()].filter((p) => p.n >= Math.max(1, Math.ceil((days.get(`${p.platform}|${p.wd}`)?.size ?? 0) / 2)));
      if (!pattern.length) { toast(`${monthLabel(prev)} ไม่มี slot ให้คัดลอก`, "error"); return; }
      const from = month === todayKey().slice(0, 7) ? todayKey() : `${month}-01`;
      const list = daysOf(month).filter((d) => d >= from).flatMap((d) => {
        const wd = parseKey(d).getUTCDay();
        return pattern.filter((p) => p.wd === wd)
          .map((p) => ({ date: d, platform: p.platform, start: p.start, end: p.end, agency: p.agency, mcId: p.mcId, campaign: "" }));
      });
      const ok = await confirm({
        title: `คัดลอกรูปแบบจาก ${monthLabel(prev)}?`,
        description: `ใช้ช่วงเวลาที่ไลฟ์ประจำของแต่ละวันในสัปดาห์ (${[...new Set(pattern.map((p) => p.platform))].join(", ")}) `
          + `มาเติมลงร่าง${from > `${month}-01` ? "ตั้งแต่วันนี้" : "ทั้งเดือน"} ประมาณ ${list.length} slot (slot ที่มีอยู่แล้วจะถูกข้าม) แก้ในร่างได้ก่อนบันทึก`,
        confirmText: "เติมลงร่าง",
      });
      if (ok) report(addSlots(list));
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function save() {
    const { create, campaigns, deletes, agencyCreate, agencyDelete, assigns } = changes;
    const named = create.filter((s) => s.assign).length + assigns.length;
    const ok = await confirm({
      title: `บันทึกแพลน ${monthLabel(month)}?`,
      description: [
        create.length ? `สร้าง ${create.length} slot (เขียนทั้งแท็บ Deal Mc และ Admin เสริม)` : "",
        named ? `ลงชื่อ Mc ประจำ ${named} slot (ลงชีต + ปฏิทินให้)` : "",
        campaigns.length ? `แก้ Campaign ${campaigns.length} slot` : "",
        deletes.length ? `ลบ ${deletes.length} slot ที่ยังว่าง` : "",
        agencyCreate.length || agencyDelete.length
          ? `แพลนในเว็บ (Agency / Shopee) +${agencyCreate.length} / ลบ ${agencyDelete.length} slot (เก็บในเว็บ ไม่ลงชีต)` : "",
      ].filter(Boolean).join(" · "),
      confirmText: "บันทึก",
    });
    if (!ok) return;
    setSaving(true);
    try {
      if (deletes.length) {
        const res = await api<{ deleted: number; kept: number }>("/api/plan", {
          slots: deletes.map((s) => ({ mcId: s.mc?.id, adminId: s.admin?.id })),
        }, "DELETE");
        if (!res.ok) throw new Error(res.message);
        update((d) => ({ ...d, del: [] }));
        if (res.kept) toast(`มี ${res.kept} slot ที่มีคนจองแล้ว ไม่ได้ลบ`, "error");
      }
      if (create.length || campaigns.length || agencyCreate.length || agencyDelete.length || assigns.length) {
        const res = await api<{ created: number; skipped: number; updated: number; assignSkipped: number }>("/api/plan", {
          create: create.map((s) => ({
            date: s.date, platform: s.platform, start: s.start, end: s.end, campaign: s.campaign, mcId: s.assign?.id ?? null,
          })),
          campaigns,
          agencyCreate: agencyCreate.map((s) => ({ agency: s.agency, date: s.date, platform: s.platform, start: s.start, end: s.end })),
          agencyDelete,
          assigns,
        });
        if (!res.ok) throw new Error(res.message);
        if (res.assignSkipped) toast(`มี ${res.assignSkipped} slot ที่มี Mc จองเข้ามาก่อน ไม่ได้ลงชื่อ Mc ประจำ`, "error");
      }
      update((d) => ({ ...EMPTY, ranges: d.ranges }));
      toast(create.length || campaigns.length || deletes.length || assigns.length
        ? "บันทึกแล้ว ระบบกำลังเขียนลงชีต (อาจใช้เวลา 1–2 นาที)" : "บันทึกแพลนในเว็บแล้ว");
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function clearDraft() {
    if (!(await confirm({ title: "ล้างร่างของเดือนนี้ทั้งหมด?", description: "slot ที่บันทึกลงชีตแล้วไม่หาย", confirmText: "ล้างร่าง", destructive: true }))) return;
    update(() => EMPTY);
  }

  // แสดงเฉพาะโหมดที่เลือก (TikTok / Shopee) ร่างของทั้งสองโหมดบันทึกพร้อมกัน
  const shownColumns = columns.filter((c) => modeOf(c.platform) === mode);
  const shownItems = items.filter((x) => modeOf(x.platform) === mode);
  const shownMap = new Map(shownItems.map((x) => [x.key, x]));
  const shownPlatforms = [...new Set(shownColumns.map((c) => c.platform))];
  // สรุปบนตาราง: slot ของเรา (ลงชีต) แยกกับแพลนในเว็บ (Agency / Shopee)
  const live = shownItems.filter((x) => !x.agency && !x.deleting && !x.existing?.mc?.cancelled);
  const hours = live.reduce((h, x) => h + lenOf(x) / 60, 0);
  const agencyLive = shownItems.filter((x) => x.agency && !x.deleting);
  const agencyNames = [...new Set(agencyLive.map((x) => x.agency!))];
  const days = daysOf(month);
  const overlaps = shownItems.filter((x) => x.overlap).length;
  const allHours = [...live, ...agencyLive].reduce((h, x) => h + lenOf(x) / 60, 0);
  /** ชั่วโมงรวมของรายการ slot */
  const hrs = (list: { start: string; end: string }[]) => list.reduce((h, x) => h + lenOf(x) / 60, 0);
  // ร่างที่ลงชื่อ Mc ประจำ (slot ใหม่ที่มีชื่อ + slot เดิมที่ลงชื่อ)
  const namedDraft = ours.filter((x) => x.assign && !x.deleting);
  // ชั่วโมง Mc ประจำเดือนนี้: ลงชีตแล้ว (ชื่ออยู่ใน slot แล้ว) / ในร่าง
  const regularHours = regulars.map((m) => {
    const saved = ours.filter((x) => !x.deleting && !x.existing?.mc?.cancelled && x.existing?.mc?.personId === m.id);
    const draftOnes = namedDraft.filter((x) => x.assign!.id === m.id);
    return { ...m, saved: hrs(saved), draft: hrs(draftOnes), slots: saved.length + draftOnes.length };
  });

  return (
    <div className="pb-28">
      <div className="my-2 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={mode}
          onValueChange={(v) => { if (v) writeLocal(MODE_KEY, v); }}
          aria-label="แพลนของ"
          className="bg-card"
        >
          <ToggleGroupItem value="tiktok" className="font-semibold">TikTok</ToggleGroupItem>
          <ToggleGroupItem value="shopee" className="font-semibold">Shopee</ToggleGroupItem>
        </ToggleGroup>
        <IconButton label="เดือนก่อนหน้า" onClick={() => setMonth(monthKey(-1, month))}><ChevronLeftIcon /></IconButton>
        <MonthPicker value={month} onChange={setMonth} aria-label="เลือกเดือน" className="w-auto rounded-full" />
        <IconButton label="เดือนถัดไป" onClick={() => setMonth(monthKey(1, month))}><ChevronRightIcon /></IconButton>
        {mode === "tiktok" ? (
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={view}
            onValueChange={(v) => { if (v) writeLocal(VIEW_KEY, v); }}
            aria-label="มุมมอง"
            className="ml-auto bg-card"
          >
            <ToggleGroupItem value="tick" className="font-semibold">ติ๊กเลือก slot</ToggleGroupItem>
            <ToggleGroupItem value="sheet" className="font-semibold">แบบชีต</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        {plan ? (
          <ExportMenu
            label="ส่งออก"
            build={() => planBook(month, shownColumns, shownItems, mode)}
            className={cn("bg-card", mode === "shopee" && "ml-auto")}
          />
        ) : null}
      </div>

      {error?.month === month && !plan ? (
        <LoadError title="โหลดแพลนไม่สำเร็จ" message={error.message} onRetry={reload} />
      ) : !plan ? (
        <LoadingBlock />
      ) : (
        <>
          <PatternPanel
            key={`${month}-${mode}`}
            month={month}
            platforms={mode === "shopee" ? shownPlatforms : [...new Set([...shownPlatforms, ...plan.platforms.filter((p) => modeOf(p) === mode)])]}
            campaigns={plan.campaigns}
            onAdd={(list) => report(addSlots(list))}
            onCopyPrev={copyPrevMonth}
          />
          {mode === "tiktok" ? (
            <CampaignPanel
              key={`c-${month}`}
              month={month}
              items={ours.filter((x) => modeOf(x.platform) === "tiktok")}
              platforms={shownPlatforms}
              ranges={draft.ranges}
              onApply={applyRange}
              onRemove={removeRange}
            />
          ) : null}
          <datalist id="plan-campaigns">{plan.campaigns.map((c) => <option key={c} value={c} />)}</datalist>
          <datalist id="plan-platforms">{[...new Set([...platforms, ...plan.platforms])].map((p) => <option key={p} value={p} />)}</datalist>

          <div className="mt-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <strong className="text-base">{mode === "shopee" ? "Shopee " : ""}{monthLabel(month)}</strong>
            <span className="text-muted-foreground tabular-nums">
              {mode === "shopee" ? `${agencyLive.length} slot · ${num(allHours)} ชม.` : `${live.length} slot · ${num(hours)} ชม.`}
            </span>
            {shownPlatforms.map((p) => {
              const mine = live.filter((x) => x.platform === p);
              return !mine.length ? null : (
                <span key={p} className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                  <PlatformBadge name={p} index={tagIndex(p)} />{mine.length} slot · {num(mine.reduce((h, x) => h + lenOf(x) / 60, 0))} ชม.
                </span>
              );
            })}
            {agencyNames.map((a) => {
              const mine = agencyLive.filter((x) => x.agency === a);
              return (
                <span key={a} className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                  <Badge className="bg-foreground text-[11px] font-semibold text-background">{ownerLabel(a)}</Badge>
                  {mine.length} slot · {num(mine.reduce((h, x) => h + lenOf(x) / 60, 0))} ชม.{mode === "tiktok" ? " (ไม่ลงชีต)" : ""}
                </span>
              );
            })}
          </div>
          {!plan.agencyReady ? (
            <Notice variant="warning">ยังบันทึกแพลนของ Agency ไม่ได้ ต้องรัน SQL 20261017000000_plan_slots ใน Supabase ก่อน (ติ๊กดูในร่างได้)</Notice>
          ) : null}
          {mode === "tiktok" && regulars.length ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
              <span className="font-semibold">ติ๊กเป็น</span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={brushId ? String(brushId) : "open"}
                onValueChange={(v) => { if (v) setBrush(v === "open" ? null : Number(v)); }}
                aria-label="ติ๊กเป็น"
              >
                <ToggleGroupItem value="open" className="text-xs font-semibold">slot ว่าง (เปิดให้ Mc จอง)</ToggleGroupItem>
                {regulars.map((m) => (
                  <ToggleGroupItem key={m.id} value={String(m.id)} className="text-xs font-semibold">
                    <UserIcon />Mc {m.name} (ประจำ)
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="text-xs text-muted-foreground">
                {brushId
                  ? `ช่องที่ติ๊กจะลงชื่อ Mc ${regulars.find((m) => m.id === brushId)?.name} ไว้เลย (ลงชีต + ปฏิทินตอนบันทึก) · กดช่องที่ลงชื่อแล้วซ้ำ = ยกเลิก · ช่อง Agency ไม่ลงชื่อ`
                  : "เลือก Mc ประจำเพื่อลงชื่อในช่องที่ติ๊ก ไม่ต้องรอ Mc จองเอง"}
              </span>
              {/* ชั่วโมงของ Mc ประจำเดือนนี้: ลงชีตแล้ว + ในร่าง */}
              <div className="flex w-full flex-wrap gap-x-4 gap-y-1 border-t pt-1.5 text-xs">
                {regularHours.map((m) => (
                  <span key={m.id} className="tabular-nums">
                    <strong>Mc {m.name}</strong> {monthLabel(month)}:{" "}
                    <strong className="text-p2">{num(m.saved + m.draft)} ชม.</strong> ({m.slots} slot)
                    <span className="text-muted-foreground"> · ลงชีตแล้ว {num(m.saved)} ชม. · ร่าง +{num(m.draft)} ชม.</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <Legend tick={view === "tick" || mode === "shopee"} />
          {overlaps ? (
            <Notice variant="warning">มี {overlaps} slot ที่เวลาทับกันในแพลตฟอร์มเดียวกัน (กรอบสีส้ม) ตรวจดูก่อนบันทึก</Notice>
          ) : null}

          {view === "tick" || mode === "shopee" ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {mode === "shopee"
                  ? "แพลน Shopee (In house / Agency Infinite / MCN) เก็บในเว็บไว้ดูภาพรวม ไม่เขียนลงชีต · ช่วงเวลาเดียวกันเป็นของกลุ่มใดกลุ่มหนึ่ง กดช่องของอีกกลุ่ม = ย้ายมา · กดเวลาที่หัวคอลัมน์ = ติ๊กเวลานั้นทุกวันตั้งแต่วันนี้"
                  : "ติ๊กช่องเพื่อเพิ่ม slot · เอาติ๊กออก = ลบ (เฉพาะ slot ที่ยังไม่มีคน) · กดเวลาที่หัวคอลัมน์ = ติ๊กเวลานั้นทุกวันตั้งแต่วันนี้ · กดวันที่ = เพิ่มเวลาอื่น / ใส่ Campaign รายวัน · แพลนของ Agency เก็บในเว็บไว้ดูภาพรวม ไม่เขียนลงชีต"}
              </p>
              <TickView
                month={month}
                columns={shownColumns}
                itemMap={shownMap}
                tagIndex={tagIndex}
                onToggle={toggleCell}
                onColumn={toggleColumn}
                onOpenDay={mode === "tiktok" ? setOpenDay : undefined}
              />
            </>
          ) : !ours.length ? (
            <StateBox title={`${monthLabel(month)} ยังไม่มี slot`}>ติ๊กเลือก slot ในมุมมอง &quot;ติ๊กเลือก slot&quot; หรือใช้ &quot;เติมทั้งเดือน&quot; ด้านบน</StateBox>
          ) : (
            <SheetView items={ours.filter((x) => modeOf(x.platform) === "tiktok")} tagIndex={tagIndex} onOpenDay={setOpenDay} />
          )}
        </>
      )}

      {openDay && plan ? (
        <DayDialog
          key={openDay}
          date={openDay}
          items={ours.filter((x) => x.date === openDay)}
          platforms={platforms}
          tagIndex={tagIndex}
          onAdd={(s) => addSlots([s])}
          onRemoveNew={removeNew}
          onToggleDelete={toggleDelete}
          onCampaign={setCampaign}
          onMove={(n) => setOpenDay(days[days.indexOf(openDay) + n] ?? openDay)}
          onClose={() => setOpenDay(null)}
        />
      ) : null}

      {changes.total ? (
        <div className="slot-bar-open fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-[1200px] items-center gap-2">
            <div className="min-w-0 flex-1 text-sm">
              <strong>ร่าง {monthLabel(month)}</strong>
              <span className="block truncate text-xs text-muted-foreground">
                {[
                  changes.create.length ? `+${changes.create.length} slot ใหม่ (${num(hrs(changes.create))} ชม.)` : "",
                  changes.campaigns.length ? `แก้ Campaign ${changes.campaigns.length}` : "",
                  changes.deletes.length ? `ลบ ${changes.deletes.length} (-${num(hrs(changes.deletes))} ชม.)` : "",
                  namedDraft.length ? `ลงชื่อ Mc ประจำ ${namedDraft.length} (${num(hrs(namedDraft))} ชม.)` : "",
                  changes.agencyCreate.length || changes.agencyDelete.length
                    ? `แพลนในเว็บ +${changes.agencyCreate.length} (${num(hrs(changes.agencyCreate))} ชม.)${changes.agencyDelete.length ? ` / ลบ ${changes.agencyDelete.length}` : ""}` : "",
                ].filter(Boolean).join(" · ")} — ยังไม่บันทึกจนกว่าจะกดบันทึก
              </span>
            </div>
            <Button variant="outline" size="lg" disabled={saving} onClick={clearDraft}>ล้างร่าง</Button>
            <Button size="lg" disabled={saving} onClick={save}>
              {saving ? <><Spinner />กำลังบันทึก...</> : "บันทึก"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- ชิ้นส่วนแสดงผล ----------

function chipClass(x: Item) {
  return cn(
    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums",
    x.deleting ? "border-destructive/60 bg-destructive/10 text-destructive line-through"
      : !x.existing ? "border-dashed border-primary bg-primary/10 font-semibold text-primary"
        : x.existing.mc?.cancelled ? "bg-muted text-muted-foreground line-through"
          : x.existing.mc?.name ? "border-transparent bg-secondary text-secondary-foreground"
            : "bg-card",
    x.overlap && "ring-2 ring-warning-border",
  );
}

/** ข้อความช่อง Mc: Agency / ชื่อ Mc / ว่าง */
const mcText = (x: Item) => (x.agency ? ownerLabel(x.agency)
  : x.assign ? `Mc ${x.assign.name} (ร่าง)` : x.existing?.mc?.name ? `Mc ${x.existing.mc.name}` : "Mc ว่าง");

const chipTitle = (x: Item) => [
  `${x.agency ? `${ownerLabel(x.agency)} · ` : ""}${x.platform} ${x.start}–${x.end}`,
  x.campaign ? `Campaign: ${x.campaign}` : "",
  x.agency ? `แพลนในเว็บ (ไม่ลงชีต)${x.agencyId ? "" : " · ร่างใหม่"}`
    : !x.existing ? "ร่างใหม่ (ยังไม่ลงชีต)"
      : `${mcText(x)} · Admin: ${x.existing.admin?.name || "ว่าง"}${x.existing.mc?.cancelled ? " · แคน" : ""}`,
  x.deleting ? "จะลบตอนบันทึก" : "",
].filter(Boolean).join("\n");

function Legend({ tick }: { tick: boolean }) {
  const sample = (cls: string, text: string) => (
    <span className="flex items-center gap-1"><span className={cn("inline-block rounded border", tick ? "size-3.5" : "h-3.5 w-6", cls)} />{text}</span>
  );
  return (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {tick ? (
        <>
          {sample("border-2 border-dashed border-primary bg-primary/15", "ร่างใหม่")}
          {sample("border-primary bg-primary", "มีในชีตแล้ว (ยังว่าง)")}
          {sample("border-p2 bg-p2", "Mc จองแล้ว (เอาออกไม่ได้)")}
          {sample("border-2 border-warning-border bg-warning", "Admin จองแล้ว ยังไม่มี Mc")}
          {sample("border-2 border-dashed border-p2 bg-p2/20", "ร่างลงชื่อ Mc ประจำ")}
          {sample("border-destructive bg-destructive/15", "จะลบ")}
        </>
      ) : (
        <>
          {sample("bg-card", "มีในชีตแล้ว (ยังว่าง)")}
          {sample("border-transparent bg-secondary", "มีคนจองแล้ว")}
          {sample("border-dashed border-primary bg-primary/10", "ร่างใหม่")}
          {sample("border-destructive/60 bg-destructive/10", "จะลบ")}
        </>
      )}
    </div>
  );
}

/**
 * ช่องติ๊ก 1 slot ของคอลัมน์ (เจ้าของ = agency)
 *   slot เดียวกันที่เป็นของอีกฝั่ง (ของเรา / Agency) แสดงเป็นขีดจาง กด = ย้ายมาฝั่งนี้
 */
function Tick({ item, other, agency, label, onClick }: {
  item: Item | undefined; other: Item | undefined; agency: string | null; label: string; onClick: () => void;
}) {
  const st = !item || (item.deleting && other) ? (other ? "other" : "none")
    : item.deleting ? "del"
      : item.agency ? (item.agencyId ? "have" : "new")
        : item.assign ? "assign"
        : !item.existing ? "new"
          : item.existing.mc?.cancelled ? "cancel" : item.existing.mc?.name ? "taken"
            // Admin ลงแล้วแต่ยังไม่มี Mc = ยังต้องหา Mc (ลบไม่ได้เพราะมี Admin)
            : !canDelete(item.existing) ? "noMc" : "have";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={st !== "none" && st !== "del" && st !== "other"}
      aria-label={label}
      title={st === "other" && other ? `${chipTitle(other)}\n(กดเพื่อย้ายมาเป็น${ownerLabel(agency)})`
        : item && st !== "none" ? chipTitle(item) : `${label} (กดเพื่อเพิ่ม)`}
      onClick={onClick}
      className={cn(
        "mx-auto grid size-6 place-items-center rounded-md border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
        st === "none" && "bg-card hover:border-primary hover:bg-primary/10",
        st === "other" && "border-dashed bg-muted/60 text-muted-foreground/60 hover:border-primary hover:text-primary",
        st === "new" && "border-2 border-dashed border-primary bg-primary/15 text-primary",
        st === "have" && "border-primary bg-primary text-primary-foreground",
        st === "taken" && "border-p2 bg-p2 text-white",
        st === "noMc" && "border-2 border-warning-border bg-warning text-warning-foreground",
        st === "assign" && "border-2 border-dashed border-p2 bg-p2/20 text-p2",
        st === "cancel" && "bg-muted text-muted-foreground",
        st === "del" && "border-destructive bg-destructive/15 text-destructive",
        st !== "other" && item?.overlap && "ring-2 ring-warning-border",
      )}
    >
      {st === "new" || st === "have" ? <CheckIcon /> : st === "taken" || st === "assign" ? <UserIcon /> : st === "noMc" ? <UserXIcon /> : st === "del" ? <XIcon />
        : st === "cancel" || st === "other" ? <MinusIcon /> : null}
    </button>
  );
}

/** ตารางติ๊ก: แถว = วันทั้งเดือน, คอลัมน์ = ช่อง x ช่วงเวลา */
function TickView({ month, columns, itemMap, tagIndex, onToggle, onColumn, onOpenDay }: {
  month: string;
  columns: Column[];
  itemMap: Map<string, Item>;
  tagIndex: (p: string) => number;
  onToggle: (date: string, platform: string, t: { start: string; end: string }, agency: string | null) => void;
  onColumn: (platform: string, t: { start: string; end: string }, agency: string | null) => void;
  onOpenDay?: (d: string) => void; // ไม่ระบุ = กดวันที่ไม่ได้ (แพลน Shopee)
}) {
  const days = daysOf(month);
  const today = todayKey();
  const items = [...itemMap.values()];
  const colKey = (c: Column) => `${c.platform}|${c.agency ?? ""}`;
  // กลุ่มของ Agency พื้นสีอ่อนแยกจากช่องหลัก
  const tint = (c: Column) => (c.agency ? "bg-p0/[0.06]" : "");
  // ช่วงหลังเที่ยงคืน (00:00–07:29) ยังนับเป็นวันไลฟ์เดิม แยกสีให้เห็น
  const night = (c: Column, t: { start: string }) => toMin(t.start) < dayStartOf(c.platform);
  // ช่องเวลาเดียวกันที่อีกฝั่ง (ของเรา / Agency) ติ๊กอยู่
  const liveAt = new Map<string, Item[]>();
  for (const x of items) {
    if (x.deleting) continue;
    const k = keyOf(x);
    liveAt.set(k, [...(liveAt.get(k) ?? []), x]);
  }
  /** ชั่วโมงของกลุ่มนี้ในวันนั้น / ทั้งเดือน (ไม่นับที่จะลบ / แคน) */
  const groupHours = (c: Column, d?: string) => items
    .filter((x) => x.platform === c.platform && x.agency === (c.agency ?? null) && (!d || x.date === d) && !x.deleting && !x.existing?.mc?.cancelled)
    .reduce((h, x) => h + lenOf(x) / 60, 0);
  return (
    <div className="max-h-[78vh] overflow-auto rounded-xl border bg-card">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th rowSpan={2} className="sticky top-0 left-0 z-30 border-b bg-muted px-2 text-left text-xs font-semibold">วันที่</th>
            {columns.map((c) => {
              // สรุปของช่องนี้ทั้งเดือน (รวมร่าง ไม่นับที่จะลบ / แคน)
              const mine = items.filter((x) => x.platform === c.platform && x.agency === (c.agency ?? null)
                && !x.deleting && !x.existing?.mc?.cancelled);
              const hours = groupHours(c);
              return (
                <th key={colKey(c)} colSpan={c.times.length + 1} className="sticky top-0 z-20 h-8 border-b border-l bg-muted px-2 text-left whitespace-nowrap">
                  <PlatformBadge name={c.platform} index={tagIndex(c.platform)} />
                  {c.agency ? (
                    <>
                      <span className="mx-1 text-muted-foreground">›</span>
                      <Badge className="bg-foreground text-[11px] font-semibold text-background">{ownerLabel(c.agency)}</Badge>
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">(ไม่ลงชีต)</span>
                    </>
                  ) : null}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                    {mine.length} slot · <strong className="font-semibold text-foreground">{num(hours)} ชม.</strong>
                  </span>
                </th>
              );
            })}
            {onOpenDay ? (
              <th rowSpan={2} className="sticky top-0 z-20 min-w-36 border-b border-l bg-muted px-2 text-left text-xs font-semibold">Campaign</th>
            ) : null}
          </tr>
          <tr>
            {columns.flatMap((c) => [...c.times.map((t, i) => (
              <th key={`${colKey(c)}|${t.start}|${t.end}`} className={cn("sticky top-8 z-20 border-b bg-muted px-0.5 py-1 font-medium", i === 0 && "border-l", night(c, t) && "text-p3")}>
                <button
                  type="button"
                  title={`ติ๊ก / เอาติ๊กออก ${c.agency ? `${ownerLabel(c.agency)} ` : ""}${c.platform} ${t.start}–${t.end} ทุกวันตั้งแต่วันนี้${night(c, t) ? " (หลังเที่ยงคืน นับเป็นวันเดิม)" : ""}`}
                  onClick={() => onColumn(c.platform, t, c.agency ?? null)}
                  className="rounded px-1 text-[11px] leading-tight tabular-nums outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t.start}<br /><span className="text-muted-foreground">{t.end}</span>
                </button>
              </th>
            )), (
              <th key={`${colKey(c)}|sum`} className="sticky top-8 z-20 border-b bg-muted px-1.5 py-1 text-[11px] font-semibold whitespace-nowrap">
                รวม<br /><span className="font-normal text-muted-foreground">ชม./วัน</span>
              </th>
            )])}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const wd = parseKey(d).getUTCDay();
            const weekend = wd === 0 || wd === 6;
            const camps = [...new Set(items.filter((x) => x.date === d && !x.deleting).map((x) => x.campaign).filter(Boolean))];
            return (
              <tr key={d} className={cn(d < today && "opacity-55", weekend && "bg-muted/40")}>
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 border-b px-2 py-1 text-left font-semibold whitespace-nowrap",
                    weekend ? "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]" : "bg-card",
                  )}
                >
                  {onOpenDay ? (
                    <button
                      type="button"
                      onClick={() => onOpenDay(d)}
                      title="เพิ่มเวลาอื่น / ใส่ Campaign ของวันนี้"
                      className={cn("rounded px-1 outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring", d === today && "text-primary")}
                    >
                      {fmtDayNum(d)}
                    </button>
                  ) : <span className={cn("px-1", d === today && "text-primary")}>{fmtDayNum(d)}</span>}
                </th>
                {columns.flatMap((c) => [...c.times.map((t, i) => {
                  const k = keyOf({ platform: c.platform, date: d, start: t.start, end: t.end });
                  const agency = c.agency ?? null;
                  return (
                    <td key={`${colKey(c)}|${t.start}|${t.end}`} className={cn("border-b px-1 py-1 text-center", i === 0 && "border-l", tint(c), night(c, t) && "bg-p3/[0.06]")}>
                      <Tick
                        item={itemMap.get(ownKey(k, agency))}
                        other={liveAt.get(k)?.find((x) => x.agency !== agency)}
                        agency={agency}
                        label={`${fmtDayNum(d)} ${c.agency ? `${ownerLabel(c.agency)} ` : ""}${c.platform} ${t.start}–${t.end}`}
                        onClick={() => onToggle(d, c.platform, t, agency)}
                      />
                    </td>
                  );
                }), (
                  <td key={`${colKey(c)}|sum`} className={cn("border-b px-1.5 py-1 text-right text-xs font-semibold tabular-nums", tint(c))}>
                    {groupHours(c, d) ? num(groupHours(c, d)) : <span className="font-normal text-muted-foreground/50">–</span>}
                  </td>
                )])}
                {onOpenDay ? (
                  <td className="border-b border-l px-2 py-1">
                    <button
                      type="button"
                      onClick={() => onOpenDay(d)}
                      aria-label={`Campaign ${fmtDayNum(d)}`}
                      className="flex min-h-6 w-full flex-wrap items-center gap-1 text-left outline-none"
                    >
                      {camps.length ? camps.map((c) => <Badge key={c} variant="secondary" className="text-[11px]">{c}</Badge>)
                        : <span className="text-xs text-muted-foreground/60">+ Campaign</span>}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** แบบชีต: เรียงและคอลัมน์เหมือนแท็บ "ลงตาราง Deal Mc" (Admin เพิ่มเป็นอีกคอลัมน์) */
function SheetView({ items, tagIndex, onOpenDay }: { items: Item[]; tagIndex: (p: string) => number; onOpenDay: (d: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs">
            {["Platform", "วันที่", "เวลาเริ่ม", "เวลาจบ", "Campaign", "Mc", "Admin", ""].map((h, i) => (
              <th key={i} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr
              key={x.key}
              onClick={() => onOpenDay(x.date)}
              className={cn(
                "cursor-pointer border-b last:border-b-0 hover:bg-muted/60",
                !x.existing && "bg-primary/5",
                x.deleting && "text-destructive line-through",
                x.overlap && "bg-warning",
              )}
            >
              <td className="px-2 py-1.5"><PlatformBadge name={x.platform} index={tagIndex(x.platform)} /></td>
              <td className="px-2 py-1.5 whitespace-nowrap">{fmtDayNum(x.date)}</td>
              <td className="px-2 py-1.5 tabular-nums">{x.start}</td>
              <td className="px-2 py-1.5 tabular-nums">{x.end}</td>
              <td className={cn("px-2 py-1.5", x.campaignChanged && "font-semibold text-primary")}>{x.campaign}</td>
              <td className="px-2 py-1.5">
                {x.assign ? <span className="font-semibold text-primary">Mc {x.assign.name} (ร่าง)</span>
                  : x.existing?.mc?.name ? `Mc ${x.existing.mc.name}` : x.existing ? <span className="text-muted-foreground">ว่าง</span> : ""}
              </td>
              <td className="px-2 py-1.5">
                {x.existing ? (x.existing.admin?.name || <span className="text-muted-foreground">{x.existing.admin ? "ว่าง" : "–"}</span>) : ""}
              </td>
              <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap">
                {x.deleting ? <Badge variant="destructive">จะลบ</Badge>
                  : !x.existing ? <Badge>ร่างใหม่</Badge>
                    : x.existing.mc?.cancelled ? <Badge variant="secondary">แคน</Badge>
                      : x.campaignChanged ? <Badge variant="outline">แก้ Campaign</Badge> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- เติมทั้งเดือน ----------

function PatternPanel({ month, platforms, campaigns, onAdd, onCopyPrev }: {
  month: string;
  platforms: string[];
  campaigns: string[];
  onAdd: (list: NewSlot[]) => void;
  onCopyPrev: () => void;
}) {
  const ids = { platform: useId(), campaign: useId() };
  const days = daysOf(month);
  const first = days[0], last = days[days.length - 1];
  const today = todayKey();
  const [platform, setPlatform] = useState(platforms[0] ?? "");
  const [from, setFrom] = useState(today > first && today <= last ? today : first);
  const [to, setTo] = useState(last);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  // Shopee เริ่มด้วยช่วงเวลาตามแท็บ MC Shopee
  const [times, setTimes] = useState(() => (modeOf(platforms[0] ?? "") === "shopee" ? SHOPEE_TIMES : [{ start: "09:30", end: "11:30" }]));
  const [campaign, setCampaign] = useState("");
  // ผู้ไลฟ์: ของเรา ("") หรือ Agency ที่ไลฟ์ผ่านช่องนี้ (เช่น TDH ผ่าน GLORY MALL)
  const [owner, setOwner] = useState("");
  const agencies = CHANNELS.filter((c) => c.platform === platform.trim() && c.agency).map((c) => c.agency!);
  // มีช่องของเรา (ลงชีต) ไหม: Shopee มีแต่กลุ่มแพลนในเว็บ (In house / Infinite / MCN)
  const hasOurs = !CHANNELS.some((c) => c.platform === platform.trim()) || CHANNELS.some((c) => c.platform === platform.trim() && !c.agency);
  const agency = agencies.includes(owner) ? owner : hasOurs ? null : agencies[0] ?? null;
  // เติมช่วงต่อกัน เช่น 09:30 ถึง 23:30 ช่วงละ 2 ชม. = 7 ช่วง
  const [span, setSpan] = useState({ start: "09:30", end: "23:30", hours: "2" });

  const dates = days.filter((d) => d >= from && d <= to && weekdays.has(parseKey(d).getUTCDay()));
  const valid = times.filter((t) => t.start && t.end && t.start !== t.end);
  const total = dates.length * valid.length;

  function setTime(i: number, field: "start" | "end", value: string) {
    setTimes(times.map((t, j) => (j === i ? { ...t, [field]: value } : t)));
  }
  function addTime() {
    const lastT = times[times.length - 1];
    if (!lastT) { setTimes([{ start: "09:30", end: "11:30" }]); return; }
    const len = lenOf(lastT) || 120;
    setTimes([...times, { start: lastT.end, end: fmtMin(toMin(lastT.end) + len) }]);
  }
  function fillSpan() {
    const step = Math.round(Number(span.hours) * 60);
    if (!(step >= 15) || !span.start || !span.end) return;
    const totalLen = (toMin(span.end) - toMin(span.start) + 1440) % 1440 || 1440;
    const out: { start: string; end: string }[] = [];
    for (let m = 0; m + step <= totalLen && out.length < 24; m += step) {
      out.push({ start: fmtMin(toMin(span.start) + m), end: fmtMin(toMin(span.start) + m + step) });
    }
    if (out.length) setTimes(out);
  }

  return (
    <Card className="my-3 shadow-card">
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="flex items-center gap-1.5 text-base"><WandSparklesIcon className="size-4 text-primary" />เติมทั้งเดือน</strong>
          <Button variant="outline" onClick={onCopyPrev}><CopyIcon />คัดลอกรูปแบบจาก {monthLabel(monthKey(-1, month))}</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Label htmlFor={ids.platform} className="mb-1.5 font-semibold">แพลตฟอร์ม</Label>
              <Input id={ids.platform} list="plan-platforms" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="เช่น Shopee, TikTok" />
              {platforms.length > 1 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {platforms.slice(0, 6).map((p) => (
                    <Button key={p} size="xs" variant={p === platform ? "default" : "outline"} onClick={() => setPlatform(p)}>{p}</Button>
                  ))}
                </div>
              ) : null}
              {agencies.length ? (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={agency ?? OURS}
                  onValueChange={(v) => { if (v) setOwner(v); }}
                  aria-label="ผู้ไลฟ์"
                  className="mt-2"
                >
                  {hasOurs ? <ToggleGroupItem value={OURS} className="text-xs font-semibold">ไลฟ์โดยเรา</ToggleGroupItem> : null}
                  {agencies.map((a) => <ToggleGroupItem key={a} value={a} className="text-xs font-semibold">{ownerLabel(a)}</ToggleGroupItem>)}
                </ToggleGroup>
              ) : null}
            </div>
            <div>
              <span className="mb-1.5 block font-semibold">วันที่</span>
              <div className="flex items-center gap-2">
                <DatePicker value={from} min={first} onChange={(v) => { if (v) { setFrom(v < first ? first : v > last ? last : v); if (v > to) setTo(v > last ? last : v); } }} aria-label="ตั้งแต่วันที่" className="flex-1" />
                <span className="text-muted-foreground">ถึง</span>
                <DatePicker value={to} min={from} onChange={(v) => { if (v) setTo(v > last ? last : v); }} aria-label="ถึงวันที่" className="flex-1" />
              </div>
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                value={[...weekdays].map(String)}
                onValueChange={(v) => setWeekdays(new Set(v.map(Number)))}
                aria-label="เฉพาะวัน"
                className="mt-2 flex-wrap"
              >
                {WEEKDAYS.map((w, i) => (
                  <ToggleGroupItem key={w} value={String(i)} className="min-w-10 rounded-full! text-xs font-semibold">{w}</ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="mt-1 text-xs text-muted-foreground">{dates.length} วัน</p>
            </div>
            <div>
              <Label htmlFor={ids.campaign} className="mb-1.5 font-semibold">Campaign (ไม่บังคับ)</Label>
              <Input id={ids.campaign} list="plan-campaigns" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="เช่น Pay Day" />
              {campaigns.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {campaigns.slice(0, 6).map((c) => (
                    <Button key={c} size="xs" variant={c === campaign ? "default" : "outline"} onClick={() => setCampaign(c === campaign ? "" : c)}>{c}</Button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block font-semibold">ช่วงเวลา ({valid.length})</span>
            <div className="space-y-2">
              {times.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <TimePicker value={t.start} onChange={(v) => setTime(i, "start", v)} aria-label={`เวลาเริ่ม ช่วงที่ ${i + 1}`} className="flex-1" />
                  <span className="text-muted-foreground">–</span>
                  <TimePicker value={t.end} onChange={(v) => setTime(i, "end", v)} aria-label={`เวลาจบ ช่วงที่ ${i + 1}`} className="flex-1" />
                  <IconButton label="ลบช่วงเวลานี้" variant="ghost" className="text-muted-foreground" onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                    <XIcon />
                  </IconButton>
                </div>
              ))}
            </div>
            <Button variant="link" onClick={addTime} className="mt-1 h-auto px-0 font-semibold"><PlusIcon />เพิ่มช่วงเวลา (ต่อจากช่วงสุดท้าย)</Button>
            <div className="mt-2 rounded-lg border border-dashed p-2">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">หรือแบ่งช่วงต่อกันอัตโนมัติ</span>
              <div className="flex flex-wrap items-center gap-2">
                <TimePicker value={span.start} onChange={(v) => setSpan({ ...span, start: v })} aria-label="แบ่งช่วง: ตั้งแต่" className="w-28" />
                <span className="text-muted-foreground">ถึง</span>
                <TimePicker value={span.end} onChange={(v) => setSpan({ ...span, end: v })} aria-label="แบ่งช่วง: ถึง" className="w-28" />
                <span className="text-muted-foreground">ช่วงละ</span>
                <Input inputMode="decimal" value={span.hours} onChange={(e) => setSpan({ ...span, hours: e.target.value })} aria-label="ช่วงละกี่ชั่วโมง" className="w-14" />
                <span className="text-muted-foreground">ชม.</span>
                <Button variant="outline" size="sm" onClick={fillSpan}>แบ่ง</Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">เวลาจบก่อนเวลาเริ่ม = ข้ามเที่ยงคืน เช่น 23:30–01:30</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {total ? `${dates.length} วัน × ${valid.length} ช่วง = ${total} slot (slot ที่มีอยู่แล้วจะถูกข้าม)` : "เลือกวันและช่วงเวลา"}
          </span>
          <Button
            disabled={!platform.trim() || !total}
            onClick={() => onAdd(dates.flatMap((d) => valid.map((t) => ({
              date: d, platform: platform.trim(), start: t.start, end: t.end, campaign: campaign.trim(), agency,
            }))))}
          >
            <PlusIcon />เพิ่มลงร่าง
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Campaign ตามช่วงวัน ----------

function CampaignPanel({ month, items, platforms, ranges, onApply, onRemove }: {
  month: string;
  items: Item[];
  platforms: string[];
  ranges: CampaignRange[];
  onApply: (r: CampaignRange) => void;
  onRemove: (i: number) => void;
}) {
  const id = useId();
  const days = daysOf(month);
  const [range, setRange] = useState(() => {
    const today = todayKey();
    const from = today >= days[0] && today <= days[days.length - 1] ? today : days[0];
    return { from, to: from };
  });
  const [platform, setPlatform] = useState(ALL);
  const [campaign, setCampaign] = useState("");
  const targets = items.filter((x) => x.date >= range.from && x.date <= range.to && (platform === ALL || x.platform === platform)
    && !x.deleting && (!x.existing || x.existing.mc));

  return (
    <Card className="my-3 shadow-card">
      <CardContent className="space-y-3 text-sm">
        <strong className="flex items-center gap-1.5 text-base"><TagIcon className="size-4 text-primary" />ตั้ง Campaign ตามช่วงวัน</strong>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} defaultMonth={month} aria-label="ช่วงวันของ Campaign" className="w-auto min-w-56" />
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger aria-label="แพลตฟอร์ม" className="w-auto min-w-36"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ALL}>ทุกแพลตฟอร์ม</SelectItem>
              {platforms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            id={id}
            list="plan-campaigns"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="ชื่อ Campaign เช่น Pay Day (ว่าง = ล้าง)"
            aria-label="ชื่อ Campaign"
            className="w-48 flex-1"
          />
          <Button onClick={() => onApply({ ...range, platform, campaign: campaign.trim() })}>
            ตั้ง Campaign{targets.length ? ` (${targets.length} slot)` : ""}
          </Button>
        </div>
        {ranges.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">ช่วงที่ตั้งไว้:</span>
            {ranges.map((r, i) => (
              <Badge key={i} variant="secondary" className="gap-1 pr-1 text-xs">
                {r.campaign} · {fmtRange(r)}{r.platform !== ALL ? ` · ${r.platform}` : ""}
                <button type="button" aria-label={`เลิกใช้ช่วง ${r.campaign}`} onClick={() => onRemove(i)} className="rounded-full p-0.5 hover:bg-foreground/10">
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          กดวันแรกแล้วกดวันสุดท้ายในปฏิทิน ใส่ชื่อ Campaign แล้วกดตั้ง — ใช้กับ slot ที่มีในชีตแล้วและร่างใหม่ และ slot ที่ติ๊กเพิ่มทีหลังในช่วงนี้จะได้ Campaign นี้อัตโนมัติ
        </p>
      </CardContent>
    </Card>
  );
}

// ---------- แก้รายวัน ----------

function DayDialog({ date, items, platforms, tagIndex, onAdd, onRemoveNew, onToggleDelete, onCampaign, onMove, onClose }: {
  date: string;
  items: Item[];
  platforms: string[];
  tagIndex: (p: string) => number;
  onAdd: (s: NewSlot) => { added: number; skipped: number };
  onRemoveNew: (key: string) => void;
  onToggleDelete: (key: string) => void;
  onCampaign: (keys: string[], campaign: string) => void;
  onMove: (n: number) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const ids = { platform: useId(), campaign: useId(), dayCampaign: useId() };
  const lastItem = items.filter((x) => !x.deleting).at(-1);
  const [platform, setPlatform] = useState(lastItem?.platform ?? platforms[0] ?? "");
  const [start, setStart] = useState(lastItem?.end ?? "09:30");
  const [end, setEnd] = useState(lastItem ? fmtMin(toMin(lastItem.end) + (lenOf(lastItem) || 120)) : "11:30");
  const dayCamp = [...new Set(items.filter((x) => !x.deleting).map((x) => x.campaign))];
  const [campaign, setCampaign] = useState(dayCamp.length === 1 ? dayCamp[0] : "");
  const [allCampaign, setAllCampaign] = useState(dayCamp.length === 1 ? dayCamp[0] : "");
  const editable = items.filter((x) => !x.deleting && (!x.existing || x.existing.mc));
  const groups = [...new Set([...platforms.filter((p) => items.some((x) => x.platform === p)), ...items.map((x) => x.platform)])];

  function add() {
    if (!platform.trim() || !start || !end || start === end) return;
    const res = onAdd({ date, platform: platform.trim(), start, end, campaign: campaign.trim() });
    if (!res.added) { toast("มี slot นี้อยู่แล้ว", "error"); return; }
    const len = lenOf({ start, end }) || 120;
    setStart(end);
    setEnd(fmtMin(toMin(end) + len));
  }

  return (
    <AppDialog open onClose={onClose} title={fmtDayLong.format(parseKey(date))} description={'แก้ในร่าง ยังไม่ลงชีตจนกว่าจะกด "บันทึกลงชีต"'} className="sm:max-w-xl">
      <DialogBody className="space-y-4 text-sm">
        {!items.length ? <p className="text-muted-foreground">วันนี้ยังไม่มี slot</p> : groups.map((p) => (
          <section key={p}>
            <PlatformBadge name={p} index={tagIndex(p)} className="mb-1.5" />
            <div className="divide-y rounded-lg border">
              {items.filter((x) => x.platform === p).map((x) => {
                const ex = x.existing;
                const locked = !!ex && !canDelete(ex);
                return (
                  <div key={x.key} className={cn("flex flex-wrap items-center gap-2 px-2 py-1.5", x.deleting && "bg-destructive/5", x.overlap && "bg-warning")}>
                    <span className={cn(chipClass(x), "text-sm")}>{x.start}–{x.end}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {!ex ? `ร่างใหม่${x.agency ? ` · ${ownerLabel(x.agency)}` : ""}`
                        : `${mcText(x)} · Admin ${ex.admin?.name || "ว่าง"}${ex.mc?.cancelled ? " · แคน" : ""}${x.deleting ? " · จะลบ" : ""}`}
                    </span>
                    {!x.deleting && (!ex || ex.mc) ? (
                      <Input
                        list="plan-campaigns"
                        value={x.campaign}
                        onChange={(e) => onCampaign([x.key], e.target.value)}
                        placeholder="Campaign"
                        aria-label={`Campaign ${x.start}–${x.end}`}
                        className={cn("h-8 w-36", x.campaignChanged && "border-primary")}
                      />
                    ) : null}
                    {!ex ? (
                      <IconButton label="เอาออกจากร่าง" variant="ghost" className="text-muted-foreground" onClick={() => onRemoveNew(x.key)}><XIcon /></IconButton>
                    ) : x.deleting ? (
                      <IconButton label="ยกเลิกการลบ" variant="ghost" onClick={() => onToggleDelete(x.key)}><Undo2Icon /></IconButton>
                    ) : (
                      <IconButton
                        label={locked ? "มีคนจองแล้ว ลบไม่ได้ (เอาคนออกที่หน้าจัดการ slot ก่อน)" : "ลบ slot นี้ (ตอนบันทึก)"}
                        variant="ghost"
                        disabled={locked}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onToggleDelete(x.key)}
                      >
                        <Trash2Icon />
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {editable.length > 1 ? (
          <div className="flex items-center gap-2">
            <Input id={ids.dayCampaign} list="plan-campaigns" value={allCampaign} onChange={(e) => setAllCampaign(e.target.value)} placeholder="Campaign ทั้งวัน" aria-label="Campaign ทั้งวัน" />
            <Button variant="outline" className="shrink-0" onClick={() => onCampaign(editable.map((x) => x.key), allCampaign.trim())}>
              ใช้กับทั้งวัน ({editable.length})
            </Button>
          </div>
        ) : null}

        <div className="rounded-lg border border-dashed p-3">
          <span className="mb-2 block font-semibold">เพิ่ม slot</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input id={ids.platform} list="plan-platforms" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="แพลตฟอร์ม" aria-label="แพลตฟอร์ม" />
            <Input id={ids.campaign} list="plan-campaigns" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Campaign (ไม่บังคับ)" aria-label="Campaign" />
            <div className="flex items-center gap-2 sm:col-span-2">
              <TimePicker value={start} onChange={setStart} aria-label="เวลาเริ่ม" className="flex-1" />
              <span className="text-muted-foreground">–</span>
              <TimePicker value={end} onChange={setEnd} aria-label="เวลาจบ" className="flex-1" />
              <Button disabled={!platform.trim() || !start || !end || start === end} onClick={add}><PlusIcon />เพิ่ม</Button>
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogActions>
        <IconButton label="วันก่อนหน้า" variant="outline" className="mr-auto" onClick={() => onMove(-1)}><ChevronLeftIcon /></IconButton>
        <IconButton label="วันถัดไป" variant="outline" onClick={() => onMove(1)}><ChevronRightIcon /></IconButton>
        <Button size="lg" onClick={onClose}>เสร็จ</Button>
      </DialogActions>
    </AppDialog>
  );
}
