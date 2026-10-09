// สถิติไลฟ์ TikTok / Shopee: อ่านไฟล์ Export (.xlsx) + คำนวณตัวชี้วัด ใช้ได้ทั้งฝั่ง server และ browser
//   ตัวเลขหลัก: TikTok GMV = LIVE-attributed GMV, ออเดอร์ = Orders Paid
//               Shopee GMV / ออเดอร์ / ชิ้น = คำสั่งซื้อที่ยืนยันแล้ว
//   CO: TikTok = ออเดอร์ ÷ Product Clicks (= CTOR ในไฟล์) / Shopee = ออเดอร์ ÷ ผู้ชมทั้งหมด
//   ค่าที่เป็นอัตรา (CTR, CO, GMV/ชม.) คำนวณจากยอดรวมเสมอ ไม่เฉลี่ยจาก % ของแต่ละไลฟ์

import { strFromU8, unzipSync } from "fflate";

export const PLATFORMS = ["TikTok", "Shopee"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type LiveSession = {
  platform: Platform;
  accountId: string;
  accountName: string;
  title: string;
  startedAt: string; // ISO
  durationSec: number;
  gmv: number;
  orders: number;
  itemsSold: number;
  customers: number | null;
  viewers: number;
  views: number | null;
  engagedViewers: number | null;
  avgViewSec: number | null;
  comments: number | null;
  shares: number | null;
  likes: number | null;
  newFollowers: number | null;
  addToCart: number | null;
  impressions: number | null;
  clicks: number | null;
  raw?: Record<string, string>;
};

/** auto = อ่านจากชื่อ Campaign ใน slot (Plan Slot Live / ชีต) แก้/ลบในหน้านี้ไม่ได้ (id ติดลบ) */
export type Campaign = { id: number; name: string; startsAt: string; endsAt: string; compareId: number | null; auto?: boolean };

// ---------- เวลาไทย ----------

const BKK = 7 * 3600_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** วัน/เวลาไทย -> ISO (เดือนเกิน 12 / วันเกินเดือน ปัดไปเดือนถัดไปให้เอง) */
export const bkkIso = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi, s) - BKK).toISOString();

export function bkkParts(iso: string) {
  const t = new Date(Date.parse(iso) + BKK);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}

/** ISO -> "YYYY-MM-DDTHH:mm" เวลาไทย (ใช้กับ input datetime-local) */
export function bkkLocal(iso: string) {
  const p = bkkParts(iso);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}
/** "YYYY-MM-DDTHH:mm" เวลาไทย -> ISO */
export function fromBkkLocal(v: string) {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? bkkIso(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
}

export const monthOf = (iso: string) => {
  const p = bkkParts(iso);
  return `${p.y}-${pad(p.m)}`;
};

/** "YYYY-MM" -> ช่วงเวลา [from, to) ของเดือนนั้นตามเวลาไทย */
export function monthWindow(key: string) {
  const [y, m] = key.split("-").map(Number);
  return { from: bkkIso(y, m, 1), to: bkkIso(y, m + 1, 1) };
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * ช่วงเทียบอัตโนมัติ = ช่วงเดียวกันของเดือนก่อน ยาวเท่ากัน
 *   แคมเปญวันเลขเบิ้ล (10.10) เทียบกับวันเลขเบิ้ลของเดือนก่อน (9.9) / วันอื่นเทียบวันที่เดียวกัน (เดือนก่อนไม่มีวันนั้น = วันสุดท้ายของเดือน)
 */
export function previousWindow(startsAt: string, endsAt: string) {
  const s = bkkParts(startsAt);
  const y = s.m === 1 ? s.y - 1 : s.y;
  const m = s.m === 1 ? 12 : s.m - 1;
  const doubleDay = s.d === s.m;
  const d = doubleDay ? m : Math.min(s.d, daysIn(y, m));
  const from = bkkIso(y, m, d, s.h, s.mi, s.s);
  const to = new Date(Date.parse(from) + Date.parse(endsAt) - Date.parse(startsAt)).toISOString();
  return { from, to, doubleDay };
}

// ---------- อ่านไฟล์ .xlsx ----------

const decodeXml = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const textOf = (xml: string) => decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));

function colIndex(ref: string) {
  let i = 0;
  for (const c of ref.match(/^[A-Z]+/)?.[0] ?? "A") i = i * 26 + c.charCodeAt(0) - 64;
  return i - 1;
}

