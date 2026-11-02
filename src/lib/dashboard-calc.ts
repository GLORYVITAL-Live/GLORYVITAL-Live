import { payOfItems, type PayData } from "@/lib/owner-pay";
import type { DashboardData, OwnerDetail } from "@/lib/types";

/**
 * คิดแดชบอร์ดหน้าแรกจากสรุปรายเดือน 2 เดือน (เดือนนี้ + เดือนก่อน) — แยกจากการโหลดข้อมูลเพื่อเทสได้ (src/lib/dashboard.ts โหลด)
 *   "ไลฟ์แล้ว" = คิวที่ถึงเวลาเริ่มแล้ว (startMs <= ตอนนี้) · เดือนก่อนตัดที่วันที่และเวลาเดียวกัน
 */

type Summary = PayData & { details: OwnerDetail[] };
type GmvSession = { startedAt: string; gmv: number; platform: string };

const DAY = 86400_000, BKK = 7 * 3600_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const bkkDate = (ms: number) => new Date(ms + BKK).toISOString().slice(0, 10);
const dayStart = (date: string) => Date.parse(`${date}T00:00:00+07:00`);

/** เวลาเดียวกันของเดือนก่อน (เดือนก่อนสั้นกว่า = สิ้นเดือนนั้น) → [เวลาตัด, วันที่] */
function sameTimePrevMonth(ms: number, prevLast: string): [number, string] {
  const date = bkkDate(ms), lastDay = Number(prevLast.slice(8));
  if (Number(date.slice(8)) > lastDay) return [dayStart(prevLast) + DAY, prevLast];
  const prevDate = `${prevLast.slice(0, 8)}${date.slice(8)}`;
  return [dayStart(prevDate) + (ms - dayStart(date)), prevDate];
}

const sum = (items: OwnerDetail[]) => r2(items.reduce((a, d) => a + d.hours, 0));

export function buildDashboard({ cur, prev, month, prevMonth, last, prevLast, now, payMc, payAdmin, sessions }: {
  cur: Summary; prev: Summary; month: string; prevMonth: string; last: string; prevLast: string; now: number;
  payMc: boolean; payAdmin: boolean;
  /** GMV จากไฟล์ Export ของเดือนนี้ / เดือนก่อน · null = ไม่มีสิทธิ์ดู */
  sessions: { cur: GmvSession[]; prev: GmvSession[] } | null;
}): DashboardData {
  const today = bkkDate(now);
  const [prevCut, prevUpTo] = sameTimePrevMonth(now, prevLast);
  const live = (s: Summary, type: "Mc" | "Admin", cut: number) => s.details.filter((d) => d.type === type && !d.cancelled && d.startMs <= cut);
  const mcNow = live(cur, "Mc", now), mcPrev = live(prev, "Mc", prevCut);

  const sides = [...(payMc ? ["mc" as const] : []), ...(payAdmin ? ["admin" as const] : [])];
  const payOf = (s: Summary, cut: number) =>
    (payMc ? payOfItems(s, "Mc", live(s, "Mc", cut)) : 0) + (payAdmin ? payOfItems(s, "Admin", live(s, "Admin", cut)) : 0);

  // GMV: เดือนนี้ถึงไลฟ์ล่าสุดในไฟล์ · เดือนก่อนถึงวันที่และเวลาเดียวกัน (ไฟล์ยังไม่ครบเดือน = เทียบเท่าที่มี)
  let gmv: DashboardData["gmv"] = null;
  if (sessions) {
    const latest = Math.max(...sessions.cur.map((s) => Date.parse(s.startedAt)));
    if (!sessions.cur.length) gmv = { cur: null, prev: null, upTo: null, time: null };
    else {
      const [cut] = sameTimePrevMonth(latest, prevLast);
      const prevIn = sessions.prev.filter((s) => Date.parse(s.startedAt) <= cut);
      gmv = {
        cur: sessions.cur.reduce((a, s) => a + s.gmv, 0),
        prev: prevIn.length ? prevIn.reduce((a, s) => a + s.gmv, 0) : null,
        upTo: bkkDate(latest), time: new Date(latest + BKK).toISOString().slice(11, 16),
      };
    }
  }

  // ชั่วโมงรายวันทั้งเดือน (รวมคิวที่จองไว้ข้างหน้า) เทียบวันที่เดียวกันของเดือนก่อน
  const hoursByDate = (s: Summary) => {
    const m = new Map<string, number>();
    for (const d of s.details) if (d.type === "Mc" && !d.cancelled) m.set(d.date, (m.get(d.date) ?? 0) + d.hours);
    return m;
  };
  const curDays = hoursByDate(cur), prevDays = hoursByDate(prev), prevLen = Number(prevLast.slice(8));
  const daily = Array.from({ length: Number(last.slice(8)) }, (_, i) => {
    const date = `${month}-${pad(i + 1)}`;
    return {
      date, hours: r2(curDays.get(date) ?? 0), planned: date > today,
      prev: i + 1 <= prevLen ? r2(prevDays.get(`${prevMonth}-${pad(i + 1)}`) ?? 0) : null,
    };
  });

  const platforms = (["tiktok", "shopee"] as const).map((key) => {
    const items = mcNow.filter((d) => !!d.shopee === (key === "shopee"));
    const lives = sessions?.cur.length ? sessions.cur.filter((s) => s.platform.toLowerCase() === key) : null;
    return {
      key, slots: items.length, hours: sum(items), mc: new Set(items.map((d) => d.name)).size,
      pay: payMc ? payOfItems(cur, "Mc", items) : null,
      gmv: lives ? lives.reduce((a, s) => a + s.gmv, 0) : null,
    };
  });

  // Mc ที่ไลฟ์มากที่สุด: ชั่วโมง → จำนวนคิว → ชื่อ · หลักฐานนับเฉพาะคิวที่ต้องแนบ (ไม่ใช่ Mc ประจำ / คิว Shopee)
  const people = new Map<string, OwnerDetail[]>();
  for (const d of mcNow) people.set(d.name, [...(people.get(d.name) ?? []), d]);
  const topMc = [...people].map(([name, items]) => {
    const withGmv = items.filter((d) => d.gmv !== null), need = items.filter((d) => !d.noProof);
    return {
      name, slots: items.length, hours: sum(items),
      gmv: withGmv.length ? withGmv.reduce((a, d) => a + (d.gmv ?? 0), 0) : null,
      proofDone: need.filter((d) => d.proof).length, proofNeed: need.length,
    };
  }).sort((a, b) => b.hours - a.hours || b.slots - a.slots || a.name.localeCompare(b.name, "th")).slice(0, 5);

  return {
    month, prevMonth, upTo: today, prevUpTo,
    hours: { cur: sum(mcNow), prev: sum(mcPrev) },
    slots: { cur: mcNow.length, prev: mcPrev.length },
    pay: sides.length ? { cur: payOf(cur, now), prev: payOf(prev, prevCut), sides } : null,
    gmv, daily, platforms, topMc,
    mcCount: people.size,
  };
}
