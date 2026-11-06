// งบรายเดือนของกลุ่มภายนอกในหน้า Plan Slot Live (ตาราง agency_budgets · SQL 20261124000000_agency_budgets)
//   ก้อนเดียวต่อกลุ่มต่อเดือน เทียบกับชั่วโมงในแพลนเป็นงบต่อชั่วโมง — ฟังก์ชันล้วน ใช้ทั้งหน้าเว็บและเซิร์ฟเวอร์ (เทสได้)

import type { Cell, ExportSheet } from "@/lib/export";

const BUDGET_MAX = 100_000_000;

/** In house เป็นทีมของเราเอง ไม่มีงบแบบกลุ่มภายนอก */
export const hasBudget = (agency: string) => agency !== "In house";

/** ค่างบที่บันทึกได้: ตัวเลขมากกว่า 0 และไม่สูงผิดปกติ */
export const validBudget = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= BUDGET_MAX;

/** ข้อความที่พิมพ์ -> งบ: ว่าง / 0 = null (ไม่ตั้งงบ) · พิมพ์ผิด / สูงผิดปกติ = NaN */
export function parseBudget(text: string) {
  const s = text.replace(/[,\s฿]/g, "");
  if (!s) return null;
  const n = Number(s);
  return n === 0 ? null : validBudget(n) ? n : NaN;
}

/** งบต่อชั่วโมง (ยังไม่ตั้งงบ / ยังไม่มีชั่วโมง = null) */
export const perHour = (amount: number | null, hours: number) => (amount && hours > 0 ? amount / hours : null);

export type BudgetRow = { label: string; channel: string; amount: number | null; hours: number };

/** แผ่นงาน "งบ Agency" ในไฟล์ส่งออก เฉพาะกลุ่มที่ตั้งงบ (ไม่มีเลย = null ไม่ต้องมีแผ่นนี้) */
export function budgetSheet(list: BudgetRow[]): ExportSheet | null {
  const set = list.filter((x) => x.amount);
  if (!set.length) return null;
  const row = (label: string, channel: string, amount: number, hours: number): Cell[] => {
    const per = perHour(amount, hours);
    return [label, channel, { v: amount, f: "money" }, { v: hours, f: "dec" }, per === null ? null : { v: per, f: "money" }];
  };
  return {
    name: "งบ Agency",
    rows: [
      ["กลุ่ม", "ช่อง", "งบ (บาท)", "ชั่วโมงในแพลน", "งบต่อชั่วโมง (บาท)"],
      ...set.map((x) => row(x.label, x.channel, x.amount!, x.hours)),
      row("รวม", "", set.reduce((s, x) => s + x.amount!, 0), set.reduce((s, x) => s + x.hours, 0)),
    ],
  };
}
