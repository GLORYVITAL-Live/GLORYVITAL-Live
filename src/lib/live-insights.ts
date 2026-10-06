// วิเคราะห์ผลการเทียบ 2 ช่วง: GMV เปลี่ยนเพราะอะไร / ดรอปที่ขั้นไหน / อะไรทำได้ดี / ควรทำอะไรต่อ
//   ใช้กฎจากตัวเลขจริงทั้งหมด (ผลเหมือนเดิมทุกครั้ง) ไม่เรียก AI ภายนอก
//   ใช้ในสไลด์นำเสนอ (live-slides.ts) และนำไปแสดงบนเว็บต่อได้

import { accountsOf, bkkParts, changeOf, fmtMetric, totalsOf, type LiveSession, type Platform } from "@/lib/live-stats";

/** เปลี่ยนเกินเท่านี้ถึงนับว่า "เพิ่ม" / "ลด" จริง */
const MEANINGFUL = 0.05;

export type FunnelStep = { label: string; a: number | null; b: number | null; kind: "baht" | "int" | "pct" };
export type Funnel = { platform: Platform; steps: FunnelStep[] };
export type Analysis = {
  /** GMV ที่เปลี่ยน แยกเป็น ผลจากชั่วโมงไลฟ์ + ผลจากยอดต่อชั่วโมง (รวมกัน = delta) */
  drivers: { delta: number; hoursEffect: number; rateEffect: number } | null;
  funnels: Funnel[];
  drops: string[];
  wins: string[];
  suggestions: string[];
};

