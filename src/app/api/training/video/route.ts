import { requireMe } from "@/lib/api";
import { trainingVideoChunk } from "@/lib/training";

// ไฟล์วิดีโอเทรนนิ่งสำหรับตัวเล่นของเว็บ: GET ?id=<id ไฟล์ในไดรฟ์> + header Range → 206 ทีละช่วง (ไม่เกิน 4MB)
//   ทุกคนที่ลงทะเบียน · เฉพาะคลิปที่อยู่ในหน้าเทรนนิ่ง (Owner ที่จัดการได้ = รวมที่ซ่อน)
export const maxDuration = 60;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const manage = !!r.me.owner && (r.me.owner.mc || r.me.owner.admin);
  try {
    return await trainingVideoChunk(id, request.headers.get("range"), manage, request.signal);
  } catch (err) {
    return new Response(String((err as Error)?.message ?? err).slice(0, 200), { status: 502 });
  }
}
