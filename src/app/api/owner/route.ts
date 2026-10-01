import { NextResponse } from "next/server";
import { monthRange, requireOwner } from "@/lib/api";
import { ownerSummary } from "@/lib/data";

// สรุปรายเดือนสำหรับเจ้าของ (?month=YYYY-MM) — แทน action "ownerSummary"
// ส่งเฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์ (Mc / Admin)
export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูหน้าสรุป");
  if ("res" in r) return r.res;
  const { key, first, last } = monthRange(new URL(request.url).searchParams.get("month"));
  const s = await ownerSummary(key, first, last);
  const { mc, admin } = r.scope;
  return NextResponse.json({
    ...s,
    scope: { mc, admin },
    mc: mc ? s.mc : [],
    admin: admin ? s.admin : [],
    details: s.details.filter((d) => (d.type === "Mc" ? mc : admin)),
    rates: { ...s.rates, mc: mc ? s.rates.mc : {}, admin: admin ? s.rates.admin : {} },
  });
}
