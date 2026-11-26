import { fail, ok, requireMe } from "@/lib/api";
import { myGmvData, ownGmvMc } from "@/lib/my-gmv-db";

// ยอดขาย (GMV) ของตัวเอง (ตารางของฉัน > ยอดขายของฉัน) — เฉพาะ Mc ประจำ · เห็นแค่ slot ของตัวเอง
export async function GET() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const mc = await ownGmvMc(r.me);
  if (!mc) return fail("ยอดขายของตัวเองเปิดให้เฉพาะ Mc ประจำ", 403);
  try {
    return ok(await myGmvData(mc));
  } catch (err) {
    return fail(`โหลดยอดขายไม่สำเร็จ: ${(err as Error).message}`, 500);
  }
}
