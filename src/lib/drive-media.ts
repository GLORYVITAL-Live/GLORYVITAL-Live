import "server-only";
import { Readable } from "stream";
import { driveClient } from "@/lib/drive";

// ส่งไฟล์ในไดรฟ์ (วิดีโอ / รูป) ให้หน้าเว็บผ่านเซิร์ฟเวอร์ — Google บล็อกเว็บอื่นไม่ให้ดึงไฟล์จากลิงก์ไดรฟ์ตรงๆ (403)
//   ทีละช่วงตาม header Range ช่วงละไม่เกิน 4MB (ฟังก์ชันของ Vercel ตอบได้ไม่เกิน ~4.5MB ต่อครั้ง) — ตัวเล่นวิดีโอขอช่วงถัดไปเอง
//   ไม่มี Range + ไฟล์ไม่เกิน 4MB = ทั้งไฟล์ (200) ใช้กับ <img> ได้
//   ใครเปิดไฟล์ไหนได้ ให้คนเรียกตรวจก่อน (หน้าเทรนนิ่ง = เฉพาะคลิปในหน้า / เฟรมไลฟ์ = เฉพาะไฟล์ในชีตเฟรม)

const CHUNK = 4 * 1024 * 1024;
const sizes = new Map<string, { size: number; mime: string }>();

/** ส่งต่อทันทีที่ได้จากไดรฟ์ (ไม่รอครบช่วง) · ผู้เล่นยกเลิกคำขอ (เลื่อนไปที่อื่น) = หยุดดึงจากไดรฟ์ */
export async function driveMediaResponse(id: string, range: string | null, signal?: AbortSignal): Promise<Response> {
  const drive = driveClient();
  let meta = sizes.get(id);
  if (!meta) {
    const f = await drive.files.get({ fileId: id, fields: "size, mimeType", supportsAllDrives: true });
    meta = { size: Number(f.data.size ?? 0), mime: f.data.mimeType || "application/octet-stream" };
    sizes.set(id, meta);
  }
  const whole = !range && meta.size <= CHUNK;
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  let start = m?.[1] ? Number(m[1]) : 0;
  let end = m?.[2] ? Number(m[2]) : meta.size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, meta.size - Number(m[2])); end = meta.size - 1; } // bytes=-N (ท้ายไฟล์)
  if (start >= meta.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${meta.size}` } });
  end = Math.min(end, start + CHUNK - 1, meta.size - 1);
  const res = await drive.files.get(
    { fileId: id, alt: "media", supportsAllDrives: true },
    { responseType: "stream", ...(whole ? {} : { headers: { Range: `bytes=${start}-${end}` } }), signal },
  );
  const node = res.data as unknown as Readable;
  signal?.addEventListener("abort", () => node.destroy(), { once: true });
  return new Response(Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>, {
    status: whole ? 200 : 206,
    headers: {
      "Content-Type": meta.mime, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes",
      ...(whole ? {} : { "Content-Range": `bytes ${start}-${end}/${meta.size}` }),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** ภาพปกของไฟล์ (วิดีโอ / รูป) ด้านยาว 800px · ลิงก์ภาพปกของไดรฟ์หมดอายุในไม่กี่ชั่วโมง จึงขอใหม่ทุกครั้ง */
export async function driveThumbResponse(id: string, signal?: AbortSignal): Promise<Response> {
  const f = await driveClient().files.get({ fileId: id, fields: "thumbnailLink", supportsAllDrives: true });
  const link = f.data.thumbnailLink;
  const res = link ? await fetch(link.replace(/=s\d+$/, "=s800"), { signal }) : null;
  if (!res?.ok || !res.body) return new Response("no thumbnail", { status: 404 });
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("content-type") || "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
