import { Readable } from "stream";
import { google } from "googleapis";
import { fail, ok, requireAnalytics } from "@/lib/api";
import { googleAuth } from "@/lib/google";

// แปลงไฟล์สไลด์ (.pptx ที่สร้างในเบราว์เซอร์) เป็น Google Slides เฉพาะ Owner
//   POST ?title=...  body = ไฟล์ .pptx -> สร้างในไดรฟ์ของบัญชีระบบ แชร์สิทธิ์แก้ไขให้คนที่กด แล้วคืนลิงก์ { url }

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ส่งออกข้อมูล");
  if ("res" in r) return r.res;
  const title = (new URL(request.url).searchParams.get("title") ?? "").trim().slice(0, 150) || "GLORY VITAL สไลด์";
  const data = Buffer.from(await request.arrayBuffer());
  if (!data.length || data.length > MAX_BYTES) return fail("ไฟล์สไลด์ว่างหรือใหญ่เกินไป");
  if (data[0] !== 0x50 || data[1] !== 0x4b) return fail("ไฟล์สไลด์ไม่ถูกต้อง"); // .pptx = zip ขึ้นต้นด้วย PK
  const auth = googleAuth();
  if (!auth) return fail("ยังไม่ได้เชื่อมบัญชี Google ของระบบ", 500);

  const drive = google.drive({ version: "v3", auth });
  try {
    const { data: file } = await drive.files.create({
      requestBody: { name: title, mimeType: "application/vnd.google-apps.presentation" },
      media: { mimeType: PPTX, body: Readable.from(data) },
      fields: "id, webViewLink",
    });
    const id = file.id!;

    // แชร์ให้คนที่กด แล้วตรวจว่าเปิดได้จริง (เจ้าของไฟล์อยู่แล้ว = Google ตอบ error ไม่เป็นไร)
    const shareErr = await drive.permissions.create({
      fileId: id,
      sendNotificationEmail: false,
      requestBody: { type: "user", role: "writer", emailAddress: r.me.email },
    }).then(() => null, (err: unknown) => err);
    const { data: perms } = await drive.permissions.list({ fileId: id, fields: "permissions(emailAddress)" });
    const email = r.me.email.toLowerCase();
    if (!perms.permissions?.some((p) => p.emailAddress?.toLowerCase() === email)) {
      return fail(`สร้าง Google Slides แล้ว แต่แชร์ให้ ${r.me.email} ไม่สำเร็จ${shareErr ? `: ${(shareErr as Error).message?.slice(0, 150)}` : ""}`, 500);
    }
    return ok({ url: file.webViewLink ?? `https://docs.google.com/presentation/d/${id}/edit` });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (/insufficient|scope/i.test(msg)) return fail("บัญชีระบบยังไม่ได้ให้สิทธิ์ Google Drive (ต้องเชื่อมบัญชีใหม่)", 500);
    if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) return fail("ยังไม่ได้เปิด Google Drive API ใน Google Cloud", 500);
    return fail(`สร้าง Google Slides ไม่สำเร็จ: ${msg.slice(0, 200)}`, 500);
  }
}
