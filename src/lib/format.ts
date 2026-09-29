// วันที่ภาษาไทย (ปี ค.ศ. ให้ตรงกับตารางเดิม) ใช้ได้ทั้งฝั่ง server และ browser

const opts = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "UTC", ...o });

export const fmtDayLong = opts({ weekday: "long", day: "numeric", month: "long" });
export const fmtDayShort = opts({ weekday: "short", day: "numeric", month: "short" });
export const fmtWeekShort = opts({ weekday: "short" });
export const fmtMonthShort = opts({ month: "short" });
export const fmtMonthLong = opts({ month: "long", year: "numeric" });
export const fmtDayMonth = opts({ day: "numeric", month: "short" });

/** "YYYY-MM-DD" -> Date (เที่ยงวัน UTC กันวันเลื่อน) */
export const parseKey = (k: string) => new Date(`${k}T12:00:00Z`);

/** วันนี้ตามเวลาไทย "YYYY-MM-DD" */
export function todayKey(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
}

export function relLabel(k: string) {
  if (k === todayKey()) return "วันนี้";
  if (k === todayKey(1)) return "พรุ่งนี้";
  return "";
}

/** เดือนปัจจุบัน "YYYY-MM" (เวลาไทย) เลื่อนได้ทีละเดือน */
export function monthKey(offset = 0, base?: string) {
  const [y, m] = (base ?? todayKey().slice(0, 7)).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}
export const monthLabel = (key: string) => fmtMonthLong.format(new Date(`${key}-01T12:00:00Z`));

export const hoursOf = (s: { startMs: number; endMs: number }) => (s.endMs - s.startMs) / 3600_000;
export const fmtHours = (h: number) => (Number.isInteger(h) ? h : h.toFixed(1)) + " ชม.";
export const num = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, ""));
export const money = (n: number) => Math.round(n).toLocaleString("th-TH");
export const platformOf = (s: { platform?: string }) => s.platform || "Live";
