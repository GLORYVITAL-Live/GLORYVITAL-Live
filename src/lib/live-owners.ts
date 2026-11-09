// แยกยอดไลฟ์จากไฟล์ Export ตามกลุ่มที่ไลฟ์ โดยเทียบเวลาไลฟ์กับแพลนในหน้า Plan Slot Live — ฟังก์ชันล้วน (เทสได้ ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ)
//   ดูเฉพาะช่องที่มีแพลนกลุ่มในเดือนนั้น · ไม่ใช่เวลาของ Agency = ทีมเรา: TikTok = ของเรา (owner null) · Shopee = In house (ผู้ใช้ยืนยัน 2026-11-09)
//   ไลฟ์ที่บันทึกกลุ่มไว้แล้ว (live_sessions.live_owner) ใช้ค่านั้นทั้งไลฟ์ ไม่ดูแพลน: เดือนก่อนมีแพลนในเว็บ / ไลฟ์ที่ไม่มีเวลาเริ่มจริง
//   ไลฟ์ที่คร่อมหลายกลุ่ม = แบ่งยอดตามนาที (ประมาณ) · ซ้อนกันไม่ถึง 10 นาทีไม่นับ (คาบเกี่ยวรอยต่อ เช่น เปิดไลฟ์ก่อนเวลา 4 นาที)

import { monthOf, type LiveSession, type Platform } from "@/lib/live-stats";
import { isShopeePlatform, platformLabel, slotPlatformOf } from "@/lib/platform";
import { ownerText, spanMs } from "@/lib/plan-clash";

export type OwnerSpan = { channel: string; owner: string; startMs: number; endMs: number };
/** owner null = TikTok นอกเวลา Agency (ของเรา) · Shopee นอกเวลา Agency = owner "In house" */
export type OwnerRow = { owner: string | null; label: string; lives: number; sec: number; gmv: number; orders: number };
export type ChannelSplit = {
  channel: string; label: string; lives: number; sec: number; gmv: number; rows: OwnerRow[];
  /** ไลฟ์ที่คร่อมหลายกลุ่ม (ยอดส่วนนี้เป็นตัวเลขประมาณ) */
  splitLives: number; splitGmv: number;
};

/** ค่า live_owner ของไลฟ์ทีมเรา (แยกจาก null ที่แปลว่ายังไม่ได้บันทึก ให้เทียบเวลากับแพลน) */
export const LIVE_OWNER_OURS = "ours";

const MIN_OVERLAP_MS = 10 * 60_000;
const channelKey = (c: string) => c.trim().toLowerCase();

/** แถวในตาราง agency_slots -> ช่วงเวลาจริงของกลุ่ม */
export const ownerSpanOf = (r: { agency: string; platform: string; live_date: string; start_time: string; end_time: string }): OwnerSpan => ({
  channel: r.platform.trim(), owner: r.agency,
  ...spanMs({ date: r.live_date, platform: r.platform, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) }),
});

/**
 * ไลฟ์นี้เป็นของกลุ่มไหนกี่ส่วน (spans = แพลนของช่องนี้ · ส่วนรวมกัน = 1)
 *   ไลฟ์สั้นกว่า 20 นาที: นับกลุ่มที่ซ้อนกันเกินครึ่งของไลฟ์
 *   ไลฟ์ 0 นาที (ยังไลฟ์อยู่ตอน Export): ดูเวลาเริ่ม + 10 นาที (เปิดไลฟ์ก่อนเวลาได้ เช่น 05:59 ของแพลน 06:00) ไม่อยู่ในแพลนไหน = ดูเวลาเริ่ม
 */
export function ownerShares(startMs: number, sec: number, spans: OwnerSpan[]): { owner: string | null; share: number }[] {
  const len = sec * 1000;
  if (len <= 0) {
    const at = (ms: number) => spans.find((x) => x.startMs <= ms && ms < x.endMs);
    return [{ owner: (at(startMs + MIN_OVERLAP_MS) ?? at(startMs))?.owner ?? null, share: 1 }];
  }
  const need = Math.min(MIN_OVERLAP_MS, len / 2);
  const byOwner = new Map<string | null, number>();
  let covered = 0;
  for (const x of spans) {
    const ms = Math.min(startMs + len, x.endMs) - Math.max(startMs, x.startMs);
    if (ms <= 0) continue;
    byOwner.set(x.owner, (byOwner.get(x.owner) ?? 0) + ms);
    covered += ms;
  }
  byOwner.set(null, len - covered);
  const kept = [...byOwner].filter(([, ms]) => ms >= need);
  if (!kept.length) return [{ owner: null, share: 1 }];
  const total = kept.reduce((a, [, ms]) => a + ms, 0);
  return kept.map(([owner, ms]) => ({ owner, share: ms / total }));
}

