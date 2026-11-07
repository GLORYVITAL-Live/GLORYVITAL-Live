// แยกยอดไลฟ์จากไฟล์ Export ตามกลุ่มที่ไลฟ์ โดยเทียบเวลาไลฟ์กับแพลนในหน้า Plan Slot Live — ฟังก์ชันล้วน (เทสได้ ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ)
//   ดูเฉพาะช่องที่มีแพลนกลุ่มในเดือนนั้น: TikTok (เช่น GLORY VITAL) นอกเวลา Agency = ของเรา · Shopee (In house / Infinite / MCN) นอกแพลน = ไม่อยู่ในแพลน
//   ไลฟ์ที่บันทึกกลุ่มไว้แล้ว (live_sessions.live_owner) ใช้ค่านั้นทั้งไลฟ์ ไม่ดูแพลน: เดือนก่อนมีแพลนในเว็บ / ไลฟ์ที่ไม่มีเวลาเริ่มจริง
//   ไลฟ์ที่คร่อมหลายกลุ่ม = แบ่งยอดตามนาที (ประมาณ) · ซ้อนกันไม่ถึง 10 นาทีไม่นับ (คาบเกี่ยวรอยต่อ เช่น เปิดไลฟ์ก่อนเวลา 4 นาที)

import { monthOf, type LiveSession } from "@/lib/live-stats";
import { isShopeePlatform, platformLabel, slotPlatformOf } from "@/lib/platform";
import { ownerText, spanMs } from "@/lib/plan-clash";

export type OwnerSpan = { channel: string; owner: string; startMs: number; endMs: number };
/** owner null = นอกแพลนกลุ่ม (TikTok = ของเรา / Shopee = ไม่อยู่ในแพลน) */
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
 *   ไลฟ์สั้นกว่า 20 นาที: นับกลุ่มที่ซ้อนกันเกินครึ่งของไลฟ์ · ไลฟ์ 0 นาที (ยังไลฟ์อยู่ตอน Export) ดูจากเวลาเริ่ม
 */
export function ownerShares(startMs: number, sec: number, spans: OwnerSpan[]): { owner: string | null; share: number }[] {
  const len = sec * 1000;
  if (len <= 0) return [{ owner: spans.find((x) => x.startMs <= startMs && startMs < x.endMs)?.owner ?? null, share: 1 }];
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
 * แยกยอดตามกลุ่ม เฉพาะไลฟ์ที่บันทึกกลุ่มไว้ / อยู่ในเดือนที่ช่องนั้นมีแพลนกลุ่ม (TikTok ก่อน Shopee · ในช่องเรียง GMV มากไปน้อย ไม่อยู่ในแพลนไว้ท้าย)
 *   ดูหลายเดือน: เดือนที่ช่องยังไม่มีแพลนไม่นับ (ไม่ใช่ "นอกแพลน" แค่ยังไม่ได้ลงแพลน)
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
    const shares = s.liveOwner
      ? [{ owner: s.liveOwner === LIVE_OWNER_OURS ? null : s.liveOwner, share: 1 }]
      : ownerShares(Date.parse(s.startedAt), s.durationSec, plan!);
    if (shares.length > 1) { c.splitLives++; c.splitGmv += s.gmv; }
    for (const { owner, share } of shares) {
      let row = c.rows.find((r) => r.owner === owner);
      if (!row) {
        row = { owner, label: !owner && isShopeePlatform(channel) ? "ไม่อยู่ในแพลน" : ownerText(owner), lives: 0, sec: 0, gmv: 0, orders: 0 };
        c.rows.push(row);
      }
      row.lives++; row.sec += s.durationSec * share; row.gmv += s.gmv * share; row.orders += s.orders * share;
    }
  }
  const last = (c: ChannelSplit, r: OwnerRow) => !r.owner && isShopeePlatform(c.channel);
  for (const c of out.values()) c.rows.sort((a, b) => Number(last(c, a)) - Number(last(c, b)) || b.gmv - a.gmv);
  return [...out.values()].sort((a, b) => Number(isShopeePlatform(a.channel)) - Number(isShopeePlatform(b.channel)) || b.gmv - a.gmv);
}

/** ค่าของกลุ่มหนึ่งในแต่ละช่วง (วัน / เดือน) ช่วงที่กลุ่มนี้ไม่มีไลฟ์ = null · hours รวมนาทีของไลฟ์คร่อมกลุ่มตามส่วนที่แบ่ง */
export type OwnerTrend = { owner: string | null; label: string; gmv: (number | null)[]; hours: (number | null)[]; perHour: (number | null)[] };
export type ChannelTrend = { channel: string; label: string; owners: OwnerTrend[] };

/** ลำดับกลุ่มในกราฟ คงที่ไม่ตามยอด (แท่งซ้อนเทียบกันข้ามช่วงได้): ทีมเราล่างสุด · นอกแพลนบนสุด */
const ownerRank = (channel: string, owner: string | null) => {
  if (!owner) return isShopeePlatform(channel) ? 9 : 0;
  const i = ["In house", "TDH", "MCN", "Infinite"].indexOf(owner);
  return i < 0 ? 8 : i;
};

/** แยกยอดตามกลุ่มทีละช่วง (ใช้กฎเดียวกับ splitByOwner) สำหรับกราฟแท่งซ้อน GMV + กราฟเส้น GMV/ชม. */
export function ownerTrend(groups: LiveSession[][], spans: OwnerSpan[]): ChannelTrend[] {
  const out = new Map<string, ChannelTrend>();
  const blank = () => groups.map(() => null as number | null);
  groups.forEach((list, i) => {
    for (const c of splitByOwner(list, spans)) {
      const ch = out.get(c.channel) ?? { channel: c.channel, label: c.label, owners: [] };
      out.set(c.channel, ch);
      for (const r of c.rows) {
        let o = ch.owners.find((x) => x.owner === r.owner);
        if (!o) {
          o = { owner: r.owner, label: r.label, gmv: blank(), hours: blank(), perHour: blank() };
          ch.owners.push(o);
        }
        o.gmv[i] = r.gmv;
        o.hours[i] = r.sec / 3600;
        o.perHour[i] = r.sec > 0 ? r.gmv / (r.sec / 3600) : null;
      }
    }
  });
  for (const c of out.values()) c.owners.sort((a, b) => ownerRank(c.channel, a.owner) - ownerRank(c.channel, b.owner));
  return [...out.values()].sort((a, b) => Number(isShopeePlatform(a.channel)) - Number(isShopeePlatform(b.channel)) || a.label.localeCompare(b.label));
}
