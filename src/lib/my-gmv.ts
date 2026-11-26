// ยอดขาย (GMV) ของ Mc ประจำ ดูเฉพาะของตัวเอง (ผู้ใช้ขอ 2026-11-26: Mc ประจำใช้ทำสไลด์ส่วนตัวไว้ present) — ใช้ทั้ง browser และ server
//   สูตรเดียวกับอันดับ Mc (src/lib/campaign-report.ts slotUnits):
//   - ยอดที่กรอกใน slot ก่อน (แม่น) · slot ว่างที่ยอดรวมอยู่ใน slot ถัดไปของตัวเอง (ไลฟ์ต่อกัน) = นับรวมกับ slot นั้น
//   - ไม่ได้กรอก = ประมาณจากไฟล์ Export (ยอดไลฟ์แบ่งให้ slot ตามนาทีที่ซ้อนกัน · ต้องซ้อนอย่างน้อย 30 นาที)
//   - slot สแตนด์บาย ไม่นับ · คิวที่ยังไม่ถึงเวลา = รอไลฟ์

import { BANDS, type Band } from "@/lib/campaign";
import type { CtxSlot } from "@/lib/campaign-data";
import { fmtDayShort, fmtMonthLong, fmtMonthShort, parseKey } from "@/lib/format";
import { gmvCoverage } from "@/lib/gmv";

/** entered = กรอกใน slot · covered = ยอดรวมอยู่ใน slot ถัดไป · estimated = ประมาณจาก Export · none = ไลฟ์แล้วแต่ยังไม่มียอด */
export type MyGmvStatus = "entered" | "estimated" | "covered" | "none" | "standby" | "upcoming";

export type MyGmvSlot = {
  id: number;
  date: string; // วันไลฟ์ (หลังเที่ยงคืนนับเป็นวันเดิม เหมือนตารางของฉัน)
  start: string;
  end: string;
  platform: string;
  hours: number;
  band: Band;
  /** ชื่อแคมเปญ ว่าง = วันปกติ */
  campaign: string;
  status: MyGmvStatus;
  gmv: number | null;
  /** ชั่วโมงที่ยอดนี้ครอบคลุม (กรอก = slot นี้ + slot ว่างก่อนหน้าที่ยอดรวมอยู่ในนี้ · ประมาณ = ชั่วโมงที่ไลฟ์ซ้อนกับ slot) */
  gmvHours: number;
  /** covered: เวลาของ slot ที่ยอดรวมอยู่ เช่น "21:30–23:30" */
  coveredBy?: string;
  /** entered ที่ยอดรวม slot ว่างก่อนหน้าด้วย: เวลาเริ่มของ slot แรก + จำนวน slot ในยอดนี้ */
  from?: string;
  merged?: number;
  /**
   * ส่วนของยอดที่นับเป็นของ slot นี้ (ใช้แยกตามวัน / ช่วงเวลา / แคมเปญ)
   *   กรอกยอดรวมหลาย slot (เช่น 09:30–13:30 กรอกที่ 11:30) = แบ่งตามชั่วโมงของแต่ละ slot · ประมาณ = ยอดของ slot เอง · ไม่มียอด = null
   */
  share: number | null;
};

export type MyGmvData = {
  name: string;
  today: string;
  /** เดือนแรก–เดือนสุดท้ายที่โหลดมา (YYYY-MM) */
  first: string;
  last: string;
  slots: MyGmvSlot[];
};

/** ยอดเริ่มจับคู่กับ slot ได้ตั้งแต่เดือนนี้ (ไฟล์ Export มีเวลาเริ่มไลฟ์ · src/lib/campaign-data.ts EXPORT_START) */
export const MY_GMV_START = "2026-08";
/** ย้อนหลังสูงสุดกี่เดือน */
export const MY_GMV_MONTHS = 12;

