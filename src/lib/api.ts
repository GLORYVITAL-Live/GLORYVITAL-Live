import "server-only";
import { NextResponse } from "next/server";
import { getMe, isRegistered } from "@/lib/auth";
import type { Me } from "@/lib/types";

export function ok<T extends object>(data: T) {
  return NextResponse.json({ ok: true, ...data });
}

export function fail(message: string, status = 400, extra: object = {}) {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

/** ตรวจ login ก่อนทำงาน ถ้าไม่ผ่านคืน response แจ้ง error ให้ส่งกลับได้ทันที */
export async function requireMe(): Promise<{ me: Me } | { res: NextResponse }> {
  const me = await getMe();
  if (!me) return { res: fail("กรุณาเข้าสู่ระบบด้วย Google ก่อน", 401, { authError: true }) };
  if (!isRegistered(me)) {
    return { res: fail(`อีเมล ${me.email} ยังไม่ได้ลงทะเบียน กรุณาติดต่อแอดมิน`, 403, { authError: true }) };
  }
  return { me };
}

/** YYYY-MM -> { first, last } เป็นวันที่ (YYYY-MM-DD) ไม่ระบุ = เดือนปัจจุบันตามเวลาไทย */
export function monthRange(month: string | null) {
  const m = String(month ?? "").match(/^(\d{4})-(\d{1,2})$/);
  const now = new Date(Date.now() + 7 * 3600_000);
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mon = m ? Number(m[2]) : now.getUTCMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, mon, 0)).getUTCDate();
  return { key: `${y}-${pad(mon)}`, first: `${y}-${pad(mon)}-01`, last: `${y}-${pad(mon)}-${pad(lastDay)}` };
}