/** ชีตแรกของไฟล์ .xlsx -> ตาราง (ข้อความทุกช่อง) */
export function readXlsx(data: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name.startsWith("xl/") && f.name.endsWith(".xml") || f.name.endsWith(".rels") });
  } catch {
    throw new Error("เปิดไฟล์ไม่ได้ ต้องเป็นไฟล์ Excel (.xlsx)");
  }
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : "");

  // ชีตแรกตามลำดับใน workbook (ไม่เจอ = sheet1.xml)
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rid = read("xl/workbook.xml").match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid && read("xl/_rels/workbook.xml.rels").match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheet = read(sheetPath);
  if (!sheet) throw new Error("ไม่พบข้อมูลในไฟล์ (ชีตว่าง)");

  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    // แถวว่างไม่อยู่ในไฟล์ เติมให้เลขแถวตรงกับ Excel
    const rowNo = Number(r[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1);
    while (rows.length < rowNo - 1) rows.push([]);
    const cells: string[] = [];
    for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = c[1].match(/\bt="(\w+)"/)?.[1];
      const body = c[2] ?? "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const value = type === "inlineStr" ? textOf(body) : type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
      cells[ref ? colIndex(ref) : cells.length] = value.trim();
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}

// ---------- แปลงค่าในไฟล์ ----------

