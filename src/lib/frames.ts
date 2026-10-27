// เฟรมไลฟ์จากแท็บ "Frame live" ในชีตวางแผน — อ่านโครงชีต / หาเฟรมของ slot (ไม่แตะฐานข้อมูล เทสได้)
//   โครงชีต: แต่ละบล็อก = 1 ช่อง (คอลัมน์ B เช่น "GLORY MALL") แถวหัวมีช่วงวันที่คอลัมน์ C, E, G, ... (เช่น "25-31 Oct")
//   ใต้ช่วงวันในบล็อกเดียวกัน: แถวที่คอลัมน์นั้นเขียน "sticker" / "Frame Live" / "Product" ลิงก์ Google Drive อยู่คอลัมน์ถัดไป
//   ช่วงวันซ้ำ (คอลัมน์ที่คัดลอกมา เฟรมเดียวกัน) = นับครั้งเดียว

export type FrameWindow = {
  /** platform|from|to — ใช้ผูกบรีฟการแต่งตัว */
  key: string;
  /** ชื่อช่องในระบบ (ตรงกับ slot): GLORY MALL / Cherry Glory / Skin Expert / Shopee */
  platform: string;
  from: string;
  to: string;
  /** id ไฟล์ในไดรฟ์ (null = ช่องว่าง) */
  frameId: string | null;
  productId: string | null;
  stickerId: string | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (s: string) => MONTHS.indexOf(s.trim().slice(0, 3).toLowerCase());
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** ชื่อช่องในชีต → ชื่อช่องในระบบ ("GLORY Skin Expert" → "Skin Expert") */
export function framePlatform(raw: string) {
  const s = raw.trim();
  if (/mall|vital/i.test(s)) return "GLORY MALL";
  if (/cherry/i.test(s)) return "Cherry Glory";
  if (/skin/i.test(s)) return "Skin Expert";
  if (/shopee/i.test(s)) return "Shopee";
  return s;
}

/**
 * "1-3 Jul" / "1 Aug" / "25-31 Oct" / "28 Oct - 3 Nov" → { from, to } (YYYY-MM-DD) · อ่านไม่ได้ = null
 *   ปี = ปีที่ทำให้ใกล้วันนี้ที่สุด (ปีที่แล้ว / ปีนี้ / ปีหน้า) · ข้ามปี (Dec → Jan) = วันจบปีถัดไป
 */
export function parseFrameRange(text: string, today: string): { from: string; to: string } | null {
  const s = text.replace(/\s+/g, " ").trim();
  const m = s.match(/^(\d{1,2})\s*([A-Za-z]{3,})?\s*(?:[-–]\s*(\d{1,2})\s*([A-Za-z]{3,})?)?$/);
  if (!m) return null;
  const d1 = Number(m[1]), d2 = m[3] ? Number(m[3]) : d1;
  const m2 = monthOf(m[4] ?? m[2] ?? "");
  const m1 = m[2] ? monthOf(m[2]) : m2;
  if (m1 < 0 || m2 < 0 || d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;
  const t = Date.parse(`${today}T00:00:00Z`);
  const y0 = Number(today.slice(0, 4));
  const year = [y0 - 1, y0, y0 + 1].sort((a, b) => Math.abs(Date.UTC(a, m1, d1) - t) - Math.abs(Date.UTC(b, m1, d1) - t))[0];
  const from = iso(year, m1, d1);
  const to = iso(m2 < m1 ? year + 1 : year, m2, d2);
  return to < from ? null : { from, to };
}

/** id ไฟล์ / โฟลเดอร์จากลิงก์ Google Drive · ไม่ใช่ลิงก์ไดรฟ์ = null */
export function driveIdOf(raw: unknown) {
  const s = String(raw ?? "").trim();
  return s.match(/\/d\/([\w-]{10,})/)?.[1] ?? s.match(/folders\/([\w-]{10,})/)?.[1] ?? s.match(/[?&]id=([\w-]{10,})/)?.[1] ?? null;
}

/** อ่านทั้งแท็บ (แถว x คอลัมน์ เป็นข้อความ) → เฟรมทุกช่อง ทุกช่วงวัน */
export function parseFrameSheet(rows: unknown[][], today: string): FrameWindow[] {
  const cell = (i: number, j: number) => String(rows[i]?.[j] ?? "").trim();
  // แถวหัวบล็อก = คอลัมน์ B มีชื่อช่อง และมีช่วงวันอย่างน้อย 1 ช่อง
  const heads: { i: number; platform: string; cols: { j: number; from: string; to: string }[] }[] = [];
  rows.forEach((r, i) => {
    if (!cell(i, 1)) return;
    const cols = (r ?? []).flatMap((_, j) => {
      if (j < 2) return [];
      const range = parseFrameRange(cell(i, j), today);
      return range ? [{ j, ...range }] : [];
    });
    if (cols.length) heads.push({ i, platform: framePlatform(cell(i, 1)), cols });
  });
  const out = new Map<string, FrameWindow>();
  heads.forEach((h, n) => {
    const end = heads[n + 1]?.i ?? rows.length;
    for (const c of h.cols) {
      // ลิงก์อยู่คอลัมน์ถัดจากคำว่า Frame Live / Product / sticker ในบล็อกนี้
      const linkOf = (re: RegExp) => {
        for (let i = h.i + 1; i < end; i++) if (re.test(cell(i, c.j))) return driveIdOf(cell(i, c.j + 1));
        return null;
      };
      const key = `${h.platform}|${c.from}|${c.to}`;
      if (out.has(key)) continue;
      out.set(key, {
        key, platform: h.platform, from: c.from, to: c.to,
        frameId: linkOf(/frame\s*live/i), productId: linkOf(/product/i), stickerId: linkOf(/sticker/i),
      });
    }
  });
  return [...out.values()].sort((a, b) => a.from.localeCompare(b.from) || a.platform.localeCompare(b.platform));
}

/** เฟรมของ slot (ช่อง + วันไลฟ์) — หลายช่วงครอบวันเดียวกัน = ช่วงที่สั้นที่สุด (เจาะจงกว่า) · ไม่มี = null */
export function frameFor(windows: FrameWindow[], platform: string, date: string) {
  const p = framePlatform(platform);
  const span = (w: FrameWindow) => Date.parse(w.to) - Date.parse(w.from);
  return windows.filter((w) => w.platform === p && w.from <= date && date <= w.to).sort((a, b) => span(a) - span(b))[0] ?? null;
}