/**
 * แยกยอดตามกลุ่ม เฉพาะไลฟ์ที่บันทึกกลุ่มไว้ / อยู่ในเดือนที่ช่องนั้นมีแพลนกลุ่ม (TikTok ก่อน Shopee · ในช่องเรียง GMV มากไปน้อย)
 *   Shopee นอกเวลา Agency = In house (ส่วนที่คร่อมแพลน In house กับนอกแพลนรวมเป็นกลุ่มเดียว ไม่นับเป็นไลฟ์คร่อมกลุ่ม)
 *   ดูหลายเดือน: เดือนที่ช่องยังไม่มีแพลนไม่นับ
 */
export function splitByOwner(sessions: LiveSession[], spans: OwnerSpan[]): ChannelSplit[] {
  const planned = new Map<string, OwnerSpan[]>();
  const planMonths = new Set<string>();
  for (const x of spans) {
    planned.set(channelKey(x.channel), [...(planned.get(channelKey(x.channel)) ?? []), x]);
    planMonths.add(`${channelKey(x.channel)}|${monthOf(new Date(x.startMs).toISOString())}`);
  }
  const out = new Map<string, ChannelSplit>();
  for (const s of sessions) {
    const channel = slotPlatformOf(s.platform, s.accountId);
    if (!channel) continue;
    const plan = planMonths.has(`${channelKey(channel)}|${monthOf(s.startedAt)}`) ? planned.get(channelKey(channel)) : undefined;
    if (!plan && !s.liveOwner) continue;
    const c = out.get(channel) ?? { channel, label: platformLabel(channel), lives: 0, sec: 0, gmv: 0, rows: [], splitLives: 0, splitGmv: 0 };
    out.set(channel, c);
    c.lives++; c.sec += s.durationSec; c.gmv += s.gmv;
    const raw = s.liveOwner
      ? [{ owner: s.liveOwner === LIVE_OWNER_OURS ? null : s.liveOwner, share: 1 }]
      : ownerShares(Date.parse(s.startedAt), s.durationSec, plan!);
    // ทีมเราของ Shopee = In house (นอกแพลน / บันทึกว่าเป็นของเรา)
    const shares = new Map<string | null, number>();
    for (const x of raw) {
      const owner = !x.owner && isShopeePlatform(channel) ? "In house" : x.owner;
      shares.set(owner, (shares.get(owner) ?? 0) + x.share);
    }
    if (shares.size > 1) { c.splitLives++; c.splitGmv += s.gmv; }
    for (const [owner, share] of shares) {
      let row = c.rows.find((r) => r.owner === owner);
      if (!row) {
        row = { owner, label: ownerText(owner), lives: 0, sec: 0, gmv: 0, orders: 0 };
        c.rows.push(row);
      }
      row.lives++; row.sec += s.durationSec * share; row.gmv += s.gmv * share; row.orders += s.orders * share;
    }
  }
  for (const c of out.values()) c.rows.sort((a, b) => b.gmv - a.gmv);
  return [...out.values()].sort((a, b) => Number(isShopeePlatform(a.channel)) - Number(isShopeePlatform(b.channel)) || b.gmv - a.gmv);
}

/** กลุ่มในมุมมอง "แยก Agency" (TikTok + Shopee): key = ours (TikTok ของเรา / Shopee In house) / ชื่อ Agency (TDH, MCN, Infinite ...) */
export const AGENCY_OURS = "ours";
/** ค่าของกลุ่มหนึ่งในแต่ละช่วง (วัน / เดือน) ช่วงที่กลุ่มนี้ไม่มีไลฟ์ = null · hours รวมนาทีของไลฟ์คร่อมกลุ่มตามส่วนที่แบ่ง */
type GroupTrend = { key: string; label: string; gmv: (number | null)[]; hours: (number | null)[]; perHour: (number | null)[] };
/** กลุ่มของแพลตฟอร์มหนึ่ง (กราฟแท่งคู่: แท่ง TikTok | แท่ง Shopee ซ้อนตามกลุ่ม) */
export type AgencyTrend = GroupTrend & { platform: Platform };

const PLATFORM_ORDER: Platform[] = ["TikTok", "Shopee"];
/** ลำดับกลุ่มในแท่ง คงที่ไม่ตามยอด (แท่งซ้อนเทียบกันข้ามช่วงได้): ทีมเราล่างสุด */
const agencyRank = (key: string) => (key === AGENCY_OURS ? 0 : ["TDH", "MCN", "Infinite"].indexOf(key) + 1 || 50);
const agencyLabel = (key: string, platform: Platform | null) =>
  key === AGENCY_OURS ? (platform === "Shopee" ? "In house" : "ของเรา") : ownerText(key);

