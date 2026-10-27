import { requireMe } from "@/lib/api";
import { isStaff } from "@/lib/auth";
import { driveMediaResponse, driveThumbResponse } from "@/lib/drive-media";
import { isFrameFile } from "@/lib/live-frames";

// ไฟล์เฟรมไลฟ์ / รูปสินค้าในไดรฟ์สำหรับหน้าเว็บ: GET ?id=<id ไฟล์> (+ header Range สำหรับวิดีโอ) · &thumb=1 = ภาพปก
//   ทีมไลฟ์ทุกคน (Mc เห็นเฟรมของ slot ตัวเอง) · เฉพาะไฟล์ที่อยู่ในแท็บ "Frame live" ของชีตเฟรม
export const maxDuration = 60;

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!isStaff(r.me)) return new Response("สำหรับทีมไลฟ์เท่านั้น", { status: 403 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  if (!/^[\w-]{10,}$/.test(id) || !(await isFrameFile(id))) return new Response("not found", { status: 404 });
  try {
    if (params.has("thumb")) return await driveThumbResponse(id, request.signal);
    return await driveMediaResponse(id, request.headers.get("range"), request.signal);
  } catch (err) {
    return new Response(String((err as Error)?.message ?? err).slice(0, 200), { status: 502 });
  }
}
