// งบของกลุ่มภายนอกในหน้า Cost (ตาราง agency_rates · SQL 20261125000000_agency_rates)
//   ตั้งเรทต่อชั่วโมงต่อกลุ่มต่อเดือน งบของเดือน = เรท × ชั่วโมงในหน้า Plan Slot Live — ฟังก์ชันล้วน ใช้ทั้งหน้าเว็บและเซิร์ฟเวอร์ (เทสได้)

import type { ExportSheet } from "@/lib/export";

const RATE_MAX = 1_000_000;

/** In house เป็นทีมของเราเอง ไม่มีงบแบบกลุ่มภายนอก */
export const hasBudget = (agency: string) => agency !== "In house";

/** ชื่อกลุ่มที่รับจากหน้าเว็บ (ตัวอักษร / ตัวเลข / ช่องว่าง สั้นๆ) */
export const cleanAgency = (v: unknown) => {
  const t = String(v ?? "").trim().replace(/\s+/g, " ");
  return /^[\p{L}\p{N} ._-]{1,30}$/u.test(t) ? t : null;
};

/** เรทที่บันทึกได้: ตัวเลขมากกว่า 0 และไม่สูงผิดปกติ */
export const validRate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= RATE_MAX;

/** ข้อความที่พิมพ์ -> เรท: ว่าง / 0 = null (ไม่ตั้งเรท) · พิมพ์ผิด / สูงผิดปกติ = NaN */
export function parseRate(text: string) {
  const s = text.replace(/[,\s฿]/g, "");
  if (!s) return null;
  const n = Number(s);
  return n === 0 ? null : validRate(n) ? n : NaN;
}

export type BudgetRow = { label: string; channel: string; rate: number | null; hours: number };

/** แผ่นงาน "งบ Agency" ในไฟล์ส่งออก เฉพาะกลุ่มที่ตั้งเรท (ไม่มีเลย = null ไม่ต้องมีแผ่นนี้) */
export function budgetSheet(list: BudgetRow[]): ExportSheet | null {
  const set = list.filter((x) => x.rate);
  if (!set.length) return null;
  return {
    name: "งบ Agency",
    rows: [
      ["กลุ่ม", "ช่อง", "เรท (บาท/ชม.)", "ชั่วโมงในแพลน", "งบ (บาท)"],
      ...set.map((x) => [x.label, x.channel, { v: x.rate, f: "money" as const }, { v: x.hours, f: "dec" as const }, { v: x.rate! * x.hours, f: "money" as const }]),
      ["รวม", "", null, { v: set.reduce((s, x) => s + x.hours, 0), f: "dec" }, { v: set.reduce((s, x) => s + x.rate! * x.hours, 0), f: "money" }],
    ],
  };
}
