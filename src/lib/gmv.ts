// ยอด GMV ต่อ slot (ใช้ทั้งฝั่ง browser และ server)
//
// แดชบอร์ด TikTok LIVE แสดงยอดสะสมของทั้งไลฟ์ ถ้าไลฟ์ยาวต่อกันหลาย slot (คนละ Mc)
// ยอดของ slot = ยอดสะสมตอนจบ slot นี้ − ยอดสะสมของ slot ก่อนหน้าทั้งหมดที่ต่อกันมา
//   เช่น 07:30–09:30 กรอก 60,540 / 09:30–11:30 กรอก 123,506 (หัก 60,540 = 62,966)
//        11:30–13:30 กรอก 205,564 (หัก 60,540 + 62,966 = 123,506 → 82,058)
// "ต่อกัน" = แพลตฟอร์มเดียวกัน และเวลาจบของ slot ก่อนหน้า = เวลาเริ่มของ slot นี้

/** ยอดต่อ slot เกินนี้ = น่าจะพิมพ์ผิด (เตือน ไม่บล็อก) */
export const GMV_SUSPICIOUS = 5_000_000;

/**
 * อ่านตัวเลขที่พิมพ์ บวก/ลบกันได้ เช่น "123,506 - 60540" → 62966 · "20,245 บาท" → 20245 / ว่าง = value null
 *   "60.540" (จุดตามด้วย 3 หลักพอดี) กำกวมว่าเป็นจุดคั่นหลักพันหรือทศนิยม = ไม่เดา ให้พิมพ์ใหม่
 */
export function parseGmv(text: string): { value: number | null; error?: string } {
  const s = text.replace(/บาท|฿|thb/gi, "").replace(/[,\s]/g, "").replace(/[−–—]/g, "-");
  if (!s) return { value: null };
  if (/\d\.\d{3}(?!\d)/.test(s)) {
    return { value: null, error: "ตัวเลขกำกวม: จุดตามด้วย 3 หลัก (เช่น 60.540) ไม่แน่ใจว่าเป็นหลักพันหรือทศนิยม — พิมพ์ใหม่แบบไม่มีจุด เช่น 60540 หรือใช้จุลภาค 60,540" };
  }
  if (!/^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)*$/.test(s)) return { value: null, error: "อ่านตัวเลขไม่ได้ ใส่ได้เฉพาะตัวเลขกับ + −" };
  const total = (s.match(/[+-]?\d+(\.\d+)?/g) ?? []).reduce((a, t) => a + Number(t), 0);
  return { value: Math.round(total * 100) / 100 };
}