const hhmm = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(11, 16);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** slot ของ Mc คนนี้ (จาก loadCampaignContext) -> แถวยอดต่อ slot */
export function toMyGmvSlots(mine: CtxSlot[], now: number): MyGmvSlot[] {
  const sorted = [...mine].sort((a, b) => a.startMs - b.startMs);
  const past = sorted.filter((s) => s.startMs <= now && !s.standby);
  const cover = gmvCoverage(past.map((s) => ({ id: s.id, platform: s.platform, startMs: s.startMs, endMs: s.endMs, gmv: s.gmv, who: s.mcId })));
  const byId = new Map(past.map((s) => [s.id, s]));
  const extra = new Map<number, number>();
  const unit = new Map<number, { from: number; n: number }>();
  for (const [emptyId, by] of cover) {
    const e = byId.get(emptyId);
    extra.set(by.id, (extra.get(by.id) ?? 0) + (e?.hours ?? 0));
    const u = unit.get(by.id) ?? { from: by.startMs, n: 1 };
    unit.set(by.id, { from: Math.min(u.from, e?.startMs ?? u.from), n: u.n + 1 });
  }
  /** ชั่วโมงรวมของยอดที่กรอก (slot นี้ + slot ว่างก่อนหน้าที่ยอดรวมอยู่ในนี้) */
  const unitHours = (s: Pick<CtxSlot, "id">) => (byId.get(s.id)?.hours ?? 0) + (extra.get(s.id) ?? 0);
  /** ยอดที่กรอกแบ่งตามชั่วโมง: ส่วนของ slot ที่ยาว hours ในยอด gmv */
  const part = (gmv: number, hours: number, unit: number) => Math.round((unit > 0 ? (gmv * hours) / unit : gmv) * 100) / 100;

  return sorted.map((s): MyGmvSlot => {
    const base = {
      id: s.id, date: s.date, start: hhmm(s.startMs), end: hhmm(s.endMs), platform: s.platform, hours: r2(s.hours), band: s.band,
      campaign: s.camp?.label ?? "", gmv: null, gmvHours: 0, share: null,
    };
    if (s.startMs > now) return { ...base, status: "upcoming" };
    if (s.standby) return { ...base, status: "standby" };
    if (s.gmv !== null) {
      const u = unit.get(s.id);
      return {
        ...base, status: "entered", gmv: s.gmv, gmvHours: r2(unitHours(s)), share: part(s.gmv, s.hours, unitHours(s)),
        ...(u ? { from: hhmm(u.from), merged: u.n } : {}),
      };
    }
    const by = cover.get(s.id);
    if (by) return { ...base, status: "covered", coveredBy: `${hhmm(by.startMs)}–${hhmm(by.endMs)}`, share: part(by.gmv ?? 0, s.hours, unitHours(by)) };
    if (s.exp && s.exp.hours >= 0.5) {
      const gmv = Math.round(s.exp.gmv);
      return { ...base, status: "estimated", gmv, gmvHours: r2(Math.min(s.hours, s.exp.hours)), share: gmv };
    }
    return { ...base, status: "none" };
  });
}

// ---------- สรุป (หน้าเว็บ / Excel / สไลด์ ใช้ชุดเดียวกัน) ----------

export type MyGmvAgg = {
  key: string;
  label: string;
  gmv: number;
  /** ชั่วโมงที่มียอด */
  hours: number;
  /** slot ที่นับยอด (กรอก + รวมอยู่ใน slot ถัดไป + ประมาณ) */
  slots: number;
  /** ส่วนที่ประมาณจาก Export */
  estimated: number;
};

export const rateOf = (a: Pick<MyGmvAgg, "gmv" | "hours">) => (a.hours > 0 ? a.gmv / a.hours : null);
const counted = (s: MyGmvSlot) => s.status === "entered" || s.status === "estimated" || s.status === "covered";

/** รวมตามกลุ่ม: ยอดที่กรอกรวมหลาย slot แบ่งตามชั่วโมงของแต่ละ slot (share) · ผลรวมทุกกลุ่ม = ยอดรวมจริง */
export function aggregate(slots: MyGmvSlot[], keyOf: (s: MyGmvSlot) => string, labelOf: (key: string) => string = (k) => k): MyGmvAgg[] {
  const m = new Map<string, MyGmvAgg>();
  for (const s of slots) {
    if (!counted(s)) continue;
    const key = keyOf(s);
    const a = m.get(key) ?? { key, label: labelOf(key), gmv: 0, hours: 0, slots: 0, estimated: 0 };
    a.slots++;
    a.gmv += s.share ?? 0;
    a.hours += s.status === "estimated" ? s.gmvHours : s.hours;
    if (s.status === "estimated") a.estimated += s.share ?? 0;
    m.set(key, a);
  }
  return [...m.values()].map((a) => ({ ...a, gmv: r2(a.gmv), hours: r2(a.hours), estimated: r2(a.estimated) }));
}

