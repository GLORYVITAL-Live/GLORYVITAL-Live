// เป้า GMV ของสถิติไลฟ์ + % achieve — ฟังก์ชันล้วน (เทสได้ ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ)
//   ตั้งเป้ารายเดือนต่อช่องไลฟ์ (ตาราง live_targets — SQL 20261122000000_live_targets)
//   เป้ารายวัน = เป้าเดือน เฉลี่ยทุกวัน · วันที่ใส่เอง (เช่น 11.11) ใช้ค่าที่ใส่ วันที่เหลือเฉลี่ยจากยอดที่เหลือ → รวมทุกวันเท่าเป้าเดือนเสมอ
//   ดูหลายช่อง (ทั้งหมด / TikTok) = รวมเป้า + GMV เฉพาะช่องที่ตั้งเป้า (ช่องที่ยังไม่ตั้งไม่นับ ไม่งั้น % สูงเกินจริง)
import { bkkParts, monthOf } from "@/lib/live-stats";

export type LiveTarget = { platform: string; accountId: string; month: string; monthly: number; days: Record<string, number> };
type Sale = { platform: string; accountId: string; startedAt: string; gmv: number };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** เป้าเดือนต่อช่องสูงสุดที่รับ (กันพิมพ์ 0 เกิน) */
export const TARGET_MAX = 10_000_000_000;

export const targetKey = (t: { platform: string; accountId: string }) => `${t.platform}|${t.accountId}`;

/** ทุกวันของเดือน "YYYY-MM" เป็น "YYYY-MM-DD" */
export function monthDays(month: string) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** เป้ารายวันของช่องหนึ่ง: วันที่ใส่เอง + วันที่เหลือเฉลี่ยจากยอดที่เหลือ (วันที่ใส่เองรวมเกินเป้าเดือน = วันที่เหลือเป็น 0) */
export function dailyOf(t: Pick<LiveTarget, "month" | "monthly" | "days">) {
  const days = monthDays(t.month);
  const manual = days.filter((d) => t.days[d] !== undefined);
  const used = manual.reduce((a, d) => a + t.days[d], 0);
  const rest = days.length - manual.length;
  const avg = rest ? Math.max(0, t.monthly - used) / rest : 0;
  return new Map(days.map((d) => [d, t.days[d] ?? avg]));
}

/** ทำได้กี่เท่าของเป้า (1 = 100%) · ไม่มีเป้า = null */
export const achieveOf = (actual: number, target: number) => (target > 0 ? actual / target : null);

