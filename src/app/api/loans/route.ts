import { fail, ok, requireMe } from "@/lib/api";
import { cleanLoanInput, type LoanAction } from "@/lib/loans";
import { LOANS_SQL, actOnLoan, createLoan, listLoans, loanCatalog } from "@/lib/loans-db";
import { createAdminClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

// ขอยืมอุปกรณ์จากทีมอื่น (src/lib/loans-db.ts) — ผู้ยืม = บัญชีทีมอื่น + Marketing (me.borrower ใน src/lib/auth.ts)
//   GET                       ผู้ยืม = คำขอของตัวเอง · คนที่เข้าหน้าอุปกรณ์ได้ = คำขอทั้งหมด (+ อุปกรณ์ที่ให้ยืมได้ + ช่วงที่ถูกกันไว้)
//   GET ?mine=1               หน้าขอยืม: เฉพาะคำขอของตัวเองเสมอ
//   POST  { items, location, purpose, phone, team, startAt, endAt }   ส่งคำขอ (บัญชีทีมอื่น / Marketing)
//   PATCH { id, action, reason?, note? }   ผู้ยืม: cancel · คนที่เข้าหน้าอุปกรณ์ได้: approve / reject / handover / return / cancel

const ACTIONS: LoanAction[] = ["approve", "reject", "handover", "return", "cancel"];
const managerName = (me: Me) => me.owner?.name || me.admin?.name || me.email;
const errorOf = (err: unknown) => {
  const msg = (err as Error).message;
  return fail(msg, msg === LOANS_SQL ? 409 : 500);
};

async function access() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!r.me.equipment && !r.me.borrower) return { res: fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้าขอยืมอุปกรณ์", 403) };
  return { me: r.me };
}

export async function GET(request: Request) {
  const r = await access();
  if ("res" in r) return r.res;
  try {
    // ?mine=1 = หน้าขอยืม (เฉพาะคำขอของตัวเอง แม้เป็นคนที่จัดการคำขอได้ด้วย เช่น Owner ที่เป็น Marketing)
    const mine = new URL(request.url).searchParams.get("mine") === "1" && !!r.me.borrower;
    const manage = r.me.equipment && !mine;
    const [loans, { catalog, holds }, phone] = await Promise.all([
      listLoans(manage ? undefined : r.me.borrower!.id), loanCatalog(),
      // เบอร์ในรายชื่อ ใส่ให้ในฟอร์มขอยืมเป็นค่าเริ่มต้น
      r.me.borrower ? createAdminClient().from("staff").select("phone").eq("id", r.me.borrower.id).maybeSingle().then((x) => String(x.data?.phone ?? "")) : "",
    ]);
    return ok({ manage, loans, catalog, holds, me: r.me.borrower ? { name: r.me.borrower.name, team: r.me.borrower.team, phone } : null });
  } catch (err) {
    return errorOf(err);
  }
}

export async function POST(request: Request) {
  const r = await access();
  if ("res" in r) return r.res;
  if (!r.me.borrower) return fail("ส่งคำขอยืมได้จากบัญชีทีมอื่น / Marketing เท่านั้น", 403);
  const c = cleanLoanInput(await request.json().catch(() => ({})));
  if ("error" in c) return fail(c.error);
  try {
    const res = await createLoan({ ...r.me.borrower, email: r.me.email }, c.data);
    if ("error" in res) return fail(res.error!, res.error === LOANS_SQL ? 409 : 400);
    return ok({ id: res.id, message: "ส่งคำขอยืมแล้ว รอทีมงานอนุมัติ" });
  } catch (err) {
    return errorOf(err);
  }
}

export async function PATCH(request: Request) {
  const r = await access();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id), action = body?.action as LoanAction;
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่พบคำขอนี้");
  if (!ACTIONS.includes(action)) return fail("ไม่รู้จักคำสั่งนี้");
  if (action === "reject" && !String(body?.reason ?? "").trim()) return fail("กรุณาใส่เหตุผลที่ไม่อนุมัติ");
  // คนที่เข้าหน้าอุปกรณ์ได้ = จัดการได้ทุกคำขอ · บัญชีทีมอื่น = ยกเลิกคำขอของตัวเองได้อย่างเดียว
  const actor = r.me.equipment
    ? { email: r.me.email, name: managerName(r.me) }
    : { email: r.me.email, name: r.me.borrower!.name, requesterId: r.me.borrower!.id };
  try {
    const res = await actOnLoan(id, action, actor, { reason: body?.reason, note: body?.note });
    if ("error" in res) return fail(res.error!, res.error === LOANS_SQL ? 409 : 400);
    return ok({ message: "บันทึกแล้ว" });
  } catch (err) {
    return errorOf(err);
  }
}
