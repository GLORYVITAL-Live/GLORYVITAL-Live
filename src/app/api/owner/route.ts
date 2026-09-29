import { NextResponse } from "next/server";
import { fail, monthRange, requireMe } from "@/lib/api";
import { ownerSummary } from "@/lib/data";

// สรุปรายเดือนสำหรับเจ้าของ (?month=YYYY-MM) — แทน action "ownerSummary"
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!r.me.owner) return fail("บัญชีนี้ไม่มีสิทธิ์ดูหน้าสรุป", 403);
  const { key, first, last } = monthRange(new URL(request.url).searchParams.get("month"));
  return NextResponse.json(await ownerSummary(key, first, last));
}