const baht = (v: number) => fmtMetric("baht", v);
const pctAbs = (c: number) => `${Math.abs(c * 100).toFixed(1)}%`;
const rateText = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(2)}%`);
const ratio = (a: number, b: number) => (b ? a / b : null);
const keyOf = (s: LiveSession) => `${s.platform}|${s.accountId}`;

/** กรวยการขายของแพลตฟอร์มเดียว */
function funnelOf(platform: Platform, a: LiveSession[], b: LiveSession[]): Funnel {
  const ta = totalsOf(a), tb = totalsOf(b);
  const aov = (t: typeof ta) => ratio(t.gmv, t.orders);
  const steps: FunnelStep[] = platform === "TikTok"
    ? [
      { label: "Product Impressions", a: ta.impressions, b: tb.impressions, kind: "int" },
      { label: "Product Clicks", a: ta.clicks, b: tb.clicks, kind: "int" },
      { label: "CTR (คลิก ÷ Impressions)", a: ratio(ta.clicks ?? 0, ta.impressions ?? 0), b: ratio(tb.clicks ?? 0, tb.impressions ?? 0), kind: "pct" },
      { label: "ออเดอร์", a: ta.orders, b: tb.orders, kind: "int" },
      { label: "CO (ออเดอร์ ÷ คลิก)", a: ratio(ta.orders, ta.clicks ?? 0), b: ratio(tb.orders, tb.clicks ?? 0), kind: "pct" },
      { label: "ยอดต่อออเดอร์ (AOV)", a: aov(ta), b: aov(tb), kind: "baht" },
      { label: "GMV", a: ta.gmv, b: tb.gmv, kind: "baht" },
    ]
    : [
      { label: "Viewers", a: ta.viewers, b: tb.viewers, kind: "int" },
      { label: "ออเดอร์", a: ta.orders, b: tb.orders, kind: "int" },
      { label: "CO (ออเดอร์ ÷ Viewers)", a: ratio(ta.orders, ta.viewers), b: ratio(tb.orders, tb.viewers), kind: "pct" },
      { label: "ยอดต่อออเดอร์ (AOV)", a: aov(ta), b: aov(tb), kind: "baht" },
      { label: "GMV", a: ta.gmv, b: tb.gmv, kind: "baht" },
    ];
  // ช่วงที่ไม่มีไลฟ์ = ไม่มีค่า (ไม่ใช่ 0)
  return { platform, steps: steps.map((s) => ({ ...s, a: ta.lives ? s.a : null, b: tb.lives ? s.b : null })) };
}

/** ช่วงเวลาเริ่มไลฟ์ (3 ชม.) ที่ GMV/ชม. ดีสุด / แย่สุด — ข้ามไลฟ์ที่ไม่รู้เวลาเริ่ม (นำเข้าจากชีต = 00:0x) */
function hourBuckets(list: LiveSession[]) {
  const map = new Map<number, { gmv: number; sec: number; lives: number }>();
  for (const s of list) {
    const p = bkkParts(s.startedAt);
    if (p.h === 0 && p.mi < 10) continue;
    const k = Math.floor(p.h / 3) * 3;
    const x = map.get(k) ?? { gmv: 0, sec: 0, lives: 0 };
    x.gmv += s.gmv; x.sec += s.durationSec; x.lives++;
    map.set(k, x);
  }
  const rows = [...map].filter(([, x]) => x.sec >= 2 * 3600 && x.lives >= 2)
    .map(([h, x]) => ({ label: `${String(h).padStart(2, "0")}:00–${String((h + 3) % 24).padStart(2, "0")}:00`, perHour: x.gmv / (x.sec / 3600) }))
    .sort((x, y) => y.perHour - x.perHour);
  return rows.length >= 2 ? { best: rows[0], worst: rows[rows.length - 1] } : null;
}

export function analyze(o: {
  aName: string; bName: string; a: LiveSession[]; b: LiveSession[];
  time: { short: string; a: LiveSession[]; b: LiveSession[] }[]; stepWord: string; // "วัน" / "เดือน"
}): Analysis {
  const { aName, bName, a, b } = o;
  const ta = totalsOf(a), tb = totalsOf(b);
  const drops: { score: number; text: string }[] = [];
  const wins: { score: number; text: string }[] = [];
  const suggestions: string[] = [];
  const hasB = tb.lives > 0;
  const add = (c: number | null, text: (dir: "เพิ่มขึ้น" | "ลดลง") => string, weight = 1) => {
    if (c === null || Math.abs(c) < MEANINGFUL) return;
    (c < 0 ? drops : wins).push({ score: Math.abs(c) * weight, text: text(c < 0 ? "ลดลง" : "เพิ่มขึ้น") });
  };

  // GMV แยกสาเหตุ: ชั่วโมงไลฟ์ (ปริมาณ) กับ ยอดต่อชั่วโมง (ประสิทธิภาพ)
  const ha = ta.durationSec / 3600, hb = tb.durationSec / 3600;
  const ea = ha ? ta.gmv / ha : 0, eb = hb ? tb.gmv / hb : 0;
  const drivers = hasB && ta.lives ? { delta: ta.gmv - tb.gmv, hoursEffect: (ha - hb) * eb, rateEffect: ha * (ea - eb) } : null;

  const gmvC = changeOf(ta.gmv, hasB ? tb.gmv : null);
  add(gmvC, (d) => `GMV ${d} ${pctAbs(gmvC!)} (${baht(ta.gmv)} vs ${baht(tb.gmv)})`, 3);
  const hoursC = changeOf(ha, hasB ? hb : null);
  add(hoursC, (d) => `ชั่วโมงไลฟ์${d} ${pctAbs(hoursC!)} (${ha.toFixed(1)} vs ${hb.toFixed(1)} ชม.)`, 1.5);
  const rateC = changeOf(ea, hasB ? eb : null);
  add(rateC, (d) => `GMV ต่อชั่วโมง${d} ${pctAbs(rateC!)} (${baht(ea)} vs ${baht(eb)})`, 2);
  const viewersC = changeOf(ta.viewers, hasB ? tb.viewers : null);
  add(viewersC, (d) => `Viewers ${d} ${pctAbs(viewersC!)}`, 1.2);

  // กรวยของแต่ละแพลตฟอร์ม: อัตราไหนดรอป
  const platforms = (["TikTok", "Shopee"] as const).filter((p) => a.some((s) => s.platform === p) || b.some((s) => s.platform === p));
  const funnels = platforms.map((p) => funnelOf(p, a.filter((s) => s.platform === p), b.filter((s) => s.platform === p)));
  const rate: Partial<Record<Platform, { ctr?: number | null; co?: number | null; aov?: number | null }>> = {};
  for (const f of funnels) {
    const get = (prefix: string) => f.steps.find((s) => s.label.startsWith(prefix));
    const ctr = get("CTR"), co = get("CO"), aov = get("ยอดต่อออเดอร์");
    const cCtr = ctr ? changeOf(ctr.a, ctr.b) : null, cCo = co ? changeOf(co.a, co.b) : null, cAov = aov ? changeOf(aov.a, aov.b) : null;
    rate[f.platform] = { ctr: cCtr, co: cCo, aov: cAov };
    if (ctr) add(cCtr, (d) => `${f.platform} CTR ${d} (${rateText(ctr.a)} vs ${rateText(ctr.b)})`, 1.5);
    if (co) add(cCo, (d) => `${f.platform} CO ${d} (${rateText(co.a)} vs ${rateText(co.b)})`, 1.5);
    if (aov) add(cAov, (d) => `${f.platform} ยอดต่อออเดอร์${d} (${baht(aov.a ?? 0)} vs ${baht(aov.b ?? 0)})`, 1.2);
  }

  // บัญชี: GMV เปลี่ยนมาก / หายไป (ข้ามบัญชีเล็กกว่า 3% ของ GMV ช่วงเทียบ)
  const accDrops: string[] = [];
  for (const acc of accountsOf([...a, ...b])) {
    const xa = totalsOf(a.filter((s) => keyOf(s) === acc.key)), xb = totalsOf(b.filter((s) => keyOf(s) === acc.key));
    if (!hasB) break;
    if (xb.lives && !xa.lives) {
      drops.push({ score: 0.9, text: `${acc.name} ไม่มีไลฟ์ใน ${aName} (${bName} ทำ ${baht(xb.gmv)})` });
      accDrops.push(acc.name);
      continue;
    }
    if (xb.gmv < tb.gmv * 0.03 && xa.gmv < ta.gmv * 0.03) continue;
    const c = changeOf(xa.gmv, xb.lives ? xb.gmv : null);
    add(c, (d) => `${acc.name} GMV ${d} ${pctAbs(c!)} (${baht(xa.gmv)} vs ${baht(xb.gmv)})`, 1.3);
    if (c !== null && c <= -0.15) accDrops.push(acc.name);
  }

  // วัน/เดือนที่ต่ำกว่าช่วงเทียบชัดเจน
  const weakSteps = o.time
    .map((t, i) => ({ i, label: t.short, ga: totalsOf(t.a).gmv, gb: totalsOf(t.b).gmv }))
    .filter((t) => t.gb > 0 && t.ga < t.gb * 0.8)
    .sort((x, y) => x.ga / x.gb - y.ga / y.gb);
  for (const t of weakSteps.slice(0, 2)) {
    drops.push({ score: (1 - t.ga / t.gb) * 0.8, text: `${o.stepWord}ที่ ${t.i + 1} (${t.label}) GMV ต่ำกว่า ${bName} ${pctAbs(1 - t.ga / t.gb)}` });
  }

  // ---------- ข้อเสนอแนะ (ผูกกับสาเหตุที่เจอ) ----------
  const hours = hourBuckets(a);
  const bestTime = hours ? ` เช่น ${hours.best.label} (${baht(hours.best.perHour)}/ชม.)` : "";
  const lowCo = (["TikTok", "Shopee"] as const).filter((p) => (rate[p]?.co ?? 0) <= -MEANINGFUL);
  const lowAov = (["TikTok", "Shopee"] as const).filter((p) => (rate[p]?.aov ?? 0) <= -MEANINGFUL);

  if (hasB && hoursC !== null && hoursC <= -MEANINGFUL) {
    suggestions.push(`ชั่วโมงไลฟ์ลดลง ${pctAbs(hoursC)} ทำให้ GMV หายไปราว ${baht(Math.abs(drivers?.hoursEffect ?? 0))} → เพิ่ม slot ในช่วงที่ทำยอดต่อชั่วโมงได้ดี${bestTime}`);
  }
  if (hasB && rateC !== null && rateC <= -MEANINGFUL) {
    suggestions.push(hoursC !== null && hoursC > 0
      ? `ไลฟ์นานขึ้นแต่ GMV/ชม. ลดลง ${pctAbs(rateC)} → ตัดหรือย้าย slot ที่ยอดต่ำ${hours ? ` (ช่วง ${hours.worst.label} ได้ ${baht(hours.worst.perHour)}/ชม.)` : ""} ไปไว้ช่วงที่ขายดีกว่า`
      : `GMV ต่อชั่วโมงลดลง ${pctAbs(rateC)} → ทบทวนสินค้าที่ปักตะกร้า โปรโมชัน และลำดับการขายในไลฟ์ เทียบกับ ${bName}`);
  }
  if ((rate.TikTok?.ctr ?? 0) <= -MEANINGFUL) {
    suggestions.push("TikTok CTR ลดลง (เห็นสินค้าแต่คลิกน้อยลง) → ปักตะกร้าสินค้าตัวเด่นให้ถี่ขึ้น ปรับรูป/ชื่อสินค้าและราคาโปรที่โชว์ ให้ Mc ชวนกดตะกร้าเป็นช่วง ๆ");
  }
  if (lowCo.length) {
    suggestions.push(`${lowCo.join(" / ")} CO ลดลง (สนใจแต่ไม่ซื้อ) → เช็คราคา/โปรเทียบ ${bName} สต็อก และค่าส่ง เพิ่มของแถมหรือโค้ดจำกัดเวลาเพื่อปิดการขาย`);
  }
  if (lowAov.length) {
    suggestions.push(`${lowAov.join(" / ")} ยอดต่อออเดอร์ลดลง → ทำเซ็ต/บันเดิล ส่วนลดขั้นบันได หรือของแถมเมื่อซื้อครบ เพื่อดันยอดต่อบิล`);
  }
  if (hasB && viewersC !== null && viewersC <= -MEANINGFUL) {
    suggestions.push(`Viewers ลดลง ${pctAbs(viewersC)} → โปรโมทก่อนไลฟ์ (คลิปสั้น/โพสต์/แจ้งเตือนผู้ติดตาม) ใช้โฆษณาดันคนเข้าไลฟ์ในช่วงแรก และแจกคอยน์/ของรางวัลเพื่อให้คนอยู่ดูนานขึ้น`);
  } else if (hasB && viewersC !== null && viewersC >= MEANINGFUL && lowCo.length) {
    suggestions.push("คนดูเพิ่มขึ้นแต่ซื้อน้อยลง → คนที่เข้ามาอาจไม่ตรงกลุ่ม ปรับกลุ่มเป้าหมายโฆษณาและเน้นสินค้าขายดีช่วงคนดูเยอะ");
  }
  if (accDrops.length) {
    suggestions.push(`บัญชีที่ยอดลดลงมาก (${accDrops.slice(0, 3).join(", ")}) → ทบทวน Mc สินค้า และช่วงเวลาไลฟ์ของบัญชีนี้ เทียบกับ ${bName}`);
  }
  const top5 = a.slice().sort((x, y) => y.gmv - x.gmv).slice(0, 5).reduce((sum, s) => sum + s.gmv, 0);
  if (a.length >= 10 && ta.gmv && top5 / ta.gmv >= 0.6) {
    suggestions.push(`ยอดกระจุกอยู่ในไม่กี่ไลฟ์ (Top 5 = ${pctAbs(top5 / ta.gmv)} ของ GMV) → ถอดสูตรไลฟ์ที่ทำยอดสูง (สินค้า/โปร/Mc/เวลา) แล้วทำซ้ำในไลฟ์อื่น`);
  }
  if (hours && !suggestions.some((s) => s.includes(hours.best.label))) {
    suggestions.push(`ช่วงเวลาที่ GMV/ชม. ดีที่สุดของ ${aName}: ${hours.best.label} (${baht(hours.best.perHour)}/ชม.) ต่ำสุด: ${hours.worst.label} (${baht(hours.worst.perHour)}/ชม.) → ใช้วางตาราง slot รอบถัดไป`);
  }
  const bestWin = wins.slice().sort((x, y) => y.score - x.score)[0];
  if (!drops.length && hasB) {
    suggestions.unshift(`ตัวชี้วัดหลักไม่มีตัวไหนลดลงเกิน 5% → ทำซ้ำสิ่งที่ได้ผล${bestWin ? ` (เด่นสุด: ${bestWin.text})` : ""} และขยายในช่วงที่ขายดี`);
  }
  if (!hasB) suggestions.push(`ยังไม่มีข้อมูล ${bName} ให้เทียบ → อัปโหลดไฟล์ของช่วงนั้นก่อน จะวิเคราะห์ได้ครบ`);

  const top = (list: { score: number; text: string }[], n: number) => list.sort((x, y) => y.score - x.score).slice(0, n).map((x) => x.text);
  return { drivers, funnels, drops: top(drops, 6), wins: top(wins, 4), suggestions: suggestions.slice(0, 6) };
}
