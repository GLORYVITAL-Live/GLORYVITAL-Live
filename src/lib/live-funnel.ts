// "ยอดมาจากไหน": ขั้นการขายของแต่ละแพลตฟอร์ม + หาขั้นที่ทำให้ GMV เปลี่ยนมากที่สุด
//   ใช้ทั้งหน้าเว็บ (LiveStats.tsx Funnel) และสไลด์ (live-slides.ts) ให้ตัวเลขตรงกัน
import type { Platform, Totals } from "@/lib/live-stats";

export type FunnelStep = { label: string; value: (t: Totals) => number | null; kind: "int" | "pct" | "baht"; rate?: boolean; why?: [string, string] };

const ratioOf = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : a / b);

/** ขั้นของแต่ละแพลตฟอร์ม: ขั้นหลัก (จำนวน) สลับกับอัตรา (rate) · why = คำอธิบายเมื่อขั้นนั้นทำให้ยอดเปลี่ยน [ลดลง, เพิ่มขึ้น] */
export const FUNNEL_STEPS: Record<Platform, FunnelStep[]> = {
  TikTok: [
    { label: "Product Impressions", value: (t) => t.impressions, kind: "int", why: ["คนเห็นสินค้าน้อยลง", "คนเห็นสินค้ามากขึ้น"] },
    { label: "CTR", value: (t) => ratioOf(t.clicks, t.impressions), kind: "pct", rate: true, why: ["คนคลิกสินค้าน้อยลง", "คนคลิกสินค้ามากขึ้น"] },
    { label: "คลิก", value: (t) => t.clicks, kind: "int" },
    { label: "CO", value: (t) => ratioOf(t.orders, t.clicks), kind: "pct", rate: true, why: ["คลิกแล้วซื้อน้อยลง", "คลิกแล้วซื้อมากขึ้น"] },
    { label: "ออเดอร์", value: (t) => t.orders, kind: "int" },
    { label: "มูลค่าต่อออเดอร์", value: (t) => ratioOf(t.gmv, t.orders), kind: "baht", rate: true, why: ["มูลค่าต่อออเดอร์ลดลง", "มูลค่าต่อออเดอร์เพิ่มขึ้น"] },
    { label: "GMV", value: (t) => t.gmv, kind: "baht" },
  ],
  Shopee: [
    { label: "Viewers", value: (t) => t.viewers, kind: "int", why: ["คนดูน้อยลง", "คนดูมากขึ้น"] },
    { label: "CO", value: (t) => ratioOf(t.orders, t.viewers), kind: "pct", rate: true, why: ["คนดูแล้วซื้อน้อยลง", "คนดูแล้วซื้อมากขึ้น"] },
    { label: "ออเดอร์", value: (t) => t.orders, kind: "int" },
    { label: "มูลค่าต่อออเดอร์", value: (t) => ratioOf(t.gmv, t.orders), kind: "baht", rate: true, why: ["มูลค่าต่อออเดอร์ลดลง", "มูลค่าต่อออเดอร์เพิ่มขึ้น"] },
    { label: "GMV", value: (t) => t.gmv, kind: "baht" },
  ],
};

/**
 * GMV = ขั้นแรก × อัตราทุกขั้น → การเปลี่ยนของ GMV แยกเป็นผลของแต่ละตัวได้ด้วย log ของอัตราส่วน (ผลรวมทุกตัว = การเปลี่ยนของ GMV)
 *   ตัวที่ผลมากที่สุดในทิศเดียวกับ GMV = สาเหตุหลัก · ข้อมูลไม่ครบ (มีค่า 0 / ไม่มีช่วงเทียบ) = ไม่บอก
 */
export function funnelCause(steps: FunnelStep[], cur: Totals, prev: Totals) {
  const g1 = cur.gmv, g0 = prev.gmv;
  if (!g1 || !g0) return null;
  const parts = steps.filter((s) => s.why).map((s) => ({ s, a: s.value(cur), b: s.value(prev) }));
  if (parts.some((p) => !p.a || !p.b)) return null;
  const total = Math.log(g1 / g0);
  const effects = parts.map((p) => ({ s: p.s, e: Math.log(p.a! / p.b!), change: p.a! / p.b! - 1 }));
  const same = effects.filter((x) => Math.sign(x.e) === Math.sign(total));
  const main = (same.length ? same : effects).reduce((m, x) => (Math.abs(x.e) > Math.abs(m.e) ? x : m));
  return { up: total > 0, change: g1 / g0 - 1, main };
}

/** ประโยคสรุปสาเหตุ (เหมือนกล่องใต้ pipeline บนเว็บ) */
export function funnelCauseText(cause: NonNullable<ReturnType<typeof funnelCause>>) {
  const pct = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;
  return {
    lead: `GMV ${cause.up ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(cause.change * 100).toFixed(1)}% — มาจาก`,
    why: cause.main.s.why![cause.main.change > 0 ? 1 : 0],
    tail: `มากที่สุด (${cause.main.s.label} ${pct(cause.main.change)})`,
  };
}