/** "฿69,852" / "8.88%" / "1.21082485E8" -> ตัวเลข (ว่าง/อ่านไม่ได้ = null) */
function toNum(v: string | undefined) {
  const s = String(v ?? "").replace(/[฿,\s%]/g, "");
  if (!s || s === "-" || s === "--") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const toInt = (v: string | undefined) => {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
};

/** เวลาเป็นวินาที: "4h 0min" / "1h 2min 3s" / "04:00:20" / "27" (วินาที) / 0.1669 (เศษวันของ Excel) */
function toSeconds(v: string | undefined, plainNumberIs: "sec" | "day" = "sec") {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const hms = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +(hms[3] ?? 0);
  if (/[hms]/i.test(s)) {
    const h = s.match(/(\d+)\s*h/i)?.[1] ?? 0, m = s.match(/(\d+)\s*m/i)?.[1] ?? 0, sec = s.match(/(\d+)\s*s/i)?.[1] ?? 0;
    return +h * 3600 + +m * 60 + +sec;
  }
  const n = toNum(s);
  if (n === null) return null;
  return Math.round(plainNumberIs === "day" && n < 10 ? n * 86400 : n);
}

/** "2026/08/31/ 19:30" (TikTok) / "31-08-2026 21:59" (Shopee) / เลขวันที่ของ Excel -> ISO (เวลาไทย) */
function toWhen(v: string | undefined) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})\D*?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return bkkIso(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
  m = s.match(/^(\d{1,2})\D(\d{1,2})\D(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return bkkIso(+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0));
  const serial = toNum(s);
  if (serial !== null && serial > 30000 && serial < 80000) {
    // Excel เก็บวันที่เป็นจำนวนวันนับจาก 30 ธ.ค. 1899 (เวลาในไฟล์ = เวลาไทย)
    return new Date(Math.round((serial - 25569) * 86400_000) - BKK).toISOString();
  }
  return null;
}

// ---------- รูปแบบไฟล์ของแต่ละแพลตฟอร์ม ----------

type Get = (col: string) => string | undefined;

const FORMATS: {
  platform: Platform;
  /** คอลัมน์ที่ต้องมี (ใช้ทั้งหาแถวหัวตาราง และตรวจว่าไฟล์ถูกแบบ) */
  required: string[];
  build: (get: Get) => Omit<LiveSession, "platform" | "raw"> | null;
}[] = [
  {
    platform: "TikTok",
    required: ["Creator ID", "Launched Time", "Duration", "LIVE-attributed GMV (฿)", "Orders Paid", "Viewers"],
    build: (get) => {
      const startedAt = toWhen(get("Launched Time"));
      const accountId = get("Creator ID") ?? "";
      if (!startedAt || !accountId) return null;
      return {
        accountId,
        accountName: get("Creator") || get("Nickname") || accountId,
        title: "",
        startedAt,
        durationSec: toSeconds(get("Duration"), "day") ?? 0,
        gmv: toNum(get("LIVE-attributed GMV (฿)")) ?? 0,
        orders: toInt(get("Orders Paid")) ?? 0,
        itemsSold: toInt(get("LIVE-attributed items sold")) ?? 0,
        customers: toInt(get("Unique customers")),
        viewers: toInt(get("Viewers")) ?? 0,
        views: toInt(get("Views")),
        engagedViewers: null,
        avgViewSec: toSeconds(get("Average viewing duration (LIVE streams)")),
        comments: toInt(get("Comments")),
        shares: toInt(get("Shares")),
        likes: toInt(get("LIVE likes")),
        newFollowers: toInt(get("New followers (Creator video)")),
        addToCart: null,
        impressions: toInt(get("Product Impressions")),
        clicks: toInt(get("Product Clicks")),
      };
    },
  },
  {
    platform: "Shopee",
    required: ["User Id", "เวลาเริ่มต้น", "ระยะเวลา", "ยอดขาย(คำสั่งซื้อที่ยืนยันแล้ว)", "คำสั่งซื้อ(คำสั่งซื้อที่ยืนยันแล้ว)", "ผู้ชมทั้งหมด"],
    build: (get) => {
      const startedAt = toWhen(get("เวลาเริ่มต้น"));
      const id = toNum(get("User Id"));
      if (!startedAt || id === null) return null;
      const accountId = String(Math.round(id));
      return {
        accountId,
        accountName: "Shopee", // ไฟล์ Shopee ไม่มีชื่อร้าน (มีแค่ User Id)
        title: get("ชื่อ Live") ?? "",
        startedAt,
        durationSec: toSeconds(get("ระยะเวลา"), "day") ?? 0,
        gmv: toNum(get("ยอดขาย(คำสั่งซื้อที่ยืนยันแล้ว)")) ?? 0,
        orders: toInt(get("คำสั่งซื้อ(คำสั่งซื้อที่ยืนยันแล้ว)")) ?? 0,
        itemsSold: toInt(get("สินค้าที่ขายได้(คำสั่งซื้อที่ยืนยันแล้ว)")) ?? 0,
        customers: null,
        viewers: toInt(get("ผู้ชมทั้งหมด")) ?? 0,
        views: null,
        engagedViewers: toInt(get("ผู้ชมที่มีส่วนร่วม")),
        avgViewSec: toSeconds(get("ระยะเวลาดู Live เฉลี่ย"), "day"),
        comments: toInt(get("คอมเมนต์ทั้งหมด")),
        shares: null,
        likes: null,
        newFollowers: null,
        addToCart: toInt(get("ATC")),
        impressions: null,
        clicks: null,
      };
    },
  },
];

export type ParsedFile = {
  platform: Platform;
  sessions: LiveSession[];
  /** แถวที่อ่านไม่ได้ (เลขแถวตาม Excel) */
  skipped: { row: number; reason: string }[];
};

/** ตาราง -> ไลฟ์ (หาแถวหัวตารางเองใน 10 แถวแรก ดูว่าเป็นไฟล์ของแพลตฟอร์มไหนจากชื่อคอลัมน์) */
export function parseRows(rows: string[][]): ParsedFile {
  for (const fmt of FORMATS) {
    const headerAt = rows.slice(0, 10).findIndex((r) => fmt.required.every((h) => r.includes(h)));
    if (headerAt < 0) continue;
    const header = rows[headerAt];
    const byKey = new Map<string, LiveSession>();
    const skipped: ParsedFile["skipped"] = [];
    rows.slice(headerAt + 1).forEach((r, i) => {
      const rowNo = headerAt + i + 2;
      if (r.every((c) => !c)) return;
      const get: Get = (col) => {
        const at = header.indexOf(col);
        return at < 0 ? undefined : r[at];
      };
      const s = fmt.build(get);
      if (!s) {
        skipped.push({ row: rowNo, reason: "ไม่มีรหัสบัญชีหรือเวลาเริ่มไลฟ์" });
        return;
      }
      // ไลฟ์ที่เปิดแล้วหลุดทันที (0 นาที ไม่มียอด ไม่มีคนดู) ไม่นับ
      if (!s.durationSec && !s.gmv && !s.viewers) {
        skipped.push({ row: rowNo, reason: "ไลฟ์ 0 นาที ไม่มีข้อมูล" });
        return;
      }
      // บัญชี + เวลาเริ่มซ้ำ = เก็บอันที่ไลฟ์นานกว่า
      const key = `${s.accountId}|${s.startedAt}`;
      const prev = byKey.get(key);
      if (prev && prev.durationSec >= s.durationSec) {
        skipped.push({ row: rowNo, reason: "เวลาเริ่มซ้ำกับไลฟ์อื่นของบัญชีเดียวกัน (เก็บอันที่ไลฟ์นานกว่า)" });
        return;
      }
      if (prev) skipped.push({ row: rowNo, reason: "เวลาเริ่มซ้ำกับไลฟ์อื่นของบัญชีเดียวกัน (ใช้แถวนี้แทน เพราะไลฟ์นานกว่า)" });
      const raw: Record<string, string> = {};
      header.forEach((h, j) => { if (h && r[j]) raw[h] = r[j]; });
      byKey.set(key, { platform: fmt.platform, ...s, raw });
    });
    return { platform: fmt.platform, sessions: [...byKey.values()], skipped };
  }
  throw new Error("ไม่รู้จักรูปแบบไฟล์นี้ ต้องเป็นไฟล์ Export รายการไลฟ์จาก TikTok LIVE หรือ Shopee Live");
}

// ---------- ตัวชี้วัด ----------

export type Totals = {
  lives: number;
  gmv: number;
  orders: number;
  items: number;
  durationSec: number;
  viewers: number;
  /** ค่าที่มีเฉพาะ TikTok: null = ไม่มีไลฟ์ TikTok ในชุดนี้ */
  views: number | null;
  impressions: number | null;
  clicks: number | null;
  /** ชั่วโมงไลฟ์ของ TikTok (วินาที) ใช้หาร Impressions ต่อชั่วโมง (ไม่ปนชั่วโมงของ Shopee) */
  tiktokSec: number | null;
  /** ฐานของ CO (TikTok = clicks, Shopee = viewers) null = มีทั้งสองแพลตฟอร์มปนกัน */
  coBase: number | null;
};

export function totalsOf(list: LiveSession[]): Totals {
  const t: Totals = { lives: 0, gmv: 0, orders: 0, items: 0, durationSec: 0, viewers: 0, views: null, impressions: null, clicks: null, tiktokSec: null, coBase: 0 };
  const platforms = new Set<Platform>();
  const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);
  for (const s of list) {
    platforms.add(s.platform);
    t.lives++;
    t.gmv += s.gmv;
    t.orders += s.orders;
    t.items += s.itemsSold;
    t.durationSec += s.durationSec;
    t.viewers += s.viewers;
    if (s.platform === "TikTok") {
      t.views = add(t.views, s.views ?? 0);
      t.impressions = add(t.impressions, s.impressions ?? 0);
      t.clicks = add(t.clicks, s.clicks ?? 0);
      t.tiktokSec = add(t.tiktokSec, s.durationSec);
    }
    t.coBase = (t.coBase ?? 0) + (s.platform === "TikTok" ? s.clicks ?? 0 : s.viewers);
  }
  if (platforms.size > 1) t.coBase = null;
  return t;
}

