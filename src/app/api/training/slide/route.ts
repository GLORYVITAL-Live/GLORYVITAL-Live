import { requireMe } from "@/lib/api";
import { isStaff } from "@/lib/auth";
import { slideImageResponse } from "@/lib/training";

// รูปสไลด์บรีฟโปรดักต์ทีละหน้า (ตัวอ่านสไลด์ของหน้าเทรนนิ่ง): GET ?i=<หน้า เริ่ม 0>&r=<รุ่นของสไลด์> → image/png
//   ทุกคนที่ลงทะเบียน · ดึงจาก Google ครั้งแรกแล้วเก็บใน bucket training-slides (src/lib/training.ts)
export const maxDuration = 60;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!isStaff(r.me)) return new Response("หน้าเทรนนิ่งสำหรับทีมไลฟ์เท่านั้น", { status: 403 });
  const params = new URL(request.url).searchParams;
  try {
    return await slideImageResponse(Number(params.get("i")), params.get("r") ?? "");
  } catch (err) {
    return new Response(String((err as Error)?.message ?? err).slice(0, 200), { status: 502 });
  }
}
