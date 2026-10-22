import { fail, ok, requireMe } from "@/lib/api";
import { getSettings } from "@/lib/data";
import { myRank, QUOTA_SQL } from "@/lib/mc-quota-db";

// แร็งค์ของ Mc ที่ login (โปรไฟล์ > ตารางของฉัน) — เห็นเฉพาะของตัวเอง ไม่เห็นของคนอื่น
export async function GET() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!r.me.mc) return fail("แร็งค์มีเฉพาะ Mc", 403);
  try {
    return ok({ rank: await myRank(await getSettings(), r.me.mc.id) });
  } catch (err) {
    const msg = (err as Error).message;
    // ยังไม่ได้รัน SQL = 409 (ไม่ส่งอีเมลแจ้ง error ทุกครั้งที่ Mc เปิดโปรไฟล์)
    return fail(msg, msg === QUOTA_SQL ? 409 : 500);
  }
}
