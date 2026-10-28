import { fail, ok, requireMe } from "@/lib/api";
import { addDays } from "@/lib/window";
import { todayKey } from "@/lib/format";
import { addBriefImage, frameWindows, listFrames, removeBriefImage, saveBriefNote } from "@/lib/live-frames";
import { createAdminClient } from "@/lib/supabase/server";
import type { FramesResponse } from "@/lib/types";

// เทรนนิ่ง > เฟรมไลฟ์ + บรีฟการแต่งตัว (Owner ที่จัดการ Mc ได้ + Admin ที่ติ๊ก can_manage_briefs — me.briefs)
//   GET ?past=1                เฟรมที่ยังไม่จบ (past = รวมที่จบใน 60 วันก่อน) + บรีฟ · ?refresh=1 = อ่านชีตใหม่ทันที
//   PATCH { key, note }        แก้ข้อความบรีฟ
//   POST  multipart key+photo  เพิ่มรูปชุดตัวอย่าง (JPG / PNG / WebP ไม่เกิน 4 MB)
//   DELETE { key, path }       ลบรูป
// key = "all|วันเริ่ม|วันจบ" = บรีฟรวมของช่วงวัน ใช้กับทุกช่อง (บรีฟแยกช่องแบบเดิม = "ช่อง|วันเริ่ม|วันจบ")
//   ทุกการแก้บันทึกใน booking_logs (slot_table = "live_briefs")

const MAX_BYTES = 4 * 1024 * 1024;

async function requireBriefs() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!r.me.briefs) return { res: fail("บัญชีนี้จัดการบรีฟการแต่งตัวไม่ได้", 403) };
  return { me: r.me, who: r.me.owner?.name || r.me.admin?.name || r.me.email };
}

async function log(email: string, who: string, action: string) {
  await createAdminClient().from("booking_logs").insert({ email, role: "บรีฟการแต่งตัว", name: who, action, slot_table: "live_briefs", slot_id: 0, result: "สำเร็จ" });
}
const keyText = (key: string) => key.replace(/^all\|/, "ทุกช่อง|").split("|").join(" ");

export async function GET(request: Request) {
  const r = await requireBriefs();
  if ("res" in r) return r.res;
  const params = new URL(request.url).searchParams;
  if (params.has("refresh")) await frameWindows(true);
  const res = await listFrames(params.has("past") ? addDays(todayKey(), -60) : todayKey());
  return ok<FramesResponse>({ ...res, canEdit: true });
}

export async function PATCH(request: Request) {
  const r = await requireBriefs();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  try {
    await saveBriefNote(String(body?.key ?? ""), body?.note, r.who);
    await log(r.me.email, r.who, `แก้บรีฟการแต่งตัว ${keyText(String(body.key))}`);
    return ok({ message: "บันทึกบรีฟแล้ว" });
  } catch (err) {
    return fail((err as Error).message);
  }
}

export async function POST(request: Request) {
  const r = await requireBriefs();
  if ("res" in r) return r.res;
  const form = await request.formData().catch(() => null);
  const key = String(form?.get("key") ?? "");
  const f = form?.get("photo");
  if (!(f instanceof File) || !f.size) return fail("ยังไม่ได้เลือกรูป");
  if (f.size > MAX_BYTES) return fail("รูปใหญ่เกินไป (ไม่เกิน 4 MB)");
  // ตรวจชนิดจากไบต์แรก (ไม่เชื่อนามสกุลไฟล์)
  const b = new Uint8Array(await f.slice(0, 12).arrayBuffer());
  const type = b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
    : b[0] === 0x89 && b[1] === 0x50 ? "image/png"
      : String.fromCharCode(...b.slice(8, 12)) === "WEBP" ? "image/webp" : "";
  if (!type) return fail("รองรับเฉพาะรูป JPG / PNG / WebP");
  try {
    await addBriefImage(key, f, type, r.who);
    await log(r.me.email, r.who, `เพิ่มรูปบรีฟการแต่งตัว ${keyText(key)}`);
    return ok({ message: "เพิ่มรูปแล้ว" });
  } catch (err) {
    return fail((err as Error).message);
  }
}

export async function DELETE(request: Request) {
  const r = await requireBriefs();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  try {
    await removeBriefImage(String(body?.key ?? ""), body?.path, r.who);
    await log(r.me.email, r.who, `ลบรูปบรีฟการแต่งตัว ${keyText(String(body.key))}`);
    return ok({ message: "ลบรูปแล้ว" });
  } catch (err) {
    return fail((err as Error).message);
  }
}