const ratio = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : a / b);

export type MetricKey = "gmv" | "orders" | "duration" | "gmvPerHour" | "viewers" | "viewersPerHour" | "views" | "impressions" | "impressionsPerHour" | "ctr" | "co" | "lives";

export const METRICS: {
  key: MetricKey;
  label: string;
  /** แสดงใต้ชื่อ เช่น เฉพาะ TikTok */
  note?: string;
  kind: "baht" | "int" | "hours" | "pct";
  value: (t: Totals) => number | null;
}[] = [
  { key: "gmv", label: "GMV", kind: "baht", value: (t) => t.gmv },
  { key: "orders", label: "ออเดอร์", kind: "int", value: (t) => t.orders },
  { key: "duration", label: "ชั่วโมงไลฟ์", kind: "hours", value: (t) => t.durationSec / 3600 },
  { key: "gmvPerHour", label: "GMV / ชม.", kind: "baht", value: (t) => ratio(t.gmv, t.durationSec / 3600) },
  { key: "viewers", label: "Viewers", kind: "int", value: (t) => t.viewers },
  // Viewers ÷ ชั่วโมงไลฟ์ (ทั้ง TikTok และ Shopee มี Viewers)
  { key: "viewersPerHour", label: "Viewers / ชม.", kind: "int", value: (t) => ratio(t.viewers, t.durationSec / 3600) },
  { key: "views", label: "Views", note: "TikTok", kind: "int", value: (t) => t.views },
  { key: "impressions", label: "Product Impressions", note: "TikTok", kind: "int", value: (t) => t.impressions },
  // Impressions ÷ ชั่วโมงไลฟ์ของ TikTok (Shopee ไม่มี Impressions)
  { key: "impressionsPerHour", label: "Impressions / ชม.", note: "TikTok", kind: "int", value: (t) => ratio(t.impressions, t.tiktokSec === null ? null : t.tiktokSec / 3600) },
  { key: "ctr", label: "CTR", note: "คลิก ÷ Impressions (TikTok)", kind: "pct", value: (t) => ratio(t.clicks, t.impressions) },
  { key: "co", label: "CO", note: "TikTok: ÷ คลิก · Shopee: ÷ Viewers", kind: "pct", value: (t) => ratio(t.orders, t.coBase) },
  { key: "lives", label: "จำนวนไลฟ์", kind: "int", value: (t) => t.lives },
];

