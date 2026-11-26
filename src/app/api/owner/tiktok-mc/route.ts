import { fail, ok, requireMe } from "@/lib/api";
import { tiktokMcAccess, tiktokMcMonths, tiktokMcPeople } from "@/lib/tiktok-mc";

// ผลงาน Mc > สรุป Mc TikTok (src/lib/tiktok-mc.ts)
//   GET ?access=1           { allowed } ไว้ซ่อน / แสดงแท็บ
//   GET ?year=YYYY          { months } รายเดือนของทั้งปี (ถึงเดือนนี้)
//   GET ?month=YYYY-MM      { people } ราย Mc ของเดือนนั้น (แยกคำขอ เปลี่ยนเดือนไม่ต้องโหลดทั้งปีใหม่)
export const maxDuration = 60;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const allowed = await tiktokMcAccess(r.me);
  const sp = new URL(request.url).searchParams;
  if (sp.get("access") === "1") return ok({ allowed });
  if (!allowed) return fail("สรุป Mc TikTok เปิดให้ Owner ที่จัดการฝั่ง Mc และดู Analytics ได้ หรือที่ติ๊ก \"ดูสรุป Mc TikTok\"", 403);
  const thisMonth = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  try {
    const month = sp.get("month");
    if (month !== null) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > thisMonth) return fail("เดือนไม่ถูกต้อง");
      return ok({ people: await tiktokMcPeople(month) });
    }
    const year = sp.get("year") ?? thisMonth.slice(0, 4);
    if (!/^\d{4}$/.test(year) || year > thisMonth.slice(0, 4)) return fail("ปีไม่ถูกต้อง");
    return ok({ months: await tiktokMcMonths(year) });
  } catch (err) {
    return fail(`โหลดสรุป Mc TikTok ไม่สำเร็จ: ${(err as Error).message}`, 500);
  }
}
