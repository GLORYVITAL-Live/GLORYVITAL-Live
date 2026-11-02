import { fail, ok, requireOwner } from "@/lib/api";
import { mcCostReport } from "@/lib/mc-cost";

// ความคุ้มค่า Mc (?month=YYYY-MM): ค่าจ้าง Mc เทียบยอดขายของคิวเดียวกัน — เฉพาะคนที่จัดการฝั่ง Mc ได้ (เห็นค่าจ้าง)
export const maxDuration = 60;

export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูค่าจ้าง Mc", "read");
  if ("res" in r) return r.res;
  if (!r.scope.edit.mc) return fail("ดูความคุ้มค่า Mc ได้เฉพาะคนที่จัดการฝั่ง Mc (เห็นค่าจ้าง)", 403);
  try {
    return ok({ report: await mcCostReport(new URL(request.url).searchParams.get("month")) });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
