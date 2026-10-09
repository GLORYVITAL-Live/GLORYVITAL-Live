import { NextResponse } from "next/server";
import { monthRange, requireOwner } from "@/lib/api";
import { ownerSummary } from "@/lib/data";
import { withPlatformLabels } from "@/lib/platform";

// สรุปรายเดือนสำหรับเจ้าของ (?month=YYYY-MM) — แทน action "ownerSummary"
// ส่งเฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์ (Mc / Admin) · ฝั่งที่ดูได้อย่างเดียว = ไม่ส่งค่าจ้าง (อัตรา / Commit)
export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูหน้าสรุป", "read");
  if ("res" in r) return r.res;
  const { key, first, last } = monthRange(new URL(request.url).searchParams.get("month"));
  const s = await ownerSummary(key, first, last);
  const { mc, admin, edit } = r.scope;
  const hide = { mc: !edit.mc, admin: !edit.admin };
  const people = (list: typeof s.mc, hidden: boolean) => (hidden ? list.map((p) => ({ ...p, commit: null })) : list);
  return NextResponse.json({
    ...s,
    scope: { mc, admin },
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
