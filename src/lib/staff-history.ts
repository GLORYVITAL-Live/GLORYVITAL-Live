// ประวัติการแก้พนักงาน: ข้อความ "อะไรเปลี่ยน จากเท่าไรเป็นเท่าไร" (ค่าจ้าง / Commit / สิทธิ์ / ข้อมูลติดต่อ) — ไม่แตะ DB (เทสได้)
import { liveTeamOf } from "@/lib/live-team";
import { tiersLabel } from "@/lib/pay";
import type { CommitTier } from "@/lib/types";

const LABEL: Record<string, string> = {
  name: "ชื่อ", email: "อีเมล", phone: "เบอร์", hourly_rate: "ค่าจ้าง", commit_tiers: "Commit",
  is_extra_admin: "Admin เสริม", is_salaried: "พนักงานประจำ", can_manage_equipment: "หน้าอุปกรณ์โปรดักชั่น",
  can_manage_mc: "จัดการ Mc", can_manage_admin: "จัดการ Admin", can_manage_proofs: "จัดการหลักฐานไลฟ์",
  can_view_analytics: "Data analytics", analytics_readonly: "Data analytics ดูอย่างเดียว", can_plan_slots: "Plan Slot Live",
  can_view_mc: "ดู Mc", can_view_admin: "ดู Admin", can_view_proofs: "ดูหลักฐานไลฟ์", can_view_plan: "ดู Plan Slot Live",
  notify_cancel_mc: "รับเมลยกเลิก Mc", notify_cancel_admin: "รับเมลยกเลิก Admin", live_platform: "ทีมไลฟ์",
  can_view_pay_docs: "ดูเอกสารของ Mc", can_view_pay_docs_admin: "ดูเอกสารของ Admin", can_manage_quota: "กำหนดสิทธิ์จอง Mc",
  team_name: "ทีม / แผนก",
};

function show(key: string, v: unknown) {
  if (key === "live_platform") return liveTeamOf(v) === "shopee" ? "Shopee" : "TikTok";
  if (key === "hourly_rate") return v === null || v === undefined || v === "" ? "ค่าเริ่มต้น" : `${Number(v).toLocaleString("th-TH")} บาท/ชม.`;
  if (key === "commit_tiers") return (Array.isArray(v) && v.length ? tiersLabel(0, v as CommitTier[]) : "") || "ไม่มี";
  if (typeof v === "boolean" || v === null || v === undefined) {
    if (key in LABEL && !["name", "email", "phone"].includes(key)) return v ? "เปิด" : "ปิด";
  }
  return String(v ?? "").trim() || "ว่าง";
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  || ((a === null || a === undefined || a === false) && (b === null || b === undefined || b === false) && typeof (a ?? b) !== "string");

/** ข้อความรายการที่เปลี่ยน เช่น "ค่าจ้าง 700 บาท/ชม. → 750 บาท/ชม. · พนักงานประจำ ปิด → เปิด" (ไม่เปลี่ยน = "") */
export function staffChangeText(cur: Record<string, unknown>, changes: Record<string, unknown>) {
  return Object.keys(changes)
    // ทีมไลฟ์: ว่าง (ยังไม่ได้รัน SQL) = TikTok
    .filter((k) => k in LABEL && (k === "live_platform" ? liveTeamOf(cur[k]) !== liveTeamOf(changes[k]) : !same(cur[k], changes[k])))
    .map((k) => `${LABEL[k]} ${show(k, cur[k])} → ${show(k, changes[k])}`)
    .join(" · ");
}
