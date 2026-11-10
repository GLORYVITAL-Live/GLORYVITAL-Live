// แจ้งเตือนยอดดรอปรายสัปดาห์ (ผู้ใช้ขอ 2026-11-10) — ฟังก์ชันล้วน (เทสได้) ตัวส่งอยู่ที่ src/lib/live-alerts.ts
//   7 วันล่าสุดที่มีข้อมูลครบทั้งสองแพลตฟอร์ม เทียบ 7 วันก่อนหน้า · รายกลุ่ม (Agency / ทีมเรา) + รายบัญชี (src/lib/live-breakdown.ts)
//   ดรอป = GMV ลดเกิน 10% และช่วงก่อนมี GMV อย่างน้อย ฿30,000 (ยอดน้อยแกว่งง่าย) · บอกขาที่ทำให้ดรอป (ชั่วโมงไลฟ์ / คนดูต่อชม. / ยอดต่อคนดู)

import { breakdownRows, mainLeg } from "@/lib/live-breakdown";
import type { OwnerSpan } from "@/lib/live-owners";
import { changeOf, fmtMetric, type LiveSession } from "@/lib/live-stats";

export const DROP_AT = -0.1;
export const DROP_MIN_BASE = 30_000;
const MAX_LINES = 6;

const pct = (c: number | null) => (c === null ? "-" : `${c >= 0 ? "▲" : "▼"}${Math.abs(c * 100).toFixed(0)}%`);
const baht = (v: number) => fmtMetric("baht", v);

export type DropLine = { label: string; change: number; loss: number; leg: string | null };

/**
 * a = 7 วันล่าสุด / b = 7 วันก่อนหน้า · aName / bName = ข้อความช่วงวัน
 *   คืนหัวข้อ + เนื้อความแจ้งเตือน + รายการที่ดรอป (เรียงตามยอดที่หายมากสุด)
 */
export function dropDigest(a: LiveSession[], b: LiveSession[], spans: OwnerSpan[] | null, aName: string, bName: string) {
  const { groups, accounts } = breakdownRows(a, b, spans);
  const platforms = groups.filter((r) => r.level === "platform");
  // บัญชีที่เป็นบัญชีเดียวของแพลตฟอร์ม = ตัวเลขเดียวกับยอดรวมแพลตฟอร์ม ไม่ต้องซ้ำ
  const multi = new Set(platforms.filter((p) => accounts.filter((x) => x.platform === p.platform).length > 1).map((p) => p.platform));
  const candidates = [
    ...groups.filter((r) => r.level === "group").map((r) => ({ r, label: `${r.platform} · ${r.label}` })),
    ...accounts.filter((r) => multi.has(r.platform)).map((r) => ({ r, label: `${r.platform} · บัญชี ${r.label}` })),
  ];
  // กลุ่มที่ช่วงนี้ไม่มีไลฟ์เลย (เช่น เวลาย้ายไปเป็นของ Agency) แยกไว้ ไม่นับเป็นดรอป 100%
  const gone = candidates.filter(({ r }) => !r.a.lives && r.b.gmv >= DROP_MIN_BASE).map(({ r, label }) => ({ label, prev: r.b.gmv }));
  const drops: DropLine[] = candidates.flatMap(({ r, label }) => {
    if (!r.a.lives) return [];
    const c = changeOf(r.a.gmv, r.b.lives ? r.b.gmv : null);
    if (c === null || c > DROP_AT || r.b.gmv < DROP_MIN_BASE) return [];
    const leg = mainLeg(r.a, r.b);
    return [{ label, change: c, loss: r.b.gmv - r.a.gmv, leg: leg ? `${leg.label} ${pct(leg.change)}` : null }];
  }).sort((x, y) => y.loss - x.loss);

  const total = { a: a.reduce((s, x) => s + x.gmv, 0), b: b.reduce((s, x) => s + x.gmv, 0) };
  const head = `GMV รวม ${baht(total.a)} ${pct(changeOf(total.a, total.b || null))}`
    + (platforms.length > 1 ? ` (${platforms.map((p) => `${p.platform} ${pct(changeOf(p.a.gmv, p.b.gmv || null))}`).join(" · ")})` : "");
  const lines = drops.slice(0, MAX_LINES).map((d) => `• ${d.label} ${pct(d.change)} (−${baht(d.loss)})${d.leg ? ` — ดรอปที่ ${d.leg}` : ""}`);
  const body = [
    head,
    drops.length ? `ดรอปเกิน ${Math.abs(DROP_AT * 100)}%:` : `ไม่มีกลุ่ม / บัญชีที่ GMV ลดเกิน ${Math.abs(DROP_AT * 100)}%`,
    ...lines,
    drops.length > MAX_LINES ? `และอีก ${drops.length - MAX_LINES} รายการ` : "",
    gone.length ? `ไม่มีไลฟ์ช่วงนี้ (เวลาอาจย้ายไปกลุ่มอื่น): ${gone.map((g) => `${g.label} (ช่วงก่อน ${baht(g.prev)})`).join(" · ")}` : "",
    "ดูละเอียดที่ Analytics > เทียบ > ช่วงวันที่",
  ].filter(Boolean).join("\n");
  return {
    title: drops.length ? `ยอดดรอป ${drops.length} จุด · ${aName} เทียบ ${bName}` : `สรุปยอด ${aName} เทียบ ${bName}`,
    body, drops,
  };
}
