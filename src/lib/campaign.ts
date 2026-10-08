// แคมเปญของ slot (ช่อง Campaign ใน mc_slots) — ใช้ทั้งฝั่ง browser และ server
//
// แคมเปญหลัก = Pay Day / วันเลขเบิ้ล (3.3 … 10.10 … 12.12) / Prime Day / Mid Month
//   slot ที่ติดแท็กอื่น (CEO Live, NPD NEO ฯลฯ) แต่วันที่อยู่ในช่วงของแคมเปญหลัก = นับเข้าแคมเปญหลักนั้น (ยังเก็บแท็กเดิมไว้เป็นป้าย)
//   ไม่อยู่ในช่วงแคมเปญหลักไหน = เป็นแคมเปญของตัวเอง (track แยก)
// ช่วงของแคมเปญ = วันที่ของ slot ที่ติดชื่อนั้น (วันที่ห่างกันเกิน 3 วัน = คนละรอบ เช่น Pay Day ก.ย. / ต.ค.)

export type CampFamily = "payday" | "double" | "prime" | "midmonth" | "other";

export type Norm = { label: string; nameKey: string; family: CampFamily; big: boolean; isCeo: boolean };

export type CampInfo = {
  /** รหัสรอบ (ชื่อ + วันเริ่ม) เช่น "pay day@2026-09-25" */
  key: string;
  nameKey: string;
  label: string;
  family: CampFamily;
  big: boolean;
  start: string;
  end: string;
  /** แท็กเดิมของ slot ที่ถูกนับเข้าแคมเปญหลัก / slot ที่มี CEO ว่าง = ไม่มีแท็กเพิ่ม */
  tag: string;
  isCeo: boolean;
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const EVENT = /^(ceo\s*live|ceo\s*phone\s*in|ceo\s*birth\s*day|kol)$/i;
const GAP_DAYS = 3;

/** ชื่อแคมเปญที่พิมพ์ในชีต -> ชื่อมาตรฐาน (null = ไม่มีแคมเปญ / เป็นเลขเพี้ยนจากข้อมูลเก่า) */
export function normalizeCampaign(raw: unknown): Norm | null {
  let s = clean(String(raw ?? ""));
  if (!s || /^\d+$/.test(s)) return null;
  // ชีตแปลง "10.10" เป็นเลข 10.1 และบางค่าเพี้ยนเป็น "3.30000000000001"
  if (/^\d{1,2}\.\d+$/.test(s)) s = String(Math.round(Number(s) * 100) / 100);
  if (s === "10.1") s = "10.10";

  const parts = s.split(/\s+x\s+/i).map(clean).filter(Boolean);
  const isCeo = /ceo/i.test(s);
  const rest = parts.filter((p) => !EVENT.test(p));
  const base = clean(rest[0] ?? parts[0] ?? s);

  let m: RegExpMatchArray | null;
  if (/^pay\s*day$/i.test(base)) return { label: "Pay Day", nameKey: "pay day", family: "payday", big: true, isCeo };
  if ((m = base.match(/^(\d{1,2})\.(\d{1,2})$/)) && m[1] === m[2]) {
    const l = `${m[1]}.${m[2]}`;
    return { label: l, nameKey: l, family: "double", big: true, isCeo };
  }
  if (/^prime\s*days?(\s+npd)?$/i.test(base)) return { label: "Prime Day", nameKey: "prime day", family: "prime", big: true, isCeo };
  if (/^mid\s*month$/i.test(base)) return { label: "Mid Month", nameKey: "mid month", family: "midmonth", big: true, isCeo };
  const label = /^ceo\s*live$/i.test(base) ? "CEO Live" : base;
  return { label, nameKey: label.toLowerCase(), family: "other", big: false, isCeo };
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** วันที่ (เรียงแล้ว) -> ช่วงต่อเนื่อง (ห่างกันเกิน GAP_DAYS = คนละช่วง) */
function clusters(dates: string[]): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  for (const d of [...new Set(dates)].sort()) {
    const last = out[out.length - 1];
    if (last && (dayMs(d) - dayMs(last.end)) / 86400_000 <= GAP_DAYS) last.end = d;
    else out.push({ start: d, end: d });
  }
  return out;
}

export type CampInput = { id: number; date: string; campaign: string | null | undefined };

/** กำหนดแคมเปญที่นับของแต่ละ slot (ดูกฎด้านบน) — slot ที่ไม่มีแคมเปญไม่มีในผลลัพธ์ */
export function assignCampaigns(slots: CampInput[]): Map<number, CampInfo> {
  const norms = new Map<number, Norm>();
  const datesBy = new Map<string, string[]>(); // nameKey -> วันที่ (แคมเปญหลัก)
  const otherBy = new Map<string, string[]>(); // nameKey -> วันที่ (แคมเปญอื่น)
  for (const s of slots) {
    const n = normalizeCampaign(s.campaign);
    if (!n) continue;
    norms.set(s.id, n);
    const m = n.big ? datesBy : otherBy;
    m.set(n.nameKey, [...(m.get(n.nameKey) ?? []), s.date]);
  }

  type Inst = { key: string; nameKey: string; label: string; family: CampFamily; big: boolean; start: string; end: string };
  const bigInst: Inst[] = [];
  const labelOf = new Map<string, Norm>();
  for (const n of norms.values()) labelOf.set(n.nameKey, n);
  for (const [nameKey, dates] of datesBy) {
    const n = labelOf.get(nameKey)!;
    for (const c of clusters(dates)) bigInst.push({ key: `${nameKey}@${c.start}`, nameKey, label: n.label, family: n.family, big: true, ...c });
  }
  const otherInst: Inst[] = [];
  for (const [nameKey, dates] of otherBy) {
    const n = labelOf.get(nameKey)!;
    for (const c of clusters(dates)) otherInst.push({ key: `${nameKey}@${c.start}`, nameKey, label: n.label, family: n.family, big: false, ...c });
  }
  const within = (list: Inst[], nameKey: string | null, d: string) =>
    list.filter((i) => (nameKey === null || i.nameKey === nameKey) && i.start <= d && d <= i.end)
      .sort((a, b) => (dayMs(a.end) - dayMs(a.start)) - (dayMs(b.end) - dayMs(b.start)) || a.start.localeCompare(b.start))[0];

  const out = new Map<number, CampInfo>();
  for (const s of slots) {
    const n = norms.get(s.id);
    if (!n) continue;
    // แคมเปญหลัก: รอบของตัวเอง / แท็กอื่น: ถ้าอยู่ในช่วงแคมเปญหลักให้นับเข้าแคมเปญนั้น ไม่งั้นเป็นรอบของตัวเอง
    const own = n.big ? within(bigInst, n.nameKey, s.date) : undefined;
    const host = n.big ? own : within(bigInst, null, s.date);
    const inst = host ?? within(otherInst, n.nameKey, s.date);
    if (!inst) continue;
    const folded = !n.big && !!host;
    const tag = folded ? n.label : n.isCeo && !/ceo/i.test(n.label) ? "CEO Live" : "";
    out.set(s.id, { key: inst.key, nameKey: inst.nameKey, label: inst.label, family: inst.family, big: inst.big, start: inst.start, end: inst.end, tag, isCeo: n.isCeo });
  }
  return out;
}

/** รอบก่อนหน้าที่เทียบได้: Pay Day / Prime Day / Mid Month = รอบก่อนของชื่อเดียวกัน, วันเลขเบิ้ล = วันเลขเบิ้ลรอบก่อนหน้า (ไม่มี = แคมเปญอื่น) */
export function previousInstance<T extends { key: string; nameKey: string; family: CampFamily; start: string; end: string }>(cur: T, all: T[]): T | null {
  if (cur.family === "other") return null;
  return all
    .filter((x) => x.key !== cur.key && x.family === cur.family && (cur.family === "double" || x.nameKey === cur.nameKey) && x.end < cur.start)
    .sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
}

// ---------- ข้อความแสดงรอบแคมเปญ ----------

const MONTH_SHORT = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { month: "short", timeZone: "UTC" });
export const monthShortOf = (d: string) => MONTH_SHORT.format(new Date(`${d}T12:00:00Z`));
const dayNum = (d: string) => Number(d.slice(8));
/** ช่วงวัน เช่น "7–11 ต.ค." / "30 ก.ย. – 2 ต.ค." / "15 ต.ค." */
export const windowText = (a: string, b: string) =>
  a === b ? `${dayNum(a)} ${monthShortOf(a)}`
    : a.slice(0, 7) === b.slice(0, 7) ? `${dayNum(a)}–${dayNum(b)} ${monthShortOf(a)}`
      : `${dayNum(a)} ${monthShortOf(a)} – ${dayNum(b)} ${monthShortOf(b)}`;