/** ผลรวมทีละช่วง -> ค่าในกราฟ (ช่วงที่ไม่มีไลฟ์ = null) */
const toTrend = (key: string, label: string, x: { gmv: number[]; sec: number[]; has: boolean[] }): GroupTrend => ({
  key, label,
  gmv: x.gmv.map((v, i) => (x.has[i] ? v : null)),
  hours: x.sec.map((v, i) => (x.has[i] ? v / 3600 : null)),
  perHour: x.sec.map((v, i) => (x.has[i] && v > 0 ? x.gmv[i] / (v / 3600) : null)),
});

/**
 * แยกยอดตาม Agency ทีละช่วง แยกแพลตฟอร์ม (กฎเดียวกับ splitByOwner) · ทุกกลุ่มของแพลตฟอร์มรวมกันต่อช่วง = ยอดจริงของแพลตฟอร์มนั้น
 *   ไม่ใช่ Agency = ทีมเรา (ผู้ใช้ยืนยัน 2026-11-09): TikTok = ของเรา (รวม Cherry / Skin Expert) · Shopee = In house (key เดียวกัน สีเดียวกัน)
 *     รวมช่อง / เดือนที่ยังไม่มีแพลนกลุ่มและไม่ได้บันทึกกลุ่ม (เช่น Shopee ก่อน พ.ย. 2026)
 */
export function agencyTrend(groups: LiveSession[][], spans: OwnerSpan[]): AgencyTrend[] {
  const sums = new Map<string, { platform: Platform; key: string; gmv: number[]; sec: number[]; has: boolean[] }>();
  const add = (platform: Platform, key: string, i: number, gmv: number, sec: number) => {
    const id = `${platform}|${key}`;
    const x = sums.get(id) ?? { platform, key, gmv: groups.map(() => 0), sec: groups.map(() => 0), has: groups.map(() => false) };
    sums.set(id, x);
    x.gmv[i] += gmv; x.sec[i] += sec; x.has[i] = true;
  };
  groups.forEach((list, i) => {
    for (const platform of PLATFORM_ORDER) {
      const mine = list.filter((s) => s.platform === platform);
      let lives = 0, gmv = 0, sec = 0;
      for (const c of splitByOwner(mine, spans)) {
        lives += c.lives; gmv += c.gmv; sec += c.sec;
        for (const r of c.rows) add(platform, !r.owner || r.owner === "In house" ? AGENCY_OURS : r.owner, i, r.gmv, r.sec);
      }
      // ไลฟ์ที่ไม่มีข้อมูลกลุ่ม = ทีมเรา
      if (mine.length > lives) add(platform, AGENCY_OURS, i, mine.reduce((a, s) => a + s.gmv, 0) - gmv, mine.reduce((a, s) => a + s.durationSec, 0) - sec);
    }
  });
  return [...sums.values()]
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || agencyRank(a.key) - agencyRank(b.key) || a.key.localeCompare(b.key))
    .map((x) => ({ platform: x.platform, ...toTrend(x.key, agencyLabel(x.key, x.platform), x) }));
}

/**
 * รวมแพลตฟอร์มเป็นกลุ่มเดียว (กราฟเส้น GMV/ชม.: เส้นละกลุ่ม) · ของเรา = TikTok ของเรา + Shopee In house · Agency เดียวกันข้ามแพลตฟอร์ม (เช่น MCN) = เส้นเดียว
 *   GMV/ชม. คิดใหม่จาก GMV รวม ÷ ชั่วโมงรวม (ไม่เฉลี่ยค่าต่อชั่วโมงของแต่ละแพลตฟอร์ม)
 */
export function mergePlatforms(trend: AgencyTrend[]): GroupTrend[] {
  const sums = new Map<string, { gmv: number[]; sec: number[]; has: boolean[] }>();
  for (const t of trend) {
    const x = sums.get(t.key) ?? { gmv: t.gmv.map(() => 0), sec: t.gmv.map(() => 0), has: t.gmv.map(() => false) };
    sums.set(t.key, x);
    t.gmv.forEach((v, i) => {
      if (v === null) return;
      x.gmv[i] += v; x.sec[i] += (t.hours[i] ?? 0) * 3600; x.has[i] = true;
    });
  }
  return [...sums].sort(([a], [b]) => agencyRank(a) - agencyRank(b) || a.localeCompare(b)).map(([key, x]) => toTrend(key, agencyLabel(key, null), x));
}