const total = (slots: MyGmvSlot[], key = "all", label = "รวม"): MyGmvAgg =>
  aggregate(slots, () => key, () => label)[0] ?? { key, label, gmv: 0, hours: 0, slots: 0, estimated: 0 };

export const inMonth = (slots: MyGmvSlot[], month: string) => slots.filter((s) => s.date.startsWith(month));

const pad2 = (n: number) => String(n).padStart(2, "0");
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}
const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export type MyGmvMonth = MyGmvAgg & { month: string; partial: boolean };

/** ยอดรายเดือน first..last (เดือนที่ยังไม่จบ = partial) */
export function monthSeries(d: Pick<MyGmvData, "slots" | "first" | "today">, last: string): MyGmvMonth[] {
  const out: MyGmvMonth[] = [];
  for (let m = d.first; m <= last; m = shiftMonth(m, 1)) {
    out.push({ ...total(inMonth(d.slots, m), m, m), month: m, partial: m >= d.today.slice(0, 7) });
  }
  return out;
}

export type MyGmvSummary = {
  month: string;
  cur: MyGmvAgg;
  /** เดือนก่อน: ทั้งเดือน / ถึงวันเดียวกัน (เดือนที่เลือกยังไม่จบ) */
  prev: MyGmvAgg;
  prevSame: MyGmvAgg | null;
  partial: boolean;
  /** วันที่ของเดือนนี้ที่นับถึง (เดือนที่ยังไม่จบ = วันนี้) */
  uptoDay: number;
  planned: { slots: number; hours: number };
  upcoming: { slots: number; hours: number };
  /** ไลฟ์แล้วแต่ยังไม่มียอด (ไม่ได้กรอก + ไฟล์ Export ยังไม่ได้อัปโหลด) */
  missing: MyGmvSlot[];
  standby: number;
  bands: MyGmvAgg[];
  kinds: MyGmvAgg[];
  campaigns: MyGmvAgg[];
  platforms: MyGmvAgg[];
  days: { date: string; gmv: number; hours: number; slots: number }[];
  top: MyGmvSlot[];
};

export function summary(d: Pick<MyGmvData, "slots" | "today">, month: string): MyGmvSummary {
  const list = inMonth(d.slots, month);
  const prevMonth = shiftMonth(month, -1);
  const prevList = inMonth(d.slots, prevMonth);
  const partial = month >= d.today.slice(0, 7);
  const uptoDay = month === d.today.slice(0, 7) ? Number(d.today.slice(8, 10)) : daysIn(month);
  const sameDay = Math.min(uptoDay, daysIn(prevMonth));
  const live = list.filter((s) => s.status !== "upcoming");
  const up = list.filter((s) => s.status === "upcoming");
  const sumH = (l: MyGmvSlot[]) => r2(l.reduce((a, s) => a + s.hours, 0));
  const byDate = new Map<string, { date: string; gmv: number; hours: number; slots: number }>();
  for (let i = 1; i <= daysIn(month); i++) byDate.set(`${month}-${pad2(i)}`, { date: `${month}-${pad2(i)}`, gmv: 0, hours: 0, slots: 0 });
  for (const a of aggregate(list, (s) => s.date)) byDate.set(a.key, { date: a.key, gmv: a.gmv, hours: a.hours, slots: a.slots });
  return {
    month,
    cur: total(list),
    prev: total(prevList),
    prevSame: partial ? total(prevList.filter((s) => Number(s.date.slice(8, 10)) <= sameDay)) : null,
    partial,
    uptoDay,
    planned: { slots: list.length - list.filter((s) => s.status === "standby").length, hours: sumH(list.filter((s) => s.status !== "standby")) },
    upcoming: { slots: up.length, hours: sumH(up) },
    missing: live.filter((s) => s.status === "none"),
    standby: list.filter((s) => s.status === "standby").length,
    bands: BANDS.map((b) => aggregate(list.filter((s) => s.band === b), () => b)[0]).filter((a): a is MyGmvAgg => !!a),
    kinds: aggregate(list, (s) => (s.campaign ? "C" : "N"), (k) => (k === "C" ? "วันแคมเปญ" : "วันปกติ")).sort((a, b) => b.key.localeCompare(a.key)),
    campaigns: aggregate(list.filter((s) => s.campaign), (s) => s.campaign).sort((a, b) => b.gmv - a.gmv),
    platforms: aggregate(list, (s) => s.platform).sort((a, b) => b.gmv - a.gmv),
    days: [...byDate.values()],
    top: list.filter((s) => s.status === "entered" || s.status === "estimated").sort((a, b) => (b.gmv ?? 0) - (a.gmv ?? 0)).slice(0, 5),
  };
}