/** อ่านตัวเลขที่พิมพ์ (ดู parseGmv) ว่าง = null / อ่านไม่ได้หรือกำกวม = NaN */
export function evalGmv(text: string): number | null {
  const r = parseGmv(text);
  return r.error ? NaN : r.value;
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
  /** เวลาเริ่มของยอดที่ slot นี้กรอกไว้: ย้อนผ่าน slot ว่างของคนเดียวกันที่ไลฟ์ต่อกันมา (ยอดรวมช่วงนั้นไว้แล้ว) */
  const coveredFrom = (s: GmvSlot) => {
    let cur = s;
    for (let i = 0; i < 24; i++) {
      const p = byEnd.get(`${cur.platform}|${cur.startMs}`);
      if (!p || p.gmv !== null || !sameWho(p, s)) break;
      cur = p;
    }
    return cur.startMs;
  };
  const before = (s: GmvSlot, depth: number): GmvBefore | null => {
    if (memo.has(s.id)) return memo.get(s.id)!;
    const prev = byEnd.get(`${s.platform}|${s.startMs}`);
    let out: GmvBefore | null = null;
    if (prev && depth < 24) {
      if (prev.gmv !== null) {
        const chain = before(prev, depth + 1);
        out = chain
          ? { amount: chain.amount + prev.gmv, fromMs: chain.fromMs, toMs: prev.endMs, slots: chain.slots + 1 }
          : { amount: prev.gmv, fromMs: coveredFrom(prev), toMs: prev.endMs, slots: 1 };
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
): { id: number; gmv: number | null; input: string; minus: number | null; error?: string; warning?: string }[] {
  const ids = new Set(items.map((x) => x.slot.id));
  const pool = others.filter((s) => !ids.has(s.id));
  const out: ReturnType<typeof computeGmv> = [];
  for (const it of [...items].sort((a, b) => a.slot.startMs - b.slot.startMs)) {
    const { value, error } = parseGmv(it.input);
    if (error) {
      out.push({ id: it.slot.id, gmv: null, input: it.input, minus: null, error });
      continue;
    }
    if (value === null) {
      out.push({ id: it.slot.id, gmv: null, input: "", minus: null });
      pool.push({ ...it.slot, gmv: null });
      continue;
    }
    const prior = gmvBeforeMap([...pool, { ...it.slot, gmv: null }]).get(it.slot.id) ?? null;
    const b = it.auto ? prior : null;
    const gmv = Math.round((value - (b?.amount ?? 0)) * 100) / 100;
    const warnings = [
      // ไม่ได้หักยอด แต่ตัวเลขมากกว่ายอดสะสมก่อนหน้า = น่าจะเป็นยอดสะสมจากแดชบอร์ด (จะนับซ้ำกับ slot ก่อนหน้า)
      !it.auto && prior && value > prior.amount
        ? `ไม่ได้หักยอดสะสมก่อนหน้า (${fmtGmv(prior.amount)}) แต่ตัวเลขนี้มากกว่า — ถ้าเป็นยอดสะสมจากแดชบอร์ด ให้ติ๊กหักยอด ไม่งั้นยอดจะนับซ้ำกับ slot ก่อนหน้า` : "",
      gmv > GMV_SUSPICIOUS ? `ยอด ${fmtGmv(gmv)} สูงผิดปกติ ตรวจตัวเลขอีกครั้ง (ใส่เกินมาสักหลักหรือเปล่า)` : "",
    ].filter(Boolean);
    out.push({
      // ติ๊กหักยอดแต่ยังไม่มียอดก่อนหน้า = เก็บ minus 0 (ไม่ใช่ null) ไว้บอกว่า slot นี้หักยอดอัตโนมัติ
      //   slot ก่อนหน้ากรอกทีหลัง -> downstreamGmv คิดใหม่ให้ (เดิมเก็บ null = ถูกข้าม ยอดนับซ้ำ)
      id: it.slot.id, gmv, input: it.input.trim(), minus: it.auto ? (b?.amount ?? 0) : null,
      // ติดลบหลังหักยอด = ยอดสะสมก่อนหน้าสูงเกินจริง (มักเป็น slot ก่อนหน้ากรอกยอดสะสมไว้โดยไม่ได้หัก) — ให้แก้ slot นั้น ไม่ใช่เอาติ๊กออก
      ...(gmv < 0 ? {
        error: b && b.amount > 0
          ? `ยอดติดลบ: ยอดสะสมของ slot ก่อนหน้า (${fmtGmv(b.amount)}) มากกว่าตัวเลขที่กรอก — slot ก่อนหน้าน่าจะกรอกยอดสะสมไว้โดยไม่ได้หัก ให้แก้ slot นั้นก่อน (เอาติ๊กหักยอดออกเฉพาะเมื่อเริ่มไลฟ์ใหม่)`
          : "ยอด GMV ติดลบไม่ได้",
      } : {}),
      ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
    });
    pool.push({ ...it.slot, gmv });
  }
  return out;
}

/** slot ที่บันทึกยอดไว้แล้ว: input = ตัวเลขที่พิมพ์ / minus = ยอดสะสมที่หักไว้ (null = ไม่ได้หัก) */
export type StoredGmv = GmvSlot & { input: string | null; minus: number | null };

/**
 * ยอดของ slot ก่อนหน้าเปลี่ยน (แก้ / กรอกใหม่) -> slot ถัดไปในสายไลฟ์เดียวกันที่เคยหักยอดอัตโนมัติ (minus มีค่า)
 *   คิดใหม่จากตัวเลขที่พิมพ์ไว้ ไม่งั้นยอดที่หักจะค้างเป็นของเก่า
 *   เดินต่อตามสาย (ช่องเดียวกัน เวลาต่อกัน) · slot ที่กรอกเองโดยไม่หัก = ไม่แตะ · อ่านตัวเลขเดิมไม่ได้ = คงค่าเดิม
 *   ติดลบหลังหัก = คงค่าเดิม แต่คืนใน negative ให้แจ้งผู้ใช้ไปแก้ (ไม่งั้นยอดค้างของเก่าโดยไม่มีใครรู้)
 */
export function downstreamGmv(changedIds: number[], all: StoredGmv[]): {
  changes: { id: number; gmv: number; minus: number }[];
  negative: { id: number; gmv: number; minus: number }[];
} {
  const cur = new Map(all.map((s) => [s.id, { ...s }]));
  const byStart = new Map<string, StoredGmv>();
  for (const s of cur.values()) byStart.set(`${s.platform}|${s.startMs}`, s);
  const out = new Map<number, { id: number; gmv: number; minus: number }>();
  const negative = new Map<number, { id: number; gmv: number; minus: number }>();
  const starts = changedIds.map((id) => cur.get(id)).filter((s): s is StoredGmv => !!s).sort((a, b) => a.startMs - b.startMs);
  for (const first of starts) {
    let s = first;
    for (let i = 0; i < 24; i++) {
      const n = byStart.get(`${s.platform}|${s.endMs}`);
      if (!n) break;
      if (n.minus !== null && n.input) {
        const [r] = computeGmv([{ slot: { ...n, gmv: null }, input: n.input, auto: true }], [...cur.values()].filter((x) => x.id !== n.id));
        if (r && r.minus !== null && r.gmv !== null && r.gmv < 0) {
          negative.set(n.id, { id: n.id, gmv: r.gmv, minus: r.minus });
        } else if (r && r.minus !== null && r.gmv !== null && (r.gmv !== n.gmv || r.minus !== n.minus)) {
          negative.delete(n.id);
          n.gmv = r.gmv;
          n.minus = r.minus;
          out.set(n.id, { id: n.id, gmv: r.gmv, minus: r.minus });
        }
      }
      s = n;
    }
  }
  return { changes: [...out.values()], negative: [...negative.values()] };
}