const dayOf = (iso: string) => {
  const p = bkkParts(iso);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

/**
 * สรุปเป้าของเดือน (targets = เฉพาะช่องในตัวกรองที่ตั้งเป้าแล้ว · sales = ไลฟ์ในตัวกรอง)
 *   lastDay = วันล่าสุดที่มีข้อมูลของเดือนที่ยังไม่จบ (0 = ไม่ตัด) ใช้คิดเป้าถึงวันนั้น + ยอดที่เหลือต่อวัน
 */
export function targetReport(targets: LiveTarget[], sales: Sale[], month: string, lastDay = 0) {
  const keys = new Set(targets.map(targetKey));
  const counted = sales.filter((s) => keys.has(targetKey(s)) && monthOf(s.startedAt) === month);
  const dates = monthDays(month);
  const dailies = targets.map((t) => ({ t, daily: dailyOf(t) }));
  // ป้าย "ใส่เอง" = วันพิเศษของช่องที่เฉลี่ยวันอื่น · ช่องที่มีเป้าครบทุกวัน ไม่มีวันไหนเป็นวันพิเศษ
  const special = targets.filter((t) => dates.some((d) => t.days[d] === undefined));
  const days = dates.map((date) => {
    const target = dailies.reduce((a, x) => a + (x.daily.get(date) ?? 0), 0);
    const gmv = counted.filter((s) => dayOf(s.startedAt) === date).reduce((a, s) => a + s.gmv, 0);
    return { date, target, gmv, pct: achieveOf(gmv, target), manual: special.some((t) => t.days[date] !== undefined) };
  });
  const upTo = (date: string) => lastDay > 0 && Number(date.slice(8)) > lastDay;
  const monthly = targets.reduce((a, t) => a + t.monthly, 0);
  const gmv = counted.reduce((a, s) => a + s.gmv, 0);
  const toDateTarget = lastDay ? days.filter((d) => !upTo(d.date)).reduce((a, d) => a + d.target, 0) : null;
  const daysLeft = lastDay ? Math.max(0, dates.length - lastDay) : 0;
  const remaining = Math.max(0, monthly - gmv);
  /**
   * คาดการณ์สิ้นเดือน (เดือนที่ยังไม่จบ · ผู้ใช้ขอ 2026-11-10)
   *   value = ยอดถึงวันนี้ + เป้าของวันที่เหลือ × อัตราที่ทำได้ถึงวันนี้ (เป้ารายวันมีวันแคมเปญหนักกว่า = คาดการณ์นับวันแคมเปญที่ยังไม่ถึงให้แล้ว)
   *   runRate = เฉลี่ยต่อวันที่ผ่านมา × จำนวนวันทั้งเดือน (ไม่สนว่าวันไหนเป็นวันแคมเปญ)
   */
  const restTarget = lastDay ? days.filter((d) => upTo(d.date)).reduce((a, d) => a + d.target, 0) : 0;
  const pace = toDateTarget ? gmv / toDateTarget : null;
  const projected = lastDay && daysLeft ? (pace !== null ? gmv + restTarget * pace : (gmv / lastDay) * dates.length) : null;
  return {
    monthly, gmv, pct: achieveOf(gmv, monthly),
    toDate: toDateTarget === null ? null : { target: toDateTarget, pct: achieveOf(gmv, toDateTarget), gap: gmv - toDateTarget },
    remaining, daysLeft, perDayLeft: daysLeft ? remaining / daysLeft : null,
    projection: projected === null ? null : {
      value: projected, pct: achieveOf(projected, monthly), gap: projected - monthly,
      runRate: (gmv / lastDay) * dates.length,
    },
    days,
    accounts: dailies.map(({ t, daily }) => {
      const key = targetKey(t);
      const own = counted.filter((s) => targetKey(s) === key).reduce((a, s) => a + s.gmv, 0);
      const toDate = lastDay ? dates.filter((d) => !upTo(d)).reduce((a, d) => a + (daily.get(d) ?? 0), 0) : null;
      return { key, monthly: t.monthly, gmv: own, pct: achieveOf(own, t.monthly), toDatePct: toDate === null ? null : achieveOf(own, toDate) };
    }),
  };
}

/** ช่องในตัวกรองที่ตั้งเป้าแล้ว (platform / account แบบเดียวกับ filterSessions) */
export const targetsInScope = (targets: LiveTarget[], platform: string, account: string) =>
  targets.filter((t) => (!platform || t.platform === platform) && (!account || targetKey(t) === account));

/** ปรับเป้ารายวันตามสัดส่วนให้รวมเท่า total พอดี (ปัดเป็นบาทแบบสะสม) · ทุกวันเป็น 0 = เฉลี่ยเท่ากัน */
export function scaleDays(days: Record<string, number>, total: number) {
  const dates = Object.keys(days).sort();
  const base = dates.reduce((a, d) => a + days[d], 0);
  const out: Record<string, number> = {};
  let run = 0, given = 0;
  for (const d of dates) {
    run += base ? days[d] : 1;
    const upTo = Math.round((run / (base || dates.length)) * total);
    out[d] = upTo - given;
    given = upTo;
  }
  return out;
}

const money = (v: unknown) => Number(String(v ?? "").replace(/[,\s฿]/g, ""));

/**
 * ตรวจข้อมูลจากฟอร์ม (ทั้งหน้าเว็บ + เซิร์ฟเวอร์)
 *   monthly ว่าง / 0 + ไม่มีวันที่ใส่เอง = ลบเป้าของช่องนี้ (คืน monthly 0)
 *   คืน error เป็นข้อความเมื่อใช้ไม่ได้
 */
export function cleanTarget(month: unknown, name: string, monthlyRaw: unknown, daysRaw: unknown): { error: string } | { month: string; monthly: number; days: Record<string, number> } {
  if (typeof month !== "string" || !MONTH_RE.test(month)) return { error: "เดือนไม่ถูกต้อง" };
  const monthly = String(monthlyRaw ?? "").trim() === "" ? 0 : money(monthlyRaw);
  if (!Number.isFinite(monthly) || monthly < 0) return { error: `${name}: เป้าเดือนต้องเป็นตัวเลข` };
  if (monthly > TARGET_MAX) return { error: `${name}: เป้าเดือนสูงผิดปกติ ตรวจตัวเลขอีกครั้ง` };
  const valid = new Set(monthDays(month));
  const days: Record<string, number> = {};
  for (const [d, raw] of Object.entries((daysRaw ?? {}) as Record<string, unknown>)) {
    if (!valid.has(d)) return { error: `${name}: วันที่ ${d} ไม่อยู่ในเดือนนี้` };
    const v = money(raw);
    if (!Number.isFinite(v) || v < 0) return { error: `${name}: เป้าวันที่ ${Number(d.slice(8))} ต้องเป็นตัวเลข` };
    days[d] = v;
  }
  const used = Object.values(days).reduce((a, v) => a + v, 0);
  if (!monthly && Object.keys(days).length) return { error: `${name}: ใส่เป้าเดือนก่อน ถึงจะใส่เป้ารายวันได้` };
  if (Object.keys(days).length === valid.size && Math.abs(used - monthly) > 0.01) return { error: `${name}: ใส่เป้าครบทุกวันแล้ว ยอดรวมรายวันต้องเท่าเป้าเดือน` };
  if (used > monthly) return { error: `${name}: เป้ารายวันที่ใส่เองรวมกันเกินเป้าเดือน` };
  return { month, monthly, days };
}
