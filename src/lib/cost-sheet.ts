// แท็บ "Sum 2" ในชีตของทีม: ค่าใช้จ่ายรายเดือนแยกกลุ่ม (Actual / Forecast) -> ตัวเลขของหน้า Cost — ฟังก์ชันล้วน (เทสได้ · src/lib/cost.ts อ่านชีต)
//   อ่านตามชื่อแถว / ชื่อเดือน ไม่ใช้ตำแหน่งช่อง ทีมเพิ่มเดือนใหม่แล้วคอลัมน์เลื่อนได้
//   ตาราง THB = เงิน · ตาราง HR = ชั่วโมง · ในแต่ละตารางแบ่งกลุ่ม Shopee / Tiktok / Admin Tiktok

export type CostSheetKind = "mc" | "admin" | "travel" | "agency";
/** ยอดของกลุ่มหนึ่งในเดือนหนึ่ง: ไม่มีค่า / 0 = null (0.00 ในช่อง Actual แปลว่ายังไม่ได้กรอก) · owner ตามแถวของหน้า Cost */
export type CostSheetEntry = {
  app: "TikTok" | "Shopee"; owner: string | null; kind: CostSheetKind;
  actual: number | null; forecast: number | null; actualHours: number | null; forecastHours: number | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const text = (v: unknown) => String(v ?? "").trim();

/** "Nov 2026" / "June 2026" -> "2026-11" · ไม่ใช่ชื่อเดือน = null */
export function sheetMonth(v: unknown) {
  const m = text(v).match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i);
  const i = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return i < 0 ? null : `${m![2]}-${String(i + 1).padStart(2, "0")}`;
}

/** ตัวเลขในช่อง: ตัวเลขจริง หรือข้อความมีลูกน้ำ · ว่าง / 0 / อ่านไม่ได้ = null */
function amount(v: unknown) {
  const n = typeof v === "number" ? v : Number(text(v).replace(/[,\s฿]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** แถวในตาราง -> กลุ่มของหน้า Cost · แถวรวม / เป้า = null · ชื่อที่ไม่รู้จักใน Shopee / Tiktok = กลุ่มภายนอกชื่อนั้น (ไม่ให้ยอดหายเงียบ) */
function lineOf(group: string, label: string): Pick<CostSheetEntry, "app" | "owner" | "kind"> | null {
  const name = label.toLowerCase().replace(/\s+/g, " ");
  if (!name || /^(total|target|plan vs target)/.test(name)) return null;
  const inHouse = name.startsWith("in-house") || name.startsWith("in house");
  if (group === "admin") {
    if (inHouse) return { app: "TikTok", owner: null, kind: "admin" };
    return label.includes("ค่าเดินทาง") ? { app: "TikTok", owner: null, kind: "travel" } : null;
  }
  if (group === "shopee") {
    if (inHouse) return { app: "Shopee", owner: "In house", kind: "mc" };
    return { app: "Shopee", owner: name.startsWith("infinit") ? "Infinite" : label, kind: "agency" };
  }
  if (group === "tiktok") {
    if (inHouse) return { app: "TikTok", owner: null, kind: "mc" };
    return { app: "TikTok", owner: name.startsWith("tuesday") ? "TDH" : label, kind: "agency" };
  }
  return null;
}

const groupOf = (label: string) => {
  const name = label.toLowerCase().replace(/\s+/g, " ");
  return name === "shopee" ? "shopee" : name === "tiktok" ? "tiktok" : name === "admin tiktok" ? "admin" : null;
};

/** แท็บทั้งแผ่น -> Map<เดือน "YYYY-MM", ยอดแต่ละกลุ่ม> · โครงผิด (ไม่มีตาราง THB) = throw */
export function parseCostSheet(rows: unknown[][]) {
  const headers = rows.flatMap((r, i) => (r.slice(1).some((c) => sheetMonth(c)) ? [i] : []));
  const start = (name: string) => headers.find((i) => text(rows[i][0]).toUpperCase() === name);
  const thb = start("THB");
  if (thb === undefined) throw new Error('ไม่พบตาราง THB ในแท็บ "Sum 2"');
  const hr = start("HR");

  /** อ่านตารางที่เริ่มแถว i: key กลุ่ม -> เดือน -> { actual, forecast } */
  const read = (i: number) => {
    const out = new Map<string, Map<string, { actual: number | null; forecast: number | null }>>();
    const end = headers.find((h) => h > i) ?? rows.length;
    const columns = rows[i].flatMap((c, col) => {
      const month = sheetMonth(c), head = text(rows[i - 1]?.[col]).toLowerCase();
      return month && (head === "actual" || head === "forecast") ? [{ col, month, field: head as "actual" | "forecast" }] : [];
    });
    let group: string | null = null;
    for (let r = i + 1; r < end; r++) {
      const label = text(rows[r][0]);
      group = groupOf(label) ?? group;
      const line = group ? lineOf(group, label) : null;
      if (!line) continue;
      const key = `${line.app}|${line.owner ?? ""}|${line.kind}`;
      const months = out.get(key) ?? new Map();
      out.set(key, months);
      for (const { col, month, field } of columns) {
        const v = amount(rows[r][col]);
        if (v === null) continue;
        const cell = months.get(month) ?? { actual: null, forecast: null };
        // แถว Fulltime กับ partime เป็นกลุ่มเดียวกัน = รวมกัน
        cell[field] = (cell[field] ?? 0) + v;
        months.set(month, cell);
      }
    }
    return out;
  };

  const money = read(thb), hours = hr === undefined ? new Map<string, Map<string, { actual: number | null; forecast: number | null }>>() : read(hr);
  const out = new Map<string, CostSheetEntry[]>();
  for (const [key, months] of money) {
    const [app, owner, kind] = key.split("|");
    for (const [month, cell] of months) {
      const h = hours.get(key)?.get(month);
      out.set(month, [...(out.get(month) ?? []), {
        app: app as CostSheetEntry["app"], owner: owner || null, kind: kind as CostSheetKind,
        actual: cell.actual, forecast: cell.forecast, actualHours: h?.actual ?? null, forecastHours: h?.forecast ?? null,
      }]);
    }
  }
  return out;
}

/** เดือนนี้ชีตมี Actual ครบส่วนที่ระบบคิดเอง (ค่าจ้าง Mc / Admin / Mc Shopee) = ไม่ต้องโหลดสรุปค่าจ้างของเดือนนั้น */
export function sheetCoversPay(entries: CostSheetEntry[] | undefined) {
  const has = (app: string, kind: CostSheetKind) => !!entries?.some((e) => e.app === app && e.kind === kind && e.actual);
  return has("TikTok", "mc") && has("TikTok", "admin") && has("Shopee", "mc");
}
