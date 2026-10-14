import { NextResponse } from "next/server";
import { monthRange, requireOwner } from "@/lib/api";
import { ownerSummary } from "@/lib/data";
import { applyPeriods, canClosePeriods } from "@/lib/periods";
import { withPlatformLabels } from "@/lib/platform";

// สรุปรายเดือนสำหรับเจ้าของ (?month=YYYY-MM) — แทน action "ownerSummary"
// ส่งเฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์ (Mc / Admin) · ฝั่งที่ดูได้อย่างเดียว = ไม่ส่งค่าจ้าง (อัตรา / Commit)
// ฝั่งที่ปิดงวดแล้ว = ตัวเลขตอนปิด (ไฟล์เบิกใช้ชุดเดียวกัน) + ส่วนต่างของข้อมูลจริง
export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูหน้าสรุป", "read");
  if ("res" in r) return r.res;
  const { key, first, last } = monthRange(new URL(request.url).searchParams.get("month"));
  const s = await ownerSummary(key, first, last);
  const { mc, admin, edit } = r.scope;
  // ฝั่งที่ปิดงวดแล้ว: ใช้ตัวเลขตอนปิด + ส่วนต่างของข้อมูลจริง
  const [{ periods, changes, periodLog }, canClose] = await Promise.all([
    applyPeriods(s, key, [...(mc ? ["mc" as const] : []), ...(admin ? ["admin" as const] : [])]),
    canClosePeriods(r.me),
  ]);
  const hide = { mc: !edit.mc, admin: !edit.admin };
  const people = (list: typeof s.mc, hidden: boolean) => (hidden ? list.map((p) => ({ ...p, commit: null })) : list);
  return NextResponse.json({
    ...s,
    scope: { mc, admin },
    periods, periodLog, canClose,
    // ส่วนต่างมีค่าจ้าง/ชม. ด้วย: ฝั่งที่ดูได้อย่างเดียวไม่ส่ง
    changes: Object.fromEntries(Object.entries(changes).filter(([side]) => !hide[side as "mc" | "admin"])),
    payHidden: hide,
    mc: mc ? people(s.mc, hide.mc) : [],
    admin: admin ? people(s.admin, hide.admin) : [],
    // ชื่อช่องที่แสดง (ชีตยังใช้ชื่อเดิม) ไฟล์ส่งออกใช้ข้อมูลชุดนี้
    details: withPlatformLabels(s.details.filter((d) => (d.type === "Mc" ? mc : admin))),
    rates: {
      mc: mc && !hide.mc ? s.rates.mc : {}, admin: admin && !hide.admin ? s.rates.admin : {},
      defaultMc: hide.mc ? 0 : s.rates.defaultMc, defaultAdmin: hide.admin ? 0 : s.rates.defaultAdmin,
    },
  });
}
