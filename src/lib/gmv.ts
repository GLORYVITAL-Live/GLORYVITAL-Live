// ยอด GMV ต่อ slot (ใช้ทั้งฝั่ง browser และ server)
//
// แดชบอร์ด TikTok LIVE แสดงยอดสะสมของทั้งไลฟ์ ถ้าไลฟ์ยาวต่อกันหลาย slot (คนละ Mc)
// ยอดของ slot = ยอดสะสมตอนจบ slot นี้ − ยอดสะสมของ slot ก่อนหน้าทั้งหมดที่ต่อกันมา
//   เช่น 07:30–09:30 กรอก 60,540 / 09:30–11:30 กรอก 123,506 (หัก 60,540 = 62,966)
//        11:30–13:30 กรอก 205,564 (หัก 60,540 + 62,966 = 123,506 → 82,058)
// "ต่อกัน" = แพลตฟอร์มเดียวกัน และเวลาจบของ slot ก่อนหน้า = เวลาเริ่มของ slot นี้

/** อ่านตัวเลขที่พิมพ์ บวก/ลบกันได้ เช่น "123,506 - 60540" → 62966 / ว่าง = null / อ่านไม่ได้ = NaN */
export function evalGmv(text: string): number | null {
  const s = text.replace(/[,\s฿]/g, "").replace(/[−–—]/g, "-");
  if (!s) return null;
  if (!/^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)*$/.test(s)) return NaN;
  const total = (s.match(/[+-]?\d+(\.\d+)?/g) ?? []).reduce((a, t) => a + Number(t), 0);
  return Math.round(total * 100) / 100;
}

export const fmtGmv = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

/** who = คนที่ไลฟ์ slot นี้ (Mc) ใช้รู้ว่าไลฟ์ต่อกันโดยไม่สลับคน */
export type GmvSlot = { id: number; platform: string; startMs: number; endMs: number; gmv: number | null; who?: string | number | null };
/** ยอดสะสมของ slot ก่อนหน้าที่ต่อกันมา (amount) ช่วงเวลา fromMs–toMs และจำนวน slot */
export type GmvBefore = { amount: number; fromMs: number; toMs: number; slots: number };

const sameWho = (a: GmvSlot, b: GmvSlot) => a.who != null && a.who === b.who;

/**
 * ยอดสะสมก่อน slot นี้ของทุก slot (ไม่มี slot ก่อนหน้าที่ต่อกัน หรือ slot ก่อนหน้ายังไม่มี GMV = ไม่มีในผลลัพธ์)
 *   Mc คนเดียวไลฟ์ต่อกันหลาย slot แล้วกรอก GMV แค่ slot สุดท้าย: slot ก่อนหน้าที่ว่าง (คนเดียวกัน) ข้ามไป
 *   ไปหายอดของคนก่อนหน้าแทน เพราะยอดที่กรอกรวมช่วงนั้นไว้แล้ว
 */
export function gmvBeforeMap(slots: GmvSlot[]): Map<number, GmvBefore> {
  const byEnd = new Map<string, GmvSlot>();
  for (const s of slots) byEnd.set(`${s.platform}|${s.endMs}`, s);
  const memo = new Map<number, GmvBefore | null>();
  const before = (s: GmvSlot, depth: number): GmvBefore | null => {
    if (memo.has(s.id)) return memo.get(s.id)!;
    const prev = byEnd.get(`${s.platform}|${s.startMs}`);
    let out: GmvBefore | null = null;
    if (prev && depth < 24) {
      if (prev.gmv !== null) {
        const chain = before(prev, depth + 1);
        out = chain
          ? { amount: chain.amount + prev.gmv, fromMs: chain.fromMs, toMs: prev.endMs, slots: chain.slots + 1 }
          : { amount: prev.gmv, fromMs: prev.startMs, toMs: prev.endMs, slots: 1 };
      } else if (sameWho(prev, s)) {
        out = before(prev, depth + 1); // slot ว่างของคนเดียวกัน = ยอดรวมอยู่ใน slot นี้ ดูต่อไปข้างหน้า
      }
    }
    memo.set(s.id, out);
    return out;
  };
  const map = new Map<number, GmvBefore>();
  for (const s of slots) {
    const b = before(s, 0);
    if (b) map.set(s.id, b);
  }
  return map;
}

/**
 * slot ที่ยังไม่มี GMV แต่ยอดรวมอยู่ใน slot ถัดไปของ Mc คนเดียวกัน (ไลฟ์ต่อกันโดยไม่สลับคน)
 *   เช่น Mc เมจิ 19:30–21:30 + 21:30–23:30 กรอก GMV แค่ 21:30–23:30 -> 19:30–21:30 ถือว่ากรอกแล้ว
 *   คืน Map<id ของ slot ที่ว่าง, slot ที่มียอด>
 */
export function gmvCoverage(slots: GmvSlot[]): Map<number, GmvSlot> {
  const byStart = new Map<string, GmvSlot>();
  for (const s of slots) byStart.set(`${s.platform}|${s.startMs}`, s);
  const out = new Map<number, GmvSlot>();
  for (const s of slots) {
    if (s.gmv !== null || s.who == null) continue;
    let cur = s;
    for (let i = 0; i < 24; i++) {
      const next = byStart.get(`${cur.platform}|${cur.endMs}`);
      if (!next || !sameWho(next, s)) break;
      if (next.gmv !== null) { out.set(s.id, next); break; }
      cur = next;
    }
  }
  return out;
}

/**
 * คิด GMV ของหลาย slot ที่กรอกพร้อมกัน (เรียงตามเวลา) — slot ถัดไปในชุดเดียวกันหักยอดของ slot ก่อนหน้าในชุดได้ด้วย
 *   items: input = ที่พิมพ์ / auto = หักยอดสะสมของ slot ก่อนหน้าให้อัตโนมัติ
 *   others: slot อื่นๆ ที่มี GMV อยู่แล้ว (ใช้หายอดสะสมก่อนหน้า)
 */
export function computeGmv(
  items: { slot: GmvSlot; input: string; auto: boolean }[],
  others: GmvSlot[],
): { id: number; gmv: number | null; input: string; minus: number | null; error?: string }[] {
  const ids = new Set(items.map((x) => x.slot.id));
  const pool = others.filter((s) => !ids.has(s.id));
  const out: ReturnType<typeof computeGmv> = [];
  for (const it of [...items].sort((a, b) => a.slot.startMs - b.slot.startMs)) {
    const value = evalGmv(it.input);
    if (value === null) {
      out.push({ id: it.slot.id, gmv: null, input: "", minus: null });
      pool.push({ ...it.slot, gmv: null });
      continue;
    }
    if (Number.isNaN(value)) {
      out.push({ id: it.slot.id, gmv: null, input: it.input, minus: null, error: "อ่านตัวเลขไม่ได้ ใส่ได้เฉพาะตัวเลขกับ + −" });
      continue;
    }
    const b = it.auto ? gmvBeforeMap([...pool, { ...it.slot, gmv: null }]).get(it.slot.id) ?? null : null;
    const gmv = Math.round((value - (b?.amount ?? 0)) * 100) / 100;
    out.push({
      id: it.slot.id, gmv, input: it.input.trim(), minus: b ? b.amount : null,
      ...(gmv < 0 ? { error: "ยอดติดลบ ตรวจตัวเลข หรือเอาติ๊ก \"หักยอด slot ก่อนหน้า\" ออก" } : {}),
    });
    pool.push({ ...it.slot, gmv });
  }
  return out;
}