// ---------- ข้อความ (หน้าเว็บ / Excel / สไลด์) ----------

export const baht = (v: number | null) => (v === null ? "-" : `฿${Math.round(v).toLocaleString("th-TH")}`);
export const hrs = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} ชม.`;
export const monText = (m: string) => fmtMonthLong.format(new Date(`${m}-01T12:00:00Z`));
export const monShort = (m: string) => `${fmtMonthShort.format(new Date(`${m}-01T12:00:00Z`))} ${m.slice(2, 4)}`;
export const dayText = (d: string) => fmtDayShort.format(parseKey(d));
/** เวลาของยอด: ยอดรวมหลายคิว = ตั้งแต่คิวแรก เช่น "09:30–13:30" */
export const slotTime = (s: MyGmvSlot) => `${s.from ?? s.start}–${s.end}`;
/** ที่มาของยอด (ยอดรวมหลายคิว = บอกจำนวนคิว) */
export const statusText = (s: MyGmvSlot) => (s.merged ? `กรอกรวม ${s.merged} คิว` : s.status === "covered" ? `รวมในคิว ${s.coveredBy}` : STATUS_TEXT[s.status]);
/** ยอดของ slot (ช่องในตาราง) */
export const slotGmv = (s: MyGmvSlot) => (s.gmv !== null ? baht(s.gmv) : s.status === "covered" ? `รวมในคิว ${s.coveredBy}` : "-");
export const slotRate = (s: MyGmvSlot) => (s.gmv !== null && s.gmvHours > 0 ? baht(s.gmv / s.gmvHours) : "-");
export const SOURCE_NOTE = "ยอดที่กรอกใน slot · คิวที่ไม่ได้กรอก = ประมาณจากไฟล์ Export";
/** กราฟ / ตารางที่แยกตามวัน / ช่วงเวลา / แคมเปญ */
export const SPLIT_NOTE = "กรอกยอดรวมหลายคิว (เช่น 09:30–13:30 กรอกที่คิว 11:30) = แบ่งยอดตามชั่วโมงของแต่ละคิว";
/** ข้อความเทียบเดือนก่อน (เดือนที่ยังไม่จบ = เทียบเดือนก่อนถึงวันเดียวกัน) */
export const prevNote = (s: Pick<MyGmvSummary, "month" | "partial" | "uptoDay" | "prev">) =>
  !s.prev.gmv ? `${monShort(shiftMonth(s.month, -1))} ไม่มีข้อมูลเทียบ`
    : s.partial ? `เทียบ ${monText(shiftMonth(s.month, -1))} ถึงวันที่ ${s.uptoDay}` : `เทียบ ${monText(shiftMonth(s.month, -1))} ทั้งเดือน`;

export const STATUS_TEXT: Record<MyGmvStatus, string> = {
  entered: "กรอกใน slot",
  estimated: "ประมาณจาก Export",
  covered: "รวมในคิวถัดไป",
  none: "ยังไม่มียอด",
  standby: "สแตนด์บาย (ไม่นับ)",
  upcoming: "รอไลฟ์",
};