/** ชื่อรอบ: แคมเปญที่เกิดซ้ำทุกเดือนต่อท้ายด้วยเดือน เช่น "Pay Day ก.ย." */
export const instLabel = (i: { label: string; family: CampFamily; start: string }) =>
  i.family === "payday" || i.family === "prime" || i.family === "midmonth" ? `${i.label} ${monthShortOf(i.start)}` : i.label;

// ---------- รายงานแคมเปญ (หน้า Campaign ของ Owner) ----------

export type CampPlatformRow = { platform: string; slots: number; hours: number; gmv: number; rate: number | null; lift: number | null };
/** 1 รอบของแคมเปญ เช่น Pay Day ต.ค. 2026 / 10.10 */
export type CampInstance = {
  key: string; nameKey: string; label: string; family: CampFamily; big: boolean; start: string; end: string;
  tags: string[];
  status: "done" | "live" | "upcoming";
  /** ทุก slot ในรอบ (รวมที่ยังไม่ถึงเวลา) */
  slots: number; plannedHours: number; mcs: number;
  /** เฉพาะ slot ที่ไลฟ์ไปแล้วและมียอดจากไฟล์ Export: ชั่วโมง / GMV / GMV/ชม. / ดันยอดกี่เท่าของวันปกติ (ช่อง+ช่วงเวลาเดียวกัน) */
  hours: number; gmv: number; rate: number | null; lift: number | null;
  platforms: CampPlatformRow[];
  prevKey: string | null; prevLabel: string | null; prevRate: number | null; prevLift: number | null;
};
/** ยอด Mc คนหนึ่งในแคมเปญรอบหนึ่ง (key "" = วันปกติ) แยกตามที่มา: E = ยอดที่กรอกใน slot (แม่น) / X = แบ่งจากไฟล์ Export (ประมาณ) */
export type CampCell = { mc: string; key: string; slots: number; hE: number; aE: number; eE: number; hX: number; aX: number; eX: number };
export type CampaignReport = {
  from: string; to: string; today: string;
  instances: CampInstance[];
  cells: CampCell[];
  normal: { platform: string; hours: number; gmv: number; rate: number | null }[];
};

// ---------- ช่วงเวลาของ slot ----------

export const BANDS = ["เช้า", "บ่าย", "เย็น", "ไพรม์", "ดึก"] as const;
export type Band = (typeof BANDS)[number];
/** ช่วงเวลาจากเวลาเริ่ม slot (HH:MM...) : เช้า 07–11 / บ่าย 11–15 / เย็น 15–19 / ไพรม์ 19–23 / ดึก 23–07 */
export function bandOf(startTime: string): Band {
  const h = Number(String(startTime).slice(0, 2));
  return h >= 7 && h < 11 ? "เช้า" : h >= 11 && h < 15 ? "บ่าย" : h >= 15 && h < 19 ? "เย็น" : h >= 19 && h < 23 ? "ไพรม์" : "ดึก";
}