export const metricOf = (key: MetricKey) => METRICS.find((m) => m.key === key)!;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function fmtMetric(kind: (typeof METRICS)[number]["kind"], v: number | null, short = false) {
  if (v === null || !Number.isFinite(v)) return "-";
  if (kind === "pct") return `${(v * 100).toFixed(2)}%`;
  if (kind === "hours") return `${v.toLocaleString("th-TH", { maximumFractionDigits: 1 })} ชม.`;
  const n = short && Math.abs(v) >= 10_000 ? compact.format(v) : Math.round(v).toLocaleString("th-TH");
  return kind === "baht" ? `฿${n}` : n;
}

/** เปลี่ยนไปกี่ % (ฐานเป็น 0 / ไม่มีข้อมูล = null) */
export const changeOf = (cur: number | null, prev: number | null) =>
  cur === null || prev === null || prev === 0 ? null : (cur - prev) / Math.abs(prev);

/** กรองตามแพลตฟอร์ม / บัญชี ("" = ทั้งหมด) */
export function filterSessions(list: LiveSession[], platform: Platform | "", account: string) {
  return list.filter((s) => (!platform || s.platform === platform) && (!account || `${s.platform}|${s.accountId}` === account));
}

/** ชื่อบัญชีพร้อมแพลตฟอร์ม เช่น "TikTok · GLORY VITAL" (ชื่อซ้ำกับแพลตฟอร์ม = "Shopee" เฉย ๆ) */
export const accountLabel = (a: { platform: string; name: string }) =>
  a.name.toLowerCase() === a.platform.toLowerCase() ? a.name : `${a.platform} · ${a.name}`;

/** บัญชีทั้งหมดที่เจอ เรียงตามแพลตฟอร์ม -> ชื่อ */
export function accountsOf(list: LiveSession[]) {
  const map = new Map<string, { key: string; platform: Platform; name: string }>();
  for (const s of list) {
    const key = `${s.platform}|${s.accountId}`;
    if (!map.has(key)) map.set(key, { key, platform: s.platform, name: s.accountName || s.accountId });
  }
  return [...map.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
}

// ---------- ตรวจข้อมูลที่ส่งมาบันทึก (ฝั่ง server) ----------

const cleanInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

export function cleanSession(v: unknown): LiveSession | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const platform = PLATFORMS.find((p) => p === o.platform);
  const accountId = typeof o.accountId === "string" ? o.accountId.trim().slice(0, 64) : "";
  const started = typeof o.startedAt === "string" ? Date.parse(o.startedAt) : NaN;
  const gmv = typeof o.gmv === "number" && Number.isFinite(o.gmv) ? Math.round(o.gmv * 100) / 100 : null;
  if (!platform || !accountId || !Number.isFinite(started) || gmv === null) return null;
  const raw: Record<string, string> = {};
  if (o.raw && typeof o.raw === "object") {
    for (const [k, x] of Object.entries(o.raw).slice(0, 60)) raw[String(k).slice(0, 80)] = String(x).slice(0, 300);
  }
  return {
    platform,
    accountId,
    accountName: String(o.accountName ?? "").slice(0, 120),
    title: String(o.title ?? "").slice(0, 300),
    startedAt: new Date(started).toISOString(),
    durationSec: cleanInt(o.durationSec) ?? 0,
    gmv,
    orders: cleanInt(o.orders) ?? 0,
    itemsSold: cleanInt(o.itemsSold) ?? 0,
    customers: cleanInt(o.customers),
    viewers: cleanInt(o.viewers) ?? 0,
    views: cleanInt(o.views),
    engagedViewers: cleanInt(o.engagedViewers),
    avgViewSec: cleanInt(o.avgViewSec),
    comments: cleanInt(o.comments),
    shares: cleanInt(o.shares),
    likes: cleanInt(o.likes),
    newFollowers: cleanInt(o.newFollowers),
    addToCart: cleanInt(o.addToCart),
    impressions: cleanInt(o.impressions),
    clicks: cleanInt(o.clicks),
    raw,
  };
}
